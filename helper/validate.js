'use strict';

// Kept separate from server.js so it can be unit-tested without binding a port.

const ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

const MAX_URL_LENGTH = 2048;

function validateYouTubeUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, reason: 'url missing' };
  if (raw.length > MAX_URL_LENGTH) return { ok: false, reason: 'url too long' };

  let u;
  try {
    u = new URL(raw);
  } catch (err) {
    return { ok: false, reason: 'url unparseable' };
  }

  if (u.protocol !== 'https:') return { ok: false, reason: 'only https allowed' };
  if (!ALLOWED_HOSTS.has(u.hostname.toLowerCase())) {
    return { ok: false, reason: `host not allowed: ${u.hostname}` };
  }
  return { ok: true, url: u.toString() };
}

// Length-independent comparison so a wrong token leaks no timing signal.
function tokensMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

module.exports = { validateYouTubeUrl, tokensMatch, ALLOWED_HOSTS, MAX_URL_LENGTH };
