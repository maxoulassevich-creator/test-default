/*
 * Проверка промежуточной модели ДО изменения холста: конечность чисел, единичные
 * оси матриц, корректные альфы, диапазоны текстовых runs в UTF-16, ссылки на шрифты
 * и ассеты. Отсутствующее свойство и явный ноль различаются (opacity: 0 допустима).
 */
import { hasUnitAxes, isFiniteMat } from './matrix';
import type { EffectIR, NodeIR, PaintIR, RGBA, RouteSnapshot, StrokeIR } from './schema';

export interface ValidationIssue { path: string; message: string }

const fin = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const unit = (v: unknown) => fin(v) && (v as number) >= 0 && (v as number) <= 1;

function checkColor(c: RGBA | undefined, path: string, out: ValidationIssue[], alpha = true) {
  if (!c || !unit(c.r) || !unit(c.g) || !unit(c.b) || (alpha && !unit(c.a))) out.push({ path, message: 'неверный цвет' });
}

function checkPaints(ps: PaintIR[] | undefined, path: string, out: ValidationIssue[], assets: Set<string>) {
  if (ps === undefined) return;
  if (!Array.isArray(ps)) { out.push({ path, message: 'fills не массив' }); return; }
  ps.forEach((p, i) => {
    const pp = `${path}.fills[${i}]`;
    if (!unit(p.opacity)) out.push({ path: pp, message: 'opacity вне 0..1' });
    if (p.type === 'SOLID') checkColor({ ...p.color, a: 1 }, pp, out);
    else if (p.type === 'IMAGE') {
      if (!assets.has(p.asset)) out.push({ path: pp, message: `нет ассета ${p.asset}` });
      if (p.imageTransform && !isFiniteMat(p.imageTransform)) out.push({ path: pp, message: 'imageTransform не конечен' });
      if (p.scalingFactor !== undefined && !(fin(p.scalingFactor) && p.scalingFactor > 0)) out.push({ path: pp, message: 'scalingFactor' });
    } else {
      if (!isFiniteMat(p.transform)) out.push({ path: pp, message: 'gradientTransform не конечен' });
      if (!p.stops || p.stops.length < 2) out.push({ path: pp, message: 'меньше двух остановок градиента' });
      p.stops?.forEach((s, j) => { if (!unit(s.position)) out.push({ path: `${pp}.stops[${j}]`, message: 'позиция вне 0..1' }); checkColor(s.color, `${pp}.stops[${j}]`, out); });
    }
  });
}

function checkEffects(es: EffectIR[] | undefined, path: string, out: ValidationIssue[]) {
  es?.forEach((e, i) => {
    const pp = `${path}.effects[${i}]`;
    if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
      if (![e.x, e.y, e.blur, e.spread].every(fin) || e.blur < 0) out.push({ path: pp, message: 'параметры тени' });
      checkColor(e.color, pp, out);
    } else if (e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR') {
      if (!(fin(e.radius) && e.radius >= 0)) out.push({ path: pp, message: 'радиус размытия' });
    }
  });
}

function checkStroke(s: StrokeIR | undefined, path: string, out: ValidationIssue[]) {
  if (!s) return;
  if (!s.weights.every((w) => fin(w) && w >= 0)) out.push({ path, message: 'толщина обводки' });
  if (!unit(s.opacity)) out.push({ path, message: 'opacity обводки' });
  checkColor({ ...s.color, a: 1 }, path, out);
  if (s.dash && !s.dash.every((d) => fin(d) && d >= 0)) out.push({ path, message: 'dashPattern' });
}

export function validateNode(n: NodeIR, path: string, out: ValidationIssue[], ctx: { fonts: Set<string>; assets: Set<string>; count: { n: number } }) {
  ctx.count.n++;
  if (!isFiniteMat(n.m)) out.push({ path, message: 'матрица не конечна' });
  else if (!hasUnitAxes(n.m, 1e-4)) out.push({ path, message: 'матрица содержит масштаб (оси не единичные)' });
  if (!(fin(n.w) && n.w >= 0 && fin(n.h) && n.h >= 0)) out.push({ path, message: `размер ${n.w}×${n.h}` });
  if (n.opacity !== undefined && !unit(n.opacity)) out.push({ path, message: 'opacity вне 0..1' });
  checkEffects(n.effects, path, out);
  switch (n.kind) {
    case 'frame':
      checkPaints(n.fills, path, out, ctx.assets);
      checkStroke(n.stroke, path, out);
      if (n.radius && !n.radius.every((r) => fin(r) && r >= 0)) out.push({ path, message: 'радиусы' });
      n.children.forEach((c, i) => validateNode(c, `${path}/${i}`, out, ctx));
      break;
    case 'rect': case 'ellipse':
      checkPaints(n.fills, path, out, ctx.assets);
      checkStroke(n.stroke, path, out);
      break;
    case 'text': {
      if (typeof n.text !== 'string' || !n.text.length) out.push({ path, message: 'пустой текст' });
      if (!(fin(n.lineHeight) && n.lineHeight > 0)) out.push({ path, message: 'lineHeight' });
      let pos = 0;
      for (const r of n.runs) {
        if (r.start !== pos || r.end <= r.start || r.end > n.text.length) { out.push({ path, message: `run ${r.start}-${r.end} не покрывает текст последовательно` }); break; }
        pos = r.end;
        if (!ctx.fonts.has(r.font)) out.push({ path, message: `шрифт ${r.font} не объявлен` });
        if (!(fin(r.size) && r.size > 0)) out.push({ path, message: 'размер шрифта' });
        if (!fin(r.letterSpacing)) out.push({ path, message: 'letterSpacing' });
        checkColor(r.color, path, out);
      }
      if (pos !== n.text.length) out.push({ path, message: 'runs не покрывают весь текст' });
      checkPaints(n.fills, path, out, ctx.assets);
      break;
    }
    case 'image':
      if (!ctx.assets.has(n.asset)) out.push({ path, message: `нет ассета ${n.asset}` });
      checkPaints(n.fills, path, out, ctx.assets);
      break;
    case 'svg':
      if (!ctx.assets.has(n.asset)) out.push({ path, message: `нет ассета ${n.asset}` });
      if (n.fallback && !ctx.assets.has(n.fallback)) out.push({ path, message: `нет запасного ассета ${n.fallback}` });
      break;
  }
}

export function validateSnapshot(s: RouteSnapshot, fonts: Set<string>, assets: Set<string>): { issues: ValidationIssue[]; nodes: number } {
  const out: ValidationIssue[] = [];
  const count = { n: 0 };
  if (!(fin(s.width) && s.width > 0 && fin(s.height) && s.height > 0)) out.push({ path: 'root', message: 'размер страницы' });
  if (!(Number.isInteger(s.fixedCount) && s.fixedCount >= 0 && s.fixedCount <= s.children.length)) out.push({ path: 'root', message: 'fixedCount' });
  checkPaints(s.background, 'root', out, assets);
  s.children.forEach((c, i) => validateNode(c, `root/${i}`, out, { fonts, assets, count }));
  return { issues: out, nodes: count.n };
}
