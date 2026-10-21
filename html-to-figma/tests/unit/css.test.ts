import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRadii, normalizeStops, parseFilter, parseFontFamilies, parseGradient, parseInset, parseRadius, parseShadows, shadowsToEffects } from '../../shared/css';
import { apply } from '../../shared/matrix';
import type { Mat } from '../../shared/schema';

test('тени: несколько, inset, цвет в начале, color(srgb), spread', () => {
  const s = parseShadows('color(srgb 0.529412 0.337255 0.121569 / 0.3) 0px 0px 0px 1px inset, rgba(44, 35, 31, 0.06) 0px 2px 6px 0px, rgba(44, 35, 31, 0.45) 0px 30px 60px -30px')!;
  assert.equal(s.length, 3);
  assert.ok(s[0].inset && s[0].spread === 1 && Math.abs(s[0].color.a - 0.3) < 1e-6);
  assert.equal(s[2].spread, -30);
  const e = shadowsToEffects(s);
  assert.equal(e[e.length - 1].type, 'INNER_SHADOW', 'первая CSS-тень рисуется сверху → последняя в Figma');
  assert.deepEqual(parseShadows('none'), []);
  assert.equal(parseShadows('garbage 1px'), null);
});

/** Значение параметра градиента Figma в точке ноды (u,v ∈ 0..1). */
const gx = (t: Mat, u: number, v: number) => apply(t, u, v)[0];

test('линейный градиент: направление и длина линии как в CSS', () => {
  const g = parseGradient('linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)', 200, 100).paint!;
  assert.equal(g.type, 'GRADIENT_LINEAR');
  const t = (g as { transform: Mat }).transform;
  assert.ok(Math.abs(gx(t, 0, 0.5)) < 1e-9 && Math.abs(gx(t, 1, 0.5) - 1) < 1e-9 && Math.abs(gx(t, 0.5, 0) - 0.5) < 1e-9);
  // 135deg: углы бокса получают 0% и 100%
  const d = (parseGradient('linear-gradient(135deg, rgb(255, 255, 255) 0%, rgb(0, 0, 0) 100%)', 300, 120).paint as { transform: Mat }).transform;
  assert.ok(Math.abs(gx(d, 0, 0)) < 1e-9 && Math.abs(gx(d, 1, 1) - 1) < 1e-9, 'угловой градиент');
  // to top right: противоположные углы
  const tr = (parseGradient('linear-gradient(to right top, red, blue)', 400, 100).paint as { transform: Mat }).transform;
  assert.ok(Math.abs(gx(tr, 0, 1)) < 1e-9 && Math.abs(gx(tr, 1, 0) - 1) < 1e-9);
});

test('радиальный градиент и остановки: позиции, прозрачность, px', () => {
  const r = parseGradient('radial-gradient(circle at 30% 40%, rgb(255, 153, 0) 0%, rgb(255, 153, 0) 20%, rgba(255, 153, 0, 0) 60%)', 300, 160).paint!;
  assert.equal(r.type, 'GRADIENT_RADIAL');
  const t = (r as { transform: Mat }).transform;
  const c = apply(t, 0.3, 0.4);
  assert.ok(Math.abs(c[0] - 0.5) < 1e-9 && Math.abs(c[1] - 0.5) < 1e-9, 'центр в 30% 40%');
  const { stops } = normalizeStops([{ color: { r: 1, g: 0, b: 0, a: 1 } }, { color: { r: 0, g: 0, b: 0, a: 0 }, posPx: 50 }, { color: { r: 0, g: 0, b: 1, a: 1 } }], 100);
  assert.equal(stops[0].position, 0);
  assert.equal(stops[stops.length - 1].position, 1);
  const transparent = stops.filter((s) => s.color.a === 0);
  assert.ok(transparent.length === 2 && transparent[0].color.r === 1 && transparent[1].color.b === 1, 'прозрачная остановка получает RGB соседей (без «грязного» перехода)');
  assert.equal(parseGradient('repeating-linear-gradient(red, blue 10px)', 10, 10).paint, null, 'repeating — растровый слой');
});

test('радиусы: 999px нормализуется, четыре угла, эллипс, проценты', () => {
  const pill = normalizeRadii([[999, 999], [999, 999], [999, 999], [999, 999]], 120, 30);
  assert.deepEqual(pill.radii, [15, 15, 15, 15]);
  const four = normalizeRadii([[24, 24], [8, 8], [40, 40], [2, 2]], 120, 70);
  assert.deepEqual(four.radii, [24, 8, 40, 2]);
  const ell = normalizeRadii([parseRadius('50%', 200, 100), parseRadius('50%', 200, 100), parseRadius('50%', 200, 100), parseRadius('50%', 200, 100)], 200, 100);
  assert.ok(ell.ellipse && ell.elliptical);
  const arch = normalizeRadii([[300, 300], [300, 300], [0, 0], [0, 0]], 580, 720);
  assert.ok(Math.abs(arch.radii[0] - 290) < 1e-9, 'арка: радиусы уменьшены по ширине');
});

test('фильтры и семейства шрифтов', () => {
  const f = parseFilter('blur(4px) drop-shadow(rgba(0, 0, 0, 0.3) 0px 4px 6px) sepia(0.6) url("#x")');
  assert.equal(f.blur, 4);
  assert.equal(f.dropShadows.length, 1);
  assert.deepEqual(f.color, ['sepia(0.6)']);
  assert.ok(f.other.includes('url()'));
  assert.deepEqual(parseFontFamilies('"Courier Prime", Cousine, "Courier New", monospace'), ['Courier Prime', 'Cousine', 'Courier New', 'monospace']);
});

test('clip-path inset(): пустая площадь, нулевой отступ со скруглением, проценты', () => {
  assert.deepEqual(parseInset('inset(0px 0px 100% 0px)', 200, 100), { empty: true, zero: false, round: 0 });
  assert.deepEqual(parseInset('inset(0px 100% 0px 0px)', 200, 100), { empty: true, zero: false, round: 0 });
  assert.deepEqual(parseInset('inset(0px round 12px)', 200, 100), { empty: false, zero: true, round: 12 });
  assert.deepEqual(parseInset('inset(50%)', 200, 100), { empty: true, zero: false, round: 0 });
  assert.deepEqual(parseInset('inset(10px 20%)', 200, 100), { empty: false, zero: false, round: 0 });
  assert.equal(parseInset('inset(calc(10px + 5%))', 200, 100), null);
  assert.equal(parseInset('polygon(0 0, 100% 0, 0 100%)', 200, 100), null);
});
