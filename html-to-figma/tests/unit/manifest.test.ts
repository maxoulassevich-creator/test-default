/*
 * manifest.json против правил Figma (developers.figma.com/docs/plugins/manifest):
 * настоящая Figma отклонила «http://127.0.0.1:47821» («must be a valid URL») —
 * разрешены домены, URL с http/https/ws/wss и localhost с портом, но не IP-адреса.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../support/env';

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin', 'manifest.json'), 'utf8'));
const DOMAIN = /^(?:(?:https?|wss?):\/\/)?(?:localhost|\*\.[a-z0-9-]+(?:\.[a-z0-9-]+)+|[a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d{1,5})?(?:\/[^\s]*)?$/i;
const isIp = (s: string) => /^(?:[a-z]+:\/\/)?(?:\d{1,3}\.){3}\d{1,3}(?::|\/|$)|\[[0-9a-f:]+\]/i.test(s);

test('manifest: Figma Design, без IP-адресов в networkAccess, reasoning для localhost', () => {
  assert.deepEqual(manifest.editorType, ['figma']);
  assert.equal(manifest.documentAccess, 'dynamic-page');
  const na = manifest.networkAccess;
  for (const list of [na.allowedDomains, na.devAllowedDomains ?? []]) {
    for (const d of list as string[]) {
      if (d === 'none' || d === '*') continue;
      assert.ok(!isIp(d), 'IP-адрес Figma не принимает: ' + d);
      assert.ok(DOMAIN.test(d), 'шаблон домена: ' + d);
    }
  }
  if ((na.allowedDomains as string[]).some((d) => /localhost/.test(d))) assert.ok(na.reasoning && na.reasoning.length > 20, 'для localhost нужен reasoning');
});

test('адрес обработчика по умолчанию в UI входит в разрешённые manifest', () => {
  const html = fs.readFileSync(path.join(ROOT, 'plugin', 'src', 'ui', 'ui.html'), 'utf8');
  const ts = fs.readFileSync(path.join(ROOT, 'plugin', 'src', 'ui', 'ui.ts'), 'utf8');
  const fromHtml = /id="procUrl"[^>]*value="([^"]+)"/.exec(html)![1];
  const fromTs = /new Processor\('([^']+)'/.exec(ts)![1];
  for (const u of [fromHtml, fromTs]) assert.ok(manifest.networkAccess.allowedDomains.includes(u), u + ' есть в allowedDomains');
});
