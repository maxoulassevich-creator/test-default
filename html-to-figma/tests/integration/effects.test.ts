/*
 * Сложные эффекты: повороты вокруг transform-origin, веер, вложенные
 * translate/scale/rotate, равномерный масштаб с текстом, color-mix/display-p3/oklch,
 * opacity: 0, несколько теней и spread, четыре разных радиуса, обрезка,
 * SVG с глобальным фильтром и overflow: visible, псевдоэлементы, буквица,
 * маленький текст 2.772px, горизонтальная лента.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { FrameIR, NodeIR, RouteSnapshot, TextIR } from '../../shared/schema';
import { hasUnitAxes } from '../../shared/matrix';
import { FIX, startTestProcessor, TEST_PROFILE, zipWithFonts } from '../support/env';
import { analyzeZip, buildInMock, capture, closeTestBrowser, newMock, processorSource, renderHtml, verifyInMock, writeReport, type TP } from '../support/pipeline';

let t: TP;
let snap: RouteSnapshot;
let id = '';
let doc: any;
before(async () => {
  t = await startTestProcessor();
  const a = await analyzeZip(t, zipWithFonts(path.join(FIX, 'effects')), 'effects.zip', { profile: TEST_PROFILE });
  id = a.id;
  const c = await capture(t, id, ['index.html']);
  assert.equal(c.state, 'captured', JSON.stringify(c.error));
  doc = await t.json(`/api/jobs/${id}/document`);
  snap = await processorSource(t, id, doc).snapshot('index.html');
});
after(async () => { await t.cleanup(); await closeTestBrowser(); });

function all(nodes: NodeIR[], out: NodeIR[] = []): NodeIR[] { for (const n of nodes) { out.push(n); if (n.kind === 'frame') all(n.children, out); } return out; }
const find = (pred: (n: NodeIR) => boolean) => all(snap.children).filter(pred);
/** Ноды элемента по тегу и первому классу (src вида tag#id.class1.class2). */
const bySrc = (s: string) => {
  const [tag, cls] = s.split('.');
  const re = new RegExp(`^${tag}(#[\\w-]+)?\\.${cls}(\\.|$)`);
  return find((n) => n.kind !== 'text' && re.test(n.src ?? '') && !(n.src ?? '').includes('::'));
};
const texts = () => find((n) => n.kind === 'text') as TextIR[];

test('браузерная геометрия восстановлена без расхождений, подготовка не сдвинула элементы', () => {
  assert.equal(snap.stats.transformMismatches, 0, 'AABB(cum·box) == getBoundingClientRect');
  assert.equal(snap.stats.prepShift, 0);
});

test('все матрицы — с единичными осями; масштаб перенесён в размеры', () => {
  for (const n of all(snap.children)) assert.ok(hasUnitAxes(n.m, 1e-4), `оси ${n.name}: ${n.m}`);
  // .scaled: transform: scale(1.5) от левого верхнего угла → 240×150 и кегль 18px
  const sc = bySrc('div.scaled')[0] as FrameIR;
  assert.ok(sc && Math.abs(sc.w - 240) < 0.6 && Math.abs(sc.h - 150) < 0.6, `масштабированный блок ${sc?.w}×${sc?.h}`);
  const t1 = all(sc.children).find((n) => n.kind === 'text') as TextIR;
  assert.ok(Math.abs(t1.runs[0].size - 18) < 0.01, 'кегль ×1.5: ' + t1.runs[0].size);
  assert.ok(Math.abs((sc.radius?.[0] ?? 0) - 12) < 0.01, 'радиус ×1.5');
});

test('поворот вокруг transform-origin: центр вращения не смещён', () => {
  const sheets = bySrc('div.sheet');
  assert.equal(sheets.length, 3);
  const angles = sheets.map((s) => (Math.atan2(s.m[1], s.m[0]) * 180) / Math.PI);
  assert.ok(Math.abs(angles[0] + 14) < 0.05 && Math.abs(angles[1] + 2) < 0.05 && Math.abs(angles[2] - 11) < 0.05, 'углы ' + angles.join(','));
  // точка origin (50% 90%) листа 1 в координатах родителя совпадает с неповёрнутой
  const s = sheets[0];
  const ox = 75, oy = 180;
  const px = s.m[0] * ox + s.m[2] * oy + s.m[4], py = s.m[1] * ox + s.m[3] * oy + s.m[5];
  assert.ok(Math.abs(px - (120 + ox)) < 0.05 && Math.abs(py - (20 + oy)) < 0.05, `origin ${px},${py}`);
});

test('цвета: color-mix, display-p3, oklch разобраны; opacity 0 сохранена явно', () => {
  const chips = bySrc('div.chip');
  assert.equal(chips.length, 5, JSON.stringify(find((n) => (n.src ?? '').startsWith('div.chip')).map((n) => [n.kind, n.src, n.name, n.w, n.h])));
  const fill = (n: NodeIR) => (n as FrameIR).fills.find((f) => f.type === 'SOLID') as { color: { r: number; g: number; b: number } } | undefined;
  for (const c of chips) assert.ok(fill(c), 'заливка распознана у ' + c.name);
  const mix = fill(chips.find((c) => c.src === 'div.chip')!)!.color;
  // color-mix(in srgb, #c96 60%, #36c) = 0.6*(204,153,102)+0.4*(51,102,204)
  assert.ok(Math.abs(mix.r * 255 - 142.8) < 1.5 && Math.abs(mix.g * 255 - 132.6) < 1.5 && Math.abs(mix.b * 255 - 142.8) < 1.5, 'color-mix ' + JSON.stringify(mix));
  const ghost = chips.find((c) => c.opacity === 0);
  assert.ok(ghost, 'элемент с opacity:0 сохранён с явным нулём');
  // несколько теней + кольцо inset → обводка; четыре разных радиуса
  const ch = chips.find((c) => c.src === 'div.chip') as FrameIR;
  assert.ok(ch.stroke && Math.abs(ch.stroke.weights[0] - 2) < 0.01, 'inset-кольцо → обводка INSIDE');
  assert.equal(ch.effects?.filter((e) => e.type === 'DROP_SHADOW').length, 2);
  assert.deepEqual(ch.radius!.map((r) => Math.round(r)), [24, 8, 40, 2]);
  // spread без видимой заливки+клипа переносится отдельным прямоугольником (ограничение Figma)
  // элемент с opacity < 1 образует контекст наложения и рисуется позже соседей — ищем по классу
  const spread = chips.find((c) => (c.src ?? '').includes('.spread')) as FrameIR;
  const shadowHost = spread.kind === 'frame' ? spread.children.find((c) => c.name === 'Фон и тень') ?? spread : spread;
  assert.ok((shadowHost.effects ?? []).some((e) => e.type === 'DROP_SHADOW' && e.spread === 6), 'spread 6px сохранён: ' + JSON.stringify([spread.src, spread.kind, shadowHost.effects]));
  // пилюля 999px → радиус нормализован до половины высоты
  const pill = bySrc('span.pill');
  const pr = pill.length ? (pill[0] as FrameIR).radius : (find((n) => n.name.startsWith('Фон span.pill'))[0] as FrameIR | undefined)?.radius;
  assert.ok(pr && pr[0] < 30, 'радиус пилюли нормализован: ' + pr);
});

test('SVG: глобальный градиент как вектор, акварель с глобальным фильтром и overflow:visible — растр с расширенной областью', () => {
  const vec = find((n) => n.kind === 'svg' && n.name.includes('svg'));
  assert.ok(vec.length >= 1, 'векторный SVG');
  const vtext = JSON.stringify(vec.map((v) => (v as { asset: string }).asset));
  assert.ok(vtext.length > 2);
  const raster = find((n) => n.kind === 'image' && (n.tags ?? []).includes('raster') && n.name.startsWith('Иллюстрация'));
  assert.ok(raster.length >= 1, 'растр иллюстрации с фильтром');
  const r = raster[0];
  // overflow:visible + фильтр: растр больше viewport 200×140 и смещён в минус
  assert.ok(r.w > 205 && r.w < 320, `расширенная область ${r.w}×${r.h}: акварель шире viewport 200 px и не обрезана прямоугольником`);
  const asset = doc.assets.find((a: { id: string }) => a.id === (r as { asset: string }).asset);
  assert.equal(asset.mime, 'image/png', 'прозрачность сохранена (PNG)');
});

test('clip-path inset(): пустая область — скрытый редактируемый слой, inset(0 round) — обрезка без растра', () => {
  const hidden = find((n) => (n.src ?? '').includes('div.reveal-hidden'))[0];
  assert.ok(hidden && hidden.visible === false, 'скрыт: ' + JSON.stringify(hidden && { kind: hidden.kind, visible: hidden.visible }));
  assert.ok(texts().some((x) => x.text.includes('Скрыт анимацией')), 'текст внутри сохранён редактируемым');
  const round = find((n) => (n.src ?? '').includes('div.reveal-round'))[0] as FrameIR;
  assert.equal(round.kind, 'frame');
  assert.ok(round.clip, 'обрезка по рамке');
  assert.deepEqual(round.radius, [14, 14, 14, 14]);
  assert.ok(!round.tags?.includes('raster'), 'не растеризован');
});

test('текст: псевдоэлементы, буквица, маленькие подписи, uppercase, градиентный текст', () => {
  const ts = texts();
  const has = (s: string) => ts.find((x) => x.text.includes(s));
  assert.ok(has('ОБРАЩЕНИЕ К ЧИТАТЕЛЮ · ДЕНЬ'), 'text-transform: uppercase применён');
  assert.ok(has('→'), 'содержимое ::after');
  assert.ok(find((n) => n.name === '::before').length >= 1, 'кружок ::before');
  const cap = ts.find((x) => x.text === 'К');
  assert.ok(cap && cap.runs[0].size > 60, 'буквица ::first-letter отдельным слоем 64px');
  const tiny = has('крошечная');
  assert.ok(tiny && Math.abs(tiny.runs[0].size - 2.772) < 0.001, 'маленький текст не уменьшен и не увеличен: ' + tiny?.runs[0].size);
  assert.ok(has('Градиентный текст'));
  const coverTitle = has('ШЕСТЬ СОРОК');
  assert.ok(coverTitle && coverTitle.runs[0].size === 6);
});

test('модель Figma: сборка без ошибок API, геометрия и визуальное сравнение', async () => {
  const mock = newMock({ render: renderHtml });
  const r = await buildInMock(mock, processorSource(t, id, doc), ['index.html']);
  assert.ok(r.done, JSON.stringify(r.error ?? r.aborted));
  const v = await verifyInMock(mock);
  assert.ok(v.ok, JSON.stringify({ p: v.positionIssues.slice(0, 5), o: v.newOverlaps.slice(0, 5), t: v.textIssues.slice(0, 3) }));
  const png = await (mock.roots()[0] as unknown as { exportAsync(): Promise<Uint8Array> }).exportAsync();
  const st = await t.json(`/api/jobs/${id}`);
  const cmp = await t.json(`/api/jobs/${id}/verify/${st.routes.find((x: { key: string }) => x.key === 'index.html').fileId}`, { method: 'POST', body: new Uint8Array(png), headers: { 'content-type': 'image/png' } });
  if (process.env.H2F_DUMP) { const fs = await import('node:fs'); fs.writeFileSync(path.join(process.env.H2F_DUMP, 'effects-figma.png'), png); fs.copyFileSync(path.join(t.dataDir, 'jobs', id, 'shots', st.routes.find((x: { key: string }) => x.key === 'index.html').fileId + '.png'), path.join(process.env.H2F_DUMP, 'effects-src.png')); }
  writeReport('effects-page.json', { scope: 'Chromium + модель Figma API (не настоящая Figma)', stats: snap.stats, verify: v, compare: cmp, diagnostics: snap.diagnostics.map((d) => d.code + ': ' + d.message) });
  assert.ok(cmp.meanAbs < 6, 'средняя разница ' + cmp.meanAbs);
});
