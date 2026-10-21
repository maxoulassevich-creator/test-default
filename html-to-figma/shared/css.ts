/*
 * Разбор вычисленных (computed) значений CSS, которые возвращает Chromium:
 * тени, градиенты, слои фона, списки семейств шрифтов, радиусы.
 * Все функции чистые и покрыты unit-тестами.
 */
import { parseColor, splitTopLevel } from './color';
import type { EffectIR, GradientStopIR, Mat, PaintIR, RGBA } from './schema';
import { invert, multiply } from './matrix';

export interface ShadowSpec { color: RGBA; x: number; y: number; blur: number; spread: number; inset: boolean }

/** box-shadow / text-shadow: "rgba(...) 0px 4px 12px 0px inset, ..." (цвет может быть в начале или в конце). */
export function parseShadows(value: string, allowSpread = true): ShadowSpec[] | null {
  if (!value || value === 'none') return [];
  const out: ShadowSpec[] = [];
  for (const layer of splitTopLevel(value, ',')) {
    const toks = splitTopLevel(layer, ' ');
    let inset = false;
    let color: RGBA | null = null;
    const lens: number[] = [];
    for (const t of toks) {
      if (t === 'inset') { inset = true; continue; }
      if (/^-?[\d.]+(px)?$/.test(t)) { lens.push(parseFloat(t)); continue; }
      const c = parseColor(t);
      if (c) { color = c; continue; }
      return null;
    }
    if (lens.length < 2) return null;
    out.push({
      color: color ?? { r: 0, g: 0, b: 0, a: 1 },
      x: lens[0], y: lens[1], blur: Math.max(0, lens[2] ?? 0), spread: allowSpread ? lens[3] ?? 0 : 0, inset,
    });
  }
  return out;
}

/** CSS box-shadow → эффекты Figma. Порядок: первая CSS-тень рисуется сверху. */
export function shadowsToEffects(shadows: ShadowSpec[]): EffectIR[] {
  return shadows
    .filter((s) => s.color.a > 0)
    .map((s) => ({ type: s.inset ? 'INNER_SHADOW' : 'DROP_SHADOW', color: s.color, x: s.x, y: s.y, blur: s.blur, spread: s.spread } as EffectIR))
    .reverse();
}

/** Список font-family с учётом кавычек. */
export function parseFontFamilies(value: string): string[] {
  return splitTopLevel(value, ',')
    .map((f) => f.trim().replace(/^['"]|['"]$/g, '').replace(/\\(.)/g, '$1').trim())
    .filter(Boolean);
}

export const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif',
  'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', '-apple-system', 'blinkmacsystemfont',
]);
export const isGeneric = (f: string) => GENERIC_FAMILIES.has(f.toLowerCase());

export interface RawStop { color: RGBA; pos?: number; posPx?: number; hint?: boolean }

function parseStops(parts: string[]): RawStop[] | null {
  const stops: RawStop[] = [];
  for (const p of parts) {
    const toks = splitTopLevel(p, ' ');
    let color: RGBA | null = null;
    const positions: string[] = [];
    for (const t of toks) {
      const c = parseColor(t);
      if (c) color = c;
      else if (/^-?[\d.]+(%|px)?$/.test(t)) positions.push(t);
      else return null;
    }
    if (!color) {
      // интерполяционная подсказка (color hint) — отбрасывается
      if (positions.length === 1) { stops.push({ color: { r: 0, g: 0, b: 0, a: 0 }, hint: true }); continue; }
      return null;
    }
    if (!positions.length) stops.push({ color });
    for (const pos of positions) {
      if (pos.endsWith('px')) stops.push({ color, posPx: parseFloat(pos) });
      else stops.push({ color, pos: parseFloat(pos) / 100 });
    }
  }
  return stops;
}

/** Расставляет недостающие позиции, приводит к 0..1 и учитывает предумноженную альфу CSS. */
export function normalizeStops(raw: RawStop[], lengthPx: number): { stops: GradientStopIR[]; hints: boolean } {
  const hints = raw.some((s) => s.hint);
  const list = raw.filter((s) => !s.hint).map((s) => ({ color: s.color, pos: s.pos ?? (s.posPx !== undefined && lengthPx > 0 ? s.posPx / lengthPx : undefined) }));
  if (!list.length) return { stops: [], hints };
  if (list[0].pos === undefined) list[0].pos = 0;
  if (list[list.length - 1].pos === undefined) list[list.length - 1].pos = 1;
  // монотонность
  let maxSoFar = list[0].pos!;
  for (const s of list) {
    if (s.pos !== undefined) { if (s.pos < maxSoFar) s.pos = maxSoFar; maxSoFar = s.pos; }
  }
  // равномерное распределение пропусков
  for (let i = 0; i < list.length; i++) {
    if (list[i].pos !== undefined) continue;
    let j = i;
    while (list[j].pos === undefined) j++;
    const a = list[i - 1].pos!, b = list[j].pos!;
    for (let k = i; k < j; k++) list[k].pos = a + ((b - a) * (k - i + 1)) / (j - i + 1);
  }
  const lerp = (x: RGBA, y: RGBA, t: number): RGBA => {
    // интерполяция в предумноженном пространстве, как в CSS
    const a = x.a + (y.a - x.a) * t;
    if (a <= 0) return { r: x.r, g: x.g, b: x.b, a: 0 };
    const pm = (c: 'r' | 'g' | 'b') => (x[c] * x.a + (y[c] * y.a - x[c] * x.a) * t) / a;
    return { r: pm('r'), g: pm('g'), b: pm('b'), a };
  };
  const colorAt = (p: number): RGBA => {
    if (p <= list[0].pos!) return list[0].color;
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      if (p <= b.pos!) {
        const span = b.pos! - a.pos!;
        return span <= 0 ? b.color : lerp(a.color, b.color, (p - a.pos!) / span);
      }
    }
    return list[list.length - 1].color;
  };
  // обрезка к [0, 1]
  const inside = list.filter((s) => s.pos! >= 0 && s.pos! <= 1).map((s) => ({ position: s.pos!, color: s.color }));
  if (!inside.length || inside[0].position > 0) inside.unshift({ position: 0, color: colorAt(0) });
  if (inside[inside.length - 1].position < 1) inside.push({ position: 1, color: colorAt(1) });
  // прозрачные остановки получают RGB соседей (Figma интерполирует без предумножения)
  const out: GradientStopIR[] = [];
  for (let i = 0; i < inside.length; i++) {
    const s = inside[i];
    if (s.color.a > 0.001) { out.push(s); continue; }
    const prev = inside[i - 1], next = inside[i + 1];
    if (prev && next && (prev.color.r !== next.color.r || prev.color.g !== next.color.g || prev.color.b !== next.color.b) && prev.color.a > 0 && next.color.a > 0) {
      out.push({ position: s.position, color: { ...prev.color, a: 0 } });
      out.push({ position: Math.min(1, s.position + 1e-4), color: { ...next.color, a: 0 } });
    } else {
      const src = prev && prev.color.a > 0 ? prev.color : next ? next.color : prev?.color ?? s.color;
      out.push({ position: s.position, color: { r: src.r, g: src.g, b: src.b, a: 0 } });
    }
  }
  return { stops: out.map((s) => ({ position: Math.min(1, Math.max(0, s.position)), color: s.color })), hints };
}

export interface GradientResult { paint: PaintIR | null; approx: string[] }

function sideAngle(dir: string, w: number, h: number): number | null {
  // "to right", "to top left" ... → угол CSS в градусах
  const words = dir.replace(/^to\s+/, '').split(/\s+/);
  const has = (x: string) => words.includes(x);
  if (words.length === 1) {
    return { top: 0, right: 90, bottom: 180, left: 270 }[words[0]] ?? null;
  }
  // угловые направления: перпендикуляр к диагонали, указывающий в угол
  const ang = (Math.atan2(w, h) * 180) / Math.PI; // угол диагонали
  if (has('top') && has('right')) return ang;
  if (has('bottom') && has('right')) return 180 - ang;
  if (has('bottom') && has('left')) return 180 + ang;
  if (has('top') && has('left')) return 360 - ang;
  return null;
}

/** Преобразование из пикселей ноды в нормализованные 0..1. */
const pxToUnit = (w: number, h: number): Mat => [1 / w, 0, 0, 1 / h, 0, 0];

/**
 * Figma gradientTransform переводит нормализованные координаты ноды в пространство
 * градиента (линейный: от (0, .5) к (1, .5); радиальный: центр (.5,.5), радиус .5).
 * Строим обратное отображение (градиент → пиксели) и обращаем его.
 */
function figmaTransformFromGradientToPx(g2px: Mat, w: number, h: number): Mat | null {
  const g2unit = multiply(pxToUnit(w, h), g2px);
  return invert(g2unit);
}

function parsePosition(tokens: string[], w: number, h: number): [number, number] {
  // computed значения: "50% 50%", "30% 20%", "left top", "10px 20px"
  const kw: Record<string, number> = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 };
  let x = 0.5 * w, y = 0.5 * h;
  if (!tokens.length) return [x, y];
  const val = (t: string, ref: number) => (t in kw ? kw[t] * ref : t.endsWith('%') ? (parseFloat(t) / 100) * ref : parseFloat(t));
  if (tokens.length === 1) {
    const t = tokens[0];
    if (t === 'top' || t === 'bottom') y = val(t, h);
    else x = val(t, w);
    return [x, y];
  }
  let [a, b] = tokens;
  if (a === 'top' || a === 'bottom' || b === 'left' || b === 'right') [a, b] = [b, a];
  x = val(a, w);
  y = val(b, h);
  return [x, y];
}

export function parseGradient(value: string, w: number, h: number): GradientResult {
  const approx: string[] = [];
  const m = /^(repeating-)?(linear|radial|conic)-gradient\((.*)\)$/s.exec(value.trim());
  if (!m || w <= 0 || h <= 0) return { paint: null, approx: ['unparsed'] };
  if (m[1]) return { paint: null, approx: ['repeating'] };
  const kind = m[2];
  const parts = splitTopLevel(m[3], ',');
  let first = parts[0];
  const firstIsStop = parseStops([first]) !== null && !/^(to |at |circle|ellipse|from |in )/.test(first) && !/deg|turn|rad|grad/.test(first.split(' ')[0]);
  const config = firstIsStop ? '' : first;
  const stopParts = firstIsStop ? parts : parts.slice(1);
  if (/\bin\s+\w/.test(config)) approx.push('color-interpolation-space');
  const cfg = config.replace(/\bin\s+[\w-]+(\s+(shorter|longer|increasing|decreasing)\s+hue)?/, '').trim();
  const raw = parseStops(stopParts);
  if (!raw) return { paint: null, approx: ['unparsed-stops'] };

  if (kind === 'linear') {
    let deg = 180;
    if (cfg) {
      if (cfg.startsWith('to ')) {
        const a = sideAngle(cfg, w, h);
        if (a === null) return { paint: null, approx: ['unparsed-direction'] };
        deg = a;
      } else {
        const v = parseFloat(cfg);
        if (!Number.isFinite(v)) return { paint: null, approx: ['unparsed-angle'] };
        deg = cfg.endsWith('turn') ? v * 360 : cfg.endsWith('rad') ? (v * 180) / Math.PI : cfg.endsWith('grad') ? v * 0.9 : v;
      }
    }
    const t = (deg * Math.PI) / 180;
    const dx = Math.sin(t), dy = -Math.cos(t);
    const L = Math.abs(w * dx) + Math.abs(h * dy);
    const cx = w / 2, cy = h / 2;
    const sx = cx - (dx * L) / 2, sy = cy - (dy * L) / 2;
    // градиент → пиксели: (u,v) → S + u*L*d + (v-0.5)*L*n, n ⟂ d
    const nx = -dy, ny = dx;
    const g2px: Mat = [dx * L, dy * L, nx * L, ny * L, sx - 0.5 * nx * L, sy - 0.5 * ny * L];
    const tr = figmaTransformFromGradientToPx(g2px, w, h);
    const { stops, hints } = normalizeStops(raw, L);
    if (hints) approx.push('color-hint');
    if (!tr || stops.length < 2) return { paint: null, approx: [...approx, 'degenerate'] };
    return { paint: { type: 'GRADIENT_LINEAR', stops, transform: tr, opacity: 1 }, approx };
  }

  if (kind === 'radial') {
    // формат computed: "[circle|ellipse] [size] [at pos]" или "Rx Ry at pos"
    let shape = 'ellipse', sizeKw = 'farthest-corner', pos: string[] = [];
    let explicit: number[] | null = null;
    if (cfg) {
      const [lhs, rhs] = cfg.split(/\s*\bat\b\s*/);
      if (rhs !== undefined) pos = rhs.trim().split(/\s+/);
      const toks = (lhs || '').trim().split(/\s+/).filter(Boolean);
      const lens: number[] = [];
      for (const t of toks) {
        if (t === 'circle' || t === 'ellipse') shape = t;
        else if (/^(closest|farthest)-(side|corner)$/.test(t)) sizeKw = t;
        else if (/^[\d.]+(px|%)$/.test(t)) lens.push(t.endsWith('%') ? (parseFloat(t) / 100) * (lens.length === 0 ? w : h) : parseFloat(t));
        else return { paint: null, approx: ['unparsed-radial'] };
      }
      if (lens.length) explicit = lens.length === 1 ? [lens[0], lens[0]] : [lens[0], lens[1]];
      if (lens.length === 1) shape = 'circle';
    }
    const [cx, cy] = parsePosition(pos, w, h);
    let rx: number, ry: number;
    if (explicit) [rx, ry] = explicit;
    else {
      const dl = cx, dr = w - cx, dt = cy, db = h - cy;
      const side = sizeKw.endsWith('side');
      const closest = sizeKw.startsWith('closest');
      if (shape === 'circle') {
        if (side) rx = ry = closest ? Math.min(dl, dr, dt, db) : Math.max(dl, dr, dt, db);
        else {
          const corners = [Math.hypot(dl, dt), Math.hypot(dr, dt), Math.hypot(dl, db), Math.hypot(dr, db)];
          rx = ry = closest ? Math.min(...corners) : Math.max(...corners);
        }
      } else {
        const sxv = closest ? Math.min(dl, dr) : Math.max(dl, dr);
        const syv = closest ? Math.min(dt, db) : Math.max(dt, db);
        if (side) { rx = sxv; ry = syv; }
        else { rx = sxv * Math.SQRT2; ry = syv * Math.SQRT2; }
      }
    }
    if (!(rx > 0) || !(ry > 0)) return { paint: null, approx: ['degenerate'] };
    const g2px: Mat = [2 * rx, 0, 0, 2 * ry, cx - rx, cy - ry];
    const tr = figmaTransformFromGradientToPx(g2px, w, h);
    const { stops, hints } = normalizeStops(raw, rx);
    if (hints) approx.push('color-hint');
    if (!tr || stops.length < 2) return { paint: null, approx: [...approx, 'degenerate'] };
    return { paint: { type: 'GRADIENT_RADIAL', stops, transform: tr, opacity: 1 }, approx };
  }

  // conic
  let from = 0, pos: string[] = [];
  if (cfg) {
    const fm = /from\s+(-?[\d.]+)(deg|turn|rad|grad)?/.exec(cfg);
    if (fm) from = fm[2] === 'turn' ? parseFloat(fm[1]) * 360 : fm[2] === 'rad' ? (parseFloat(fm[1]) * 180) / Math.PI : parseFloat(fm[1]);
    const am = /\bat\s+(.*)$/.exec(cfg);
    if (am) pos = am[1].trim().split(/\s+/);
  }
  const [cx, cy] = parsePosition(pos, w, h);
  // Figma: угловой градиент начинается в направлении +x пространства градиента и идёт по часовой.
  // CSS: 0deg = вверх, по часовой. Поворачиваем на (from - 90)°.
  const r = Math.max(w, h);
  const a = ((from - 90) * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const g2px: Mat = [2 * r * c, 2 * r * s, -2 * r * s, 2 * r * c, cx - r * c + r * s, cy - r * s - r * c];
  const tr = figmaTransformFromGradientToPx(g2px, w, h);
  const { stops, hints } = normalizeStops(raw, 1);
  approx.push('conic');
  if (hints) approx.push('color-hint');
  if (!tr || stops.length < 2) return { paint: null, approx: [...approx, 'degenerate'] };
  return { paint: { type: 'GRADIENT_ANGULAR', stops, transform: tr, opacity: 1 }, approx };
}

/** Радиусы углов с нормализацией CSS (уменьшение при переполнении сторон). */
export function normalizeRadii(
  raw: Array<[number, number]>, // tl, tr, br, bl: [rx, ry]
  w: number,
  h: number,
): { radii: [number, number, number, number]; elliptical: boolean; ellipse: boolean } {
  const [tl, tr, br, bl] = raw.map(([x, y]) => [Math.max(0, x || 0), Math.max(0, y || 0)] as [number, number]);
  let f = 1;
  const check = (sum: number, side: number) => { if (sum > side && sum > 0) f = Math.min(f, side / sum); };
  check(tl[0] + tr[0], w);
  check(bl[0] + br[0], w);
  check(tl[1] + bl[1], h);
  check(tr[1] + br[1], h);
  const corners = [tl, tr, br, bl].map(([x, y]) => [x * f, y * f]);
  const elliptical = corners.some(([x, y]) => Math.abs(x - y) > 0.5);
  const ellipse = elliptical && corners.every(([x, y]) => Math.abs(x - w / 2) < 0.5 && Math.abs(y - h / 2) < 0.5);
  const radii = corners.map(([x, y]) => Math.min(x, y)) as [number, number, number, number];
  return { radii, elliptical, ellipse };
}

export function parseRadius(value: string, w: number, h: number): [number, number] {
  const p = value.trim().split(/\s+/);
  const v = (t: string, ref: number) => (t.endsWith('%') ? (parseFloat(t) / 100) * ref : parseFloat(t) || 0);
  const rx = v(p[0] ?? '0', w);
  const ry = p.length > 1 ? v(p[1], h) : p[0]?.endsWith('%') ? v(p[0], h) : rx;
  return [rx, ry];
}

/** filter: blur()/drop-shadow()/цветовые функции. */
export interface FilterSpec { blur: number; dropShadows: ShadowSpec[]; color: string[]; other: string[] }

export function parseFilter(value: string): FilterSpec {
  const spec: FilterSpec = { blur: 0, dropShadows: [], color: [], other: [] };
  if (!value || value === 'none') return spec;
  const re = /([a-z-]+)\(((?:[^()]|\([^()]*\))*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) {
    const fn = m[1], arg = m[2].trim();
    if (fn === 'blur') spec.blur += parseFloat(arg) || 0;
    else if (fn === 'drop-shadow') {
      const s = parseShadows(arg, false);
      if (s && s.length) spec.dropShadows.push(...s);
      else spec.other.push(m[0]);
    } else if (['grayscale', 'sepia', 'saturate', 'hue-rotate', 'invert', 'opacity', 'brightness', 'contrast'].includes(fn)) {
      spec.color.push(m[0]);
    } else spec.other.push(m[0]);
  }
  if (/url\(/.test(value)) spec.other.push('url()');
  return spec;
}

/** Цветовые фильтры, не меняющие изображение (identity), отбрасываются. */
export function isIdentityColorFilter(f: string): boolean {
  const m = /^([a-z-]+)\(([^)]*)\)$/.exec(f.trim());
  if (!m) return false;
  const v = parseFloat(m[2]);
  const pct = m[2].trim().endsWith('%') ? v / 100 : v;
  switch (m[1]) {
    case 'grayscale': case 'sepia': case 'invert': return pct === 0;
    case 'saturate': case 'brightness': case 'contrast': case 'opacity': return pct === 1;
    case 'hue-rotate': return v === 0;
  }
  return false;
}

export const CSS_BLEND: Record<string, string> = {
  normal: 'NORMAL', multiply: 'MULTIPLY', screen: 'SCREEN', overlay: 'OVERLAY', darken: 'DARKEN', lighten: 'LIGHTEN',
  'color-dodge': 'COLOR_DODGE', 'color-burn': 'COLOR_BURN', 'hard-light': 'HARD_LIGHT', 'soft-light': 'SOFT_LIGHT',
  difference: 'DIFFERENCE', exclusion: 'EXCLUSION', hue: 'HUE', saturation: 'SATURATION', color: 'COLOR', luminosity: 'LUMINOSITY',
  'plus-lighter': 'LINEAR_DODGE', 'plus-darker': 'LINEAR_BURN',
};

/** clip-path: inset(t r b l [round r]) в px/% (вычисленное значение). */
export function parseInset(v: string, w: number, h: number): { empty: boolean; zero: boolean; round: number } | null {
  const m = /^inset\(([^)]*)\)$/.exec(v.trim());
  if (!m || /calc|var|\//.test(m[1])) return null;
  const [box, round] = m[1].split(/\s+round\s+/);
  const parts = box.trim().split(/\s+/);
  if (!parts.length || parts.length > 4) return null;
  const val = (t: string, ref: number) => (t.endsWith('%') ? (parseFloat(t) / 100) * ref : t === '0' ? 0 : t.endsWith('px') ? parseFloat(t) : NaN);
  const [t, r = t, b = t, l = r] = parts;
  const top = val(t, h), right = val(r, w), bottom = val(b, h), left = val(l, w);
  if (![top, right, bottom, left].every(Number.isFinite)) return null;
  let rr = 0;
  if (round) {
    const rs = round.trim().split(/\s+/);
    if (rs.length !== 1 || !rs[0].endsWith('px')) return null;
    rr = parseFloat(rs[0]);
  }
  return { empty: w - left - right <= 0.01 || h - top - bottom <= 0.01, zero: Math.max(Math.abs(top), Math.abs(right), Math.abs(bottom), Math.abs(left)) < 0.01, round: rr };
}
