/*
 * Разбор вычисленных цветов CSS Color 4: rgb()/rgba(), hsl(), hwb(), hex, именованные,
 * color(srgb|srgb-linear|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz|xyz-d50|xyz-d65),
 * lab(), lch(), oklab(), oklch(). Результат — sRGB 0..1 с отдельной альфой.
 * Нераспознанный цвет возвращает null (а НЕ чёрный), чтобы вызывающий код
 * мог явно сообщить об этом в диагностике.
 */
import type { RGBA } from './schema';

type V3 = [number, number, number];
type M3 = [V3, V3, V3];

const mul = (m: M3, v: V3): V3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

const XYZ_TO_LIN_SRGB: M3 = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
const P3_TO_XYZ: M3 = [
  [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0, 0.04511338185890264, 1.043944368900976],
];
const A98_TO_XYZ: M3 = [
  [0.5766690429101305, 0.1855582379065463, 0.1882286462349947],
  [0.29734497525053605, 0.6273635662554661, 0.07529145849399788],
  [0.02703136138641234, 0.07068885253582723, 0.9913375368376388],
];
const PROPHOTO_TO_XYZ_D50: M3 = [
  [0.7977604896723027, 0.13518583717574031, 0.0313493495815248],
  [0.2880711282292934, 0.7118432178101014, 0.00008565396060525902],
  [0, 0, 0.8251046025104601],
];
const REC2020_TO_XYZ: M3 = [
  [0.6369580483012914, 0.14461690358620832, 0.1688809751641721],
  [0.2627002120112671, 0.6779980715188708, 0.05930171646986196],
  [0, 0.028072693049087428, 1.060985057710791],
];
const D50_TO_D65: M3 = [
  [0.9554734527042182, -0.023098536874261423, 0.0632593086610217],
  [-0.028369706963208136, 1.0099954580058226, 0.021041398966943008],
  [0.012314001688319899, -0.020507696433477912, 1.3303659366080753],
];

const srgbDecode = (x: number) => {
  const s = Math.sign(x), a = Math.abs(x);
  return a <= 0.04045 ? x / 12.92 : s * Math.pow((a + 0.055) / 1.055, 2.4);
};
const srgbEncode = (x: number) => {
  const s = Math.sign(x), a = Math.abs(x);
  return a > 0.0031308 ? s * (1.055 * Math.pow(a, 1 / 2.4) - 0.055) : 12.92 * x;
};

function linSrgbToRgb(v: V3): V3 {
  return [srgbEncode(v[0]), srgbEncode(v[1]), srgbEncode(v[2])];
}
function xyzD65ToRgb(v: V3): V3 {
  return linSrgbToRgb(mul(XYZ_TO_LIN_SRGB, v));
}

function labToXyzD50(L: number, a: number, b: number): V3 {
  const k = 24389 / 27, e = 216 / 24389;
  const f1 = (L + 16) / 116, f0 = a / 500 + f1, f2 = f1 - b / 200;
  const x = Math.pow(f0, 3) > e ? Math.pow(f0, 3) : (116 * f0 - 16) / k;
  const y = L > k * e ? Math.pow((L + 16) / 116, 3) : L / k;
  const z = Math.pow(f2, 3) > e ? Math.pow(f2, 3) : (116 * f2 - 16) / k;
  return [x * 0.3457 / 0.3585, y, z * (1 - 0.3457 - 0.3585) / 0.3585];
}

function oklabToLinSrgb(L: number, a: number, b: number): V3 {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/** Делит строку по разделителю верхнего уровня (вне скобок и кавычек). */
export function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, quote = '', cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      cur += ch;
      if (ch === '\\' && i + 1 < s.length) { cur += s[++i]; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    const isSep = sep === ' ' ? /\s/.test(ch) : ch === sep;
    if (isSep && depth === 0) {
      if (sep !== ' ' || cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim() || (sep !== ' ' && out.length)) out.push(cur.trim());
  return out.filter((x) => x !== '' || sep !== ' ');
}

const NAMED: Record<string, string> = {
  black: '000000', white: 'ffffff', red: 'ff0000', green: '008000', blue: '0000ff', yellow: 'ffff00',
  cyan: '00ffff', aqua: '00ffff', magenta: 'ff00ff', fuchsia: 'ff00ff', gray: '808080', grey: '808080',
  silver: 'c0c0c0', maroon: '800000', olive: '808000', lime: '00ff00', teal: '008080', navy: '000080',
  purple: '800080', orange: 'ffa500', pink: 'ffc0cb', brown: 'a52a2a', gold: 'ffd700', beige: 'f5f5dc',
  ivory: 'fffff0', khaki: 'f0e68c', lavender: 'e6e6fa', linen: 'faf0e6', salmon: 'fa8072', tan: 'd2b48c',
  wheat: 'f5deb3', coral: 'ff7f50', crimson: 'dc143c', indigo: '4b0082', violet: 'ee82ee', orchid: 'da70d6',
  plum: 'dda0dd', sienna: 'a0522d', tomato: 'ff6347', turquoise: '40e0d0', skyblue: '87ceeb', snow: 'fffafa',
  whitesmoke: 'f5f5f5', gainsboro: 'dcdcdc', lightgray: 'd3d3d3', lightgrey: 'd3d3d3', darkgray: 'a9a9a9',
  darkgrey: 'a9a9a9', dimgray: '696969', dimgrey: '696969', slategray: '708090', slategrey: '708090',
  steelblue: '4682b4', royalblue: '4169e1', midnightblue: '191970', darkblue: '00008b', darkred: '8b0000',
  darkgreen: '006400', forestgreen: '228b22', seagreen: '2e8b57', olivedrab: '6b8e23', chocolate: 'd2691e',
  peru: 'cd853f', firebrick: 'b22222', indianred: 'cd5c5c', rosybrown: 'bc8f8f', moccasin: 'ffe4b5',
  papayawhip: 'ffefd5', bisque: 'ffe4c4', antiquewhite: 'faebd7', oldlace: 'fdf5e6', seashell: 'fff5ee',
  mintcream: 'f5fffa', honeydew: 'f0fff0', aliceblue: 'f0f8ff', ghostwhite: 'f8f8ff', floralwhite: 'fffaf0',
  cornsilk: 'fff8dc', lemonchiffon: 'fffacd', lightyellow: 'ffffe0', lightpink: 'ffb6c1', hotpink: 'ff69b4',
  deeppink: 'ff1493', darkorange: 'ff8c00', orangered: 'ff4500', goldenrod: 'daa520', darkgoldenrod: 'b8860b',
  burlywood: 'deb887', sandybrown: 'f4a460', navajowhite: 'ffdead', blanchedalmond: 'ffebcd', mistyrose: 'ffe4e1',
  lavenderblush: 'fff0f5', thistle: 'd8bfd8', mediumpurple: '9370db', rebeccapurple: '663399', slateblue: '6a5acd',
  darkslateblue: '483d8b', mediumslateblue: '7b68ee', cornflowerblue: '6495ed', dodgerblue: '1e90ff',
  deepskyblue: '00bfff', lightskyblue: '87cefa', lightblue: 'add8e6', powderblue: 'b0e0e6', cadetblue: '5f9ea0',
  darkcyan: '008b8b', lightseagreen: '20b2aa', mediumaquamarine: '66cdaa', aquamarine: '7fffd4',
  palegreen: '98fb98', lightgreen: '90ee90', springgreen: '00ff7f', mediumspringgreen: '00fa9a', lawngreen: '7cfc00',
  chartreuse: '7fff00', greenyellow: 'adff2f', yellowgreen: '9acd32', limegreen: '32cd32', darkseagreen: '8fbc8f',
  darkolivegreen: '556b2f', darkkhaki: 'bdb76b', palegoldenrod: 'eee8aa', lightgoldenrodyellow: 'fafad2',
  peachpuff: 'ffdab9', lightsalmon: 'ffa07a', darksalmon: 'e9967a', lightcoral: 'f08080', palevioletred: 'db7093',
  mediumvioletred: 'c71585', darkmagenta: '8b008b', darkviolet: '9400d3', darkorchid: '9932cc', mediumorchid: 'ba55d3',
  blueviolet: '8a2be2', mediumblue: '0000cd', darkslategray: '2f4f4f', darkslategrey: '2f4f4f',
  lightslategray: '778899', lightslategrey: '778899', lightsteelblue: 'b0c4de', lightcyan: 'e0ffff',
  paleturquoise: 'afeeee', mediumturquoise: '48d1cc', darkturquoise: '00ced1', azure: 'f0ffff', saddlebrown: '8b4513',
};

function num(tok: string, percentScale = 1): number {
  if (tok === 'none') return 0;
  if (tok.endsWith('%')) return (parseFloat(tok) / 100) * percentScale;
  return parseFloat(tok);
}
function hue(tok: string): number {
  if (tok === 'none') return 0;
  const v = parseFloat(tok);
  if (tok.endsWith('rad')) return (v * 180) / Math.PI;
  if (tok.endsWith('grad')) return v * 0.9;
  if (tok.endsWith('turn')) return v * 360;
  return v;
}
function alphaOf(tok: string | undefined): number {
  if (tok === undefined) return 1;
  return clamp01(num(tok, 1));
}

function hslToRgb(h: number, s: number, l: number): V3 {
  h = ((h % 360) + 360) % 360;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/** Разбирает аргументы функции цвета: "a b c / alpha" или "a, b, c, alpha". */
function args(inner: string): { parts: string[]; alpha?: string } {
  const slash = inner.split('/');
  const main = slash[0];
  let alpha: string | undefined = slash[1]?.trim();
  let parts: string[];
  if (main.includes(',')) {
    parts = main.split(',').map((x) => x.trim()).filter(Boolean);
    if (parts.length === 4 && alpha === undefined) alpha = parts.pop();
  } else parts = main.trim().split(/\s+/).filter(Boolean);
  return { parts, alpha };
}

export function parseColor(input: string | null | undefined): RGBA | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (s === 'currentcolor' || s === 'inherit' || s === 'initial' || s === 'none') return null;
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (!/^[0-9a-f]+$/.test(h)) return null;
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const v = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
    return { r: v(0), g: v(2), b: v(4), a: h.length === 8 ? v(6) : 1 };
  }
  if (NAMED[s]) return parseColor('#' + NAMED[s]);
  const m = /^([a-z-]+)\((.*)\)$/s.exec(s);
  if (!m) return null;
  const fn = m[1];
  const { parts, alpha } = args(m[2]);
  const a = alphaOf(alpha);
  let rgb: V3 | null = null;
  try {
    switch (fn) {
      case 'rgb': case 'rgba':
        if (parts.length < 3) return null;
        rgb = [num(parts[0], 255) / 255, num(parts[1], 255) / 255, num(parts[2], 255) / 255];
        break;
      case 'hsl': case 'hsla':
        if (parts.length < 3) return null;
        rgb = hslToRgb(hue(parts[0]), num(parts[1].endsWith('%') ? parts[1] : parts[1] + '%', 1), num(parts[2].endsWith('%') ? parts[2] : parts[2] + '%', 1));
        break;
      case 'hwb': {
        const h = hue(parts[0]);
        let w = num(parts[1], 1), b = num(parts[2], 1);
        if (!parts[1].endsWith('%')) w /= 100;
        if (!parts[2].endsWith('%')) b /= 100;
        if (w + b >= 1) { const g = w / (w + b); rgb = [g, g, g]; }
        else { const base = hslToRgb(h, 1, 0.5); rgb = base.map((c) => c * (1 - w - b) + w) as V3; }
        break;
      }
      case 'lab': {
        const L = parts[0].endsWith('%') ? parseFloat(parts[0]) : num(parts[0]);
        rgb = xyzD65ToRgb(mul(D50_TO_D65, labToXyzD50(L, num(parts[1], 125), num(parts[2], 125))));
        break;
      }
      case 'lch': {
        const L = parts[0].endsWith('%') ? parseFloat(parts[0]) : num(parts[0]);
        const C = num(parts[1], 150), H = (hue(parts[2]) * Math.PI) / 180;
        rgb = xyzD65ToRgb(mul(D50_TO_D65, labToXyzD50(L, C * Math.cos(H), C * Math.sin(H))));
        break;
      }
      case 'oklab':
        rgb = linSrgbToRgb(oklabToLinSrgb(num(parts[0], 1), num(parts[1], 0.4), num(parts[2], 0.4)));
        break;
      case 'oklch': {
        const C = num(parts[1], 0.4), H = (hue(parts[2]) * Math.PI) / 180;
        rgb = linSrgbToRgb(oklabToLinSrgb(num(parts[0], 1), C * Math.cos(H), C * Math.sin(H)));
        break;
      }
      case 'color': {
        const space = parts[0];
        const v: V3 = [num(parts[1] ?? '0', 1), num(parts[2] ?? '0', 1), num(parts[3] ?? '0', 1)];
        switch (space) {
          case 'srgb': rgb = v; break;
          case 'srgb-linear': rgb = linSrgbToRgb(v); break;
          case 'display-p3': rgb = xyzD65ToRgb(mul(P3_TO_XYZ, v.map(srgbDecode) as V3)); break;
          case 'a98-rgb': rgb = xyzD65ToRgb(mul(A98_TO_XYZ, v.map((x) => Math.sign(x) * Math.pow(Math.abs(x), 563 / 256)) as V3)); break;
          case 'prophoto-rgb': rgb = xyzD65ToRgb(mul(D50_TO_D65, mul(PROPHOTO_TO_XYZ_D50, v.map((x) => (Math.abs(x) <= 16 / 512 ? x / 16 : Math.sign(x) * Math.pow(Math.abs(x), 1.8))) as V3))); break;
          case 'rec2020': {
            const A = 1.09929682680944, B = 0.018053968510807;
            rgb = xyzD65ToRgb(mul(REC2020_TO_XYZ, v.map((x) => (Math.abs(x) < B * 4.5 ? x / 4.5 : Math.sign(x) * Math.pow((Math.abs(x) + A - 1) / A, 1 / 0.45))) as V3));
            break;
          }
          case 'xyz': case 'xyz-d65': rgb = xyzD65ToRgb(v); break;
          case 'xyz-d50': rgb = xyzD65ToRgb(mul(D50_TO_D65, v)); break;
          default: return null;
        }
        break;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
  if (!rgb || !rgb.every(Number.isFinite) || !Number.isFinite(a)) return null;
  return { r: clamp01(rgb[0]), g: clamp01(rgb[1]), b: clamp01(rgb[2]), a };
}

/** Ищет цвет в начале или конце списка токенов (формат computed box-shadow / stop). */
export function looksLikeColor(tok: string): boolean {
  return parseColor(tok) !== null;
}

export function rgbaEquals(a: RGBA, b: RGBA, eps = 1 / 512): boolean {
  return Math.abs(a.r - b.r) < eps && Math.abs(a.g - b.g) < eps && Math.abs(a.b - b.b) < eps && Math.abs(a.a - b.a) < eps;
}

export function toCss(c: RGBA): string {
  const b = (x: number) => Math.round(clamp01(x) * 255);
  return `rgba(${b(c.r)}, ${b(c.g)}, ${b(c.b)}, ${+c.a.toFixed(4)})`;
}
