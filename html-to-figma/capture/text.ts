/*
 * Измерение текста по фактической раскладке браузера.
 *
 * Для каждого inline formatting context (блок со строчным содержимым) символы
 * измеряются через Range.getClientRects() (в фазе с нейтрализованными transforms,
 * т. е. в неповёрнутых координатах раскладки). Из позиций символов строятся:
 *  - строки (переносы ровно как в браузере → в Figma вставляется явный \n);
 *  - сегменты (разрыв по inline-block, отступам inline-элементов, промежуткам, смене кегля);
 *  - TEXT-ноды: соседние строки объединяются, только если у них общая линия
 *    выравнивания и одинаковый шаг строк — иначе отдельные ноды (text-indent, обтекание
 *    float, буквицы, разные кегли). Так Figma не перекомпоновывает текст.
 * Шрифт каждого символа определяется по стеку font-family с проверкой покрытия
 * глифа (canvas.measureText с тремя разными fallback): так переносятся
 * fallback-диапазоны (например, кириллица Courier Prime → Cousine).
 */
import { parseColor } from '../shared/color';
import { cssMatchFace, parseWeightDescriptor, type FaceDescriptor } from '../shared/fonts';
import { isGeneric, parseFontFamilies, parseShadows } from '../shared/css';
import type { RGBA } from '../shared/schema';
import { px } from './style';

export interface FontUse { key: string; family: string; generic?: string; weight: number; italic: boolean; source: 'webfont' | 'system' | 'generic'; variable?: boolean; synthetic?: string[]; markEl?: Element }

export interface TextStyleInfo {
  el: Element;
  families: string[];
  size: number;
  weight: number;
  italic: boolean;
  color: RGBA;
  lineHeight: number;
  letterSpacing: number;
  wordSpacing: number;
  transform: string;
  decoration?: 'UNDERLINE' | 'STRIKETHROUGH';
  decorationColor?: RGBA;
  decorationStyle?: 'SOLID' | 'DOTTED' | 'WAVY';
  decorationThickness?: number;
  overline: boolean;
  link?: string;
  visible: boolean;
  smallCaps: boolean;
  verticalAlign: string;
  lang: string;
  shadow: string;
  stroke?: { color: RGBA; width: number };
  gradientText: boolean;
}

export interface MeasuredChar {
  ch: string; // уже с учётом text-transform
  x: number; y: number; w: number; h: number;
  st: TextStyleInfo;
  font: FontUse;
  node: Text | null;
  offset: number;
  breakBefore?: boolean;
  firstLetter?: boolean;
  softHyphen?: boolean;
}

export type InlineItem =
  | { kind: 'text'; node: Text }
  | { kind: 'break' }
  | { kind: 'br' }
  | { kind: 'inline-start'; el: Element; hard: boolean }
  | { kind: 'inline-end'; el: Element; hard: boolean };

export interface TextNodeOut {
  x: number; y: number; w: number; h: number; // в координатах документа (раскладка без transforms)
  text: string;
  runs: Array<{ start: number; end: number; st: TextStyleInfo; font: FontUse }>;
  lineHeight: number;
  align: 'LEFT' | 'CENTER' | 'RIGHT';
  lines: number;
  truncate?: number;
  fixedWidth?: number;
  vertical?: boolean;
  shadow?: string;
  stroke?: { color: RGBA; width: number };
  name: string;
}

// ---------- покрытие глифов и подбор начертаний ----------

const canvas = document.createElement('canvas');
const ctx2d = canvas.getContext('2d')!;
const coverCache = new Map<string, boolean>();
const existCache = new Map<string, boolean>();
let facesByFamily: Map<string, Array<FaceDescriptor & { status: string }>> | null = null;

function normFam(f: string) { return f.replace(/^['"]|['"]$/g, '').trim().toLowerCase(); }

function faces(): Map<string, Array<FaceDescriptor & { status: string }>> {
  if (facesByFamily) return facesByFamily;
  facesByFamily = new Map();
  try {
    document.fonts.forEach((f) => {
      const fam = normFam(f.family);
      const [a, b] = parseWeightDescriptor(f.weight);
      const st = f.style.toLowerCase();
      const list = facesByFamily!.get(fam) ?? [];
      list.push({ weightMin: a, weightMax: b, italic: st.includes('italic'), oblique: st.includes('oblique'), status: f.status });
      facesByFamily!.set(fam, list);
    });
  } catch { /* */ }
  return facesByFamily;
}

function measure(font: string, s: string): number { ctx2d.font = font; return ctx2d.measureText(s).width; }

function familyExists(fam: string, weight: number, italic: boolean): boolean {
  const k = `${fam}|${weight}|${italic}`;
  let v = existCache.get(k);
  if (v !== undefined) return v;
  const probe = 'mmmmmmmmmmlli10WQ';
  const base = `${italic ? 'italic ' : ''}${weight} 40px "${fam.replace(/"/g, '\\"')}"`;
  const a = measure(`${base}, monospace`, probe), b = measure(`${base}, serif`, probe), c = measure(`${base}, sans-serif`, probe);
  v = a === b && b === c;
  if (!v) {
    // семейство может не покрывать латиницу (например, только кириллица)
    const cyr = 'ЖЖЖЖЖшшшщщ';
    const a2 = measure(`${base}, monospace`, cyr), b2 = measure(`${base}, serif`, cyr), c2 = measure(`${base}, sans-serif`, cyr);
    v = a2 === b2 && b2 === c2;
  }
  existCache.set(k, v);
  return v;
}

function covers(fam: string, weight: number, italic: boolean, ch: string): boolean {
  const k = `${fam}|${weight}|${italic}|${ch}`;
  let v = coverCache.get(k);
  if (v !== undefined) return v;
  if (!familyExists(fam, weight, italic)) { coverCache.set(k, false); return false; }
  const base = `${italic ? 'italic ' : ''}${weight} 40px "${fam.replace(/"/g, '\\"')}"`;
  const a = measure(`${base}, monospace`, ch), b = measure(`${base}, serif`, ch), c = measure(`${base}, sans-serif`, ch);
  v = a === b && b === c;
  coverCache.set(k, v);
  return v;
}

const fontUseCache = new Map<string, FontUse>();
export const genericMarks = new Map<Element, { generic: string; chars: Set<string> }>();

/** Все использованные на странице сочетания шрифтов (для списка требований). */
export function allFontUses(): FontUse[] { return [...fontUseCache.values()]; }

export function resolveFont(st: TextStyleInfo, ch: string): FontUse {
  const isSpace = /^\s$/.test(ch);
  let chosen: string | null = null;
  let generic: string | undefined;
  for (const f of st.families) {
    if (isGeneric(f)) { generic = f.toLowerCase(); break; }
    if (isSpace ? familyExists(f, st.weight, st.italic) : covers(f, st.weight, st.italic, ch)) { chosen = f; break; }
  }
  if (!chosen && !generic) generic = 'default';
  if (chosen) {
    const fl = faces().get(normFam(chosen));
    let weight = st.weight, italic = st.italic, source: FontUse['source'] = 'system', variable = false;
    const synthetic: string[] = [];
    if (fl && fl.length) {
      source = 'webfont';
      const loaded = fl.filter((f) => f.status === 'loaded');
      const m = cssMatchFace(loaded.length ? loaded : fl, st.weight, st.italic);
      if (m) {
        weight = m.weight;
        italic = m.face.italic || m.face.oblique;
        variable = m.face.weightMax > m.face.weightMin;
        if (m.syntheticBold) synthetic.push('bold');
        if (m.syntheticItalic) { synthetic.push('italic'); italic = false; }
      }
    }
    const key = `${chosen}|${weight}|${italic ? 'i' : 'n'}`;
    let fu = fontUseCache.get(key);
    if (!fu) { fu = { key, family: chosen, weight, italic, source, variable, synthetic: synthetic.length ? synthetic : undefined }; fontUseCache.set(key, fu); }
    return fu;
  }
  // универсальное семейство: имя системного шрифта уточнит обработчик через CDP
  const key = `@${generic}|${st.weight}|${st.italic ? 'i' : 'n'}`;
  const mark = genericMarks.get(st.el) ?? { generic: generic!, chars: new Set<string>() };
  if (!isSpace) mark.chars.add(ch);
  genericMarks.set(st.el, mark);
  let fu = fontUseCache.get(key);
  if (!fu) { fu = { key, family: '', generic, weight: st.weight, italic: st.italic, source: 'generic' }; fontUseCache.set(key, fu); }
  return fu;
}

// ---------- стиль текста ----------

const styleCache = new Map<Element, TextStyleInfo>();
const lhProbeCache = new Map<string, number>();
let probeHost: HTMLElement | null = null;

export function normalLineHeight(cs: CSSStyleDeclaration): number {
  const k = `${cs.fontFamily}|${cs.fontSize}|${cs.fontWeight}|${cs.fontStyle}`;
  let v = lhProbeCache.get(k);
  if (v !== undefined) return v;
  if (!probeHost) {
    probeHost = document.createElement('div');
    probeHost.setAttribute('data-h2f-probe', '');
    probeHost.style.cssText = 'position:absolute!important;left:-100000px!important;top:0!important;visibility:hidden!important;contain:layout style!important;pointer-events:none!important;';
    document.documentElement.appendChild(probeHost);
  }
  const d = document.createElement('div');
  d.style.cssText = `all:initial;display:block;white-space:pre;font-family:${cs.fontFamily};font-size:${cs.fontSize};font-weight:${cs.fontWeight};font-style:${cs.fontStyle};line-height:normal;`;
  d.textContent = 'Hg\nHg';
  probeHost.appendChild(d);
  v = d.getBoundingClientRect().height / 2;
  d.remove();
  lhProbeCache.set(k, v);
  return v;
}

export function removeProbe() { probeHost?.remove(); probeHost = null; }

function decorationFor(el: Element, stop: Element): { line?: 'UNDERLINE' | 'STRIKETHROUGH'; color?: RGBA; style?: string; thickness?: number; overline: boolean } {
  let cur: Element | null = el;
  const res: { line?: 'UNDERLINE' | 'STRIKETHROUGH'; color?: RGBA; style?: string; thickness?: number; overline: boolean } = { overline: false };
  while (cur) {
    const cs = getComputedStyle(cur);
    const l = cs.textDecorationLine;
    if (l && l !== 'none') {
      if (!res.line && l.includes('underline')) res.line = 'UNDERLINE';
      else if (!res.line && l.includes('line-through')) res.line = 'STRIKETHROUGH';
      if (l.includes('overline')) res.overline = true;
      if (res.line && !res.color) {
        res.color = parseColor(cs.textDecorationColor) ?? undefined;
        res.style = cs.textDecorationStyle;
        const t = cs.textDecorationThickness;
        if (t && t.endsWith('px')) res.thickness = parseFloat(t);
      }
    }
    if (cur === stop) {
      // украшения блока распространяются и с предков, пока не встретится атомарный/вынесенный блок
      const d = cs.display, p = cs.position, f = cs.cssFloat;
      if (/inline-|table|flex|grid/.test(d) && d !== 'inline' || p === 'absolute' || p === 'fixed' || f !== 'none') break;
      stop = cur.parentElement as Element;
    }
    cur = cur.parentElement;
    if (!cur || cur === document.documentElement) break;
  }
  return res;
}

export function textStyle(el: Element, F: Element): TextStyleInfo {
  const cached = styleCache.get(el);
  if (cached) return cached;
  const cs = getComputedStyle(el);
  const size = px(cs.fontSize);
  let lh: number;
  if (cs.lineHeight === 'normal') lh = normalLineHeight(cs);
  else if (/^[\d.]+$/.test(cs.lineHeight)) lh = parseFloat(cs.lineHeight) * size;
  else lh = px(cs.lineHeight);
  let color = parseColor(cs.color) ?? { r: 0, g: 0, b: 0, a: 1 };
  const fill = cs.getPropertyValue('-webkit-text-fill-color');
  let gradientText = false;
  const fc = parseColor(fill);
  if (fc && fill !== cs.color) {
    if (fc.a === 0) {
      // background-clip: text — цвет берётся из первого цвета фона-градиента
      let cur: Element | null = el;
      while (cur && cur !== F.parentElement) {
        const c2 = getComputedStyle(cur);
        if (c2.backgroundClip === 'text' || c2.getPropertyValue('-webkit-background-clip') === 'text') {
          const m = /(rgba?\([^)]*\)|color\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\))/.exec(c2.backgroundImage);
          const gc = m ? parseColor(m[1]) : parseColor(c2.backgroundColor);
          if (gc) { color = gc; gradientText = true; }
          break;
        }
        cur = cur.parentElement;
      }
      if (!gradientText) color = fc;
    } else color = fc;
  }
  // opacity inline-предков применяется к их содержимому
  let mul = 1;
  for (let cur: Element | null = el; cur && cur !== F; cur = cur.parentElement) {
    const c2 = getComputedStyle(cur);
    if (c2.display === 'inline' || c2.display === 'contents') mul *= parseFloat(c2.opacity);
  }
  color = { ...color, a: color.a * mul };
  const dec = decorationFor(el, F);
  let link: string | undefined;
  const a = el.closest('a[href]') as HTMLAnchorElement | null;
  if (a && /^(https?:|mailto:)/i.test(a.href) && !a.href.startsWith(location.origin)) link = a.href;
  const strokeW = px(cs.getPropertyValue('-webkit-text-stroke-width'));
  const st: TextStyleInfo = {
    el,
    families: parseFontFamilies(cs.fontFamily),
    size,
    weight: parseInt(cs.fontWeight, 10) || 400,
    italic: cs.fontStyle.startsWith('italic') || cs.fontStyle.startsWith('oblique'),
    color,
    lineHeight: lh,
    letterSpacing: cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing),
    wordSpacing: cs.wordSpacing === 'normal' ? 0 : px(cs.wordSpacing),
    transform: cs.textTransform,
    decoration: dec.line,
    decorationColor: dec.color,
    decorationStyle: dec.style === 'dotted' ? 'DOTTED' : dec.style === 'wavy' ? 'WAVY' : 'SOLID',
    decorationThickness: dec.thickness,
    overline: dec.overline,
    link,
    visible: cs.visibility === 'visible',
    smallCaps: cs.fontVariantCaps !== 'normal',
    verticalAlign: cs.verticalAlign,
    lang: (el.closest('[lang]')?.getAttribute('lang') || document.documentElement.lang || 'und'),
    shadow: cs.textShadow,
    stroke: strokeW > 0 ? { color: parseColor(cs.getPropertyValue('-webkit-text-stroke-color')) ?? color, width: strokeW } : undefined,
    gradientText,
  };
  styleCache.set(el, st);
  return st;
}

function applyTransform(ch: string, tt: string, lang: string, wordStart: boolean): string {
  try {
    if (tt === 'uppercase') return ch.toLocaleUpperCase(lang);
    if (tt === 'lowercase') return ch.toLocaleLowerCase(lang);
    if (tt === 'capitalize' && wordStart) return ch.toLocaleUpperCase(lang);
  } catch { /* неверный lang */ }
  if (tt === 'uppercase') return ch.toUpperCase();
  if (tt === 'lowercase') return ch.toLowerCase();
  if (tt === 'capitalize' && wordStart) return ch.toUpperCase();
  return ch;
}

// ---------- измерение символов ----------

const range = document.createRange();

export interface FirstLetterInfo { st: TextStyleInfo; count: number }

export function measureChars(items: InlineItem[], F: Element, firstLetter: FirstLetterInfo | null, stats: { chars: number; limitHit: boolean }, maxChars: number): MeasuredChar[] {
  const out: MeasuredChar[] = [];
  let pendingBreak = false;
  let prevChar = '';
  let flRemaining = firstLetter ? -1 : 0; // -1: ещё не начали
  for (const it of items) {
    if (it.kind === 'break' || it.kind === 'br') { pendingBreak = true; prevChar = ' '; continue; }
    if (it.kind === 'inline-start' || it.kind === 'inline-end') { if (it.hard) pendingBreak = true; continue; }
    const node = it.node;
    const parent = node.parentElement;
    if (!parent) continue;
    const st = textStyle(parent, F);
    const data = node.data;
    const ws = getComputedStyle(parent).whiteSpace;
    const preserve = ws === 'pre' || ws === 'pre-wrap' || ws === 'break-spaces';
    for (let i = 0; i < data.length;) {
      if (stats.chars >= maxChars) { stats.limitHit = true; return out; }
      const cp = data.codePointAt(i)!;
      const len = cp > 0xffff ? 2 : 1;
      const raw = data.slice(i, i + len);
      range.setStart(node, i);
      range.setEnd(node, i + len);
      const rects = range.getClientRects();
      let r: DOMRect | null = null;
      for (let k = 0; k < rects.length; k++) { if (rects[k].width > 0 || !r) r = rects[k]; }
      i += len;
      if (raw === '­') {
        if (r && r.width > 0 && out.length) out[out.length - 1].softHyphen = true;
        continue;
      }
      const isWs = /\s/.test(raw) && raw !== ' ';
      if (!r || (r.width === 0 && r.height === 0)) { if (isWs) continue; if (!r) continue; }
      if (isWs && r.width <= 0.01) continue; // схлопнутый пробел / пробел на переносе
      if (raw === '\t') { pendingBreak = true; prevChar = ' '; continue; }
      if (!st.visible) { pendingBreak = true; continue; }
      let ch = isWs ? (preserve && raw !== '\n' ? raw : ' ') : raw;
      if (raw === '\n' && !preserve) ch = ' ';
      if (raw === '\n' && preserve) { pendingBreak = true; continue; }
      const wordStart = !prevChar || /[\s \-–—(«"'“„]/.test(prevChar);
      ch = applyTransform(ch, st.transform, st.lang, wordStart);
      let style = st;
      let isFL = false;
      if (firstLetter && flRemaining !== 0) {
        // ::first-letter: начальная пунктуация + первая буква/цифра
        if (flRemaining === -1) flRemaining = 1;
        style = firstLetter.st;
        isFL = true;
        if (/[\p{L}\p{N}]/u.test(raw)) flRemaining = 0;
        ch = applyTransform(raw, style.transform, style.lang, true);
      }
      stats.chars++;
      out.push({ ch, x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, st: style, font: resolveFont(style, ch), node, offset: i - len, breakBefore: pendingBreak || undefined, firstLetter: isFL || undefined });
      pendingBreak = false;
      prevChar = raw;
    }
  }
  return out;
}

// ---------- строки, сегменты, ноды ----------

interface Line { chars: MeasuredChar[]; top: number; bottom: number; left: number; right: number }
interface Segment { chars: MeasuredChar[]; left: number; right: number; line: Line; maxSize: number; ref: MeasuredChar; firstLetter: boolean }

function splitLines(chars: MeasuredChar[]): Line[] {
  const lines: Line[] = [];
  let cur: Line | null = null;
  for (const c of chars) {
    if (cur) {
      const last = cur.chars[cur.chars.length - 1];
      const overlap = Math.min(cur.bottom, c.y + c.h) - Math.max(cur.top, c.y);
      const minH = Math.min(c.h, last.h) || 1;
      const wrapped = c.x + 0.5 < last.x && c.y > last.y + 0.25 * last.h;
      if (overlap < 0.3 * minH || wrapped) { lines.push(cur); cur = null; }
    }
    if (!cur) cur = { chars: [], top: c.y, bottom: c.y + c.h, left: c.x, right: c.x + c.w };
    cur.chars.push(c);
    cur.top = Math.min(cur.top, c.y);
    cur.bottom = Math.max(cur.bottom, c.y + c.h);
    cur.left = Math.min(cur.left, c.x);
    cur.right = Math.max(cur.right, c.x + c.w);
  }
  if (cur) lines.push(cur);
  return lines;
}

function splitSegments(line: Line): Segment[] {
  const segs: Segment[] = [];
  let cur: MeasuredChar[] = [];
  const flush = () => {
    if (!cur.length) return;
    // хвостовые пробелы сегмента не нужны
    while (cur.length > 1 && cur[cur.length - 1].ch === ' ') cur.pop();
    while (cur.length > 1 && cur[0].ch === ' ') cur.shift();
    if (cur.length === 1 && cur[0].ch === ' ') { cur = []; return; }
    const maxSize = Math.max(...cur.map((c) => c.st.size));
    const ref = cur.find((c) => c.st.size === maxSize)!;
    segs.push({ chars: cur, left: Math.min(...cur.map((c) => c.x)), right: Math.max(...cur.map((c) => c.x + c.w)), line, maxSize, ref, firstLetter: !!cur[0].firstLetter });
    cur = [];
  };
  for (const c of line.chars) {
    if (cur.length) {
      const p = cur[cur.length - 1];
      const gap = c.x - (p.x + p.w);
      const allowed = Math.max(1.5, 0.35 * Math.max(c.st.size, p.st.size)) + Math.max(0, p.st.letterSpacing) + Math.max(0, p.st.wordSpacing);
      const sizeJump = Math.max(c.st.size, p.st.size) / Math.max(0.01, Math.min(c.st.size, p.st.size)) > 1.3;
      const fl = !!c.firstLetter !== !!p.firstLetter;
      const vshift = Math.abs((c.y + c.h / 2) - (p.y + p.h / 2)) > 0.35 * Math.max(c.h, p.h);
      if (c.breakBefore || gap > allowed || gap < -Math.max(2, 0.5 * p.w) || sizeJump || fl || vshift) flush();
    }
    cur.push(c);
  }
  flush();
  return segs;
}

export interface FlowOptions { align: string; direction: string; clamp: number | null; ellipsis: { width: number } | null; vertical: boolean; name: string }

function alignOf(textAlign: string, direction: string): 'LEFT' | 'CENTER' | 'RIGHT' {
  const rtl = direction === 'rtl';
  switch (textAlign) {
    case 'center': case '-webkit-center': return 'CENTER';
    case 'right': case '-webkit-right': return 'RIGHT';
    case 'end': return rtl ? 'LEFT' : 'RIGHT';
    case 'start': return rtl ? 'RIGHT' : 'LEFT';
    default: return 'LEFT';
  }
}

function buildNode(segs: Segment[], align: 'LEFT' | 'CENTER' | 'RIGHT', name: string): TextNodeOut {
  let text = '';
  const runs: TextNodeOut['runs'] = [];
  const push = (s: string, st: TextStyleInfo, font: FontUse) => {
    const last = runs[runs.length - 1];
    if (last && last.st === st && last.font === font) { last.end += s.length; }
    else runs.push({ start: text.length, end: text.length + s.length, st, font });
    text += s;
  };
  segs.forEach((seg, li) => {
    if (li > 0) { const p = runs[runs.length - 1]; push('\n', p.st, p.font); }
    seg.chars.forEach((c, ci) => {
      push(c.ch, c.st, c.font);
      if (ci === seg.chars.length - 1 && li < segs.length - 1) {
        const next = segs[li + 1].chars[0];
        const midWord = /[\p{L}]/u.test(c.ch) && next && /[\p{L}]/u.test(next.ch);
        if (c.softHyphen || (midWord && getComputedStyle(c.st.el).hyphens === 'auto')) push('-', c.st, c.font);
      }
    });
  });
  const L = segs.length > 1 ? (segs[segs.length - 1].ref.y + segs[segs.length - 1].ref.h / 2 - (segs[0].ref.y + segs[0].ref.h / 2)) / (segs.length - 1) : segs[0].ref.st.lineHeight;
  const lineHeight = Math.max(0.5, L || segs[0].ref.st.lineHeight || segs[0].maxSize * 1.2);
  const ref = segs[0].ref;
  const y = ref.y + ref.h / 2 - lineHeight / 2;
  const left = Math.min(...segs.map((s) => s.left)), right = Math.max(...segs.map((s) => s.right));
  return { x: left, y, w: right - left, h: lineHeight * segs.length, text, runs, lineHeight, align, lines: segs.length, name };
}

/** Строит TEXT-ноды для одного inline formatting context. */
export function layoutFlow(chars: MeasuredChar[], opts: FlowOptions): TextNodeOut[] {
  if (!chars.length) return [];
  const align = alignOf(opts.align, opts.direction);
  if (opts.vertical) {
    const segs = splitLines(chars).flatMap(splitSegments);
    if (!segs.length) return [];
    const n = buildNode([{ ...segs[0], chars: segs.flatMap((s) => s.chars) }], 'LEFT', opts.name);
    const xs = chars.map((c) => c.x), ys = chars.map((c) => c.y);
    const x0 = Math.min(...xs), x1 = Math.max(...chars.map((c) => c.x + c.w)), y0 = Math.min(...ys), y1 = Math.max(...chars.map((c) => c.y + c.h));
    return [{ ...n, x: x0, y: y0, w: y1 - y0, h: x1 - x0, lineHeight: x1 - x0, vertical: true }];
  }
  const lines = splitLines(chars);
  const out: TextNodeOut[] = [];
  let acc: Segment[] = [];
  const flush = () => { if (acc.length) out.push(buildNode(acc, align, opts.name)); acc = []; };
  const keyX = (s: Segment) => (align === 'LEFT' ? s.left : align === 'RIGHT' ? s.right : (s.left + s.right) / 2);
  const centerY = (s: Segment) => s.ref.y + s.ref.h / 2;
  for (const line of lines) {
    const segs = splitSegments(line);
    if (segs.length !== 1 || segs[0].firstLetter) {
      flush();
      for (const s of segs) out.push(buildNode([s], s.firstLetter ? 'LEFT' : align, opts.name));
      continue;
    }
    const s = segs[0];
    if (acc.length) {
      const prev = acc[acc.length - 1];
      const tol = align === 'CENTER' ? 1.5 : 1;
      const pitch = centerY(s) - centerY(prev);
      const pitchOk = acc.length === 1 ? pitch > 0.5 * prev.maxSize && pitch < 2.2 * Math.max(prev.ref.st.lineHeight, prev.maxSize) : Math.abs(pitch - (centerY(prev) - centerY(acc[acc.length - 2]))) < 0.75;
      const sameSize = Math.abs(s.maxSize - prev.maxSize) < 0.01 && s.ref.st.lineHeight === prev.ref.st.lineHeight;
      if (Math.abs(keyX(s) - keyX(prev)) > tol || !pitchOk || !sameSize) flush();
    }
    acc.push(s);
  }
  flush();
  if (opts.clamp && out.length) {
    // -webkit-line-clamp: оставляем N+1 строк, Figma дорисует многоточие (maxLines = N)
    const n = out[0];
    if (n.lines > opts.clamp) {
      const keep = n.text.split('\n').slice(0, opts.clamp + 1).join('\n');
      n.text = keep;
      n.runs = n.runs.filter((r) => r.start < keep.length).map((r) => ({ ...r, end: Math.min(r.end, keep.length) }));
      n.lines = opts.clamp + 1;
      n.h = n.lineHeight * opts.clamp;
      n.truncate = opts.clamp;
    }
    out.length = 1;
  }
  if (opts.ellipsis && out.length === 1 && out[0].lines === 1) {
    out[0].truncate = 1;
    out[0].fixedWidth = opts.ellipsis.width;
  }
  return out;
}

export function textShadowOf(st: TextStyleInfo) {
  return st.shadow && st.shadow !== 'none' ? parseShadows(st.shadow, false) : [];
}
