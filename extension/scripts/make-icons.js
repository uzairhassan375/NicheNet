import { deflateSync, crc32 } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const name = Buffer.from(type);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])) >>> 0, 0);
  return Buffer.concat([length, name, data, checksum]);
}

function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function mix(data, index, color, coverage) {
  const srcA = coverage;
  if (srcA <= 0) return;
  const dstA = data[index + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  for (let channel = 0; channel < 3; channel += 1) {
    data[index + channel] = Math.round((color[channel] * srcA + data[index + channel] * dstA * (1 - srcA)) / outA);
  }
  data[index + 3] = Math.round(outA * 255);
}

function cover(distance) {
  return Math.max(0, Math.min(1, 0.5 - distance));
}

function paint(size) {
  const data = new Uint8ClampedArray(size * size * 4);
  const pine = [15, 92, 88];
  const cream = [247, 243, 234];
  const ink = [20, 42, 46];
  const margin = size * 0.06;
  const radius = size * 0.22;
  const half = size / 2 - margin;
  const cx = size * 0.43;
  const cy = size * 0.43;
  const lens = size * 0.2;
  const x1 = cx + lens * 0.62;
  const y1 = cy + lens * 0.62;
  const x2 = size * 0.78;
  const y2 = size * 0.78;
  const handle = size * 0.075;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5 - size / 2;
      const py = y + 0.5 - size / 2;
      const dx = Math.abs(px) - half + radius;
      const dy = Math.abs(py) - half + radius;
      const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius;
      const index = (y * size + x) * 4;
      mix(data, index, pine, cover(outside));

      const pointX = x + 0.5;
      const pointY = y + 0.5;
      const vx = x2 - x1;
      const vy = y2 - y1;
      const t = Math.max(0, Math.min(1, ((pointX - x1) * vx + (pointY - y1) * vy) / (vx * vx + vy * vy)));
      const handleDistance = Math.hypot(pointX - (x1 + t * vx), pointY - (y1 + t * vy)) - handle;
      mix(data, index, ink, cover(handleDistance));

      const lensDistance = Math.hypot(pointX - cx, pointY - cy);
      mix(data, index, cream, cover(lensDistance - lens));
      const ring = Math.abs(lensDistance - lens * 0.72) - size * 0.035;
      mix(data, index, pine, cover(ring) * cover(lensDistance - lens));
    }
  }
  return data;
}

function paintStore(size) {
  const data = new Uint8ClampedArray(size * size * 4);
  const pine = [15, 92, 88];
  const cream = [247, 243, 234];
  const ink = [20, 42, 46];
  for (let i = 0; i < data.length; i += 4) {
    data[i] = pine[0];
    data[i + 1] = pine[1];
    data[i + 2] = pine[2];
    data[i + 3] = 255;
  }
  const cx = size * 0.4;
  const cy = size * 0.4;
  const lens = size * 0.24;
  const x1 = cx + lens * 0.62;
  const y1 = cy + lens * 0.62;
  const x2 = size * 0.8;
  const y2 = size * 0.8;
  const handle = size * 0.085;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const pointX = x + 0.5;
      const pointY = y + 0.5;
      const vx = x2 - x1;
      const vy = y2 - y1;
      const t = Math.max(0, Math.min(1, ((pointX - x1) * vx + (pointY - y1) * vy) / (vx * vx + vy * vy)));
      const handleDistance = Math.hypot(pointX - (x1 + t * vx), pointY - (y1 + t * vy)) - handle;
      mix(data, index, ink, cover(handleDistance));
      const lensDistance = Math.hypot(pointX - cx, pointY - cy);
      mix(data, index, cream, cover(lensDistance - lens));
      const ring = Math.abs(lensDistance - lens * 0.72) - size * 0.04;
      mix(data, index, pine, cover(ring) * cover(lensDistance - lens));
    }
  }
  return data;
}

const iconsDir = path.resolve(import.meta.dirname, "../icons");
mkdirSync(iconsDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(path.join(iconsDir, `icon${size}.png`), encodePng(size, paint(size)));
}
const storeIcon = path.resolve(import.meta.dirname, "../../nichenet-store-icon.png");
writeFileSync(storeIcon, encodePng(128, paintStore(128)));
console.log(storeIcon);
