/*
 * Задания: загрузка → распаковка → анализ (обход маршрутов) → захват выбранных
 * страниц → итоговые данные для плагина. Каждый визит страницы — новый
 * изолированный browser context (свежее состояние из профиля): посещение главы
 * не меняет «историю чтения» на главной в других снимках.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { BrowserContext, Page } from 'playwright-core';
import { classifyHref, extractHashLiterals, routeDepth, routeFileId, routeGroup, routeKey, routeShape, urlFromKey } from '../../shared/routes';
import { DEFAULT_PROFILE, GENERATOR, GENERATOR_VERSION, SCHEMA_VERSION, type CaptureProfile, type Diagnostic, type FontRequirement, type HoverInfo, type ImportDocument, type RouteInfo, type RouteSnapshot } from '../../shared/schema';
import { AssetStore } from './assets';
import { call, capturePage, getBrowser, inject, newContext, waitAfterNavigation } from './browser';
import type { Config } from './config';
import { finalizeRoute } from './finalize';
import { hoverPreferFor, loadAdapters, matchAdapter, storageHints, type Adapter, type StorageHint } from './profiles';
import { Renderer } from './render';
import type { SiteServer } from './site';
import { extractZip, ZipError } from './zip';

export type JobState = 'analyzing' | 'ready' | 'capturing' | 'captured' | 'error' | 'cancelled';

export class UserError extends Error {
  constructor(message: string, public action: string, public code = 'USER') { super(message); }
}

export interface JobOptions {
  profile?: Partial<CaptureProfile>;
  entry?: string;
  extraRoutes?: string[];
  useAdapter?: boolean;
  routeSelector?: string | null;
  maxRoutes?: number;
  maxDepth?: number;
}

interface Progress { stage: string; done: number; total: number; message: string }

export interface CaptureRequest {
  routes: string[];
  hover?: Record<string, 'auto' | 'none' | number>;
  prune?: boolean;
}

const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');

function listHtml(dir: string, max = 400): string[] {
  const out: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 6 || out.length >= max) return;
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      const st = fs.statSync(p);
      if (st.isDirectory()) { if (!/^(node_modules|\.git|__MACOSX)$/.test(f)) walk(p, depth + 1); }
      else if (/\.html?$/i.test(f)) out.push(path.relative(dir, p).split(path.sep).join('/'));
    }
  };
  walk(dir, 0);
  return out.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
}

function chooseEntry(files: string[]): string | null {
  if (!files.length) return null;
  const idx = files.find((f) => /^index\.html?$/i.test(f));
  if (idx) return idx;
  const nested = files.filter((f) => /(^|\/)index\.html?$/i.test(f)).sort((a, b) => a.split('/').length - b.split('/').length);
  if (nested.length) return nested[0];
  return files[0];
}

export class Job {
  id = crypto.randomBytes(9).toString('hex').replace(/[^a-z0-9]/g, '');
  dir: string;
  siteDir: string;
  state: JobState = 'analyzing';
  error: { message: string; action: string } | null = null;
  progress: Progress = { stage: 'upload', done: 0, total: 1, message: 'Файл получен' };
  createdAt = new Date().toISOString();
  updatedAt = Date.now();
  sourceName: string;
  sourceHash = '';
  entries: string[] = [];
  entry = '';
  projectKey = '';
  adapter: Adapter | null = null;
  profile: CaptureProfile = { ...DEFAULT_PROFILE };
  routeSelector: string | null = null;
  routes: RouteInfo[] = [];
  storage: StorageHint[] = [];
  diagnostics: Diagnostic[] = [];
  fontsPreview: string[] = [];
  fonts = new Map<string, FontRequirement>();
  snapshots = new Map<string, { file: string; height: number; hover: HoverInfo; fonts: string[]; assets: string[] }>();
  store: AssetStore;
  cancelled = false;
  contexts = new Set<BrowserContext>();
  private sources: string[] = [];
  rasterCache = new Map<string, { id: string; kind: 'image' | 'svg'; box?: [number, number, number, number]; raster?: boolean }>();
  extraRoutes: string[] = [];
  options: JobOptions = {};

  constructor(private mgr: JobManager, name: string) {
    this.dir = path.join(mgr.jobsDir, this.id);
    this.siteDir = path.join(this.dir, 'site');
    fs.mkdirSync(this.siteDir, { recursive: true });
    for (const d of ['routes', 'thumbs', 'shots', 'verify']) fs.mkdirSync(path.join(this.dir, d), { recursive: true });
    this.sourceName = name.replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 120) || 'project';
    this.store = new AssetStore(path.join(this.dir, 'assets'), { maxAssets: mgr.cfg.limits.maxAssetsPerJob, maxTotalBytes: mgr.cfg.limits.maxAssetBytesPerJob });
  }

  get prefix() { return this.mgr.site.prefix(this.id); }
  private set(p: Partial<Progress>) { this.progress = { ...this.progress, ...p }; this.updatedAt = Date.now(); }
  private diag(d: Diagnostic) {
    const same = this.diagnostics.find((x) => x.code === d.code && x.message === d.message && x.route === d.route);
    if (same) same.count = (same.count ?? 1) + 1; else this.diagnostics.push(d);
  }

  checkCancel() { if (this.cancelled) throw new UserError('Операция отменена', 'Можно запустить анализ заново.', 'CANCELLED'); }

  async cancel() {
    this.cancelled = true;
    for (const c of this.contexts) await c.close().catch(() => undefined);
    this.contexts.clear();
  }

  // ---------------- загрузка и распаковка ----------------

  unpack(buf: Buffer) {
    this.sourceHash = sha(buf);
    const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 3 || buf[2] === 5);
    const head = buf.subarray(0, 2048).toString('utf8').trimStart().toLowerCase();
    if (isZip) {
      this.set({ stage: 'unpack', message: 'Распаковываю ZIP' });
      const l = this.mgr.cfg.limits;
      const rep = extractZip(buf, this.siteDir, { maxEntries: l.maxZipEntries, maxFileBytes: l.maxFileBytes, maxTotalBytes: l.maxZipTotalBytes, maxRatio: 250 });
      for (const s of rep.skipped.slice(0, 20)) this.diag({ level: 'warn', code: 'zip-skip', message: `Файл из архива пропущен (${s.reason}): ${s.name}` });
    } else if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<') || /\.html?$/i.test(this.sourceName)) {
      const name = /\.html?$/i.test(this.sourceName) ? this.sourceName : 'index.html';
      fs.writeFileSync(path.join(this.siteDir, name), buf);
    } else {
      throw new UserError('Файл не похож на HTML или ZIP.', 'Выберите файл .html/.htm или ZIP-архив с HTML, CSS, JS и ресурсами.', 'FORMAT');
    }
    this.entries = listHtml(this.siteDir);
    if (!this.entries.length) throw new UserError('В архиве не найдено ни одного HTML-файла.', 'Добавьте в ZIP файл index.html (или другой .html) и загрузите снова.', 'NO_HTML');
  }

  private readSources() {
    const out: string[] = [];
    let total = 0;
    const entryText = fs.readFileSync(path.join(this.siteDir, this.entry), 'utf8');
    out.push(entryText);
    total += entryText.length;
    const walk = (d: string) => {
      for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (/\.(m?js)$/i.test(f) && total < 8_000_000) { const t = fs.readFileSync(p, 'utf8'); out.push(t); total += t.length; }
      }
    };
    walk(this.siteDir);
    this.sources = out;
  }

  // ---------------- анализ ----------------

  async analyze(opts: JobOptions) {
    this.options = opts;
    this.state = 'analyzing';
    this.error = null;
    this.cancelled = false;
    try {
      this.entry = opts.entry && this.entries.includes(opts.entry) ? opts.entry : chooseEntry(this.entries)!;
      this.readSources();
      this.projectKey = sha(this.sourceName.replace(/\.(zip|html?)$/i, '').toLowerCase() + '|' + this.entry).slice(0, 16);
      this.adapter = opts.useAdapter === false ? null : matchAdapter(this.mgr.adapters, this.sources[0], this.sourceHash);
      this.profile = { ...DEFAULT_PROFILE, ...(this.adapter?.profile ?? {}), ...(opts.profile ?? {}) } as CaptureProfile;
      this.profile.storage = { ...(this.adapter?.profile.storage ?? {}), ...(opts.profile?.storage ?? {}) };
      if (this.adapter) { this.profile.adapterId = this.adapter.id; this.diag({ level: 'info', code: 'adapter', message: `Применён профиль проекта: ${this.adapter.label}` }); }
      this.routeSelector = opts.routeSelector !== undefined ? opts.routeSelector : this.adapter?.routeSelector ?? null;
      this.extraRoutes = [...(this.adapter?.extraRoutes ?? []), ...(opts.extraRoutes ?? [])];
      this.mgr.site.mount(this.id, { dir: this.siteDir, spaFallback: this.profile.spaFallback, entry: this.entry });
      await this.discover(opts);
      this.storage = storageHints(this.storageKeys, this.sources);
      this.state = 'ready';
      const ok = this.routes.filter((r) => r.status === 'ok').length;
      this.set({ stage: 'ready', done: 1, total: 1, message: `Найдено страниц: ${ok}` });
    } catch (e) {
      this.fail(e);
    }
  }

  private storageKeys: string[] = [];

  fail(e: unknown) {
    if (this.cancelled) { this.state = 'cancelled'; this.error = { message: 'Операция отменена.', action: 'Нажмите «Анализировать» ещё раз, когда будете готовы.' }; return; }
    this.state = 'error';
    if (e instanceof UserError) this.error = { message: e.message, action: e.action };
    else if (e instanceof ZipError) this.error = { message: e.message, action: 'Проверьте архив: распакуйте его на компьютере и упакуйте заново стандартным ZIP без пароля.' };
    else if ((e as { code?: string }).code === 'NO_BROWSER') this.error = { message: 'Обработчик не нашёл браузер Chromium/Edge/Chrome.', action: 'Установите Microsoft Edge или Google Chrome, либо запустите «install-browser.cmd» из папки обработчика.' };
    else this.error = { message: 'Внутренняя ошибка обработчика: ' + String((e as Error)?.message ?? e).slice(0, 300), action: 'Повторите попытку. Если ошибка повторяется — скачайте отчёт и приложите его к сообщению об ошибке.' };
    this.set({ stage: 'error', message: this.error.message });
  }

  private async visit(url: string, extra: { selector?: string | null } = {}) {
    const { browser } = await getBrowser();
    const rec = { storageKeys: new Set<string>(), external: new Set<string>(), failed: new Map<string, string>() };
    const ctx = await newContext(browser, { profile: this.profile, siteOrigin: this.mgr.site.origin() + '/', injectCss: this.injectCss(), record: rec });
    this.contexts.add(ctx);
    try {
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
      const resp = await page.goto(url, { waitUntil: 'load', timeout: this.mgr.cfg.limits.routeTimeoutMs }).catch((e) => { throw new Error('страница не открылась: ' + String(e.message).split('\n')[0]); });
      if (resp && resp.status() >= 400) return { error: `HTTP ${resp.status()}` };
      await waitAfterNavigation(page, 8000);
      const key = await inject(page);
      await call(page, key, 'settle', { timeoutMs: 6000 });
      const finalUrl = page.url();
      const links = await call<{ links: Array<{ href: string; text: string; download: boolean }>; ids: string[] }>(page, key, 'links', this.profile.exclude);
      const fp = await call<{ fp: string; textLength: number; heading: string }>(page, key, 'fingerprint', this.profile.exclude);
      let selected: Array<{ href: string; text: string }> | null = null;
      if (extra.selector) {
        selected = await page.evaluate(({ sel, k }) => {
          try {
            const api = (window as unknown as Record<string, { linkLabel?: (a: Element) => string }>)[k];
            return Array.from(document.querySelectorAll(sel)).map((a) => ({ href: a.getAttribute('href') ?? '', text: (api.linkLabel ? api.linkLabel(a) : (a.textContent ?? '')).replace(/\s+/g, ' ').trim().slice(0, 80) }));
          } catch { return null; }
        }, { sel: extra.selector, k: key });
      }
      const keys = await page.evaluate(() => [...((window as unknown as { __h2fKeys?: Set<string> }).__h2fKeys ?? [])]).catch(() => []);
      const fonts = await page.evaluate(() => {
        const s = new Set<string>();
        for (const el of Array.from(document.querySelectorAll('body *')).slice(0, 5000)) {
          if (!Array.from(el.childNodes).some((n) => n.nodeType === 3 && /\S/.test(n.textContent ?? ''))) continue;
          const cs = getComputedStyle(el);
          if (cs.display === 'none') continue;
          s.add(`${cs.fontFamily.split(',')[0].replace(/["']/g, '').trim()} ${cs.fontWeight}${cs.fontStyle.startsWith('italic') ? ' italic' : ''}`);
        }
        return [...s];
      });
      const title = await page.title();
      const thumb = await page.screenshot({ type: 'jpeg', quality: 60, timeout: 20000 }).catch(() => null);
      return { finalUrl, links: links.links, ids: links.ids, fp, selected, keys, fonts, title, thumb, errors: errors.slice(0, 5), failed: [...rec.failed] };
    } finally {
      this.contexts.delete(ctx);
      await ctx.close().catch(() => undefined);
    }
  }

  injectCss(): Array<{ url: string }> {
    return (this.profile.injectCss ?? []).map((p) => ({ url: /^https?:/.test(p) ? p : this.prefix + p.replace(/^\/+/, '') }));
  }

  private async discover(opts: JobOptions) {
    const L = this.mgr.cfg.limits;
    const maxRoutes = Math.min(opts.maxRoutes ?? L.maxRoutes, 400);
    const maxDepth = Math.min(opts.maxDepth ?? L.maxDepth, 8);
    const deadline = Date.now() + L.discoveryTimeoutMs;
    const base = this.prefix;
    const routes = new Map<string, RouteInfo>();
    const fpOwner = new Map<string, string>();
    const shapes = new Map<string, number>();
    const linkText = new Map<string, string>();
    type Item = { key: string; url: string; depth: number; source: RouteInfo['source']; parentFp?: string };
    const queue: Item[] = [];
    const seen = new Set<string>();
    const push = (it: Item, label?: string) => {
      if (seen.has(it.key)) return;
      seen.add(it.key);
      if (label && !linkText.has(it.key)) linkText.set(it.key, label);
      queue.push(it);
    };
    const entryUrl = base + this.entry.split('/').map(encodeURIComponent).join('/');
    push({ key: routeKey(entryUrl, base), url: entryUrl, depth: 0, source: 'entry' }, 'Главная');
    for (const f of this.entries) if (f !== this.entry) { const u = base + f.split('/').map(encodeURIComponent).join('/'); push({ key: routeKey(u, base), url: u, depth: 0, source: 'file' }); }
    for (const r of this.extraRoutes) {
      const u = /^https?:/.test(r) ? r : r.startsWith('#') ? entryUrl + r : base + r.replace(/^\/+/, '');
      try { push({ key: routeKey(u, base), url: u, depth: 0, source: 'manual' }); } catch { this.diag({ level: 'warn', code: 'manual-route', message: `Неверный адрес маршрута: ${r}` }); }
    }
    let probeFp: string | null = null;
    let codeAdded = false;
    let selectorMode = false;
    const indexKeys = new Set<string>();
    let processed = 0;
    const active = new Set<Promise<void>>();
    const okCount = () => [...routes.values()].filter((r) => r.status === 'ok').length;
    const handle = async (it: Item) => {
      this.set({ stage: 'discover', done: processed, total: processed + queue.length + active.size, message: `Проверяю ${it.key}` });
      const shape = routeShape(it.key);
      const nShape = (shapes.get(shape) ?? 0) + 1;
      shapes.set(shape, nShape);
      const info: RouteInfo = { key: it.key, url: it.key, label: linkText.get(it.key) ?? '', title: '', group: routeGroup(it.key), depth: it.depth, source: it.source, status: 'ok' };
      routes.set(it.key, info);
      if (nShape > L.perShapeLimit && it.source !== 'manual') { info.status = 'limit'; info.reason = `однотипных адресов больше ${L.perShapeLimit} (пагинация/календарь)`; return; }
      if (okCount() >= maxRoutes) { info.status = 'limit'; info.reason = `достигнут предел страниц (${maxRoutes})`; return; }
      if (Date.now() > deadline) { info.status = 'limit'; info.reason = 'исчерпано время обхода'; return; }
      let v: Awaited<ReturnType<Job['visit']>>;
      try { v = await this.visit(it.url, { selector: it.source === 'entry' ? this.routeSelector : null }); }
      catch (e) { this.checkCancel(); info.status = 'error'; info.reason = String((e as Error).message).slice(0, 200); return; }
      this.checkCancel();
      if ('error' in v && v.error) { info.status = 'error'; info.reason = v.error; return; }
      const r = v as Exclude<typeof v, { error: string }>;
      for (const k of r.keys ?? []) if (!this.storageKeys.includes(k)) this.storageKeys.push(k);
      for (const f of r.fonts ?? []) if (!this.fontsPreview.includes(f)) this.fontsPreview.push(f);
      for (const [u, why] of r.failed ?? []) if (!/ERR_ABORTED/.test(why)) this.diag({ level: 'warn', code: 'resource-failed', message: `Ресурс не загружен (${why}): ${u.slice(0, 160)}` });
      for (const e of r.errors ?? []) this.diag({ level: 'info', code: 'page-error', message: `Ошибка JavaScript страницы: ${e}`, route: it.key });
      info.title = r.title;
      if (!info.label) info.label = r.fp.heading || r.title || it.key;
      else if (/^[·•–—-]\s*/.test(info.label) && r.fp.heading) {
        // «· пьеса» из вложенного пункта меню + заголовок страницы → «Пьеса · Зал ожидания»
        const kind = info.label.replace(/^[·•–—-]\s*/, '');
        info.label = (kind.charAt(0).toUpperCase() + kind.slice(1)) + ' · ' + r.fp.heading;
      } else if (r.fp.heading && info.label !== r.fp.heading) {
        // текст ссылки-карточки целиком или короткая метка («EN», «2») — по заголовку страницы
        if (info.label.length > 40) info.label = r.fp.heading;
        else if (info.label.length <= 3 || /^\d+$/.test(info.label)) info.label = r.fp.heading + ' · ' + info.label;
      }
      const finalKey = routeKey(r.finalUrl, base);
      if (finalKey !== it.key) {
        info.finalUrl = finalKey;
        const target = routes.get(finalKey);
        if (target && target !== info) { info.status = 'duplicate'; info.duplicateOf = finalKey; info.reason = `перенаправляет на ${finalKey}`; return; }
        info.reason = `адрес после перехода: ${finalKey}`;
      }
      if (it.source === 'code' && probeFp && r.fp.fp === probeFp) { info.status = 'excluded'; info.reason = 'адрес из кода не открывает отдельную страницу (как несуществующий маршрут)'; return; }
      if (it.parentFp && r.fp.fp === it.parentFp && it.source !== 'manual') { info.status = 'anchor'; info.reason = 'не меняет содержимое страницы (якорь)'; return; }
      const owner = fpOwner.get(r.fp.fp);
      if (owner && owner !== it.key) { info.status = 'duplicate'; info.duplicateOf = owner; info.reason = `содержимое совпадает с ${owner}`; return; }
      fpOwner.set(r.fp.fp, it.key);
      if (probeFp && r.fp.fp === probeFp) info.label = `${info.label} (страница «не найдено»)`;
      if (r.thumb) { fs.writeFileSync(path.join(this.dir, 'thumbs', routeFileId(it.key) + '.jpg'), r.thumb); info.thumbnail = true; }
      // кандидаты из ссылок
      const ids = new Set(r.ids);
      const fromSelector = !!r.selected && r.selected.length > 0;
      if (r.selected && !r.selected.length) this.diag({ level: 'warn', code: 'route-selector', message: `Указатель страниц профиля «${this.routeSelector}» не найден — используется обычный обход` });
      if (fromSelector) selectorMode = true;
      // указатель профиля задаёт страницы «по умолчанию», но обход не ограничивается им:
      // ссылки самих страниц продолжают проверяться до пределов глубины/числа/времени
      const list = [...(fromSelector ? r.selected! : []), ...(it.depth >= maxDepth ? [] : r.links)];
      for (const l of list) {
        const c = classifyHref(l.href, r.finalUrl, base, ids, { download: (l as { download?: boolean }).download });
        if (fromSelector && r.selected!.includes(l) && c.key) indexKeys.add(c.key);
        if (c.kind === 'hash-route' || c.kind === 'page') push({ key: c.key!, url: c.url!, depth: it.depth + 1, source: 'link' }, l.text);
        else if (c.kind === 'hash-candidate') push({ key: c.key!, url: c.url!, depth: it.depth + 1, source: 'link', parentFp: r.fp.fp }, l.text);
        else if (c.kind === 'anchor' && !routes.has(c.key!) && !seen.has(c.key!)) { seen.add(c.key!); routes.set(c.key!, { key: c.key!, url: c.key!, label: l.text, title: '', group: routeGroup(it.key), depth: it.depth + 1, source: 'link', status: 'anchor', reason: c.reason }); }
      }
      if (it.source === 'entry' && !fromSelector) {
        // проба несуществующего hash-маршрута — для распознавания 404 и пустых адресов из кода
        const hasHashRoutes = r.links.some((l) => /^#!?\//.test(l.href));
        if (hasHashRoutes) {
          try {
            const pv = await this.visit(it.url.split('#')[0] + '#/__h2f-probe-404__');
            if (!('error' in pv)) probeFp = (pv as { fp: { fp: string } }).fp.fp;
          } catch { /* без пробы */ }
          if (!codeAdded) {
            codeAdded = true;
            for (const lit of this.sources.flatMap((s) => extractHashLiterals(s)).slice(0, 200)) {
              const c = classifyHref(lit, r.finalUrl, base, ids);
              if (c.kind === 'hash-route') push({ key: c.key!, url: c.url!, depth: it.depth + 1, source: 'code' });
            }
          }
        }
      }
    };
    const conc = Math.max(1, Math.min(4, L.concurrency + 1));
    let first = true;
    while (queue.length || active.size) {
      this.checkCancel();
      while (queue.length && active.size < (first ? 1 : conc)) {
        const it = queue.shift()!;
        const p = handle(it).catch((e) => { if (this.cancelled) throw e; this.diag({ level: 'warn', code: 'discover', message: String((e as Error).message).slice(0, 200), route: it.key }); }).finally(() => { active.delete(p); processed++; });
        active.add(p);
      }
      if (active.size) await Promise.race(active);
      first = false;
    }
    // порядок: как обнаружены; дубликаты и якоря после основных
    const discovered = [...routes.values()];
    if (selectorMode) {
      for (const r of discovered) {
        r.suggested = r.source === 'entry' || r.source === 'manual' || indexKeys.has(r.key);
        if (!r.suggested && r.status === 'ok') r.reason = r.reason ?? 'найдена обходом вне указателя страниц профиля';
      }
    }
    const order = (r: RouteInfo) => (r.status === 'ok' ? (r.suggested === false ? 1 : 0) : r.status === 'duplicate' ? 2 : r.status === 'anchor' ? 3 : 4);
    const idx = new Map(discovered.map((r, i) => [r.key, i]));
    this.routes = discovered.sort((a, b) => order(a) - order(b) || idx.get(a.key)! - idx.get(b.key)!);
    for (const r of this.routes) r.depth = r.depth ?? routeDepth(r.key);
  }

  // ---------------- захват ----------------

  async capture(req: CaptureRequest) {
    this.state = 'capturing';
    this.cancelled = false;
    this.error = null;
    const keys = req.routes.filter((k) => this.routes.some((r) => r.key === k));
    if (!keys.length) { this.fail(new UserError('Не выбрано ни одной страницы.', 'Отметьте нужные страницы в списке и повторите.')); return; }
    let done = 0;
    const errors: string[] = [];
    try {
      const { browser } = await getBrowser();
      const conc = Math.max(1, this.mgr.cfg.limits.concurrency);
      const renderers = Array.from({ length: conc }, () => new Renderer(browser, [this.mgr.site.origin() + '/'], this.profile.blockExternal));
      const queue = [...keys];
      const worker = async (w: number) => {
        while (queue.length) {
          this.checkCancel();
          const key = queue.shift()!;
          this.set({ stage: 'capture', done, total: keys.length, message: `Снимаю страницу ${done + 1} из ${keys.length}: ${key}` });
          try {
            await this.captureRoute(key, req.hover?.[key] ?? 'auto', renderers[w], req.prune !== false);
          } catch (e) {
            this.checkCancel();
            const msg = String((e as Error).message).split('\n')[0].slice(0, 240);
            errors.push(`${key}: ${msg}`);
            const r = this.routes.find((x) => x.key === key);
            if (r) { r.captured = false; r.reason = 'ошибка захвата: ' + msg; }
            this.diag({ level: 'error', code: 'capture-failed', message: `Страница не снята: ${msg}`, route: key });
          }
          done++;
          this.set({ done, total: keys.length });
        }
      };
      await Promise.all(renderers.map((_, i) => worker(i)));
      await Promise.all(renderers.map((r) => r.close()));
      this.state = 'captured';
      this.set({ stage: 'captured', done, total: keys.length, message: errors.length ? `Снято страниц: ${keys.length - errors.length} из ${keys.length}` : `Снято страниц: ${keys.length}` });
    } catch (e) {
      this.fail(e);
    }
  }

  async captureRoute(key: string, hoverChoice: 'auto' | 'none' | number, renderer: Renderer, prune: boolean) {
    const info = this.routes.find((r) => r.key === key)!;
    const { browser } = await getBrowser();
    const rec = { storageKeys: new Set<string>(), external: new Set<string>(), failed: new Map<string, string>() };
    const ctx = await newContext(browser, { profile: this.profile, siteOrigin: this.mgr.site.origin() + '/', injectCss: this.injectCss(), record: rec });
    this.contexts.add(ctx);
    try {
      const page: Page = await ctx.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 200)));
      const url = urlFromKey(key, this.prefix);
      await page.goto(url, { waitUntil: 'load', timeout: this.mgr.cfg.limits.routeTimeoutMs });
      await waitAfterNavigation(page, 10000);
      const apiKey = await inject(page);
      const T: Record<string, number> = {};
      let t0 = Date.now();
      const lap = (k: string) => { T[k] = Date.now() - t0; t0 = Date.now(); };
      await call(page, apiKey, 'settle', { timeoutMs: 8000 });
      lap('load');
      const sp = await call<{ steps: number; poses: number; headerRestored: boolean }>(page, apiKey, 'scrollPass', {});
      await call(page, apiKey, 'settle', { timeoutMs: 6000 });
      this.checkCancel();
      // наведение
      let hover: HoverInfo = { active: false, reason: 'Наведение отключено в настройках', candidates: [] };
      if (this.profile.hover && hoverChoice !== 'none') {
        const cands = await call<Array<{ index: number; selector: string; label: string; score: number; box: [number, number, number, number] }>>(page, apiKey, 'hoverCandidates', this.profile.exclude);
        const prefer = hoverPreferFor(this.profile.hoverPrefer, key);
        let pick: number | null = typeof hoverChoice === 'number' ? hoverChoice : cands.length && cands[0].score >= 0.5 ? 0 : null;
        let selector: string | null = null;
        if (hoverChoice === 'auto' && prefer) { if (prefer === 'none') pick = null; else selector = prefer; }
        if (pick !== null && !cands[pick]) pick = null;
        if (hoverChoice === 'auto' && prefer === 'none') hover = { active: false, reason: 'Профиль проекта: страница без позы наведения', candidates: cands };
        else if (pick === null && !selector) hover = { active: false, reason: cands.length ? 'Подходящая карточка не выбрана (эффект слабый)' : 'На странице нет элементов с эффектом наведения', candidates: cands };
        else {
          const pin = await call<{ hit: string; point: [number, number]; label: string } | null>(page, apiKey, 'pin', pick, selector);
          if (pin) {
            await call(page, apiKey, 'settle', { timeoutMs: 3000 });
            hover = { active: true, selector: selector ?? cands[pick!]?.selector, label: pin.label, reason: selector ? 'профиль проекта' : typeof hoverChoice === 'number' ? 'выбрано пользователем' : 'выбрано автоматически', hit: pin.hit, point: pin.point, candidates: cands, chosenIndex: pick ?? undefined };
          } else hover = { active: false, reason: 'Цель наведения не найдена', candidates: cands };
        }
      }
      this.checkCancel();
      lap('settleHover');
      const run = await capturePage(page, apiKey, {
        exclude: this.profile.exclude, maxNodes: this.mgr.cfg.limits.maxNodesPerRoute, maxChars: this.mgr.cfg.limits.maxCharsPerRoute,
        rasterUnsupported: true, svgMode: this.profile.svgMode, cursor: this.profile.cursor && hover.active,
      });
      if (!sp.headerRestored) run.raw.diagnostics.push({ level: 'warn', code: 'header-pose', message: 'После пробной прокрутки шапка/закреплённые элементы не вернулись в исходный вид' });
      for (const e of pageErrors) run.raw.diagnostics.push({ level: 'info', code: 'page-error', message: 'Ошибка JavaScript страницы: ' + e });
      for (const [u, why] of rec.failed) if (!/ERR_ABORTED/.test(why)) this.diag({ level: 'warn', code: 'resource-failed', message: `Ресурс не загружен (${why}): ${u.slice(0, 160)}` });
      lap('capture');
      // эталонный снимок для визуальной проверки (исключённые панели скрыты)
      try {
        if (this.profile.exclude.length) await page.addStyleTag({ content: this.profile.exclude.join(',') + '{visibility:hidden!important}' });
        const shot = await page.screenshot({ type: 'png', fullPage: true, timeout: 60000 });
        fs.writeFileSync(path.join(this.dir, 'shots', routeFileId(key) + '.png'), shot);
      } catch { /* снимок для проверки не обязателен */ }
      lap('shot');
      const fin = await finalizeRoute(run, { routeKey: key, label: info.label, hover, prune }, {
        store: this.store, renderer, page, apiKey, siteOrigin: this.mgr.site.origin() + '/', siteDir: this.siteDir, sitePrefix: this.prefix,
        rasterScale: this.profile.rasterScale, readSiteFile: (u) => this.mgr.site.readUrl(u), fetchExternal: (u) => this.mgr.fetchExternal(u, this.profile.blockExternal),
        cache: this.rasterCache,
      });
      lap('finalize');
      for (const [k, v] of Object.entries(T)) fin.snapshot.stats['ms_' + k] = v;
      const file = path.join(this.dir, 'routes', routeFileId(key) + '.json');
      fs.writeFileSync(file, JSON.stringify(fin.snapshot));
      for (const f of fin.fonts) {
        const have = this.fonts.get(f.key);
        if (have) { have.chars += f.chars; if (!have.routes.includes(key)) have.routes.push(key); }
        else this.fonts.set(f.key, { ...f, routes: [key] });
      }
      for (const d of fin.diagnostics) this.diag(d);
      info.captured = true;
      info.height = fin.snapshot.height;
      info.hoverCandidates = hover.candidates.length;
      info.reason = info.reason?.startsWith('ошибка захвата') ? undefined : info.reason;
      this.snapshots.set(key, { file, height: fin.snapshot.height, hover, fonts: fin.snapshot.fonts, assets: fin.snapshot.assets });
    } finally {
      this.contexts.delete(ctx);
      await ctx.close().catch(() => undefined);
    }
  }

  // ---------------- выдача ----------------

  document(onlyCaptured = true): ImportDocument {
    const routes = this.routes.filter((r) => !onlyCaptured || this.snapshots.has(r.key));
    const used = new Set(routes.flatMap((r) => this.snapshots.get(r.key)?.assets ?? []));
    const fonts = new Set(routes.flatMap((r) => this.snapshots.get(r.key)?.fonts ?? []));
    return {
      schemaVersion: SCHEMA_VERSION, generator: { name: GENERATOR, version: GENERATOR_VERSION }, projectKey: this.projectKey, sourceHash: this.sourceHash,
      sourceName: this.sourceName, entry: this.entry, createdAt: this.createdAt, profile: this.profile, routes,
      fonts: [...this.fonts.values()].filter((f) => fonts.has(f.key)), assets: this.store.all().filter((a) => used.has(a.id)), diagnostics: this.diagnostics,
    };
  }

  snapshot(key: string): RouteSnapshot | null {
    const s = this.snapshots.get(key);
    if (!s) return null;
    return JSON.parse(fs.readFileSync(s.file, 'utf8'));
  }

  status() {
    return {
      id: this.id, state: this.state, error: this.error, progress: this.progress, sourceName: this.sourceName, sourceHash: this.sourceHash, entries: this.entries, entry: this.entry,
      projectKey: this.projectKey, adapter: this.adapter ? { id: this.adapter.id, label: this.adapter.label, notes: this.adapter.notes } : null, profile: this.profile,
      routeSelector: this.routeSelector, routes: this.routes.map((r) => ({ ...r, fileId: routeFileId(r.key), hover: this.snapshots.get(r.key)?.hover })), storage: this.storage,
      diagnostics: this.diagnostics.slice(0, 300), fontsPreview: this.fontsPreview.slice(0, 60), fonts: [...this.fonts.values()], captured: [...this.snapshots.keys()],
    };
  }
}

export class JobManager {
  jobs = new Map<string, Job>();
  jobsDir: string;
  adapters: Adapter[];
  constructor(public cfg: Config, public site: SiteServer, adapterDirs: string[]) {
    this.jobsDir = path.join(cfg.dataDir, 'jobs');
    fs.mkdirSync(this.jobsDir, { recursive: true });
    this.adapters = loadAdapters(adapterDirs);
    this.cleanupOld();
  }

  cleanupOld() {
    const ttl = this.cfg.limits.jobTtlHours * 3600_000;
    for (const d of fs.existsSync(this.jobsDir) ? fs.readdirSync(this.jobsDir) : []) {
      const p = path.join(this.jobsDir, d);
      try { if (Date.now() - fs.statSync(p).mtimeMs > ttl) fs.rmSync(p, { recursive: true, force: true }); } catch { /* */ }
    }
  }

  create(buf: Buffer, name: string): Job {
    const job = new Job(this, name);
    this.jobs.set(job.id, job);
    job.unpack(buf);
    return job;
  }

  get(id: string) { return this.jobs.get(id); }

  async remove(id: string) {
    const j = this.jobs.get(id);
    if (!j) return;
    await j.cancel();
    this.site.unmount(id);
    this.jobs.delete(id);
    fs.rmSync(j.dir, { recursive: true, force: true });
  }

  async fetchExternal(url: string, blocked: boolean): Promise<Buffer | null> {
    if (blocked) return null;
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol) || /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(u.hostname)) return null;
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 15000);
      const r = await fetch(url, { signal: ctl.signal, redirect: 'follow' });
      clearTimeout(t);
      if (!r.ok) return null;
      const len = Number(r.headers.get('content-length') ?? 0);
      if (len > 50 * 1024 * 1024) return null;
      const b = Buffer.from(await r.arrayBuffer());
      return b.length > 50 * 1024 * 1024 ? null : b;
    } catch { return null; }
  }

  tmpDir() { return os.tmpdir(); }
}
