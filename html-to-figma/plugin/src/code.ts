/*
 * Sandbox плагина «HTML → Figma». Работает только с текущей страницей Figma Design.
 * Создаёт обычные фреймы (без компонентов, вариантов, прототипных связей).
 *
 * Транзакционность: все корневые фреймы текущей попытки запоминаются; при отмене
 * или ошибке удаляются только они. Старые макеты при обновлении удаляются лишь
 * после успешного завершения и только если пользователь их не правил (отпечаток).
 * Ожидание/уступка управления — через обмен сообщениями с UI (в sandbox нет setTimeout).
 */
import type { BuildMode, CodeToUi, FontCheckResult, FontChoice, PlanRoute, SetSummary, UiToCode, VerifyReport } from '../../shared/messages';
import { PLUGIN_DATA_KEY, PROTOCOL_VERSION, type RootRegistry, type RouteSnapshot } from '../../shared/schema';
import { matchFigmaFont, styleItalic, styleWeight } from '../../shared/fonts';
import { GRID_GAP, layoutGrid, overlaps, placeIntoSet, placeNewSet, type Box } from '../../shared/grid';
import { validateSnapshot } from '../../shared/validate';
import { buildRoute, fingerprint, type BuildContext } from './build';

const post = (m: CodeToUi) => figma.ui.postMessage(m);

figma.showUI(__html__, { width: 480, height: 780, themeColors: true, title: 'HTML → Figma' });

// ---------- уступка управления UI ----------
let tickN = 0;
const waiting = new Map<number, () => void>();
function tick(): Promise<void> {
  const n = ++tickN;
  return new Promise((res) => { waiting.set(n, res); post({ type: 'tick', n }); });
}

// ---------- реестр импортов ----------
function registry(n: BaseNode): RootRegistry | null {
  if (n.type !== 'FRAME') return null;
  const raw = n.getPluginData(PLUGIN_DATA_KEY);
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as RootRegistry;
    return r && r.v === PROTOCOL_VERSION && r.project && r.route ? r : null;
  } catch { return null; }
}

function roots(project?: string): Array<{ node: FrameNode; reg: RootRegistry }> {
  const out: Array<{ node: FrameNode; reg: RootRegistry }> = [];
  for (const n of figma.currentPage.children) {
    const reg = registry(n);
    if (reg && (!project || reg.project === project)) out.push({ node: n as FrameNode, reg });
  }
  return out;
}

function latestSet(project: string) {
  const all = roots(project);
  const bySet = new Map<string, Array<{ node: FrameNode; reg: RootRegistry }>>();
  for (const r of all) { const l = bySet.get(r.reg.set) ?? []; l.push(r); bySet.set(r.reg.set, l); }
  let best: string | null = null, bestTime = '';
  for (const [s, l] of bySet) { const t = l.map((x) => x.reg.createdAt).sort().pop() ?? ''; if (t >= bestTime) { best = s; bestTime = t; } }
  return best ? { set: best, items: bySet.get(best)! } : null;
}

function summarize(): SetSummary[] {
  const bySet = new Map<string, SetSummary>();
  for (const { node, reg } of roots()) {
    const k = reg.project + '|' + reg.set;
    const s = bySet.get(k) ?? { project: reg.project, label: reg.label.split(' · ')[0], set: reg.set, source: reg.source, routes: [], createdAt: reg.createdAt };
    s.routes.push({ key: reg.route, label: node.name, id: node.id, edited: fingerprint(node) !== reg.fp, mode: reg.mode });
    if (reg.createdAt > s.createdAt) s.createdAt = reg.createdAt;
    bySet.set(k, s);
  }
  return [...bySet.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function boxOf(n: SceneNode): Box {
  const b = n.absoluteBoundingBox;
  return b ? { x: b.x, y: b.y, width: b.width, height: b.height } : { x: n.x, y: n.y, width: n.width, height: n.height };
}

// ---------- состояние сборки ----------
interface Job {
  id: string;
  project: string;
  label: string;
  source: string;
  set: string;
  mode: BuildMode;
  columns: number;
  viewportMode: boolean;
  created: FrameNode[];
  replace: Map<string, FrameNode>;
  edited: Map<string, FrameNode>;
  positions: Map<string, { x: number; y: number; slot: [number, number] }>;
  grid: { origin: { x: number; y: number }; colWidth: number; rowTops: number[]; slots: Record<string, [number, number]> };
  order: Map<string, number>;
  fonts: Map<string, FontName & { variationSettings?: Record<string, number> }>;
  images: Map<string, string>;
  svgs: Map<string, string>;
  cancel: boolean;
  busy: boolean;
  routes: Map<string, PlanRoute>;
  stats: { texts: number; nodes: number; warnings: number };
}
let job: Job | null = null;

class CancelError extends Error { constructor() { super('Создание отменено. Новые объекты этой попытки удалены.'); } }

async function rollback(j: Job, reason: string) {
  let removed = 0;
  for (let i = j.created.length - 1; i >= 0; i--) {
    const n = j.created[i];
    try { if (!n.removed) { n.remove(); removed++; } } catch { /* уже удалён пользователем */ }
  }
  j.created = [];
  post({ type: 'aborted', jobId: j.id, removed, reason });
  job = null;
}

// ---------- шрифты ----------
let availableCache: Font[] | null = null;
async function available(): Promise<Font[]> {
  if (!availableCache) availableCache = await figma.listAvailableFontsAsync();
  return availableCache;
}

async function checkFonts(reqs: Parameters<typeof matchFigmaFont>[0][], substitutions: Record<string, string> = {}): Promise<{ results: FontCheckResult[]; families: string[] }> {
  const list = await available();
  const lite = list.map((f) => ({ family: f.fontName.family, style: f.fontName.style }));
  const variable = new Set<string>();
  const fams = [...new Set(lite.map((f) => f.family))];
  for (const r of reqs) {
    for (const fam of fams.filter((f) => f.toLowerCase() === r.family.toLowerCase())) {
      try { if (figma.getFontFamilyVariationAxes(fam)?.includes('wght')) variable.add(fam); } catch { /* старая версия API */ }
    }
  }
  const results: FontCheckResult[] = reqs.map((r) => {
    const sub = substitutions[r.key];
    const m = matchFigmaFont(sub ? { ...r, family: sub, fileFamily: undefined } : r, lite, variable);
    return { key: r.key, family: r.family, weight: r.weight, italic: r.italic, found: m.font ? { family: m.font.family, style: m.font.style, wght: m.variation } : null, note: sub ? `замена пользователем: ${sub}` + (m.note ? '; ' + m.note : '') : m.note };
  });
  return { results, families: fams.sort() };
}

// ---------- план размещения ----------
function plan(msg: Extract<UiToCode, { type: 'begin' }>): Job {
  const existing = msg.mode === 'copy' ? null : latestSet(msg.project);
  const set = existing && msg.mode !== 'copy' ? existing.set : Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const j: Job = {
    id: msg.jobId, project: msg.project, label: msg.projectLabel, source: msg.source, set, mode: msg.mode, columns: Math.max(1, Math.min(12, msg.columns || 4)), viewportMode: msg.viewportMode,
    created: [], replace: new Map(), edited: new Map(), positions: new Map(), grid: { origin: { x: 0, y: 0 }, colWidth: 0, rowTops: [], slots: {} }, order: new Map(),
    fonts: new Map(), images: new Map(), svgs: new Map(), cancel: false, busy: false, routes: new Map(msg.routes.map((r) => [r.key, r])), stats: { texts: 0, nodes: 0, warnings: 0 },
  };
  msg.routes.forEach((r, i) => j.order.set(r.key, i));
  const have = new Map((existing?.items ?? []).map((x) => [x.reg.route, x]));
  const build: PlanRoute[] = [];
  const skip: Array<{ key: string; reason: string }> = [];
  for (const r of msg.routes) {
    const ex = have.get(r.key);
    if (!ex) { build.push(r); continue; }
    if (msg.mode === 'missing') { skip.push({ key: r.key, reason: 'уже есть в комплекте' }); continue; }
    if (msg.mode === 'update') {
      if (fingerprint(ex.node) === ex.reg.fp) j.replace.set(r.key, ex.node);
      else j.edited.set(r.key, ex.node);
      build.push(r);
    }
  }
  // заменяемые старые фреймы не мешают своему же месту
  const replacedIds = new Set([...j.replace.values()].map((n) => n.id));
  const occupied = figma.currentPage.children.filter((n) => !replacedIds.has(n.id)).map(boxOf);
  const items = build.map((r) => ({ key: r.key, width: r.width, height: r.viewportHeight && msg.viewportMode ? r.viewportHeight : r.height }));
  if (!existing) {
    // новый комплект: сетка правее всего содержимого страницы; высота ряда — по самому высокому макету
    const vc = figma.viewport.center;
    const placed = placeNewSet(items, j.columns, occupied, { x: Math.round(vc.x - 720), y: Math.round(vc.y - 400) });
    const all = layoutGrid(items, j.columns);
    placed.forEach((p) => j.positions.set(p.key, { x: p.x, y: p.y, slot: p.slot }));
    if (placed.length) {
      const o = { x: placed[0].x - all[0].x, y: placed[0].y - all[0].y };
      const rowTops: number[] = [];
      const slots: Record<string, [number, number]> = {};
      for (const p of all) { rowTops[p.slot[1]] = p.y; slots[p.key] = p.slot; }
      j.grid = { origin: o, colWidth: Math.max(...items.map((i) => i.width)), rowTops, slots };
    }
  } else {
    const ref = existing.items[0];
    const g = (ref.reg as RootRegistry & { grid?: Job['grid'] }).grid;
    j.columns = ref.reg.columns || j.columns;
    j.grid = g ? { ...g, slots: { ...(g.slots ?? {}) } } : { origin: { x: ref.node.x, y: ref.node.y }, colWidth: ref.reg.width, rowTops: [0], slots: {} };
    const occ = [...occupied];
    // сначала резервируем места заменяемых фреймов (новая версия встанет туда же)
    for (const it of items) {
      const old = j.replace.get(it.key);
      if (old) { j.positions.set(it.key, { x: old.x, y: old.y, slot: (registry(old)?.slot ?? [0, 0]) as [number, number] }); occ.push({ x: old.x, y: old.y, width: Math.max(it.width, old.width), height: Math.max(it.height, old.height) }); }
    }
    for (const it of items) {
      if (j.replace.has(it.key)) continue;
      // исходный слот (восстановление удалённого фрейма) или новое свободное место
      const slot = j.edited.has(it.key) ? null : j.grid.slots[it.key] ?? null;
      const pos = placeIntoSet(it, slot, j.grid.origin, j.grid.rowTops, j.grid.colWidth, occ);
      occ.push({ x: pos.x, y: pos.y, width: it.width, height: it.height });
      j.positions.set(it.key, { ...pos, slot: slot ?? [-1, -1] });
    }
  }
  post({ type: 'plan', jobId: j.id, build: build.map((r) => r.key), skip, replace: [...j.replace.keys()] });
  return j;
}

async function loadFonts(j: Job, choices: FontChoice[]) {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  const failed: string[] = [];
  for (const c of choices) {
    const fn: FontName & { variationSettings?: Record<string, number> } = c.wght ? { family: c.family, style: c.style, variationSettings: { wght: c.wght } } : { family: c.family, style: c.style };
    try { await figma.loadFontAsync({ family: c.family, style: c.style }); j.fonts.set(c.key, fn); }
    catch { failed.push(`${c.family} ${c.style}`); }
  }
  if (failed.length) throw Object.assign(new Error('Не удалось загрузить шрифты: ' + failed.join(', ')), { action: 'Установите эти шрифты в систему, перезапустите Figma и повторите. Холст не изменён.' });
}

// ---------- сборка страницы ----------
async function buildOne(j: Job, s: RouteSnapshot, index: number) {
  const pr = j.routes.get(s.routeKey);
  if (!pr) throw new Error('маршрут не входит в план: ' + s.routeKey);
  const v = validateSnapshot(s, new Set(j.fonts.keys()), new Set([...j.images.keys(), ...j.svgs.keys()]));
  // отсутствующий ассет (ошибка загрузки) допустим — нода получит заглушку; остальное — фатально
  const fatal = v.issues.filter((i) => !/нет ассета|нет запасного ассета/.test(i.message));
  if (fatal.length) throw new Error(`Страница ${s.routeKey}: модель не прошла проверку (${fatal.slice(0, 3).map((i) => i.path + ': ' + i.message).join('; ')})`);
  const warnings: Array<{ code: string; message: string; node?: string }> = [];
  let nodes = 0, texts = 0;
  const ctx: BuildContext = {
    fonts: j.fonts, images: j.images, svgs: j.svgs, route: s.routeKey, warnings, count: 0,
    tick: async () => { post({ type: 'progress', jobId: j.id, route: s.routeKey, nodes: ctx.count, total: v.nodes, index }); await tick(); if (j.cancel) throw new CancelError(); },
    checkCancel: () => { if (j.cancel) throw new CancelError(); },
    onNode: (n) => { nodes++; if (n.type === 'TEXT') texts++; },
  };
  const order = j.order.get(s.routeKey) ?? index;
  const name = `${String(order + 1).padStart(2, '0')} · ${s.label || s.title || s.routeKey}`;
  const root = await buildRoute(s, ctx, name, (r) => j.created.push(r));
  const pos = j.positions.get(s.routeKey)!;
  root.x = pos.x;
  root.y = pos.y;
  if (j.viewportMode) {
    root.resizeWithoutConstraints(root.width, Math.min(s.height, s.viewport.height));
    root.overflowDirection = 'VERTICAL';
    root.numberOfFixedChildren = s.fixedCount;
  }
  const reg: RootRegistry & { grid: Job['grid'] } = {
    v: PROTOCOL_VERSION, project: j.project, set: j.set, route: s.routeKey, label: j.label + ' · ' + (s.label || s.routeKey), source: j.source, createdAt: new Date().toISOString(),
    fp: '', slot: pos.slot, columns: j.columns, fixed: s.fixedCount, height: s.height, width: s.width, viewportHeight: s.viewport.height, mode: j.viewportMode ? 'viewport' : 'design', grid: j.grid,
  };
  if (s.hover.active) root.setPluginData('hover', s.hover.selector ?? '');
  root.setRelaunchData({ open: 'Открыть импортёр HTML → Figma' });
  reg.fp = fingerprint(root);
  root.setPluginData(PLUGIN_DATA_KEY, JSON.stringify(reg));
  j.stats.nodes += nodes; j.stats.texts += texts; j.stats.warnings += warnings.length;
  post({ type: 'route-done', jobId: j.id, key: s.routeKey, nodeId: root.id, warnings: warnings.slice(0, 50), nodes });
}

function commit(j: Job) {
  let replaced = 0;
  for (const [, old] of j.replace) { try { old.remove(); replaced++; } catch { /* */ } }
  for (const [, ed] of j.edited) { if (!ed.name.endsWith('(изменён вручную)')) ed.name = ed.name + ' (изменён вручную)'; }
  if (j.created.length) {
    figma.currentPage.selection = j.created;
    figma.viewport.scrollAndZoomIntoView(j.created);
  }
  figma.root.setRelaunchData({ open: 'Открыть импортёр HTML → Figma' });
  post({ type: 'done', jobId: j.id, summary: { created: j.created.length, replaced, kept: j.edited.size, skipped: 0, texts: j.stats.texts, nodes: j.stats.nodes, warnings: j.stats.warnings, set: j.set } });
  post({ type: 'sets', sets: summarize() });
  job = null;
}

// ---------- проверка геометрии ----------
function verify(project?: string): VerifyReport {
  const rep: VerifyReport = { frames: 0, texts: 0, checkedNodes: 0, positionIssues: [], textIssues: [], newOverlaps: [], frameOverlaps: [], ok: true, scope: 'Проверка в Figma: абсолютные рамки нативных слоёв сравниваются с рамками модели; пересечения фреймов на странице.' };
  const list = roots(project);
  rep.frames = list.length;
  for (const { node: root, reg } of list) {
    const ox = root.absoluteTransform[0][2], oy = root.absoluteTransform[1][2];
    const texts: Array<{ name: string; exp: number[]; got: Box }> = [];
    const walk = (n: SceneNode) => {
      const e = n.getPluginData('e');
      if (e && n.absoluteBoundingBox) {
        const exp = e.split(',').map(Number);
        const b = n.absoluteBoundingBox;
        const got = { x: b.x - ox, y: b.y - oy, width: b.width, height: b.height };
        rep.checkedNodes++;
        if (n.type === 'TEXT') {
          rep.texts++;
          texts.push({ name: n.name, exp, got });
          const a = n.getPluginData('a') || 'LEFT';
          // опорная точка выравнивания в абсолютных координатах — устойчива к повороту и к ширине текста
          const ea = n.getPluginData('ea').split(',').map(Number);
          const m = n.absoluteTransform;
          const lx = a === 'CENTER' ? n.width / 2 : a === 'RIGHT' ? n.width : 0;
          const kx = ea.length === 2 ? m[0][0] * lx + m[0][2] - ox - ea[0] : got.x - exp[0];
          const dy = ea.length === 2 ? m[1][0] * lx + m[1][2] - oy - ea[1] : got.y - exp[1];
          if (Math.abs(kx) > 2 || Math.abs(dy) > 2) rep.positionIssues.push({ route: reg.route, node: n.name, dx: +kx.toFixed(2), dy: +dy.toFixed(2), dw: +(got.width - exp[2]).toFixed(2), dh: +(got.height - exp[3]).toFixed(2) });
          const lines = Number(n.getPluginData('l')) || 0;
          if (lines && n.characters.split('\n').length !== lines) rep.textIssues.push({ route: reg.route, node: n.name, problem: 'изменилось число строк' });
          if (n.textAutoResize === 'WIDTH_AND_HEIGHT' && exp[2] > 4 && got.width > exp[2] * 1.06 + 2) rep.textIssues.push({ route: reg.route, node: n.name, problem: `шире исходного на ${(got.width - exp[2]).toFixed(1)} px (метрики шрифта в Figma)` });
        } else if (Math.abs(got.x - exp[0]) > 1 || Math.abs(got.y - exp[1]) > 1 || Math.abs(got.width - exp[2]) > 1 || Math.abs(got.height - exp[3]) > 1) {
          rep.positionIssues.push({ route: reg.route, node: n.name, dx: +(got.x - exp[0]).toFixed(2), dy: +(got.y - exp[1]).toFixed(2), dw: +(got.width - exp[2]).toFixed(2), dh: +(got.height - exp[3]).toFixed(2) });
        }
      }
      if ('children' in n) for (const c of n.children) walk(c);
    };
    for (const c of root.children) walk(c);
    // наложения текстов, которых не было в исходнике
    texts.sort((a, b) => a.got.y - b.got.y);
    for (let i = 0; i < texts.length; i++) {
      for (let k = i + 1; k < texts.length && texts[k].got.y < texts[i].got.y + texts[i].got.height; k++) {
        const A = texts[i], B = texts[k];
        const was = overlaps({ x: A.exp[0], y: A.exp[1], width: A.exp[2], height: A.exp[3] }, { x: B.exp[0], y: B.exp[1], width: B.exp[2], height: B.exp[3] }, 0.5);
        if (!was && overlaps(A.got, B.got, 1)) rep.newOverlaps.push({ route: reg.route, a: A.name, b: B.name });
      }
    }
  }
  const boxes = list.map(({ node, reg }) => ({ key: reg.route + '@' + reg.set, ...boxOf(node) }));
  for (let i = 0; i < boxes.length; i++) for (let k = i + 1; k < boxes.length; k++) if (overlaps(boxes[i], boxes[k])) rep.frameOverlaps.push([boxes[i].key, boxes[k].key]);
  rep.positionIssues = rep.positionIssues.slice(0, 200);
  rep.textIssues = rep.textIssues.slice(0, 200);
  rep.newOverlaps = rep.newOverlaps.slice(0, 200);
  rep.ok = !rep.positionIssues.length && !rep.newOverlaps.length && !rep.frameOverlaps.length && !rep.textIssues.some((t) => t.problem.includes('строк'));
  return rep;
}

function setMode(project: string, viewport: boolean) {
  const s = latestSet(project);
  if (!s) throw new Error('Сначала создайте макеты.');
  for (const { node, reg } of s.items) {
    const wasClean = fingerprint(node) === reg.fp;
    const h = viewport ? Math.min(reg.height, reg.viewportHeight) : reg.height;
    node.resizeWithoutConstraints(node.width, h);
    node.clipsContent = true;
    node.overflowDirection = viewport ? 'VERTICAL' : 'NONE';
    node.numberOfFixedChildren = viewport ? reg.fixed : 0;
    reg.mode = viewport ? 'viewport' : 'design';
    if (wasClean) reg.fp = fingerprint(node);
    node.setPluginData(PLUGIN_DATA_KEY, JSON.stringify(reg));
  }
}

// ---------- сообщения ----------
figma.ui.onmessage = async (msg: UiToCode) => {
  try {
    switch (msg.type) {
      case 'tock': { const r = waiting.get(msg.n); waiting.delete(msg.n); r?.(); return; }
      case 'cancel': if (job && job.id === msg.jobId) job.cancel = true; return;
      case 'init': {
        const keys = ['token', 'settings', 'profiles', 'processorUrl'];
        const storage: Record<string, unknown> = {};
        for (const k of keys) storage[k] = await figma.clientStorage.getAsync(k);
        post({ type: 'init', page: figma.currentPage.name, editor: figma.editorType, sets: summarize(), storage });
        return;
      }
      case 'storage-get': post({ type: 'storage', id: msg.id, value: await figma.clientStorage.getAsync(msg.key) }); return;
      case 'storage-set': await figma.clientStorage.setAsync(msg.key, msg.value); post({ type: 'storage', id: msg.id, value: true }); return;
      case 'notify': figma.notify(msg.text, { error: !!msg.error, timeout: 4000 }); return;
      case 'resize': figma.ui.resize(Math.max(360, Math.min(900, msg.width)), Math.max(420, Math.min(1200, msg.height))); return;
      case 'fonts-check': {
        const r = await checkFonts(msg.fonts, msg.substitutions);
        post({ type: 'fonts-result', id: msg.id, results: r.results, families: r.families });
        return;
      }
      case 'begin': {
        if (job?.busy) { post({ type: 'error', jobId: msg.jobId, message: 'Уже идёт создание макетов.', action: 'Дождитесь завершения или нажмите «Отмена».' }); return; }
        if (figma.editorType !== 'figma') { post({ type: 'error', jobId: msg.jobId, message: 'Плагин работает только в Figma Design.', action: 'Откройте файл Figma Design (не FigJam/Slides).' }); return; }
        const j = plan(msg);
        job = j;
        try { await loadFonts(j, msg.fonts); }
        catch (e) { job = null; post({ type: 'error', jobId: msg.jobId, message: (e as Error).message, action: (e as { action?: string }).action }); }
        return;
      }
      case 'asset': {
        const j = job;
        if (!j || j.id !== msg.jobId) return;
        try {
          if (msg.kind === 'image' && msg.bytes) j.images.set(msg.id, figma.createImage(msg.bytes).hash);
          else if (msg.kind === 'svg' && msg.text !== undefined) j.svgs.set(msg.id, msg.text);
          post({ type: 'asset-ok', jobId: j.id, id: msg.id });
        } catch (e) {
          post({ type: 'asset-error', jobId: j.id, id: msg.id, message: String((e as Error).message ?? e).slice(0, 200) });
        }
        return;
      }
      case 'route': {
        const j = job;
        if (!j || j.id !== msg.jobId) return;
        j.busy = true;
        try { await buildOne(j, msg.snapshot, msg.index); }
        catch (e) {
          j.busy = false;
          if (e instanceof CancelError) { await rollback(j, e.message); return; }
          await rollback(j, 'Ошибка: ' + (e as Error).message);
          post({ type: 'error', jobId: j.id, message: (e as Error).message, action: 'Все новые объекты этой попытки удалены, старые макеты не затронуты. Скачайте отчёт и повторите.' });
          return;
        }
        j.busy = false;
        return;
      }
      case 'commit': { const j = job; if (j && j.id === msg.jobId) commit(j); return; }
      case 'abort': { const j = job; if (j && j.id === msg.jobId) await rollback(j, msg.reason); return; }
      case 'show': {
        const list = roots(msg.project).filter((r) => !msg.route || r.reg.route === msg.route).map((r) => r.node);
        if (list.length) { figma.currentPage.selection = list; figma.viewport.scrollAndZoomIntoView(list); }
        return;
      }
      case 'mode': setMode(msg.project, msg.viewport); post({ type: 'sets', sets: summarize() }); post({ type: 'status', text: msg.viewport ? 'Режим просмотра: экран с вертикальной прокруткой, закреплённые элементы зафиксированы.' : 'Макеты развёрнуты на полную высоту.' }); return;
      case 'verify': post({ type: 'verify-result', report: verify(msg.project) }); return;
      case 'export': {
        const r = roots(msg.project).find((x) => x.reg.route === msg.route);
        if (!r) { post({ type: 'export-result', id: msg.id, route: msg.route, error: 'макет не найден' }); return; }
        const h = r.node.height;
        const full = r.reg.height;
        if (Math.abs(h - full) > 0.5) r.node.resizeWithoutConstraints(r.node.width, full);
        try {
          const bytes = await r.node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 1 } });
          post({ type: 'export-result', id: msg.id, route: msg.route, bytes });
        } finally {
          if (Math.abs(h - full) > 0.5) r.node.resizeWithoutConstraints(r.node.width, h);
        }
        return;
      }
    }
  } catch (e) {
    post({ type: 'error', message: String((e as Error).message ?? e), action: 'Повторите действие. Если ошибка повторяется — скачайте отчёт.' });
  }
};

void styleWeight; void styleItalic; void GRID_GAP;
