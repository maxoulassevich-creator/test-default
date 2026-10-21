/*
 * Сквозной сценарий настоящего интерфейса плагина: собранный plugin/dist/ui.html в
 * изолированном iframe (sandbox без allow-same-origin → origin "null", как у UI плагина
 * Figma), связанный через postMessage с plugin/dist/code.js в модели Figma API и с
 * настоящим обработчиком по HTTP. Проверяются: статус подключения, ввод кода, загрузка
 * ZIP, анализ, список страниц, создание макетов, проверка геометрии, повторное нажатие
 * без дублей, отмена во время сборки.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Frame, Page } from 'playwright-core';
import { createFigmaMock } from '../support/figma-mock';
import { FIX, ROOT, startTestProcessor, zipWithFonts } from '../support/env';
import { closeTestBrowser, FIXTURE_FONTS, renderHtml, testBrowser, type TP } from '../support/pipeline';

let t: TP;
before(async () => { t = await startTestProcessor(); });
after(async () => { await t.cleanup(); await closeTestBrowser(); });

// Uint8Array ↔ JSON для моста страница ↔ Node
const enc = (m: unknown) => JSON.stringify(m, (_k, v) => (v instanceof Uint8Array ? { __u8: Buffer.from(v).toString('base64') } : v));
const dec = (s: string) => JSON.parse(s, (_k, v) => (v && typeof v === 'object' && typeof v.__u8 === 'string' ? new Uint8Array(Buffer.from(v.__u8, 'base64')) : v));

const HOST = `<!doctype html><html><body style="margin:0"><iframe id="ui" sandbox="allow-scripts allow-downloads" style="width:480px;height:780px;border:0"></iframe>
<script>
  const b64 = (u) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => { const r = atob(s); const u = new Uint8Array(r.length); for (let i = 0; i < r.length; i++) u[i] = r.charCodeAt(i); return u; };
  const ui = document.getElementById('ui');
  window.addEventListener('message', (e) => {
    if (e.source !== ui.contentWindow || !e.data || !e.data.pluginMessage) return;
    window.__toCode(JSON.stringify(e.data.pluginMessage, (k, v) => (v instanceof Uint8Array ? { __u8: b64(v) } : v)));
  });
  window.__toUi = (s) => ui.contentWindow.postMessage({ pluginMessage: JSON.parse(s, (k, v) => (v && typeof v === 'object' && typeof v.__u8 === 'string' ? unb64(v.__u8) : v)) }, '*');
</script></body></html>`;

type Hook = (m: { type: string; index?: number }) => Promise<void>;
async function openPlugin(mock: ReturnType<typeof createFigmaMock>, hook?: Hook): Promise<{ page: Page; ui: Frame; notes: string[]; seen: string[] }> {
  const browser = await testBrowser();
  const page = await browser.newPage({ viewport: { width: 520, height: 820 } });
  const notes: string[] = [];
  const seen: string[] = [];
  // как в Figma: каждое сообщение сразу вызывает onmessage (обработчики не ждут друг друга —
  // на этом держатся tick/tock-паузы и отмена во время сборки)
  await page.exposeFunction('__toCode', async (s: string) => {
    const m = dec(s) as { type: string; index?: number };
    seen.push(m.type);
    if (hook) await hook(m);
    void mock.send(m);
  });
  mock.onUi((m) => {
    const x = m as { type: string; text?: string };
    if (x.type === 'notify-ui') notes.push(String(x.text));
    void page.evaluate((s) => (window as unknown as { __toUi: (s: string) => void }).__toUi(s), enc(m)).catch(() => { /* страница закрыта */ });
  });
  await page.setContent(HOST);
  const html = fs.readFileSync(path.join(ROOT, 'plugin', 'dist', 'ui.html'), 'utf8');
  await page.evaluate((h) => { (document.getElementById('ui') as HTMLIFrameElement).srcdoc = h; }, html);
  const ui = await (await page.$('#ui'))!.contentFrame();
  assert.ok(ui, 'iframe UI загружен');
  await ui.waitForSelector('#connText');
  current = ui;
  return { page, ui, notes, seen };
}

const text = (ui: Frame, sel: string) => ui.locator(sel).innerText();
let current: Frame | null = null;
async function until(fn: () => Promise<boolean>, ms: number, what: string) {
  const t0 = Date.now();
  while (!(await fn())) {
    if (Date.now() - t0 > ms) {
      const state = current ? await current.evaluate(() => ['connText', 'errorBox', 'buildText', 'buildError', 'summary', 'verifyBox'].map((id) => `${id}: ${(document.getElementById(id)?.innerText ?? '').slice(0, 300)}`).join(' | ')).catch(() => '') : '';
      throw new Error('не дождались: ' + what + ' — ' + state);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

function newPluginMock(storage: Record<string, unknown> = {}) {
  const mock = createFigmaMock({ fonts: FIXTURE_FONTS, clientStorage: { processorUrl: t.base, ...storage }, render: renderHtml });
  mock.run(fs.readFileSync(path.join(ROOT, 'plugin', 'dist', 'code.js'), 'utf8'));
  return mock;
}

test('интерфейс: подключение по коду → ZIP → анализ → создание → проверка → повтор без дублей', async () => {
  const mock = newPluginMock();
  const { page, ui } = await openPlugin(mock);
  try {
    // origin null, как у UI плагина Figma
    assert.equal(await ui.evaluate(() => location.origin), 'null');
    await until(async () => /нужен код подключения/.test(await text(ui, '#connText')), 15000, 'статус «нужен код»');
    assert.ok(await ui.locator('#pairBox').isVisible(), 'поле кода показано');
    await ui.fill('#pairCode', 'ZZZZZ-ZZZZZ');
    await ui.click('#pairBtn');
    await until(async () => (await ui.locator('#errorBox').isVisible()) && /Неверный код/.test(await text(ui, '#errorBox')), 10000, 'ошибка неверного кода');
    await ui.fill('#pairCode', t.cfg.pairingCode);
    await ui.click('#pairBtn');
    await until(async () => /Обработчик подключён/.test(await text(ui, '#connText')), 15000, 'подключение');
    // токен сохранён в clientStorage песочницы, а не в localStorage iframe
    assert.ok(typeof mock.storage.token === 'string' && (mock.storage.token as string).length >= 32, 'токен в clientStorage');
    await ui.setInputFiles('#fileInput', { name: 'masterskaya.zip', mimeType: 'application/zip', buffer: zipWithFonts(path.join(FIX, 'ui-flow')) });
    assert.equal(await ui.locator('#analyzeBtn').isDisabled(), false);
    await ui.click('#analyzeBtn');
    await until(async () => /найдено 2/.test(await text(ui, '#pagesCount').catch(() => '')), 120000, 'список страниц');
    const labels = await ui.locator('#pages .page__label').allInnerTexts();
    assert.ok(labels.some((l) => l.includes('Главная') || l.includes('Мастерская')) && labels.some((l) => l.includes('О мастерской')), labels.join(' | '));
    assert.equal(await ui.locator('#createBtn').isDisabled(), false);
    await ui.click('#createBtn');
    await until(async () => (await ui.locator('#summary').isVisible()) || (await ui.locator('#buildError').isVisible()), 300000, 'результат создания');
    assert.equal(await ui.locator('#buildError').isVisible(), false, await text(ui, '#buildError').catch(() => ''));
    assert.match(await text(ui, '#summary'), /Создано макетов: 2/);
    assert.equal(mock.roots().length, 2, 'два фрейма в модели');
    // поза наведения выбрана на главной (карточки с hover)
    const home = mock.roots().find((f) => JSON.parse(f.getPluginData('h2f')).route === 'index.html')!;
    assert.ok(home.findAll((n) => n.name.includes('Курсор')).length === 1, 'курсор на главной');
    // проверка геометрии из интерфейса
    await ui.click('#verifyBtn');
    await until(async () => (await ui.locator('#verifyBox').isVisible()) && /Макетов: 2/.test(await text(ui, '#verifyBox')), 30000, 'отчёт проверки');
    // сравнение с исходником (экспорт PNG из модели → обработчик)
    await ui.click('#compareBtn');
    await until(async () => /index\.html/.test(await text(ui, '#verifyBox')) && !/Экспортирую/.test(await text(ui, '#verifyBox')), 120000, 'сравнение');
    // повторное нажатие «Создать» — режим «добавить только недостающие» — дублей нет
    await ui.click('#createBtn');
    await until(async () => /уже есть в комплекте|Создано макетов: 0/.test(await text(ui, '#buildText').catch(() => '') + await text(ui, '#summary').catch(() => '')), 120000, 'повтор без дублей');
    assert.equal(mock.roots().length, 2, 'повтор не создал копий');
    // явная копия
    await ui.selectOption('#mode', 'copy');
    await ui.click('#createBtn');
    await until(async () => mock.roots().length === 4 && /Создано макетов: 2/.test(await text(ui, '#summary').catch(() => '')), 120000, 'копия');
  } finally { await page.close(); }
});

test('интерфейс: отмена во время создания удаляет только объекты попытки', async () => {
  // плагин уже сопряжён ранее: токен лежит в clientStorage
  const mock = newPluginMock({ token: t.token });
  const own = mock.figma.createRectangle();
  own.name = 'Мой слой';
  // перед второй страницей пользователь нажимает «Отмена»; страница уходит в песочницу уже после
  let ui: Frame;
  let seenRef: string[] = [];
  const hook: Hook = async (m) => {
    if (m.type !== 'route' || m.index !== 1) return;
    await ui.click('#buildCancel');
    const t0 = Date.now();
    while (!seenRef.includes('cancel') && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 20));
  };
  const opened = await openPlugin(mock, hook);
  const page = opened.page;
  ui = opened.ui;
  seenRef = opened.seen;
  try {
    await until(async () => /Обработчик подключён/.test(await text(ui, '#connText')), 15000, 'подключение по сохранённому токену');
    await ui.setInputFiles('#fileInput', { name: 'masterskaya.zip', mimeType: 'application/zip', buffer: zipWithFonts(path.join(FIX, 'ui-flow')) });
    await ui.click('#analyzeBtn');
    await until(async () => /найдено 2/.test(await text(ui, '#pagesCount').catch(() => '')), 120000, 'список страниц');
    await ui.click('#createBtn');
    await until(async () => (await ui.locator('#buildError').isVisible()) || (await ui.locator('#summary').isVisible()), 300000, 'завершение попытки');
    const err = await text(ui, '#buildError').catch(() => '');
    assert.match(err, /отмен/i, 'сообщение об отмене: ' + err);
    assert.equal(mock.roots().length, 0, 'новых фреймов не осталось');
    assert.ok(!own.removed && mock.page.children.includes(own), 'чужой слой на месте');
  } finally { await page.close(); }
});
