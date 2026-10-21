/*
 * Раздача распакованных проектов на отдельном loopback-порту (другой origin, чем API):
 * исполняемый HTML не может обращаться к API обработчика как к «своему» сайту.
 * Только GET/HEAD, нормализация путей, без листинга каталогов; SPA-fallback по флагу задания.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.bmp': 'image/bmp', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.eot': 'application/vnd.ms-fontobject', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.wasm': 'application/wasm', '.map': 'application/json',
};

export interface SiteMount { dir: string; spaFallback: boolean; entry: string }

export class SiteServer {
  private server: http.Server | null = null;
  private mounts = new Map<string, SiteMount>();
  port = 0;

  mount(jobId: string, m: SiteMount) { this.mounts.set(jobId, m); }
  unmount(jobId: string) { this.mounts.delete(jobId); }
  update(jobId: string, patch: Partial<SiteMount>) { const m = this.mounts.get(jobId); if (m) Object.assign(m, patch); }
  origin(): string { return `http://127.0.0.1:${this.port}`; }
  prefix(jobId: string): string { return `${this.origin()}/j/${jobId}/`; }

  /** Чтение файла сайта по URL (для ресурсов, без повторного HTTP). */
  readUrl(url: string, jobId?: string): Buffer | null {
    const f = this.resolve(url, jobId);
    if (!f) return null;
    try { return fs.readFileSync(f); } catch { return null; }
  }

  /**
   * Файл по URL. Путь вне «/j/<задание>/» — путь от корня сайта («/css/a.css»): он относится
   * к заданию fallbackJob (страница, с которой пришёл запрос, или задание финализации).
   */
  resolve(url: string, fallbackJob?: string): string | null {
    let u: URL;
    try { u = new URL(url); } catch { return null; }
    if (u.origin !== this.origin()) return null;
    let m = /^\/j\/([a-z0-9]+)\/(.*)$/.exec(u.pathname);
    if ((!m || !this.mounts.has(m[1])) && fallbackJob && this.mounts.has(fallbackJob)) m = [u.pathname, fallbackJob, u.pathname.replace(/^\/+/, '')] as unknown as RegExpExecArray;
    if (!m) return null;
    const mount = this.mounts.get(m[1]);
    if (!mount) return null;
    let rel: string;
    try { rel = decodeURIComponent(m[2]); } catch { return null; }
    const root = path.resolve(mount.dir);
    let f = path.resolve(root, rel);
    if (f !== root && !f.startsWith(root + path.sep)) return null;
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) {
      if (mount.spaFallback && !path.extname(rel)) return path.join(root, mount.entry);
      return null;
    }
    return f;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
        // путь от корня сайта («/css/a.css») — перенаправляем в папку задания страницы-источника
        // (Referer), чтобы и вложенные url(/img/…) этого файла разрешались от неё же
        const ref = /\/j\/([a-z0-9]+)\//.exec(String(req.headers.referer ?? ''));
        if (!/^\/j\/[a-z0-9]+\//.test(req.url ?? '/') && ref && this.mounts.has(ref[1])) {
          res.writeHead(307, { location: `/j/${ref[1]}/${(req.url ?? '/').replace(/^\/+/, '')}`, 'cache-control': 'no-store' });
          res.end();
          return;
        }
        const f = this.resolve(this.origin() + (req.url ?? '/'));
        if (!f) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
        const type = MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream';
        const st = fs.statSync(f);
        res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'cache-control': 'no-store', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' });
        if (req.method === 'HEAD') { res.end(); return; }
        fs.createReadStream(f).pipe(res);
      });
      this.server.on('error', reject);
      this.server.listen(0, '127.0.0.1', () => { this.port = (this.server!.address() as { port: number }).port; resolve(); });
    });
  }

  stop() { this.server?.close(); }
}
