import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseColor, splitTopLevel } from '../../shared/color';

const near = (a: number, b: number, eps = 0.004) => Math.abs(a - b) <= eps;
const rgb = (s: string) => { const c = parseColor(s)!; return [c.r * 255, c.g * 255, c.b * 255, c.a]; };

test('rgb/rgba/hex/named/hsl/hwb', () => {
  assert.deepEqual(rgb('rgb(44, 35, 31)').map(Math.round), [44, 35, 31, 1]);
  assert.deepEqual(rgb('rgba(0, 0, 0, 0.2)'), [0, 0, 0, 0.2]);
  assert.deepEqual(rgb('rgb(10 20 30 / 50%)').map((v) => +v.toFixed(2)), [10, 20, 30, 0.5]);
  assert.deepEqual(rgb('#F7F3ED').map(Math.round), [247, 243, 237, 1]);
  assert.deepEqual(rgb('#0f08').map((v) => +v.toFixed(3)), [0, 255, 0, 0.533]);
  assert.deepEqual(rgb('rebeccapurple').map(Math.round), [102, 51, 153, 1]);
  assert.deepEqual(rgb('hsl(120, 100%, 25%)').map(Math.round), [0, 128, 0, 1]);
  assert.deepEqual(rgb('hwb(0 0% 0%)').map(Math.round), [255, 0, 0, 1]);
  assert.deepEqual(parseColor('transparent'), { r: 0, g: 0, b: 0, a: 0 });
});

test('современные формы из computed style: color(srgb), display-p3, oklab/oklch, lab/lch', () => {
  // так Chromium сериализует результат color-mix(in srgb, …)
  const c = parseColor('color(srgb 0.96549 0.927373 0.870745)')!;
  assert.ok(near(c.r, 0.96549) && near(c.g, 0.927373) && near(c.b, 0.870745) && c.a === 1);
  const a = parseColor('color(srgb 0.529412 0.337255 0.121569 / 0.3)')!;
  assert.ok(near(a.a, 0.3));
  const p3 = parseColor('color(display-p3 1 0 0)')!;
  assert.ok(p3.r === 1 && p3.g === 0 && p3.b === 0, 'p3 красный за пределами sRGB обрезается: ' + JSON.stringify(p3));
  const p3mid = parseColor('color(display-p3 0.5 0.5 0.5)')!;
  assert.ok(near(p3mid.r, 0.5, 0.01) && near(p3mid.g, 0.5, 0.01), 'серый p3 ≈ серый sRGB');
  const white = parseColor('oklch(1 0 0)')!;
  assert.ok(near(white.r, 1, 0.002) && near(white.g, 1, 0.002) && near(white.b, 1, 0.002));
  const okRed = parseColor('oklab(0.627955 0.224863 0.125846)')!;
  assert.ok(near(okRed.r, 1, 0.01) && near(okRed.g, 0, 0.01) && near(okRed.b, 0, 0.01), 'oklab красный: ' + JSON.stringify(okRed));
  const labWhite = parseColor('lab(100 0 0)')!;
  assert.ok(near(labWhite.r, 1, 0.01));
  const lch = parseColor('lch(54.29 106.84 40.85)')!;
  assert.ok(lch.r > 0.95 && lch.g < 0.1, 'lch красный');
  assert.ok(near(parseColor('oklch(0.7 0.12 40 / 0.25)')!.a, 0.25));
});

test('нераспознанный цвет → null, а не чёрный', () => {
  assert.equal(parseColor('currentcolor'), null);
  assert.equal(parseColor('color(unknown-space 1 2 3)'), null);
  assert.equal(parseColor('bogus'), null);
  assert.equal(parseColor(''), null);
});

test('splitTopLevel учитывает скобки и кавычки', () => {
  assert.deepEqual(splitTopLevel('rgba(0, 0, 0, 0.2) 0px 1px, color(srgb 1 0 0) 2px 3px', ','), ['rgba(0, 0, 0, 0.2) 0px 1px', 'color(srgb 1 0 0) 2px 3px']);
  assert.deepEqual(splitTopLevel('"A, B", serif', ','), ['"A, B"', 'serif']);
});
