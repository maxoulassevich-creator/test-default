import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aabb, apply, composeCssTransform, decompose, invert, multiply, parseCssMatrix } from '../../shared/matrix';
import type { Mat } from '../../shared/schema';

const close = (a: number[], b: number[], eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps);

test('поворот вокруг центра: центр неподвижен, AABB как у браузера', () => {
  const t = composeCssTransform({ transform: 'matrix(0.866025, 0.5, -0.5, 0.866025, 0, 0)', origin: '50px 25px', width: 100, height: 50 })!;
  assert.ok(close(apply(t.m, 50, 25), [50, 25]));
  const [x, y, w, h] = aabb(t.m, 100, 50);
  assert.ok(Math.abs(w - (100 * 0.866025 + 50 * 0.5)) < 1e-4 && Math.abs(h - (100 * 0.5 + 50 * 0.866025)) < 1e-4);
  assert.ok(Math.abs(x + w / 2 - 50) < 1e-4 && Math.abs(y + h / 2 - 25) < 1e-4);
});

test('формула CSS matrix с origin совпадает с заданием', () => {
  const [a, b, c, d, tx, ty] = [0.994522, -0.104528, 0.104528, 0.994522, -7.95618, 0.836228];
  const ox = 75, oy = 85;
  const t = composeCssTransform({ transform: `matrix(${a}, ${b}, ${c}, ${d}, ${tx}, ${ty})`, origin: `${ox}px ${oy}px`, width: 150, height: 170 })!;
  for (const [x, y] of [[0, 0], [150, 0], [33, 120]]) {
    const exp = [a * x + c * y + tx + ox - a * ox - c * oy, b * x + d * y + ty + oy - b * ox - d * oy];
    assert.ok(close(apply(t.m, x, y), exp, 1e-6));
  }
});

test('индивидуальные translate/rotate/scale в порядке CSS', () => {
  const t = composeCssTransform({ transform: 'none', translate: '10px 20px', rotate: '90deg', scale: '2', origin: '0px 0px', width: 10, height: 10 })!;
  // translate · rotate · scale
  assert.ok(close(apply(t.m, 1, 0), [10, 22]));
});

test('3D: аффинный matrix3d принимается, перспектива помечается', () => {
  assert.equal(parseCssMatrix('matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 5,6,0,1)')!.is3d, false);
  const p = parseCssMatrix('matrix3d(1,0,0,0, 0,1,0,-0.002, 0,0,1,0, 0,0,0,1)')!;
  assert.ok(p.is3d && p.perspective);
});

test('разложение, обратная матрица', () => {
  const m: Mat = multiply([Math.cos(0.3), Math.sin(0.3), -Math.sin(0.3), Math.cos(0.3), 5, 7], [1.5, 0, 0, 1.5, 0, 0]);
  const d = decompose(m);
  assert.ok(Math.abs(d.rotation - 0.3) < 1e-9 && Math.abs(d.scaleX - 1.5) < 1e-9 && Math.abs(d.scaleY - 1.5) < 1e-9 && Math.abs(d.skew) < 1e-9);
  const inv = invert(m)!;
  assert.ok(close(multiply(inv, m), [1, 0, 0, 1, 0, 0]));
});
