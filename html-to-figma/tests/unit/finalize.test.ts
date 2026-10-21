import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeExpect, normalizeScales, pruneWrappers } from '../../processor/src/finalize';
import { hasUnitAxes } from '../../shared/matrix';
import type { FrameIR, NodeIR, TextIR } from '../../shared/schema';

const text = (m: number[]): TextIR => ({ kind: 'text', id: 't', name: 't', m: m as never, w: 100, h: 20, text: 'Привет', runs: [{ start: 0, end: 6, font: 'f', size: 12, color: { r: 0, g: 0, b: 0, a: 1 }, letterSpacing: 1 }], lineHeight: 20, align: 'LEFT', lines: 1 });

test('равномерный масштаб переносится в размеры, кегль, радиусы и тени поддерева', () => {
  const s = 1.5, c = Math.cos(0.2), si = Math.sin(0.2);
  const f: FrameIR = { kind: 'frame', id: 'f', name: 'f', m: [s * c, s * si, -s * si, s * c, 10, 20], w: 160, h: 100, fills: [], clip: false, radius: [8, 8, 8, 8], effects: [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.2 }, x: 0, y: 4, blur: 10, spread: 0 }], children: [text([1, 0, 0, 1, 10, 10])] };
  const diags: never[] = [];
  normalizeScales([f], diags, 'r');
  assert.ok(hasUnitAxes(f.m), 'оси единичные');
  assert.ok(Math.abs(f.w - 240) < 1e-9 && Math.abs(f.h - 150) < 1e-9);
  assert.ok(f.radius!.every((r) => Math.abs(r - 12) < 1e-9), 'радиусы: ' + f.radius);
  const t = f.children[0] as TextIR;
  assert.ok(Math.abs(t.runs[0].size - 18) < 1e-9 && Math.abs(t.lineHeight - 30) < 1e-9 && Math.abs(t.runs[0].letterSpacing - 1.5) < 1e-9);
  assert.ok(Math.abs(t.m[4] - 15) < 1e-9 && Math.abs(t.m[5] - 15) < 1e-9, 'позиция ребёнка масштабирована: ' + t.m);
  const e = f.effects![0] as { y: number; blur: number };
  assert.ok(Math.abs(e.y - 6) < 1e-9 && Math.abs(e.blur - 15) < 1e-9);
});

test('пустые обёртки удаляются с точным сложением переноса; ожидаемые рамки', () => {
  const inner: NodeIR = { kind: 'rect', id: 'r', name: 'r', m: [1, 0, 0, 1, 5, 6], w: 10, h: 10, fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }] };
  const wrap: FrameIR = { kind: 'frame', id: 'w', name: 'w', m: [1, 0, 0, 1, 100, 200], w: 50, h: 50, fills: [], clip: false, children: [inner] };
  const list: NodeIR[] = [wrap];
  assert.equal(pruneWrappers(list), 1);
  assert.deepEqual(list[0].m, [1, 0, 0, 1, 105, 206]);
  computeExpect(list);
  assert.deepEqual(list[0].expect, [105, 206, 10, 10]);
  const clipped: FrameIR = { ...wrap, clip: true, children: [{ ...inner }] };
  const l2: NodeIR[] = [clipped];
  assert.equal(pruneWrappers(l2), 0, 'обрезающий контейнер не удаляется');
});
