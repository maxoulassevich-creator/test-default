/*
 * Локальный HTTP API обработчика (только loopback: 127.0.0.1 и ::1).
 * Защита: проверка Host (от DNS rebinding), токен Bearer для всех операций кроме
 * /api/health и /api/pair, ограничение попыток ввода кода, лимит размера загрузки.
 * CORS разрешён для любого origin (UI плагина Figma имеет origin "null"), но без
 * cookies — авторизация только токеном.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { GENERATOR, GENERATOR_VERSION, PROTOCOL_VERSION } from '../../shared/schema';
import { routeFileId } from '../../shared/routes';
import { browserStatus } from './browser';
import { issueToken, tokenValid, type Config } from './config';
import { UserError, type CaptureRequest, type JobManager, type JobOptions } from './jobs';
import { compareImages, decodePng, downscale, encodePng } from './png';
import { createZip } from './zip';

export interface ServerDeps { cfg: Config; jobs: JobManager; webDir: string }

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': Buffer.isBuffer(body) ? headers['content-type'] ?? 'application/octet-stream' : 'application/json; charset=utf-8', 'content-length': data.length, 'cache-control': 'no-store', ...headers });
  res.end(data);
}

function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new UserError(`Файл больше допустимого (${Math.round(limit / 1048576)} МБ).`, 'Уменьшите архив (удалите лишние видео/исходники) или увеличьте лимит maxUploadBytes в config.json обработчика.', 'TOO_LARGE')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function json<T>(req: http.IncomingMessage, limit = 2 * 1024 * 1024): Promise<T> {
  const b = await readBody(req, limit);
  if (!b.length) return {} as T;
  try { return JSON.parse(b.toString('utf8')) as T; } catch { throw new UserError('Неверный JSON запроса.', 'Обновите плагин до версии, совместимой с обработчиком.', 'BAD_JSON'); }
}

const attempts: number[] = [];

export function createServer(d: ServerDeps): http.Server {
  const { cfg, jobs } = d;
  const allowedHosts = new Set([`127.0.0.1:${cfg.port}`, `localhost:${cfg.port}`, `[::1]:${cfg.port}`]);
  return http.createServer(async (req, res) => {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, content-type, x-file-name, x-h2f-protocol',
      'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
      'access-control-allow-private-network': 'true',
      'access-control-max-age': '600',
      'access-control-expose-headers': 'content-disposition',
    };
    for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
    try {
      if (!allowedHosts.has(String(req.headers.host))) { send(res, 403, { error: 'host not allowed' }); return; }
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      const p = url.pathname;
      // ---------- без авторизации
      if (p === '/' || p === '/index.html') {
        send(res, 200, fs.readFileSync(path.join(d.webDir, 'index.html')), { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'" });
        return;
      }
      if (p === '/web.js') { send(res, 200, fs.readFileSync(path.join(d.webDir, 'web.js')), { 'content-type': 'text/javascript; charset=utf-8' }); return; }
      if (p === '/api/health') {
        const auth = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
        const browser = url.searchParams.get('browser') === '1' ? await browserStatus() : undefined;
        send(res, 200, { app: GENERATOR, version: GENERATOR_VERSION, protocol: PROTOCOL_VERSION, paired: tokenValid(cfg, auth), browser, limits: { maxUploadBytes: cfg.limits.maxUploadBytes } });
        return;
      }
      if (p === '/api/pair' && req.method === 'POST') {
        const now = Date.now();
        while (attempts.length && now - attempts[0] > 5 * 60_000) attempts.shift();
        if (attempts.length >= 10) { send(res, 429, { error: 'Слишком много попыток. Подождите 5 минут.' }); return; }
        attempts.push(now);
        const body = await json<{ code?: string }>(req);
        const got = String(body.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const want = cfg.pairingCode.replace(/[^A-Z0-9]/g, '');
        if (!got || got !== want) { send(res, 401, { error: 'Неверный код подключения.', action: 'Скопируйте код из окна обработчика (строка «Код подключения»).' }); return; }
        send(res, 200, { token: issueToken(cfg) });
        return;
      }
      // ---------- с авторизацией
      const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      if (!tokenValid(cfg, token)) { send(res, 401, { error: 'Нужен код подключения.', action: 'Введите в плагине код из окна обработчика.' }); return; }
      const proto = req.headers['x-h2f-protocol'];
      if (proto && Number(proto) !== PROTOCOL_VERSION) { send(res, 409, { error: `Версия протокола плагина (${proto}) не совпадает с обработчиком (${PROTOCOL_VERSION}).`, action: 'Обновите плагин и обработчик из одного установочного архива.' }); return; }

      if (p === '/api/jobs' && req.method === 'POST') {
        const name = decodeURIComponent(String(req.headers['x-file-name'] ?? url.searchParams.get('name') ?? 'project.html'));
        const buf = await readBody(req, cfg.limits.maxUploadBytes);
        if (!buf.length) throw new UserError('Пустой файл.', 'Выберите HTML или ZIP ещё раз.');
        const job = jobs.create(buf, name);
        let opts: JobOptions = {};
        const o = url.searchParams.get('options');
        if (o) { try { opts = JSON.parse(o); } catch { /* */ } }
        void job.analyze(opts);
        send(res, 200, { id: job.id });
        return;
      }
      const m = /^\/api\/jobs\/([a-z0-9]+)(\/.*)?$/.exec(p);
      if (!m) { send(res, 404, { error: 'not found' }); return; }
      const job = jobs.get(m[1]);
      if (!job) { send(res, 404, { error: 'Задание не найдено (обработчик перезапускался?).', action: 'Загрузите файл заново и нажмите «Анализировать».' }); return; }
      const sub = m[2] ?? '';
      if (sub === '' && req.method === 'GET') { send(res, 200, job.status()); return; }
      if (sub === '' && req.method === 'DELETE') { await jobs.remove(job.id); send(res, 200, { ok: true }); return; }
      if (sub === '/analyze' && req.method === 'POST') {
        if (job.state === 'analyzing' || job.state === 'capturing') { send(res, 409, { error: 'Задание уже выполняется.', action: 'Дождитесь завершения или нажмите «Отмена».' }); return; }
        const opts = await json<JobOptions>(req);
        void job.analyze(opts);
        send(res, 200, { ok: true });
        return;
      }
      if (sub === '/capture' && req.method === 'POST') {
        if (job.state === 'analyzing' || job.state === 'capturing') { send(res, 409, { error: 'Задание уже выполняется.', action: 'Дождитесь завершения или нажмите «Отмена».' }); return; }
        const body = await json<CaptureRequest & { profile?: Partial<typeof job.profile> }>(req);
        if (body.profile) job.profile = { ...job.profile, ...body.profile, storage: job.profile.storage };
        void job.capture(body);
        send(res, 200, { ok: true });
        return;
      }
      if (sub === '/cancel' && req.method === 'POST') { await job.cancel(); send(res, 200, { ok: true }); return; }
      if (sub === '/document') { send(res, 200, job.document()); return; }
      if (sub === '/report') {
        send(res, 200, { ...job.status(), document: job.document(false) }, { 'content-disposition': `attachment; filename="report-${job.id}.json"` });
        return;
      }
      const rm = /^\/routes\/([^/]+)$/.exec(sub);
      if (rm) {
        const r = job.routes.find((x) => routeFileId(x.key) === rm[1]);
        const s = r ? job.snapshot(r.key) : null;
        if (!s) { send(res, 404, { error: 'Страница ещё не снята.', action: 'Нажмите «Создать макеты» — страница будет снята автоматически.' }); return; }
        send(res, 200, s);
        return;
      }
      const am = /^\/assets\/([a-z0-9]+)$/.exec(sub);
      if (am) {
        const info = job.store.get(am[1]);
        if (!info) { send(res, 404, { error: 'нет ресурса' }); return; }
        send(res, 200, fs.readFileSync(job.store.path(info.id)), { 'content-type': info.mime });
        return;
      }
      const tm = /^\/thumbs\/([^/]+)$/.exec(sub);
      if (tm) {
        const f = path.join(job.dir, 'thumbs', tm[1].replace(/[^\w.-]/g, '') + '.jpg');
        if (!fs.existsSync(f)) { send(res, 404, { error: 'нет превью' }); return; }
        send(res, 200, fs.readFileSync(f), { 'content-type': 'image/jpeg' });
        return;
      }
      if (sub === '/package') {
        const doc = job.document();
        const files: Array<{ name: string; data: Buffer; store?: boolean }> = [
          { name: 'h2f-package.json', data: Buffer.from(JSON.stringify({ format: 'h2f-package', version: 1, protocol: PROTOCOL_VERSION })) },
          { name: 'document.json', data: Buffer.from(JSON.stringify(doc)) },
        ];
        for (const r of doc.routes) { const s = job.snapshot(r.key); if (s) files.push({ name: `routes/${routeFileId(r.key)}.json`, data: Buffer.from(JSON.stringify(s)) }); }
        for (const a of doc.assets) files.push({ name: `assets/${a.id}`, data: fs.readFileSync(job.store.path(a.id)), store: a.mime !== 'image/svg+xml' });
        const name = job.sourceName.replace(/\.(zip|html?)$/i, '') + '.h2f.zip';
        send(res, 200, createZip(files), { 'content-type': 'application/zip', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}` });
        return;
      }
      const vm = /^\/verify\/([^/]+)(\/diff\.png)?$/.exec(sub);
      if (vm) {
        const src = path.join(job.dir, 'shots', vm[1].replace(/[^\w.-]/g, '') + '.png');
        const out = path.join(job.dir, 'verify', vm[1].replace(/[^\w.-]/g, '') + '-diff.png');
        if (vm[2]) { if (!fs.existsSync(out)) { send(res, 404, { error: 'нет сравнения' }); return; } send(res, 200, fs.readFileSync(out), { 'content-type': 'image/png' }); return; }
        if (req.method !== 'POST') { send(res, 405, { error: 'POST' }); return; }
        if (!fs.existsSync(src)) { send(res, 404, { error: 'Нет эталонного снимка этой страницы.', action: 'Снимите страницу заново.' }); return; }
        const body = await readBody(req, 200 * 1024 * 1024);
        const a = decodePng(fs.readFileSync(src)), b = decodePng(body);
        const cmp = compareImages(a, b, 40);
        fs.writeFileSync(out, encodePng(downscale(cmp.diff, 2)));
        const result = { source: [a.width, a.height], figma: [b.width, b.height], sizeMatch: a.width === b.width && Math.abs(a.height - b.height) <= 2, meanAbs: +cmp.meanAbs.toFixed(3), changedRatio: +cmp.changedRatio.toFixed(5), scope: 'Исходник в Chromium ↔ PNG, экспортированный из нативных нод Figma (exportAsync)' };
        fs.writeFileSync(path.join(job.dir, 'verify', vm[1].replace(/[^\w.-]/g, '') + '.json'), JSON.stringify(result));
        send(res, 200, result);
        return;
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      if (e instanceof UserError) send(res, e.code === 'TOO_LARGE' ? 413 : 400, { error: e.message, action: e.action, code: e.code });
      else send(res, 500, { error: 'Ошибка обработчика: ' + String((e as Error)?.message ?? e).slice(0, 300), action: 'Повторите действие; при повторении — перезапустите обработчик.' });
    }
  });
}
