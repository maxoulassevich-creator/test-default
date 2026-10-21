/*
 * Создание нод Figma из промежуточной модели.
 * Порядок для каждой ноды: создать → appendChild к правильному родителю → размеры →
 * свойства → relativeTransform (в системе координат родителя). Auto Layout не
 * включается (layoutMode = NONE): измеренная раскладка браузера переносится как есть.
 * Все значения проверены shared/validate до первой мутации холста.
 */
import type { EffectIR, FrameIR, ImageIR, NodeIR, PaintIR, RouteSnapshot, ShapeIR, StrokeIR, SvgIR, TextIR } from '../../shared/schema';
import { hasUnitAxes, rotationOnly, toFigmaTransform } from '../../shared/matrix';

export interface BuildContext {
  fonts: Map<string, FontName & { variationSettings?: Record<string, number> }>;
  images: Map<string, string>; // assetId → imageHash
  svgs: Map<string, string>; // assetId → разметка
  route: string;
  warnings: Array<{ code: string; message: string; node?: string }>;
  count: number;
  tick: () => Promise<void>;
  checkCancel: () => void;
  onNode?: (n: SceneNode, ir: NodeIR) => void;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const sameRgba = (a: { r: number; g: number; b: number; a: number }, b: { r: number; g: number; b: number; a: number }) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) + Math.abs(a.a - b.a) < 0.01;

/** Одно предупреждение на страницу для однотипного случая (а не по слою на каждую цену). */
function warnOnce(ctx: BuildContext, code: string, message: string, node?: string) {
  const have = ctx.warnings.find((w) => w.code === code) as { message: string; count?: number } | undefined;
  if (have) { have.count = (have.count ?? 1) + 1; have.message = `${message} (×${have.count})`; return; }
  ctx.warnings.push({ code, message, node });
}

/**
 * Необязательное оформление (цвет/стиль линии, ссылка, эффекты, штрих): если Figma его
 * не принимает, слой остаётся, а в результат попадает предупреждение — страница не обрывается.
 */
function optional(ctx: BuildContext, ir: NodeIR, what: string, fn: () => void) {
  try { fn(); } catch (e) { warnOnce(ctx, 'figma-rejected:' + what, `${what}: Figma не приняла значение (${String((e as Error).message ?? e).slice(0, 140)})`, ir.src); }
}

export function paint(p: PaintIR, ctx: BuildContext): Paint | null {
  const blendMode = p.blend && p.blend !== 'PASS_THROUGH' ? (p.blend as BlendMode) : undefined;
  if (p.type === 'SOLID') {
    const s: SolidPaint = { type: 'SOLID', color: { r: clamp01(p.color.r), g: clamp01(p.color.g), b: clamp01(p.color.b) }, opacity: clamp01(p.opacity), ...(blendMode ? { blendMode } : {}) };
    return s;
  }
  if (p.type === 'IMAGE') {
    const hash = ctx.images.get(p.asset);
    if (!hash) { ctx.warnings.push({ code: 'image-missing', message: `Нет изображения ${p.asset}` }); return null; }
    const ip: ImagePaint = {
      type: 'IMAGE', imageHash: hash, scaleMode: p.scaleMode, opacity: clamp01(p.opacity),
      ...(p.scaleMode === 'CROP' && p.imageTransform ? { imageTransform: toFigmaTransform(p.imageTransform) } : {}),
      ...(p.scaleMode === 'TILE' && p.scalingFactor ? { scalingFactor: p.scalingFactor } : {}),
      ...(blendMode ? { blendMode } : {}),
    };
    return ip;
  }
  const g: GradientPaint = {
    type: p.type,
    gradientTransform: toFigmaTransform(p.transform),
    gradientStops: p.stops.map((s) => ({ position: clamp01(s.position), color: { r: clamp01(s.color.r), g: clamp01(s.color.g), b: clamp01(s.color.b), a: clamp01(s.color.a) } })),
    opacity: clamp01(p.opacity),
    ...(blendMode ? { blendMode } : {}),
  };
  return g;
}

/**
 * Заливки слоя. Если Figma отклонит набор (например, вырожденный градиент), градиенты
 * заменяются средним цветом их точек, и в результат попадает предупреждение.
 */
function setFills(n: MinimalFillsMixin, list: PaintIR[] | undefined, ctx: BuildContext, ir: { src?: string }) {
  const ps = paints(list, ctx);
  try { n.fills = ps; return; } catch (e) {
    const safe = ps.map((p) => {
      if (p.type !== 'GRADIENT_LINEAR' && p.type !== 'GRADIENT_RADIAL' && p.type !== 'GRADIENT_ANGULAR' && p.type !== 'GRADIENT_DIAMOND') return p;
      const st = p.gradientStops, k = st.length || 1;
      const avg = st.reduce((a, s) => ({ r: a.r + s.color.r / k, g: a.g + s.color.g / k, b: a.b + s.color.b / k, a: a.a + s.color.a / k }), { r: 0, g: 0, b: 0, a: 0 });
      return { type: 'SOLID', color: { r: avg.r, g: avg.g, b: avg.b }, opacity: clamp01(avg.a * (p.opacity ?? 1)) } as SolidPaint;
    });
    n.fills = safe;
    warnOnce(ctx, 'fills-fallback', `Заливка не принята Figma — градиент заменён средним цветом (${String((e as Error).message ?? e).slice(0, 120)})`, ir.src);
  }
}

export function paints(list: PaintIR[] | undefined, ctx: BuildContext): Paint[] {
  const out: Paint[] = [];
  for (const p of list ?? []) { const f = paint(p, ctx); if (f) out.push(f); }
  return out;
}

export function effects(list: EffectIR[] | undefined): Effect[] {
  const out: Effect[] = [];
  for (const e of list ?? []) {
    if (e.type === 'DROP_SHADOW') out.push({ type: 'DROP_SHADOW', color: { r: e.color.r, g: e.color.g, b: e.color.b, a: e.color.a }, offset: { x: e.x, y: e.y }, radius: Math.max(0, e.blur), spread: e.spread, visible: true, blendMode: 'NORMAL', showShadowBehindNode: false });
    else if (e.type === 'INNER_SHADOW') out.push({ type: 'INNER_SHADOW', color: { r: e.color.r, g: e.color.g, b: e.color.b, a: e.color.a }, offset: { x: e.x, y: e.y }, radius: Math.max(0, e.blur), spread: e.spread, visible: true, blendMode: 'NORMAL' });
    else out.push({ type: e.type, blurType: 'NORMAL', radius: Math.max(0, e.radius), visible: true } as BlurEffect);
  }
  return out;
}

function applyStroke(n: GeometryMixin & IndividualStrokesMixin & MinimalStrokesMixin, s: StrokeIR | undefined, uniformOnly = false) {
  if (!s) return;
  n.strokes = [{ type: 'SOLID', color: { r: s.color.r, g: s.color.g, b: s.color.b }, opacity: clamp01(s.opacity) }];
  n.strokeAlign = s.align;
  const [t, r, b, l] = s.weights;
  // у эллипса нет отдельных толщин сторон
  if (uniformOnly) n.strokeWeight = Math.max(t, r, b, l);
  else if (t === r && r === b && b === l) n.strokeWeight = t;
  else { n.strokeTopWeight = t; n.strokeRightWeight = r; n.strokeBottomWeight = b; n.strokeLeftWeight = l; }
  if (s.dash && s.dash.length) n.dashPattern = s.dash;
}

function applyRadius(n: RectangleCornerMixin, r: [number, number, number, number] | undefined) {
  if (!r) return;
  n.topLeftRadius = r[0];
  n.topRightRadius = r[1];
  n.bottomRightRadius = r[2];
  n.bottomLeftRadius = r[3];
}

function applyCommon(node: SceneNode & MinimalBlendMixin & LayoutMixin, ir: NodeIR, defaultBlend: BlendMode) {
  // явный 0 сохраняется, отсутствие — 1
  node.opacity = ir.opacity === undefined ? 1 : clamp01(ir.opacity);
  node.blendMode = ir.blend ? (ir.blend as BlendMode) : defaultBlend;
  if (ir.visible === false) node.visible = false;
}

function place(node: SceneNode & LayoutMixin, ir: NodeIR, dx = 0) {
  let m = ir.m;
  if (!hasUnitAxes(m, 1e-4)) m = rotationOnly(m); // страховка; обработчик уже нормализовал масштаб
  // смещение вдоль локальной оси x (выравнивание текста по центру/справа)
  const e = m[4] + m[0] * dx, f = m[5] + m[1] * dx;
  node.relativeTransform = [[m[0], m[2], e], [m[1], m[3], f]];
}

const size = (v: number) => Math.max(0.01, Number.isFinite(v) ? v : 0.01);

export function setExpect(node: SceneNode, ir: NodeIR) {
  if (ir.expect) node.setPluginData('e', ir.expect.join(','));
  if (ir.anchor) node.setPluginData('ea', ir.anchor.join(','));
}

async function buildText(parent: FrameNode, ir: TextIR, ctx: BuildContext): Promise<TextNode> {
  const t = figma.createText();
  parent.appendChild(t);
  t.name = ir.name;
  t.autoRename = false;
  const first = ir.runs[0];
  const f0 = ctx.fonts.get(first.font);
  if (!f0) throw new Error(`шрифт ${first.font} не загружен`);
  t.fontName = f0;
  t.fontSize = first.size;
  t.lineHeight = { unit: 'PIXELS', value: ir.lineHeight };
  t.letterSpacing = { unit: 'PIXELS', value: first.letterSpacing };
  t.fills = [{ type: 'SOLID', color: { r: first.color.r, g: first.color.g, b: first.color.b }, opacity: clamp01(first.color.a) }];
  t.textAlignHorizontal = ir.align;
  t.textAlignVertical = 'TOP';
  t.paragraphSpacing = 0;
  t.paragraphIndent = 0;
  t.characters = ir.text;
  for (const r of ir.runs) {
    const font = ctx.fonts.get(r.font);
    if (!font) throw new Error(`шрифт ${r.font} не загружен`);
    if (r !== first || ir.runs.length > 1) {
      if (font.family !== f0.family || font.style !== f0.style || JSON.stringify(font.variationSettings ?? null) !== JSON.stringify(f0.variationSettings ?? null)) t.setRangeFontName(r.start, r.end, font);
      if (r.size !== first.size) t.setRangeFontSize(r.start, r.end, r.size);
      if (r.letterSpacing !== first.letterSpacing) t.setRangeLetterSpacing(r.start, r.end, { unit: 'PIXELS', value: r.letterSpacing });
      if (r.color.r !== first.color.r || r.color.g !== first.color.g || r.color.b !== first.color.b || r.color.a !== first.color.a) t.setRangeFills(r.start, r.end, [{ type: 'SOLID', color: { r: r.color.r, g: r.color.g, b: r.color.b }, opacity: clamp01(r.color.a) }]);
    }
    if (r.decoration) {
      t.setRangeTextDecoration(r.start, r.end, r.decoration);
      if (r.decoration === 'UNDERLINE') {
        // стиль, цвет и толщина линии в Figma есть только у подчёркивания
        if (r.decorationStyle && r.decorationStyle !== 'SOLID') optional(ctx, ir, 'Стиль подчёркивания', () => t.setRangeTextDecorationStyle(r.start, r.end, r.decorationStyle!));
        if (r.decorationColor) optional(ctx, ir, 'Цвет подчёркивания', () => t.setRangeTextDecorationColor(r.start, r.end, { value: { type: 'SOLID', color: { r: r.decorationColor!.r, g: r.decorationColor!.g, b: r.decorationColor!.b }, opacity: clamp01(r.decorationColor!.a) } }));
        if (r.decorationThickness) optional(ctx, ir, 'Толщина подчёркивания', () => t.setRangeTextDecorationThickness(r.start, r.end, { unit: 'PIXELS', value: r.decorationThickness! }));
      } else if ((r.decorationColor && !sameRgba(r.decorationColor, r.color)) || r.decorationThickness) {
        warnOnce(ctx, 'strike-style', 'Цвет и толщина линии зачёркивания в Figma не задаются — линия цвета текста', ir.src);
      }
    }
    if (r.link) optional(ctx, ir, 'Ссылка', () => t.setRangeHyperlink(r.start, r.end, { type: 'URL', value: r.link! }));
  }
  if (ir.fills?.length && paints(ir.fills, ctx).length) setFills(t, ir.fills, ctx, ir);
  if (ir.textStroke && ir.textStroke.width > 0) {
    t.strokes = [{ type: 'SOLID', color: { r: ir.textStroke.color.r, g: ir.textStroke.color.g, b: ir.textStroke.color.b }, opacity: clamp01(ir.textStroke.color.a) }];
    t.strokeWeight = ir.textStroke.width;
    t.strokeAlign = 'CENTER';
  }
  applyCommon(t, ir, 'PASS_THROUGH');
  if (ir.effects?.length) optional(ctx, ir, 'Тени и размытие', () => { t.effects = effects(ir.effects); });
  let dx = 0;
  if (ir.truncate) {
    // фиксированная коробка + многоточие средствами Figma
    t.textAutoResize = 'NONE';
    t.resize(size(ir.w), size(ir.lineHeight * ir.truncate));
    t.textTruncation = 'ENDING';
    if (ir.truncate > 1) t.maxLines = ir.truncate;
  } else if (ir.tags?.includes('wrap')) {
    t.textAutoResize = 'HEIGHT';
    t.resize(size(ir.w), t.height);
  } else {
    // строки уже разбиты браузером — Figma не переносит текст повторно
    t.textAutoResize = 'WIDTH_AND_HEIGHT';
    const w = t.width;
    if (!Number.isFinite(w) || w <= 0) throw new Error('не удалось измерить текст');
    if (ir.align === 'CENTER') dx = (ir.w - w) / 2;
    else if (ir.align === 'RIGHT') dx = ir.w - w;
  }
  place(t, ir, dx);
  t.setPluginData('l', String(ir.lines));
  t.setPluginData('a', ir.align);
  return t;
}

function buildShape(parent: FrameNode, ir: ShapeIR, ctx: BuildContext): SceneNode {
  const n = ir.kind === 'ellipse' ? figma.createEllipse() : figma.createRectangle();
  parent.appendChild(n);
  n.name = ir.name;
  n.resize(size(ir.w), size(ir.h));
  setFills(n, ir.fills, ctx, ir);
  if (ir.kind === 'rect') applyRadius(n as RectangleNode, ir.radius);
  optional(ctx, ir, 'Обводка', () => applyStroke(n as RectangleNode, ir.stroke, ir.kind === 'ellipse'));
  if (ir.effects?.length) optional(ctx, ir, 'Тени и размытие', () => { n.effects = effects(ir.effects); });
  applyCommon(n, ir, 'NORMAL');
  place(n, ir);
  return n;
}

function buildImage(parent: FrameNode, ir: ImageIR, ctx: BuildContext): SceneNode {
  const n = figma.createRectangle();
  parent.appendChild(n);
  n.name = ir.name;
  n.resize(size(ir.w), size(ir.h));
  const hash = ctx.images.get(ir.asset);
  const under = paints(ir.fills, ctx);
  if (hash) {
    const p: ImagePaint = { type: 'IMAGE', imageHash: hash, scaleMode: ir.scaleMode, ...(ir.scaleMode === 'CROP' ? { imageTransform: toFigmaTransform(ir.imageTransform ?? [1, 0, 0, 1, 0, 0]) } : {}) };
    n.fills = [...under, p];
  } else {
    n.fills = [...under, { type: 'SOLID', color: { r: 0.93, g: 0.93, b: 0.93 } }];
    ctx.warnings.push({ code: 'image-missing', message: 'Изображение не передано в Figma — вставлена заглушка', node: ir.src });
  }
  applyRadius(n, ir.radius);
  optional(ctx, ir, 'Обводка', () => applyStroke(n, ir.stroke));
  if (ir.effects?.length) optional(ctx, ir, 'Тени и размытие', () => { n.effects = effects(ir.effects); });
  applyCommon(n, ir, 'NORMAL');
  place(n, ir);
  if (ir.tags?.includes('raster')) n.setPluginData('raster', '1');
  return n;
}

function buildSvg(parent: FrameNode, ir: SvgIR, ctx: BuildContext): SceneNode {
  const markup = ctx.svgs.get(ir.asset);
  let n: FrameNode | null = null;
  if (markup) {
    try { n = figma.createNodeFromSvg(markup); }
    catch (e) { ctx.warnings.push({ code: 'svg-import', message: `SVG не импортирован Figma: ${String((e as Error).message ?? e).slice(0, 120)}`, node: ir.src }); }
  }
  if (!n) {
    const hash = ir.fallback ? ctx.images.get(ir.fallback) : undefined;
    const r = figma.createRectangle();
    parent.appendChild(r);
    r.name = ir.name + (hash ? ' (растр)' : ' (нет SVG)');
    r.resize(size(ir.w), size(ir.h));
    r.fills = hash ? [{ type: 'IMAGE', imageHash: hash, scaleMode: 'FILL' }] : [];
    if (!hash) { r.strokes = [{ type: 'SOLID', color: { r: 0.8, g: 0.5, b: 0.5 } }]; r.dashPattern = [3, 3]; }
    applyCommon(r, ir, 'NORMAL');
    place(r, ir);
    return r;
  }
  parent.appendChild(n);
  n.name = ir.name;
  if (Math.abs(n.width - ir.w) > 0.01 || Math.abs(n.height - ir.h) > 0.01) n.resizeWithoutConstraints(size(ir.w), size(ir.h));
  n.clipsContent = ir.clip;
  n.fills = [];
  if (ir.effects?.length) optional(ctx, ir, 'Тени и размытие', () => { n!.effects = effects(ir.effects); });
  applyCommon(n, ir, 'PASS_THROUGH');
  place(n, ir);
  return n;
}

async function buildFrame(parent: FrameNode, ir: FrameIR, ctx: BuildContext): Promise<FrameNode> {
  const n = figma.createFrame();
  parent.appendChild(n);
  n.name = ir.name;
  n.layoutMode = 'NONE';
  n.resizeWithoutConstraints(size(ir.w), size(ir.h));
  setFills(n, ir.fills, ctx, ir);
  n.clipsContent = ir.clip;
  applyRadius(n, ir.radius);
  optional(ctx, ir, 'Обводка', () => applyStroke(n, ir.stroke));
  if (ir.effects?.length) optional(ctx, ir, 'Тени и размытие', () => { n.effects = effects(ir.effects); });
  applyCommon(n, ir, 'PASS_THROUGH');
  place(n, ir);
  for (const c of ir.children) await buildNode(n, c, ctx);
  return n;
}

export async function buildNode(parent: FrameNode, ir: NodeIR, ctx: BuildContext): Promise<SceneNode | null> {
  ctx.checkCancel();
  let n: SceneNode;
  try {
    switch (ir.kind) {
      case 'frame': n = await buildFrame(parent, ir, ctx); break;
      case 'text': n = await buildText(parent, ir, ctx); break;
      case 'rect': case 'ellipse': n = buildShape(parent, ir, ctx); break;
      case 'image': n = buildImage(parent, ir, ctx); break;
      case 'svg': n = buildSvg(parent, ir, ctx); break;
      default: return null;
    }
  } catch (e) {
    const err = e as Error & { h2f?: boolean };
    if (err.h2f) throw err;
    const wrapped = new Error(`Страница ${ctx.route}: ошибка при создании слоя «${ir.name}» (${ir.kind}${ir.src ? ', ' + ir.src : ''}, id ${ir.id}): ${String(err.message ?? err).slice(0, 200)}`) as Error & { h2f?: boolean };
    wrapped.h2f = true;
    throw wrapped;
  }
  setExpect(n, ir);
  if (ir.scroll) n.setPluginData('scroll', ir.scroll);
  if (ir.tags?.length) n.setPluginData('tags', ir.tags.join(','));
  ctx.onNode?.(n, ir);
  if (++ctx.count % 150 === 0) await ctx.tick();
  return n;
}

export async function buildRoute(snapshot: RouteSnapshot, ctx: BuildContext, name: string, onRoot?: (root: FrameNode) => void): Promise<FrameNode> {
  const root = figma.createFrame();
  // корень регистрируется в транзакции сразу: при отмене/ошибке удалится и недостроенный фрейм
  onRoot?.(root);
  root.name = name;
  root.layoutMode = 'NONE';
  root.resizeWithoutConstraints(size(snapshot.width), size(snapshot.height));
  setFills(root, snapshot.background, ctx, {});
  root.clipsContent = true;
  for (const c of snapshot.children) await buildNode(root, c, ctx);
  return root;
}

/** Отпечаток поддерева — для распознавания ручных правок перед обновлением. */
export function fingerprint(root: SceneNode): string {
  let h1 = 0x811c9dc5, h2 = 0x13579bdf, count = 0;
  const mix = (s: string) => { for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822519); } };
  const walk = (n: SceneNode) => {
    count++;
    mix(n.type + '|' + n.name + '|' + (n.visible ? 1 : 0));
    // перемещение всего макета правкой содержимого не считается
    if ('x' in n) mix(n === root ? `${Math.round(n.width * 10)},${Math.round(n.height * 10)}` : `${Math.round(n.x * 10)},${Math.round(n.y * 10)},${Math.round(n.width * 10)},${Math.round(n.height * 10)}`);
    if (n.type === 'TEXT') mix(n.characters);
    if ('fills' in n && n.fills !== figma.mixed) { try { mix(JSON.stringify(n.fills).slice(0, 400)); } catch { /* */ } }
    if ('children' in n) for (const c of n.children) walk(c);
  };
  walk(root);
  return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16) + ':' + count;
}
