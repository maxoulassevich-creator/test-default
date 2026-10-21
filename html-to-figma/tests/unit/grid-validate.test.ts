import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findOverlaps, layoutGrid, placeIntoSet, placeNewSet } from '../../shared/grid';
import { validateSnapshot } from '../../shared/validate';
import type { RouteSnapshot } from '../../shared/schema';

test('сетка: высота ряда по самому высокому макету, без пересечений', () => {
  const items = [{ key: 'a', width: 1440, height: 3000 }, { key: 'b', width: 1440, height: 6086 }, { key: 'c', width: 1440, height: 1000 }];
  const g = layoutGrid(items, 2, 200);
  assert.equal(g[2].y, 6086 + 200);
  const placed = placeNewSet(items, 2, [{ x: 0, y: 0, width: 5000, height: 400 }], { x: 0, y: 0 });
  const boxes = placed.map((p, i) => ({ key: p.key, x: p.x, y: p.y, width: items[i].width, height: items[i].height }));
  assert.equal(findOverlaps([...boxes, { key: 'user', x: 0, y: 0, width: 5000, height: 400 }]).length, 0);
  const pos = placeIntoSet({ key: 'b', width: 1440, height: 100 }, [1, 0], { x: 0, y: 0 }, [0, 3200], 1440, [{ x: 0, y: 0, width: 1440, height: 3000 }]);
  assert.deepEqual(pos, { x: 1640, y: 0 }, 'свободный исходный слот');
});

const base = (children: RouteSnapshot['children']): RouteSnapshot => ({ schemaVersion: '1.0', routeKey: 'k', url: 'k', title: '', label: '', viewport: { width: 1440, height: 1000 }, width: 1440, height: 100, background: [], children, fixedCount: 0, hover: { active: false, reason: '', candidates: [] }, stats: {}, diagnostics: [], fonts: ['f'], assets: [], capturedAt: '' });

test('валидация модели до мутации холста', () => {
  const ok = validateSnapshot(base([{ kind: 'rect', id: 'r', name: 'r', m: [1, 0, 0, 1, 0, 0], w: 10, h: 10, fills: [], opacity: 0 }]), new Set(['f']), new Set());
  assert.equal(ok.issues.length, 0, 'opacity: 0 допустима');
  const bad = validateSnapshot(base([
    { kind: 'rect', id: 'a', name: 'a', m: [2, 0, 0, 2, 0, 0], w: 10, h: 10, fills: [] },
    { kind: 'rect', id: 'b', name: 'b', m: [1, 0, 0, 1, NaN, 0], w: 10, h: 10, fills: [] },
    { kind: 'rect', id: 'c', name: 'c', m: [1, 0, 0, 1, 0, 0], w: 10, h: 10, fills: [], opacity: 1.5 },
    { kind: 'text', id: 't', name: 't', m: [1, 0, 0, 1, 0, 0], w: 10, h: 10, text: 'abc', runs: [{ start: 0, end: 2, font: 'f', size: 10, color: { r: 0, g: 0, b: 0, a: 1 }, letterSpacing: 0 }], lineHeight: 12, align: 'LEFT', lines: 1 },
  ]), new Set(['f']), new Set());
  const msgs = bad.issues.map((i) => i.message).join(' | ');
  for (const s of ['масштаб', 'не конечна', 'opacity', 'runs не покрывают']) assert.ok(msgs.includes(s), s + ' в ' + msgs);
});
