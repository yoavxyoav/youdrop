'use strict';

// Generates the extension's PNG icons with no image dependencies: a rounded red tile,
// a white play triangle, and (at larger sizes only) two AirDrop-style radar arcs.
// 4x supersampling keeps the curves smooth at 16px.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'extension', 'icons');
const SIZES = [16, 32, 48, 128];
const SS = 4;

const BG = [0xff, 0x22, 0x3d];
const FG = [0xff, 0xff, 0xff];

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // truecolour with alpha
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // adaptive filtering
  ihdr[12] = 0;  // no interlace

  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter type: none
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function insideRoundedRect(x, y, size, radius) {
  const inset = size * 0.02;
  const lo = inset;
  const hi = size - inset;
  if (x < lo || x > hi || y < lo || y > hi) return false;
  const cx = Math.min(Math.max(x, lo + radius), hi - radius);
  const cy = Math.min(Math.max(y, lo + radius), hi - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function insideTriangle(x, y, size, shiftX) {
  // Play triangle pointing right, vertically centred.
  const left = size * (0.34 + shiftX);
  const right = size * (0.64 + shiftX);
  const top = size * 0.28;
  const bottom = size * 0.72;
  if (x < left || x > right) return false;
  const t = (x - left) / (right - left); // 0 at flat edge, 1 at the point
  const halfHeight = ((bottom - top) / 2) * (1 - t);
  const midY = (top + bottom) / 2;
  return Math.abs(y - midY) <= halfHeight;
}

function insideArc(x, y, size, rFrac, thickFrac) {
  // Radar arc opening to the right, echoing the AirDrop glyph.
  const cx = size * 0.30;
  const cy = size * 0.5;
  const r = size * rFrac;
  const half = (size * thickFrac) / 2;
  const d = Math.hypot(x - cx, y - cy);
  if (Math.abs(d - r) > half) return false;
  return x - cx > Math.abs(y - cy) * 0.35;
}

function render(size) {
  const withArcs = size >= 48;
  const shiftX = withArcs ? -0.08 : 0;
  const radius = size * 0.22;
  const out = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let bgHits = 0;
      let fgHits = 0;

      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const x = px + (sx + 0.5) / SS;
          const y = py + (sy + 0.5) / SS;
          if (!insideRoundedRect(x, y, size, radius)) continue;
          bgHits += 1;
          const isGlyph = insideTriangle(x, y, size, shiftX)
            || (withArcs && (insideArc(x, y, size, 0.30, 0.055) || insideArc(x, y, size, 0.41, 0.055)));
          if (isGlyph) fgHits += 1;
        }
      }

      const samples = SS * SS;
      const i = (py * size + px) * 4;
      if (bgHits === 0) {
        out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = 0;
        continue;
      }
      const glyphRatio = fgHits / bgHits;
      out[i] = Math.round(BG[0] + (FG[0] - BG[0]) * glyphRatio);
      out[i + 1] = Math.round(BG[1] + (FG[1] - BG[1]) * glyphRatio);
      out[i + 2] = Math.round(BG[2] + (FG[2] - BG[2]) * glyphRatio);
      out[i + 3] = Math.round((bgHits / samples) * 255);
    }
  }

  return encodePng(size, size, out);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = path.join(OUT_DIR, `icon${size}.png`);
  fs.writeFileSync(file, render(size));
  process.stdout.write(`wrote ${file}\n`);
}
