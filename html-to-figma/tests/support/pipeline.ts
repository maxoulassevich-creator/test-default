/*
 * Сквозной сценарий для тестов: обработчик (настоящий, Chromium) → данные →
 * собранный plugin/dist/code.js в модели Figma API (НЕ настоящая Figma).
 * Драйвер повторяет протокол UI плагина (ui.ts): шрифты → begin → ассеты → страницы → commit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import type { CodeToUi, FontCheckResult } from '../../shared/messages';
import type { ImportDocument, RouteSnapshot } from '../../shared/schema';
import { routeFileId } from '../../shared/routes';
import { styleItalic, styleWeight } from '../../shared/fonts';
import { createFigmaMock, type MockOptions } from './figma-mock';
import { BLOGS, ROOT, startTestProcessor } from './env';

export type TP = Awaited<ReturnType<typeof startTestProcessor>>;

export const FIXTURE_FONTS: Array<{ family: string; style: string }> = [
  ...['Regular', 'Italic', 'Medium', 'Medium Italic', 'SemiBold'].map((s) => ({ family: 'Cormorant Garamond', style: s })),
  ...['Regular', 'Italic', 'Medium', 'SemiBold'].map((s) => ({ family: 'EB Garamond', style: s })),
  ...['Regular', 'Italic', 'Bold'].map((s) => ({ family: 'Courier Prime', style: s })),
  ...['Regular', 'Italic', 'Bold'].map((s) => ({ family: 'Cousine', style: s })),
  { family: 'Marck Script', style: 'Regular' },
  { family: 'DejaVu Sans', style: 'Book' }, { family: 'DejaVu Sans', style: 'Bold' }, { family: 'DejaVu Serif', style: 'Book' }, { family: 'DejaVu Sans Mono', style: 'Book' },
  { family: 'Liberation Serif', style: 'Regular' }, { family: 'Liberation Sans', style: 'Regular' }, { family: 'Liberation Mono', style: 'Regular' },
  { family: 'Inter', style: 'Regular' }, { family: 'Inter', style: 'Bold' },
];

export async function analyzeZip(t: TP, zip: Buffer, name: string, options: Record<string, unknown> = {}) {
  const up = await t.json('/api/jobs?options=' + encodeURIComponent(JSON.stringify(options)), { method: 'POST', body: new Uint8Array(zip), headers: { 'x-file-name': encodeURIComponent(name) } });
  const s = await t.waitJob(up.id, ['analyzing']);
  return { id: up.id as string, status: s };
}

export async function capture(t: TP, id: string, routes: string[], hover?: Record<string, 'auto' | 'none' | number>) {
  await t.json(`/api/jobs/${id}/capture`, { method: 'POST', body: JSON.stringify({ routes, hover }), headers: { 'content-type': 'application/json' } });
  return t.waitJob(id, ['capturing'], 3_600_000);
}

export async function snapshot(t: TP, id: string, key: string): Promise<RouteSnapshot> {
  return t.json(`/api/jobs/${id}/routes/${routeFileId(key)}`);
}

let browser: Browser | null = null;
export async function testBrowser(): Promise<Browser> {
  if (!browser) browser = await chromium.launch({ executablePath: process.env.H2F_CHROMIUM, headless: true, args: ['--hide-scrollbars', '--font-render-hinting=none'] });
  return browser;
}
export async function closeTestBrowser() { await browser?.close(); browser = null; }

let fontsCssCache = '';
/**
 * Тот же fonts.css, но файлы шрифтов встроены data-URL: страница из setContent (about:blank)
 * не может загружать file://, и без этого измерения шли бы запасным шрифтом.
 */
export function fontsCss(): string {
  if (!fontsCssCache) {
    fontsCssCache = fs.readFileSync(path.join(BLOGS, 'fonts.css'), 'utf8').replace(/url\("Fonts\/([^"]+)"\)/g, (_m, f: string) => `url("data:font/ttf;base64,${fs.readFileSync(path.join(BLOGS, 'Fonts', f)).toString('base64')}")`);
  }
  return fontsCssCache;
}

/** Принудительная загрузка всех @font-face страницы (document.fonts.ready не загружает неиспользованные). */
const loadAllFonts = () => Promise.all(Array.from(document.fonts).map((f) => f.load().catch(() => null))).then((l) => l.filter((f) => f && f.status === 'loaded').length);

const lineKey = (items: Array<{ ch: string; size: number; font: string; ls: number }>) => items.map((i) => `${i.ch}\u0001${+i.size.toFixed(4)}\u0001${i.font}\u0001${+i.ls.toFixed(4)}`).join('\u0002');

/**
 * Ширины строк текста, измеренные в Chromium теми же файлами шрифтов, — реалистичные
 * метрики для модели (вместо условных 0.55em). Ключ — шрифт Figma (family|style).
 */
export async function measureLines(snaps: RouteSnapshot[], figmaFont: (reqKey: string) => { family: string; style: string }): Promise<Map<string, number>> {
  const lines = new Map<string, Array<{ ch: string; size: number; font: string; ls: number }>>();
  const visit = (n: RouteSnapshot['children'][number]) => {
    if (n.kind === 'text') {
      let pos = 0;
      for (const line of n.text.split('\n')) {
        const items = Array.from({ length: line.length }, (_, i) => { const r = n.runs.find((x) => pos + i >= x.start && pos + i < x.end)!; const f = figmaFont(r.font); return { ch: line[i], size: r.size, font: f.family + '|' + f.style, ls: r.letterSpacing }; });
        lines.set(lineKey(items), items);
        pos += line.length + 1;
      }
    }
    if (n.kind === 'frame') n.children.forEach(visit);
  };
  snaps.forEach((s) => s.children.forEach(visit));
  const fontOf = (f: string) => { const [family, style] = f.split('|'); return { family, weight: styleWeight(style), italic: styleItalic(style) }; };
  const b = await testBrowser();
  const page = await b.newPage();
  await page.setContent(`<html><head><style>${fontsCss()}</style></head><body></body></html>`);
  const loaded = await page.evaluate(loadAllFonts);
  if (loaded < 10) throw new Error('шрифты для измерения не загрузились: ' + loaded);
  const entries = [...lines.entries()].map(([k, items]) => ({ k, items: items.map((i) => ({ ...i, ...fontOf(i.font) })) }));
  const res = await page.evaluate(async (entries) => {
    await document.fonts.ready;
    const out: Record<string, number> = {};
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:0;top:0;white-space:pre';
    document.body.appendChild(host);
    for (const e of entries) {
      host.innerHTML = e.items.map((i) => `<span style="font-family:'${i.family}';font-weight:${i.weight};font-style:${i.italic ? 'italic' : 'normal'};font-size:${i.size}px;letter-spacing:${i.ls}px">${i.ch.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>`).join('');
      out[e.k] = host.getBoundingClientRect().width;
    }
    return out;
  }, entries);
  await page.close();
  return new Map(Object.entries(res));
}

export interface BuildResult {
  mock: ReturnType<typeof createFigmaMock>;
  messages: CodeToUi[];
  done?: Extract<CodeToUi, { type: 'done' }>;
  aborted?: Extract<CodeToUi, { type: 'aborted' }>;
  error?: Extract<CodeToUi, { type: 'error' }>;
  fonts: FontCheckResult[];
  stoppedBeforeCanvas?: boolean;
}

/** Создаёт (или переиспользует) модель Figma с загруженным code.js. */
export function newMock(opts: Partial<MockOptions> = {}) {
  const mock = createFigmaMock({ fonts: FIXTURE_FONTS, ...opts });
  mock.run(fs.readFileSync(path.join(ROOT, 'plugin', 'dist', 'code.js'), 'utf8'));
  // UI отвечает на tick немедленно (как настоящий ui.ts)
  mock.onUi((m) => { const x = m as CodeToUi; if (x.type === 'tick') void mock.send({ type: 'tock', n: x.n }); });
  return mock;
}

function waitMsg<T extends CodeToUi['type']>(mock: ReturnType<typeof createFigmaMock>, types: T[], jobId?: string): Promise<Extract<CodeToUi, { type: T }>> {
  return new Promise((res) => {
    const f = (m: unknown) => {
      const x = m as CodeToUi;
      if (!types.includes(x.type as T)) return;
      if (jobId && 'jobId' in x && x.jobId && x.jobId !== jobId) return;
      done = true;
      res(x as Extract<CodeToUi, { type: T }>);
    };
    let done = false;
    mock.onUi((m) => { if (!done) f(m); });
  });
}

export interface BuildOptions {
  mode?: 'missing' | 'copy' | 'update';
  columns?: number;
  viewportMode?: boolean;
  substitutions?: Record<string, string>;
  cancelAfterRoute?: number;
  measure?: boolean;
  textScale?: number;
}

/** Повторяет поток ui.ts create(): шрифты до мутации → план → ассеты → страницы → фиксация. */
export async function buildInMock(mock: ReturnType<typeof createFigmaMock>, src: { doc: ImportDocument; snapshot: (k: string) => Promise<RouteSnapshot>; asset: (id: string) => Promise<Uint8Array> }, routes: string[], o: BuildOptions = {}): Promise<BuildResult> {
  const messages: CodeToUi[] = [];
  mock.onUi((m) => messages.push(m as CodeToUi));
  const jobId = 'test' + Math.random().toString(36).slice(2, 8);
  const snaps = new Map<string, RouteSnapshot>();
  const used = new Set<string>();
  for (const k of routes) { const s = await src.snapshot(k); snaps.set(k, s); s.fonts.forEach((f) => used.add(f)); }
  const reqs = src.doc.fonts.filter((f) => used.has(f.key));
  const fr = waitMsg(mock, ['fonts-result']);
  await mock.send({ type: 'fonts-check', id: 1, fonts: reqs, substitutions: o.substitutions });
  const fonts = (await fr).results;
  const res: BuildResult = { mock, messages, fonts };
  if (fonts.some((f) => !f.found)) { res.stoppedBeforeCanvas = true; res.error = { type: 'error', message: 'нет шрифтов: ' + fonts.filter((f) => !f.found).map((f) => f.key).join(', ') }; return res; }
  if (o.measure !== false) {
    const byKey = new Map(fonts.map((f) => [f.key, f.found!]));
    const widths = await measureLines([...snaps.values()], (k) => byKey.get(k) ?? { family: 'Inter', style: 'Regular' });
    const k = o.textScale ?? 1;
    mock.setTextWidth((items) => {
      const key = lineKey(items.map((i) => ({ ch: i.ch, size: i.size, font: i.font.family + '|' + i.font.style, ls: i.letterSpacing })));
      const w = widths.get(key);
      return (w ?? items.reduce((a, it) => a + it.size * 0.55 + it.letterSpacing, 0)) * k;
    });
  }
  const planP = waitMsg(mock, ['plan', 'error'], jobId);
  await mock.send({
    type: 'begin', jobId, project: src.doc.projectKey, projectLabel: src.doc.sourceName, source: src.doc.sourceHash.slice(0, 16), mode: o.mode ?? 'missing',
    routes: routes.map((k) => { const s = snaps.get(k)!; return { key: k, label: s.label, width: s.width, height: s.height, viewportHeight: s.viewport.height, fixed: s.fixedCount }; }),
    columns: o.columns ?? 4, fonts: fonts.map((f) => ({ key: f.key, family: f.found!.family, style: f.found!.style, wght: f.found!.wght })), viewportMode: !!o.viewportMode,
  });
  const plan = await planP;
  if (plan.type === 'error') { res.error = plan; return res; }
  const sent = new Set<string>();
  for (let i = 0; i < plan.build.length; i++) {
    const s = snaps.get(plan.build[i])!;
    for (const a of s.assets) {
      if (sent.has(a)) continue;
      sent.add(a);
      const info = src.doc.assets.find((x) => x.id === a);
      const bytes = await src.asset(a);
      const ok = waitMsg(mock, ['asset-ok', 'asset-error'], jobId);
      await mock.send(info?.kind === 'svg' ? { type: 'asset', jobId, id: a, kind: 'svg', text: Buffer.from(bytes).toString('utf8') } : { type: 'asset', jobId, id: a, kind: 'image', bytes });
      await ok;
    }
    if (o.cancelAfterRoute !== undefined && i === o.cancelAfterRoute) {
      // отмена во время сборки следующей страницы
      const p = waitMsg(mock, ['route-done', 'aborted', 'error'], jobId);
      const sendP = mock.send({ type: 'route', jobId, snapshot: s, index: i });
      await mock.send({ type: 'cancel', jobId });
      await sendP;
      const r = await p;
      if (r.type === 'aborted') { res.aborted = r; return res; }
      continue;
    }
    const p = waitMsg(mock, ['route-done', 'aborted', 'error'], jobId);
    await mock.send({ type: 'route', jobId, snapshot: s, index: i });
    const r = await p;
    if (r.type === 'aborted') { res.aborted = r; const e = messages.find((m) => m.type === 'error') as BuildResult['error']; res.error = e; return res; }
    if (r.type === 'error') { res.error = r; return res; }
  }
  const d = waitMsg(mock, ['done'], jobId);
  await mock.send({ type: 'commit', jobId });
  res.done = await d;
  return res;
}

export function processorSource(t: TP, id: string, doc: ImportDocument) {
  return {
    doc,
    snapshot: (k: string) => snapshot(t, id, k),
    asset: async (a: string) => new Uint8Array(await (await t.api(`/api/jobs/${id}/assets/${a}`)).arrayBuffer()),
  };
}

export async function verifyInMock(mock: ReturnType<typeof createFigmaMock>) {
  const p = waitMsg(mock, ['verify-result']);
  await mock.send({ type: 'verify' });
  return (await p).report;
}

/** PNG-рендер HTML в Chromium (для экспорта модели и реконструкции). */
export async function renderHtml(html: string, width: number, height: number): Promise<Uint8Array> {
  const b = await testBrowser();
  const page = await b.newPage({ viewport: { width: Math.ceil(width), height: Math.min(16000, Math.ceil(height)) } });
  await page.setContent(html.replace('<!--FONTS-->', `<style>${fontsCss()}</style>`), { waitUntil: 'load' });
  await page.evaluate(loadAllFonts);
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ fullPage: true, clip: { x: 0, y: 0, width: Math.ceil(width), height: Math.ceil(height) } });
  await page.close();
  return new Uint8Array(png);
}

export function reportsDir() { const d = path.join(ROOT, 'reports'); fs.mkdirSync(d, { recursive: true }); return d; }
export function writeReport(name: string, data: unknown) { fs.writeFileSync(path.join(reportsDir(), name), JSON.stringify(data, null, 2) + '\n'); }
