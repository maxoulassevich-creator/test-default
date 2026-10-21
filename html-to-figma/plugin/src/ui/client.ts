/*
 * Клиент локального обработчика и источники данных для сборки (обработчик или пакет).
 */
import { PROTOCOL_VERSION, type ImportDocument, type RouteSnapshot } from '../../../shared/schema';
import { routeFileId } from '../../../shared/routes';

export class ApiError extends Error {
  constructor(message: string, public action: string, public status: number, public kind: 'offline' | 'auth' | 'protocol' | 'server' | 'user') { super(message); }
}

export class Processor {
  constructor(public base: string, public token: string | null) {}

  private async req(path: string, init: RequestInit = {}, raw = false): Promise<Response> {
    const headers: Record<string, string> = { 'x-h2f-protocol': String(PROTOCOL_VERSION), ...(init.headers as Record<string, string> ?? {}) };
    if (this.token) headers.authorization = 'Bearer ' + this.token;
    let r: Response;
    try {
      r = await fetch(this.base.replace(/\/+$/, '') + path, { ...init, headers });
    } catch {
      throw new ApiError('Нет связи с обработчиком.', 'Запустите обработчик (start-windows.cmd) и нажмите «Проверить снова». Если он запущен, а связи нет — Figma может блокировать доступ к локальным программам: используйте режим «пакет импорта» (см. README).', 0, 'offline');
    }
    if (!r.ok && !raw) {
      let body: { error?: string; action?: string } = {};
      try { body = await r.json(); } catch { /* */ }
      if (r.status === 401) throw new ApiError(body.error ?? 'Нужен код подключения.', body.action ?? 'Введите код из окна обработчика.', 401, 'auth');
      if (r.status === 409 && /протокол/i.test(body.error ?? '')) throw new ApiError(body.error!, body.action ?? 'Обновите плагин и обработчик.', 409, 'protocol');
      throw new ApiError(body.error ?? `Ошибка обработчика (HTTP ${r.status})`, body.action ?? 'Повторите действие.', r.status, r.status >= 500 ? 'server' : 'user');
    }
    return r;
  }

  async health(browser = false) { return (await this.req('/api/health' + (browser ? '?browser=1' : ''))).json() as Promise<{ app: string; version: string; protocol: number; paired: boolean; browser?: { ok: boolean; name: string; version: string; error?: string }; limits?: { maxUploadBytes: number } }>; }
  async pair(code: string): Promise<string> {
    const r = await fetch(this.base.replace(/\/+$/, '') + '/api/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) }).catch(() => { throw new ApiError('Нет связи с обработчиком.', 'Проверьте, что окно обработчика открыто.', 0, 'offline'); });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(body.error ?? 'Не удалось подключиться', body.action ?? 'Проверьте код.', r.status, 'auth');
    this.token = body.token;
    return body.token;
  }
  async upload(file: Blob, name: string, options: unknown): Promise<string> {
    const r = await this.req('/api/jobs?options=' + encodeURIComponent(JSON.stringify(options)), { method: 'POST', body: file, headers: { 'x-file-name': encodeURIComponent(name), 'content-type': 'application/octet-stream' } });
    return (await r.json()).id;
  }
  async status<T>(id: string): Promise<T> { return (await this.req('/api/jobs/' + id)).json(); }
  async analyze(id: string, opts: unknown) { await this.req(`/api/jobs/${id}/analyze`, { method: 'POST', body: JSON.stringify(opts), headers: { 'content-type': 'application/json' } }); }
  async capture(id: string, body: unknown) { await this.req(`/api/jobs/${id}/capture`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }); }
  async cancel(id: string) { await this.req(`/api/jobs/${id}/cancel`, { method: 'POST' }).catch(() => undefined); }
  async document(id: string): Promise<ImportDocument> { return (await this.req(`/api/jobs/${id}/document`)).json(); }
  async snapshot(id: string, key: string): Promise<RouteSnapshot> { return (await this.req(`/api/jobs/${id}/routes/${routeFileId(key)}`)).json(); }
  async asset(id: string, asset: string): Promise<Uint8Array> { return new Uint8Array(await (await this.req(`/api/jobs/${id}/assets/${asset}`)).arrayBuffer()); }
  async thumb(id: string, key: string): Promise<string | null> {
    const r = await this.req(`/api/jobs/${id}/thumbs/${routeFileId(key)}`, {}, true);
    if (!r.ok) return null;
    return URL.createObjectURL(await r.blob());
  }
  async blob(path: string): Promise<Blob> { return (await this.req(path)).blob(); }
  async verify(id: string, key: string, png: Uint8Array) {
    return (await this.req(`/api/jobs/${id}/verify/${routeFileId(key)}`, { method: 'POST', body: png as BodyInit, headers: { 'content-type': 'image/png' } })).json() as Promise<{ meanAbs: number; changedRatio: number; sizeMatch: boolean; source: number[]; figma: number[] }>;
  }
}

/** Источник данных для сборки: живой обработчик или файл пакета. */
export interface DataSource {
  document(): Promise<ImportDocument>;
  snapshot(key: string): Promise<RouteSnapshot>;
  asset(id: string): Promise<Uint8Array>;
}

export function processorSource(p: Processor, jobId: string): DataSource {
  return { document: () => p.document(jobId), snapshot: (k) => p.snapshot(jobId, k), asset: (a) => p.asset(jobId, a) };
}

// ---------- чтение ZIP пакета в браузере (DecompressionStream) ----------
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZip(buf: ArrayBuffer): Promise<Map<string, () => Promise<Uint8Array>>> {
  const b = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Файл не является ZIP-архивом.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map<string, () => Promise<Uint8Array>>();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Повреждённый ZIP.');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
    out.set(name, async () => {
      const ln = dv.getUint16(off + 26, true), lx = dv.getUint16(off + 28, true);
      const data = b.subarray(off + 30 + ln + lx, off + 30 + ln + lx + csize);
      if (method === 0) return data.slice();
      if (method === 8) return inflateRaw(data);
      throw new Error('Метод сжатия не поддерживается: ' + method);
    });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

export async function packageSource(file: File): Promise<{ source: DataSource; doc: ImportDocument }> {
  const files = await readZip(await file.arrayBuffer());
  const metaF = files.get('h2f-package.json');
  if (!metaF) throw new Error('Это не пакет импорта HTML → Figma (нет h2f-package.json).');
  const meta = JSON.parse(new TextDecoder().decode(await metaF()));
  if (meta.protocol !== PROTOCOL_VERSION) throw new Error(`Пакет создан другой версией (протокол ${meta.protocol}).`);
  const doc = JSON.parse(new TextDecoder().decode(await files.get('document.json')!())) as ImportDocument;
  const source: DataSource = {
    document: async () => doc,
    snapshot: async (k) => { const f = files.get(`routes/${routeFileId(k)}.json`); if (!f) throw new Error('В пакете нет страницы ' + k); return JSON.parse(new TextDecoder().decode(await f())); },
    asset: async (a) => { const f = files.get(`assets/${a}`); if (!f) throw new Error('В пакете нет ресурса ' + a); return f(); },
  };
  return { source, doc };
}
