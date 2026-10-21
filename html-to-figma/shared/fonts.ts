/*
 * Сопоставление шрифтов.
 *  1) cssMatchFace — алгоритм подбора начертания CSS Fonts 4 среди загруженных @font-face
 *     (какой файл реально использовал браузер для weight/style).
 *  2) matchFigmaFont — поиск начертания среди шрифтов, доступных в Figma
 *     (listAvailableFontsAsync). Подмена другим семейством НЕ выполняется.
 */
import type { FontRequirement } from './schema';

export interface FaceDescriptor { weightMin: number; weightMax: number; italic: boolean; oblique: boolean }

export function parseWeightDescriptor(w: string): [number, number] {
  const p = String(w).trim().split(/\s+/).map((x) => (x === 'normal' ? 400 : x === 'bold' ? 700 : parseFloat(x)));
  const a = Number.isFinite(p[0]) ? p[0] : 400;
  const b = p.length > 1 && Number.isFinite(p[1]) ? p[1] : a;
  return [Math.min(a, b), Math.max(a, b)];
}

/** Возвращает выбранное начертание и итоговый вес (для вариативного — запрошенный). */
export function cssMatchFace(faces: FaceDescriptor[], weight: number, italic: boolean): { face: FaceDescriptor; weight: number; syntheticBold: boolean; syntheticItalic: boolean } | null {
  if (!faces.length) return null;
  let pool = italic ? faces.filter((f) => f.italic) : faces.filter((f) => !f.italic && !f.oblique);
  if (!pool.length && italic) pool = faces.filter((f) => f.oblique);
  if (!pool.length) pool = italic ? faces.filter((f) => !f.italic && !f.oblique) : faces.filter((f) => f.oblique);
  if (!pool.length) pool = faces;
  const syntheticItalic = italic && !pool.some((f) => f.italic || f.oblique);
  const inRange = pool.find((f) => weight >= f.weightMin && weight <= f.weightMax);
  let chosen: FaceDescriptor;
  let w: number;
  if (inRange) { chosen = inRange; w = weight; }
  else {
    // CSS Fonts 4 §5.2: 400–500 — сначала тяжелее до 500, затем легче, затем тяжелее;
    // < 400 — легче, затем тяжелее; > 500 — тяжелее, затем легче.
    const dist = (f: FaceDescriptor) => (weight < f.weightMin ? f.weightMin : f.weightMax);
    const lighter = pool.filter((f) => f.weightMax < weight).sort((a, b) => b.weightMax - a.weightMax);
    const heavier = pool.filter((f) => f.weightMin > weight).sort((a, b) => a.weightMin - b.weightMin);
    let order: FaceDescriptor[];
    if (weight >= 400 && weight <= 500) {
      const upTo500 = heavier.filter((f) => f.weightMin <= 500);
      const beyond = heavier.filter((f) => f.weightMin > 500);
      order = [...upTo500, ...lighter, ...beyond];
    } else if (weight < 400) order = [...lighter, ...heavier];
    else order = [...heavier, ...lighter];
    chosen = order[0];
    w = dist(chosen);
  }
  const syntheticBold = weight >= 600 && w <= 500;
  return { face: chosen, weight: w, syntheticBold, syntheticItalic };
}

const STYLE_WEIGHTS: Array<[RegExp, number]> = [
  [/(hairline|thin)/, 100],
  [/(extra|ultra)light/, 200],
  [/light/, 300],
  [/(semi|demi)bold/, 600],
  [/(extra|ultra)bold/, 800],
  [/(black|heavy)/, 900],
  [/bold/, 700],
  [/medium/, 500],
  [/(regular|normal|book|roman)/, 400],
];

export function styleWeight(style: string): number {
  const s = style.toLowerCase().replace(/[\s_-]/g, '');
  for (const [re, w] of STYLE_WEIGHTS) if (re.test(s)) return w;
  return 400;
}
export const styleItalic = (style: string) => /italic|oblique|kursiv/i.test(style);

/**
 * Начертание по PostScript-имени системного шрифта: «LiberationSerif» → 400,
 * «Arial-BoldItalicMT» → 700 курсив, «DejaVuSansMono-BoldOblique» → 700 курсив.
 * Нет суффикса стиля → обычное начертание.
 */
export function faceFromPostScript(ps: string | undefined): { weight: number; italic: boolean } | null {
  if (!ps) return null;
  const i = ps.lastIndexOf('-');
  const suffix = i > 0 ? ps.slice(i + 1).replace(/(MT|PS)+$/, '') : '';
  if (!suffix) return { weight: 400, italic: false };
  const italic = /italic|oblique|^it$|kursiv/i.test(suffix);
  return { weight: styleWeight(suffix.replace(/italic|oblique|kursiv/gi, '') || 'regular'), italic };
}

const KNOWN_SUFFIX = /^(?:(?:hairline|thin|extralight|ultralight|light|regular|normal|book|roman|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy)(?:italic|oblique)?|italic|oblique)$/;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export interface FigmaFontLite { family: string; style: string }

export interface FontMatch {
  key: string;
  font: FigmaFontLite | null;
  /** Для вариативного семейства — значение оси wght. */
  variation?: number;
  exact: boolean;
  note?: string;
}

/**
 * Ищет начертание среди доступных в Figma. Допускает именование статических TTF
 * как «Семейство / Стиль» или «Семейство Стиль / Regular», но только с известными
 * суффиксами стиля — другое семейство никогда не выбирается.
 */
export function matchFigmaFont(req: Pick<FontRequirement, 'key' | 'family' | 'weight' | 'italic' | 'fileFamily'>, available: FigmaFontLite[], variableFamilies?: Set<string>): FontMatch {
  const names = [req.family, req.fileFamily].filter(Boolean).map((x) => norm(x!));
  const faces: Array<{ font: FigmaFontLite; style: string; exact: boolean }> = [];
  for (const f of available) {
    const fam = norm(f.family);
    for (const base of names) {
      let suffix: string | null = null;
      if (fam === base) suffix = '';
      else if (fam.startsWith(base + ' ')) suffix = fam.slice(base.length + 1);
      if (suffix === null) continue;
      if (suffix && !KNOWN_SUFFIX.test(suffix.replace(/[\s_-]/g, '').toLowerCase())) continue;
      faces.push({ font: f, style: (suffix + ' ' + f.style).trim(), exact: suffix === '' });
      break;
    }
  }
  if (!faces.length) return { key: req.key, font: null, exact: false, note: 'семейство отсутствует' };
  const sameStyle = faces.filter((x) => styleItalic(x.style) === req.italic);
  const exact = sameStyle.filter((x) => styleWeight(x.style) === req.weight).sort((a, b) => Number(b.exact) - Number(a.exact) || a.style.length - b.style.length);
  if (exact.length) return { key: req.key, font: exact[0].font, exact: true };
  // Вариативное семейство: подойдёт любой стиль с тем же наклоном + ось wght.
  const fam = faces[0].font.family;
  if (variableFamilies && variableFamilies.has(fam) && sameStyle.length) {
    const base = sameStyle.sort((a, b) => Math.abs(styleWeight(a.style) - req.weight) - Math.abs(styleWeight(b.style) - req.weight))[0];
    return { key: req.key, font: base.font, variation: req.weight, exact: true, note: 'вариативная ось wght' };
  }
  return { key: req.key, font: null, exact: false, note: `нет начертания ${req.weight}${req.italic ? ' Italic' : ''} (есть: ${[...new Set(faces.map((f) => f.font.style))].join(', ')})` };
}

/** Человекочитаемое имя требования для UI. */
export function describeFont(req: Pick<FontRequirement, 'family' | 'weight' | 'italic'>): string {
  const names: Record<number, string> = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };
  const w = names[Math.round(req.weight / 100) * 100] ?? String(req.weight);
  return `${req.family} ${w}${req.italic ? ' Italic' : ''}`.replace('Regular Italic', 'Italic');
}

/** Длина строки в UTF-16 (то, чем оперирует API диапазонов Figma). */
export const utf16Length = (s: string) => s.length;

/** Разбивает строку на code points, сохраняя суррогатные пары. */
export function codePoints(s: string): string[] {
  return Array.from(s);
}
