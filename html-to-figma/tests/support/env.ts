/* Общие помощники тестов: запуск обработчика, сборка ZIP фикстур, клиент API. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startProcessor } from '../../processor/src/main';
import { createZip } from '../../processor/src/zip';

function findRoot(): string {
  let d = __dirname;
  for (let i = 0; i < 8; i++) {
    const pj = path.join(d, 'package.json');
    if (fs.existsSync(pj) && JSON.parse(fs.readFileSync(pj, 'utf8')).name === 'html-to-figma-importer') return d;
    d = path.dirname(d);
  }
  return process.env.H2F_ROOT ?? process.cwd();
}
export const ROOT = findRoot();
export const FIX = path.join(ROOT, 'tests', 'fixtures');
export const BLOGS = path.join(FIX, 'blogs');

if (!process.env.H2F_CHROMIUM && fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')) process.env.H2F_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export async function startTestProcessor(extra: { concurrency?: number } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'h2f-test-'));
  process.env.H2F_EPHEMERAL = '1';
  const port = 47900 + Math.floor(Math.random() * 500);
  const p = await startProcessor({ port, dataDir, profilesDirs: [path.join(ROOT, 'processor', 'profiles')], webDir: path.join(ROOT, 'processor', 'web') });
  if (extra.concurrency) p.cfg.limits.concurrency = extra.concurrency;
  const base = `http://127.0.0.1:${p.cfg.port}`;
  const pair = await fetch(base + '/api/pair', { method: 'POST', body: JSON.stringify({ code: p.cfg.pairingCode }), headers: { 'content-type': 'application/json' } });
  const { token } = await pair.json() as { token: string };
  const api = async (pth: string, init: RequestInit = {}) => {
    const r = await fetch(base + pth, { ...init, headers: { authorization: 'Bearer ' + token, ...(init.headers ?? {}) } });
    return r;
  };
  const json = async <T = any>(pth: string, init: RequestInit = {}) => { const r = await api(pth, init); const b = await r.json(); if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(b)}`); return b as T; };
  const waitJob = async (id: string, busy: string[], timeoutMs = 600000) => {
    const t0 = Date.now();
    for (;;) {
      const s = await json(`/api/jobs/${id}`);
      if (!busy.includes(s.state)) return s;
      if (Date.now() - t0 > timeoutMs) throw new Error('timeout waiting job ' + s.state + ' ' + JSON.stringify(s.progress));
      await new Promise((r) => setTimeout(r, 400));
    }
  };
  const cleanup = async () => { await p.stop(); fs.rmSync(dataDir, { recursive: true, force: true }); };
  return { ...p, base, token, api, json, waitJob, cleanup, dataDir };
}

export function blogZip(file: string): Buffer {
  const files = [{ name: file, data: fs.readFileSync(path.join(BLOGS, file)) }, { name: 'fonts.css', data: fs.readFileSync(path.join(BLOGS, 'fonts.css')) }];
  for (const f of fs.readdirSync(path.join(BLOGS, 'Fonts'))) if (f.endsWith('.ttf')) files.push({ name: 'Fonts/' + f, data: fs.readFileSync(path.join(BLOGS, 'Fonts', f)) });
  return createZip(files);
}

export function dirZip(dir: string): Buffer {
  const files: Array<{ name: string; data: Buffer }> = [];
  const walk = (d: string) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else files.push({ name: path.relative(dir, p).split(path.sep).join('/'), data: fs.readFileSync(p) }); } };
  walk(dir);
  return createZip(files);
}

/** ZIP каталога фикстуры + тестовые шрифты (fonts.css подключается профилем, исходный HTML не меняется). */
export function zipWithFonts(dir: string): Buffer {
  const files: Array<{ name: string; data: Buffer }> = [];
  const walk = (d: string) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else files.push({ name: path.relative(dir, p).split(path.sep).join('/'), data: fs.readFileSync(p) }); } };
  walk(dir);
  files.push({ name: 'fonts.css', data: fs.readFileSync(path.join(BLOGS, 'fonts.css')) });
  for (const f of fs.readdirSync(path.join(BLOGS, 'Fonts'))) if (f.endsWith('.ttf')) files.push({ name: 'Fonts/' + f, data: fs.readFileSync(path.join(BLOGS, 'Fonts', f)) });
  return createZip(files);
}

export const TEST_PROFILE = { injectCss: ['fonts.css'], blockExternal: true };
