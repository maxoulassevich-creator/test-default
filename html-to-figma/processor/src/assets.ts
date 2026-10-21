/*
 * Хранилище ресурсов задания: дедупликация по SHA-256 содержимого, проверка
 * формата (реальные байты, а не расширение), размеры, лимиты.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AssetInfo } from '../../shared/schema';
import { pngSize } from './png';

export function sniffMime(b: Uint8Array): string {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'image/avif';
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if (b.length >= 4 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'image/x-icon';
  const head = Buffer.from(b.subarray(0, 512)).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg')) || head.includes('<svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

export function imageSize(b: Uint8Array, mime: string): { width: number; height: number } | null {
  try {
    const buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
    if (mime === 'image/png') return pngSize(b);
    if (mime === 'image/gif') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch { /* повреждённый заголовок */ }
  return null;
}

/** Форматы, которые Figma createImage принимает напрямую. */
export const FIGMA_NATIVE = new Set(['image/png', 'image/jpeg', 'image/gif']);
export const FIGMA_MAX_PX = 4096;

export class AssetStore {
  readonly dir: string;
  private infos = new Map<string, AssetInfo>();
  private totalBytes = 0;
  constructor(dir: string, private limits: { maxAssets: number; maxTotalBytes: number }) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  /** Добавляет ресурс; возвращает его id (повтор с теми же байтами → тот же id). */
  put(bytes: Buffer, kind: 'image' | 'svg', source: string, note?: string): AssetInfo {
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const id = (kind === 'svg' ? 's' : 'i') + sha256.slice(0, 24);
    const have = this.infos.get(id);
    if (have) return have;
    if (this.infos.size >= this.limits.maxAssets) throw Object.assign(new Error(`Превышен лимит ресурсов (${this.limits.maxAssets})`), { code: 'ASSET_LIMIT' });
    if (this.totalBytes + bytes.length > this.limits.maxTotalBytes) throw Object.assign(new Error('Превышен общий объём ресурсов'), { code: 'ASSET_LIMIT' });
    const mime = kind === 'svg' ? 'image/svg+xml' : sniffMime(bytes);
    const size = kind === 'svg' ? { width: 0, height: 0 } : imageSize(bytes, mime);
    if (kind === 'image' && !FIGMA_NATIVE.has(mime)) throw new Error('Неподдерживаемый формат для Figma: ' + mime);
    if (kind === 'image' && (!size || size.width < 1 || size.height < 1)) throw new Error('Не удалось определить размер изображения');
    if (size && (size.width > FIGMA_MAX_PX || size.height > FIGMA_MAX_PX)) throw new Error(`Изображение больше ${FIGMA_MAX_PX}px`);
    fs.writeFileSync(path.join(this.dir, id), bytes);
    const info: AssetInfo = { id, kind, mime, width: size?.width ?? 0, height: size?.height ?? 0, bytes: bytes.length, sha256, source: source.slice(0, 300), note };
    this.infos.set(id, info);
    this.totalBytes += bytes.length;
    return info;
  }

  get(id: string): AssetInfo | undefined { return this.infos.get(id); }
  path(id: string): string { return path.join(this.dir, id.replace(/[^a-z0-9]/gi, '')); }
  all(): AssetInfo[] { return [...this.infos.values()]; }
  load(list: AssetInfo[]) { for (const a of list) { this.infos.set(a.id, a); this.totalBytes += a.bytes; } }
}
