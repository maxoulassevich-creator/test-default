/*
 * Наведение: закреплённая поза (переписаны только селекторы CSSOM) сравнивается с
 * НАСТОЯЩИМ наведением курсора в исходном, неизменённом CSS. Проверяется оверлей
 * a::after, сохранение @media (hover:hover), строковые атрибуты с «:hover»,
 * раскрытие ровно одной карточки и её поза в модели.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DEFAULT_PROFILE, type FrameIR, type NodeIR } from '../../shared/schema';
import { rewriteHoverSelector } from '../../capture/hover';
import { call, getBrowser, inject, newContext } from '../../processor/src/browser';
import { BLOGS, FIX, serveDir, startTestProcessor, TEST_PROFILE, zipWithFonts } from '../support/env';
import { analyzeZip, buildInMock, capture, closeTestBrowser, newMock, processorSource, verifyInMock, writeReport, type TP } from '../support/pipeline';

let t: TP;
before(async () => { t = await startTestProcessor(); });
after(async () => { await t.cleanup(); await closeTestBrowser(); });

test('переписывание :hover только в селекторах', () => {
  assert.equal(rewriteHoverSelector('.card:hover .more'), '.card[data-h2f-hover] .more');
  assert.equal(rewriteHoverSelector('.card:not(:hover) h3'), '.card:not([data-h2f-hover]) h3');
  assert.equal(rewriteHoverSelector('.note[data-x=":hover"]'), '.note[data-x=":hover"]', 'строка в атрибуте не меняется');
  assert.equal(rewriteHoverSelector('a:hover::after'), 'a[data-h2f-hover]::after');
  assert.equal(rewriteHoverSelector('.x:hovered'), '.x:hovered', 'другой псевдокласс не задет');
  assert.equal(rewriteHoverSelector('.row:has(.card:hover)'), '.row:has(.card[data-h2f-hover])');
});

const PROPS = ['transform', 'opacity', 'width', 'height', 'max-height', 'background-color', 'box-shadow', 'color', 'flex-grow'];

async function snapshotStyles(page: import('playwright-core').Page, sel: string) {
  return page.evaluate(({ sel, props }) => {
    const card = document.querySelector(sel)!;
    return [card, ...Array.from(card.querySelectorAll('*'))].flatMap((e) => ['', '::before', '::after'].map((ps) => { const cs = getComputedStyle(e, ps || null); return props.map((p) => cs.getPropertyValue(p)).join('|'); }));
  }, { sel, props: PROPS });
}

test('закреплённая поза совпадает с настоящим наведением в исходном CSS; @media сохранены', async () => {
  const srv = await serveDir([path.join(FIX, 'hover'), BLOGS]);
  try {
    const { browser } = await getBrowser();
    const profile = { ...DEFAULT_PROFILE, blockExternal: true };
    const inj = [{ url: srv.origin + 'fonts.css' }];
    // 1) настоящий курсор, исходный CSS
    const c1 = await newContext(browser, { profile, siteOrigin: srv.origin, injectCss: inj });
    const p1 = await c1.newPage();
    await p1.goto(srv.origin + 'index.html');
    const k1 = await inject(p1);
    await call(p1, k1, 'settle', {});
    const before = await p1.evaluate(() => { const out: string[] = []; const walk = (l: CSSRuleList) => { for (const r of Array.from(l)) { if ((r as CSSMediaRule).conditionText !== undefined) out.push((r as CSSMediaRule).conditionText); if ((r as CSSGroupingRule).cssRules) walk((r as CSSGroupingRule).cssRules); } }; for (const s of Array.from(document.styleSheets)) { try { walk(s.cssRules); } catch { /* */ } } return out; });
    // 2) закреплённая поза
    const c2 = await newContext(browser, { profile, siteOrigin: srv.origin, injectCss: inj });
    const p2 = await c2.newPage();
    await p2.goto(srv.origin + 'index.html');
    const k2 = await inject(p2);
    await call(p2, k2, 'settle', {});
    const cands = await call<Array<{ selector: string; label: string }>>(p2, k2, 'hoverCandidates', []);
    assert.ok(cands.length >= 1, 'кандидаты найдены');
    assert.ok(/card/.test(cands[0].selector), 'выбрана карточка, а не ссылка меню: ' + cands[0].selector);
    assert.ok(cands[0].label.includes('Проза'), 'первая карточка');
    const pin = await call<{ hit: string; point: [number, number] }>(p2, k2, 'pin', 0, null);
    assert.ok(/^a\.link/.test(pin.hit), 'hit target — ссылка с оверлеем ::after: ' + pin.hit);
    await call(p2, k2, 'settle', { timeoutMs: 3000 });
    await call(p2, k2, 'finishAnimations');
    const after = await p2.evaluate(() => { const out: string[] = []; const walk = (l: CSSRuleList) => { for (const r of Array.from(l)) { if ((r as CSSMediaRule).conditionText !== undefined) out.push((r as CSSMediaRule).conditionText); if ((r as CSSGroupingRule).cssRules) walk((r as CSSGroupingRule).cssRules); } }; for (const s of Array.from(document.styleSheets)) { try { walk(s.cssRules); } catch { /* */ } } return out; });
    assert.deepEqual(after, before, 'условия @media не изменены');
    assert.ok(after.some((c) => c.includes('(hover: hover)') || c.includes('(hover:hover)')), 'media (hover:hover) на месте: ' + after.join(' | '));
    const attrRule = await p2.evaluate(() => { for (const s of Array.from(document.styleSheets)) for (const r of Array.from(s.cssRules)) if (r instanceof CSSStyleRule && r.selectorText.includes('data-x')) return r.selectorText; return ''; });
    assert.ok(attrRule.includes(':hover'), 'атрибут со строкой «:hover» не изменён: ' + attrRule);
    // реальная мышь в той же точке
    await p1.evaluate(([x, y]) => window.scrollTo(0, Math.max(0, y - 400)), pin.point);
    const sy = await p1.evaluate(() => scrollY);
    await p1.mouse.move(pin.point[0], pin.point[1] - sy);
    await p1.waitForTimeout(50);
    await call(p1, k1, 'finishAnimations');
    await p1.evaluate(() => window.scrollTo(0, 0));
    const sel = '.row .card:nth-child(1)';
    const real = await snapshotStyles(p1, sel);
    const pinned = await snapshotStyles(p2, sel);
    assert.equal(pinned.length, real.length);
    const diffs = real.map((v, i) => (v === pinned[i] ? null : { i, real: v, pinned: pinned[i] })).filter(Boolean);
    assert.equal(diffs.length, 0, JSON.stringify(diffs.slice(0, 4)));
    // соседние карточки в обоих случаях одинаковы (flex сжал их одинаково)
    for (const n of [2, 3, 4]) assert.deepEqual(await snapshotStyles(p2, `.row .card:nth-child(${n})`), await snapshotStyles(p1, `.row .card:nth-child(${n})`));
    // раскрыта ровно одна карточка
    const open = await p2.evaluate(() => Array.from(document.querySelectorAll('.more')).filter((e) => getComputedStyle(e).opacity === '1').length);
    assert.equal(open, 1);
    writeReport('hover-real-pointer.json', { scope: 'Chromium: исходный CSS + настоящий курсор ↔ закреплённая поза (переписаны только селекторы)', samples: real.length, differences: 0, media: after, hit: pin.hit });
    await c1.close(); await c2.close();
  } finally { srv.close(); }
});

test('поза наведения переносится в макет: одна карточка шире, раскрытые подписи, веер, курсор', async () => {
  const { id } = await analyzeZip(t, zipWithFonts(path.join(FIX, 'hover')), 'hover.zip', { profile: TEST_PROFILE });
  const c = await capture(t, id, ['index.html']);
  assert.equal(c.state, 'captured', JSON.stringify(c.error));
  const doc = await t.json(`/api/jobs/${id}/document`);
  const snap = await processorSource(t, id, doc).snapshot('index.html');
  assert.ok(snap.hover.active, JSON.stringify(snap.hover));
  const all: NodeIR[] = [];
  const walk = (n: NodeIR) => { all.push(n); if (n.kind === 'frame') n.children.forEach(walk); };
  snap.children.forEach(walk);
  const cards = all.filter((n) => n.src === 'div.card') as FrameIR[];
  assert.equal(cards.length, 4);
  const widths = cards.map((cd) => cd.w);
  const wide = widths.filter((w) => w > Math.min(...widths) * 1.8);
  assert.equal(wide.length, 1, 'одна карточка расширена flex-grow: ' + widths.join(', ') + ' ' + JSON.stringify({ ...snap.hover, candidates: snap.hover.candidates.slice(0, 3) }));
  assert.ok(cards[0].tags?.includes('hover-card'));
  const more = all.filter((n) => n.src === 'div.more');
  assert.equal(more.filter((m) => m.opacity === undefined || m.opacity === 1).length, 1, 'дополнительные подписи раскрыты только у выбранной');
  const fan = (cards[0].children.find((x) => x.src === 'div.art') as FrameIR).children;
  const angles = fan.map((f) => Math.round((Math.atan2(f.m[1], f.m[0]) * 180) / Math.PI));
  assert.deepEqual(angles, [-12, 0, 10], 'веер листов в позе наведения');
  const cursor = all.filter((n) => n.tags?.includes('cursor'));
  assert.equal(cursor.length, 1, 'один удаляемый курсор');
  const mock = newMock();
  const r = await buildInMock(mock, processorSource(t, id, doc), ['index.html']);
  assert.ok(r.done, JSON.stringify(r.error));
  assert.equal(mock.roots().length, 1, 'нет отдельных hover-фреймов');
  assert.equal(mock.roots()[0].findAll((n) => /COMPONENT|INSTANCE/.test(n.type)).length, 0);
  const v = await verifyInMock(mock);
  assert.ok(v.ok, JSON.stringify(v.positionIssues.slice(0, 3)));
});
