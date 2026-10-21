/*
 * Шрифты и ресурсы: fallback по диапазонам (кириллица Courier Prime → Cousine),
 * UTF-16-диапазоны, отсутствующий шрифт останавливает создание ДО изменения холста,
 * явная замена с отчётом; битые/повреждённые картинки дают понятную диагностику;
 * длинная страница с lazy loading, reveal и fixed-шапкой.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { NodeIR, TextIR } from '../../shared/schema';
import { FIX, startTestProcessor, TEST_PROFILE, zipWithFonts } from '../support/env';
import { analyzeZip, buildInMock, capture, closeTestBrowser, FIXTURE_FONTS, newMock, processorSource, verifyInMock, writeReport, type TP } from '../support/pipeline';

let t: TP;
before(async () => { t = await startTestProcessor(); });
after(async () => { await t.cleanup(); await closeTestBrowser(); });

const flat = (ns: NodeIR[], out: NodeIR[] = []) => { for (const n of ns) { out.push(n); if (n.kind === 'frame') flat(n.children, out); } return out; };

test('кириллица: fallback по диапазонам UTF-16 и строгая проверка наличия шрифтов', async () => {
  const { id } = await analyzeZip(t, zipWithFonts(path.join(FIX, 'simple')), 'simple.zip', { profile: TEST_PROFILE });
  await capture(t, id, ['index.html']);
  const doc = await t.json(`/api/jobs/${id}/document`);
  const src = processorSource(t, id, doc);
  const snap = await src.snapshot('index.html');
  const mono = flat(snap.children).find((n) => n.kind === 'text' && n.text.includes('Сценарий')) as TextIR;
  assert.ok(mono, 'моноширинная строка');
  const fams = new Set(mono.runs.map((r) => r.font.split('|')[0]));
  assert.ok(fams.has('Cousine') && fams.has('Courier Prime'), 'Courier Prime для латиницы/знаков и Cousine для кириллицы: ' + [...fams]);
  for (const r of mono.runs) {
    const seg = mono.text.slice(r.start, r.end);
    if (r.font.startsWith('Courier Prime')) assert.ok(!/[А-Яа-яЁё]/.test(seg), 'кириллица не попала в Courier Prime: ' + seg);
  }
  // 1) все шрифты есть → строится; в модели диапазоны применены
  const m1 = newMock();
  const r1 = await buildInMock(m1, src, ['index.html']);
  assert.ok(r1.done);
  assert.ok(m1.stats.setRange > 0, 'диапазонный API использован');
  // 2) нет Cousine → остановка до изменения холста, понятный список
  const m2 = newMock({ fonts: FIXTURE_FONTS.filter((f) => f.family !== 'Cousine') });
  const before = m2.page.children.length;
  const r2 = await buildInMock(m2, src, ['index.html']);
  assert.ok(r2.stoppedBeforeCanvas, 'создание остановлено');
  assert.equal(m2.page.children.length, before, 'холст не изменён');
  const missing = r2.fonts.filter((f) => !f.found).map((f) => f.family);
  assert.deepEqual([...new Set(missing)], ['Cousine']);
  assert.ok(r2.fonts.find((f) => !f.found)!.note, 'причина указана');
  // 3) явная замена пользователем → строится, замена указана в результате
  const subs = Object.fromEntries(r2.fonts.filter((f) => !f.found).map((f) => [f.key, 'Liberation Mono']));
  const m3 = newMock({ fonts: [...FIXTURE_FONTS.filter((f) => f.family !== 'Cousine'), { family: 'Liberation Mono', style: 'Bold' }, { family: 'Liberation Mono', style: 'Italic' }] });
  const r3 = await buildInMock(m3, src, ['index.html'], { substitutions: subs });
  assert.ok(r3.done, JSON.stringify(r3.error));
  assert.ok(r3.fonts.filter((f) => f.note?.includes('замена')).length >= 1);
  // 4) нет начертания (только Regular у EB Garamond) → не подменяется другим весом
  const m4 = newMock({ fonts: FIXTURE_FONTS.filter((f) => !(f.family === 'EB Garamond' && f.style === 'Italic')) });
  const r4 = await buildInMock(m4, src, ['index.html']);
  assert.ok(r4.stoppedBeforeCanvas);
  assert.ok(r4.fonts.some((f) => !f.found && f.family === 'EB Garamond' && f.italic), 'курсив не подменён прямым начертанием');
});

test('маленький текст 2.772px и дробные размеры не ломают проверку', async () => {
  const { id } = await analyzeZip(t, zipWithFonts(path.join(FIX, 'effects')), 'effects.zip', { profile: TEST_PROFILE });
  await capture(t, id, ['index.html']);
  const doc = await t.json(`/api/jobs/${id}/document`);
  const src = processorSource(t, id, doc);
  for (const k of [0.92, 1.1]) {
    const m = newMock();
    const r = await buildInMock(m, src, ['index.html'], { textScale: k });
    assert.ok(r.done, 'метрики Figma ×' + k);
    const tiny = m.roots()[0].findAll((n) => n.type === 'TEXT' && (n as unknown as { characters: string }).characters.includes('крошечная'))[0] as unknown as { fontSize: number; per: Array<{ size: number }> };
    assert.ok(Math.abs(tiny.per[0].size - 2.772) < 1e-6, 'кегль не уменьшен: ' + tiny.per[0].size);
    const v = await verifyInMock(m);
    // при метриках ×1.1 тексты шире исходника — это сообщается, но строк столько же и позиции/наложения не меняются
    assert.equal(v.positionIssues.filter((p) => Math.abs(p.dy) > 2).length, 0, 'метрики ×' + k + ': ' + JSON.stringify(v.positionIssues.slice(0, 4)));
    assert.equal(v.textIssues.filter((x) => x.problem.includes('строк')).length, 0);
  }
});

test('битые и повреждённые изображения, отсутствующий фон, неизвестное семейство', async () => {
  const { id, status } = await analyzeZip(t, zipWithFonts(path.join(FIX, 'broken')), 'broken.zip', { profile: TEST_PROFILE });
  assert.equal(status.state, 'ready');
  const c = await capture(t, id, ['index.html']);
  assert.equal(c.state, 'captured', JSON.stringify(c.error));
  const diags = c.diagnostics.map((d: { code: string; message: string }) => d.code + ': ' + d.message);
  assert.ok(diags.some((d: string) => d.startsWith('broken-image') && d.includes('missing.png')), 'missing.png в диагностике');
  assert.ok(diags.some((d: string) => d.startsWith('broken-image') && d.includes('corrupt.png')), 'повреждённый PNG в диагностике');
  assert.ok(diags.some((d: string) => d.includes('missing-bg.jpg')), 'фон в диагностике: ' + diags.join(' | '));
  const doc = await t.json(`/api/jobs/${id}/document`);
  const snap = await processorSource(t, id, doc).snapshot('index.html');
  const ph = flat(snap.children).filter((n) => n.tags?.includes('broken-image'));
  assert.equal(ph.length, 2, 'две заглушки с альтернативным текстом');
  assert.ok(JSON.stringify(ph).includes('Нет такого файла'));
  const m = newMock();
  const r = await buildInMock(m, processorSource(t, id, doc), ['index.html']);
  assert.ok(r.done);
  writeReport('broken-resources.json', { scope: 'Chromium + модель API', diagnostics: diags });
});

test('длинная страница: полная высота, lazy-изображения, reveal, исходная поза fixed-шапки', async () => {
  const { id } = await analyzeZip(t, zipWithFonts(path.join(FIX, 'longpage')), 'long.zip', { profile: TEST_PROFILE });
  const c = await capture(t, id, ['index.html']);
  assert.equal(c.state, 'captured', JSON.stringify(c.error));
  const doc = await t.json(`/api/jobs/${id}/document`);
  const snap = await processorSource(t, id, doc).snapshot('index.html');
  assert.ok(snap.height > 8000, 'полная высота документа, а не viewport: ' + snap.height);
  if (process.env.H2F_DEBUG) console.log(JSON.stringify(flat(snap.children).filter((n) => n.kind === 'text').slice(-4).map((n) => [(n as TextIR).text.slice(0, 40), n.opacity, Math.round(n.m[5])])));
  const all = flat(snap.children);
  const gallery = all.find((n) => (n.src ?? '').includes('div.gallery'));
  assert.ok(gallery && (gallery.opacity === undefined || gallery.opacity === 1), 'reveal-блок ниже первого экрана раскрыт: ' + gallery?.opacity);
  const imgs = all.filter((n) => n.kind === 'image' || (n.kind === 'svg' && n.src === 'img'));
  assert.ok(all.filter((n) => n.kind === 'image').length >= 6, 'lazy-изображения загружены: ' + imgs.length);
  const header = snap.children[snap.children.length - 1];
  assert.equal(header.scroll, 'fixed');
  assert.ok(Math.abs(header.m[5]) < 0.5, 'шапка не спрятана (translateY(-100%) после прокрутки отменён)');
  const texts = all.filter((n) => n.kind === 'text') as TextIR[];
  assert.ok(texts.some((x) => x.text.includes('Конец.')));
  const m = newMock();
  const r = await buildInMock(m, processorSource(t, id, doc), ['index.html']);
  assert.ok(r.done, JSON.stringify(r.error ?? r.aborted));
  const v = await verifyInMock(m);
  assert.ok(v.ok, JSON.stringify(v.positionIssues.slice(0, 3)));
  writeReport('long-page.json', { scope: 'Chromium + модель API', height: snap.height, texts: texts.length, stats: snap.stats, verify: { ok: v.ok, checked: v.checkedNodes } });
});
