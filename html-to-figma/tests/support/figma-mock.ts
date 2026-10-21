/*
 * Модель Figma Plugin API для тестов (НЕ настоящая Figma).
 * Строго проверяет то, на чём ломаются плагины: конечность чисел, единичные оси
 * relativeTransform, opacity 0..1, допустимые paints/effects (spread только у
 * подходящих нод), загрузку шрифтов до изменения текста, корректность диапазонов
 * UTF-16, размеры изображений ≤ 4096, отсутствие undefined в сеттерах.
 * Ширина текста при WIDTH_AND_HEIGHT вычисляется функцией метрик (настраивается),
 * чтобы проверять устойчивость к расхождению метрик Figma и браузера.
 */
import crypto from 'node:crypto';
import vm from 'node:vm';

export class MockError extends Error {}
const fail = (m: string): never => { throw new MockError(m); };
const fin = (v: unknown, what: string) => { if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${what}: ожидалось конечное число, получено ${String(v)}`); return v as number; };
const unit = (v: unknown, what: string) => { fin(v, what); if ((v as number) < 0 || (v as number) > 1) fail(`${what}: вне 0..1 (${v})`); return v as number; };

const BLENDS = new Set(['PASS_THROUGH', 'NORMAL', 'DARKEN', 'MULTIPLY', 'LINEAR_BURN', 'COLOR_BURN', 'LIGHTEN', 'SCREEN', 'LINEAR_DODGE', 'COLOR_DODGE', 'OVERLAY', 'SOFT_LIGHT', 'HARD_LIGHT', 'DIFFERENCE', 'EXCLUSION', 'HUE', 'SATURATION', 'COLOR', 'LUMINOSITY']);

export interface MockOptions {
  fonts: Array<{ family: string; style: string }>;
  variable?: string[];
  /** ширина строки текста в Figma: по умолчанию 0.55em на символ */
  textWidth?: (line: Array<{ ch: string; size: number; font: { family: string; style: string }; letterSpacing: number }>) => number;
  clientStorage?: Record<string, unknown>;
  render?: (html: string, width: number, height: number) => Promise<Uint8Array>;
  /** искусственный сбой: бросить ошибку при создании N-го TEXT */
  failAtText?: number;
}

type Mat2 = [[number, number, number], [number, number, number]];

export function createFigmaMock(opts: MockOptions) {
  let serial = 0;
  const loaded = new Set<string>();
  const images = new Map<string, Uint8Array>();
  const all = new Map<string, MockNode>();
  const stats = { created: 0, texts: 0, setRange: 0, svg: 0, images: 0, removed: 0, apiErrors: 0 };
  const fontKey = (f: { family: string; style: string }) => f.family + '|' + f.style;
  const available = new Set(opts.fonts.map(fontKey));
  let textCount = 0;

  const checkPaints = (ps: unknown, what: string) => {
    if (!Array.isArray(ps)) fail(`${what}: ожидался массив`);
    for (const p of ps as Array<Record<string, unknown>>) {
      if (p.type === 'SOLID') {
        const c = p.color as Record<string, number>;
        if (!c || 'a' in c) fail(`${what}: SOLID.color без альфы`);
        unit(c.r, what + '.r'); unit(c.g, what + '.g'); unit(c.b, what + '.b');
        if (p.opacity !== undefined) unit(p.opacity, what + '.opacity');
      } else if (p.type === 'IMAGE') {
        if (typeof p.imageHash !== 'string' || !images.has(p.imageHash)) fail(`${what}: неизвестный imageHash`);
        if (!['FILL', 'FIT', 'CROP', 'TILE'].includes(p.scaleMode as string)) fail(`${what}: scaleMode`);
        if (p.imageTransform !== undefined) checkMat(p.imageTransform, what + '.imageTransform', false);
        if (p.scalingFactor !== undefined && !(fin(p.scalingFactor, what) > 0)) fail(`${what}: scalingFactor`);
        if (p.opacity !== undefined) unit(p.opacity, what + '.opacity');
      } else if (String(p.type).startsWith('GRADIENT_')) {
        checkMat(p.gradientTransform, what + '.gradientTransform', false);
        const st = p.gradientStops as Array<{ position: number; color: Record<string, number> }>;
        if (!Array.isArray(st) || st.length < 1) fail(`${what}: gradientStops`);
        for (const s of st) { unit(s.position, what + '.position'); unit(s.color.r, what); unit(s.color.g, what); unit(s.color.b, what); unit(s.color.a, what + '.a'); }
      } else fail(`${what}: неизвестный тип paint ${String(p.type)}`);
      if (p.blendMode !== undefined && !BLENDS.has(p.blendMode as string)) fail(`${what}: blendMode`);
    }
    return (ps as unknown[]).map((x) => JSON.parse(JSON.stringify(x)));
  };
  const checkMat = (m: unknown, what: string, unitAxes: boolean): Mat2 => {
    if (!Array.isArray(m) || m.length !== 2 || !m.every((r) => Array.isArray(r) && r.length === 3)) fail(`${what}: не матрица 2×3`);
    (m as number[][]).flat().forEach((v, i) => fin(v, `${what}[${i}]`));
    const t = m as Mat2;
    if (unitAxes && (Math.abs(Math.hypot(t[0][0], t[1][0]) - 1) > 1e-4 || Math.abs(Math.hypot(t[0][1], t[1][1]) - 1) > 1e-4)) fail(`${what}: оси не единичные (масштаб в relativeTransform запрещён)`);
    return [[t[0][0], t[0][1], t[0][2]], [t[1][0], t[1][1], t[1][2]]];
  };

  class MockNode {
    id = `${++serial}:1`;
    name = '';
    parent: MockNode | null = null;
    removed = false;
    children: MockNode[] = [];
    pluginData = new Map<string, string>();
    relaunch: Record<string, string> = {};
    _t: Mat2 = [[1, 0, 0], [0, 1, 0]];
    _w = 100; _h = 100;
    _opacity = 1; _visible = true; _blend = 'PASS_THROUGH';
    _fills: unknown[] = [];
    _strokes: unknown[] = [];
    _effects: unknown[] = [];
    props: Record<string, unknown> = {};
    constructor(public type: string) { all.set(this.id, this); stats.created++; }
    get opacity() { return this._opacity; }
    set opacity(v: number) { this._opacity = unit(v, `${this.type}.opacity`); }
    get visible() { return this._visible; }
    set visible(v: boolean) { if (typeof v !== 'boolean') fail('visible: boolean'); this._visible = v; }
    get blendMode() { return this._blend; }
    set blendMode(v: string) { if (!BLENDS.has(v)) fail('blendMode ' + v); this._blend = v; }
    get x() { return this._t[0][2]; }
    set x(v: number) { this._t[0][2] = fin(v, 'x'); }
    get y() { return this._t[1][2]; }
    set y(v: number) { this._t[1][2] = fin(v, 'y'); }
    get width() { return this._w; }
    get height() { return this._h; }
    get relativeTransform() { return this._t; }
    set relativeTransform(m: Mat2) { this._t = checkMat(m, `${this.type}.relativeTransform`, true); }
    resize(w: number, h: number) { fin(w, 'resize.w'); fin(h, 'resize.h'); if (w < 0.01 || h < 0.01) fail(`resize: размер меньше 0.01 (${w}×${h})`); this._w = w; this._h = h; }
    resizeWithoutConstraints(w: number, h: number) { this.resize(w, h); }
    get absoluteTransform(): Mat2 {
      const chain: MockNode[] = [];
      for (let n: MockNode | null = this; n && n.type !== 'PAGE'; n = n.parent) chain.unshift(n);
      let m: Mat2 = [[1, 0, 0], [0, 1, 0]];
      for (const n of chain) {
        const t = n._t;
        m = [[m[0][0] * t[0][0] + m[0][1] * t[1][0], m[0][0] * t[0][1] + m[0][1] * t[1][1], m[0][0] * t[0][2] + m[0][1] * t[1][2] + m[0][2]],
          [m[1][0] * t[0][0] + m[1][1] * t[1][0], m[1][0] * t[0][1] + m[1][1] * t[1][1], m[1][0] * t[0][2] + m[1][1] * t[1][2] + m[1][2]]];
      }
      return m;
    }
    get absoluteBoundingBox() {
      const m = this.absoluteTransform;
      const pts = [[0, 0], [this.width, 0], [this.width, this.height], [0, this.height]].map(([x, y]) => [m[0][0] * x + m[0][1] * y + m[0][2], m[1][0] * x + m[1][1] * y + m[1][2]]);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    }
    get fills() { return this._fills; }
    set fills(v: unknown[]) { this._fills = checkPaints(v, `${this.type}.fills`); }
    _check(v: unknown[]) { return checkPaints(v, `${this.type}.fills`); }
    get strokes() { return this._strokes; }
    set strokes(v: unknown[]) { this._strokes = checkPaints(v, `${this.type}.strokes`); }
    get effects() { return this._effects; }
    set effects(v: unknown[]) {
      if (!Array.isArray(v)) fail('effects: массив');
      for (const e of v as Array<Record<string, unknown>>) {
        if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
          const c = e.color as Record<string, number>;
          unit(c.r, 'effect.color'); unit(c.g, 'effect.color'); unit(c.b, 'effect.color'); unit(c.a, 'effect.color.a');
          fin((e.offset as Record<string, number>).x, 'offset.x'); fin((e.offset as Record<string, number>).y, 'offset.y');
          if (fin(e.radius, 'effect.radius') < 0) fail('effect.radius < 0');
          if (typeof e.visible !== 'boolean') fail('effect.visible');
          if (!BLENDS.has(e.blendMode as string)) fail('effect.blendMode');
          if (e.spread !== undefined && fin(e.spread, 'spread') !== 0) {
            const okType = this.type === 'RECTANGLE' || this.type === 'ELLIPSE' || (this.type === 'FRAME' && (this.props.clipsContent === true) && this._fills.some((f) => (f as { visible?: boolean; opacity?: number }).visible !== false));
            if (!okType) fail(`spread у ${this.type} допускается только при видимой заливке и clipsContent`);
          }
        } else if (e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR') {
          if (fin(e.radius, 'blur.radius') < 0) fail('blur.radius');
          if (e.blurType !== 'NORMAL' && e.blurType !== 'PROGRESSIVE') fail('blurType обязателен');
        } else fail('неизвестный эффект ' + String(e.type));
      }
      this._effects = JSON.parse(JSON.stringify(v));
    }
    appendChild(c: MockNode) {
      if (this.type !== 'FRAME' && this.type !== 'PAGE') fail(`appendChild у ${this.type}`);
      if (c.removed) fail('appendChild удалённой ноды');
      if (c.parent) c.parent.children.splice(c.parent.children.indexOf(c), 1);
      c.parent = this;
      this.children.push(c);
    }
    remove() {
      if (this.removed) fail('remove: нода уже удалена');
      const walk = (n: MockNode) => { n.removed = true; all.delete(n.id); stats.removed++; n.children.forEach(walk); };
      if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
      walk(this);
      this.parent = null;
    }
    setPluginData(k: string, v: string) { if (typeof v !== 'string') fail('pluginData: строка'); this.pluginData.set(k, v); }
    getPluginData(k: string) { return this.pluginData.get(k) ?? ''; }
    setRelaunchData(d: Record<string, string>) { this.relaunch = d; }
    findAll(cb?: (n: MockNode) => boolean): MockNode[] { const out: MockNode[] = []; const w = (n: MockNode) => { for (const c of n.children) { if (!cb || cb(c)) out.push(c); w(c); } }; w(this); return out; }
    async exportAsync(): Promise<Uint8Array> {
      if (!opts.render) fail('exportAsync недоступен в модели без рендера');
      return opts.render!(sceneToHtml(this as never, images), this.width, this.height);
    }
  }

  const defineProps = (cls: typeof MockNode, names: Record<string, (v: unknown) => unknown>) => {
    for (const [k, check] of Object.entries(names)) {
      Object.defineProperty(cls.prototype, k, {
        get(this: MockNode) { return this.props[k]; },
        set(this: MockNode, v: unknown) { if (v === undefined || v === null) fail(`${this.type}.${k}: undefined/null`); this.props[k] = check(v); },
        configurable: true,
      });
    }
  };
  const num = (k: string) => (v: unknown) => fin(v, k);
  const nonneg = (k: string) => (v: unknown) => { if (fin(v, k) < 0) fail(k + ' < 0'); return v; };
  const oneOf = (k: string, list: string[]) => (v: unknown) => { if (!list.includes(v as string)) fail(`${k}: ${String(v)}`); return v; };
  const bool = (k: string) => (v: unknown) => { if (typeof v !== 'boolean') fail(k + ': boolean'); return v; };
  const geom = { strokeWeight: nonneg('strokeWeight'), strokeTopWeight: nonneg('strokeTopWeight'), strokeRightWeight: nonneg('strokeRightWeight'), strokeBottomWeight: nonneg('strokeBottomWeight'), strokeLeftWeight: nonneg('strokeLeftWeight'), strokeAlign: oneOf('strokeAlign', ['INSIDE', 'OUTSIDE', 'CENTER']), dashPattern: (v: unknown) => { if (!Array.isArray(v)) fail('dashPattern'); (v as number[]).forEach((x) => nonneg('dash')(x)); return v; }, topLeftRadius: nonneg('r'), topRightRadius: nonneg('r'), bottomRightRadius: nonneg('r'), bottomLeftRadius: nonneg('r') };

  class FrameMock extends MockNode { constructor() { super('FRAME'); this._fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]; this.props.clipsContent = true; this.props.layoutMode = 'NONE'; this.props.numberOfFixedChildren = 0; this.props.overflowDirection = 'NONE'; } }
  defineProps(FrameMock, { ...geom, clipsContent: bool('clipsContent'), layoutMode: oneOf('layoutMode', ['NONE', 'HORIZONTAL', 'VERTICAL', 'GRID']), overflowDirection: oneOf('overflowDirection', ['NONE', 'HORIZONTAL', 'VERTICAL', 'BOTH']),
    numberOfFixedChildren: (v: unknown) => { fin(v, 'numberOfFixedChildren'); return v; } });
  class RectMock extends MockNode { constructor(t = 'RECTANGLE') { super(t); this._fills = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85 } }]; this._blend = 'NORMAL'; } }
  defineProps(RectMock, geom);

  class TextMock extends MockNode {
    _chars = '';
    _font = { family: 'Inter', style: 'Regular' } as { family: string; style: string; variationSettings?: Record<string, number> };
    _size = 12;
    _lh: { unit: string; value?: number } = { unit: 'AUTO' };
    _ls = { unit: 'PIXELS', value: 0 };
    per: Array<{ font: { family: string; style: string }; size: number; ls: number; fills?: unknown; dec?: string; link?: unknown }> = [];
    _auto = 'WIDTH_AND_HEIGHT';
    constructor() {
      super('TEXT');
      this._fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
      this._blend = 'PASS_THROUGH';
      textCount++;
      if (opts.failAtText && textCount === opts.failAtText) fail('Искусственная ошибка теста на TEXT №' + textCount);
    }
    get fills() { return this._fills; }
    set fills(v: unknown[]) { this._fills = (MockNode.prototype as unknown as { _check: (v: unknown[]) => unknown[] })._check.call(this, v); this.per.forEach((p) => { delete p.fills; }); }
    private needFont(f: { family: string; style: string }, what: string) { if (!loaded.has(fontKey(f))) fail(`${what}: шрифт ${f.family} ${f.style} не загружен (loadFontAsync)`); }
    get fontName() { return this._font; }
    set fontName(f: { family: string; style: string }) { if (!f || typeof f.family !== 'string' || typeof f.style !== 'string') fail('fontName'); this.needFont(f, 'fontName'); this._font = { ...f }; this.per.forEach((p) => (p.font = { ...f })); }
    get characters() { return this._chars; }
    set characters(s: string) {
      if (typeof s !== 'string') fail('characters: строка');
      this.needFont(this._font, 'characters');
      this._chars = s;
      this.per = Array.from({ length: s.length }, () => ({ font: { ...this._font }, size: this._size, ls: this._ls.value }));
      this.relayout();
    }
    get fontSize() { return this._size; }
    set fontSize(v: number) { this.needFont(this._font, 'fontSize'); if (fin(v, 'fontSize') < 1) fail('fontSize < 1'); this._size = v; this.per.forEach((p) => (p.size = v)); this.relayout(); }
    get lineHeight() { return this._lh; }
    set lineHeight(v: { unit: string; value?: number }) { if (v.unit === 'PIXELS') fin(v.value, 'lineHeight.value'); else if (v.unit !== 'AUTO' && v.unit !== 'PERCENT') fail('lineHeight.unit'); this._lh = { ...v }; this.relayout(); }
    get letterSpacing() { return this._ls; }
    set letterSpacing(v: { unit: string; value: number }) { fin(v.value, 'letterSpacing'); this._ls = { ...v }; this.per.forEach((p) => (p.ls = v.value)); this.relayout(); }
    get textAutoResize() { return this._auto; }
    set textAutoResize(v: string) { oneOf('textAutoResize', ['NONE', 'WIDTH_AND_HEIGHT', 'HEIGHT', 'TRUNCATE'])(v); this._auto = v; this.relayout(); }
    private range(s: number, e: number, what: string) {
      if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e > this._chars.length || s >= e) fail(`${what}: неверный диапазон ${s}..${e} (длина ${this._chars.length})`);
      stats.setRange++;
    }
    setRangeFontName(s: number, e: number, f: { family: string; style: string }) { this.range(s, e, 'setRangeFontName'); this.needFont(f, 'setRangeFontName'); for (let i = s; i < e; i++) this.per[i].font = { ...f }; this.relayout(); }
    setRangeFontSize(s: number, e: number, v: number) { this.range(s, e, 'setRangeFontSize'); fin(v, 'size'); for (let i = s; i < e; i++) this.per[i].size = v; this.relayout(); }
    setRangeLetterSpacing(s: number, e: number, v: { value: number }) { this.range(s, e, 'setRangeLetterSpacing'); fin(v.value, 'ls'); for (let i = s; i < e; i++) this.per[i].ls = v.value; this.relayout(); }
    setRangeFills(s: number, e: number, v: unknown[]) { this.range(s, e, 'setRangeFills'); const p = checkPaints(v, 'setRangeFills'); for (let i = s; i < e; i++) this.per[i].fills = p; }
    setRangeTextDecoration(s: number, e: number, v: string) { this.range(s, e, 'setRangeTextDecoration'); oneOf('decoration', ['NONE', 'UNDERLINE', 'STRIKETHROUGH'])(v); for (let i = s; i < e; i++) this.per[i].dec = v; }
    setRangeTextDecorationStyle(s: number, e: number, v: string) { this.range(s, e, 'decStyle'); oneOf('decorationStyle', ['SOLID', 'WAVY', 'DOTTED'])(v); }
    setRangeTextDecorationColor(s: number, e: number, v: { value: unknown }) { this.range(s, e, 'decColor'); if (v.value !== 'AUTO') checkPaints([v.value], 'decColor'); }
    setRangeTextDecorationThickness(s: number, e: number, v: { unit: string; value?: number }) { this.range(s, e, 'decThick'); if (v.unit !== 'AUTO') fin(v.value, 'thickness'); }
    setRangeHyperlink(s: number, e: number, v: { type: string; value: string } | null) { this.range(s, e, 'hyperlink'); for (let i = s; i < e; i++) this.per[i].link = v; }
    getStyledTextSegments() { return []; }
    relayout() {
      if (this._auto === 'NONE' || this._auto === 'TRUNCATE') return;
      const lines = this._chars.split('\n');
      const lh = this._lh.unit === 'PIXELS' ? this._lh.value! : this._size * 1.2;
      let pos = 0, maxW = 0;
      for (const line of lines) {
        const items = Array.from({ length: line.length }, (_, i) => ({ ch: line[i], size: this.per[pos + i]?.size ?? this._size, font: this.per[pos + i]?.font ?? this._font, letterSpacing: this.per[pos + i]?.ls ?? 0 }));
        const w = opts.textWidth ? opts.textWidth(items) : items.reduce((a, it) => a + it.size * 0.55 + it.letterSpacing, 0);
        maxW = Math.max(maxW, w);
        pos += line.length + 1;
      }
      if (this._auto === 'WIDTH_AND_HEIGHT') this._w = Math.max(0.01, maxW);
      this._h = Math.max(0.01, lines.length * lh);
    }
  }
  defineProps(TextMock, { ...geom, textAlignHorizontal: oneOf('textAlignHorizontal', ['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED']), textAlignVertical: oneOf('textAlignVertical', ['TOP', 'CENTER', 'BOTTOM']),
    paragraphSpacing: nonneg('paragraphSpacing'), paragraphIndent: nonneg('paragraphIndent'), autoRename: bool('autoRename'), textTruncation: oneOf('textTruncation', ['DISABLED', 'ENDING']),
    maxLines: (v: unknown) => { if (!(Number.isInteger(v) && (v as number) >= 1)) fail('maxLines'); return v; } });

  const page = new MockNode('PAGE');
  page.name = 'Page 1';
  let selection: MockNode[] = [];
  Object.defineProperty(page, 'selection', { get: () => selection, set: (v: MockNode[]) => { selection = v; } });

  const created = <T extends MockNode>(n: T): T => { page.appendChild(n); return n; };
  const uiInbox: Array<(m: unknown) => void> = [];
  const outbox: unknown[] = [];
  let onmessage: ((m: unknown) => void) | undefined;
  const storage: Record<string, unknown> = { ...(opts.clientStorage ?? {}) };

  const figma = {
    editorType: 'figma',
    mixed: Symbol('mixed'),
    get currentPage() { return page; },
    root: { setRelaunchData() { /* */ }, children: [page] },
    viewport: { center: { x: 0, y: 0 }, zoom: 1, bounds: { x: 0, y: 0, width: 1600, height: 1000 }, scrollAndZoomIntoView(n: unknown[]) { if (!Array.isArray(n)) fail('scrollAndZoomIntoView'); } },
    showUI(_html: string, o: { width: number; height: number }) { if (!o.width) fail('showUI'); },
    ui: {
      postMessage(m: unknown) { outbox.push(m); for (const l of uiInbox) l(structuredClone(m)); },
      set onmessage(f: (m: unknown) => void) { onmessage = f; },
      get onmessage() { return onmessage!; },
      resize() { /* */ },
    },
    notify(_t: string) { return { cancel() { /* */ } }; },
    clientStorage: { getAsync: async (k: string) => storage[k], setAsync: async (k: string, v: unknown) => { storage[k] = v; } },
    listAvailableFontsAsync: async () => opts.fonts.map((f) => ({ fontName: { family: f.family, style: f.style } })),
    loadFontAsync: async (f: { family: string; style?: string }) => {
      if (!f.style) { for (const x of opts.fonts) if (x.family === f.family) loaded.add(fontKey(x)); return; }
      if (!available.has(fontKey(f as { family: string; style: string }))) throw new Error(`The font "${f.family} ${f.style}" could not be loaded`);
      loaded.add(fontKey(f as { family: string; style: string }));
    },
    getFontFamilyVariationAxes: (fam: string) => (opts.variable?.includes(fam) ? ['wght'] : null),
    createFrame: () => created(new FrameMock()),
    createRectangle: () => created(new RectMock()),
    createEllipse: () => created(new RectMock('ELLIPSE')),
    createText: () => { stats.texts++; return created(new TextMock()); },
    createImage: (bytes: Uint8Array) => {
      if (!(bytes instanceof Uint8Array)) fail('createImage: Uint8Array');
      const b = Buffer.from(bytes);
      let w = 0, h = 0;
      if (b[0] === 0x89 && b[1] === 0x50) { w = b.readUInt32BE(16); h = b.readUInt32BE(20); }
      else if (b[0] === 0xff && b[1] === 0xd8) { w = 1; h = 1; }
      else if (b[0] === 0x47 && b[1] === 0x49) { w = b.readUInt16LE(6); h = b.readUInt16LE(8); }
      else throw new Error('Image type is unsupported');
      if (w > 4096 || h > 4096) throw new Error('Image is too large');
      const hash = crypto.createHash('sha1').update(b).digest('hex');
      images.set(hash, new Uint8Array(b));
      stats.images++;
      return { hash };
    },
    createNodeFromSvg: (svg: string) => {
      if (typeof svg !== 'string' || !/^\s*<svg[\s>]/.test(svg)) throw new Error('Invalid SVG');
      const w = parseFloat(/\swidth="([\d.]+)/.exec(svg)?.[1] ?? '100'), h = parseFloat(/\sheight="([\d.]+)/.exec(svg)?.[1] ?? '100');
      const f = created(new FrameMock());
      f.resize(Math.max(0.01, w), Math.max(0.01, h));
      f.props.svgSource = svg;
      const v = new RectMock('VECTOR');
      f.appendChild(v);
      v.resize(Math.max(0.01, w), Math.max(0.01, h));
      stats.svg++;
      return f;
    },
    getNodeByIdAsync: async (id: string) => all.get(id) ?? null,
    closePlugin() { /* */ },
  };

  /** Запускает собранный plugin/dist/code.js в изолированном контексте без браузерных API. */
  function run(code: string) {
    const ctx = vm.createContext({
      figma, __html__: '<html></html>', console, Promise, Map, Set, WeakMap, Array, Object, Math, JSON, Date, RegExp, Error, TypeError, Number, String, Boolean, Symbol, Uint8Array,
      ArrayBuffer, DataView, Float32Array, Int32Array, structuredClone, parseFloat, parseInt, isFinite, isNaN, encodeURIComponent, decodeURIComponent, Infinity, NaN, undefined,
    });
    vm.runInContext(code, ctx, { filename: 'code.js' });
  }

  return {
    figma, page, stats, images, run, storage,
    setTextWidth: (f: MockOptions['textWidth']) => { opts.textWidth = f; },
    /** UI → sandbox */
    send: async (m: unknown) => { if (!onmessage) fail('ui.onmessage не установлен'); await onmessage!(structuredClone(m)); },
    onUi: (f: (m: unknown) => void) => uiInbox.push(f),
    outbox,
    roots: () => page.children.filter((n) => n.type === 'FRAME' && n.getPluginData('h2f')),
    all,
  };
}

/** HTML-представление сцены модели (для экспорта в PNG и визуального сравнения). */
export function sceneToHtml(root: { width: number; height: number; children: unknown[] } & Record<string, unknown>, images: Map<string, Uint8Array>): string {
  const rgba = (c: { r: number; g: number; b: number }, a: number) => `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let gid = 0;
  const inv = (m: number[][]) => { const [a, c, e] = m[0], [b, d, f] = m[1]; const det = a * d - b * c; return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]; };
  const paint = (p: Record<string, any>, w: number, h: number): string => {
    const op = p.opacity ?? 1;
    if (p.visible === false) return '';
    if (p.type === 'SOLID') return `<div style="position:absolute;inset:0;background:${rgba(p.color, op)}"></div>`;
    if (p.type === 'IMAGE') {
      const b = images.get(p.imageHash);
      const url = b ? `data:image/png;base64,${Buffer.from(b).toString('base64')}` : '';
      if (p.scaleMode === 'TILE') { const iw = Buffer.from(b!).readUInt32BE(16), ih = Buffer.from(b!).readUInt32BE(20); const k = p.scalingFactor ?? 1; return `<div style="position:absolute;inset:0;opacity:${op};background:url(${url}) 0 0/${iw * k}px ${ih * k}px repeat"></div>`; }
      if (p.scaleMode === 'CROP') { const i = inv(p.imageTransform ?? [[1, 0, 0], [0, 1, 0]]); return `<div style="position:absolute;inset:0;overflow:hidden;opacity:${op}"><img src="${url}" style="position:absolute;left:${i[4] * w}px;top:${i[5] * h}px;width:${i[0] * w}px;height:${i[3] * h}px;max-width:none"></div>`; }
      return `<div style="position:absolute;inset:0;opacity:${op};background:url(${url}) center/${p.scaleMode === 'FIT' ? 'contain' : 'cover'} no-repeat"></div>`;
    }
    const i = inv(p.gradientTransform);
    const id = 'g' + gid++;
    const stops = p.gradientStops.map((s: any) => `<stop offset="${s.position}" stop-color="${rgba(s.color, 1)}" stop-opacity="${s.color.a}"/>`).join('');
    const def = p.type === 'GRADIENT_LINEAR' ? `<linearGradient id="${id}" gradientUnits="objectBoundingBox" x1="0" y1="0.5" x2="1" y2="0.5" gradientTransform="matrix(${i.join(',')})">${stops}</linearGradient>` : `<radialGradient id="${id}" gradientUnits="objectBoundingBox" cx="0.5" cy="0.5" r="0.5" gradientTransform="matrix(${i.join(',')})">${stops}</radialGradient>`;
    return `<svg style="position:absolute;left:0;top:0;opacity:${op}" width="${w}" height="${h}"><defs>${def}</defs><rect width="${w}" height="${h}" fill="url(#${id})"/></svg>`;
  };
  const node = (n: any): string => {
    if (n.visible === false) return '';
    const t = n._t;
    const tf = `matrix(${t[0][0]},${t[1][0]},${t[0][1]},${t[1][1]},${t[0][2]},${t[1][2]})`;
    const r = n.props.topLeftRadius !== undefined ? `border-radius:${n.props.topLeftRadius}px ${n.props.topRightRadius}px ${n.props.bottomRightRadius}px ${n.props.bottomLeftRadius}px;` : n.type === 'ELLIPSE' ? 'border-radius:50%;' : '';
    const shadows = (n._effects as any[]).filter((e) => e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW').reverse().map((e) => `${e.type === 'INNER_SHADOW' ? 'inset ' : ''}${e.offset.x}px ${e.offset.y}px ${e.radius}px ${n.type === 'TEXT' ? '' : (e.spread ?? 0) + 'px '}${rgba(e.color, e.color.a)}`);
    const blur = (n._effects as any[]).find((e) => e.type === 'LAYER_BLUR');
    const bblur = (n._effects as any[]).find((e) => e.type === 'BACKGROUND_BLUR');
    const fx = (shadows.length ? (n.type === 'TEXT' ? `text-shadow:${shadows.join(',')};` : `box-shadow:${shadows.join(',')};`) : '') + (blur ? `filter:blur(${blur.radius / 2}px);` : '') + (bblur ? `backdrop-filter:blur(${bblur.radius / 2}px);` : '');
    const base = `position:absolute;left:0;top:0;transform-origin:0 0;transform:${tf};width:${n.width}px;height:${n.height}px;opacity:${n.opacity};${n.blendMode && !['PASS_THROUGH', 'NORMAL'].includes(n.blendMode) ? 'mix-blend-mode:' + n.blendMode.toLowerCase().replace(/_/g, '-') + ';' : ''}${fx}`;
    const stroke = (n._strokes as any[])[0];
    const sw = [n.props.strokeTopWeight ?? n.props.strokeWeight ?? 0, n.props.strokeRightWeight ?? n.props.strokeWeight ?? 0, n.props.strokeBottomWeight ?? n.props.strokeWeight ?? 0, n.props.strokeLeftWeight ?? n.props.strokeWeight ?? 0];
    const strokeDiv = stroke && n.type !== 'TEXT' ? (n.props.strokeAlign === 'OUTSIDE'
      ? `<div style="position:absolute;left:${-sw[3]}px;top:${-sw[0]}px;right:${-sw[1]}px;bottom:${-sw[2]}px;border-style:${n.props.dashPattern ? 'dashed' : 'solid'};border-color:${rgba(stroke.color, stroke.opacity ?? 1)};border-width:${sw.join('px ')}px;${r}"></div>`
      : `<div style="position:absolute;inset:0;box-sizing:border-box;border-style:${n.props.dashPattern ? 'dashed' : 'solid'};border-color:${rgba(stroke.color, stroke.opacity ?? 1)};border-width:${sw.join('px ')}px;${r}"></div>`) : '';
    if (n.type === 'TEXT') {
      const lh = n._lh.unit === 'PIXELS' ? n._lh.value : n._size * 1.2;
      let html = '', pos = 0;
      const lines = n._chars.split('\n');
      const maxL = n.props.textTruncation === 'ENDING' ? (n.props.maxLines ?? Math.max(1, Math.round(n.height / lh))) : Infinity;
      lines.forEach((line: string, li: number) => {
        if (li >= maxL) { pos += line.length + 1; return; }
        let seg = '';
        for (let i = 0; i < line.length; i++) {
          const p = n.per[pos + i];
          const f0 = (p.fills ?? n._fills)[0];
          const fill = f0 && f0.color ? f0 : f0 && f0.gradientStops ? { color: f0.gradientStops[0].color, opacity: 1 } : null;
          const st = /italic/i.test(p.font.style), wt = /black|heavy/i.test(p.font.style) ? 900 : /extrabold/i.test(p.font.style) ? 800 : /semibold/i.test(p.font.style) ? 600 : /bold/i.test(p.font.style) ? 700 : /medium/i.test(p.font.style) ? 500 : /light/i.test(p.font.style) ? 300 : 400;
          seg += `<span style="font-family:'${p.font.family}';font-weight:${(p.font as any).variationSettings?.wght ?? wt};font-style:${st ? 'italic' : 'normal'};font-size:${p.size}px;letter-spacing:${p.ls}px;color:${fill ? rgba(fill.color, fill.opacity ?? 1) : '#000'};text-decoration:${p.dec === 'UNDERLINE' ? 'underline' : p.dec === 'STRIKETHROUGH' ? 'line-through' : 'none'}">${esc(line[i])}</span>`;
        }
        if (li === maxL - 1 && lines.length > maxL) seg += '…';
        const f0 = n.per[pos] ?? { font: n._font, size: n._size };
        html += `<div style="height:${lh}px;line-height:${lh}px;font-family:'${f0.font.family}';font-size:${f0.size}px;white-space:pre;text-align:${(n.props.textAlignHorizontal ?? 'LEFT').toLowerCase()}">${seg || '&#8203;'}</div>`;
        pos += line.length + 1;
      });
      return `<div style="${base}overflow:${n.props.textTruncation === 'ENDING' ? 'hidden' : 'visible'}">${html}</div>`;
    }
    if (n.props.svgSource) return `<div style="${base}${n.props.clipsContent ? 'overflow:hidden;' : ''}"><img src="data:image/svg+xml;base64,${Buffer.from(n.props.svgSource).toString('base64')}" style="position:absolute;left:0;top:0;width:${n.width}px;height:${n.height}px"></div>`;
    const fills = (n._fills as any[]).map((p) => paint(p, n.width, n.height)).join('');
    const kids = (n.children as any[]).map(node).join('');
    return `<div style="${base}${r}${n.props.clipsContent ? 'overflow:hidden;' : ''}"><div style="position:absolute;inset:0;${r}overflow:hidden">${fills}</div>${kids}${strokeDiv}</div>`;
  };
  // корень рисуется в начале координат (его положение на холсте не важно для экспорта)
  const rootClone = Object.create(root);
  rootClone._t = [[1, 0, 0], [0, 1, 0]];
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style><!--FONTS--></head><body>${node(rootClone)}</body></html>`;
}
