import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return png;
}

function setPixel(rgba, width, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= width || y >= width) return;
  const i = (y * width + x) * 4;
  rgba[i] = r;
  rgba[i + 1] = g;
  rgba[i + 2] = b;
  rgba[i + 3] = a;
}

function fillRect(rgba, width, x0, y0, x1, y1, r, g, b) {
  const xa = Math.max(0, Math.min(x0, x1));
  const xb = Math.min(width - 1, Math.max(x0, x1));
  const ya = Math.max(0, Math.min(y0, y1));
  const yb = Math.min(width - 1, Math.max(y0, y1));
  for (let y = ya; y <= yb; y += 1) {
    for (let x = xa; x <= xb; x += 1) setPixel(rgba, width, x, y, r, g, b);
  }
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  fillRect(rgba, size, 0, 0, size, size, 20, 23, 26);

  const s = size / 128;
  const brass = [176, 141, 87];
  const stone = [42, 48, 56];
  const dark = [26, 30, 36];

  fillRect(rgba, size, Math.round(28 * s), Math.round(40 * s), Math.round(99 * s), Math.round(108 * s), ...stone);
  fillRect(rgba, size, Math.round(28 * s), Math.round(32 * s), Math.round(99 * s), Math.round(44 * s), ...brass);
  for (let i = 0; i < 4; i += 1) {
    const x = Math.round((28 + i * 18) * s);
    fillRect(rgba, size, x, Math.round(22 * s), x + Math.round(10 * s), Math.round(36 * s), ...brass);
  }
  fillRect(rgba, size, Math.round(28 * s), Math.round(40 * s), Math.round(32 * s), Math.round(108 * s), ...brass);
  fillRect(rgba, size, Math.round(95 * s), Math.round(40 * s), Math.round(99 * s), Math.round(108 * s), ...brass);
  fillRect(rgba, size, Math.round(28 * s), Math.round(104 * s), Math.round(99 * s), Math.round(108 * s), ...brass);
  fillRect(rgba, size, Math.round(58 * s), Math.round(70 * s), Math.round(69 * s), Math.round(108 * s), ...dark);
  fillRect(rgba, size, Math.round(60 * s), Math.round(58 * s), Math.round(67 * s), Math.round(72 * s), ...brass);
  return encodePng(size, size, rgba);
}

const outDir = resolve(root, "dist/icons");
await mkdir(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await writeFile(resolve(outDir, `icon${size}.png`), drawIcon(size));
}
