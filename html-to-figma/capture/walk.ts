/*
 * Основной обход отрисованного DOM.
 *
 * Фаза A (обычное состояние, после settle/hover): снимок вычисленных стилей,
 * осевые рамки getBoundingClientRect (для самопроверки), сериализация SVG,
 * пометка элементов с псевдоэлементами (для CDP DOM.getBoxModel).
 * Фаза B (transforms нейтрализованы, containing block сохранён will-change):
 * неповёрнутые рамки элементов, псевдоэлементов (от обработчика через CDP),
 * позиции символов текста.
 * Фаза C: сборка дерева нод IR с локальными матрицами
 *   L = T(layout.xy − parentLayout.xy) · M_css(origin)
 * и проверка: AABB(cum · box) должен совпасть с getBoundingClientRect фазы A.
 */
import { parseColor } from '../shared/color';
import { CSS_BLEND, isIdentityColorFilter, normalizeRadii, parseFilter, parseGradient, parseInset, parseRadius, parseShadows, shadowsToEffects } from '../shared/css';
import { aabb, composeCssTransform, IDENTITY, invert, multiply, translate } from '../shared/matrix';
import type { BlendModeIR, Diagnostic, EffectIR, FrameIR, ImageIR, Mat, NodeIR, PaintIR, RGBA, ShapeIR, StrokeIR, SvgIR, TextIR } from '../shared/schema';
import { HOVER_ATTR } from './hover';
import { clipsContent, describe, establishesCB, hasTransform, isInlineDisplay, isStackingContext, px, SKIP_TAGS, snapStyle, type StyleSnap } from './style';
import { serializeSvg, type SvgSerialized } from './svg';
import { allFontUses, genericMarks, layoutFlow, measureChars, removeProbe, resolveFont, textShadowOf, textStyle, type FontUse, type InlineItem, type TextNodeOut, type TextStyleInfo } from './text';
import type { RevealPose } from './settle';

export type AssetRef =
  | { kind: 'url'; url: string; filter?: string; purpose: 'img' | 'bg' | 'poster' }
  | { kind: 'svg'; markup: string; w: number; h: number; reasons: string[]; overflowVisible: boolean; raster: boolean; externalImages: string[] }
  | { kind: 'bglayer'; css: Record<string, string>; w: number; h: number }
  | { kind: 'dataurl'; data: string }
  | { kind: 'shot'; rect: [number, number, number, number]; mark: string; reason: string }
  | { kind: 'cursor' };

export interface PseudoBox { before?: number[]; after?: number[]; marker?: number[] }

export interface CaptureOptions {
  exclude: string[];
  maxNodes: number;
  maxChars: number;
  rasterUnsupported: boolean;
  svgMode: 'auto' | 'vector' | 'raster';
  cursor: boolean;
}

interface Box { x: number; y: number; w: number; h: number }

interface Rec {
  id: number;
  el: Element;
  pseudo?: 'before' | 'after' | 'marker';
  s: StyleSnap;
  kind: 'box' | 'inline';
  parent: Rec | null; // ближайший предок-коробка в DOM
  figmaParent: Rec | null;
  order: number;
  endOrder: number;
  aabbA?: Box;
  layout?: Box;
  m?: Mat;
  tfUnsupported?: string[];
  replaced?: string;
  items: InlineItem[];
  children: Rec[];
  inlines: Rec[];
  frags?: Box[];
  texts: TextNodeOut[];
  svg?: SvgSerialized;
  svgContent?: { w: number; h: number };
  sc: boolean;
  fixed: boolean;
  sticky: boolean;
  cb: Rec | null | 'viewport';
  hasText: boolean;
  depth: number;
  hoverCard?: boolean;
  pseudoText?: string;
  textOrder?: number;
}

interface Session {
  opts: CaptureOptions;
  recs: Rec[];
  byEl: Map<Element, Rec>;
  textOrder: Map<Text, number>;
  order: number;
  diags: Map<string, Diagnostic>;
  assets: Map<string, AssetRef>;
  assetKey: Map<string, string>;
  bgSizes: Map<string, { w: number; h: number }>;
  poses: Map<Element, RevealPose>;
  hoverCard: Element | null;
  hoverPoint: [number, number] | null;
  rootRecs: Rec[];
  nodeCount: number;
  limitHit: boolean;
  chars: { chars: number; limitHit: boolean };
  styleSheet: HTMLStyleElement | null;
  neutralSheet: HTMLStyleElement | null;
  geometryShift: number;
  mismatches: Array<{ src: string; dx: number; dy: number; dw: number; dh: number }>;
  stats: Record<string, number>;
  canvasBg: string;
  bodyRecNeeded: boolean;
  shots: number;
}

let S: Session | null = null;

function diag(level: Diagnostic['level'], code: string, message: string, node?: string) {
  if (!S) return;
  const k = code + '|' + message;
  const d = S.diags.get(k);
  if (d) { d.count = (d.count ?? 1) + 1; return; }
  S.diags.set(k, { level, code, message, node, count: 1 });
}

function asset(key: string, ref: AssetRef): string {
  const have = S!.assetKey.get(key);
  if (have) return have;
  const id = 'ref' + S!.assets.size;
  S!.assets.set(id, ref);
  S!.assetKey.set(key, id);
  return id;
}

function composedChildren(el: Element): Node[] {
  if (el.shadowRoot) return Array.from(el.shadowRoot.childNodes);
  if (el.tagName === 'SLOT') {
    const a = (el as HTMLSlotElement).assignedNodes({ flatten: true });
    return a.length ? a : Array.from(el.childNodes);
  }
  return Array.from(el.childNodes);
}

const REPLACED = new Set(['IMG', 'CANVAS', 'VIDEO', 'IFRAME', 'EMBED', 'OBJECT', 'INPUT', 'TEXTAREA', 'SELECT', 'METER', 'PROGRESS']);

function applyPose(el: Element, s: StyleSnap) {
  const p = S!.poses.get(el);
  if (!p) return;
  const now = parseFloat(s.opacity);
  if (parseFloat(p.opacity) > now + 0.01 || (s.visibility === 'hidden' && p.visibility !== 'hidden')) {
    s.opacity = p.opacity;
    s.visibility = p.visibility;
    s.transform = p.transform;
    s.translate = p.translate;
    s.rotate = p.rotate;
    s.scale = p.scale;
    s.filter = p.filter;
    S!.stats.revealPoses = (S!.stats.revealPoses ?? 0) + 1;
  }
}

function pseudoContent(content: string, el: Element): string | null {
  if (!content || content === 'none' || content === 'normal') return null;
  let out = '';
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|attr\(([^)]+)\)|(open-quote|close-quote|no-open-quote|no-close-quote)|counters?\([^)]*\)|url\([^)]*\)|(\S+)/g;
  let m: RegExpExecArray | null;
  let unknown = false;
  while ((m = re.exec(content))) {
    if (m[1] !== undefined || m[2] !== undefined) {
      const raw = (m[1] ?? m[2])!;
      out += raw.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_x, h) => String.fromCodePoint(parseInt(h, 16))).replace(/\\(.)/g, '$1');
    } else if (m[3]) out += el.getAttribute(m[3].trim()) ?? '';
    else if (m[4]) out += m[4] === 'open-quote' ? '«' : m[4] === 'close-quote' ? '»' : '';
    else if (m[0].startsWith('counter')) { unknown = true; }
    else if (m[0].startsWith('url(')) { /* изображение как content — фон псевдоэлемента */ }
    else if (m[5] && m[5] !== '/' ) unknown = true;
  }
  if (unknown) diag('info', 'pseudo-counter', 'Счётчики CSS (counter()) в content псевдоэлементов не вычисляются', describe(el));
  return out;
}

function markerText(li: Element, s: StyleSnap): string {
  const t = s['list-style-type'];
  if (!t || t === 'none') return '';
  let n = 1;
  const parent = li.parentElement;
  if (parent && (parent.tagName === 'OL')) {
    const start = parseInt(parent.getAttribute('start') ?? '1', 10) || 1;
    const items = Array.from(parent.children).filter((c) => getComputedStyle(c).display === 'list-item');
    n = start + Math.max(0, items.indexOf(li));
    const v = li.getAttribute('value');
    if (v) n = parseInt(v, 10) || n;
  }
  const alpha = (k: number) => { let s2 = ''; while (k > 0) { k--; s2 = String.fromCharCode(97 + (k % 26)) + s2; k = Math.floor(k / 26); } return s2; };
  const roman = (k: number) => { const map: Array<[number, string]> = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let r = ''; for (const [v, sym] of map) while (k >= v) { r += sym; k -= v; } return r; };
  switch (t) {
    case 'disc': return '•';
    case 'circle': return '◦';
    case 'square': return '▪';
    case 'decimal': return n + '.';
    case 'decimal-leading-zero': return String(n).padStart(2, '0') + '.';
    case 'lower-alpha': case 'lower-latin': return alpha(n) + '.';
    case 'upper-alpha': case 'upper-latin': return alpha(n).toUpperCase() + '.';
    case 'lower-roman': return roman(n) + '.';
    case 'upper-roman': return roman(n).toUpperCase() + '.';
    default:
      if (/^["']/.test(t)) return t.slice(1, -1);
      return '•';
  }
}

function excludedFn(sel: string[]): (e: Element) => boolean {
  const valid = sel.filter((s) => { try { document.querySelector(s); return true; } catch { return false; } });
  return (e: Element) => valid.some((s) => { try { return !!e.closest(s); } catch { return false; } });
}

// ---------------------------------------------------------------------------
// Фаза A

export interface BeginResult { recs: number; pseudoMarked: number; bgUrls: number; limitHit: boolean }

export async function beginCapture(opts: CaptureOptions, poses: Map<Element, RevealPose>, hover: { card: Element | null; point: [number, number] | null }): Promise<BeginResult> {
  S = {
    opts, recs: [], byEl: new Map(), textOrder: new Map(), order: 0, diags: new Map(), assets: new Map(), assetKey: new Map(), bgSizes: new Map(), poses,
    hoverCard: hover.card, hoverPoint: hover.point, rootRecs: [], nodeCount: 0, limitHit: false, chars: { chars: 0, limitHit: false },
    styleSheet: null, neutralSheet: null, geometryShift: 0, mismatches: [], stats: {}, canvasBg: '', bodyRecNeeded: false, shots: 0,
  };
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  if (scrollY !== 0 || scrollX !== 0) diag('warn', 'scroll-locked', `Страница не вернулась в начало прокрутки (scrollY=${scrollY}); координаты учитывают смещение`);
  // заморозка переходов: дальнейшие изменения стилей не запускают transitions
  S.styleSheet = document.createElement('style');
  S.styleSheet.setAttribute('data-h2f', 'freeze');
  S.styleSheet.textContent = '*,*::before,*::after{transition:none!important;caret-color:transparent!important}';
  document.documentElement.appendChild(S.styleSheet);
  const isExcluded = excludedFn(opts.exclude);
  const html = document.documentElement, body = document.body;
  const htmlCs = getComputedStyle(html), bodyCs = body ? getComputedStyle(body) : htmlCs;
  const htmlBg = parseColor(htmlCs.backgroundColor);
  const htmlHasBg = (htmlBg && htmlBg.a > 0) || htmlCs.backgroundImage !== 'none';
  S.canvasBg = htmlHasBg ? 'html' : 'body';
  if (htmlHasBg && body) {
    const bb = parseColor(bodyCs.backgroundColor);
    S.bodyRecNeeded = (bb && bb.a > 0) || bodyCs.backgroundImage !== 'none';
  }
  if (body) {
    const bs = snapStyle(bodyCs);
    if (bs['box-shadow'] !== 'none' || px(bs['border-top-width']) || px(bs['border-left-width']) || hasTransform(bs) || parseFloat(bs.opacity) < 1 || clipsContent(bs) && false) S.bodyRecNeeded = true;
  }
  let pseudoMarked = 0;
  const visit = (node: Node, parent: Rec | null, formatting: Rec | null, depth: number) => {
    if (S!.nodeCount > opts.maxNodes) { S!.limitHit = true; return; }
    if (node.nodeType === Node.TEXT_NODE) {
      S!.textOrder.set(node as Text, S!.order++);
      if (formatting) formatting.items.push({ kind: 'text', node: node as Text });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (SKIP_TAGS.has(el.tagName) || el.hasAttribute('data-h2f-probe') || el.getAttribute('data-h2f') === 'freeze') return;
    if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'hidden') return;
    if (isExcluded(el)) { S!.stats.excluded = (S!.stats.excluded ?? 0) + 1; return; }
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return;
    const isRootish = el === html || (el === body && !S!.bodyRecNeeded);
    if (el.tagName === 'BR') { if (formatting) formatting.items.push({ kind: 'br' }); return; }
    if (cs.display === 'contents' || isRootish) {
      const withPseudo = el !== html;
      if (withPseudo) addPseudos(el, cs, parent, isRootish ? null : formatting, depth);
      for (const c of composedChildren(el)) visit(c, parent, isRootish ? null : formatting, depth);
      if (withPseudo) addPseudoAfter(el, parent, isRootish ? null : formatting, depth);
      return;
    }
    const s = snapStyle(cs);
    applyPose(el, s);
    const isSvg = el instanceof SVGSVGElement && !(el.parentElement instanceof SVGElement);
    if (el instanceof SVGElement && !isSvg) return; // внутренности svg — в сериализаторе
    const inline = isInlineDisplay(s.display) && !REPLACED.has(el.tagName) && !isSvg;
    const rec: Rec = {
      id: S!.recs.length, el, s, kind: inline ? 'inline' : 'box', parent, figmaParent: null, order: S!.order++, endOrder: 0, items: [], children: [], inlines: [],
      texts: [], sc: false, fixed: s.position === 'fixed', sticky: s.position === 'sticky', cb: null, hasText: false, depth,
      replaced: isSvg ? 'SVG' : REPLACED.has(el.tagName) ? el.tagName : undefined,
    };
    S!.recs.push(rec);
    S!.byEl.set(el, rec);
    S!.nodeCount++;
    const r = el.getBoundingClientRect();
    rec.aabbA = { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
    rec.sc = isStackingContext(s, parent ? parent.s.display : 'block');
    if (S!.hoverCard === el) rec.hoverCard = true;
    if (inline) {
      // inline-элемент: украшения и разрывы сегментов; текст остаётся в контексте formatting
      const hard = px(s['padding-left']) + px(s['padding-right']) + px(s['border-left-width']) + px(s['border-right-width']) + Math.abs(px(s['margin-left'])) + Math.abs(px(s['margin-right'])) > 0.5;
      (formatting ?? parent)?.inlines.push(rec);
      if (formatting) formatting.items.push({ kind: 'inline-start', el, hard });
      addPseudos(el, cs, parent, formatting, depth);
      for (const c of composedChildren(el)) visit(c, parent, formatting, depth + 1);
      addPseudoAfter(el, parent, formatting, depth);
      if (formatting) formatting.items.push({ kind: 'inline-end', el, hard });
      rec.endOrder = S!.order++;
      return;
    }
    if (formatting) formatting.items.push({ kind: 'break' });
    (parent ? parent.children : S!.rootRecs).push(rec);
    if (isSvg) {
      const svg = el as SVGSVGElement;
      const bw = px(s['border-left-width']) + px(s['border-right-width']) + px(s['padding-left']) + px(s['padding-right']);
      const bh = px(s['border-top-width']) + px(s['border-bottom-width']) + px(s['padding-top']) + px(s['padding-bottom']);
      let w = px(s.width), h = px(s.height);
      if (s['box-sizing'] === 'border-box') { w -= bw; h -= bh; }
      if (!(w > 0) || !(h > 0)) { w = Math.max(0, r.width - bw); h = Math.max(0, r.height - bh); }
      rec.svgContent = { w, h };
      try { rec.svg = serializeSvg(svg, w, h); } catch (e) { diag('warn', 'svg-serialize', 'Не удалось сериализовать SVG: ' + String(e).slice(0, 120), describe(el)); }
      rec.endOrder = S!.order++;
      return;
    }
    if (rec.replaced) { rec.endOrder = S!.order++; return; }
    addPseudos(el, cs, rec, rec, depth + 1);
    for (const c of composedChildren(el)) visit(c, rec, rec, depth + 1);
    addPseudoAfter(el, rec, rec, depth + 1);
    rec.endOrder = S!.order++;
  };

  const pseudoRec = (el: Element, which: 'before' | 'after' | 'marker', ps: CSSStyleDeclaration, parent: Rec | null, depth: number): Rec | null => {
    const s = snapStyle(ps);
    const text = which === 'marker' ? markerText(el, snapStyle(getComputedStyle(el))) : pseudoContent(s.content, el);
    if (text === null) return null;
    const rec: Rec = {
      id: S!.recs.length, el, pseudo: which, s, kind: 'box', parent, figmaParent: null, order: S!.order++, endOrder: 0, items: [], children: [], inlines: [], texts: [],
      sc: isStackingContext(s, parent ? parent.s.display : 'block'), fixed: s.position === 'fixed', sticky: s.position === 'sticky', cb: null, hasText: !!text.trim(), depth, pseudoText: text,
    };
    rec.endOrder = rec.order;
    S!.recs.push(rec);
    S!.nodeCount++;
    if (!el.hasAttribute('data-h2f-p')) { el.setAttribute('data-h2f-p', String(S!.byEl.get(el)?.id ?? 'x' + rec.id)); pseudoMarked++; }
    return rec;
  };

  function addPseudos(el: Element, cs: CSSStyleDeclaration, parent: Rec | null, formatting: Rec | null, depth: number) {
    if (cs.display === 'list-item' && cs.listStyleType !== 'none') {
      const m = pseudoRec(el, 'marker', getComputedStyle(el, '::marker'), parent, depth);
      if (m) (parent ? parent.children : S!.rootRecs).push(m);
    }
    const b = getComputedStyle(el, '::before');
    if (b.content !== 'none' && b.content !== 'normal' && b.display !== 'none') {
      const r = pseudoRec(el, 'before', b, parent, depth);
      if (r) { (parent ? parent.children : S!.rootRecs).push(r); if (formatting) formatting.items.push({ kind: 'break' }); }
    }
  }
  function addPseudoAfter(el: Element, parent: Rec | null, formatting: Rec | null, depth: number) {
    const a = getComputedStyle(el, '::after');
    if (a.content !== 'none' && a.content !== 'normal' && a.display !== 'none') {
      const r = pseudoRec(el, 'after', a, parent, depth);
      if (r) { (parent ? parent.children : S!.rootRecs).push(r); if (formatting) formatting.items.push({ kind: 'break' }); }
    }
  }
  visit(html, null, null, 0);

  // CB и признаки
  for (const rec of S.recs) {
    if (rec.s.position === 'absolute' || rec.s.position === 'fixed') {
      const forFixed = rec.s.position === 'fixed';
      let cb: Rec | null | 'viewport' = forFixed ? 'viewport' : null;
      for (let p = rec.pseudo ? S.byEl.get(rec.el) ?? rec.parent : rec.parent; p; p = p.parent) {
        if (p.kind === 'box' && establishesCB(p.s, forFixed)) { cb = p; break; }
      }
      if (rec.pseudo && S.byEl.get(rec.el)?.kind === 'box' && establishesCB(S.byEl.get(rec.el)!.s, forFixed)) cb = S.byEl.get(rec.el)!;
      rec.cb = cb;
      if (forFixed && cb !== 'viewport') rec.fixed = false;
    }
  }
  // натуральные размеры фоновых изображений
  const urls = new Set<string>();
  for (const rec of S.recs) for (const u of bgUrls(rec.s['background-image'])) urls.add(u);
  for (const u of bgUrls(htmlCs.backgroundImage)) urls.add(u);
  if (body) for (const u of bgUrls(bodyCs.backgroundImage)) urls.add(u);
  await Promise.all([...urls].map((u) => new Promise<void>((res) => {
    const img = new Image();
    const done = () => { S!.bgSizes.set(u, { w: img.naturalWidth, h: img.naturalHeight }); res(); };
    img.onload = done; img.onerror = () => { S!.bgSizes.set(u, { w: 0, h: 0 }); res(); };
    img.src = u;
    setTimeout(done, 4000);
  })));
  return { recs: S.recs.length, pseudoMarked, bgUrls: urls.size, limitHit: S.limitHit };
}

function bgUrls(v: string): string[] {
  const out: string[] = [];
  const re = /url\(\s*"((?:[^"\\]|\\.)*)"\s*\)|url\(\s*'([^']*)'\s*\)|url\(\s*([^)"']+)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(v ?? ''))) out.push((m[1] ?? m[2] ?? m[3]).replace(/\\(.)/g, '$1'));
  return out;
}

// ---------------------------------------------------------------------------
// Фаза B

export function setNeutral(on: boolean) {
  if (!S) return;
  if (on) {
    for (const rec of S.recs) if (rec.kind === 'box' && !rec.pseudo && hasTransform(rec.s)) rec.el.setAttribute('data-h2f-tf', '');
    S.neutralSheet = document.createElement('style');
    S.neutralSheet.setAttribute('data-h2f', 'neutral');
    S.neutralSheet.textContent = '[data-h2f-tf]{transform:none!important;translate:none!important;rotate:none!important;scale:none!important;will-change:transform!important}' +
      '*::before,*::after,*::marker{transform:none!important;translate:none!important;rotate:none!important;scale:none!important}';
    document.documentElement.appendChild(S.neutralSheet);
  } else {
    S.neutralSheet?.remove();
    S.neutralSheet = null;
    for (const e of Array.from(document.querySelectorAll('[data-h2f-tf]'))) e.removeAttribute('data-h2f-tf');
  }
}

function quadBox(q: number[] | undefined): Box | undefined {
  if (!q || q.length < 8) return undefined;
  const xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]];
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return { x: x0 + scrollX, y: y0 + scrollY, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}

export function measure(pseudoBoxes: Record<string, PseudoBox>) {
  if (!S) throw new Error('capture not started');
  const byOwnerId = new Map<Element, PseudoBox>();
  for (const el of Array.from(document.querySelectorAll('[data-h2f-p]'))) {
    const pb = pseudoBoxes[el.getAttribute('data-h2f-p')!];
    if (pb) byOwnerId.set(el, pb);
  }
  for (const rec of S.recs) {
    if (rec.pseudo) {
      const pb = byOwnerId.get(rec.el);
      rec.layout = quadBox(pb?.[rec.pseudo]);
      continue;
    }
    const r = rec.el.getBoundingClientRect();
    rec.layout = { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
    if (rec.kind === 'inline') {
      rec.frags = Array.from(rec.el.getClientRects()).map((q) => ({ x: q.left + scrollX, y: q.top + scrollY, w: q.width, h: q.height })).filter((q) => q.w > 0 || q.h > 0);
    }
  }
  // текст
  for (const rec of S.recs) {
    if (rec.kind !== 'box' || rec.pseudo || !rec.items.some((i) => i.kind === 'text')) continue;
    const firstLetter = firstLetterStyle(rec);
    const chars = measureChars(rec.items, rec.el, firstLetter, S.chars, S.opts.maxChars);
    if (!chars.length) continue;
    const s = rec.s;
    const clampN = s['-webkit-line-clamp'] && s['-webkit-line-clamp'] !== 'none' ? parseInt(s['-webkit-line-clamp'], 10) : null;
    const he = rec.el as HTMLElement;
    const ellipsis = s['text-overflow'] === 'ellipsis' && clipsContent(s) && he.scrollWidth > he.clientWidth + 1 && /nowrap|pre/.test(s['white-space'])
      ? { width: Math.max(1, (rec.layout!.w - px(s['padding-left']) - px(s['padding-right']) - px(s['border-left-width']) - px(s['border-right-width']))) } : null;
    const vertical = s['writing-mode'].startsWith('vertical') || s['writing-mode'].startsWith('sideways');
    if (vertical) diag('info', 'vertical-text', 'Вертикальный текст перенесён поворотом строки на 90°', describe(rec.el));
    if (s['text-align'] === 'justify') diag('info', 'justify', 'Выравнивание по ширине перенесено как по левому краю (переносы строк сохранены)', describe(rec.el));
    rec.texts = layoutFlow(chars, { align: s['text-align'], direction: s.direction, clamp: clampN, ellipsis, vertical, name: textName(chars) });
    rec.hasText = rec.texts.length > 0;
    rec.textOrder = S.textOrder.get(chars[0].node!) ?? rec.order;
  }
  if (S.chars.limitHit) diag('warn', 'text-limit', `Достигнут лимит символов на страницу (${S.opts.maxChars}); остальной текст пропущен`);
  removeProbe();
}

function textName(chars: { ch: string }[]): string {
  return chars.slice(0, 60).map((c) => c.ch).join('').replace(/\s+/g, ' ').trim().slice(0, 48) || 'Текст';
}

function firstLetterStyle(rec: Rec): { st: TextStyleInfo; count: number } | null {
  const fl = getComputedStyle(rec.el, '::first-letter');
  const cs = getComputedStyle(rec.el);
  if (fl.fontSize === cs.fontSize && fl.fontFamily === cs.fontFamily && fl.color === cs.color && fl.cssFloat === 'none' && fl.fontWeight === cs.fontWeight) return null;
  // стиль ::first-letter: создаём TextStyleInfo на основе псевдо-стиля
  const base = textStyle(rec.el, rec.el);
  const size = px(fl.fontSize);
  let lh = fl.lineHeight === 'normal' ? size * 1.2 : /^[\d.]+$/.test(fl.lineHeight) ? parseFloat(fl.lineHeight) * size : px(fl.lineHeight);
  if (!(lh > 0)) lh = size * 1.2;
  const st: TextStyleInfo = {
    ...base,
    families: fl.fontFamily.split(',').map((f) => f.trim().replace(/^['"]|['"]$/g, '')),
    size, weight: parseInt(fl.fontWeight, 10) || 400, italic: fl.fontStyle.startsWith('italic'), color: parseColor(fl.color) ?? base.color,
    lineHeight: lh, letterSpacing: fl.letterSpacing === 'normal' ? 0 : px(fl.letterSpacing), transform: fl.textTransform,
  };
  S!.stats.firstLetters = (S!.stats.firstLetters ?? 0) + 1;
  return { st, count: 1 };
}

// ---------------------------------------------------------------------------
// Фаза C: дерево IR

let nodeSerial = 0;
const nid = () => 'n' + (nodeSerial++).toString(36);

function rgbaPaint(c: RGBA, opacityMul = 1): PaintIR | null {
  if (c.a * opacityMul <= 0) return null;
  return { type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: Math.min(1, c.a * opacityMul) };
}

function layerList(v: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of v) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function lenOf(tok: string, ref: number): number {
  tok = tok.trim();
  const calc = /^calc\((.*)\)$/.exec(tok);
  if (calc) {
    let total = 0;
    const re = /([+-]?)\s*([\d.]+)(%|px)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(calc[1]))) total += (m[1] === '-' ? -1 : 1) * (m[3] === '%' ? (parseFloat(m[2]) / 100) * ref : parseFloat(m[2]));
    return total;
  }
  if (tok.endsWith('%')) return (parseFloat(tok) / 100) * ref;
  return parseFloat(tok) || 0;
}

interface BgResult { fills: PaintIR[]; under: ShapeIR[] }

/** Слои фона: цвет, url(), градиенты; неподдерживаемое — растровый слой (точная отрисовка браузером). */
function backgrounds(s: StyleSnap, w: number, h: number, src: string): BgResult {
  const fills: PaintIR[] = [];
  const under: ShapeIR[] = [];
  const bl = parseFloat(s['border-left-width']) || 0, bt = parseFloat(s['border-top-width']) || 0;
  const br = parseFloat(s['border-right-width']) || 0, bb = parseFloat(s['border-bottom-width']) || 0;
  const pl = px(s['padding-left']), pt = px(s['padding-top']), pr = px(s['padding-right']), pb = px(s['padding-bottom']);
  const color = parseColor(s['background-color']);
  if (s['background-color'] && !color) diag('warn', 'color-parse', `Нераспознанный цвет фона: ${s['background-color']}`, src);
  const clipBox = (clip: string) => clip === 'padding-box' ? { x: bl, y: bt, w: w - bl - br, h: h - bt - bb } : clip === 'content-box' ? { x: bl + pl, y: bt + pt, w: w - bl - br - pl - pr, h: h - bt - bb - pt - pb } : { x: 0, y: 0, w, h };
  const clips = layerList(s['background-clip']);
  if (color && color.a > 0) {
    const cb = clipBox(clips[clips.length - 1] ?? 'border-box');
    if (cb.x < 0.5 && cb.y < 0.5 && Math.abs(cb.w - w) < 0.5 && Math.abs(cb.h - h) < 0.5) fills.push(rgbaPaint(color)!);
    else if (cb.w > 0 && cb.h > 0) under.push({ kind: 'rect', id: nid(), name: 'Фон', m: translate(cb.x, cb.y), w: cb.w, h: cb.h, fills: [rgbaPaint(color)!] });
  }
  const img = s['background-image'];
  if (!img || img === 'none') return { fills, under };
  const layers = layerList(img);
  const sizes = layerList(s['background-size']), posX = layerList(s['background-position-x']), posY = layerList(s['background-position-y']);
  const reps = layerList(s['background-repeat']), origins = layerList(s['background-origin']), blends = layerList(s['background-blend-mode']);
  const att = layerList(s['background-attachment']);
  const pick = (arr: string[], i: number) => arr[i % arr.length];
  const top: PaintIR[] = [];
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (layer === 'none') continue;
    if (pick(att, i) === 'fixed') diag('info', 'bg-fixed', 'background-attachment: fixed перенесён как обычный фон', src);
    const origin = pick(origins, i);
    const area = origin === 'border-box' ? { x: 0, y: 0, w, h } : origin === 'content-box' ? { x: bl + pl, y: bt + pt, w: w - bl - br - pl - pr, h: h - bt - bb - pt - pb } : { x: bl, y: bt, w: w - bl - br, h: h - bt - bb };
    const cb = clipBox(pick(clips, i));
    if (area.w <= 0 || area.h <= 0 || cb.w <= 0 || cb.h <= 0) continue;
    const blend = (CSS_BLEND[pick(blends, i)] ?? 'NORMAL') as BlendModeIR;
    const urlM = bgUrls(layer);
    const sizeTok = pick(sizes, i).split(/\s+/);
    const rep = pick(reps, i).split(/\s+/);
    const repX = rep[0], repY = rep[1] ?? (rep[0] === 'repeat-x' ? 'no-repeat' : rep[0] === 'repeat-y' ? 'repeat' : rep[0]);
    const rx = repX === 'repeat-x' ? 'repeat' : repX === 'repeat-y' ? 'no-repeat' : repX;
    const ry = repX === 'repeat-x' ? 'no-repeat' : repX === 'repeat-y' ? 'repeat' : repY;
    // размер плитки
    let natural = { w: area.w, h: area.h };
    let hasNatural = false;
    if (urlM.length === 1 && layer.startsWith('url(')) {
      const n = S!.bgSizes.get(urlM[0]);
      if (n && n.w > 0 && n.h > 0) { natural = n; hasNatural = true; }
    }
    let tw: number, th: number;
    if (sizeTok[0] === 'cover' || sizeTok[0] === 'contain') {
      const k = sizeTok[0] === 'cover' ? Math.max(area.w / natural.w, area.h / natural.h) : Math.min(area.w / natural.w, area.h / natural.h);
      tw = natural.w * k; th = natural.h * k;
    } else {
      const a = sizeTok[0] ?? 'auto', b = sizeTok[1] ?? 'auto';
      tw = a === 'auto' ? NaN : lenOf(a, area.w);
      th = b === 'auto' ? NaN : lenOf(b, area.h);
      if (Number.isNaN(tw) && Number.isNaN(th)) { tw = hasNatural ? natural.w : area.w; th = hasNatural ? natural.h : area.h; }
      else if (Number.isNaN(tw)) tw = hasNatural ? (th * natural.w) / natural.h : area.w;
      else if (Number.isNaN(th)) th = hasNatural ? (tw * natural.h) / natural.w : area.h;
    }
    if (!(tw > 0) || !(th > 0)) continue;
    const ox = area.x + lenOf(pick(posX, i).replace(/^(left|right)\s+/, ''), area.w - tw);
    const oy = area.y + lenOf(pick(posY, i).replace(/^(top|bottom)\s+/, ''), area.h - th);
    const isGradient = /^(repeating-)?(linear|radial|conic)-gradient\(/.test(layer);
    const coversArea = Math.abs(tw - area.w) < 0.5 && Math.abs(th - area.h) < 0.5 && Math.abs(ox - area.x) < 0.5 && Math.abs(oy - area.y) < 0.5;
    if (isGradient && !layer.startsWith('repeating') && (coversArea || (rx === 'no-repeat' && ry === 'no-repeat'))) {
      const g = parseGradient(layer, tw, th);
      if (g.paint && g.paint.type !== 'IMAGE' && g.paint.type !== 'SOLID') {
        if (g.approx.includes('conic') || g.approx.includes('color-interpolation-space') || g.approx.includes('color-hint')) diag('info', 'gradient-approx', 'Градиент перенесён приближённо: ' + g.approx.join(', '), src);
        // градиент задан в плитке [ox, oy, tw, th]; Figma — в нормализованных координатах ноды
        const tileFromNode: Mat = [w / tw, 0, 0, h / th, -ox / tw, -oy / th];
        const paint = { ...g.paint, transform: multiply(g.paint.transform, tileFromNode), blend: blend !== 'NORMAL' ? blend : undefined };
        const tileCoversClip = coversArea || (ox <= cb.x + 0.5 && oy <= cb.y + 0.5 && ox + tw >= cb.x + cb.w - 0.5 && oy + th >= cb.y + cb.h - 0.5);
        if (tileCoversClip && cb.x < 0.5 && cb.y < 0.5 && Math.abs(cb.w - w) < 0.5 && Math.abs(cb.h - h) < 0.5) { top.unshift(paint); continue; }
        // фон ограничен clip-областью или плиткой — отдельный прямоугольник
        const vx0 = Math.max(cb.x, ox), vy0 = Math.max(cb.y, oy), vx1 = Math.min(cb.x + cb.w, ox + tw), vy1 = Math.min(cb.y + cb.h, oy + th);
        if (vx1 - vx0 > 0.1 && vy1 - vy0 > 0.1) {
          const vw = vx1 - vx0, vh = vy1 - vy0;
          const t2: Mat = [vw / tw, 0, 0, vh / th, (vx0 - ox) / tw, (vy0 - oy) / th];
          under.push({ kind: 'rect', id: nid(), name: 'Градиент фона', m: translate(vx0, vy0), w: vw, h: vh, fills: [{ ...g.paint, transform: multiply(g.paint.transform, t2) }] });
        }
        continue;
      }
    }
    if (!isGradient && urlM.length === 1 && layer.startsWith('url(')) {
      const url = urlM[0];
      const ref = asset('url:' + url, { kind: 'url', url, purpose: 'bg' });
      if (rx === 'no-repeat' && ry === 'no-repeat') {
        const vx0 = Math.max(cb.x, ox), vy0 = Math.max(cb.y, oy), vx1 = Math.min(cb.x + cb.w, ox + tw), vy1 = Math.min(cb.y + cb.h, oy + th);
        if (vx1 - vx0 <= 0.1 || vy1 - vy0 <= 0.1) continue;
        const full = vx0 <= 0.5 && vy0 <= 0.5 && vx1 >= w - 0.5 && vy1 >= h - 0.5;
        if (full) {
          top.unshift({ type: 'IMAGE', asset: ref, scaleMode: 'CROP', imageTransform: [w / tw, 0, 0, h / th, -ox / tw, -oy / th], opacity: 1, blend: blend !== 'NORMAL' ? blend : undefined });
        } else {
          const vw = vx1 - vx0, vh = vy1 - vy0;
          under.push({ kind: 'rect', id: nid(), name: 'Изображение фона', m: translate(vx0, vy0), w: vw, h: vh, fills: [{ type: 'IMAGE', asset: ref, scaleMode: 'CROP', imageTransform: [vw / tw, 0, 0, vh / th, (vx0 - ox) / tw, (vy0 - oy) / th], opacity: 1 }] });
        }
        continue;
      }
      if (rx === 'repeat' && ry === 'repeat' && hasNatural) {
        const ok = Math.abs(tw / natural.w - th / natural.h) < 0.01;
        if (Math.abs(ox - area.x) > 0.5 || Math.abs(oy - area.y) > 0.5) diag('info', 'tile-offset', 'Смещение плитки фона (background-position) не переносится в Figma TILE', src);
        if (!ok) diag('info', 'tile-aspect', 'Неравномерное масштабирование плитки фона перенесено приближённо', src);
        top.unshift({ type: 'IMAGE', asset: ref, scaleMode: 'TILE', scalingFactor: tw / natural.w, opacity: 1, blend: blend !== 'NORMAL' ? blend : undefined });
        // scalingFactor уточняется обработчиком относительно реального размера растра
        (top[0] as { tileCss?: number }).tileCss = tw;
        continue;
      }
    }
    // точная растровая отрисовка слоя браузером
    const css: Record<string, string> = {
      'background-image': layer, 'background-size': pick(sizes, i), 'background-position-x': pick(posX, i), 'background-position-y': pick(posY, i),
      'background-repeat': pick(reps, i), 'background-origin': origin, 'background-clip': pick(clips, i),
      'border-style': 'solid', 'border-color': 'transparent', 'border-width': `${bt}px ${br}px ${bb}px ${bl}px`, padding: `${pt}px ${pr}px ${pb}px ${pl}px`, 'box-sizing': 'border-box',
    };
    const ref = asset('bg:' + JSON.stringify(css) + w + 'x' + h, { kind: 'bglayer', css, w, h });
    top.unshift({ type: 'IMAGE', asset: ref, scaleMode: 'CROP', imageTransform: IDENTITY, opacity: 1, blend: blend !== 'NORMAL' ? blend : undefined });
    S!.stats.rasterBackgrounds = (S!.stats.rasterBackgrounds ?? 0) + 1;
  }
  return { fills: [...fills, ...top.reverse()], under };
}

function borderStroke(s: StyleSnap, src: string, w: number, h: number): { stroke?: StrokeIR; extra: ShapeIR[] } {
  const sides = ['top', 'right', 'bottom', 'left'] as const;
  const data = sides.map((sd) => ({
    w: parseFloat(s[`border-${sd}-width` as keyof StyleSnap]) || 0,
    st: s[`border-${sd}-style` as keyof StyleSnap],
    c: parseColor(s[`border-${sd}-color` as keyof StyleSnap]),
  })).map((d) => (d.st === 'none' || d.st === 'hidden' || !d.c || d.c.a <= 0 ? { ...d, w: 0 } : d));
  const vis = data.filter((d) => d.w > 0);
  if (!vis.length) return { extra: [] };
  const same = vis.every((d) => d.c && vis[0].c && Math.abs(d.c.r - vis[0].c.r) < 0.002 && Math.abs(d.c.g - vis[0].c.g) < 0.002 && Math.abs(d.c.b - vis[0].c.b) < 0.002 && Math.abs(d.c.a - vis[0].c.a) < 0.002 && d.st === vis[0].st);
  const style = vis[0].st;
  if (!['solid', 'dashed', 'dotted'].includes(style)) diag('info', 'border-style', `Стиль рамки «${style}» перенесён сплошной линией`, src);
  if (same) {
    const c = vis[0].c!;
    const wmax = Math.max(...vis.map((d) => d.w));
    const dash = style === 'dashed' ? [wmax * 3, wmax * 3] : style === 'dotted' ? [wmax, wmax] : undefined;
    return { stroke: { color: { r: c.r, g: c.g, b: c.b }, opacity: c.a, weights: data.map((d) => d.w) as [number, number, number, number], align: 'INSIDE', dash }, extra: [] };
  }
  diag('info', 'border-sides', 'Рамка с разными цветами сторон перенесена отдельными линиями (скругление сторон не повторяется)', src);
  const extra: ShapeIR[] = [];
  data.forEach((d, i) => {
    if (d.w <= 0 || !d.c) return;
    const box = [[0, 0, w, d.w], [w - d.w, 0, d.w, h], [0, h - d.w, w, d.w], [0, 0, d.w, h]][i];
    extra.push({ kind: 'rect', id: nid(), name: `Рамка ${['сверху', 'справа', 'снизу', 'слева'][i]}`, m: translate(box[0], box[1]), w: box[2], h: box[3], fills: [rgbaPaint(d.c)!] });
  });
  return { extra };
}

function radii(s: StyleSnap, w: number, h: number, src: string): { r?: [number, number, number, number]; ellipse: boolean } {
  const raw = (['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'] as const).map((k) => parseRadius(s[k] || '0', w, h));
  if (raw.every(([x, y]) => x <= 0 && y <= 0)) return { ellipse: false };
  const n = normalizeRadii(raw, w, h);
  if (n.elliptical && !n.ellipse) diag('info', 'elliptical-radius', 'Эллиптические радиусы углов перенесены круговыми (меньшая полуось)', src);
  return { r: n.radii, ellipse: n.ellipse };
}

interface Visual { fills: PaintIR[]; under: ShapeIR[]; stroke?: StrokeIR; extra: ShapeIR[]; radius?: [number, number, number, number]; effects: EffectIR[]; ellipse: boolean; opacity?: number; blend?: BlendModeIR; rasterReasons: string[]; colorFilter?: string; textFills?: PaintIR[]; clipBox?: boolean; clipEmpty?: boolean }

function visuals(rec: Rec, w: number, h: number): Visual {
  const s = rec.s;
  const src = describe(rec.el) + (rec.pseudo ? '::' + rec.pseudo : '');
  const hidden = s.visibility !== 'visible';
  const v: Visual = { fills: [], under: [], extra: [], effects: [], ellipse: false, rasterReasons: [] };
  const op = parseFloat(s.opacity);
  if (Number.isFinite(op) && op < 1) v.opacity = Math.max(0, op);
  const blend = CSS_BLEND[s['mix-blend-mode']];
  if (blend && blend !== 'NORMAL') v.blend = blend as BlendModeIR;
  if (hidden) return v;
  const clipText = /(^|,\s*)text(\s*,|$)/.test(s['background-clip']);
  const bg = backgrounds(clipText ? { ...s, 'background-clip': s['background-clip'].replace(/\btext\b/g, 'border-box') } : s, w, h, src);
  if (clipText) {
    // background-clip: text — фон виден только сквозь глифы → заливка текстовых слоёв
    v.textFills = bg.fills.filter((f) => f.type !== 'SOLID' || f.opacity > 0);
  } else {
    v.fills = bg.fills;
    v.under = bg.under;
  }
  const b = borderStroke(s, src, w, h);
  v.stroke = b.stroke;
  v.extra = b.extra;
  const r = radii(s, w, h, src);
  v.radius = r.r;
  v.ellipse = r.ellipse;
  const shadows = parseShadows(s['box-shadow']) ?? [];
  if (s['box-shadow'] !== 'none' && !parseShadows(s['box-shadow'])) diag('warn', 'shadow-parse', 'Нераспознанная тень: ' + s['box-shadow'].slice(0, 80), src);
  let rest = shadows;
  if (!v.stroke) {
    const ring = shadows.find((sh) => sh.inset && sh.blur === 0 && sh.x === 0 && sh.y === 0 && sh.spread > 0 && sh.color.a > 0);
    if (ring) {
      v.stroke = { color: { r: ring.color.r, g: ring.color.g, b: ring.color.b }, opacity: ring.color.a, weights: [ring.spread, ring.spread, ring.spread, ring.spread], align: 'INSIDE' };
      rest = shadows.filter((x) => x !== ring);
    }
  }
  v.effects = shadowsToEffects(rest);
  const f = parseFilter(s.filter);
  if (f.blur > 0) v.effects.push({ type: 'LAYER_BLUR', radius: f.blur * 2 });
  for (const d of f.dropShadows) v.effects.push({ type: 'DROP_SHADOW', color: d.color, x: d.x, y: d.y, blur: d.blur, spread: 0 });
  const colorFilters = f.color.filter((x) => !isIdentityColorFilter(x));
  if (colorFilters.length) v.colorFilter = colorFilters.join(' ');
  if (f.other.length) v.rasterReasons.push('filter: ' + f.other.join(' '));
  const bdf = parseFilter(s['backdrop-filter']);
  if (bdf.blur > 0) v.effects.push({ type: 'BACKGROUND_BLUR', radius: bdf.blur * 2 });
  if (bdf.color.length || bdf.other.length) diag('info', 'backdrop', 'backdrop-filter кроме blur() не переносится', src);
  if (s['clip-path'] && s['clip-path'] !== 'none') {
    const circle = /^circle\(50%( at 50% 50%)?\)$/.exec(s['clip-path']);
    const inset = parseInset(s['clip-path'], w, h);
    if (circle && Math.abs(w - h) < 0.5) v.radius = [w / 2, w / 2, w / 2, w / 2];
    else if (inset?.empty) {
      // inset() без площади (типичное начальное состояние анимации появления): в браузере
      // элемент не виден — слой сохраняется скрытым и остаётся редактируемым
      v.clipEmpty = true;
      diag('info', 'clip-hidden', 'Элемент полностью скрыт clip-path: ' + s['clip-path'].slice(0, 60) + ' — перенесён скрытым слоем', src);
    } else if (inset?.zero) {
      v.clipBox = true;
      if (inset.round && !v.radius) v.radius = [inset.round, inset.round, inset.round, inset.round];
    } else v.rasterReasons.push('clip-path: ' + s['clip-path'].slice(0, 60));
  }
  const mask = s['mask-image'] !== 'none' && s['mask-image'] ? s['mask-image'] : s['-webkit-mask-image'] !== 'none' ? s['-webkit-mask-image'] : '';
  if (mask) v.rasterReasons.push('mask-image');
  if (s['border-image-source'] && s['border-image-source'] !== 'none') v.rasterReasons.push('border-image');
  // контур (outline)
  const ow = px(s['outline-width']);
  const oc = parseColor(s['outline-color']);
  if (s['outline-style'] !== 'none' && ow > 0 && oc && oc.a > 0) {
    const off = px(s['outline-offset']);
    v.extra.push({ kind: 'rect', id: nid(), name: 'Контур (outline)', m: translate(-off, -off), w: w + 2 * off, h: h + 2 * off, fills: [], stroke: { color: { r: oc.r, g: oc.g, b: oc.b }, opacity: oc.a, weights: [ow, ow, ow, ow], align: 'OUTSIDE' } });
  }
  return v;
}

function shadowsNeedRect(v: Visual, clip: boolean): boolean {
  if (!v.effects.some((e) => (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') && e.spread !== 0)) return false;
  const visibleFill = v.fills.some((f) => f.opacity > 0);
  return !(visibleFill && clip);
}

/** Слой паинта в пределах родителя (упрощённая модель CSS Appendix E). */
function paintKey(rec: Rec): [number, number, number] {
  const s = rec.s;
  const z = s['z-index'] === 'auto' ? 0 : parseInt(s['z-index'], 10) || 0;
  const positioned = s.position !== 'static';
  const flexItem = rec.parent ? /flex|grid/.test(rec.parent.s.display) : false;
  const zApplies = positioned || flexItem;
  let layer: number;
  if (zApplies && z < 0) layer = 0;
  else if (zApplies && z > 0) layer = 5;
  else if (positioned || rec.sc) layer = 4;
  else if (s.float !== 'none') layer = 2;
  else if (/^inline/.test(s.display) || rec.replaced || rec.pseudo && s.display === 'inline') layer = 3;
  else layer = 1;
  return [layer, zApplies ? z : 0, rec.order];
}

function clipApplies(clipper: Rec, rec: Rec): boolean {
  // overflow предка обрезает absolute/fixed-потомка только если предок — его CB или выше CB
  if (rec.s.position !== 'absolute' && rec.s.position !== 'fixed') return true;
  if (rec.cb === 'viewport') return false;
  for (let c: Rec | null = rec.cb; c; c = c.parent) if (c === clipper) return true;
  return false;
}

const kids = new Map<Rec | null, Rec[]>();

function assignParents() {
  kids.clear();
  for (const rec of S!.recs) {
    if (rec.kind !== 'box') continue;
    let parent = rec.parent;
    if (rec.fixed) parent = null;
    else if ((rec.s.position === 'absolute' || rec.s.position === 'fixed') && rec.cb !== 'viewport') {
      // выход из обрезки предков, которые не являются CB
      let escape = false;
      for (let p = rec.parent; p && p !== rec.cb; p = p.parent) if (clipsContent(p.s) || p.replaced) { if (!clipApplies(p, rec)) escape = true; }
      if (escape) parent = rec.cb as Rec | null;
    }
    // z-index < 0 / > 0 поднимается в ближайший контекст наложения (если это не нарушает обрезку)
    const key = paintKey(rec);
    if ((key[0] === 0 || key[0] === 5) && parent && !parent.sc) {
      let target: Rec | null = parent;
      let ok = true;
      while (target && !target.sc) {
        if (clipsContent(target.s) && clipApplies(target, rec)) { ok = false; break; }
        if (hasTransform(target.s)) break;
        target = target.parent;
      }
      if (ok && target !== parent) { parent = target; S!.stats.zHoisted = (S!.stats.zHoisted ?? 0) + 1; }
    }
    rec.figmaParent = parent;
    const list = kids.get(parent) ?? [];
    list.push(rec);
    kids.set(parent, list);
  }
}

function localMatrix(rec: Rec): Mat {
  const lay = rec.layout!;
  const p = rec.figmaParent?.layout;
  const base = translate(lay.x - (p ? p.x : 0), lay.y - (p ? p.y : 0));
  if (!hasTransform(rec.s)) return base;
  const t = composeCssTransform({ transform: rec.s.transform, translate: rec.s.translate, rotate: rec.s.rotate, scale: rec.s.scale, origin: rec.s['transform-origin'], width: lay.w, height: lay.h });
  if (!t) { diag('warn', 'transform-parse', 'Нераспознанный transform: ' + rec.s.transform, describe(rec.el)); return base; }
  if (t.unsupported.length) { rec.tfUnsupported = t.unsupported; diag('warn', 'transform-3d', `3D/перспективное преобразование (${t.unsupported.join(', ')}) перенесено как плоское`, describe(rec.el)); }
  return multiply(base, t.m);
}

const cum = new Map<Rec | null, Mat>();
function cumulative(rec: Rec | null): Mat {
  if (!rec) return IDENTITY;
  const c = cum.get(rec);
  if (c) return c;
  const m = multiply(cumulative(rec.figmaParent), rec.m!);
  cum.set(rec, m);
  return m;
}

function textIR(t: TextNodeOut, origin: Box, src: string): TextIR {
  const runs = t.runs.map((r) => ({
    start: r.start, end: r.end, font: r.font.key, size: r.st.size, color: r.st.color, letterSpacing: r.st.letterSpacing,
    decoration: r.st.decoration, decorationColor: r.st.decorationColor, decorationStyle: r.st.decoration ? r.st.decorationStyle : undefined, decorationThickness: r.st.decoration ? r.st.decorationThickness : undefined, link: r.st.link,
  }));
  for (const r of t.runs) {
    if (r.st.overline) diag('info', 'overline', 'Надчёркивание (overline) не поддерживается Figma', src);
    if (r.st.smallCaps) diag('info', 'small-caps', 'Капитель (font-variant-caps) не переносится', src);
    if (r.st.wordSpacing) diag('info', 'word-spacing', 'word-spacing учтён позициями строк, но в Figma не задаётся', src);
    if (r.st.gradientText) diag('info', 'gradient-text', 'Текст с background-clip:text перенесён сплошным цветом', src);
    if (r.font.synthetic) diag('warn', 'synthetic-font', `Браузер синтезировал начертание (${r.font.synthetic.join(', ')}) для ${r.font.family}; в Figma используется реальное начертание ${r.font.weight}`, src);
  }
  const first = t.runs[0].st;
  const effects: EffectIR[] = [];
  const sh = textShadowOf(first);
  if (sh && sh.length) effects.push(...shadowsToEffects(sh));
  let m: Mat = translate(t.x - origin.x, t.y - origin.y);
  let w = t.w, h = t.h;
  if (t.vertical) { m = [0, 1, -1, 0, t.x - origin.x + t.h, t.y - origin.y]; w = t.w; h = t.h; }
  const node: TextIR = {
    kind: 'text', id: nid(), name: t.name, src, m, w, h, text: t.text, runs, lineHeight: t.lineHeight, align: t.align, lines: t.lines,
    truncate: t.truncate, effects: effects.length ? effects : undefined, textStroke: first.stroke,
  };
  if (t.fixedWidth) node.w = t.fixedWidth;
  return node;
}

function rasterShot(rec: Rec, reason: string): ImageIR | null {
  const a = rec.aabbA!;
  if (a.w < 1 || a.h < 1) return null;
  const mark = 's' + (S!.shots++);
  rec.el.setAttribute('data-h2f-shot', mark);
  const ref = asset('shot:' + mark, { kind: 'shot', rect: [a.x, a.y, a.w, a.h], mark, reason });
  diag('info', 'rasterized', `Элемент растрирован: ${reason}`, describe(rec.el));
  S!.stats.rasterized = (S!.stats.rasterized ?? 0) + 1;
  const lay = rec.layout!;
  // снимок делается в итоговом (повёрнутом) виде — ставим его по AABB без поворота
  const inv = invert(cumulative(rec.figmaParent)) ?? IDENTITY;
  const [x, y] = [inv[0] * a.x + inv[2] * a.y + inv[4], inv[1] * a.x + inv[3] * a.y + inv[5]];
  void lay;
  return { kind: 'image', id: nid(), name: `Растр · ${describe(rec.el)}`, src: describe(rec.el), m: translate(x, y), w: a.w, h: a.h, asset: ref, scaleMode: 'FILL', tags: ['raster'] };
}

function subtreeHasText(rec: Rec): boolean {
  if (rec.texts.length || (rec.pseudoText && rec.pseudoText.trim())) return true;
  return rec.children.some(subtreeHasText) || rec.inlines.length > 0 && rec.items.some((i) => i.kind === 'text' && /\S/.test(i.node.data));
}

function buildIR(rec: Rec): NodeIR | null {
  const lay = rec.layout;
  if (!lay) return null;
  const src = describe(rec.el) + (rec.pseudo ? '::' + rec.pseudo : '');
  rec.m = localMatrix(rec);
  const w = lay.w, h = lay.h;
  const vis = visuals(rec, w, h);
  const expectBox = (): [number, number, number, number] | undefined => {
    const a = rec.aabbA;
    return a && !rec.pseudo ? [a.x, a.y, a.w, a.h] : undefined;
  };
  const base = {
    id: nid(), src, m: rec.m, w, h, opacity: vis.opacity, blend: vis.blend,
    scroll: rec.fixed ? 'fixed' as const : rec.sticky ? 'sticky' as const : undefined,
    tags: rec.hoverCard ? ['hover-card'] : undefined,
    visible: vis.clipEmpty ? false : undefined,
  };
  const name = rec.pseudo ? `::${rec.pseudo}` : nodeName(rec);
  const unsupported = [...vis.rasterReasons, ...(rec.tfUnsupported?.includes('perspective') ? ['перспектива'] : [])];
  if (unsupported.length && S!.opts.rasterUnsupported && !rec.pseudo && !subtreeHasText(rec)) {
    const shot = rasterShot(rec, unsupported.join('; '));
    if (shot) return shot;
  } else if (unsupported.length) diag('warn', 'unsupported-effect', `Эффект не перенесён (элемент содержит текст и остаётся редактируемым): ${unsupported.join('; ')}`, src);

  // замещаемые элементы
  if (rec.replaced === 'IMG') return imageNode(rec, base, vis, name);
  if (rec.replaced === 'SVG') return svgNode(rec, base, vis, name);
  if (rec.replaced === 'CANVAS') {
    let data = '';
    try { data = (rec.el as HTMLCanvasElement).toDataURL('image/png'); } catch { /* tainted canvas */ }
    if (data && data.length > 30) {
      const ref = asset('canvas:' + rec.id, { kind: 'dataurl', data });
      diag('info', 'canvas', 'Canvas перенесён растровым изображением', src);
      return { kind: 'image', ...base, name: 'Canvas', asset: ref, scaleMode: 'FILL', radius: vis.radius, tags: ['raster'] };
    }
    return rasterShot(rec, 'canvas (защищён CORS — снимок области)');
  }
  if (rec.replaced === 'VIDEO') {
    const poster = (rec.el as HTMLVideoElement).poster;
    if (poster) {
      const ref = asset('url:' + poster, { kind: 'url', url: poster, purpose: 'poster' });
      diag('info', 'video', 'Видео перенесено постером', src);
      return { kind: 'image', ...base, name: 'Видео (постер)', asset: ref, scaleMode: 'CROP', imageTransform: IDENTITY, radius: vis.radius };
    }
    return rasterShot(rec, 'видео (кадр)');
  }
  if (rec.replaced === 'IFRAME' || rec.replaced === 'EMBED' || rec.replaced === 'OBJECT') return rasterShot(rec, 'встроенный документ ' + rec.replaced.toLowerCase());
  if (rec.replaced === 'METER' || rec.replaced === 'PROGRESS') return rasterShot(rec, 'системный элемент ' + rec.replaced.toLowerCase());
  if ((rec.replaced === 'INPUT' || rec.replaced === 'SELECT') && rec.s.appearance !== 'none') {
    const type = (rec.el as HTMLInputElement).type;
    if (rec.replaced === 'SELECT' || ['checkbox', 'radio', 'range', 'color', 'file', 'date', 'time', 'datetime-local', 'month', 'week', 'button', 'submit', 'reset', 'image'].includes(type)) {
      if (!['button', 'submit', 'reset'].includes(type)) return rasterShot(rec, 'системный элемент формы ' + (type || rec.replaced.toLowerCase()));
    }
  }

  const children: NodeIR[] = [];
  // отображаемые потомки по порядку отрисовки
  type Item = { key: [number, number, number]; make: () => NodeIR[] };
  const items: Item[] = [];
  for (const c of kids.get(rec) ?? []) {
    items.push({ key: paintKey(c), make: () => { const n = buildIR(c); return n ? [n] : []; } });
  }
  for (const inl of rec.inlines) {
    if (!inl.frags?.length) continue;
    items.push({ key: [3, 0, inl.order], make: () => inlineDecorations(inl, lay) });
  }
  for (const t of rec.texts) items.push({ key: [3, 0, rec.textOrder ?? rec.order], make: () => {
    const n = textIR(t, lay, src);
    if (vis.textFills?.length) {
      // перенос нормализованных координат: текстовый слой → коробка элемента
      const tx = t.x - lay.x, ty = t.y - lay.y;
      const A: Mat = [t.w / w, 0, 0, t.h / h, tx / w, ty / h];
      n.fills = vis.textFills.map((f) => (f.type === 'SOLID' ? f : f.type === 'IMAGE' ? { ...f, imageTransform: multiply(f.imageTransform ?? IDENTITY, A) } : { ...f, transform: multiply(f.transform, A) }));
    }
    return [n];
  } });
  if (rec.pseudo && rec.pseudoText && rec.pseudoText.trim() && rec.s.visibility === 'visible') items.push({ key: [3, 0, rec.order], make: () => pseudoTextNodes(rec, lay) });
  if (rec.replaced === 'INPUT' || rec.replaced === 'TEXTAREA' || rec.replaced === 'SELECT') items.push({ key: [3, 0, rec.order], make: () => formText(rec, lay) });
  items.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2]);
  for (const it of items) children.push(...it.make());

  const clip = clipsContent(rec.s) || !!vis.clipBox || rec.replaced === 'INPUT' || rec.replaced === 'TEXTAREA' || rec.replaced === 'SELECT';
  if (clip && rec.el instanceof HTMLElement && (rec.el.scrollHeight > rec.el.clientHeight + 2 || rec.el.scrollWidth > rec.el.clientWidth + 2) && /auto|scroll/.test(rec.s['overflow-y'] + rec.s['overflow-x'])) {
    diag('info', 'inner-scroll', 'Внутренняя прокрутка перенесена как обрезанный контейнер в начальной позиции', src);
  }
  const hasVisual = vis.fills.length || vis.under.length || vis.stroke || vis.extra.length || vis.effects.length;
  if (!children.length && !hasVisual && !rec.hoverCard) return null;
  if (w <= 0.01 && h <= 0.01 && !children.length) return null;
  if (vis.colorFilter) diag('info', 'color-filter', `CSS filter (${vis.colorFilter}) не переносится на интерфейсные элементы`, src);

  if (vis.ellipse && !children.length) {
    return { kind: 'ellipse', ...base, name, fills: vis.fills, stroke: vis.stroke, effects: vis.effects.length ? vis.effects : undefined, expect: expectBox() };
  }
  if (!children.length && !vis.under.length && !vis.extra.length && !clip && (rec.pseudo || !rec.hoverCard)) {
    return { kind: 'rect', ...base, name, fills: vis.fills, stroke: vis.stroke, radius: vis.radius, effects: vis.effects.length ? vis.effects : undefined, expect: expectBox() };
  }
  const frame: FrameIR = { kind: 'frame', ...base, name, fills: vis.fills, stroke: vis.stroke, radius: vis.radius, clip, effects: vis.effects.length ? vis.effects : undefined, children: [], expect: expectBox() };
  const lower: NodeIR[] = [...vis.under];
  if (shadowsNeedRect(vis, clip)) {
    lower.unshift({ kind: 'rect', id: nid(), name: 'Фон и тень', m: IDENTITY, w, h, fills: vis.fills.length ? vis.fills : [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 0 }], radius: vis.radius, effects: vis.effects });
    frame.fills = [];
    frame.effects = undefined;
  }
  frame.children = [...lower, ...children, ...vis.extra];
  if (rec.hoverCard && S!.opts.cursor && S!.hoverPoint) {
    const inv = invert(cumulative(rec));
    if (inv) {
      const [cx, cy] = [inv[0] * S!.hoverPoint[0] + inv[2] * S!.hoverPoint[1] + inv[4], inv[1] * S!.hoverPoint[0] + inv[3] * S!.hoverPoint[1] + inv[5]];
      const ref = asset('cursor', { kind: 'cursor' });
      frame.children.push({ kind: 'svg', id: nid(), name: 'Курсор (можно удалить)', m: translate(cx, cy), w: 14, h: 21, asset: ref, clip: false, tags: ['cursor'] });
    }
  }
  return frame;
}

function nodeName(rec: Rec): string {
  const el = rec.el;
  const tag = el.tagName.toLowerCase();
  const aria = el.getAttribute('aria-label');
  const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30);
  if (tag === 'button' || el.getAttribute('role') === 'button') return `Кнопка «${aria || t || 'кнопка'}»`;
  if (tag === 'a') return `Ссылка «${aria || t || el.getAttribute('href') || ''}»`;
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return `Поле ${describe(el)}`;
  if (/^h[1-6]$/.test(tag)) return `${tag.toUpperCase()} «${t}»`;
  return describe(el);
}

function inlineDecorations(inl: Rec, origin: Box): NodeIR[] {
  const s = inl.s;
  const out: NodeIR[] = [];
  if (s.visibility !== 'visible') return out;
  const frags = inl.frags!;
  frags.forEach((f, i) => {
    const vis = visuals(inl, f.w, f.h);
    if (!vis.fills.length && !vis.stroke && !vis.effects.length) return;
    let radius = vis.radius;
    if (radius && frags.length > 1) radius = [i === 0 ? radius[0] : 0, i === frags.length - 1 ? radius[1] : 0, i === frags.length - 1 ? radius[2] : 0, i === 0 ? radius[3] : 0];
    out.push({ kind: 'rect', id: nid(), name: `Фон ${describe(inl.el)}`, src: describe(inl.el), m: translate(f.x - origin.x, f.y - origin.y), w: f.w, h: f.h, fills: vis.fills, stroke: vis.stroke, radius, effects: vis.effects.length ? vis.effects : undefined, opacity: vis.opacity });
  });
  return out;
}

function simpleTextNode(text: string, st: TextStyleInfo, x: number, y: number, align: 'LEFT' | 'CENTER' | 'RIGHT', boxW: number, name: string, origin: Box): NodeIR[] {
  if (!text) return [];
  // шрифт по символам с fallback-диапазонами
  const chars = Array.from(text);
  const runs: TextNodeOut['runs'] = [];
  let pos = 0;
  for (const ch of chars) {
    const font: FontUse = resolveFont(st, ch);
    const last = runs[runs.length - 1];
    if (last && last.font === font) last.end += ch.length;
    else runs.push({ start: pos, end: pos + ch.length, st, font });
    pos += ch.length;
  }
  const lh = st.lineHeight;
  const out: TextNodeOut = { x, y, w: boxW, h: lh * text.split('\n').length, text, runs, lineHeight: lh, align, lines: text.split('\n').length, name };
  return [textIR(out, origin, name)];
}

function pseudoTextNodes(rec: Rec, lay: Box): NodeIR[] {
  const s = rec.s;
  const st = textStyle(rec.el, rec.el);
  const pcs = rec.pseudo === 'marker' ? getComputedStyle(rec.el, '::marker') : getComputedStyle(rec.el, '::' + rec.pseudo);
  const size = px(pcs.fontSize);
  let lh = pcs.lineHeight === 'normal' ? size * 1.2 : /^[\d.]+$/.test(pcs.lineHeight) ? parseFloat(pcs.lineHeight) * size : px(pcs.lineHeight);
  if (!(lh > 0)) lh = size * 1.25;
  const pst: TextStyleInfo = {
    ...st, families: pcs.fontFamily.split(',').map((f) => f.trim().replace(/^['"]|['"]$/g, '')), size, weight: parseInt(pcs.fontWeight, 10) || 400,
    italic: pcs.fontStyle.startsWith('italic'), color: parseColor(pcs.color) ?? st.color, lineHeight: lh, letterSpacing: pcs.letterSpacing === 'normal' ? 0 : px(pcs.letterSpacing),
    transform: pcs.textTransform, decoration: undefined, link: undefined, shadow: pcs.textShadow,
  };
  let text = rec.pseudoText!;
  if (pst.transform === 'uppercase') text = text.toLocaleUpperCase(pst.lang);
  const pl = px(s['padding-left']) + px(s['border-left-width']), pt = px(s['padding-top']) + px(s['border-top-width']);
  const cw = lay.w - pl - px(s['padding-right']) - px(s['border-right-width']);
  const ch = lay.h - pt - px(s['padding-bottom']) - px(s['border-bottom-width']);
  let y = lay.y + pt;
  if (/flex|grid/.test(s.display) && /center/.test(pcs.alignItems + pcs.placeItems)) y = lay.y + pt + (ch - lh) / 2;
  else if (s.display === 'inline') y = lay.y + (lay.h - lh) / 2;
  let align: 'LEFT' | 'CENTER' | 'RIGHT' = 'LEFT';
  if (/flex|grid/.test(s.display) && /center/.test(pcs.justifyContent + pcs.placeItems)) align = 'CENTER';
  else if (s['text-align'] === 'center') align = 'CENTER';
  else if (s['text-align'] === 'right' || s['text-align'] === 'end') align = 'RIGHT';
  const x = align === 'CENTER' ? lay.x + pl : align === 'RIGHT' ? lay.x + pl : lay.x + pl;
  return simpleTextNode(text, pst, x, y, align, Math.max(1, cw), `${rec.pseudo === 'marker' ? 'Маркер' : '::' + rec.pseudo} «${text.slice(0, 20)}»`, lay);
}

function formText(rec: Rec, lay: Box): NodeIR[] {
  const el = rec.el as HTMLInputElement;
  const s = rec.s;
  let text = '';
  let st = textStyle(el, el);
  if (rec.replaced === 'SELECT') {
    const sel = el as unknown as HTMLSelectElement;
    text = sel.selectedOptions?.[0]?.textContent?.trim() ?? '';
  } else {
    text = el.value ?? '';
    if (el.type === 'password') text = '•'.repeat(text.length);
    if (!text && el.placeholder) {
      text = el.placeholder;
      const ph = getComputedStyle(el, '::placeholder');
      st = { ...st, color: parseColor(ph.color) ?? st.color };
    }
  }
  if (!text) return [];
  const pl = px(s['padding-left']) + px(s['border-left-width']), pt = px(s['padding-top']) + px(s['border-top-width']);
  const cw = lay.w - pl - px(s['padding-right']) - px(s['border-right-width']);
  const ch = lay.h - pt - px(s['padding-bottom']) - px(s['border-bottom-width']);
  const lh = st.lineHeight;
  const multi = rec.replaced === 'TEXTAREA';
  if (multi) diag('info', 'textarea', 'Текст в textarea переносится по ширине средствами Figma', describe(el));
  const y = multi ? lay.y + pt : lay.y + pt + (ch - lh) / 2;
  const align = s['text-align'] === 'center' ? 'CENTER' : s['text-align'] === 'right' || s['text-align'] === 'end' ? 'RIGHT' : 'LEFT';
  const nodes = simpleTextNode(multi ? text : text.replace(/\n/g, ' '), st, lay.x + pl, y, align, Math.max(1, cw), 'Значение поля', lay);
  if (nodes[0] && nodes[0].kind === 'text') {
    nodes[0].w = Math.max(1, cw);
    if (!multi) nodes[0].truncate = 1;
    else nodes[0].tags = ['wrap'];
  }
  return nodes;
}

function imageNode(rec: Rec, base: Omit<ImageIR, 'kind' | 'name' | 'asset' | 'scaleMode'>, vis: Visual, name: string): NodeIR | null {
  const img = rec.el as HTMLImageElement;
  const s = rec.s;
  const src = describe(img);
  const url = img.currentSrc || img.src;
  const lay = rec.layout!;
  const pl = px(s['padding-left']) + px(s['border-left-width']), pt = px(s['padding-top']) + px(s['border-top-width']);
  const cw = lay.w - pl - px(s['padding-right']) - px(s['border-right-width']);
  const chh = lay.h - pt - px(s['padding-bottom']) - px(s['border-bottom-width']);
  if (!url || !img.complete || img.naturalWidth === 0) {
    diag('warn', 'broken-image', `Изображение не загрузилось: ${url ? url.slice(0, 160) : '(нет src)'}`, src);
    const alt = img.alt?.trim();
    const children: NodeIR[] = [];
    if (alt) {
      const st = textStyle(img, img);
      children.push(...simpleTextNode(alt, { ...st, color: { r: 0.4, g: 0.4, b: 0.4, a: 1 } }, lay.x + 4, lay.y + 4, 'LEFT', Math.max(1, lay.w - 8), 'Альтернативный текст', lay));
    }
    return { kind: 'frame', ...base, name: `Нет изображения · ${src}`, fills: [{ type: 'SOLID', color: { r: 0.95, g: 0.95, b: 0.95 }, opacity: 1 }], stroke: { color: { r: 0.7, g: 0.7, b: 0.7 }, opacity: 1, weights: [1, 1, 1, 1], align: 'INSIDE', dash: [4, 4] }, clip: true, children, tags: ['broken-image'] };
  }
  const nw = img.naturalWidth, nh = img.naturalHeight;
  const fit = s['object-fit'] || 'fill';
  let dw = cw, dh = chh;
  if (fit === 'contain' || fit === 'cover' || fit === 'none' || fit === 'scale-down') {
    let k = fit === 'cover' ? Math.max(cw / nw, chh / nh) : fit === 'contain' ? Math.min(cw / nw, chh / nh) : 1;
    if (fit === 'scale-down') k = Math.min(1, Math.min(cw / nw, chh / nh));
    dw = nw * k; dh = nh * k;
  }
  const op = (s['object-position'] || '50% 50%').split(/\s+/);
  const dx = pl + lenOf(op[0] ?? '50%', cw - dw), dy = pt + lenOf(op[1] ?? '50%', chh - dh);
  const filter = vis.colorFilter;
  const ref = asset('url:' + url + '|' + (filter ?? ''), { kind: 'url', url, filter, purpose: 'img' });
  if (filter) S!.stats.bakedFilters = (S!.stats.bakedFilters ?? 0) + 1;
  // видимая часть картинки в контентной области
  const vx0 = Math.max(pl, dx), vy0 = Math.max(pt, dy), vx1 = Math.min(pl + cw, dx + dw), vy1 = Math.min(pt + chh, dy + dh);
  const vw = vx1 - vx0, vh = vy1 - vy0;
  if (vw <= 0 || vh <= 0) return null;
  const tr: Mat = [vw / dw, 0, 0, vh / dh, (vx0 - dx) / dw, (vy0 - dy) / dh];
  const fullBox = vx0 < 0.5 && vy0 < 0.5 && Math.abs(vw - lay.w) < 0.5 && Math.abs(vh - lay.h) < 0.5;
  const hasBoxVisual = vis.fills.length || vis.stroke || vis.under.length;
  if (fullBox && !vis.under.length) {
    return { kind: 'image', ...base, name: `Изображение ${img.alt ? '«' + img.alt.slice(0, 30) + '»' : src}`, asset: ref, scaleMode: 'CROP', imageTransform: tr, radius: vis.radius, stroke: vis.stroke, fills: vis.fills.length ? vis.fills : undefined, effects: vis.effects.length ? vis.effects : undefined, expect: rec.aabbA ? [rec.aabbA.x, rec.aabbA.y, rec.aabbA.w, rec.aabbA.h] : undefined };
  }
  const inner: ImageIR = { kind: 'image', id: nid(), name: 'Изображение', m: translate(vx0, vy0), w: vw, h: vh, asset: ref, scaleMode: 'CROP', imageTransform: tr };
  void hasBoxVisual;
  return { kind: 'frame', ...base, name, fills: vis.fills, stroke: vis.stroke, radius: vis.radius, clip: true, effects: vis.effects.length ? vis.effects : undefined, children: [...vis.under, inner] };
}

function svgNode(rec: Rec, base: Omit<SvgIR, 'kind' | 'name' | 'asset' | 'clip'>, vis: Visual, name: string): NodeIR | null {
  const ser = rec.svg;
  const lay = rec.layout!;
  const s = rec.s;
  const src = describe(rec.el);
  if (!ser || !rec.svgContent || rec.svgContent.w <= 0 || rec.svgContent.h <= 0) return null;
  const mode = S!.opts.svgMode;
  const raster = mode === 'raster' || (mode === 'auto' && ser.reasons.length > 0);
  const ref = asset('svg:' + ser.markup, { kind: 'svg', markup: ser.markup, w: rec.svgContent.w, h: rec.svgContent.h, reasons: ser.reasons, overflowVisible: ser.overflowVisible, raster, externalImages: ser.externalImages });
  if (raster) { S!.stats.svgRaster = (S!.stats.svgRaster ?? 0) + 1; diag('info', 'svg-raster', `SVG растрирован: ${ser.reasons.join(', ') || 'режим профиля'}`, src); }
  else S!.stats.svgVector = (S!.stats.svgVector ?? 0) + 1;
  const pl = px(s['padding-left']) + px(s['border-left-width']), pt = px(s['padding-top']) + px(s['border-top-width']);
  const clip = !ser.overflowVisible;
  const hasBox = vis.fills.length || vis.stroke || vis.under.length || pl > 0.01 || pt > 0.01 || vis.radius && clip;
  const svgIR: SvgIR = { kind: 'svg', id: nid(), name: hasBox ? 'Рисунок SVG' : `SVG ${src}`, src, m: translate(pl, pt), w: rec.svgContent.w, h: rec.svgContent.h, asset: ref, clip, tags: raster ? ['raster'] : undefined };
  if (!hasBox) return { ...svgIR, ...base, name: `SVG ${src}`, m: multiply(base.m, translate(pl, pt)), w: rec.svgContent.w, h: rec.svgContent.h, effects: vis.effects.length ? vis.effects : undefined, expect: rec.aabbA ? [rec.aabbA.x, rec.aabbA.y, rec.aabbA.w, rec.aabbA.h] : undefined };
  return { kind: 'frame', ...base, name, fills: vis.fills, stroke: vis.stroke, radius: vis.radius, clip: clip && !!vis.radius, effects: vis.effects.length ? vis.effects : undefined, children: [...vis.under, svgIR] };
}

export interface RawCapture {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  width: number;
  height: number;
  background: PaintIR[];
  children: NodeIR[];
  fixedCount: number;
  assets: Record<string, AssetRef>;
  fonts: Record<string, { family: string; generic?: string; weight: number; italic: boolean; source: string; variable?: boolean; synthetic?: string[]; chars: number; sample: string }>;
  genericMarks: Array<{ mark: string; generic?: string; system?: string[]; chars: string }>;
  diagnostics: Diagnostic[];
  stats: Record<string, number>;
  geometry: { maxShift: number; mismatches: Array<{ src: string; dx: number; dy: number; dw: number; dh: number }> };
}

export function finish(): RawCapture {
  if (!S) throw new Error('capture not started');
  nodeSerial = 0;
  cum.clear();
  // проверка: подготовка не сдвинула видимые элементы
  let maxShift = 0;
  for (const rec of S.recs) {
    if (rec.pseudo || !rec.aabbA) continue;
    const r = rec.el.getBoundingClientRect();
    const d = Math.max(Math.abs(r.left + scrollX - rec.aabbA.x), Math.abs(r.top + scrollY - rec.aabbA.y), Math.abs(r.width - rec.aabbA.w), Math.abs(r.height - rec.aabbA.h));
    if (d > maxShift) maxShift = d;
  }
  if (maxShift > 0.5) diag('warn', 'prep-shift', `Подготовка захвата сместила элементы до ${maxShift.toFixed(1)} px`);
  assignParents();
  const rootItems = (kids.get(null) ?? []).filter((r) => r.layout);
  const normal = rootItems.filter((r) => !r.fixed).sort((a, b) => { const ka = paintKey(a), kb = paintKey(b); return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2]; });
  const fixed = rootItems.filter((r) => r.fixed).sort((a, b) => { const ka = paintKey(a), kb = paintKey(b); return ka[1] - kb[1] || ka[2] - kb[2]; });
  const children: NodeIR[] = [];
  for (const r of normal) { const n = buildIR(r); if (n) children.push(n); }
  let fixedCount = 0;
  for (const r of fixed) { const n = buildIR(r); if (n) { children.push(n); fixedCount++; } }
  // проверка transforms: AABB(cum·box) == getBoundingClientRect
  const mism: Session['mismatches'] = [];
  for (const rec of S.recs) {
    if (!rec.m || !rec.layout || !rec.aabbA || rec.pseudo || rec.kind !== 'box') continue;
    if (rec.aabbA.w === 0 && rec.aabbA.h === 0) continue;
    const [x, y, w, h] = aabb(cumulative(rec), rec.layout.w, rec.layout.h);
    const a = rec.aabbA;
    const dx = x - a.x, dy = y - a.y, dw = w - a.w, dh = h - a.h;
    if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dw), Math.abs(dh)) > 1) mism.push({ src: describe(rec.el), dx: +dx.toFixed(2), dy: +dy.toFixed(2), dw: +dw.toFixed(2), dh: +dh.toFixed(2) });
  }
  if (mism.length) diag('warn', 'transform-mismatch', `Восстановленная геометрия ${mism.length} элементов отличается от браузерной более чем на 1 px`);
  // фон холста
  const html = document.documentElement, body = document.body;
  const canvasEl = S.canvasBg === 'html' ? html : body ?? html;
  const W = html.clientWidth, H = Math.max(html.scrollHeight, body?.scrollHeight ?? 0);
  const cs = snapStyle(getComputedStyle(canvasEl));
  const bgr = backgrounds({ ...cs, 'border-top-width': '0', 'border-left-width': '0', 'border-right-width': '0', 'border-bottom-width': '0', 'padding-top': '0', 'padding-left': '0', 'padding-right': '0', 'padding-bottom': '0' }, W, H, 'canvas');
  const background = bgr.fills.length ? bgr.fills : [{ type: 'SOLID' as const, color: { r: 1, g: 1, b: 1 }, opacity: 1 }];
  if (bgr.fills.length && !bgr.fills.some((f) => f.type === 'SOLID' && f.opacity >= 1)) background.unshift({ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 });
  children.unshift(...bgr.under);
  // шрифты
  const fonts: RawCapture['fonts'] = {};
  const countFonts = (n: NodeIR) => {
    if (n.kind === 'text') {
      for (const r of n.runs) {
        const f = fonts[r.font];
        const sample = n.text.slice(r.start, r.end);
        if (f) { f.chars += r.end - r.start; if (f.sample.length < 40) f.sample += sample.slice(0, 40 - f.sample.length); }
      }
    }
    if (n.kind === 'frame') n.children.forEach(countFonts);
  };
  for (const st of styleFonts()) fonts[st.key] = { family: st.family, generic: st.generic, weight: st.weight, italic: st.italic, source: st.source, variable: st.variable, synthetic: st.synthetic, chars: 0, sample: '' };
  children.forEach(countFonts);
  for (const k of Object.keys(fonts)) if (!fonts[k].chars) delete fonts[k];
  // элементы с универсальными семействами — для уточнения через CDP
  const marks: RawCapture['genericMarks'] = [];
  let mi = 0;
  for (const [el, m] of genericMarks) {
    const mark = 'g' + mi++;
    el.setAttribute('data-h2f-f', mark);
    marks.push({ mark, generic: m.generic, system: m.system.size ? [...m.system] : undefined, chars: [...m.chars].join('') });
  }
  const assets: Record<string, AssetRef> = {};
  for (const [k, v] of S.assets) assets[k] = v;
  const stats = { ...S.stats, nodes: S.nodeCount, chars: S.chars.chars, fixed: fixedCount };
  if (S.limitHit) diag('warn', 'node-limit', `Достигнут лимит элементов (${S.opts.maxNodes}); часть страницы не перенесена`);
  return {
    url: location.href, title: document.title, viewport: { width: innerWidth, height: innerHeight }, width: W, height: H,
    background, children, fixedCount, assets, fonts, genericMarks: marks, diagnostics: [...S.diags.values()], stats,
    geometry: { maxShift: +maxShift.toFixed(3), mismatches: mism.slice(0, 50) },
  };
}

function styleFonts(): FontUse[] {
  return allFontUses();
}

export function cleanup() {
  for (const attr of ['data-h2f-p', 'data-h2f-tf', 'data-h2f-f', 'data-h2f-shot']) for (const e of Array.from(document.querySelectorAll(`[${attr}]`))) e.removeAttribute(attr);
  S?.styleSheet?.remove();
  S?.neutralSheet?.remove();
  void HOVER_ATTR;
}

export function shotIsolation(mark: string, on: boolean) {
  const id = 'h2f-iso';
  document.getElementById(id)?.remove();
  if (!on) return;
  const st = document.createElement('style');
  st.id = id;
  st.textContent = `html,body{background:transparent!important}html *,html *::before,html *::after{visibility:hidden!important}[data-h2f-shot="${mark}"],[data-h2f-shot="${mark}"] *,[data-h2f-shot="${mark}"] *::before,[data-h2f-shot="${mark}"] *::after{visibility:visible!important}`;
  document.documentElement.appendChild(st);
}
