/*
 * Безопасная распаковка ZIP и простая упаковка (без внешних зависимостей).
 * Защита: запрет абсолютных путей и «..», пропуск символических ссылок и
 * зашифрованных записей, лимиты на число файлов, размер файла, общий объём
 * и степень сжатия (zip-бомбы); фактический объём считается по распакованным байтам.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export interface ZipLimits { maxEntries: number; maxFileBytes: number; maxTotalBytes: number; maxRatio: number }
export const DEFAULT_ZIP_LIMITS: ZipLimits = { maxEntries: 5000, maxFileBytes: 200 * 1024 * 1024, maxTotalBytes: 1024 * 1024 * 1024, maxRatio: 250 };

export interface ZipEntry { name: string; method: number; compressedSize: number; size: number; crc: number; offset: number; isDir: boolean; flags: number; symlink: boolean }

export class ZipError extends Error { constructor(message: string, public code = 'ZIP') { super(message); } }

const CP866_HIGH = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмноп░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀рстуфхцчшщъыьэюяЁёЄєЇїЎў°∙·√№¤■ ';

function decodeName(buf: Buffer, utf8Flag: boolean): string {
  if (utf8Flag) return buf.toString('utf8');
  const asUtf8 = buf.toString('utf8');
  if (!asUtf8.includes('�')) return asUtf8;
  // архивы проводника Windows без флага UTF-8 обычно в кодировке OEM (CP866 для русской локали)
  let s = '';
  for (const b of buf) s += b < 0x80 ? String.fromCharCode(b) : CP866_HIGH[b - 0x80];
  return s;
}

export function safeEntryPath(name: string): string | null {
  let n = name.replace(/\\/g, '/');
  if (/^[a-zA-Z]:/.test(n) || n.startsWith('//')) return null;
  n = n.replace(/^\/+/, '');
  const parts: string[] = [];
  for (const p of n.split('/')) {
    if (p === '' || p === '.') continue;
    if (p === '..') return null;
    if (/[\u0000-\u001f<>:"|?*]/.test(p)) return null;
    parts.push(p);
  }
  return parts.length ? parts.join('/') : null;
}

export function readEntries(buf: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipEntry[] {
  const min = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new ZipError('Файл не является ZIP-архивом или повреждён (нет каталога).', 'ZIP_FORMAT');
  let count = buf.readUInt16LE(eocd + 10);
  let cdSize = buf.readUInt32LE(eocd + 12);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc >= 0 && buf.readUInt32LE(loc) === 0x07064b50) {
      const e64 = Number(buf.readBigUInt64LE(loc + 8));
      if (buf.readUInt32LE(e64) !== 0x06064b50) throw new ZipError('Повреждён каталог ZIP64.', 'ZIP_FORMAT');
      count = Number(buf.readBigUInt64LE(e64 + 32));
      cdSize = Number(buf.readBigUInt64LE(e64 + 40));
      cdOffset = Number(buf.readBigUInt64LE(e64 + 48));
    }
  }
  if (count > limits.maxEntries) throw new ZipError(`В архиве слишком много файлов (${count}; предел ${limits.maxEntries}).`, 'ZIP_LIMIT');
  if (cdOffset + cdSize > buf.length) throw new ZipError('Повреждённый ZIP: каталог за пределами файла.', 'ZIP_FORMAT');
  const out: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new ZipError('Повреждённая запись каталога ZIP.', 'ZIP_FORMAT');
    const made = buf.readUInt16LE(p + 4);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    let csize = buf.readUInt32LE(p + 20);
    let size = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const ext = buf.readUInt32LE(p + 38);
    let offset = buf.readUInt32LE(p + 42);
    const name = decodeName(buf.subarray(p + 46, p + 46 + nlen), (flags & 0x800) !== 0);
    // zip64 extra
    let x = p + 46 + nlen;
    const xend = x + xlen;
    while (x + 4 <= xend) {
      const id = buf.readUInt16LE(x), sz = buf.readUInt16LE(x + 2);
      if (id === 0x0001) {
        let q = x + 4;
        if (size === 0xffffffff) { size = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (csize === 0xffffffff) { csize = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (offset === 0xffffffff) { offset = Number(buf.readBigUInt64LE(q)); q += 8; }
      }
      x += 4 + sz;
    }
    const unixMode = (made >> 8) === 3 ? ext >>> 16 : 0;
    const symlink = (unixMode & 0o170000) === 0o120000;
    out.push({ name, method, compressedSize: csize, size, crc, offset, isDir: name.endsWith('/') || name.endsWith('\\'), flags, symlink });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

export function readEntryData(buf: Buffer, e: ZipEntry, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Buffer {
  if (e.flags & 1) throw new ZipError(`Файл «${e.name}» зашифрован — архивы с паролем не поддерживаются.`, 'ZIP_ENCRYPTED');
  const p = e.offset;
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new ZipError('Повреждённый локальный заголовок ZIP.', 'ZIP_FORMAT');
  const nlen = buf.readUInt16LE(p + 26), xlen = buf.readUInt16LE(p + 28);
  const start = p + 30 + nlen + xlen;
  const raw = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return Buffer.from(raw);
  if (e.method !== 8) throw new ZipError(`Метод сжатия ${e.method} не поддерживается (файл «${e.name}»).`, 'ZIP_METHOD');
  const max = Math.min(limits.maxFileBytes, Math.max(1024 * 1024, e.compressedSize * limits.maxRatio)) + 1;
  try {
    return zlib.inflateRawSync(raw, { maxOutputLength: max });
  } catch (err) {
    if (String((err as Error).message).includes('maxOutputLength') || (err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new ZipError(`Файл «${e.name}» распаковывается в слишком большой объём (возможна zip-бомба).`, 'ZIP_LIMIT');
    }
    throw new ZipError(`Не удалось распаковать «${e.name}»: ${(err as Error).message}`, 'ZIP_FORMAT');
  }
}

export interface ExtractReport { files: string[]; skipped: Array<{ name: string; reason: string }>; totalBytes: number }

export function extractZip(buf: Buffer, dest: string, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ExtractReport {
  const entries = readEntries(buf, limits);
  const root = path.resolve(dest);
  fs.mkdirSync(root, { recursive: true });
  const rep: ExtractReport = { files: [], skipped: [], totalBytes: 0 };
  for (const e of entries) {
    if (e.isDir) continue;
    const safe = safeEntryPath(e.name);
    if (!safe) { rep.skipped.push({ name: e.name, reason: 'небезопасный путь' }); continue; }
    if (e.symlink) { rep.skipped.push({ name: e.name, reason: 'символическая ссылка' }); continue; }
    if (/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/.test(safe)) { rep.skipped.push({ name: e.name, reason: 'служебный файл' }); continue; }
    if (e.size > limits.maxFileBytes) throw new ZipError(`Файл «${safe}» слишком большой (${Math.round(e.size / 1048576)} МБ).`, 'ZIP_LIMIT');
    const data = readEntryData(buf, e, limits);
    rep.totalBytes += data.length;
    if (rep.totalBytes > limits.maxTotalBytes) throw new ZipError('Распакованный объём архива превышает предел.', 'ZIP_LIMIT');
    const target = path.resolve(root, safe);
    if (!target.startsWith(root + path.sep)) { rep.skipped.push({ name: e.name, reason: 'выход за пределы папки' }); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    rep.files.push(safe);
  }
  return rep;
}

// ---------- запись ----------

const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(b: Buffer): number {
  const z = zlib as unknown as { crc32?: (b: Buffer) => number };
  if (typeof z.crc32 === 'function') return z.crc32(b) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function createZip(files: Array<{ name: string; data: Buffer; store?: boolean }>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const dosTime = 0, dosDate = (2026 - 1980) << 9 | 1 << 5 | 1;
  for (const f of files) {
    const name = Buffer.from(f.name.replace(/\\/g, '/'), 'utf8');
    const crc = crc32(f.data);
    const comp = f.store ? f.data : zlib.deflateRawSync(f.data, { level: 6 });
    const method = f.store ? 0 : 8;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Чтение ZIP целиком в память (для импорт-пакетов). */
export function readZipFiles(buf: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (const e of readEntries(buf, limits)) {
    if (e.isDir) continue;
    const safe = safeEntryPath(e.name);
    if (!safe || e.symlink) continue;
    out.set(safe, readEntryData(buf, e, limits));
  }
  return out;
}
