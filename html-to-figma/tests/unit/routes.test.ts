import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hoverPreferFor } from '../../processor/src/profiles';
import { classifyHref, extractHashLiterals, routeFileId, routeGroup, routeKey, routeShape, urlFromKey } from '../../shared/routes';

const base = 'http://127.0.0.1:5000/j/abc/';
const page = base + 'index.html';

test('hash-маршруты, якоря, query, внешние ссылки, файлы', () => {
  const ids = new Set(['paths', 'view']);
  assert.equal(classifyHref('#/about', page, base, ids).kind, 'hash-route');
  assert.equal(classifyHref('#paths', page, base, ids).kind, 'anchor');
  assert.equal(classifyHref('#unknown', page, base, ids).kind, 'hash-candidate');
  assert.equal(classifyHref('#', page, base, ids).kind, 'same');
  assert.equal(classifyHref('about.html', page, base, ids).kind, 'page');
  assert.equal(classifyHref('about.html#team', page, base, ids).key, 'about.html');
  assert.equal(classifyHref('https://example.org/', page, base, ids).kind, 'external');
  assert.equal(classifyHref('mailto:a@b.c', page, base, ids).kind, 'scheme');
  assert.equal(classifyHref('docs/price.pdf', page, base, ids).kind, 'download');
  assert.equal(classifyHref('/j/other/index.html', page, base, ids).kind, 'external', 'чужое задание — вне проекта');
  const a = classifyHref('#/login', page, base, ids).key, b = classifyHref('#/login?invite=1', page, base, ids).key, c = classifyHref('#/login?mode=restore', page, base, ids).key;
  assert.equal(new Set([a, b, c]).size, 3, 'вход, активация и восстановление — разные адреса');
});

test('кириллица в поисковом запросе внутри hash сохраняется и восстанавливается', () => {
  const k = routeKey(page + '#/search?q=%D1%81%D1%82%D0%B5%D0%BF%D1%8C', base);
  assert.equal(k, 'index.html#/search?q=степь');
  const u = urlFromKey(k, base);
  assert.equal(routeKey(u, base), k);
  assert.ok(/^[\x20-\x7e]+$/.test(routeFileId(k)), 'имя файла только ASCII');
  assert.notEqual(routeFileId(k), routeFileId('index.html#/search?q=вогла'));
});

test('форма адреса, группа, литералы маршрутов из кода', () => {
  assert.equal(routeShape('index.html#/item/17'), routeShape('index.html#/item/3'));
  assert.equal(routeShape('index.html#/items?page=2'), routeShape('index.html#/items?page=9'));
  assert.equal(routeGroup('index.html#/painting/series/step'), 'painting');
  assert.equal(routeGroup('about.html'), 'about');
  assert.deepEqual(extractHashLiterals("go('#/about'); x = `#/prose/${id}`; y=\"#/search?q=степь\""), ['#/about', '#/search?q=степь']);
});

test('цель наведения из профиля: полный ключ, часть после файла, вход без hash', () => {
  const map = { '#/': '.path', '#/albums': '[data-calbum]', '#/net': 'none', 'about.html': '.card', 'site.html#/x': '.full' };
  assert.equal(hoverPreferFor(map, 'site.html'), '.path');
  assert.equal(hoverPreferFor(map, 'site.html#/albums'), '[data-calbum]');
  assert.equal(hoverPreferFor(map, 'other.html#/net'), 'none');
  assert.equal(hoverPreferFor(map, 'about.html'), '.card');
  assert.equal(hoverPreferFor(map, 'site.html#/x'), '.full');
  assert.equal(hoverPreferFor(map, 'site.html#/y'), null);
  assert.equal(hoverPreferFor(undefined, 'site.html'), null);
});

test('ссылка от корня сайта переносится в папку проекта, чужой сайт — внешний', () => {
  const ids = new Set<string>();
  const a = classifyHref('/about.html', page, base, ids);
  assert.equal(a.kind, 'page');
  assert.equal(a.key, 'about.html');
  const root = classifyHref('/', base + 'about.html', base, ids);
  assert.equal(root.kind, 'page');
  assert.equal(root.url, base);
  const q = classifyHref('/catalog/?p=2#top', page, base, ids);
  assert.ok(q.url!.startsWith(base + 'catalog/?p=2'), q.url);
  assert.equal(classifyHref('https://example.org/x', page, base, ids).kind, 'external');
  assert.equal(classifyHref('http://127.0.0.1:5001/x', page, base, ids).kind, 'external', 'другой порт — другой сайт');
});
