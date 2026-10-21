/*
 * 2D-аффинная математика для переноса CSS transforms в Figma.
 * Mat = [a, b, c, d, e, f] (порядок как у CSS matrix()):
 *   x' = a*x + c*y + e
 *   y' = b*x + d*y + f
 * Figma relativeTransform = [[a, c, e], [b, d, f]] и требует единичных осей,
 * поэтому масштаб переносится в размеры (см. normalizeScale в processor/finalize).
 */
import type { Mat } from './schema';

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function translate(x: number, y: number): Mat {
  return [1, 0, 0, 1, x, y];
}

/** Композиция: сначала применяется n, затем m (m ∘ n). */
export function multiply(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Mat): Mat | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const id = 1 / det;
  return [
    m[3] * id,
    -m[1] * id,
    -m[2] * id,
    m[0] * id,
    (m[2] * m[5] - m[3] * m[4]) * id,
    (m[1] * m[4] - m[0] * m[5]) * id,
  ];
}

export function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function isIdentityLinear(m: Mat, eps = 1e-6): boolean {
  return Math.abs(m[0] - 1) < eps && Math.abs(m[1]) < eps && Math.abs(m[2]) < eps && Math.abs(m[3] - 1) < eps;
}

/** Осевой прямоугольник [x, y, w, h] после преобразования прямоугольника 0..w × 0..h. */
export function aabb(m: Mat, w: number, h: number): [number, number, number, number] {
  const pts = [apply(m, 0, 0), apply(m, w, 0), apply(m, w, h), apply(m, 0, h)];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0];
}

/**
 * Разбор вычисленного значения CSS transform ("none", "matrix(...)", "matrix3d(...)").
 * Возвращает 2D-матрицу и признак того, что 3D-составляющая была отброшена.
 */
export function parseCssMatrix(value: string | null | undefined): { m: Mat; is3d: boolean; perspective: boolean } | null {
  if (!value || value === 'none') return { m: IDENTITY, is3d: false, perspective: false };
  const mm = /^matrix\(([^)]*)\)$/.exec(value.trim());
  if (mm) {
    const v = mm[1].split(',').map((x) => parseFloat(x));
    if (v.length !== 6 || !v.every(Number.isFinite)) return null;
    return { m: v as Mat, is3d: false, perspective: false };
  }
  const m3 = /^matrix3d\(([^)]*)\)$/.exec(value.trim());
  if (m3) {
    const v = m3[1].split(',').map((x) => parseFloat(x));
    if (v.length !== 16 || !v.every(Number.isFinite)) return null;
    // column-major: [m11 m12 m13 m14 m21 m22 m23 m24 m31 m32 m33 m34 m41 m42 m43 m44]
    const affine2d = Math.abs(v[2]) < 1e-9 && Math.abs(v[6]) < 1e-9 && Math.abs(v[8]) < 1e-9 && Math.abs(v[9]) < 1e-9 &&
      Math.abs(v[10] - 1) < 1e-9 && Math.abs(v[11]) < 1e-9 && Math.abs(v[14]) < 1e-9 && Math.abs(v[3]) < 1e-9 && Math.abs(v[7]) < 1e-9 && Math.abs(v[15] - 1) < 1e-9;
    const perspective = Math.abs(v[3]) > 1e-9 || Math.abs(v[7]) > 1e-9 || Math.abs(v[11]) > 1e-9;
    return { m: [v[0], v[1], v[4], v[5], v[12], v[13]], is3d: !affine2d, perspective };
  }
  return null;
}

function lengthPx(tok: string, ref: number): number {
  if (tok.endsWith('%')) return (parseFloat(tok) / 100) * ref;
  return parseFloat(tok) || 0;
}
function angleRad(tok: string): number {
  const v = parseFloat(tok);
  if (!Number.isFinite(v)) return 0;
  if (tok.endsWith('rad')) return v;
  if (tok.endsWith('grad')) return (v * Math.PI) / 200;
  if (tok.endsWith('turn')) return v * 2 * Math.PI;
  return (v * Math.PI) / 180;
}

export interface CssTransformInput {
  transform: string;
  translate?: string;
  rotate?: string;
  scale?: string;
  origin: string; // computed transform-origin "x y [z]" в px
  width: number;
  height: number;
}

export interface ComposedTransform {
  /** Матрица в собственной системе элемента (вокруг transform-origin уже учтено). */
  m: Mat;
  unsupported: string[];
}

/**
 * Полная матрица CSS-преобразования элемента относительно его неповёрнутой рамки:
 * M = T(origin) · translate · rotate · scale · transform · T(-origin).
 */
export function composeCssTransform(t: CssTransformInput): ComposedTransform | null {
  const unsupported: string[] = [];
  const parsed = parseCssMatrix(t.transform);
  if (!parsed) return null;
  if (parsed.is3d) unsupported.push(parsed.perspective ? 'perspective' : '3d');
  let m: Mat = parsed.m;
  if (t.scale && t.scale !== 'none') {
    const p = t.scale.trim().split(/\s+/).map((x) => (x.endsWith('%') ? parseFloat(x) / 100 : parseFloat(x)));
    const sx = p[0], sy = p.length > 1 ? p[1] : p[0];
    if (p.length > 2 && Math.abs(p[2] - 1) > 1e-9) unsupported.push('scale-z');
    if (Number.isFinite(sx) && Number.isFinite(sy)) m = multiply([sx, 0, 0, sy, 0, 0], m);
  }
  if (t.rotate && t.rotate !== 'none') {
    const p = t.rotate.trim().split(/\s+/);
    let ang = 0;
    if (p.length === 1) ang = angleRad(p[0]);
    else {
      const ax = p.slice(0, p.length - 1);
      const last = p[p.length - 1];
      if (ax.length === 1 && ax[0] === 'z') ang = angleRad(last);
      else if (ax.length === 3 && Math.abs(parseFloat(ax[0])) < 1e-9 && Math.abs(parseFloat(ax[1])) < 1e-9) ang = angleRad(last) * Math.sign(parseFloat(ax[2]) || 1);
      else { unsupported.push('rotate-3d'); }
    }
    const c = Math.cos(ang), s = Math.sin(ang);
    m = multiply([c, s, -s, c, 0, 0], m);
  }
  if (t.translate && t.translate !== 'none') {
    const p = t.translate.trim().split(/\s+/);
    const tx = lengthPx(p[0], t.width), ty = p.length > 1 ? lengthPx(p[1], t.height) : 0;
    if (p.length > 2 && parseFloat(p[2]) !== 0) unsupported.push('translate-z');
    m = multiply(translate(tx, ty), m);
  }
  const o = t.origin.trim().split(/\s+/);
  const ox = lengthPx(o[0] ?? '0', t.width), oy = lengthPx(o[1] ?? '0', t.height);
  const full = multiply(translate(ox, oy), multiply(m, translate(-ox, -oy)));
  if (!full.every(Number.isFinite)) return null;
  return { m: full, unsupported };
}

export interface Decomposed {
  rotation: number; // радианы
  scaleX: number;
  scaleY: number;
  skew: number; // shear-фактор
  tx: number;
  ty: number;
}

/** QR-разложение линейной части: M = R(θ) · [[sx, k·sy],[0, sy]]. */
export function decompose(m: Mat): Decomposed {
  const [a, b, c, d, e, f] = m;
  const sx = Math.hypot(a, b);
  const rotation = Math.atan2(b, a);
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  // R^-1 * [c, d]
  const c2 = cos * c + sin * d;
  const d2 = -sin * c + cos * d;
  const sy = d2;
  const skew = sy !== 0 ? c2 / sy : 0;
  return { rotation, scaleX: sx, scaleY: sy, skew, tx: e, ty: f };
}

/** Чистое вращение+перенос (без масштаба), пригодное для Figma relativeTransform. */
export function rotationOnly(m: Mat): Mat {
  const d = decompose(m);
  const c = Math.cos(d.rotation), s = Math.sin(d.rotation);
  return [c, s, -s, c, m[4], m[5]];
}

export function hasUnitAxes(m: Mat, eps = 1e-6): boolean {
  return Math.abs(Math.hypot(m[0], m[1]) - 1) < eps && Math.abs(Math.hypot(m[2], m[3]) - 1) < eps;
}

export function isFiniteMat(m: unknown): m is Mat {
  return Array.isArray(m) && m.length === 6 && m.every((x) => typeof x === 'number' && Number.isFinite(x));
}

export function toFigmaTransform(m: Mat): [[number, number, number], [number, number, number]] {
  return [[m[0], m[2], m[4]], [m[1], m[3], m[5]]];
}

export function round(v: number, p = 4): number {
  const k = Math.pow(10, p);
  return Math.round(v * k) / k;
}

export function roundMat(m: Mat, p = 5): Mat {
  return m.map((v) => round(v, p)) as Mat;
}
