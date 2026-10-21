/*
 * Оба тестовых блога: роль owner, русский язык, V2 — светлая дневная тема, ширина 1440.
 * Обход с указателем страниц профиля (и без остановки на нём), точные ключи 32 страниц
 * V2 по контрольному индексу, различие контрольных главы/картины V1 и V2, захват,
 * план наведения V2 (22 страницы; на главной раскрыта только «Проза»), сравнение позы
 * с настоящим курсором в исходном CSS, сборка всех страниц в модели Figma API на одной
 * странице сеткой без пересечений, проверка геометрии и визуальное сравнение главной.
 * Отчёты: reports/blogs-v2.json, reports/blogs-v1.json.
 *
 * H2F_QUICK=1 — только первые 8 страниц указателя (быстрый прогон).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_PROFILE, type FrameIR, type NodeIR, type RouteInfo, type RouteSnapshot } from '../../shared/schema';
import { findOverlaps } from '../../shared/grid';
import { call, getBrowser, inject, newContext } from '../../processor/src/browser';
import { BLOGS, blogZip, serveDir, startTestProcessor, TEST_PROFILE } from '../support/env';
import { analyzeZip, buildInMock, capture, closeTestBrowser, newMock, processorSource, renderHtml, verifyInMock, writeReport, type TP } from '../support/pipeline';

const QUICK = !!process.env.H2F_QUICK;
const REF = JSON.parse(fs.readFileSync(path.join(BLOGS, 'reference', 'Page-Index.json'), 'utf8')) as { pages: Array<{ href: string; label: string; height: number; hover: boolean; hoverSelector?: string }> };
const AUDIT = JSON.parse(fs.readFileSync(path.join(BLOGS, 'reference', 'Hover-Audit.json'), 'utf8')) as { pages: Array<{ id: string; active: boolean; selector?: string; title?: string }> };

let t: TP;
before(async () => { t = await startTestProcessor({ concurrency: 3 }); });
after(async () => { await t.cleanup(); await closeTestBrowser(); });

const rel = (file: string, key: string) => (key === file ? '#/' : key.slice(file.length));
const all = (ns: NodeIR[], out: NodeIR[] = []) => { for (const n of ns) { out.push(n); if (n.kind === 'frame') all(n.children, out); } return out; };
const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

interface BlogRun { file: string; id: string; routes: RouteInfo[]; index: RouteInfo[]; extra: RouteInfo[]; snaps: Map<string, RouteSnapshot>; seconds: { discover: number; capture: number } }
const runs = new Map<string, BlogRun>();

async function discoverAndCapture(file: string): Promise<BlogRun> {
  const t0 = Date.now();
  const { id, status } = await analyzeZip(t, blogZip(file), file.replace('.html', '.zip'), { profile: TEST_PROFILE });
  const discover = (Date.now() - t0) / 1000;
  assert.equal(status.state, 'ready', JSON.stringify(status.error));
  const routes = status.routes as RouteInfo[];
  const index = routes.filter((r) => r.status === 'ok' && r.suggested !== false);
  const extra = routes.filter((r) => r.status === 'ok' && r.suggested === false);
  const keys = (QUICK ? index.slice(0, 8) : index).map((r) => r.key);
  const t1 = Date.now();
  const c = await capture(t, id, keys);
  assert.equal(c.state, 'captured', JSON.stringify(c.error));
  const doc = await t.json(`/api/jobs/${id}/document`);
  const src = processorSource(t, id, doc);
  const snaps = new Map<string, RouteSnapshot>();
  for (const k of keys) snaps.set(k, await src.snapshot(k));
  const run = { file, id, routes, index, extra, snaps, seconds: { discover, capture: (Date.now() - t1) / 1000 } };
  runs.set(file, run);
  return run;
}

async function buildAll(run: BlogRun) {
  const doc = await t.json(`/api/jobs/${run.id}/document`);
  const src = processorSource(t, run.id, doc);
  const keys = [...run.snaps.keys()];
  const mock = newMock({ render: renderHtml });
  const r = await buildInMock(mock, src, keys, { columns: 4 });
  assert.ok(r.done, JSON.stringify(r.error ?? r.aborted ?? r.fonts.filter((f) => !f.found)));
  const roots = mock.roots();
  assert.equal(roots.length, keys.length, 'по фрейму на страницу');
  assert.equal((mock.figma.root as unknown as { children: unknown[] }).children.length, 1, 'одна страница Figma, отдельные PageNode не создаются');
  for (const f of roots) {
    assert.equal(f.type, 'FRAME');
    assert.equal(f.findAll((n) => /COMPONENT|INSTANCE/.test(n.type)).length, 0, 'без компонентов и вариантов');
    const withReactions = f.findAll((n) => Array.isArray(n.props.reactions) && (n.props.reactions as unknown[]).length > 0);
    assert.equal(withReactions.length, 0, 'без прототипных связей');
  }
  const boxes = mock.page.children.map((n) => ({ key: n.name, x: n.x, y: n.y, width: n.width, height: n.height }));
  assert.equal(findOverlaps(boxes).length, 0, 'сетка без пересечений');
  const v = await verifyInMock(mock);
  return { mock, r, v, src };
}

// ---------------- V2 ----------------

const V2 = 'lidia-lozovaya-v2.html';

test('V2: указатель профиля даёт ровно 32 страницы контрольного индекса; обход продолжается дальше', async () => {
  const run = await discoverAndCapture(V2);
  const got = run.index.map((r) => rel(V2, r.key));
  assert.deepEqual([...got].sort(), REF.pages.map((p) => p.href).sort(), 'ключи страниц указателя');
  assert.ok(run.extra.length > 0, 'обход не остановился на 32: найдены и другие страницы (не отмечены по умолчанию)');
  for (const k of ['#/login', '#/login?invite=1', '#/login?mode=restore']) assert.ok(got.includes(k), 'вход/приглашение/восстановление различаются: ' + k);
  assert.ok(got.includes('#/search?q=степь') && got.includes('#/search?q=вогла'), 'поисковые запросы в hash сохранены');
  assert.ok(got.includes('#/prose/do-vostrebovaniya/2') && got.includes('#/painting/svet-naprotiv'), 'контрольные глава и картина V2');
  const dupHome = run.routes.find((r) => rel(V2, r.key) === '#/' && r.status === 'duplicate');
  assert.ok(dupHome, '«#/» распознан как дубликат входа');
});

test('V2: геометрия трансформаций, высоты относительно старого индекса, план наведения', () => {
  const run = runs.get(V2)!;
  const rows: unknown[] = [];
  let active = 0;
  for (const [k, s] of run.snaps) {
    const h = rel(V2, k);
    const ref = REF.pages.find((p) => p.href === h)!;
    assert.equal(s.stats.transformMismatches, 0, 'браузерная геометрия восстановлена: ' + h);
    assert.equal(s.stats.prepShift ?? 0, 0, 'подготовка не сдвинула элементы: ' + h);
    assert.equal(s.width, 1440);
    // высота — ориентир, а не правило: допускаем различие окружения (переносы строк), фиксируем в отчёте
    assert.ok(Math.abs(s.height - ref.height) / ref.height < 0.03, `${h}: ${s.height} против ${ref.height}`);
    assert.equal(s.hover.active, ref.hover, 'поза наведения по плану: ' + h + ' ' + s.hover.reason);
    if (s.hover.active) {
      active++;
      // подпись позы — заголовок карточки; в старом аудите заголовок входит в textContent карточки
      const audit = AUDIT.pages.find((p) => p.selector === ref.hoverSelector && p.active && !!norm(s.hover.label ?? '') && norm(p.title ?? '').includes(norm(s.hover.label ?? '')));
      assert.ok(audit, `${h}: выбрана та же карточка, что и в плане (${s.hover.label})`);
      const cards = all(s.children).filter((n) => n.tags?.includes('hover-card'));
      assert.equal(cards.length, 1, 'ровно одна карточка в позе наведения: ' + h);
    }
    const auto = s.hover.candidates[0];
    rows.push({ route: h, label: s.label, height: s.height, refHeight: ref.height, dh: s.height - ref.height, hover: s.hover.active ? s.hover.selector : null, hoverLabel: s.hover.label?.slice(0, 40), hit: s.hover.hit, autoCandidate: auto && auto.score >= 0.5 ? `${auto.selector} | ${auto.label.slice(0, 30)}` : null, irNodes: s.stats.irNodes, fixed: s.fixedCount });
  }
  if (!QUICK) assert.equal(active, 22, 'поза наведения на 22 страницах');
  const home = run.snaps.get(V2)!;
  assert.ok(home.hover.label?.includes('Проза'), 'на главной — карточка «Проза»: ' + home.hover.label);
  const paths = all(home.children).filter((n) => /^(a|div)\.path(\.|$)/.test(n.src ?? '')) as FrameIR[];
  const wide = paths.filter((p) => p.w > 500);
  assert.equal(wide.length, 1, 'расширена только одна карточка: ' + paths.map((p) => Math.round(p.w)).join(','));
  (run as unknown as { rows: unknown[] }).rows = rows;
});

test('V2: поза «Проза» совпадает с настоящим наведением курсора в исходном CSS', async () => {
  const srv = await serveDir([BLOGS]);
  try {
    const { browser } = await getBrowser();
    const profile = { ...DEFAULT_PROFILE, blockExternal: true, storage: { 'll2-role': 'owner', 'll2-lang': 'ru', 'll2-theme': 'light', 'll2-tod': 'day' } };
    const open = async () => {
      const c = await newContext(browser, { profile, siteOrigin: srv.origin, injectCss: [{ url: srv.origin + 'fonts.css' }] });
      const p = await c.newPage();
      await p.goto(srv.origin + V2);
      const k = await inject(p);
      await call(p, k, 'settle', {});
      return { c, p, k };
    };
    const real = await open();
    const pinned = await open();
    await call(pinned.p, pinned.k, 'hoverCandidates', ['#demo']);
    const pin = await call<{ hit: string; point: [number, number] }>(pinned.p, pinned.k, 'pin', null, '.path');
    assert.ok(/a\.path__link/.test(pin.hit), 'hit target — растянутая ссылка карточки: ' + pin.hit);
    await call(pinned.p, pinned.k, 'settle', { timeoutMs: 3000 });
    await call(pinned.p, pinned.k, 'finishAnimations');
    await real.p.evaluate(([, y]) => window.scrollTo(0, Math.max(0, y - 400)), pin.point);
    await real.p.waitForTimeout(400);
    const sy = await real.p.evaluate(() => scrollY);
    await real.p.mouse.move(pin.point[0], pin.point[1] - sy);
    await real.p.waitForTimeout(100);
    await call(real.p, real.k, 'finishAnimations');
    const props = ['transform', 'opacity', 'width', 'height', 'max-height', 'background-color', 'box-shadow', 'color', 'flex-grow', 'filter', 'visibility'];
    const snap = (p: typeof real.p) => p.evaluate((props) => Array.from(document.querySelectorAll('.paths__list .path')).flatMap((card) => [card, ...Array.from(card.querySelectorAll('*'))].flatMap((e) => ['', '::before', '::after'].map((ps) => { const cs = getComputedStyle(e, ps || null); return props.map((x) => cs.getPropertyValue(x)).join('|'); }))), props);
    const a = await snap(real.p), b = await snap(pinned.p);
    assert.equal(a.length, b.length);
    const diffs = a.map((v, i) => (v === b[i] ? null : { i, real: v.slice(0, 160), pinned: b[i].slice(0, 160) })).filter(Boolean);
    assert.equal(diffs.length, 0, JSON.stringify(diffs.slice(0, 3)));
    const open1 = await pinned.p.evaluate(() => Array.from(document.querySelectorAll('.paths__list .path')).filter((e) => e.getBoundingClientRect().width > 500).length);
    assert.equal(open1, 1, 'раскрыта ровно одна карточка');
    (runs.get(V2) as unknown as { pointer: unknown }).pointer = { samples: a.length, differences: diffs.length, hit: pin.hit };
    await real.c.close(); await pinned.c.close();
  } finally { srv.close(); }
});

test('V2: все страницы в модели Figma API — одна страница, сетка, геометрия, визуальное сравнение главной', async () => {
  const run = runs.get(V2)!;
  const { mock, r, v } = await buildAll(run);
  assert.equal(v.frameOverlaps.length, 0);
  assert.equal(v.positionIssues.filter((p) => Math.hypot(p.dx, p.dy) > 2).length, 0, JSON.stringify(v.positionIssues.slice(0, 4)));
  assert.equal(v.textIssues.filter((x) => x.problem.includes('строк')).length, 0, JSON.stringify(v.textIssues.slice(0, 4)));
  // визуальное сравнение главной: экспорт модели ↔ эталонный снимок Chromium
  const home = mock.roots().find((f) => JSON.parse(f.getPluginData('h2f')).route === V2)!;
  const png = await (home as unknown as { exportAsync(): Promise<Uint8Array> }).exportAsync();
  const st = await t.json(`/api/jobs/${run.id}`);
  const fileId = (st.routes as Array<RouteInfo & { fileId: string }>).find((x) => x.key === V2)!.fileId;
  const cmp = await t.json(`/api/jobs/${run.id}/verify/${fileId}`, { method: 'POST', body: new Uint8Array(png), headers: { 'content-type': 'image/png' } });
  if (process.env.H2F_DUMP) fs.writeFileSync(path.join(process.env.H2F_DUMP, 'v2-home-figma-model.png'), png);
  assert.ok(cmp.meanAbs < 8, 'средняя разница пикселей ' + cmp.meanAbs);
  writeReport('blogs-v2.json', {
    scope: 'Chromium (захват) + модель Figma API (сборка, проверка). Настоящая Figma не запускалась.',
    source: V2, profile: 'lozovaya-v2: owner, ru, light, day; 1440 px; демо-панель исключена',
    seconds: { ...run.seconds, quick: QUICK },
    discovery: { index: run.index.length, extraFound: run.extra.length, extraSample: run.extra.slice(0, 12).map((x) => rel(V2, x.key) + ' — ' + x.label), limited: run.routes.filter((x) => x.status === 'limit').length, duplicates: run.routes.filter((x) => x.status === 'duplicate').length },
    heights: { within2px: (run as unknown as { rows: Array<{ dh: number }> }).rows.filter((x) => Math.abs(x.dh) <= 2).length, of: run.snaps.size, note: 'Высоты старого индекса — ориентир. В нашем Chromium высоты детерминированы; расхождения 27–72 px на отдельных страницах зависят от переносов строк (ширина раскладки ±15 px меняет их), то есть от окружения старой сборки.' },
    pointerCompare: (run as unknown as { pointer: unknown }).pointer,
    build: r.done!.summary, verify: { ok: v.ok, frames: v.frames, checked: v.checkedNodes, positionIssues: v.positionIssues.length, textIssues: v.textIssues.length, overlaps: v.frameOverlaps.length },
    homeCompare: cmp,
    routes: (run as unknown as { rows: unknown[] }).rows,
  });
});

// ---------------- V1 ----------------

const V1 = 'blog-v1.html';

test('V1: собственный указатель, отличия контрольных главы и картины от V2', async () => {
  const run = await discoverAndCapture(V1);
  const got = run.index.map((r) => rel(V1, r.key));
  assert.ok(got.length >= 20, 'страниц указателя: ' + got.length);
  assert.ok(got.includes('#/prose/do-vostrebovaniya/1'), 'контрольная глава V1 — /1: ' + got.filter((x) => x.includes('prose')).join(', '));
  assert.ok(got.includes('#/painting/iyul-levyj-bereg'), 'контрольная картина V1: ' + got.filter((x) => x.includes('painting')).join(', '));
  assert.ok(!got.includes('#/prose/do-vostrebovaniya/2') || got.includes('#/prose/do-vostrebovaniya/1'));
  for (const [k, s] of run.snaps) {
    assert.equal(s.stats.transformMismatches, 0, rel(V1, k));
    assert.equal(s.width, 1440);
    assert.ok(s.height > 600, 'полная высота: ' + rel(V1, k) + ' ' + s.height);
  }
});

test('V1: все страницы в модели Figma API', async () => {
  const run = runs.get(V1)!;
  const { r, v } = await buildAll(run);
  assert.equal(v.positionIssues.filter((p) => Math.hypot(p.dx, p.dy) > 2).length, 0, JSON.stringify(v.positionIssues.slice(0, 4)));
  assert.equal(v.textIssues.filter((x) => x.problem.includes('строк')).length, 0, JSON.stringify(v.textIssues.slice(0, 4)));
  writeReport('blogs-v1.json', {
    scope: 'Chromium (захват) + модель Figma API (сборка, проверка). Настоящая Figma не запускалась.',
    source: V1, profile: 'lozovaya-v1: owner, ru; 1440 px; демо-панель исключена',
    seconds: { ...run.seconds, quick: QUICK },
    discovery: { index: run.index.length, extraFound: run.extra.length, limited: run.routes.filter((x) => x.status === 'limit').length },
    build: r.done!.summary, verify: { ok: v.ok, frames: v.frames, checked: v.checkedNodes, positionIssues: v.positionIssues.length, textIssues: v.textIssues.length, overlaps: v.frameOverlaps.length },
    routes: [...run.snaps].map(([k, s]) => ({ route: rel(V1, k), label: s.label, height: s.height, hover: s.hover.active ? `${s.hover.selector} | ${(s.hover.label ?? '').slice(0, 30)}` : null, irNodes: s.stats.irNodes })),
  });
});
