/*
 * Управление Chromium через Playwright: поиск браузера, изолированные контексты,
 * сетевые ограничения, внедрение скрипта захвата, фазы захвата и CDP-запросы
 * (рамки псевдоэлементов, фактические системные шрифты).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright-core';
import type { CaptureProfile } from '../../shared/schema';
import type { RawCapture, CaptureOptions, PseudoBox } from '../../capture/walk';

declare const __CAPTURE_SOURCE__: string;

export interface BrowserInfo { ok: boolean; name: string; version: string; executable?: string; error?: string }

function candidates(): Array<{ label: string; opts: Parameters<typeof chromium.launch>[0] }> {
  const out: Array<{ label: string; opts: Parameters<typeof chromium.launch>[0] }> = [];
  const env = process.env.H2F_CHROMIUM;
  if (env && fs.existsSync(env)) out.push({ label: 'H2F_CHROMIUM', opts: { executablePath: env } });
  try {
    const p = chromium.executablePath();
    if (p && fs.existsSync(p)) out.push({ label: 'Playwright Chromium', opts: { executablePath: p } });
  } catch { /* браузер Playwright не установлен */ }
  const local = path.join(process.env.PLAYWRIGHT_BROWSERS_PATH || '', 'chromium-1194', 'chrome-linux', 'chrome');
  if (fs.existsSync(local)) out.push({ label: 'Chromium (PLAYWRIGHT_BROWSERS_PATH)', opts: { executablePath: local } });
  if (os.platform() === 'win32' || os.platform() === 'darwin') {
    out.push({ label: 'Microsoft Edge', opts: { channel: 'msedge' } });
    out.push({ label: 'Google Chrome', opts: { channel: 'chrome' } });
  } else {
    for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/microsoft-edge']) if (fs.existsSync(p)) out.push({ label: p, opts: { executablePath: p } });
  }
  return out;
}

let shared: { browser: Browser; info: BrowserInfo } | null = null;

export async function getBrowser(): Promise<{ browser: Browser; info: BrowserInfo }> {
  if (shared && shared.browser.isConnected()) return shared;
  const errors: string[] = [];
  for (const c of candidates()) {
    try {
      const browser = await chromium.launch({ ...c.opts, headless: true, args: ['--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none', '--disable-features=Translate,MediaRouter', '--mute-audio'] });
      shared = { browser, info: { ok: true, name: c.label, version: browser.version(), executable: (c.opts as { executablePath?: string }).executablePath } };
      browser.on('disconnected', () => { shared = null; });
      return shared;
    } catch (e) {
      errors.push(`${c.label}: ${String((e as Error).message).split('\n')[0]}`);
    }
  }
  throw Object.assign(new Error('Не найден браузер Chromium/Edge/Chrome. ' + errors.join(' | ')), { code: 'NO_BROWSER' });
}

export async function browserStatus(): Promise<BrowserInfo> {
  try { return (await getBrowser()).info; } catch (e) { return { ok: false, name: '', version: '', error: (e as Error).message }; }
}

export async function closeBrowser() { if (shared) { await shared.browser.close().catch(() => undefined); shared = null; } }

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.0\.0\.0|\[?::1\]?|\[?f[cd][0-9a-f]{2}:)/i;

export interface ContextOptions {
  profile: CaptureProfile;
  siteOrigin: string;
  injectCss?: Array<{ url: string }>;
  record?: { storageKeys: Set<string>; external: Set<string>; failed: Map<string, string>; responses?: Map<string, { status: number; type: string }> };
}

export async function newContext(browser: Browser, o: ContextOptions): Promise<BrowserContext> {
  const p = o.profile;
  const ctx = await browser.newContext({
    viewport: { width: p.viewportWidth, height: p.viewportHeight },
    deviceScaleFactor: 1,
    locale: p.locale,
    colorScheme: p.colorScheme,
    reducedMotion: p.reducedMotion,
    serviceWorkers: 'block',
    acceptDownloads: false,
    javaScriptEnabled: true,
    hasTouch: false,
    isMobile: false,
  });
  ctx.setDefaultTimeout(30000);
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    let u: URL;
    try { u = new URL(url); } catch { return route.abort(); }
    if (u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
    if (url.startsWith(o.siteOrigin)) return route.continue();
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return route.abort();
    // защита от SSRF: исполняемый HTML не может обращаться к локальной сети и другим портам
    if (PRIVATE_HOST.test(u.hostname)) { o.record?.failed.set(url, 'заблокировано: локальная сеть'); return route.abort('blockedbyclient'); }
    o.record?.external.add(u.origin);
    if (p.blockExternal) { o.record?.failed.set(url, 'внешние запросы отключены'); return route.abort('blockedbyclient'); }
    if (req.method() !== 'GET' && req.method() !== 'HEAD') { o.record?.failed.set(url, 'запрос изменения данных заблокирован'); return route.abort('blockedbyclient'); }
    return route.continue();
  });
  if (o.record) {
    const rec = o.record;
    ctx.on('requestfailed', (r) => { if (!rec.failed.has(r.url())) rec.failed.set(r.url(), r.failure()?.errorText ?? 'ошибка'); });
    ctx.on('response', (r) => { if (r.status() >= 400) rec.failed.set(r.url(), 'HTTP ' + r.status()); });
  }
  const storage = p.storage ?? {};
  await ctx.addInitScript(({ origin, storage }) => {
    if (location.origin + '/' !== origin && !location.href.startsWith(origin)) return;
    try { for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v); } catch { /* */ }
    // фиксируем ключи, которые читает приложение — для подсказок профиля
    try {
      const keys = new Set<string>();
      (window as unknown as { __h2fKeys: Set<string> }).__h2fKeys = keys;
      const orig = Storage.prototype.getItem;
      Storage.prototype.getItem = function (k: string) { try { if (this === window.localStorage) keys.add(String(k)); } catch { /* */ } return orig.call(this, k); };
    } catch { /* */ }
    // не открывать окна и не печатать
    window.open = () => null;
    window.print = () => undefined;
  }, { origin: o.siteOrigin, storage });
  if (o.injectCss?.length) {
    const urls = o.injectCss.map((c) => c.url);
    await ctx.addInitScript((urls) => {
      const add = () => { for (const u of urls) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = u; l.setAttribute('data-h2f', 'inject'); (document.head || document.documentElement).appendChild(l); } };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add, { once: true }); else add();
    }, urls);
  }
  ctx.on('page', (pg) => { pg.on('dialog', (d) => d.dismiss().catch(() => undefined)); });
  return ctx;
}

export async function inject(page: Page): Promise<string> {
  const key = '__h2f_' + crypto.randomBytes(6).toString('hex');
  const src = __CAPTURE_SOURCE__.replace(/__H2F_KEY_PLACEHOLDER__/g, key);
  await page.evaluate(src);
  return key;
}

/** Вызов метода API захвата в странице. */
export async function call<T>(page: Page, key: string, method: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(({ key, method, args }) => {
    const api = (window as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>)[key];
    if (!api) throw new Error('capture api missing');
    return api[method](...args);
  }, { key, method, args }) as Promise<T>;
}

export async function waitAfterNavigation(page: Page, timeoutMs: number) {
  try { await page.waitForLoadState('load', { timeout: timeoutMs }); } catch { /* продолжаем с тем, что есть */ }
  try { await page.waitForLoadState('networkidle', { timeout: Math.min(3000, timeoutMs) }); } catch { /* постоянная сетевая активность допустима */ }
}

/** Рамки псевдоэлементов в нейтрализованном состоянии через CDP DOM.getBoxModel. */
async function pseudoBoxes(cdp: CDPSession): Promise<Record<string, PseudoBox>> {
  await cdp.send('DOM.enable');
  const doc = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const res: Record<string, PseudoBox> = {};
  const jobs: Array<Promise<void>> = [];
  const walk = (n: { attributes?: string[]; pseudoElements?: Array<{ nodeId: number; pseudoType?: string }>; children?: unknown[]; shadowRoots?: unknown[]; contentDocument?: unknown }) => {
    const attrs = n.attributes ?? [];
    const i = attrs.indexOf('data-h2f-p');
    if (i >= 0 && n.pseudoElements) {
      const id = attrs[i + 1];
      const box: PseudoBox = {};
      res[id] = box;
      for (const p of n.pseudoElements) {
        const t = p.pseudoType;
        if (t !== 'before' && t !== 'after' && t !== 'marker') continue;
        jobs.push(cdp.send('DOM.getBoxModel', { nodeId: p.nodeId }).then((bm) => { box[t] = bm.model.border; }).catch(() => undefined));
      }
    }
    for (const c of (n.children ?? []) as typeof n[]) walk(c);
    for (const c of (n.shadowRoots ?? []) as typeof n[]) walk(c);
  };
  walk(doc.root as never);
  await Promise.all(jobs);
  return res;
}

/** Фактические системные шрифты для элементов с универсальными семействами. */
async function platformFonts(cdp: CDPSession, marks: string[]): Promise<Record<string, Array<{ familyName: string; postScriptName?: string; isCustomFont: boolean; glyphCount: number }>>> {
  const out: Record<string, Array<{ familyName: string; postScriptName?: string; isCustomFont: boolean; glyphCount: number }>> = {};
  if (!marks.length) return out;
  await cdp.send('CSS.enable').catch(() => undefined);
  const doc = await cdp.send('DOM.getDocument', { depth: 0 });
  const q = await cdp.send('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector: '[data-h2f-f]' });
  await Promise.all(q.nodeIds.map(async (id) => {
    try {
      const attrs = (await cdp.send('DOM.getAttributes', { nodeId: id })).attributes;
      const mark = attrs[attrs.indexOf('data-h2f-f') + 1];
      const f = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: id });
      out[mark] = f.fonts as never;
    } catch { /* */ }
  }));
  return out;
}

export interface CaptureRun {
  raw: RawCapture;
  platform: Record<string, Array<{ familyName: string; postScriptName?: string; isCustomFont: boolean; glyphCount: number }>>;
  timings: Record<string, number>;
}

export async function capturePage(page: Page, key: string, opts: CaptureOptions): Promise<CaptureRun> {
  const t: Record<string, number> = {};
  let t0 = Date.now();
  const cdp = await page.context().newCDPSession(page);
  try {
    await call(page, key, 'begin', opts);
    t.phaseA = Date.now() - t0; t0 = Date.now();
    await call(page, key, 'neutral', true);
    const boxes = await pseudoBoxes(cdp);
    t.cdp = Date.now() - t0; t0 = Date.now();
    await call(page, key, 'measure', boxes);
    t.phaseB = Date.now() - t0; t0 = Date.now();
    await call(page, key, 'neutral', false);
    const raw = await call<RawCapture>(page, key, 'finish');
    t.phaseC = Date.now() - t0; t0 = Date.now();
    const platform = await platformFonts(cdp, raw.genericMarks.map((m) => m.mark));
    t.fonts = Date.now() - t0;
    return { raw, platform, timings: t };
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}
