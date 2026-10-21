/*
 * Транзакционность и повторный импорт в модели Figma API (не настоящая Figma):
 * отмена в середине, искусственная ошибка на последней странице, повторное нажатие
 * без дублирования, восстановление удалённого фрейма в его слот, явная копия,
 * обновление с сохранением пользовательских правок, чужие слои не затрагиваются,
 * сетка без пересечений с учётом высоты ряда.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { findOverlaps } from '../../shared/grid';
import { FIX, startTestProcessor, TEST_PROFILE, zipWithFonts } from '../support/env';
import { analyzeZip, buildInMock, capture, closeTestBrowser, newMock, processorSource, verifyInMock, writeReport, type TP } from '../support/pipeline';

let t: TP;
let src: ReturnType<typeof processorSource>;
let keys: string[] = [];
before(async () => {
  t = await startTestProcessor();
  const { id, status } = await analyzeZip(t, zipWithFonts(path.join(FIX, 'spa')), 'catalog.zip', { profile: TEST_PROFILE, maxDepth: 1 });
  keys = (status.routes as Array<{ key: string; status: string }>).filter((r) => r.status === 'ok').map((r) => r.key).slice(0, 5);
  const c = await capture(t, id, keys);
  assert.equal(c.state, 'captured', JSON.stringify(c.error));
  src = processorSource(t, id, await t.json(`/api/jobs/${id}/document`));
});
after(async () => { await t.cleanup(); await closeTestBrowser(); });

function foreign(mock: ReturnType<typeof newMock>) {
  // «чужие» слои пользователя на той же странице
  const f = mock.figma.createFrame();
  f.name = 'Мой эскиз';
  f.resize(800, 600);
  f.x = 0; f.y = 0;
  const r = mock.figma.createRectangle();
  r.name = 'Чужой прямоугольник';
  r.x = 900; r.y = 100;
  return [f, r];
}

const boxes = (mock: ReturnType<typeof newMock>) => mock.page.children.map((n) => ({ key: n.name, x: n.x, y: n.y, width: n.width, height: n.height }));

test('отмена в середине: удаляются только объекты текущей попытки', async () => {
  const mock = newMock();
  const own = foreign(mock);
  const r = await buildInMock(mock, src, keys, { cancelAfterRoute: 2 });
  assert.ok(r.aborted, 'попытка отменена');
  assert.equal(mock.roots().length, 0, 'новых фреймов не осталось');
  assert.deepEqual(mock.page.children.map((n) => n.name), own.map((n) => n.name), 'чужие слои на месте');
});

test('ошибка на последней странице откатывает всю попытку', async () => {
  // считаем TEXT до последней страницы и ломаем первый TEXT последней
  const probe = newMock();
  const ok = await buildInMock(probe, src, keys.slice(0, -1));
  assert.ok(ok.done);
  const textsBefore = probe.stats.texts;
  const mock = newMock({ failAtText: textsBefore + 1 });
  const own = foreign(mock);
  const r = await buildInMock(mock, src, keys);
  assert.ok(r.aborted && r.aborted.reason.includes('Искусственная ошибка'), JSON.stringify(r.aborted ?? r.done));
  assert.ok(r.aborted.reason.includes('Страница'), 'в ошибке указаны страница и слой: ' + r.aborted.reason);
  assert.equal(mock.roots().length, 0);
  assert.equal(mock.page.children.length, own.length);
});

test('повторный запуск, восстановление удалённого фрейма, копия, обновление с правками', async () => {
  const mock = newMock();
  const own = foreign(mock);
  const r1 = await buildInMock(mock, src, keys, { columns: 2 });
  assert.ok(r1.done);
  const first = mock.roots();
  assert.equal(first.length, keys.length);
  assert.equal(findOverlaps(boxes(mock)).length, 0, 'сетка не пересекается с чужими слоями и между собой');
  // высота ряда — по самому высокому макету
  const rows = new Map<number, typeof first>();
  for (const f of first) { const reg = JSON.parse(f.getPluginData('h2f')); const l = rows.get(reg.slot[1]) ?? []; l.push(f); rows.set(reg.slot[1], l); }
  const r0 = rows.get(0)!, rr1 = rows.get(1)!;
  assert.ok(Math.min(...rr1.map((f) => f.y)) >= Math.max(...r0.map((f) => f.y + f.height)), 'следующий ряд ниже самого высокого макета');
  // повторное нажатие: ничего не дублируется
  const r2 = await buildInMock(mock, src, keys);
  assert.ok(r2.done);
  assert.equal(mock.roots().length, keys.length, 'повторный импорт не удвоил комплект');
  // пользователь удалил один фрейм → «добавить недостающие» восстанавливает его в тот же слот
  const victim = first[1];
  const slotPos = { x: victim.x, y: victim.y };
  const reg = JSON.parse(victim.getPluginData('h2f'));
  victim.remove();
  const r3 = await buildInMock(mock, src, keys);
  assert.ok(r3.done);
  const restored = mock.roots().find((f) => JSON.parse(f.getPluginData('h2f')).route === reg.route)!;
  assert.deepEqual({ x: restored.x, y: restored.y }, slotPos, 'восстановлен в исходной позиции');
  // правка пользователя в одном макете
  const edited = mock.roots()[0];
  const t0 = edited.findAll((n) => n.type === 'TEXT')[0] as unknown as { characters: string };
  t0.characters = t0.characters + ' (правка)';
  const editedId = edited.id;
  // обновление: неизменённые заменяются, изменённый сохраняется
  const r4 = await buildInMock(mock, src, keys, { mode: 'update' });
  assert.ok(r4.done);
  assert.equal(r4.done!.summary.kept, 1, 'изменённый макет сохранён');
  assert.equal(r4.done!.summary.replaced, keys.length - 1);
  const kept = mock.page.children.find((n) => n.id === editedId)!;
  assert.ok(kept && !kept.removed && kept.name.endsWith('(изменён вручную)'));
  assert.ok((kept.findAll((n) => n.type === 'TEXT')[0] as unknown as { characters: string }).characters.endsWith('(правка)'), 'правка не потеряна');
  // явная копия: новый комплект правее, старые не тронуты
  const before = mock.roots().length;
  const r5 = await buildInMock(mock, src, keys, { mode: 'copy' });
  assert.ok(r5.done);
  assert.equal(mock.roots().length, before + keys.length);
  assert.equal(findOverlaps(boxes(mock)).length, 0, 'копия не пересекается с существующим: ' + JSON.stringify(findOverlaps(boxes(mock))) + JSON.stringify(boxes(mock)));
  for (const o of own) assert.ok(!o.removed, 'чужие слои целы');
  const v = await verifyInMock(mock);
  assert.equal(v.frameOverlaps.length, 0);
  writeReport('transactions.json', { scope: 'Модель Figma API (не настоящая Figma)', routes: keys.length, created: r1.done!.summary, replaced: r4.done!.summary, copy: r5.done!.summary, verify: { ok: v.ok, frames: v.frames, overlaps: v.frameOverlaps.length } });
});

test('режим просмотра: высота экрана, вертикальная прокрутка, закреплённая шапка; возврат к полной высоте', async () => {
  const mock = newMock();
  const r = await buildInMock(mock, src, keys.slice(0, 2));
  assert.ok(r.done);
  const project = src.doc.projectKey;
  await mock.send({ type: 'mode', project, viewport: true });
  for (const f of mock.roots()) { assert.equal(f.height, 1000); assert.equal(f.props.overflowDirection, 'VERTICAL'); assert.ok((f.props.numberOfFixedChildren as number) >= 1); }
  await mock.send({ type: 'mode', project, viewport: false });
  for (const f of mock.roots()) { const reg = JSON.parse(f.getPluginData('h2f')); assert.equal(f.height, reg.height); assert.equal(f.props.overflowDirection, 'NONE'); }
  // переключение режима не считается правкой пользователя
  const r2 = await buildInMock(mock, src, keys.slice(0, 2), { mode: 'update' });
  assert.equal(r2.done!.summary.kept, 0);
});
