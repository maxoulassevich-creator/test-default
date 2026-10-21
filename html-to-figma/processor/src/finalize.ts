/*
 * Превращение сырого захвата в итоговый RouteSnapshot:
 *  - ресурсы → проверенные ассеты (байты, формат, размеры, дедупликация);
 *  - сложные SVG → растр с расширенной областью; простые → векторная разметка;
 *  - универсальные семейства шрифтов → фактические системные шрифты (CDP);
 *  - масштаб в матрицах переносится в размеры поддерева (оси relativeTransform единичные);
 *  - ожидаемые рамки (expect) для проверки геометрии в Figma;
 *  - валидация модели до отправки в плагин.
 */
import fs from 'node:fs';
import type { Page } from 'playwright-core';
import { aabb, decompose, IDENTITY, multiply, rotationOnly, translate } from '../../shared/matrix';
import { faceFromPostScript } from '../../shared/fonts';
import { fontKey, SCHEMA_VERSION, type AssetInfo, type Diagnostic, type FontRequirement, type FrameIR, type ImageIR, type Mat, type NodeIR, type PaintIR, type RouteSnapshot, type SvgIR, type TextIR } from '../../shared/schema';
import { validateSnapshot } from '../../shared/validate';
import type { AssetRef, RawCapture } from '../../capture/walk';
import { AssetStore, FIGMA_MAX_PX, FIGMA_NATIVE, sniffMime } from './assets';
import type { Renderer } from './render';
import type { CaptureRun } from './browser';

export const CURSOR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="21" viewBox="0 0 14 21"><path d="M1 1 L1 17 L5 13 L8 20 L10.5 19 L7.6 12.3 L13 12.3 Z" fill="#111" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg>';

export interface FinalizeContext {
  store: AssetStore;
  renderer: Renderer;
  page: Page; // страница маршрута (для снимков областей)
  apiKey: string;
  siteOrigin: string;
  siteDir: string;
  sitePrefix: string; // http://127.0.0.1:port/j/<job>/
  rasterScale: number;
  readSiteFile: (url: string) => Buffer | null;
  fetchExternal: (url: string) => Promise<Buffer | null>;
  /** Кэш задания: одинаковые ресурсы/иллюстрации на разных страницах обрабатываются один раз. */
  cache?: Map<string, { id: string; kind: 'image' | 'svg'; box?: [number, number, number, number]; raster?: boolean }>;
}

export interface FinalizeResult { snapshot: RouteSnapshot; fonts: FontRequirement[]; diagnostics: Diagnostic[] }

function fromDataUrl(u: string): Buffer | null {
  const m = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(u);
  if (!m) return null;
  const isB64 = m[2].includes(';base64');
  try { return isB64 ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8'); } catch { return null; }
}

/** Масштабирует размеры и содержимое поддерева (позиции детей, кегли, радиусы, тени). */
export function scaleSubtree(n: NodeIR, sx: number, sy: number) {
  const su = Math.sqrt(Math.abs(sx * sy));
  n.w *= sx; n.h *= sy;
  const scaleEffects = (es: NodeIR['effects']) => es?.forEach((e) => {
    if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') { e.x *= sx; e.y *= sy; e.blur *= su; e.spread *= su; }
    else e.radius *= su;
  });
  scaleEffects(n.effects);
  if ('radius' in n && n.radius) n.radius = n.radius.map((r) => r * su) as [number, number, number, number];
  if ('stroke' in n && n.stroke) n.stroke = { ...n.stroke, weights: n.stroke.weights.map((w) => w * su) as [number, number, number, number], dash: n.stroke.dash?.map((d) => d * su) };
  if (n.kind === 'text') {
    n.lineHeight *= sy;
    for (const r of n.runs) { r.size *= su; r.letterSpacing *= sx; if (r.decorationThickness) r.decorationThickness *= su; }
    if (n.textStroke) n.textStroke = { ...n.textStroke, width: n.textStroke.width * su };
  }
  if (n.kind === 'frame') {
    for (const c of n.children) {
      c.m = [c.m[0], c.m[1], c.m[2], c.m[3], c.m[4] * sx, c.m[5] * sy];
      scaleSubtree(c, sx, sy);
    }
  }
}

/** Нормализация матриц: оси становятся единичными, масштаб переходит в размеры. */
export function normalizeScales(nodes: NodeIR[], diags: Diagnostic[], route: string) {
  const visit = (n: NodeIR) => {
    const d = decompose(n.m);
    const sx = d.scaleX, sy = d.scaleY;
    if (Math.abs(sx - 1) > 1e-5 || Math.abs(sy - 1) > 1e-5 || Math.abs(d.skew) > 1e-5) {
      const uniform = Math.abs(sx - sy) < 1e-3 && Math.abs(d.skew) < 1e-4;
      if (!uniform) {
        if (Math.abs(d.skew) > 1e-4) diags.push({ level: 'warn', code: 'skew', message: 'Наклон (skew) не поддерживается Figma — перенесено без наклона', route, node: n.src });
        else if (Math.abs(d.rotation) > 1e-4) diags.push({ level: 'warn', code: 'nonuniform-scale', message: 'Неравномерный масштаб с поворотом перенесён приближённо', route, node: n.src });
        if (n.kind === 'text' && Math.abs(sx - sy) > 1e-3) diags.push({ level: 'info', code: 'text-stretch', message: 'Растянутый текст перенесён без искажения глифов', route, node: n.src });
      }
      n.m = rotationOnly(n.m);
      if (sy < 0) n.m = [n.m[0], n.m[1], -n.m[2], -n.m[3], n.m[4], n.m[5]];
      scaleSubtree(n, sx, Math.abs(sy));
    }
    if (n.kind === 'frame') n.children.forEach(visit);
  };
  nodes.forEach(visit);
}

/** Удаляет пустые обёртки без собственного вида с единственным ребёнком (перенос складывается точно). */
export function pruneWrappers(nodes: NodeIR[]): number {
  let removed = 0;
  const visit = (list: NodeIR[]): NodeIR[] => list.map((n) => {
    if (n.kind !== 'frame') return n;
    n.children = visit(n.children);
    const plain = !n.fills.length && !n.stroke && !n.effects?.length && !n.clip && (n.opacity === undefined || n.opacity === 1) && !n.blend && !n.scroll && !n.tags?.length && n.visible !== false;
    if (plain && n.children.length === 1 && Math.abs(n.m[0] - 1) < 1e-9 && Math.abs(n.m[3] - 1) < 1e-9 && Math.abs(n.m[1]) < 1e-9 && Math.abs(n.m[2]) < 1e-9) {
      const c = n.children[0];
      c.m = multiply(n.m, c.m);
      removed++;
      return c;
    }
    return n;
  });
  const out = visit(nodes);
  nodes.splice(0, nodes.length, ...out);
  return removed;
}

export function computeExpect(nodes: NodeIR[], parent: Mat = IDENTITY) {
  for (const n of nodes) {
    const c = multiply(parent, n.m);
    const b = aabb(c, n.w, n.h);
    n.expect = [round2(b[0]), round2(b[1]), round2(b[2]), round2(b[3])];
    if (n.kind === 'text') {
      const ax = n.align === 'CENTER' ? n.w / 2 : n.align === 'RIGHT' ? n.w : 0;
      n.anchor = [round2(c[0] * ax + c[4]), round2(c[1] * ax + c[5])];
    }
    if (n.kind === 'frame') computeExpect(n.children, c);
  }
}
const round2 = (v: number) => Math.round(v * 100) / 100;

function hasFilterMarkup(m: string) { return /<filter[\s>]/.test(m); }

export async function finalizeRoute(run: CaptureRun, meta: { routeKey: string; label: string; hover: RouteSnapshot['hover']; prune: boolean }, ctx: FinalizeContext): Promise<FinalizeResult> {
  const raw: RawCapture = run.raw;
  const route = meta.routeKey;
  const diags: Diagnostic[] = raw.diagnostics.map((d) => ({ ...d, route }));
  const stats: Record<string, number> = { ...raw.stats };
  // ---- шрифты: универсальные и системные семейства → то, что браузер реально отрисовал
  type PF = { familyName: string; postScriptName?: string; isCustomFont: boolean; glyphCount: number };
  const named = new Set(Object.values(raw.fonts).filter((f) => f.family && f.source === 'webfont').map((f) => f.family.toLowerCase()));
  const platformOf = (pred: (m: RawCapture['genericMarks'][number]) => boolean): PF[] => {
    const acc = new Map<string, PF>();
    for (const m of raw.genericMarks) {
      if (!pred(m)) continue;
      for (const f of (run.platform[m.mark] ?? []) as PF[]) {
        if (f.isCustomFont || named.has(f.familyName.toLowerCase())) continue;
        const k = f.familyName + '|' + (f.postScriptName ?? '');
        const have = acc.get(k);
        if (have) have.glyphCount += f.glyphCount; else acc.set(k, { ...f });
      }
    }
    return [...acc.values()].sort((a, b) => b.glyphCount - a.glyphCount);
  };
  const keyMap = new Map<string, string>();
  const fonts = new Map<string, FontRequirement>();
  for (const [k, f] of Object.entries(raw.fonts)) {
    let family = f.family, source = f.source as FontRequirement['source'], weight = f.weight, italic = f.italic;
    let synthetic = f.synthetic;
    let pick: PF | undefined;
    if (!family && f.generic) {
      pick = platformOf((m) => m.generic === f.generic)[0];
      family = pick?.familyName ?? '';
      if (!family) { family = f.generic === 'monospace' ? 'Courier New' : f.generic === 'serif' ? 'Times New Roman' : 'Arial'; diags.push({ level: 'warn', code: 'generic-font', message: `Не удалось определить системный шрифт для «${f.generic}»; предполагается ${family}`, route }); }
      else diags.push({ level: 'info', code: 'generic-font', message: `Универсальное семейство «${f.generic}» отрисовано браузером шрифтом ${family}`, route });
      source = 'system';
    } else if (source === 'system') {
      const list = platformOf((m) => !!m.system?.includes(k));
      pick = list.find((x) => x.familyName.toLowerCase() === family.toLowerCase()) ?? list[0];
      if (pick && pick.familyName.toLowerCase() !== family.toLowerCase()) {
        diags.push({ level: 'info', code: 'font-alias', message: `«${family}» в этой системе — псевдоним: браузер отрисовал шрифтом ${pick.familyName}`, route });
        family = pick.familyName;
      }
    }
    if (pick) {
      // начертание, которое браузер подобрал среди установленных (CSS-подбор веса), а не запрошенный вес
      const face = faceFromPostScript(pick.postScriptName);
      if (face) {
        if (f.weight >= 600 && face.weight < 600) synthetic = [...(synthetic ?? []), 'bold'];
        if (f.italic && !face.italic) synthetic = [...(synthetic ?? []), 'italic'];
        weight = face.weight; italic = face.italic;
      }
    }
    const nk = fontKey(family, weight, italic);
    keyMap.set(k, nk);
    const have = fonts.get(nk);
    if (have) { have.chars += f.chars; continue; }
    fonts.set(nk, { key: nk, family, weight, italic, source, variable: f.variable, synthetic, chars: f.chars, sample: f.sample, routes: [route] });
  }
  // ---- ресурсы
  const refMap = new Map<string, { id: string; kind: 'image' | 'svg'; info?: AssetInfo; box?: [number, number, number, number]; raster?: boolean; tilePx?: number }>();
  const failures = new Map<string, string>();
  const putImage = (bytes: Buffer, source: string, note?: string) => ctx.store.put(bytes, 'image', source, note);
  const prepareRaster = async (bytes: Buffer, mime: string, filter?: string): Promise<Buffer> => {
    if (FIGMA_NATIVE.has(mime) && !filter) {
      const info = sniffMime(bytes);
      if (FIGMA_NATIVE.has(info)) {
        const { imageSize } = await import('./assets');
        const sz = imageSize(bytes, info);
        if (sz && sz.width <= FIGMA_MAX_PX && sz.height <= FIGMA_MAX_PX && sz.width > 0) return bytes;
      }
    }
    const t = await ctx.renderer.transcode(bytes, mime, { filter, scale: mime === 'image/svg+xml' ? ctx.rasterScale : 1 });
    return t.png;
  };
  const inlineExternal = async (markup: string): Promise<string> => {
    const re = /href="(https?:[^"]+)"/g;
    const urls = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(markup))) urls.add(m[1]);
    for (const u of urls) {
      const b = u.startsWith(ctx.siteOrigin) ? ctx.readSiteFile(u) : await ctx.fetchExternal(u);
      if (b) markup = markup.split(`href="${u}"`).join(`href="data:${sniffMime(b)};base64,${b.toString('base64')}"`);
    }
    return markup;
  };
  const cache = ctx.cache ?? new Map();
  for (const [ref, a] of Object.entries(raw.assets) as Array<[string, AssetRef]>) {
    const ck = a.kind === 'svg' ? `svg|${a.raster}|${a.w}|${a.h}|${ctx.rasterScale}|${a.markup}` : a.kind === 'url' ? `url|${a.url}|${a.filter ?? ''}` : a.kind === 'bglayer' ? `bg|${a.w}|${a.h}|${JSON.stringify(a.css)}` : a.kind === 'cursor' ? 'cursor' : '';
    const hit = ck ? cache.get(ck) : undefined;
    if (hit) { refMap.set(ref, { ...hit, info: hit.id ? ctx.store.get(hit.id) : undefined }); continue; }
    const remember = () => { const v = refMap.get(ref); if (ck && v) cache.set(ck, { id: v.id, kind: v.kind, box: v.box, raster: v.raster }); };
    try {
      if (a.kind === 'cursor') { const info = ctx.store.put(Buffer.from(CURSOR_SVG), 'svg', 'cursor'); refMap.set(ref, { id: info.id, kind: 'svg', info }); continue; }
      if (a.kind === 'url' || a.kind === 'dataurl') {
        const url = a.kind === 'url' ? a.url : a.data;
        let bytes: Buffer | null = null;
        if (url.startsWith('data:')) bytes = fromDataUrl(url);
        else if (url.startsWith(ctx.siteOrigin)) bytes = ctx.readSiteFile(url);
        else if (/^https?:/.test(url)) bytes = await ctx.fetchExternal(url);
        if (!bytes || !bytes.length) { failures.set(ref, `ресурс недоступен: ${url.slice(0, 140)}`); continue; }
        const mime = sniffMime(bytes);
        if (mime === 'application/octet-stream') { failures.set(ref, `повреждённое или неизвестное изображение: ${url.slice(0, 140)}`); continue; }
        const filter = a.kind === 'url' ? a.filter : undefined;
        const png = await prepareRaster(bytes, mime, filter);
        const info = putImage(png, a.kind === 'url' ? a.url.slice(0, 300) : 'canvas', filter ? 'filter: ' + filter : mime !== sniffMime(png) ? `перекодировано из ${mime}` : undefined);
        refMap.set(ref, { id: info.id, kind: 'image', info });
        continue;
      }
      if (a.kind === 'svg') {
        const markup = await inlineExternal(a.markup);
        if (a.raster) {
          const r = await ctx.renderer.renderSvg(markup, a.w, a.h, { overflow: a.overflowVisible, filters: hasFilterMarkup(markup), scale: ctx.rasterScale });
          if (r.empty) { refMap.set(ref, { id: '', kind: 'image', raster: true }); continue; }
          const info = putImage(r.png, 'inline-svg', 'растр: ' + a.reasons.join(', '));
          refMap.set(ref, { id: info.id, kind: 'image', info, box: [r.x, r.y, r.w, r.h], raster: true });
        } else {
          const info = ctx.store.put(Buffer.from(markup, 'utf8'), 'svg', 'inline-svg');
          refMap.set(ref, { id: info.id, kind: 'svg', info });
        }
        continue;
      }
      if (a.kind === 'bglayer') {
        const r = await ctx.renderer.renderCss(a.css, a.w, a.h, ctx.sitePrefix, Math.min(ctx.rasterScale, 2));
        const info = putImage(r.png, 'css-background', 'растр слоя фона');
        refMap.set(ref, { id: info.id, kind: 'image', info });
        continue;
      }
      if (a.kind === 'shot') {
        await ctx.page.evaluate(({ k, mark }) => (window as unknown as Record<string, { shotIsolation: (m: string, on: boolean) => void }>)[k].shotIsolation(mark, true), { k: ctx.apiKey, mark: a.mark });
        const [x, y, w, h] = a.rect;
        const png = await ctx.page.screenshot({ type: 'png', omitBackground: true, fullPage: true, clip: { x: Math.max(0, x), y: Math.max(0, y), width: Math.max(1, w), height: Math.max(1, h) }, timeout: 30000 });
        await ctx.page.evaluate(({ k, mark }) => (window as unknown as Record<string, { shotIsolation: (m: string, on: boolean) => void }>)[k].shotIsolation(mark, false), { k: ctx.apiKey, mark: a.mark });
        const info = putImage(await prepareRaster(png, 'image/png'), 'element-shot', 'снимок области: ' + a.reason);
        refMap.set(ref, { id: info.id, kind: 'image', info });
      }
    } catch (e) {
      failures.set(ref, `ошибка обработки ресурса: ${String((e as Error).message).slice(0, 160)}`);
    } finally {
      remember();
    }
  }
  for (const [ref, msg] of failures) diags.push({ level: 'warn', code: 'asset-failed', message: msg, route, node: ref });

  // ---- замена ссылок в дереве
  const broken = (n: NodeIR, why: string): NodeIR => ({ kind: 'frame', id: n.id, name: 'Нет ресурса · ' + n.name, src: n.src, m: n.m, w: n.w, h: n.h, fills: [{ type: 'SOLID', color: { r: 0.94, g: 0.94, b: 0.94 }, opacity: 1 }], stroke: { color: { r: 0.75, g: 0.6, b: 0.6 }, opacity: 1, weights: [1, 1, 1, 1], align: 'INSIDE', dash: [4, 4] }, clip: true, children: [], tags: ['broken-asset'], opacity: n.opacity });
  const fixPaints = (ps: PaintIR[] | undefined): PaintIR[] | undefined => {
    if (!ps) return ps;
    const out: PaintIR[] = [];
    for (const p of ps) {
      if (p.type !== 'IMAGE') { out.push(p); continue; }
      const r = refMap.get(p.asset);
      if (!r || !r.id || r.kind !== 'image') continue;
      const np = { ...p, asset: r.id } as PaintIR & { tileCss?: number };
      if (p.scaleMode === 'TILE' && (p as { tileCss?: number }).tileCss && r.info) (np as { scalingFactor?: number }).scalingFactor = ((p as { tileCss?: number }).tileCss!) / r.info.width;
      delete np.tileCss;
      out.push(np);
    }
    return out;
  };
  const fixNode = (n: NodeIR): NodeIR | null => {
    if (n.kind === 'frame' || n.kind === 'rect' || n.kind === 'ellipse') n.fills = fixPaints(n.fills) ?? [];
    if (n.kind === 'text') n.runs = n.runs.map((r) => ({ ...r, font: keyMap.get(r.font) ?? r.font }));
    if (n.kind === 'image') {
      n.fills = fixPaints(n.fills);
      const r = refMap.get(n.asset);
      if (!r || !r.id) return broken(n, 'image');
      n.asset = r.id;
    }
    if (n.kind === 'svg') {
      const r = refMap.get(n.asset);
      if (!r) return broken(n, 'svg');
      if (r.raster) {
        if (!r.id || !r.box) return null; // пустой рисунок
        const [bx, by, bw, bh] = r.box;
        const img: ImageIR = { kind: 'image', id: n.id, name: n.name.replace(/^SVG/, 'Иллюстрация (растр)'), src: n.src, m: multiply(n.m, translate(bx, by)), w: bw, h: bh, asset: r.id, scaleMode: 'FILL', opacity: n.opacity, blend: n.blend, effects: n.effects, tags: [...(n.tags ?? []).filter((t) => t !== 'raster'), 'raster'] };
        if (n.clip && (bx < -0.5 || by < -0.5 || bx + bw > n.w + 0.5 || by + bh > n.h + 0.5)) {
          // svg обрезается своим viewport → оборачиваем в клип-фрейм
          const wrap: FrameIR = { kind: 'frame', id: n.id + 'c', name: n.name, src: n.src, m: n.m, w: n.w, h: n.h, fills: [], clip: true, children: [{ ...img, m: translate(bx, by) }], opacity: n.opacity, blend: n.blend, effects: n.effects };
          img.opacity = undefined; img.blend = undefined; img.effects = undefined;
          return wrap;
        }
        return img;
      }
      (n as SvgIR).asset = r.id;
    }
    if (n.kind === 'frame') n.children = n.children.map(fixNode).filter((c): c is NodeIR => !!c);
    return n;
  };
  const children = raw.children.map(fixNode).filter((c): c is NodeIR => !!c);
  const background = fixPaints(raw.background) ?? [];
  // fixed-дети — последние; пересчитываем количество после фильтрации
  let fixedCount = 0;
  for (let i = children.length - 1; i >= 0 && children[i].scroll === 'fixed'; i--) fixedCount++;
  normalizeScales(children, diags, route);
  if (meta.prune) stats.prunedWrappers = pruneWrappers(children);
  computeExpect(children);
  // ---- сборка и валидация
  const usedAssets = new Set<string>();
  const usedFonts = new Set<string>();
  const collect = (n: NodeIR) => {
    const ps = (n as FrameIR).fills;
    ps?.forEach((p) => { if (p.type === 'IMAGE') usedAssets.add(p.asset); });
    if (n.kind === 'image' || n.kind === 'svg') usedAssets.add(n.asset);
    if (n.kind === 'svg' && n.fallback) usedAssets.add(n.fallback);
    if (n.kind === 'text') n.runs.forEach((r) => usedFonts.add(r.font));
    if (n.kind === 'frame') n.children.forEach(collect);
  };
  children.forEach(collect);
  background.forEach((p) => { if (p.type === 'IMAGE') usedAssets.add(p.asset); });
  const snapshot: RouteSnapshot = {
    schemaVersion: SCHEMA_VERSION, routeKey: route, url: route, title: raw.title, label: meta.label, viewport: raw.viewport, width: raw.width, height: Math.max(1, raw.height),
    background, children, fixedCount, hover: meta.hover, stats, diagnostics: diags, fonts: [...usedFonts], assets: [...usedAssets], capturedAt: new Date().toISOString(),
  };
  const v = validateSnapshot(snapshot, new Set(fonts.keys()), new Set(ctx.store.all().map((a) => a.id)));
  stats.irNodes = v.nodes;
  stats.transformMismatches = raw.geometry.mismatches.length;
  stats.prepShift = raw.geometry.maxShift;
  if (v.issues.length) {
    diags.push({ level: 'error', code: 'ir-invalid', message: `Модель страницы не прошла проверку: ${v.issues.slice(0, 5).map((i) => i.path + ': ' + i.message).join('; ')}`, route, count: v.issues.length });
  }
  for (const f of fonts.values()) if (!usedFonts.has(f.key)) fonts.delete(f.key);
  return { snapshot, fonts: [...fonts.values()], diagnostics: diags };
}

export function writeSnapshot(file: string, s: RouteSnapshot) { fs.writeFileSync(file, JSON.stringify(s)); }
