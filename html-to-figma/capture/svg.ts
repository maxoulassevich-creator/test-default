/*
 * Сериализация inline-SVG в автономную разметку:
 *  - вычисленные стили переносятся в presentation-атрибуты (currentColor разрешён);
 *  - CSS transforms (в т. ч. анимированные и hover) запекаются в атрибут transform
 *    с учётом transform-origin/transform-box;
 *  - ссылки url(#id)/href="#id" на defs в ДРУГИХ svg документа копируются внутрь;
 *  - id переименовываются с уникальным префиксом;
 *  - width/height = content box внешнего svg (не border box), viewBox сохраняется.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK = 'http://www.w3.org/1999/xlink';

const INHERITED = [
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'clip-rule', 'visibility', 'font-family', 'font-size',
  'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing', 'paint-order', 'marker-start',
  'marker-mid', 'marker-end', 'color-interpolation-filters', 'shape-rendering', 'image-rendering',
];
const NON_INHERITED: Array<[string, string[]]> = [
  ['opacity', ['1']], ['clip-path', ['none']], ['mask', ['none']], ['filter', ['none']],
  ['stop-color', []], ['stop-opacity', ['1']], ['flood-color', ['rgb(0, 0, 0)']], ['flood-opacity', ['1']],
  ['lighting-color', ['rgb(255, 255, 255)']], ['mix-blend-mode', ['normal']], ['isolation', ['auto']],
  ['vector-effect', ['none']],
];
const GEOMETRY: Record<string, string[]> = {
  circle: ['cx', 'cy', 'r'], ellipse: ['cx', 'cy', 'rx', 'ry'], rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  path: ['d'], image: ['x', 'y', 'width', 'height'], use: ['x', 'y'], foreignObject: ['x', 'y', 'width', 'height'],
};

const RASTER_TAGS: Record<string, string> = {
  filter: 'фильтр SVG', mask: 'маска SVG', pattern: 'паттерн SVG', foreignObject: 'foreignObject', image: 'растровое изображение внутри SVG',
  textPath: 'textPath', feTurbulence: 'фактура feTurbulence',
};

export interface SvgSerialized {
  markup: string;
  reasons: string[];
  elements: number;
  pathChars: number;
  hasText: boolean;
  externalImages: string[];
  overflowVisible: boolean;
}

let serial = 0;

function refsIn(value: string | null, out: Set<string>) {
  if (!value) return;
  const re = /url\(\s*["']?#([^"')\s]+)["']?\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) out.add(decodeURIComponent(m[1]));
}

function hrefOf(el: Element): string | null {
  return el.getAttribute('href') ?? el.getAttributeNS(XLINK, 'href');
}

function originTransform(el: SVGGraphicsElement, cs: CSSStyleDeclaration): string | null {
  const t = cs.transform;
  if (!t || t === 'none') return null;
  const box = cs.getPropertyValue('transform-box') || 'view-box';
  const o = cs.transformOrigin.split(/\s+/).map((v) => parseFloat(v) || 0);
  let ox = o[0] ?? 0, oy = o[1] ?? 0;
  if (box === 'fill-box' || box === 'content-box' || box === 'border-box' || box === 'stroke-box') {
    try { const b = el.getBBox(); ox += b.x; oy += b.y; } catch { /* нет геометрии */ }
  }
  const m = t.startsWith('matrix(') ? t : null;
  if (!m) {
    // matrix3d: берём аффинную часть
    const v = /matrix3d\(([^)]*)\)/.exec(t)?.[1].split(',').map(parseFloat);
    if (!v || v.length !== 16) return null;
    return `translate(${ox} ${oy}) matrix(${v[0]} ${v[1]} ${v[4]} ${v[5]} ${v[12]} ${v[13]}) translate(${-ox} ${-oy})`;
  }
  const inner = m.slice(7, -1).split(',').map((x) => x.trim()).join(' ');
  if (!ox && !oy) return `matrix(${inner})`;
  return `translate(${ox} ${oy}) matrix(${inner}) translate(${-ox} ${-oy})`;
}

function cleanValue(v: string): string {
  return v.replace(/url\(\s*"([^"]*)"\s*\)/g, 'url($1)');
}

export function serializeSvg(svg: SVGSVGElement, contentW: number, contentH: number): SvgSerialized {
  const prefix = `h2f${(++serial).toString(36)}_`;
  const reasons = new Set<string>();
  const refs = new Set<string>();
  const external: string[] = [];
  let elements = 0, pathChars = 0, hasText = false;
  const localIds = new Set<string>();

  const copyElement = (src: Element, parentCs: CSSStyleDeclaration | null, isRoot: boolean): Element | null => {
    const tag = src.localName;
    if (tag === 'script' || tag === 'animate' || tag === 'animateTransform' || tag === 'animateMotion' || tag === 'set' || tag === 'title' || tag === 'desc' || tag === 'metadata') return null;
    elements++;
    if (RASTER_TAGS[tag]) reasons.add(RASTER_TAGS[tag]);
    if (tag === 'text' || tag === 'tspan') hasText = true;
    const cs = getComputedStyle(src);
    if (!isRoot && cs.display === 'none' && !['linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'filter', 'pattern', 'symbol', 'marker', 'defs'].includes(tag) && !tag.startsWith('fe')) return null;
    const dst = document.createElementNS(SVG_NS, tag);
    for (const a of Array.from(src.attributes)) {
      const n = a.name;
      if (/^on/i.test(n) || n === 'style' || n === 'class' || n === 'transform' || n.startsWith('data-')) continue;
      if (n === 'id') { localIds.add(a.value); dst.setAttribute('id', prefix + a.value); continue; }
      if (n === 'href' || n === 'xlink:href') {
        if (a.value.startsWith('#')) { refs.add(decodeURIComponent(a.value.slice(1))); dst.setAttribute('href', '#' + prefix + decodeURIComponent(a.value.slice(1))); }
        else if (tag === 'image' || tag === 'feImage') { external.push(new URL(a.value, document.baseURI).toString()); dst.setAttribute('href', new URL(a.value, document.baseURI).toString()); }
        continue;
      }
      let v = a.value;
      if (v.includes('url(')) { refsIn(v, refs); v = v.replace(/url\(\s*["']?#([^"')\s]+)["']?\s*\)/g, (_m, id) => `url(#${prefix}${decodeURIComponent(id)})`); }
      dst.setAttribute(n, v);
    }
    if (tag === 'path') pathChars += (src.getAttribute('d') ?? '').length;
    if (isRoot) {
      dst.setAttribute('xmlns', SVG_NS);
      dst.setAttribute('width', String(+contentW.toFixed(3)));
      dst.setAttribute('height', String(+contentH.toFixed(3)));
      dst.removeAttribute('x');
      dst.removeAttribute('y');
      if (cs.overflow === 'visible' || cs.overflowX === 'visible') dst.setAttribute('overflow', 'visible');
    }
    // presentation-атрибуты из вычисленного стиля
    const isGraphics = !['linearGradient', 'radialGradient', 'stop', 'filter', 'clipPath', 'mask', 'pattern', 'defs', 'symbol', 'marker'].includes(tag) && !tag.startsWith('fe');
    for (const p of INHERITED) {
      const v = cs.getPropertyValue(p);
      if (!v) continue;
      if (isRoot || !parentCs || parentCs.getPropertyValue(p) !== v) {
        if (p.startsWith('marker') && v === 'none' && isRoot) continue;
        refsIn(v, refs);
        dst.setAttribute(p, cleanValue(v).replace(/url\(\s*#([^)\s]+)\s*\)/g, (_m, id) => `url(#${prefix}${id})`));
      }
    }
    for (const [p, initial] of NON_INHERITED) {
      if (p === 'stop-color' && tag !== 'stop') continue;
      if ((p === 'flood-color' || p === 'flood-opacity') && !tag.startsWith('fe')) continue;
      if (p === 'lighting-color' && !tag.startsWith('fe')) continue;
      const v = cs.getPropertyValue(p);
      if (!v || initial.includes(v)) continue;
      if (p === 'filter') { refsIn(v, refs); if (!v.includes('url(')) reasons.add('CSS filter внутри SVG'); }
      if (p === 'mask') reasons.add('маска SVG');
      if (p === 'mix-blend-mode' && v !== 'normal') reasons.add('mix-blend-mode внутри SVG');
      if (p === 'clip-path' && !v.includes('url(')) reasons.add('CSS clip-path внутри SVG');
      refsIn(v, refs);
      dst.setAttribute(p, cleanValue(v).replace(/url\(\s*#([^)\s]+)\s*\)/g, (_m, id) => `url(#${prefix}${id})`));
    }
    if (isGraphics && !isRoot) {
      const tr = originTransform(src as SVGGraphicsElement, cs);
      if (tr) dst.setAttribute('transform', tr);
      else if (src.getAttribute('transform') && cs.transform === 'none') { /* атрибут перекрыт CSS: transform:none */ }
    } else if (!isRoot && src.getAttribute('transform') && !isGraphics) {
      dst.setAttribute('transform', src.getAttribute('transform')!);
    }
    const geo = GEOMETRY[tag];
    if (geo) {
      for (const g of geo) {
        const v = cs.getPropertyValue(g);
        if (!v || v === 'auto' || v === 'none') continue;
        if (g === 'd') {
          const m = /^path\(["'](.*)["']\)$/s.exec(v);
          if (m && m[1] !== src.getAttribute('d')) dst.setAttribute('d', m[1]);
        } else {
          const val = v.endsWith('px') ? String(parseFloat(v)) : v;
          if (src.getAttribute(g) !== val) dst.setAttribute(g, val);
        }
      }
    }
    for (const child of Array.from(src.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) { if (child.textContent && /\S/.test(child.textContent)) dst.appendChild(document.createTextNode(child.textContent)); else if (child.textContent) dst.appendChild(document.createTextNode(' ')); continue; }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const c = copyElement(child as Element, cs, false);
      if (c) dst.appendChild(c);
    }
    return dst;
  };

  const root = copyElement(svg, null, true) as Element;
  // зависимости из других svg документа (глобальные defs, фильтры, градиенты)
  const defs = document.createElementNS(SVG_NS, 'defs');
  const done = new Set<string>();
  let guard = 0;
  while (guard++ < 500) {
    const missing = [...refs].filter((id) => !localIds.has(id) && !done.has(id));
    if (!missing.length) break;
    for (const id of missing) {
      done.add(id);
      const target = document.getElementById(id);
      if (!target || !(target instanceof SVGElement)) continue;
      const parentCs = target.parentElement ? getComputedStyle(target.parentElement) : null;
      const c = copyElement(target, parentCs, false);
      if (c) defs.appendChild(c);
    }
  }
  if (defs.childNodes.length) root.insertBefore(defs, root.firstChild);
  if (elements > 2500) reasons.add('сложность (элементов: ' + elements + ')');
  if (pathChars > 400_000) reasons.add('объём путей');
  const markup = new XMLSerializer().serializeToString(root);
  const cs = getComputedStyle(svg);
  return { markup, reasons: [...reasons], elements, pathChars, hasText, externalImages: external, overflowVisible: cs.overflowX === 'visible' || cs.overflow === 'visible' };
}
