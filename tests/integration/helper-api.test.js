'use strict';

// Hits the running local helper. Deliberately avoids any request that would succeed,
// because a success opens an AirDrop picker on screen.
// Requires: ./setup.sh has run and the helper is listening.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = 'http://127.0.0.1:7337';
const EXT_ORIGIN = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_PATH = path.join(os.homedir(), '.youtube-airdrop-token');

function realToken() {
  return fs.readFileSync(TOKEN_PATH, 'utf8').trim();
}

function post(body, headers) {
  return fetch(`${BASE}/airdrop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: EXT_ORIGIN, ...(headers || {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('health endpoint reports the service', async () => {
  const res = await fetch(`${BASE}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, 'youtube-airdrop');
});

test('rejects a missing token with 401', async () => {
  const res = await post({ url: 'https://www.youtube.com/watch?v=abc' });
  assert.equal(res.status, 401);
});

test('rejects a wrong token with 401', async () => {
  const res = await post({ url: 'https://www.youtube.com/watch?v=abc' }, { 'X-Token': 'f'.repeat(64) });
  assert.equal(res.status, 401);
});

test('rejects a non-YouTube URL with 400 even when the token is valid', async () => {
  const res = await post({ url: 'https://example.com/evil' }, { 'X-Token': realToken() });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /host not allowed/);
});

test('rejects a non-extension origin with 403', async () => {
  const res = await fetch(`${BASE}/airdrop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.test', 'X-Token': realToken() },
    body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=abc' }),
  });
  assert.equal(res.status, 403);
});

test('rejects malformed JSON with 400', async () => {
  const res = await post('{not json', { 'X-Token': realToken() });
  assert.equal(res.status, 400);
});

test('rejects an oversized body with 413 and a real response, not a dropped socket', async () => {
  const res = await post(
    { url: `https://www.youtube.com/watch?v=abc&pad=${'x'.repeat(8000)}` },
    { 'X-Token': realToken() },
  );
  assert.equal(res.status, 413);
  const body = await res.json();
  assert.match(body.error, /body too large/);
});

test('unknown routes return 404', async () => {
  const res = await fetch(`${BASE}/nope`);
  assert.equal(res.status, 404);
});

test('preflight from the extension origin is allowed', async () => {
  const res = await fetch(`${BASE}/airdrop`, { method: 'OPTIONS', headers: { Origin: EXT_ORIGIN } });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), EXT_ORIGIN);
});
