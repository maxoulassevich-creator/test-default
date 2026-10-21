/*
 * UI плагина. Общается с sandbox (postMessage) и с локальным обработчиком (HTTP).
 * Сборка идёт потоково: страница за страницей, ресурсы передаются один раз
 * (дедупликация по id), на каждом этапе показывается реальный прогресс.
 */
import type { BuildMode, CodeToUi, FontCheckResult, FontChoice, PlanRoute, SetSummary, UiToCode, VerifyReport } from '../../../shared/messages';
import type { Diagnostic, FontRequirement, HoverInfo, ImportDocument, RouteInfo } from '../../../shared/schema';
import { describeFont } from '../../../shared/fonts';
import { ApiError, packageSource, Processor, processorSource, type DataSource } from './client';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const show = (el: HTMLElement, on = true) => el.classList.toggle('hidden', !on);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// ---------- мост к sandbox ----------
const toCode = (m: UiToCode) => parent.postMessage({ pluginMessage: m }, '*');
let reqId = 0;
const waiters = new Map<number, (v: unknown) => void>();
const listeners: Array<(m: CodeToUi) => void> = [];
function request<T>(m: UiToCode & { id: number }): Promise<T> { return new Promise((res) => { waiters.set(m.id, res as (v: unknown) => void); toCode(m); }); }
window.onmessage = (ev: MessageEvent) => {
  const m = ev.data?.pluginMessage as CodeToUi | undefined;
  if (!m) return;
  if (m.type === 'tick') { toCode({ type: 'tock', n: m.n }); return; }
  if ('id' in m && typeof m.id === 'number' && (m.type === 'storage' || m.type === 'fonts-result' || m.type === 'export-result')) {
    const w = waiters.get(m.id);
    waiters.delete(m.id);
    w?.(m);
    return;
  }
  for (const l of [...listeners]) l(m);
};
function waitFor<T extends CodeToUi['type']>(types: T[], jobId?: string): Promise<Extract<CodeToUi, { type: T }>> {
  return new Promise((res) => {
    const l = (m: CodeToUi) => {
      if (!types.includes(m.type as T)) return;
      if (jobId && 'jobId' in m && m.jobId && m.jobId !== jobId) return;
      listeners.splice(listeners.indexOf(l), 1);
      res(m as Extract<CodeToUi, { type: T }>);
    };
    listeners.push(l);
  });
}
const storageSet = (key: string, value: unknown) => request({ type: 'storage-set', id: ++reqId, key, value });

// ---------- состояние ----------
interface JobStatus {
  id: string; state: string; error: { message: string; action: string } | null; progress: { stage: string; done: number; total: number; message: string };
  sourceName: string; entries: string[]; entry: string; projectKey: string; adapter: { id: string; label: string; notes?: string } | null;
  profile: Record<string, unknown> & { storage: Record<string, string> }; routes: Array<RouteInfo & { fileId: string; hover?: HoverInfo }>;
  storage: Array<{ key: string; values: string[]; read: boolean }>; diagnostics: Diagnostic[]; fontsPreview: string[]; fonts: FontRequirement[]; captured: string[];
}

const S = {
  proc: new Processor('http://127.0.0.1:47821', null),
  connected: false,
  file: null as File | null,
  jobId: null as string | null,
  status: null as JobStatus | null,
  selected: new Set<string>(),
  hoverChoice: {} as Record<string, 'auto' | 'none' | number>,
  dirty: new Set<string>(),
  capturedWith: '' as string,
  sets: [] as SetSummary[],
  fonts: [] as FontCheckResult[],
  families: [] as string[],
  subs: {} as Record<string, string>,
  pkg: null as { source: DataSource; doc: ImportDocument } | null,
  building: null as string | null,
  lastProject: '' as string,
  builtRoutes: [] as string[],
  verify: null as VerifyReport | null,
  compare: [] as Array<{ route: string; meanAbs?: number; changed?: number; size?: boolean; error?: string }>,
  thumbs: new Map<string, string>(),
  profiles: {} as Record<string, unknown>,
};

function setConn(kind: 'ok' | 'bad' | 'warn' | 'unknown', text: string) {
  const c = $('conn');
  c.className = 'conn conn--' + kind;
  $('connText').textContent = text;
}

function showError(box: HTMLElement, e: unknown) {
  const msg = e instanceof ApiError ? e.message : (e as Error)?.message ?? String(e);
  const action = e instanceof ApiError ? e.action : (e as { action?: string })?.action ?? '';
  box.innerHTML = `<b>${esc(msg)}</b>${action ? esc(action) : ''}`;
  show(box, true);
}

function settings() {
  const storage: Record<string, string> = {};
  for (const el of Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-skey]'))) if (el.value !== '') storage[el.dataset.skey!] = el.value;
  return {
    viewportWidth: Number(($('vw') as HTMLSelectElement).value) || 1440,
    viewportHeight: Math.max(300, Math.min(3000, Number(($('vh') as HTMLInputElement).value) || 1000)),
    colorScheme: ($('scheme') as HTMLSelectElement).value as 'light',
    hover: ($('hover') as HTMLInputElement).checked,
    cursor: ($('cursor') as HTMLInputElement).checked,
    blockExternal: ($('blockExt') as HTMLInputElement).checked,
    storage,
  };
}
const captureKey = () => JSON.stringify(settings());

// ---------- подключение ----------
async function checkConnection() {
  setConn('unknown', 'Проверяю обработчик…');
  S.proc.base = ($('procUrl') as HTMLInputElement).value.trim() || 'http://127.0.0.1:47821';
  try {
    let h: Awaited<ReturnType<Processor['health']>>;
    try { h = await S.proc.health(true); }
    catch (e) {
      // политика сети Figma может пропускать только «localhost» (так в документации manifest) —
      // тот же обработчик пробуем по второму имени из manifest.json
      const alt = /\/\/127\.0\.0\.1:/.test(S.proc.base) ? S.proc.base.replace('//127.0.0.1:', '//localhost:') : '';
      if (!(e instanceof ApiError && e.kind === 'offline') || !alt) throw e;
      const prev = S.proc.base;
      S.proc.base = alt;
      try { h = await S.proc.health(true); ($('procUrl') as HTMLInputElement).value = alt; await storageSet('processorUrl', alt); }
      catch { S.proc.base = prev; throw e; }
    }
    if (h.protocol !== 1) throw new ApiError(`Версия обработчика ${h.version} несовместима (протокол ${h.protocol}).`, 'Установите плагин и обработчик из одного архива.', 409, 'protocol');
    if (!h.paired) {
      setConn('warn', 'Обработчик найден — нужен код подключения');
      $('connHelp').textContent = 'Обработчик запущен. Введите код подключения из его окна (делается один раз).';
      $('connSteps').innerHTML = '';
      show($('pairBox'), true);
      show($('connPanel'), true);
      S.connected = false;
    } else {
      S.connected = true;
      const b = h.browser;
      setConn(b && !b.ok ? 'warn' : 'ok', b && !b.ok ? 'Обработчик подключён, но браузер не найден' : `Обработчик подключён · ${h.version}`);
      show($('connPanel'), !!(b && !b.ok));
      if (b && !b.ok) { $('connHelp').textContent = 'Обработчику нужен Microsoft Edge, Google Chrome или Chromium.'; $('connSteps').innerHTML = '<li>Установите Microsoft Edge или Google Chrome, либо запустите install-browser.cmd из папки обработчика.</li><li>Перезапустите обработчик.</li>'; show($('pairBox'), false); }
    }
  } catch (e) {
    S.connected = false;
    const err = e as ApiError;
    setConn('bad', err.kind === 'offline' ? 'Обработчик не запущен' : err.message);
    $('connHelp').textContent = err.kind === 'offline' ? 'Плагину нужен локальный обработчик — он открывает HTML в браузере и измеряет страницу.' : err.message;
    $('connSteps').innerHTML = err.kind === 'offline'
      ? '<li>Откройте папку обработчика и запустите <b>start-windows.cmd</b> (окно должно остаться открытым).</li><li>Нажмите «Проверить снова».</li><li>Если обработчик запущен, но связи нет — подготовьте пакет на странице http://127.0.0.1:47821 в браузере и откройте его кнопкой ниже.</li>'
      : `<li>${esc(err.action ?? '')}</li>`;
    show($('pairBox'), err.kind === 'auth');
    show($('connPanel'), true);
  }
  updateButtons();
}

async function pair() {
  try {
    const t = await S.proc.pair((($('pairCode') as HTMLInputElement).value || '').trim());
    show($('errorBox'), false);
    await storageSet('token', t);
    await storageSet('processorUrl', S.proc.base);
    toCode({ type: 'notify', text: 'Обработчик подключён' });
    await checkConnection();
  } catch (e) { showError($('errorBox'), e); }
}

function updateButtons() {
  ($('analyzeBtn') as HTMLButtonElement).disabled = !S.connected || !S.file || S.status?.state === 'analyzing' || S.status?.state === 'capturing' || !!S.building;
  ($('createBtn') as HTMLButtonElement).disabled = !!S.building || (!S.pkg && (!S.connected || !S.status || S.status.state === 'analyzing' || S.status.state === 'capturing' || !S.selected.size));
  show($('buildPanel'), !!S.pkg || !!S.status && S.status.state !== 'analyzing' && S.status.routes.length > 0);
}

// ---------- файл и анализ ----------
function setFile(f: File | null) {
  S.file = f;
  S.pkg = null;
  $('fileName').textContent = f ? `${f.name} · ${(f.size / 1024 / 1024).toFixed(2)} МБ` : '';
  updateButtons();
}

function analyzeOptions() {
  const st = settings();
  const extra = ($('extraRoute') as HTMLInputElement).value.trim();
  return {
    useAdapter: ($('useAdapter') as HTMLInputElement).checked,
    entry: ($('entrySel') as HTMLSelectElement).value || undefined,
    extraRoutes: extra ? [extra] : [],
    profile: { viewportWidth: st.viewportWidth, viewportHeight: st.viewportHeight, colorScheme: st.colorScheme, hover: st.hover, cursor: st.cursor, blockExternal: st.blockExternal, ...(Object.keys(st.storage).length ? { storage: st.storage } : {}) },
  };
}

async function analyze(reuse = false) {
  show($('errorBox'), false);
  try {
    if (!reuse || !S.jobId) {
      if (!S.file) return;
      const saved = S.profiles[S.file.name] as Record<string, unknown> | undefined;
      if (saved) applySaved(saved);
      S.jobId = await S.proc.upload(S.file, S.file.name, analyzeOptions());
    } else await S.proc.analyze(S.jobId, analyzeOptions());
    S.selected.clear();
    S.hoverChoice = {};
    S.capturedWith = '';
    await poll(['analyzing']);
    if (S.status?.state === 'ready') {
      for (const r of S.status.routes) if (r.status === 'ok' && r.suggested !== false) S.selected.add(r.key);
      renderAll();
    }
  } catch (e) { showError($('errorBox'), e); }
  updateButtons();
}

async function poll(busy: string[], onTick?: (s: JobStatus) => void) {
  show($('progress'), true);
  show($('cancelBtn'), true);
  for (;;) {
    const s = await S.proc.status<JobStatus>(S.jobId!);
    S.status = s;
    const pct = s.progress.total ? Math.round((s.progress.done / s.progress.total) * 100) : 0;
    ($('progressBar') as HTMLElement).style.width = (busy.includes(s.state) ? Math.max(4, pct) : 100) + '%';
    $('progressText').textContent = s.progress.message;
    onTick?.(s);
    if (!busy.includes(s.state)) break;
    await new Promise((r) => setTimeout(r, 600));
  }
  show($('cancelBtn'), false);
  if (S.status?.state === 'error' || S.status?.state === 'cancelled') {
    showError($('errorBox'), { message: S.status.error?.message ?? 'Ошибка', action: S.status.error?.action });
  }
  renderAll();
  updateButtons();
}

function applySaved(p: Record<string, unknown>) {
  if (p.viewportWidth) ($('vw') as HTMLSelectElement).value = String(p.viewportWidth);
  if (p.viewportHeight) ($('vh') as HTMLInputElement).value = String(p.viewportHeight);
  if (p.colorScheme) ($('scheme') as HTMLSelectElement).value = String(p.colorScheme);
}

// ---------- отрисовка ----------
function statusTag(r: RouteInfo) {
  const map: Record<string, [string, string]> = { ok: ['', ''], duplicate: ['дубликат', 'warn'], anchor: ['якорь', ''], excluded: ['исключено', ''], error: ['ошибка', 'bad'], limit: ['лимит', 'warn'] };
  const [t, k] = r.status === 'ok' && r.suggested === false ? ['вне указателя', ''] : map[r.status] ?? [r.status, ''];
  return t ? `<span class="tag tag--${k}">${t}</span>` : '';
}

function renderPages() {
  const s = S.status!;
  const all = ($('showAll') as HTMLInputElement).checked;
  const ok = s.routes.filter((r) => r.status === 'ok');
  const extra = ok.filter((r) => r.suggested === false).length;
  $('pagesCount').textContent = `найдено ${ok.length}${extra ? ` (из них ${extra} вне указателя профиля)` : ''}${s.routes.length > ok.length ? `, ещё ${s.routes.length - ok.length} исключено/дубликаты` : ''} · выбрано ${S.selected.size}`;
  const ul = $('pages');
  ul.innerHTML = '';
  for (const r of s.routes) {
    if (r.status !== 'ok' && !all) continue;
    const li = document.createElement('li');
    if (r.status !== 'ok') li.className = 'off';
    const captured = s.captured.includes(r.key);
    const h = r.hover;
    let hoverHtml = '';
    if (captured && h) {
      const opts = [`<option value="auto">авто</option>`, ...h.candidates.map((c) => `<option value="${c.index}">${esc(c.label.slice(0, 50))} (${esc(c.selector.slice(0, 30))})</option>`), `<option value="none">без наведения</option>`];
      hoverHtml = `<div class="page__hover">Наведение: ${h.active ? '<b>' + esc((h.label ?? '').slice(0, 40)) + '</b>' : esc(h.reason)} ${h.candidates.length ? `<select data-hover="${esc(r.key)}">${opts.join('')}</select>` : ''}</div>`;
    }
    li.innerHTML = `<input type="checkbox" ${S.selected.has(r.key) ? 'checked' : ''} ${r.status !== 'ok' ? 'disabled' : ''} data-key="${esc(r.key)}">
      <div><div class="page__label">${esc(r.label || r.title || r.key)}${statusTag(r)}${captured ? '<span class="tag tag--ok">снято</span>' : ''}</div>
      <div class="page__url">${esc(r.key)}</div>
      ${r.reason ? `<div class="page__meta">${esc(r.reason)}</div>` : ''}${r.height ? `<div class="page__meta">${s.profile.viewportWidth} × ${r.height} px</div>` : ''}${hoverHtml}
      <img class="page__thumb hidden" data-thumb="${esc(r.key)}" alt=""></div>
      <button class="btn btn--small btn--ghost" data-preview="${esc(r.key)}" title="Показать превью">👁</button>`;
    ul.appendChild(li);
    const sel = li.querySelector<HTMLSelectElement>('select[data-hover]');
    if (sel) sel.value = String(S.hoverChoice[r.key] ?? (h?.chosenIndex ?? 'auto'));
  }
}

function renderState() {
  const s = S.status!;
  const box = $('stateFields');
  box.innerHTML = '';
  const hints = s.storage.filter((h) => h.read || s.profile.storage[h.key] !== undefined);
  for (const k of Object.keys(s.profile.storage)) if (!hints.some((h) => h.key === k)) hints.push({ key: k, values: [], read: false });
  show($('stateBox'), hints.length > 0);
  for (const h of hints) {
    const cur = s.profile.storage[h.key] ?? '';
    const values = [...new Set([cur, ...h.values].filter(Boolean))];
    const row = document.createElement('div');
    row.className = 'kv';
    row.innerHTML = `<span title="${esc(h.key)}">${esc(h.key)}</span>` + (values.length
      ? `<select data-skey="${esc(h.key)}"><option value="">(не задавать)</option>${values.map((v) => `<option ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`
      : `<input type="text" data-skey="${esc(h.key)}" value="${esc(cur)}" placeholder="значение">`);
    box.appendChild(row);
  }
}

function renderDiags() {
  const d = S.status?.diagnostics ?? [];
  show($('diagPanel'), d.length > 0);
  $('diagCount').textContent = String(d.length);
  $('diags').innerHTML = d.map((x) => `<li class="${x.level}">${x.level === 'error' ? '⛔' : x.level === 'warn' ? '⚠️' : 'ℹ️'} ${esc(x.message)}${x.route ? ` <span class="muted">[${esc(x.route)}]</span>` : ''}${x.count && x.count > 1 ? ` ×${x.count}` : ''}</li>`).join('');
}

function renderFonts() {
  const pre = S.status?.fontsPreview ?? [];
  if (!S.fonts.length && !pre.length) { show($('fontsPanel'), false); return; }
  show($('fontsPanel'), true);
  if (!S.fonts.length) {
    $('fontsHelp').textContent = 'Предварительно (по стилям страниц). Точный список с fallback-диапазонами появится после снятия страниц.';
    $('fonts').innerHTML = pre.slice(0, 30).map((f) => `<li><span class="ff">${esc(f)}</span></li>`).join('');
    return;
  }
  const missing = S.fonts.filter((f) => !f.found);
  $('fontsHelp').innerHTML = missing.length
    ? `<b style="color:var(--danger)">Недоступно в Figma: ${missing.length}.</b> Установите шрифты в систему и перезапустите Figma, либо явно выберите замену (будет указана в отчёте). Холст не изменяется, пока шрифты не готовы.`
    : 'Все шрифты доступны в Figma.';
  $('fonts').innerHTML = S.fonts.map((f) => {
    const name = describeFont(f);
    if (f.found) return `<li><span><span class="ff">${esc(name)}</span><br><span class="st muted">→ ${esc(f.found.family)} ${esc(f.found.style)}${f.found.wght ? ' (wght ' + f.found.wght + ')' : ''}${f.note ? ' · ' + esc(f.note) : ''}</span></span><span class="tag tag--ok">есть</span></li>`;
    return `<li><span><span class="ff">${esc(name)}</span><br><span class="st" style="color:var(--danger)">${esc(f.note ?? 'нет в Figma')}</span></span><select data-sub="${esc(f.key)}"><option value="">заменить на…</option>${S.families.slice(0, 2000).map((x) => `<option ${S.subs[f.key] === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></li>`;
  }).join('');
}

function renderAll() {
  const s = S.status;
  show($('pagesPanel'), !!s && s.routes.length > 0);
  show($('settingsPanel'), !!s);
  if (!s) return;
  const ab = $('adapterBox');
  show(ab, !!s.adapter);
  if (s.adapter) ab.innerHTML = `<b>Профиль проекта:</b> ${esc(s.adapter.label)}${s.adapter.notes ? '<br>' + esc(s.adapter.notes) : ''}`;
  const es = $('entrySel') as HTMLSelectElement;
  show($('entryBox'), s.entries.length > 1);
  es.innerHTML = s.entries.map((e) => `<option ${e === s.entry ? 'selected' : ''}>${esc(e)}</option>`).join('');
  ($('vw') as HTMLSelectElement).value = String(s.profile.viewportWidth ?? 1440);
  ($('vh') as HTMLInputElement).value = String(s.profile.viewportHeight ?? 1000);
  ($('scheme') as HTMLSelectElement).value = String(s.profile.colorScheme ?? 'light');
  renderPages();
  renderState();
  renderDiags();
  renderFonts();
}

// ---------- сборка ----------
async function ensureCaptured(): Promise<void> {
  const s = S.status!;
  const key = captureKey();
  const need = [...S.selected].filter((k) => !s.captured.includes(k) || S.dirty.has(k) || S.capturedWith !== key);
  if (!need.length) return;
  const st = settings();
  await S.proc.capture(S.jobId!, { routes: need, hover: S.hoverChoice, profile: { viewportWidth: st.viewportWidth, viewportHeight: st.viewportHeight, colorScheme: st.colorScheme, hover: st.hover, cursor: st.cursor, blockExternal: st.blockExternal } });
  setBuild(2, `Снимаю страницы в браузере: 0 из ${need.length}`);
  await poll(['capturing'], (x) => setBuild(2 + Math.round((x.progress.done / Math.max(1, x.progress.total)) * 38), x.progress.message));
  if (S.status?.state !== 'captured') throw new Error(S.status?.error?.message ?? 'Страницы не сняты');
  for (const k of need) S.dirty.delete(k);
  S.capturedWith = key;
}

function setBuild(pct: number, text: string) {
  show($('buildProgress'), true);
  ($('buildBar') as HTMLElement).style.width = Math.max(2, Math.min(100, pct)) + '%';
  $('buildText').textContent = text;
}

async function create() {
  show($('buildError'), false);
  show($('summary'), false);
  const jobId = 'b' + Date.now().toString(36);
  S.building = jobId;
  updateButtons();
  show($('buildCancel'), true);
  let begun = false;
  try {
    let source: DataSource;
    let routes: string[];
    if (S.pkg) { source = S.pkg.source; routes = S.pkg.doc.routes.map((r) => r.key); }
    else { await ensureCaptured(); source = processorSource(S.proc, S.jobId!); routes = [...S.selected].filter((k) => S.status!.captured.includes(k)); }
    if (S.building !== jobId) return;
    const doc = await source.document();
    const used = new Set<string>();
    const snaps = new Map<string, Awaited<ReturnType<DataSource['snapshot']>>>();
    setBuild(42, 'Проверяю шрифты в Figma (до изменения холста)…');
    // точный список шрифтов — по выбранным страницам
    for (const k of routes) { const sn = await source.snapshot(k); snaps.set(k, sn); sn.fonts.forEach((f) => used.add(f)); }
    const reqs = doc.fonts.filter((f) => used.has(f.key));
    const fr = await request<{ results: FontCheckResult[]; families: string[] }>({ type: 'fonts-check', id: ++reqId, fonts: reqs, substitutions: S.subs });
    S.fonts = fr.results; S.families = fr.families;
    renderFonts();
    const missing = fr.results.filter((f) => !f.found);
    if (missing.length) throw Object.assign(new Error(`В Figma недоступны шрифты: ${missing.map((m) => describeFont(m)).join(', ')}.`), { action: 'Установите их в систему и перезапустите Figma (или выберите замену в списке «Шрифты»). Холст не изменён.' });
    const fonts: FontChoice[] = fr.results.map((f) => ({ key: f.key, family: f.found!.family, style: f.found!.style, wght: f.found!.wght }));
    const project = doc.projectKey;
    S.lastProject = project;
    const plan: PlanRoute[] = routes.map((k) => { const sn = snaps.get(k)!; return { key: k, label: sn.label, width: sn.width, height: sn.height, viewportHeight: sn.viewport.height, fixed: sn.fixedCount }; });
    const mode = ($('mode') as HTMLSelectElement).value as BuildMode;
    toCode({ type: 'begin', jobId, project, projectLabel: doc.sourceName.replace(/\.(zip|html?)$/i, ''), source: doc.sourceHash.slice(0, 16), mode, routes: plan, columns: Number(($('cols') as HTMLSelectElement).value) || 4, fonts, viewportMode: ($('viewportMode') as HTMLInputElement).checked });
    const p = await waitFor(['plan', 'error'], jobId);
    if (p.type === 'error') throw Object.assign(new Error(p.message), { action: p.action });
    begun = true;
    if (!p.build.length) { setBuild(100, 'Все выбранные страницы уже есть в комплекте — копии не созданы. Выберите «создать новую копию» или «обновить», если нужно.'); toCode({ type: 'commit', jobId }); await waitFor(['done'], jobId); return; }
    const sent = new Set<string>();
    const assetInfo = new Map(doc.assets.map((a) => [a.id, a]));
    const warnings: string[] = [];
    for (let i = 0; i < p.build.length; i++) {
      if (S.building !== jobId) throw new Error('Создание отменено.');
      const key = p.build[i];
      const sn = snaps.get(key)!;
      const base = 45 + Math.round((i / p.build.length) * 53);
      setBuild(base, `Страница ${i + 1} из ${p.build.length}: ${sn.label} — ресурсы`);
      for (const a of sn.assets) {
        if (sent.has(a)) continue;
        sent.add(a);
        const info = assetInfo.get(a);
        const bytes = await source.asset(a);
        const kind = info?.kind ?? (a.startsWith('s') ? 'svg' : 'image');
        toCode(kind === 'svg' ? { type: 'asset', jobId, id: a, kind, text: new TextDecoder().decode(bytes) } : { type: 'asset', jobId, id: a, kind, bytes });
        const r = await waitFor(['asset-ok', 'asset-error'], jobId);
        if (r.type === 'asset-error') warnings.push(`Ресурс ${a} не принят Figma: ${r.message}`);
      }
      setBuild(base, `Страница ${i + 1} из ${p.build.length}: ${sn.label} — создаю слои`);
      const prog = (m: CodeToUi) => { if (m.type === 'progress' && m.jobId === jobId) setBuild(base + Math.round((m.nodes / Math.max(1, m.total)) * (53 / p.build.length)), `Страница ${i + 1} из ${p.build.length}: ${sn.label} — слоёв ${m.nodes} из ${m.total}`); };
      listeners.push(prog);
      toCode({ type: 'route', jobId, snapshot: sn, index: i });
      const r = await waitFor(['route-done', 'aborted', 'error'], jobId);
      listeners.splice(listeners.indexOf(prog), 1);
      if (r.type === 'aborted') { setBuild(0, r.reason); show($('buildProgress'), false); showError($('buildError'), { message: r.reason, action: `Удалено новых объектов этой попытки: ${r.removed}. Старые макеты не затронуты.` }); begun = false; return; }
      if (r.type === 'error') { begun = false; throw Object.assign(new Error(r.message), { action: r.action }); }
      for (const w of r.warnings) warnings.push(`${sn.label}: ${w.message}`);
    }
    toCode({ type: 'commit', jobId });
    const d = await waitFor(['done'], jobId);
    begun = false;
    S.builtRoutes = p.build;
    setBuild(100, 'Готово');
    const sm = d.summary;
    $('summary').innerHTML = `<b>Создано макетов: ${sm.created}</b>${sm.replaced ? `, заменено неизменённых: ${sm.replaced}` : ''}${sm.kept ? `, сохранено изменённых вручную: ${sm.kept}` : ''}. Слоёв: ${sm.nodes}, текстовых: ${sm.texts}. ${p.skip.length ? `Пропущено (уже есть): ${p.skip.length}.` : ''}<br><span class="muted">Все элементы — обычные слои; компонентов и состояний не создано.</span>`;
    show($('summary'), true);
    show($('resultPanel'), true);
    $('warnBox').innerHTML = warnings.length ? `<b>Предупреждения (${warnings.length}):</b><br>${warnings.slice(0, 80).map(esc).join('<br>')}` : '';
    show($('warnBox'), warnings.length > 0);
    toCode({ type: 'notify', text: `Создано макетов: ${sm.created}` });
  } catch (e) {
    if (begun) { toCode({ type: 'abort', jobId, reason: 'Прервано: ' + ((e as Error).message ?? e) }); await waitFor(['aborted'], jobId); }
    showError($('buildError'), e);
    show($('buildProgress'), false);
  } finally {
    S.building = null;
    show($('buildCancel'), false);
    updateButtons();
    renderAll();
  }
}

async function cancelBuild() {
  const id = S.building;
  if (S.jobId && (S.status?.state === 'capturing' || S.status?.state === 'analyzing')) await S.proc.cancel(S.jobId);
  if (id) { toCode({ type: 'cancel', jobId: id }); S.building = null; }
}

// ---------- проверка и сравнение ----------
async function runVerify() {
  toCode({ type: 'verify', project: S.lastProject || undefined });
  const r = await waitFor(['verify-result']);
  S.verify = r.report;
  const v = r.report;
  $('verifyBox').innerHTML = `<b>${v.ok ? '✅ Геометрия в Figma совпадает с моделью' : '⚠️ Найдены отличия'}</b><br>Макетов: ${v.frames}, проверено слоёв: ${v.checkedNodes} (текстовых ${v.texts}).<br>
    Смещения: ${v.positionIssues.length}, проблемы текста: ${v.textIssues.length}, новые наложения текстов: ${v.newOverlaps.length}, пересечения фреймов: ${v.frameOverlaps.length}.<br>
    ${v.positionIssues.slice(0, 12).map((x) => `• ${esc(x.route)} · ${esc(x.node)}: dx ${x.dx}, dy ${x.dy}`).join('<br>')}
    ${v.textIssues.slice(0, 12).map((x) => `• ${esc(x.route)} · ${esc(x.node)}: ${esc(x.problem)}`).join('<br>')}
    ${v.newOverlaps.slice(0, 12).map((x) => `• ${esc(x.route)}: «${esc(x.a)}» ↔ «${esc(x.b)}»`).join('<br>')}<br><span class="muted">${esc(v.scope)}</span>`;
  show($('verifyBox'), true);
}

async function runCompare() {
  if (!S.connected || !S.jobId) { showError($('buildError'), { message: 'Сравнение требует подключённого обработчика.', action: 'Запустите обработчик и снимите страницы.' }); return; }
  S.compare = [];
  const routes = S.builtRoutes.length ? S.builtRoutes : [...S.selected];
  $('verifyBox').innerHTML = 'Экспортирую макеты из Figma и сравниваю с исходником…';
  show($('verifyBox'), true);
  for (const k of routes) {
    const r = await request<Extract<CodeToUi, { type: 'export-result' }>>({ type: 'export', id: ++reqId, project: S.lastProject, route: k });
    if (!r.bytes) { S.compare.push({ route: k, error: r.error }); continue; }
    try {
      const v = await S.proc.verify(S.jobId, k, r.bytes);
      S.compare.push({ route: k, meanAbs: v.meanAbs, changed: v.changedRatio, size: v.sizeMatch });
    } catch (e) { S.compare.push({ route: k, error: (e as Error).message }); }
    $('verifyBox').innerHTML = renderCompare();
  }
  $('verifyBox').innerHTML = renderCompare();
}

function renderCompare() {
  return `<b>Исходник (Chromium) ↔ экспорт нативных фреймов Figma</b><table class="cmp"><tr><th>Страница</th><th>Ср. разница</th><th>Отличается пикселей</th><th>Размер</th></tr>${S.compare.map((c) => `<tr><td>${esc(c.route)}</td>${c.error ? `<td colspan="3">${esc(c.error)}</td>` : `<td>${c.meanAbs!.toFixed(2)}</td><td>${(c.changed! * 100).toFixed(2)}%</td><td>${c.size ? 'совпадает' : '<b>отличается</b>'}</td>`}</tr>`).join('')}</table><span class="muted">Разница вызвана в основном сглаживанием текста и метриками шрифтов; крупные значения указывают на реальные расхождения.</span>`;
}

async function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

async function downloadReport() {
  try {
    const base = S.jobId && S.connected ? await (await S.proc.blob(`/api/jobs/${S.jobId}/report`)).text() : JSON.stringify(S.pkg?.doc ?? {});
    const report = { processor: JSON.parse(base), figma: { verify: S.verify, compare: S.compare, sets: S.sets, fonts: S.fonts, substitutions: S.subs }, createdAt: new Date().toISOString() };
    await download(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), `html-to-figma-report-${Date.now()}.json`);
  } catch (e) { showError($('buildError'), e); }
}

// ---------- события ----------
function bind() {
  $('retryBtn').onclick = () => void checkConnection();
  $('conn').onclick = () => show($('connPanel'), $('connPanel').classList.contains('hidden'));
  $('pairBtn').onclick = () => void pair();
  $('fileInput').onchange = (e) => setFile((e.target as HTMLInputElement).files?.[0] ?? null);
  const drop = $('drop');
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('drop--over'); };
  drop.ondragleave = () => drop.classList.remove('drop--over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('drop--over'); const f = e.dataTransfer?.files?.[0]; if (f) setFile(f); };
  $('analyzeBtn').onclick = () => void analyze(false);
  $('cancelBtn').onclick = () => void cancelBuild();
  $('buildCancel').onclick = () => void cancelBuild();
  $('reanalyze').onclick = () => void analyze(true);
  $('addRoute').onclick = () => void analyze(true);
  $('entrySel').onchange = () => void analyze(true);
  $('showAll').onchange = () => renderPages();
  $('selAll').onclick = () => { for (const r of S.status?.routes ?? []) if (r.status === 'ok') S.selected.add(r.key); renderPages(); updateButtons(); };
  $('selNone').onclick = () => { S.selected.clear(); renderPages(); updateButtons(); };
  $('pages').addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    if (t.dataset.key) { if ((t as HTMLInputElement).checked) S.selected.add(t.dataset.key); else S.selected.delete(t.dataset.key); renderPages(); updateButtons(); }
    if (t.dataset.hover) { const v = t.value; S.hoverChoice[t.dataset.hover] = v === 'auto' || v === 'none' ? v : Number(v); S.dirty.add(t.dataset.hover); toCode({ type: 'notify', text: 'Наведение изменено — страница будет снята заново при создании' }); }
  });
  $('pages').addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-preview]');
    if (!b || !S.jobId) return;
    const key = b.dataset.preview!;
    const img = $('pages').querySelector<HTMLImageElement>(`img[data-thumb="${CSS.escape(key)}"]`);
    if (!img) return;
    if (!img.classList.contains('hidden')) { show(img, false); return; }
    let url = S.thumbs.get(key);
    if (!url) { url = (await S.proc.thumb(S.jobId, key)) ?? ''; S.thumbs.set(key, url); }
    if (url) { img.src = url; show(img, true); }
  });
  $('fonts').addEventListener('change', (e) => { const t = e.target as HTMLSelectElement; if (t.dataset.sub) { if (t.value) S.subs[t.dataset.sub] = t.value; else delete S.subs[t.dataset.sub]; } });
  $('createBtn').onclick = () => void create();
  $('showAllBtn').onclick = () => toCode({ type: 'show', project: S.lastProject || undefined });
  $('verifyBtn').onclick = () => void runVerify();
  $('compareBtn').onclick = () => void runCompare();
  let viewport = false;
  $('modeBtn').onclick = () => { viewport = !viewport; toCode({ type: 'mode', project: S.lastProject, viewport }); $('modeBtn').textContent = viewport ? 'Режим: полная высота' : 'Режим: экран с прокруткой'; };
  $('reportBtn').onclick = () => void downloadReport();
  $('pkgBtn').onclick = async () => { try { if (!S.jobId) return; await download(await S.proc.blob(`/api/jobs/${S.jobId}/package`), (S.status?.sourceName ?? 'project').replace(/\.(zip|html?)$/i, '') + '.h2f.zip'); } catch (e) { showError($('buildError'), e); } };
  $('saveProfile').onclick = async () => { if (!S.file) return; S.profiles[S.file.name] = settings(); await storageSet('profiles', S.profiles); toCode({ type: 'notify', text: 'Настройки проекта сохранены' }); };
  $('pkgInput').onchange = async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      S.pkg = await packageSource(f);
      S.status = null;
      $('fileName').textContent = `Пакет: ${f.name} · страниц ${S.pkg.doc.routes.length}`;
      show($('buildPanel'), true);
      updateButtons();
      toCode({ type: 'notify', text: 'Пакет импорта открыт. Нажмите «Создать макеты».' });
    } catch (err) { showError($('errorBox'), err); }
  };
  listeners.push((m) => {
    if (m.type === 'sets') S.sets = m.sets;
    if (m.type === 'status') toCode({ type: 'notify', text: m.text });
    if (m.type === 'error' && !m.jobId) showError($('buildError'), { message: m.message, action: m.action });
  });
}

async function init() {
  bind();
  toCode({ type: 'init' });
  const m = await waitFor(['init']);
  S.sets = m.sets;
  const st = m.storage as { token?: string; processorUrl?: string; profiles?: Record<string, unknown> };
  if (st.processorUrl) ($('procUrl') as HTMLInputElement).value = st.processorUrl;
  S.proc.token = st.token ?? null;
  S.profiles = st.profiles ?? {};
  if (m.sets.length) { S.lastProject = m.sets[0].project; show($('resultPanel'), true); }
  await checkConnection();
}

void init();
