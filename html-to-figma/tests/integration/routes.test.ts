/*
 * Обнаружение страниц: ZIP с несколькими HTML и относительными ресурсами;
 * SPA с hash-маршрутами, значимыми query, пагинацией, редиректом, якорем и 404.
 * Другое число страниц и другая структура, чем у блогов.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { FIX, startTestProcessor, TEST_PROFILE, zipWithFonts } from '../support/env';
import { analyzeZip, buildInMock, capture, closeTestBrowser, newMock, processorSource, verifyInMock, writeReport, type TP } from '../support/pipeline';

let t: TP;
before(async () => { t = await startTestProcessor(); });
after(async () => { await t.cleanup(); await closeTestBrowser(); });

type R = { key: string; status: string; reason?: string; duplicateOf?: string; label: string };

test('ZIP с двумя HTML: страницы-файлы, относительные CSS/JS/картинки, якорь и внешние ссылки', async () => {
  const { id, status } = await analyzeZip(t, zipWithFonts(path.join(FIX, 'multipage')), 'studio.zip', { profile: TEST_PROFILE });
  assert.equal(status.state, 'ready', JSON.stringify(status.error));
  const routes = status.routes as R[];
  const ok = routes.filter((r) => r.status === 'ok').map((r) => r.key).sort();
  assert.deepEqual(ok, ['about.html', 'index.html']);
  // якорь на другой странице — та же страница, PDF/внешняя ссылка — не маршруты
  assert.ok(!routes.some((r) => r.key.includes('price.pdf') && r.status === 'ok'));
  assert.ok(!routes.some((r) => r.key.includes('example.org')));
  const c = await capture(t, id, ok);
  assert.equal(c.state, 'captured', JSON.stringify(c.error));
  const doc = await t.json(`/api/jobs/${id}/document`);
  const src = processorSource(t, id, doc);
  const a = await src.snapshot('index.html'), b = await src.snapshot('about.html');
  // контент, созданный JavaScript, присутствует
  const texts = (s: typeof a) => JSON.stringify(s.children);
  assert.ok(texts(a).includes('Карточка №3, создана JavaScript.'), 'плитки из JS');
  assert.ok(texts(b).includes('Карточка №5, создана JavaScript.'));
  // общий логотип и фон — один ассет на обе страницы
  const shared = a.assets.filter((x) => b.assets.includes(x));
  assert.ok(shared.length >= 2, 'общие ресурсы дедуплицированы: ' + shared.join(','));
  const mock = newMock();
  const r = await buildInMock(mock, src, ok, { columns: 2 });
  assert.ok(r.done, JSON.stringify(r.error));
  assert.equal(mock.roots().length, 2);
  assert.equal(mock.stats.images, new Set([...a.assets, ...b.assets].filter((x) => x.startsWith('i'))).size, 'каждая картинка создана в Figma один раз');
  const v = await verifyInMock(mock);
  assert.ok(v.ok, JSON.stringify(v.positionIssues.slice(0, 4)));
  assert.equal(v.frameOverlaps.length, 0);
});

test('SPA: hash-маршруты, значимые query, пагинация, редирект, якорь, 404', async () => {
  const { id, status } = await analyzeZip(t, zipWithFonts(path.join(FIX, 'spa')), 'catalog.zip', { profile: TEST_PROFILE, maxDepth: 3 });
  assert.equal(status.state, 'ready', JSON.stringify(status.error));
  const routes = status.routes as R[];
  const byKey = new Map(routes.map((r) => [r.key, r]));
  const st = (k: string) => byKey.get('index.html' + k)?.status;
  // разные представления с одним путём и разными query
  assert.equal(st('#/login'), 'ok');
  assert.equal(st('#/login?mode=restore'), 'ok');
  assert.equal(st('#/search?q=лампа'), 'ok', 'кириллица в query внутри hash сохраняется');
  assert.equal(st('#/search?q=стол'), 'ok');
  for (const p of [2, 3, 4]) assert.equal(st(`#/items?page=${p}`), 'ok');
  // редирект #/old-catalog → #/items распознан как дубликат
  const old = byKey.get('index.html#/old-catalog');
  assert.ok(old && old.status === 'duplicate', 'редирект: ' + JSON.stringify(old));
  // #help на главной — якорь
  assert.equal(st('#help'), 'anchor');
  // ограничение однотипных адресов (#/item/N)
  const items = routes.filter((r) => /#\/item\/\d+$/.test(r.key));
  assert.ok(items.filter((r) => r.status === 'ok').length <= 12, 'ограничение формы адресов');
  const ok = routes.filter((r) => r.status === 'ok');
  assert.ok(ok.length >= 9 && ok.length !== 32, 'другое число страниц: ' + ok.length);
  writeReport('routes-spa.json', { scope: 'Chromium: обход SPA', routes: routes.map((r) => ({ key: r.key, status: r.status, reason: r.reason, label: r.label })) });
  const pick = ['index.html', 'index.html#/login', 'index.html#/login?mode=restore', 'index.html#/search?q=лампа'];
  const c = await capture(t, id, pick);
  assert.equal(c.state, 'captured', JSON.stringify(c.error));
  const doc = await t.json(`/api/jobs/${id}/document`);
  const src = processorSource(t, id, doc);
  const login = JSON.stringify((await src.snapshot('index.html#/login')).children);
  const restore = JSON.stringify((await src.snapshot('index.html#/login?mode=restore')).children);
  assert.ok(login.includes('Вход') && !login.includes('Восстановление'));
  assert.ok(restore.includes('Восстановление пароля'));
  assert.ok(login.includes('••••••'), 'пароль замаскирован');
  // fixed-шапка: последний ребёнок корня, захвачена в исходной позе (наверху)
  const home = await src.snapshot('index.html');
  assert.ok(home.fixedCount >= 1);
  const bar = home.children[home.children.length - 1];
  assert.ok(Math.abs(bar.m[5]) < 0.5, 'шапка в исходной позе y=0, а не на позиции прокрутки: ' + bar.m[5]);
  assert.ok(!JSON.stringify(bar).includes('"r":0.133'), 'шапка не в «прокрученном» тёмном состоянии');
  const mock = newMock();
  const r = await buildInMock(mock, src, pick, { viewportMode: true });
  assert.ok(r.done, JSON.stringify(r.error));
  const roots = mock.roots();
  assert.equal(roots.length, 4);
  for (const root of roots) {
    assert.equal(root.props.overflowDirection, 'VERTICAL');
    assert.ok((root.props.numberOfFixedChildren as number) >= 1, 'шапка закреплена в режиме просмотра');
  }
});
