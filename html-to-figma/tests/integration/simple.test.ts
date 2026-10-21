/*
 * Простая страница: текст, курсив, ссылка, кнопка с SVG, картинка, градиент,
 * тени, радиусы. Полный путь: обработчик → модель → code.js в модели Figma API →
 * проверка геометрии → экспорт сцены модели → сравнение с исходником.
 * Уровень: браузер + модель API (не настоящая Figma).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FIX, startTestProcessor, TEST_PROFILE, zipWithFonts } from '../support/env';
import { analyzeZip, buildInMock, capture, closeTestBrowser, newMock, processorSource, renderHtml, verifyInMock, writeReport, type TP } from '../support/pipeline';

let t: TP;
before(async () => { t = await startTestProcessor(); });
after(async () => { await t.cleanup(); await closeTestBrowser(); });

test('простая страница: анализ, захват, редактируемые слои, геометрия и визуальное сравнение', async () => {
  const { id, status } = await analyzeZip(t, zipWithFonts(path.join(FIX, 'simple')), 'simple.zip', { profile: TEST_PROFILE });
  assert.equal(status.state, 'ready', JSON.stringify(status.error));
  const ok = status.routes.filter((r: { status: string }) => r.status === 'ok');
  assert.equal(ok.length, 1, 'одна страница: ' + JSON.stringify(status.routes.map((r: { key: string; status: string }) => r.key + ':' + r.status)));
  // якоря #about/#work/#contact — не страницы
  const anchors = status.routes.filter((r: { status: string }) => r.status === 'anchor').map((r: { key: string }) => r.key);
  assert.ok(anchors.some((k: string) => k.endsWith('#about')), 'якорь распознан: ' + anchors.join(','));
  const c = await capture(t, id, [ok[0].key]);
  assert.equal(c.state, 'captured', JSON.stringify(c.error));
  const doc = await t.json(`/api/jobs/${id}/document`);
  const src = processorSource(t, id, doc);
  const snap = await src.snapshot(ok[0].key);
  assert.ok(snap.height > 500 && snap.width === 1440, `размер ${snap.width}×${snap.height}`);
  assert.equal(snap.stats.transformMismatches, 0);
  assert.equal(snap.stats.prepShift, 0);
  // шрифты: курсив и моноширинный распознаны
  const fontKeys = doc.fonts.map((f: { key: string }) => f.key);
  for (const k of ['EB Garamond|400|n', 'EB Garamond|400|i', 'Cormorant Garamond|500|n', 'Courier Prime|400|n']) assert.ok(fontKeys.includes(k), 'шрифт ' + k + ' среди ' + fontKeys.join(', '));
  const mock = newMock({ render: renderHtml });
  const r = await buildInMock(mock, src, [ok[0].key]);
  assert.ok(r.done, 'сборка завершена: ' + JSON.stringify(r.error ?? r.aborted));
  const roots = mock.roots();
  assert.equal(roots.length, 1);
  const root = roots[0];
  const texts = root.findAll((n) => n.type === 'TEXT') as unknown as Array<{ characters: string; per: Array<{ font: { family: string; style: string } }> }>;
  const all = texts.map((x) => x.characters).join('\n');
  for (const s of ['Мастерская', 'Добрый день, читатель', 'Читать дальше', 'НОВАЯ РАБОТА · 2026', '© 2026 Мастерская']) assert.ok(all.includes(s), 'текст «' + s + '» редактируемый: ' + all.slice(0, 400));
  const italic = texts.some((x) => x.per.some((p) => p.font.family === 'EB Garamond' && p.font.style === 'Italic'));
  assert.ok(italic, 'курсив перенесён диапазоном');
  assert.equal(root.findAll((n) => n.type === 'COMPONENT' || n.type === 'INSTANCE').length, 0);
  assert.ok(root.findAll((n) => n.type === 'RECTANGLE' && JSON.stringify(n.fills).includes('IMAGE')).length >= 1, 'картинка — отдельный слой с IMAGE fill');
  assert.ok(root.findAll((n) => !!n.props.svgSource).length >= 1, 'иконка SVG — векторный слой');
  const v = await verifyInMock(mock);
  assert.ok(v.ok, 'проверка геометрии: ' + JSON.stringify({ pos: v.positionIssues.slice(0, 5), text: v.textIssues.slice(0, 5), ov: v.newOverlaps.slice(0, 5) }));
  // экспорт сцены модели → сравнение с исходником средствами обработчика
  const png = await (root as unknown as { exportAsync(): Promise<Uint8Array> }).exportAsync();
  const cmp = await t.json(`/api/jobs/${id}/verify/${c.routes.find((x: { key: string }) => x.key === ok[0].key).fileId}`, { method: 'POST', body: new Uint8Array(png), headers: { 'content-type': 'image/png' } });
  if (process.env.H2F_DUMP) { fs.writeFileSync(path.join(process.env.H2F_DUMP, 'simple-figma.png'), png); fs.copyFileSync(path.join(t.dataDir, 'jobs', id, 'shots', c.routes.find((x: { key: string }) => x.key === ok[0].key).fileId + '.png'), path.join(process.env.H2F_DUMP, 'simple-src.png')); }
  writeReport('simple-page.json', { scope: 'Chromium + модель Figma API (не настоящая Figma)', snapshot: snap.stats, verify: v, compare: cmp, mockStats: mock.stats });
  assert.ok(cmp.sizeMatch, 'размер экспорта совпадает');
  assert.ok(cmp.meanAbs < 6, 'средняя разница с исходником ' + cmp.meanAbs);
});
