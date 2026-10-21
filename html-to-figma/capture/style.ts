/*
 * Снимок вычисленных стилей. Читаем всё в фазе A (обычное состояние страницы),
 * потому что в фазе B transforms временно нейтрализованы и live-объект
 * CSSStyleDeclaration показал бы уже изменённые значения.
 */

export const STYLE_PROPS = [
  'display', 'position', 'visibility', 'opacity', 'z-index', 'float', 'overflow-x', 'overflow-y',
  'transform', 'translate', 'rotate', 'scale', 'transform-origin', 'transform-style', 'perspective', 'zoom',
  'filter', 'backdrop-filter', 'mix-blend-mode', 'isolation', 'will-change', 'contain', 'container-type',
  'clip-path', 'mask-image', '-webkit-mask-image', 'offset-path',
  'background-color', 'background-image', 'background-size', 'background-position-x', 'background-position-y',
  'background-repeat', 'background-origin', 'background-clip', 'background-attachment', 'background-blend-mode',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
  'border-image-source',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-left', 'margin-right',
  'box-shadow', 'outline-style', 'outline-width', 'outline-color', 'outline-offset',
  'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant-caps', 'font-stretch', 'line-height',
  'letter-spacing', 'word-spacing', 'text-transform', 'text-align', 'text-align-last', 'direction', 'writing-mode',
  'text-decoration-line', 'text-decoration-color', 'text-decoration-style', 'text-decoration-thickness',
  'text-shadow', 'text-overflow', 'white-space', '-webkit-line-clamp', '-webkit-text-fill-color',
  '-webkit-text-stroke-width', '-webkit-text-stroke-color', 'text-indent', 'list-style-type', 'list-style-position',
  'content', 'object-fit', 'object-position', 'appearance', 'pointer-events', 'cursor', 'width', 'height', 'box-sizing',
  'counter-reset', 'counter-increment', 'hyphens', 'vertical-align', 'image-rendering',
] as const;

export type StyleProp = typeof STYLE_PROPS[number];
export type StyleSnap = Record<StyleProp, string>;

export function snapStyle(cs: CSSStyleDeclaration): StyleSnap {
  const out = {} as StyleSnap;
  for (const p of STYLE_PROPS) out[p] = cs.getPropertyValue(p);
  return out;
}

export const px = (v: string | undefined | null): number => {
  if (!v) return 0;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

export function describe(el: Element): string {
  let s = el.tagName.toLowerCase();
  if (el.id) s += '#' + el.id;
  const cls = typeof el.className === 'string' ? el.className : (el.getAttribute('class') ?? '');
  const first = cls.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (first.length) s += '.' + first.join('.');
  return s.slice(0, 80);
}

export const isInlineDisplay = (d: string) => d === 'inline' || d === 'ruby' || d === 'ruby-text';

export function hasTransform(s: Pick<StyleSnap, 'transform' | 'translate' | 'rotate' | 'scale'>): boolean {
  return (s.transform !== 'none' && s.transform !== '') || (s.translate !== 'none' && s.translate !== '') ||
    (s.rotate !== 'none' && s.rotate !== '') || (s.scale !== 'none' && s.scale !== '');
}

export function clipsContent(s: StyleSnap): boolean {
  return s['overflow-x'] !== 'visible' || s['overflow-y'] !== 'visible';
}

/** Элемент создаёт containing block для absolute/fixed потомков. */
export function establishesCB(s: StyleSnap, forFixed: boolean): boolean {
  if (!forFixed && s.position !== 'static') return true;
  if (hasTransform(s) || s.perspective !== 'none' || s.filter !== 'none' || (s['backdrop-filter'] && s['backdrop-filter'] !== 'none')) return true;
  if (/transform|perspective|filter/.test(s['will-change'])) return true;
  if (/layout|paint|strict|content/.test(s.contain)) return true;
  if (s['container-type'] && s['container-type'] !== 'normal') return true;
  return false;
}

/** Элемент образует контекст наложения (stacking context). */
export function isStackingContext(s: StyleSnap, parentDisplay: string): boolean {
  if (s.position === 'fixed' || s.position === 'sticky') return true;
  if ((s.position === 'absolute' || s.position === 'relative') && s['z-index'] !== 'auto') return true;
  if (/flex|grid/.test(parentDisplay) && s['z-index'] !== 'auto') return true;
  if (parseFloat(s.opacity) < 1) return true;
  if (s['mix-blend-mode'] !== 'normal') return true;
  if (hasTransform(s) || s.filter !== 'none' || (s['backdrop-filter'] && s['backdrop-filter'] !== 'none')) return true;
  if (s.perspective !== 'none' || s['clip-path'] !== 'none') return true;
  if ((s['mask-image'] && s['mask-image'] !== 'none') || (s['-webkit-mask-image'] && s['-webkit-mask-image'] !== 'none')) return true;
  if (s.isolation === 'isolate') return true;
  if (/transform|opacity|filter|perspective|clip-path|mask|isolation/.test(s['will-change'])) return true;
  if (/layout|paint|strict|content/.test(s.contain)) return true;
  return false;
}

export const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT', 'HEAD', 'TITLE', 'BASE', 'OPTION', 'OPTGROUP', 'DATALIST', 'PARAM', 'SOURCE', 'TRACK', 'AREA', 'MAP']);
