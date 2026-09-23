'use strict';

const HELPER_BASE = 'http://127.0.0.1:7337';

const tokenInput = document.getElementById('token');
const statusEl = document.getElementById('status');

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = `status ${kind || 'muted'}`;
}

async function load() {
  const { helperToken } = await chrome.storage.local.get('helperToken');
  if (helperToken) tokenInput.value = helperToken;
}

document.getElementById('save').addEventListener('click', async () => {
  const value = tokenInput.value.trim();
  if (value.length < 16) {
    setStatus('That token looks too short — copy the whole line from setup.sh.', 'bad');
    return;
  }
  await chrome.storage.local.set({ helperToken: value });
  setStatus('Saved.', 'ok');
});

document.getElementById('test').addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  setStatus('Testing…', 'muted');

  let health;
  try {
    health = await fetch(`${HELPER_BASE}/health`);
  } catch (err) {
    setStatus('Helper not reachable. Start it with: npm start (or launchctl load the agent).', 'bad');
    return;
  }
  if (!health.ok) {
    setStatus(`Helper answered with HTTP ${health.status}.`, 'bad');
    return;
  }

  if (!token) {
    setStatus('Helper is running, but no token entered yet.', 'bad');
    return;
  }

  // Deliberately posts an invalid URL: it exercises the token check without opening
  // an AirDrop picker on screen.
  let probe;
  try {
    probe = await fetch(`${HELPER_BASE}/airdrop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Token': token },
      body: JSON.stringify({ url: 'https://example.com/not-youtube' }),
    });
  } catch (err) {
    setStatus(`Helper went away mid-test: ${err.message}`, 'bad');
    return;
  }

  if (probe.status === 401) {
    setStatus('Helper is running, but rejected this token.', 'bad');
    return;
  }
  if (probe.status === 400) {
    setStatus('Helper is running and the token works. Ready to send.', 'ok');
    return;
  }
  setStatus(`Unexpected helper response: HTTP ${probe.status}.`, 'bad');
});

load();
