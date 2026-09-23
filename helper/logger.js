'use strict';

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');

let stream = null;

function ensureStream() {
  if (stream) return stream;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    stream = fs.createWriteStream(path.join(LOG_DIR, `helper-${day}.log`), { flags: 'a' });

    // An unhandled 'error' event on a stream throws, which would take down the whole
    // helper over something as mundane as a full disk. Degrade to stdout instead.
    stream.on('error', (err) => {
      process.stderr.write(`logger: log stream failed, continuing on stdout: ${err.message}\n`);
      stream = null;
    });
  } catch (err) {
    process.stderr.write(`logger: cannot open log file: ${err.message}\n`);
    stream = null;
  }
  return stream;
}

function emit(level, message, fields) {
  const record = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(fields || {}),
  };
  const line = JSON.stringify(record);

  const s = ensureStream();
  if (s) s.write(line + '\n');
  process.stdout.write(line + '\n');
}

module.exports = {
  info: (message, fields) => emit('info', message, fields),
  warn: (message, fields) => emit('warn', message, fields),
  error: (message, fields) => emit('error', message, fields),
  debug: (message, fields) => emit('debug', message, fields),
  LOG_DIR,
};
