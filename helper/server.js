'use strict';

// Local-only bridge between the Chrome extension and macOS AirDrop.
//
// Chrome cannot reach AirDrop at all: navigator.share exists on macOS Chrome but is a
// stub that always rejects with NotAllowedError even with a valid user gesture, and no
// extension API exposes the share sheet. So the extension POSTs here and this process
// drives AppKit's NSSharingService via osascript.

const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const log = require('./logger');
const { validateYouTubeUrl, tokensMatch } = require('./validate');

const HOST = '127.0.0.1';
const PORT = Number(process.env.YTAD_PORT || 7337);
const TOKEN_PATH = path.join(os.homedir(), '.youtube-airdrop-token');
const SCRIPT = path.join(__dirname, 'airdrop.applescript');
const HOLD_SECONDS = Number(process.env.YTAD_HOLD_SECONDS || 120);
const MAX_BODY_BYTES = 4096;
// Past this we stop being polite and drop the connection.
const HARD_BODY_LIMIT_BYTES = 1024 * 1024;

function readToken() {
  try {
    const t = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
    return t.length >= 16 ? t : null;
  } catch (err) {
    return null;
  }
}

// Only one picker can be usefully on screen at a time, and the osascript process has
// to stay alive to host it. A second send replaces the first rather than stacking.
let current = null;

function killCurrent() {
  if (!current || current.exitCode !== null || current.killed) return;
  try {
    current.kill('SIGTERM');
    log.info('replaced previous airdrop picker', { pid: current.pid });
  } catch (err) {
    log.warn('could not kill previous picker', { error: err.message });
  }
}

function sendToAirDrop(url) {
  return new Promise((resolve, reject) => {
    killCurrent();

    const child = spawn('/usr/bin/osascript', [SCRIPT, url, String(HOLD_SECONDS)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    current = child;

    let stderr = '';
    let settled = false;
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(new Error(`could not launch osascript: ${err.message}`));
    });

    // The script blocks for HOLD_SECONDS to keep the picker on screen, so success is
    // "it started and did not fail immediately", not "it exited".
    const settleTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ pid: child.pid });
    }, 900);

    child.on('exit', (code, signal) => {
      if (child === current) current = null;
      if (settled) {
        if (code !== 0 && signal !== 'SIGTERM') {
          log.warn('picker exited non-zero after start', { code, signal, stderr: stderr.trim() });
        }
        return;
      }
      clearTimeout(settleTimer);
      settled = true;
      if (code === 0) {
        resolve({ pid: child.pid });
      } else {
        reject(new Error(stderr.trim() || `osascript exited with code ${code}`));
      }
    });
  });
}

function json(res, status, payload, origin) {
  const body = JSON.stringify(payload);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'Content-Type, X-Token';
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
  }
  res.writeHead(status, headers);
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];

    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        // Keep draining instead of destroying the socket: tearing it down here means
        // the client sees a connection error rather than our status code.
        if (!tooLarge) {
          tooLarge = true;
          chunks.length = 0;
        }
        if (size > HARD_BODY_LIMIT_BYTES) {
          const err = new Error('body far too large');
          err.statusCode = 413;
          reject(err);
          req.destroy();
        }
        return;
      }
      chunks.push(c);
    });

    req.on('end', () => {
      if (tooLarge) {
        const err = new Error(`body too large (limit ${MAX_BODY_BYTES} bytes)`);
        err.statusCode = 413;
        reject(err);
        return;
      }
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const isExtensionOrigin = typeof origin === 'string' && origin.startsWith('chrome-extension://');
  const corsOrigin = isExtensionOrigin ? origin : null;

  // Bound to loopback already; this rejects anything that still arrives off-host.
  const remote = req.socket.remoteAddress || '';
  if (!remote.includes('127.0.0.1') && remote !== '::1') {
    log.warn('rejected non-local request', { remote });
    json(res, 403, { ok: false, error: 'local requests only' }, corsOrigin);
    return;
  }

  if (req.method === 'OPTIONS') {
    json(res, 204, {}, corsOrigin);
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    json(res, 200, { ok: true, service: 'youtube-airdrop', port: PORT }, corsOrigin);
    return;
  }

  if (req.method !== 'POST' || req.url !== '/airdrop') {
    json(res, 404, { ok: false, error: 'not found' }, corsOrigin);
    return;
  }

  const expected = readToken();
  if (!expected) {
    log.error('no token file', { path: TOKEN_PATH });
    json(res, 500, { ok: false, error: `helper has no token; run setup.sh` }, corsOrigin);
    return;
  }

  if (!tokensMatch(req.headers['x-token'] || '', expected)) {
    log.warn('rejected bad token', { origin: origin || null });
    json(res, 401, { ok: false, error: 'bad or missing token' }, corsOrigin);
    return;
  }

  // A stray web page cannot read our response, but it could still fire the request,
  // so the origin has to look like our extension too.
  if (origin && !isExtensionOrigin) {
    log.warn('rejected non-extension origin', { origin });
    json(res, 403, { ok: false, error: 'origin not allowed' }, corsOrigin);
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (err) {
    const status = err.statusCode || 400;
    log.warn('rejected request body', { status, error: err.message });
    json(res, status, { ok: false, error: `bad request body: ${err.message}` }, corsOrigin);
    return;
  }

  const check = validateYouTubeUrl(payload && payload.url);
  if (!check.ok) {
    log.warn('rejected url', { reason: check.reason });
    json(res, 400, { ok: false, error: check.reason }, corsOrigin);
    return;
  }

  try {
    const result = await sendToAirDrop(check.url);
    log.info('airdrop picker opened', { url: check.url, pid: result.pid });
    json(res, 200, { ok: true, url: check.url }, corsOrigin);
  } catch (err) {
    log.error('airdrop failed', { url: check.url, error: err.message });
    json(res, 500, { ok: false, error: err.message }, corsOrigin);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    log.error('port already in use', { port: PORT });
  } else {
    log.error('server error', { error: err.message });
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  log.info('helper listening', { host: HOST, port: PORT, tokenPresent: Boolean(readToken()) });
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log.info('shutting down', { signal: sig });
    killCurrent();
    server.close(() => process.exit(0));
  });
}
