/*
 * HTML-реконструкция промежуточной модели — ДОПОЛНИТЕЛЬНЫЙ уровень проверки
 * (не заменяет экспорт из настоящей Figma). Повторяет семантику, которую плагин
 * задаёт нодам Figma: relativeTransform, fills (снизу вверх), обводки INSIDE/OUTSIDE,
 * тени, клиппинг с радиусами, текст с явными строками, IMAGE CROP/TILE, SVG.
 */
import type { EffectIR, FrameIR, Mat, NodeIR, PaintIR, RGBA, RouteSnapshot, StrokeIR, TextIR } from '../../shared/schema';
import { invert } from '../../shared/matrix';

export interface AssetSource { url(id: string): string; info(id: string): { width: number; height: number } | undefined; svgText(id: string): string | undefined }
export interface FontSource { css(key: string): { family: string; weight: number; italic: boolean } }

let gid = 0;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rgba = (c: { r: number; g: number; b: number }, a: number) => `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${+a.toFixed(4)})`;
const mat = (m: Mat) => `matrix(${m.map((v) => +v.toFixed(6)).join(',')})`;

function paintLayer(p: PaintIR, w: number, h: number, assets: AssetSource): string {
  const op = p.opacity;
  const blend = p.blend ? `mix-blend-mode:${p.blend.toLowerCase().replace(/_/g, '-')};` : '';
  if (p.type === 'SOLID') return `<div style="position:absolute;inset:0;background:${rgba(p.color, op)};${blend}"></div>`;
  if (p.type === 'IMAGE') {
    const info = assets.info(p.asset);
    if (p.scaleMode === 'TILE' && info) {
      const k = p.scalingFactor ?? 1;
      return `<div style="position:absolute;inset:0;opacity:${op};background-image:url(${assets.url(p.asset)});background-size:${info.width * k}px ${info.height * k}px;background-repeat:repeat;${blend}"></div>`;
    }
    if (p.scaleMode === 'CROP' || p.scaleMode === 'FILL') {
      const t = p.imageTransform ?? [1, 0, 0, 1, 0, 0];
      const inv = invert(t) ?? [1, 0, 0, 1, 0, 0];
      // изображение (единичный квадрат) → координаты ноды
      const x = inv[4] * w, y = inv[5] * h, iw = inv[0] * w, ih = inv[3] * h;
      return `<div style="position:absolute;inset:0;overflow:hidden;opacity:${op};${blend}"><img src="${assets.url(p.asset)}" style="position:absolute;left:${x}px;top:${y}px;width:${iw}px;height:${ih}px;max-width:none"></div>`;
    }
    return `<div style="position:absolute;inset:0;opacity:${op};background:url(${assets.url(p.asset)}) center/${p.scaleMode === 'FIT' ? 'contain' : 'cover'} no-repeat;${blend}"></div>`;
  }
  // градиент: SVG с objectBoundingBox (= нормализованное пространство ноды Figma)
  const inv = invert(p.transform) ?? [1, 0, 0, 1, 0, 0];
  const id = 'g' + gid++;
  const stops = p.stops.map((s) => `<stop offset="${s.position}" stop-color="${rgba(s.color, 1)}" stop-opacity="${s.color.a}"/>`).join('');
  const def = p.type === 'GRADIENT_LINEAR'
    ? `<linearGradient id="${id}" gradientUnits="objectBoundingBox" x1="0" y1="0.5" x2="1" y2="0.5" gradientTransform="${mat(inv)}">${stops}</linearGradient>`
    : `<radialGradient id="${id}" gradientUnits="objectBoundingBox" cx="0.5" cy="0.5" r="0.5" gradientTransform="${mat(inv)}">${stops}</radialGradient>`;
  return `<svg style="position:absolute;left:0;top:0;opacity:${op};${blend}" width="${w}" height="${h}" preserveAspectRatio="none"><defs>${def}</defs><rect x="0" y="0" width="${w}" height="${h}" fill="url(#${id})"/></svg>`;
}

function radiusCss(r?: [number, number, number, number]) {
  return r ? `border-radius:${r[0]}px ${r[1]}px ${r[2]}px ${r[3]}px;` : '';
}

function strokeLayer(s: StrokeIR | undefined, r?: [number, number, number, number]): string {
  if (!s) return '';
  const [t, rr, b, l] = s.weights;
  const style = s.dash ? 'dashed' : 'solid';
  const c = rgba(s.color, s.opacity);
  if (s.align === 'OUTSIDE') return `<div style="position:absolute;left:${-l}px;top:${-t}px;right:${-rr}px;bottom:${-b}px;border-style:${style};border-color:${c};border-width:${t}px ${rr}px ${b}px ${l}px;${radiusCss(r?.map((v) => v + t) as never)}pointer-events:none"></div>`;
  return `<div style="position:absolute;inset:0;box-sizing:border-box;border-style:${style};border-color:${c};border-width:${t}px ${rr}px ${b}px ${l}px;${radiusCss(r)}pointer-events:none"></div>`;
}

function effectsCss(es: EffectIR[] | undefined, text: boolean): string {
  if (!es?.length) return '';
  const shadows: string[] = [];
  let filter = '', backdrop = '';
  for (const e of [...es].reverse()) {
    if (e.type === 'DROP_SHADOW') shadows.push(text ? `${e.x}px ${e.y}px ${e.blur}px ${rgba(e.color, e.color.a)}` : `${e.x}px ${e.y}px ${e.blur}px ${e.spread}px ${rgba(e.color, e.color.a)}`);
    else if (e.type === 'INNER_SHADOW') { if (!text) shadows.push(`inset ${e.x}px ${e.y}px ${e.blur}px ${e.spread}px ${rgba(e.color, e.color.a)}`); }
    else if (e.type === 'LAYER_BLUR') filter += ` blur(${e.radius / 2}px)`;
    else if (e.type === 'BACKGROUND_BLUR') backdrop += ` blur(${e.radius / 2}px)`;
  }
  return (shadows.length ? (text ? `text-shadow:${shadows.join(',')};` : `box-shadow:${shadows.join(',')};`) : '') + (filter ? `filter:${filter};` : '') + (backdrop ? `backdrop-filter:${backdrop};` : '');
}

function textHtml(n: TextIR, fonts: FontSource): string {
  // Figma раскладывает каждую строку в ячейке высотой lineHeight с половинным интерлиньяжем.
  // В HTML это воспроизводится блоком на строку, у которого «строка-подпорка» имеет тот же шрифт.
  const fontCss = (key: string, size: number) => { const f = fonts.css(key); return `font-family:'${f.family}';font-weight:${f.weight};font-style:${f.italic ? 'italic' : 'normal'};font-size:${size}px;`; };
  const lines: string[] = [];
  let lineStart = 0;
  const visibleLines = n.truncate ? n.truncate : Infinity;
  const all = n.text.split('\n');
  all.forEach((line, li) => {
    const start = lineStart, end = lineStart + line.length;
    lineStart = end + 1;
    if (li >= visibleLines) return;
    let html = '';
    let first = n.runs.find((r) => r.end > start) ?? n.runs[0];
    for (const r of n.runs) {
      const a = Math.max(start, r.start), b = Math.min(end, r.end);
      if (b <= a) continue;
      const dec = r.decoration === 'UNDERLINE' ? 'underline' : r.decoration === 'STRIKETHROUGH' ? 'line-through' : 'none';
      html += `<span style="${fontCss(r.font, r.size)}color:${rgba(r.color, r.color.a)};letter-spacing:${r.letterSpacing}px;text-decoration:${dec}">${esc(n.text.slice(a, b))}</span>`;
    }
    if (li === visibleLines - 1 && all.length > visibleLines) html += '…';
    lines.push(`<div style="height:${n.lineHeight}px;line-height:${n.lineHeight}px;${fontCss(first.font, first.size)}white-space:pre;text-align:${n.align.toLowerCase()};overflow:visible">${html || '&#8203;'}</div>`);
  });
  return `<div style="position:absolute;left:0;top:0;transform-origin:0 0;transform:${mat(n.m)};width:${n.w}px;${n.truncate ? 'overflow:hidden;' : ''}${effectsCss(n.effects, true)}${n.opacity !== undefined ? 'opacity:' + n.opacity + ';' : ''}">${lines.join('')}</div>`;
}

function node(n: NodeIR, assets: AssetSource, fonts: FontSource): string {
  if (n.visible === false) return '';
  const base = `position:absolute;left:0;top:0;transform-origin:0 0;transform:${mat(n.m)};width:${n.w}px;height:${n.h}px;${n.opacity !== undefined ? 'opacity:' + n.opacity + ';' : ''}${n.blend && n.blend !== 'PASS_THROUGH' && n.blend !== 'NORMAL' ? 'mix-blend-mode:' + n.blend.toLowerCase().replace(/_/g, '-') + ';' : n.blend === 'NORMAL' ? 'isolation:isolate;' : ''}`;
  switch (n.kind) {
    case 'text': return textHtml(n, fonts);
    case 'image': {
      const fills = (n.fills ?? []).map((p) => paintLayer(p, n.w, n.h, assets)).join('');
      const img = paintLayer({ type: 'IMAGE', asset: n.asset, scaleMode: n.scaleMode, imageTransform: n.imageTransform, opacity: 1 }, n.w, n.h, assets);
      return `<div style="${base}${radiusCss(n.radius)}overflow:hidden;${effectsCss(n.effects, false)}">${fills}${img}${strokeLayer(n.stroke, n.radius)}</div>`;
    }
    case 'svg': {
      const t = assets.svgText(n.asset);
      const src = t ? `data:image/svg+xml;base64,${Buffer.from(t).toString('base64')}` : '';
      return `<div style="${base}${n.clip ? 'overflow:hidden;' : ''}${effectsCss(n.effects, false)}"><img src="${src}" style="position:absolute;left:0;top:0;width:${n.w}px;height:${n.h}px;overflow:visible"></div>`;
    }
    case 'rect': case 'ellipse': {
      const r = n.kind === 'ellipse' ? `border-radius:50%;` : radiusCss(n.radius);
      return `<div style="${base}${r}${effectsCss(n.effects, false)}"><div style="position:absolute;inset:0;${r}overflow:hidden">${n.fills.map((p) => paintLayer(p, n.w, n.h, assets)).join('')}</div>${strokeLayer(n.stroke, n.radius)}</div>`;
    }
    case 'frame': {
      const f = n as FrameIR;
      const fills = f.fills.map((p) => paintLayer(p, f.w, f.h, assets)).join('');
      const kids = f.children.map((c) => node(c, assets, fonts)).join('');
      const clip = f.clip ? `overflow:hidden;` : '';
      return `<div style="${base}${radiusCss(f.radius)}${clip}${effectsCss(f.effects, false)}"><div style="position:absolute;inset:0;${radiusCss(f.radius)}overflow:hidden">${fills}</div>${kids}${strokeLayer(f.stroke, f.radius)}</div>`;
    }
  }
}

export function reconstructHtml(s: RouteSnapshot, assets: AssetSource, fonts: FontSource, fontCss = ''): string {
  gid = 0;
  const bg = s.background.map((p) => paintLayer(p, s.width, s.height, assets)).join('');
  const body = s.children.map((c) => node(c, assets, fonts)).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss} html,body{margin:0;padding:0} *{box-sizing:content-box}</style></head><body><div style="position:relative;width:${s.width}px;height:${s.height}px;overflow:hidden">${bg}${body}</div></body></html>`;
}

export function colorOf(c: RGBA) { return rgba(c, c.a); }
