/*
 * Минимальный PNG-кодек (8 бит, RGBA/RGB/Gray/GrayA/Palette, без interlace) для обрезки
 * прозрачных полей растров, сравнения снимков и проверки размеров ресурсов.
 */
import zlib from 'node:zlib';

export interface RGBAImage { width: number; height: number; data: Buffer }

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isPng(b: Uint8Array): boolean {
  return b.length > 24 && SIG.every((v, i) => b[i] === v);
}

export function pngSize(b: Uint8Array): { width: number; height: number } | null {
  if (!isPng(b)) return null;
  const dv = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  return { width: dv.readUInt32BE(16), height: dv.readUInt32BE(20) };
}

export function decodePng(buf: Buffer): RGBAImage {
  if (!isPng(buf)) throw new Error('not a png');
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  let palette: Buffer | null = null, trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (bitDepth !== 8 || interlace) throw new Error(`unsupported png (depth ${bitDepth}, interlace ${interlace})`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType as 0 | 2 | 3 | 4 | 6];
  if (!ch) throw new Error('unsupported color type ' + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? line[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[x] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4, i = x * ch;
      if (colorType === 6) { out[o] = line[i]; out[o + 1] = line[i + 1]; out[o + 2] = line[i + 2]; out[o + 3] = line[i + 3]; }
      else if (colorType === 2) { out[o] = line[i]; out[o + 1] = line[i + 1]; out[o + 2] = line[i + 2]; out[o + 3] = 255; }
      else if (colorType === 0) { out[o] = out[o + 1] = out[o + 2] = line[i]; out[o + 3] = 255; }
      else if (colorType === 4) { out[o] = out[o + 1] = out[o + 2] = line[i]; out[o + 3] = line[i + 1]; }
      else { const p = line[i]; out[o] = palette![p * 3]; out[o + 1] = palette![p * 3 + 1]; out[o + 2] = palette![p * 3 + 2]; out[o + 3] = trns && p < trns.length ? trns[p] : 255; }
    }
    prev = line;
  }
  return { width, height, data: out };
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Buffer): number { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function encodePng(img: RGBAImage): Buffer {
  const { width, height, data } = img;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (stride + 1)] = 0; data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

export function alphaBounds(img: RGBAImage, threshold = 2): { x: number; y: number; w: number; h: number } | null {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function crop(img: RGBAImage, r: { x: number; y: number; w: number; h: number }): RGBAImage {
  const out = Buffer.alloc(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) img.data.copy(out, y * r.w * 4, ((r.y + y) * img.width + r.x) * 4, ((r.y + y) * img.width + r.x + r.w) * 4);
  return { width: r.w, height: r.h, data: out };
}

/** Сравнение двух снимков одинакового размера (после приведения к общему размеру). */
export function compareImages(a: RGBAImage, b: RGBAImage, tolerance = 24): { width: number; height: number; meanAbs: number; changedRatio: number; diff: RGBAImage } {
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
  const diff = Buffer.alloc(w * h * 4);
  let sum = 0, changed = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ia = (y * a.width + x) * 4, ib = (y * b.width + x) * 4, o = (y * w + x) * 4;
      const comp = (img: RGBAImage, i: number, c: number) => (img.data[i + c] * img.data[i + 3] + 255 * (255 - img.data[i + 3])) / 255;
      const d = Math.max(Math.abs(comp(a, ia, 0) - comp(b, ib, 0)), Math.abs(comp(a, ia, 1) - comp(b, ib, 1)), Math.abs(comp(a, ia, 2) - comp(b, ib, 2)));
      sum += d;
      if (d > tolerance) { changed++; diff[o] = 255; diff[o + 1] = 0; diff[o + 2] = 64; diff[o + 3] = 255; }
      else { const g = 255 - Math.round((255 - comp(a, ia, 1)) * 0.25); diff[o] = g; diff[o + 1] = g; diff[o + 2] = g; diff[o + 3] = 255; }
    }
  }
  return { width: w, height: h, meanAbs: sum / (w * h || 1), changedRatio: changed / (w * h || 1), diff: { width: w, height: h, data: diff } };
}

export function downscale(img: RGBAImage, factor: number): RGBAImage {
  const k = Math.max(1, Math.floor(factor));
  const w = Math.floor(img.width / k), h = Math.floor(img.height / k);
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const acc = [0, 0, 0, 0];
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) { const i = ((y * k + dy) * img.width + x * k + dx) * 4; for (let c = 0; c < 4; c++) acc[c] += img.data[i + c]; }
    const o = (y * w + x) * 4;
    for (let c = 0; c < 4; c++) out[o + c] = Math.round(acc[c] / (k * k));
  }
  return { width: w, height: h, data: out };
}
