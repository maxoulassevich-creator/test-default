/*
 * Страница в духе экспорта Tilda (на ней пользователь нашёл две ошибки в настоящей Figma):
 * зачёркнутая старая цена с цветом и толщиной линии, font-size: 0 между inline-block,
 * невидимый текст 0,5 px, системные чекбоксы, word-spacing, стек «-apple-system, …».
 * Сборка — в модели API с задержкой loadFontAsync и асинхронными сообщениями, как в Figma.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { CodeToUi } from '../../shared/messages';
import { FIX, startTestProcessor, TEST_PROFILE, zipWithFonts } from '../support/env';
import { analyzeZip, buildInMock, capture, closeTestBrowser, newMock, processorSource, verifyInMock, writeReport, type TP } from '../support/pipeline';

let t: TP;
before(async () => { t = await startTestProcessor(); });
after(async () => { await t.cleanup(); await closeTestBrowser(); });

test('магазин: зачёркнутые цены, font-size 0, чекбоксы — страница собирается целиком', async () => {
  const { id } = await analyzeZip(t, zipWithFonts(path.join(FIX, 'shop')), 'shop.zip', { profile: TEST_PROFILE });
  const c = await capture(t, id, ['index.html']);
  assert.equal(c.state, 'captured', JSON.stringify(c.error));
  const diags = (c.diagnostics as Array<{ level: string; code: string; message: string }>);
  assert.ok(!diags.some((d) => d.code === 'ir-invalid'), 'модель страницы корректна: ' + JSON.stringify(diags.filter((d) => d.level === 'error')));
  assert.ok(diags.some((d) => d.code === 'tiny-text'), 'текст меньше 1 px отмечен в диагностике');
  assert.ok(!diags.some((d) => d.code === 'generic-font' && /apple-system/.test(d.message)), '«-apple-system» не считается универсальным семейством');
  const doc = await t.json(`/api/jobs/${id}/document`);
  const snap = await processorSource(t, id, doc).snapshot('index.html');
  const all: Array<{ kind: string; runs?: Array<{ size: number; decoration?: string }> }> = [];
  const walk = (n: { kind: string; children?: unknown[] }) => { all.push(n as never); (n.children as Array<typeof n> | undefined)?.forEach(walk); };
  snap.children.forEach(walk as never);
  const runs = all.filter((n) => n.kind === 'text').flatMap((n) => n.runs!);
  assert.ok(runs.every((r) => r.size >= 1), 'нет кегля меньше 1 px');
  assert.ok(runs.some((r) => r.decoration === 'STRIKETHROUGH'), 'зачёркнутая цена');
  const mock = newMock({ fontDelayMs: 40 });
  const r = await buildInMock(mock, processorSource(t, id, doc), ['index.html']);
  assert.ok(r.done, JSON.stringify(r.error ?? r.aborted));
  const done = r.messages.find((m) => m.type === 'route-done') as Extract<CodeToUi, { type: 'route-done' }>;
  assert.ok(done.warnings.some((w) => /зачёркивания/.test(w.message)), 'предупреждение о линии зачёркивания: ' + JSON.stringify(done.warnings));
  const v = await verifyInMock(mock);
  assert.equal(v.positionIssues.filter((p) => Math.hypot(p.dx, p.dy) > 2).length, 0, JSON.stringify(v.positionIssues.slice(0, 3)));
  writeReport('shop-page.json', { scope: 'Chromium + модель Figma API (задержка loadFontAsync 40 мс)', diagnostics: diags.map((d) => d.code + ': ' + d.message), warnings: done.warnings, build: r.done!.summary, verify: { ok: v.ok, checked: v.checkedNodes, positionIssues: v.positionIssues.length, textIssues: v.textIssues.length } });
});
