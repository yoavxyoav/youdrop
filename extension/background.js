'use strict';

// Chrome has no route to AirDrop of its own: on macOS navigator.share is present but
// always rejects with NotAllowedError, even with a real user gesture. So this worker
// collects the video id + playhead position and hands the URL to the local helper,
// which drives AppKit's NSSharingService.

const HELPER_BASE = 'http://127.0.0.1:7337';
const BADGE_CLEAR_MS = 3500;

// Runs in the page. Must be fully self-contained — it is serialised, not closed over.
function readPlaybackState() {
  const player = document.querySelector('#movie_player');

  function pickVideo() {
    // Deliberately NO readyState filter. YouTube reports readyState 0 while buffering
    // or mid-seek even though currentTime is already correct, and filtering on it threw
    // away a perfectly good element — which silently dropped the timestamp.
    const inPlayer = document.querySelector('#movie_player video, ytd-player video');
    if (inPlayer) return inPlayer;

    // Shorts and the home feed keep several <video> elements around; take the biggest,
    // which is the one on screen.
    const candidates = Array.from(document.querySelectorAll('video'))
      .sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight));
    return candidates[0] || null;
  }

  function extractVideoId(urlString) {
    let u;
    try {
      u = new URL(urlString);
    } catch (err) {
      return null;
    }

    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0];
      return id || null;
    }

    const v = u.searchParams.get('v');
    if (v) return v;

    const m = u.pathname.match(/^\/(?:shorts|live|embed|v)\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  const videoId = extractVideoId(location.href);
  if (!videoId) return { ok: false, error: 'no YouTube video on this page' };

  const video = pickVideo();

  // Two independent sources for the playhead. The element is authoritative mid-seek;
  // the player API covers the case where YouTube swapped the element out underneath us.
  let seconds = null;
  if (video && Number.isFinite(video.currentTime) && video.currentTime > 0) {
    seconds = video.currentTime;
  }
  if (seconds === null && player && typeof player.getCurrentTime === 'function') {
    try {
      const t = player.getCurrentTime();
      if (Number.isFinite(t) && t > 0) seconds = t;
    } catch (err) {
      // player API not ready; the 0 fallback below is fine
    }
  }

  const rawTitle = (document.title || '').replace(/\s*-\s*YouTube\s*$/, '').replace(/^\(\d+\)\s*/, '');

  return {
    ok: true,
    videoId,
    seconds: Math.max(0, Math.floor(seconds === null ? 0 : seconds)),
    isLive: Boolean(video && video.duration === Infinity),
    hadVideo: Boolean(video || player),
    title: rawTitle || videoId,
  };
}

function formatClock(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

async function setBadge(tabId, text, color) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '' }).catch(() => {});
    }, BADGE_CLEAR_MS);
  } catch (err) {
    // Badge is cosmetic; never let it break the send.
  }
}

async function notify(title, message) {
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title,
      message,
    });
  } catch (err) {
    console.warn('notification failed', err);
  }
}

async function getToken() {
  const { helperToken } = await chrome.storage.local.get('helperToken');
  return typeof helperToken === 'string' ? helperToken.trim() : '';
}

async function postToHelper(url, token) {
  let response;
  try {
    response = await fetch(`${HELPER_BASE}/airdrop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Token': token },
      body: JSON.stringify({ url }),
    });
  } catch (err) {
    throw new Error('Helper not reachable. Is the AirDrop helper running?');
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (err) {
    // fall through to the status-based message below
  }

  if (!response.ok) {
    const detail = payload && payload.error ? payload.error : `HTTP ${response.status}`;
    if (response.status === 401) {
      throw new Error('Helper rejected the token. Re-paste it in the extension options.');
    }
    throw new Error(detail);
  }
  return payload;
}

async function airdropCurrentMoment(tab) {
  if (!tab || typeof tab.id !== 'number') {
    await notify('AirDrop failed', 'No active tab.');
    return;
  }

  const onYouTube = /^https?:\/\/([a-z0-9-]+\.)*(youtube\.com|youtu\.be)\//i.test(tab.url || '');
  if (!onYouTube) {
    await setBadge(tab.id, '✕', '#B00020');
    await notify('Not a YouTube page', 'Open a YouTube video first, then try again.');
    return;
  }

  let state;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readPlaybackState,
    });
    state = result && result.result;
  } catch (err) {
    await setBadge(tab.id, '✕', '#B00020');
    await notify('AirDrop failed', `Could not read the player: ${err.message}`);
    return;
  }

  if (!state || !state.ok) {
    await setBadge(tab.id, '✕', '#B00020');
    await notify('AirDrop failed', (state && state.error) || 'Could not find a video on this page.');
    return;
  }

  const token = await getToken();
  if (!token) {
    await setBadge(tab.id, '✕', '#B00020');
    await notify('Token missing', 'Open the extension options and paste the helper token.');
    chrome.runtime.openOptionsPage().catch(() => {});
    return;
  }

  // Live streams have no meaningful offset to resume from, so skip the t= parameter.
  const includeTime = !state.isLive && state.hadVideo && state.seconds > 0;
  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(state.videoId)}`
    + (includeTime ? `&t=${state.seconds}s` : '');

  try {
    await postToHelper(url, token);
    await setBadge(tab.id, '✓', '#1E8E3E');
    await notify(
      'AirDrop picker open',
      includeTime
        ? `${state.title} @ ${formatClock(state.seconds)} — pick your phone on screen.`
        : `${state.title} — pick your phone on screen.`,
    );
  } catch (err) {
    await setBadge(tab.id, '✕', '#B00020');
    await notify('AirDrop failed', err.message);
  }
}

chrome.action.onClicked.addListener((tab) => {
  airdropCurrentMoment(tab);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'airdrop-current-moment') return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  airdropCurrentMoment(tab);
});
