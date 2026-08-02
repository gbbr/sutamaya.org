#!/usr/bin/env node
// One-off: writes solid placeholder PWA icons (no image deps needed). Re-run if you replace
// them with real artwork later — this script is not part of the regular build.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'web', 'public', 'icons');
fs.mkdirSync(OUT, { recursive: true });

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function solidPng(size, [r, g, b], marginPct = 0) {
  const margin = Math.round(size * marginPct);
  const row = Buffer.alloc(1 + size * 4);
  const rows = [];
  for (let y = 0; y < size; y++) {
    const r0 = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const inside = x >= margin && x < size - margin && y >= margin && y < size - margin;
      const o = 1 + x * 4;
      if (inside) {
        r0[o] = r; r0[o + 1] = g; r0[o + 2] = b; r0[o + 3] = 255;
      } else {
        r0[o] = 0; r0[o + 1] = 0; r0[o + 2] = 0; r0[o + 3] = 0;
      }
    }
    rows.push(r0);
  }
  const raw = Buffer.concat(rows);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = zlib.deflateSync(raw);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const INK = [27, 25, 23];
fs.writeFileSync(path.join(OUT, 'icon-192.png'), solidPng(192, INK));
fs.writeFileSync(path.join(OUT, 'icon-512.png'), solidPng(512, INK));
fs.writeFileSync(path.join(OUT, 'icon-512-maskable.png'), solidPng(512, INK, 0.1));
console.log('Wrote placeholder icons to', OUT);
