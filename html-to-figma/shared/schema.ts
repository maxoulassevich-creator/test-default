/*
 * Версионированная промежуточная модель (IR) между обработчиком и плагином.
 *
 * Системы координат (см. README, раздел «Геометрия»):
 *  - viewport: координаты окна браузера (getBoundingClientRect при текущей прокрутке);
 *  - document: viewport + scroll; захват выполняется при scrollX = scrollY = 0;
 *  - layout (untransformed): рамка элемента в document-координатах при временно
 *    нейтрализованных CSS transform (contain-блоки сохраняются через will-change);
 *  - local: координаты ноды в системе её родителя Figma. Каждая нода IR хранит
 *    матрицу `m`, которая переводит её собственные координаты (0..w, 0..h) в
 *    координаты родителя. Для обычной ноды это чистый перенос [1,0,0,1,x,y].
 * Плагин НИКОГДА не складывает координаты повторно: он передаёт `m` в
 * relativeTransform как есть (оси m всегда единичные — масштаб уже перенесён в размеры).
 */

export const SCHEMA_VERSION = '1.0';
export const PROTOCOL_VERSION = 1;
export const GENERATOR = 'html-to-figma-importer';
export const GENERATOR_VERSION = '1.0.0';
export const PLUGIN_DATA_KEY = 'h2f';

/** CSS-матрица 2D: x' = a*x + c*y + e; y' = b*x + d*y + f */
export type Mat = [number, number, number, number, number, number];

export interface RGB { r: number; g: number; b: number }
export interface RGBA extends RGB { a: number }

export type BlendModeIR =
  | 'NORMAL' | 'PASS_THROUGH' | 'MULTIPLY' | 'SCREEN' | 'OVERLAY' | 'DARKEN' | 'LIGHTEN'
  | 'COLOR_DODGE' | 'COLOR_BURN' | 'HARD_LIGHT' | 'SOFT_LIGHT' | 'DIFFERENCE' | 'EXCLUSION'
  | 'HUE' | 'SATURATION' | 'COLOR' | 'LUMINOSITY';

export interface GradientStopIR { position: number; color: RGBA }

export type PaintIR =
  | { type: 'SOLID'; color: RGB; opacity: number; blend?: BlendModeIR }
  | { type: 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'GRADIENT_ANGULAR'; stops: GradientStopIR[]; transform: Mat; opacity: number; blend?: BlendModeIR }
  | { type: 'IMAGE'; asset: string; scaleMode: 'CROP' | 'TILE' | 'FILL' | 'FIT'; imageTransform?: Mat; scalingFactor?: number; opacity: number; blend?: BlendModeIR };

export interface ShadowIR { color: RGBA; x: number; y: number; blur: number; spread: number }
export type EffectIR =
  | ({ type: 'DROP_SHADOW' } & ShadowIR)
  | ({ type: 'INNER_SHADOW' } & ShadowIR)
  | { type: 'LAYER_BLUR'; radius: number }
  | { type: 'BACKGROUND_BLUR'; radius: number };

export interface StrokeIR {
  color: RGB;
  opacity: number;
  /** top, right, bottom, left */
  weights: [number, number, number, number];
  align: 'INSIDE' | 'CENTER' | 'OUTSIDE';
  dash?: number[];
}

export interface BaseIR {
  id: string;
  name: string;
  /** Короткое описание исходного элемента (tag#id.class) для диагностики. */
  src?: string;
  m: Mat;
  w: number;
  h: number;
  /** Отсутствует = 1. Явный 0 сохраняется. */
  opacity?: number;
  blend?: BlendModeIR;
  visible?: boolean;
  effects?: EffectIR[];
  /** Для режима просмотра с прокруткой. */
  scroll?: 'fixed' | 'sticky';
  tags?: string[];
  /** Ожидаемый осевой прямоугольник в координатах страницы (для проверки геометрии в Figma). */
  expect?: [number, number, number, number];
  /** Для текста: опорная точка выравнивания (лево/центр/право верхней строки) в координатах страницы. */
  anchor?: [number, number];
}

export interface FrameIR extends BaseIR {
  kind: 'frame';
  fills: PaintIR[];
  stroke?: StrokeIR;
  /** tl, tr, br, bl — уже нормализованы по правилам CSS. */
  radius?: [number, number, number, number];
  clip: boolean;
  children: NodeIR[];
}

export interface ShapeIR extends BaseIR {
  kind: 'rect' | 'ellipse';
  fills: PaintIR[];
  stroke?: StrokeIR;
  radius?: [number, number, number, number];
}

export interface TextRunIR {
  /** Позиции в UTF-16 code units строки `text` (как требует диапазонный API Figma). */
  start: number;
  end: number;
  font: string; // ключ FontRequirement
  size: number;
  color: RGBA;
  letterSpacing: number;
  decoration?: 'UNDERLINE' | 'STRIKETHROUGH';
  decorationColor?: RGBA;
  decorationStyle?: 'SOLID' | 'DOTTED' | 'WAVY';
  decorationThickness?: number;
  link?: string;
}

export interface TextIR extends BaseIR {
  kind: 'text';
  /** Строки, разделённые \n, ровно как браузер разбил текст. */
  text: string;
  runs: TextRunIR[];
  lineHeight: number;
  align: 'LEFT' | 'CENTER' | 'RIGHT';
  /** Количество строк в исходнике (для проверки повторного переноса). */
  lines: number;
  /** Обрезка с многоточием: число видимых строк. */
  truncate?: number;
  textStroke?: { color: RGBA; width: number };
  /** Заливка текста целиком (например, градиент background-clip:text) — поверх цветов runs. */
  fills?: PaintIR[];
}

export interface ImageIR extends BaseIR {
  kind: 'image';
  asset: string;
  scaleMode: 'CROP' | 'FILL' | 'FIT' | 'TILE';
  imageTransform?: Mat;
  radius?: [number, number, number, number];
  stroke?: StrokeIR;
  fills?: PaintIR[]; // фон под изображением
}

export interface SvgIR extends BaseIR {
  kind: 'svg';
  asset: string; // ассет типа svg (текст разметки)
  fallback?: string; // растровый ассет на случай ошибки createNodeFromSvg
  fallbackBox?: [number, number, number, number];
  clip: boolean;
}

export type NodeIR = FrameIR | ShapeIR | TextIR | ImageIR | SvgIR;

export interface Diagnostic {
  level: 'info' | 'warn' | 'error';
  code: string;
  message: string;
  route?: string;
  node?: string;
  count?: number;
}

export interface FontRequirement {
  key: string; // family|weight|i/n
  family: string;
  weight: number;
  italic: boolean;
  /** Имя семейства из файла шрифта (CDP), если отличается от CSS. */
  fileFamily?: string;
  postScriptName?: string;
  source: 'webfont' | 'system' | 'generic';
  variable?: boolean;
  synthetic?: string[];
  chars: number;
  sample: string;
  routes: string[];
}

export interface AssetInfo {
  id: string; // sha256-префикс содержимого
  kind: 'image' | 'svg';
  mime: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  source: string; // url / inline-svg / raster:<reason>
  note?: string;
}

export interface HoverCandidate {
  index: number;
  selector: string;
  label: string;
  score: number;
  box: [number, number, number, number];
  /** число изменившихся пар «элемент × свойство» и сами свойства */
  changes?: number;
  props?: string[];
}

export interface HoverInfo {
  active: boolean;
  selector?: string;
  label?: string;
  reason: string;
  hit?: string;
  point?: [number, number];
  changed?: number;
  candidates: HoverCandidate[];
  chosenIndex?: number;
}

export interface RouteSnapshot {
  schemaVersion: string;
  routeKey: string;
  url: string;
  title: string;
  label: string;
  viewport: { width: number; height: number };
  width: number;
  height: number;
  background: PaintIR[];
  children: NodeIR[];
  /** Сколько последних детей корня — fixed-элементы (шапка и т. п.). */
  fixedCount: number;
  hover: HoverInfo;
  stats: Record<string, number>;
  diagnostics: Diagnostic[];
  fonts: string[];
  assets: string[];
  capturedAt: string;
}

export interface RouteInfo {
  key: string;
  url: string; // относительно корня проекта: path?query#hash
  label: string;
  title: string;
  group: string;
  depth: number;
  source: 'entry' | 'file' | 'link' | 'code' | 'manual';
  status: 'ok' | 'duplicate' | 'anchor' | 'excluded' | 'error' | 'limit';
  reason?: string;
  duplicateOf?: string;
  finalUrl?: string;
  thumbnail?: boolean;
  height?: number;
  captured?: boolean;
  hoverCandidates?: number;
  /** false — найдена обходом вне указателя страниц профиля: показывается, но не отмечается по умолчанию */
  suggested?: boolean;
}

export interface CaptureProfile {
  viewportWidth: number;
  viewportHeight: number;
  colorScheme: 'light' | 'dark' | 'no-preference';
  reducedMotion: 'reduce' | 'no-preference';
  locale: string;
  storage: Record<string, string>;
  exclude: string[];
  hover: boolean;
  cursor: boolean;
  blockExternal: boolean;
  spaFallback: boolean;
  injectCss: string[];
  adapterId?: string;
  hoverPrefer?: Record<string, string>;
  svgMode: 'auto' | 'vector' | 'raster';
  rasterScale: number;
}

export const DEFAULT_PROFILE: CaptureProfile = {
  viewportWidth: 1440,
  viewportHeight: 1000,
  colorScheme: 'light',
  reducedMotion: 'no-preference',
  locale: 'ru-RU',
  storage: {},
  exclude: [],
  hover: true,
  cursor: true,
  blockExternal: false,
  spaFallback: false,
  injectCss: [],
  svgMode: 'auto',
  rasterScale: 2,
};

export interface ImportDocument {
  schemaVersion: string;
  generator: { name: string; version: string };
  projectKey: string;
  sourceHash: string;
  sourceName: string;
  entry: string;
  createdAt: string;
  profile: CaptureProfile;
  routes: RouteInfo[];
  fonts: FontRequirement[];
  assets: AssetInfo[];
  diagnostics: Diagnostic[];
}

/** Данные, которые плагин хранит в корневом фрейме (setPluginData). */
export interface RootRegistry {
  v: number;
  project: string;
  set: string;
  route: string;
  label: string;
  source: string;
  createdAt: string;
  fp: string;
  slot: [number, number];
  columns: number;
  fixed: number;
  height: number;
  width: number;
  viewportHeight: number;
  mode: 'design' | 'viewport';
}

export function fontKey(family: string, weight: number, italic: boolean): string {
  return `${family}|${weight}|${italic ? 'i' : 'n'}`;
}
