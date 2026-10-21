var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// processor/src/png.ts
function isPng(b) {
  return b.length > 24 && SIG.every((v, i) => b[i] === v);
}
function pngSize(b) {
  if (!isPng(b)) return null;
  const dv = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  return { width: dv.readUInt32BE(16), height: dv.readUInt32BE(20) };
}
function decodePng(buf) {
  if (!isPng(buf)) throw new Error("not a png");
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  let palette = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  if (bitDepth !== 8 || interlace) throw new Error(`unsupported png (depth ${bitDepth}, interlace ${interlace})`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!ch) throw new Error("unsupported color type " + colorType);
  const raw = import_node_zlib.default.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? line[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += a + b >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4, i = x * ch;
      if (colorType === 6) {
        out[o] = line[i];
        out[o + 1] = line[i + 1];
        out[o + 2] = line[i + 2];
        out[o + 3] = line[i + 3];
      } else if (colorType === 2) {
        out[o] = line[i];
        out[o + 1] = line[i + 1];
        out[o + 2] = line[i + 2];
        out[o + 3] = 255;
      } else if (colorType === 0) {
        out[o] = out[o + 1] = out[o + 2] = line[i];
        out[o + 3] = 255;
      } else if (colorType === 4) {
        out[o] = out[o + 1] = out[o + 2] = line[i];
        out[o + 3] = line[i + 1];
      } else {
        const p = line[i];
        out[o] = palette[p * 3];
        out[o + 1] = palette[p * 3 + 1];
        out[o + 2] = palette[p * 3 + 2];
        out[o + 3] = trns && p < trns.length ? trns[p] : 255;
      }
    }
    prev = line;
  }
  return { width, height, data: out };
}
function crc32(b) {
  let c = 4294967295;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ c >>> 8;
  return (c ^ 4294967295) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(img) {
  const { width, height, data } = img;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([SIG, chunk("IHDR", ihdr), chunk("IDAT", import_node_zlib.default.deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}
function alphaBounds(img, threshold = 2) {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
function crop(img, r) {
  const out = Buffer.alloc(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) img.data.copy(out, y * r.w * 4, ((r.y + y) * img.width + r.x) * 4, ((r.y + y) * img.width + r.x + r.w) * 4);
  return { width: r.w, height: r.h, data: out };
}
function compareImages(a, b, tolerance = 24) {
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
  const diff = Buffer.alloc(w * h * 4);
  let sum = 0, changed = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ia = (y * a.width + x) * 4, ib = (y * b.width + x) * 4, o = (y * w + x) * 4;
      const comp = (img, i, c) => (img.data[i + c] * img.data[i + 3] + 255 * (255 - img.data[i + 3])) / 255;
      const d = Math.max(Math.abs(comp(a, ia, 0) - comp(b, ib, 0)), Math.abs(comp(a, ia, 1) - comp(b, ib, 1)), Math.abs(comp(a, ia, 2) - comp(b, ib, 2)));
      sum += d;
      if (d > tolerance) {
        changed++;
        diff[o] = 255;
        diff[o + 1] = 0;
        diff[o + 2] = 64;
        diff[o + 3] = 255;
      } else {
        const g = 255 - Math.round((255 - comp(a, ia, 1)) * 0.25);
        diff[o] = g;
        diff[o + 1] = g;
        diff[o + 2] = g;
        diff[o + 3] = 255;
      }
    }
  }
  return { width: w, height: h, meanAbs: sum / (w * h || 1), changedRatio: changed / (w * h || 1), diff: { width: w, height: h, data: diff } };
}
function downscale(img, factor) {
  const k = Math.max(1, Math.floor(factor));
  const w = Math.floor(img.width / k), h = Math.floor(img.height / k);
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const acc = [0, 0, 0, 0];
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) {
      const i = ((y * k + dy) * img.width + x * k + dx) * 4;
      for (let c = 0; c < 4; c++) acc[c] += img.data[i + c];
    }
    const o = (y * w + x) * 4;
    for (let c = 0; c < 4; c++) out[o + c] = Math.round(acc[c] / (k * k));
  }
  return { width: w, height: h, data: out };
}
var import_node_zlib, SIG, CRC;
var init_png = __esm({
  "processor/src/png.ts"() {
    import_node_zlib = __toESM(require("node:zlib"), 1);
    SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    CRC = (() => {
      const t = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
        t[n] = c >>> 0;
      }
      return t;
    })();
  }
});

// processor/src/assets.ts
var assets_exports = {};
__export(assets_exports, {
  AssetStore: () => AssetStore,
  FIGMA_MAX_PX: () => FIGMA_MAX_PX,
  FIGMA_NATIVE: () => FIGMA_NATIVE,
  imageSize: () => imageSize,
  sniffMime: () => sniffMime
});
function sniffMime(b) {
  if (b.length >= 8 && b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71) return "image/png";
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if (b.length >= 6 && b[0] === 71 && b[1] === 73 && b[2] === 70) return "image/gif";
  if (b.length >= 12 && b[0] === 82 && b[1] === 73 && b[2] === 70 && b[3] === 70 && b[8] === 87 && b[9] === 69 && b[10] === 66 && b[11] === 80) return "image/webp";
  if (b.length >= 12 && b[4] === 102 && b[5] === 116 && b[6] === 121 && b[7] === 112) return "image/avif";
  if (b.length >= 2 && b[0] === 66 && b[1] === 77) return "image/bmp";
  if (b.length >= 4 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return "image/x-icon";
  const head = Buffer.from(b.subarray(0, 512)).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<svg") || head.startsWith("<?xml") && head.includes("<svg") || head.includes("<svg")) return "image/svg+xml";
  return "application/octet-stream";
}
function imageSize(b, mime) {
  try {
    const buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
    if (mime === "image/png") return pngSize(b);
    if (mime === "image/gif") return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (mime === "image/jpeg") {
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 255) {
          i++;
          continue;
        }
        const m = buf[i + 1];
        if (m >= 192 && m <= 207 && m !== 196 && m !== 200 && m !== 204) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch {
  }
  return null;
}
var import_node_crypto3, import_node_fs3, import_node_path3, FIGMA_NATIVE, FIGMA_MAX_PX, AssetStore;
var init_assets = __esm({
  "processor/src/assets.ts"() {
    import_node_crypto3 = __toESM(require("node:crypto"), 1);
    import_node_fs3 = __toESM(require("node:fs"), 1);
    import_node_path3 = __toESM(require("node:path"), 1);
    init_png();
    FIGMA_NATIVE = /* @__PURE__ */ new Set(["image/png", "image/jpeg", "image/gif"]);
    FIGMA_MAX_PX = 4096;
    AssetStore = class {
      constructor(dir, limits) {
        this.limits = limits;
        this.dir = dir;
        import_node_fs3.default.mkdirSync(dir, { recursive: true });
      }
      limits;
      dir;
      infos = /* @__PURE__ */ new Map();
      totalBytes = 0;
      /** Добавляет ресурс; возвращает его id (повтор с теми же байтами → тот же id). */
      put(bytes, kind, source, note) {
        const sha256 = import_node_crypto3.default.createHash("sha256").update(bytes).digest("hex");
        const id = (kind === "svg" ? "s" : "i") + sha256.slice(0, 24);
        const have = this.infos.get(id);
        if (have) return have;
        if (this.infos.size >= this.limits.maxAssets) throw Object.assign(new Error(`Превышен лимит ресурсов (${this.limits.maxAssets})`), { code: "ASSET_LIMIT" });
        if (this.totalBytes + bytes.length > this.limits.maxTotalBytes) throw Object.assign(new Error("Превышен общий объём ресурсов"), { code: "ASSET_LIMIT" });
        const mime = kind === "svg" ? "image/svg+xml" : sniffMime(bytes);
        const size = kind === "svg" ? { width: 0, height: 0 } : imageSize(bytes, mime);
        if (kind === "image" && !FIGMA_NATIVE.has(mime)) throw new Error("Неподдерживаемый формат для Figma: " + mime);
        if (kind === "image" && (!size || size.width < 1 || size.height < 1)) throw new Error("Не удалось определить размер изображения");
        if (size && (size.width > FIGMA_MAX_PX || size.height > FIGMA_MAX_PX)) throw new Error(`Изображение больше ${FIGMA_MAX_PX}px`);
        import_node_fs3.default.writeFileSync(import_node_path3.default.join(this.dir, id), bytes);
        const info = { id, kind, mime, width: size?.width ?? 0, height: size?.height ?? 0, bytes: bytes.length, sha256, source: source.slice(0, 300), note };
        this.infos.set(id, info);
        this.totalBytes += bytes.length;
        return info;
      }
      get(id) {
        return this.infos.get(id);
      }
      path(id) {
        return import_node_path3.default.join(this.dir, id.replace(/[^a-z0-9]/gi, ""));
      }
      all() {
        return [...this.infos.values()];
      }
      load(list) {
        for (const a of list) {
          this.infos.set(a.id, a);
          this.totalBytes += a.bytes;
        }
      }
    };
  }
});

// processor/src/main.ts
var import_node_fs9 = __toESM(require("node:fs"), 1);
var import_node_http3 = __toESM(require("node:http"), 1);
var import_node_path9 = __toESM(require("node:path"), 1);

// shared/schema.ts
var SCHEMA_VERSION = "1.0";
var PROTOCOL_VERSION = 1;
var GENERATOR = "html-to-figma-importer";
var GENERATOR_VERSION = "1.0.0";
var DEFAULT_PROFILE = {
  viewportWidth: 1440,
  viewportHeight: 1e3,
  colorScheme: "light",
  reducedMotion: "no-preference",
  locale: "ru-RU",
  storage: {},
  exclude: [],
  hover: true,
  cursor: true,
  blockExternal: false,
  spaFallback: false,
  injectCss: [],
  svgMode: "auto",
  rasterScale: 2
};
function fontKey(family, weight, italic) {
  return `${family}|${weight}|${italic ? "i" : "n"}`;
}

// processor/src/browser.ts
var import_node_crypto = __toESM(require("node:crypto"), 1);
var import_node_fs = __toESM(require("node:fs"), 1);
var import_node_path = __toESM(require("node:path"), 1);
var import_node_os = __toESM(require("node:os"), 1);
var import_playwright_core = require("playwright-core");
function candidates() {
  const out = [];
  const env = process.env.H2F_CHROMIUM;
  if (env && import_node_fs.default.existsSync(env)) out.push({ label: "H2F_CHROMIUM", opts: { executablePath: env } });
  try {
    const p = import_playwright_core.chromium.executablePath();
    if (p && import_node_fs.default.existsSync(p)) out.push({ label: "Playwright Chromium", opts: { executablePath: p } });
  } catch {
  }
  const local = import_node_path.default.join(process.env.PLAYWRIGHT_BROWSERS_PATH || "", "chromium-1194", "chrome-linux", "chrome");
  if (import_node_fs.default.existsSync(local)) out.push({ label: "Chromium (PLAYWRIGHT_BROWSERS_PATH)", opts: { executablePath: local } });
  if (import_node_os.default.platform() === "win32" || import_node_os.default.platform() === "darwin") {
    out.push({ label: "Microsoft Edge", opts: { channel: "msedge" } });
    out.push({ label: "Google Chrome", opts: { channel: "chrome" } });
  } else {
    for (const p of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/microsoft-edge"]) if (import_node_fs.default.existsSync(p)) out.push({ label: p, opts: { executablePath: p } });
  }
  return out;
}
var shared = null;
async function getBrowser() {
  if (shared && shared.browser.isConnected()) return shared;
  const errors = [];
  for (const c of candidates()) {
    try {
      const browser = await import_playwright_core.chromium.launch({ ...c.opts, headless: true, args: ["--disable-gpu", "--hide-scrollbars", "--font-render-hinting=none", "--disable-features=Translate,MediaRouter", "--mute-audio"] });
      shared = { browser, info: { ok: true, name: c.label, version: browser.version(), executable: c.opts.executablePath } };
      browser.on("disconnected", () => {
        shared = null;
      });
      return shared;
    } catch (e) {
      errors.push(`${c.label}: ${String(e.message).split("\n")[0]}`);
    }
  }
  throw Object.assign(new Error("Не найден браузер Chromium/Edge/Chrome. " + errors.join(" | ")), { code: "NO_BROWSER" });
}
async function browserStatus() {
  try {
    return (await getBrowser()).info;
  } catch (e) {
    return { ok: false, name: "", version: "", error: e.message };
  }
}
async function closeBrowser() {
  if (shared) {
    await shared.browser.close().catch(() => void 0);
    shared = null;
  }
}
var PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.0\.0\.0|\[?::1\]?|\[?f[cd][0-9a-f]{2}:)/i;
async function newContext(browser, o) {
  const p = o.profile;
  const ctx = await browser.newContext({
    viewport: { width: p.viewportWidth, height: p.viewportHeight },
    deviceScaleFactor: 1,
    locale: p.locale,
    colorScheme: p.colorScheme,
    reducedMotion: p.reducedMotion,
    serviceWorkers: "block",
    acceptDownloads: false,
    javaScriptEnabled: true,
    hasTouch: false,
    isMobile: false
  });
  ctx.setDefaultTimeout(3e4);
  await ctx.route("**/*", async (route) => {
    const req = route.request();
    const url = req.url();
    let u;
    try {
      u = new URL(url);
    } catch {
      return route.abort();
    }
    if (u.protocol === "data:" || u.protocol === "blob:") return route.continue();
    if (url.startsWith(o.siteOrigin)) return route.continue();
    if (u.protocol !== "http:" && u.protocol !== "https:") return route.abort();
    if (PRIVATE_HOST.test(u.hostname)) {
      o.record?.failed.set(url, "заблокировано: локальная сеть");
      return route.abort("blockedbyclient");
    }
    o.record?.external.add(u.origin);
    if (p.blockExternal) {
      o.record?.failed.set(url, "внешние запросы отключены");
      return route.abort("blockedbyclient");
    }
    if (req.method() !== "GET" && req.method() !== "HEAD") {
      o.record?.failed.set(url, "запрос изменения данных заблокирован");
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  if (o.record) {
    const rec = o.record;
    ctx.on("requestfailed", (r) => {
      if (!rec.failed.has(r.url())) rec.failed.set(r.url(), r.failure()?.errorText ?? "ошибка");
    });
    ctx.on("response", (r) => {
      if (r.status() >= 400) rec.failed.set(r.url(), "HTTP " + r.status());
    });
  }
  const storage = p.storage ?? {};
  await ctx.addInitScript(({ origin, storage: storage2 }) => {
    if (location.origin + "/" !== origin && !location.href.startsWith(origin)) return;
    try {
      for (const [k, v] of Object.entries(storage2)) localStorage.setItem(k, v);
    } catch {
    }
    try {
      const keys = /* @__PURE__ */ new Set();
      window.__h2fKeys = keys;
      const orig = Storage.prototype.getItem;
      Storage.prototype.getItem = function(k) {
        try {
          if (this === window.localStorage) keys.add(String(k));
        } catch {
        }
        return orig.call(this, k);
      };
    } catch {
    }
    window.open = () => null;
    window.print = () => void 0;
  }, { origin: o.siteOrigin, storage });
  if (o.injectCss?.length) {
    const urls = o.injectCss.map((c) => c.url);
    await ctx.addInitScript((urls2) => {
      const add = () => {
        for (const u of urls2) {
          const l = document.createElement("link");
          l.rel = "stylesheet";
          l.href = u;
          l.setAttribute("data-h2f", "inject");
          (document.head || document.documentElement).appendChild(l);
        }
      };
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add, { once: true });
      else add();
    }, urls);
  }
  ctx.on("page", (pg) => {
    pg.on("dialog", (d) => d.dismiss().catch(() => void 0));
  });
  return ctx;
}
async function inject(page) {
  const key = "__h2f_" + import_node_crypto.default.randomBytes(6).toString("hex");
  const src = '(()=>{function et(e){let t=[],n=(i,s)=>{if(i.nodeType===Node.TEXT_NODE){s.s+=i.textContent??"";return}if(i.nodeType!==Node.ELEMENT_NODE)return;let l=i,f=getComputedStyle(l).display;if(f==="none")return;let a=!f.startsWith("inline")&&f!=="contents";(a||l.tagName==="BR")&&(s.s+=" ");for(let u of Array.from(l.childNodes))n(u,s);a&&(s.s+=" ")};for(let i of Array.from(e.childNodes)){let s={s:""};n(i,s);let l=s.s.replace(/\\s+/g," ").trim();l&&t.push(l)}return(t.filter(i=>!/^[\\d.\\s/№#-]+$/.test(i))[0]??t.join(" ")).trim()||(e.getAttribute("aria-label")??e.getAttribute("title")??"").trim()}function At(e){let t=[];for(let r of Array.from(document.querySelectorAll("a[href], area[href]"))){let o=r.getAttribute("href")??"",i=et(r).slice(0,80);t.push({href:o,text:i,download:r.hasAttribute("download"),source:"a"})}for(let r of Array.from(document.querySelectorAll("[data-href], [data-route], [data-link], [routerlink]"))){let o=r.getAttribute("data-href")??r.getAttribute("data-route")??r.getAttribute("data-link")??r.getAttribute("routerlink")??"";/^(#|\\/|\\.\\/|[\\w-]+\\.html?)/.test(o)&&t.push({href:o,text:(r.innerText||"").replace(/\\s+/g," ").trim().slice(0,80),download:!1,source:"data"})}let n=[];for(let r of Array.from(document.querySelectorAll("[id], a[name]"))){let o=r.getAttribute("id")??r.getAttribute("name");o&&n.push(o)}return{links:t,ids:n}}function Vn(e){let t=2166136261,n=16777619;for(let r=0;r<e.length;r++){let o=e.charCodeAt(r);t=Math.imul(t^o,16777619),n=Math.imul(n^o,2246822519)}return(t>>>0).toString(16).padStart(8,"0")+(n>>>0).toString(16).padStart(8,"0")}function It(e){let t=[],n=0,r=a=>{if(e(a))return;let u=a.tagName;if(!(u==="SCRIPT"||u==="STYLE"||u==="NOSCRIPT"||u==="TEMPLATE"||getComputedStyle(a).display==="none")){t.push(u+"."+(a.getAttribute("class")??"").split(/\\s+/).filter(d=>!/active|current|is-|open|selected|hover|focus/.test(d)).slice(0,3).join("."));for(let d of Array.from(a.childNodes))if(d.nodeType===Node.TEXT_NODE){let m=(d.textContent??"").replace(/\\s+/g," ").trim();m&&(t.push(m),n+=m.length)}else d.nodeType===Node.ELEMENT_NODE&&r(d)}};document.body&&r(document.body);let o=a=>!!a.closest(\'header, nav, footer, [role="navigation"], [role="banner"], [role="contentinfo"]\')||e(a),i=a=>{let u=a.getBoundingClientRect(),c=getComputedStyle(a);return u.width>0&&u.height>0&&c.visibility!=="hidden"&&parseFloat(c.opacity)>0},s=a=>Array.from(document.querySelectorAll(a)).find(u=>i(u)&&!o(u)),f=((s("h1")??s("h2")??document.querySelector("h1"))?.textContent??"").replace(/\\s+/g," ").trim().slice(0,100);return{fp:Vn(t.join("")),textLength:n,heading:f}}var be="data-h2f-hover";function Ge(e,t=`[${be}]`){let n="",r="",o=0;for(let i=0;i<e.length;i++){let s=e[i];if(s==="\\\\"){n+=s+(e[i+1]??""),i++;continue}if(r){n+=s,s===r&&(r="");continue}if(s===\'"\'||s==="\'"){r=s,n+=s;continue}if(s==="["){o++,n+=s;continue}if(s==="]"){o=Math.max(0,o-1),n+=s;continue}if(!o&&s===":"&&e[i-1]!==":"&&e.slice(i+1,i+6).toLowerCase()==="hover"&&!/[\\w-]/.test(e[i+6]??"")){n+=t,i+=5;continue}n+=s}return n}var Fe=[],Ne=!1;function*ot(e){for(let t of Array.from(e)){yield t;let n=t.cssRules;n&&n.length&&(yield*ot(n))}}function Ft(){let e=[],t=n=>{for(let r of Array.from(n.styleSheets))e.push(r);for(let r of n.adoptedStyleSheets??[])e.push(r)};t(document);for(let n of Array.from(document.querySelectorAll("*")))n.shadowRoot&&t(n.shadowRoot);return e}function De(){let e={rules:0,rewritten:0,failed:0,crossOrigin:0,mediaConditions:[]};if(Ne)return e.rewritten=Fe.length,e;for(let t of Ft()){let n;try{n=t.cssRules}catch{e.crossOrigin++;continue}for(let r of ot(n)){if(r.conditionText!==void 0&&r.conditionText.includes("hover")&&e.mediaConditions.push(r.conditionText),!(r instanceof CSSStyleRule))continue;e.rules++;let o=r.selectorText;if(!/:hover/i.test(o))continue;let i=Ge(o);if(i!==o){if(r.selectorText=i,r.selectorText===o){e.failed++;continue}Fe.push({rule:r,original:o}),e.rewritten++}}}return Ne=!0,e}function Nt(){for(let{rule:e,original:t}of Fe)try{e.selectorText=t}catch{}Fe=[],Ne=!1,Le()}function Le(){for(let e of Array.from(document.querySelectorAll(`[${be}]`)))e.removeAttribute(be)}function _n(){let e=new Set,t=Ne?Fe.map(n=>n.original):[];if(!Ne)for(let n of Ft()){let r;try{r=n.cssRules}catch{continue}for(let o of ot(r))o instanceof CSSStyleRule&&/:hover/i.test(o.selectorText)&&t.push(o.selectorText)}for(let n of t)for(let r of Un(n)){let o=qn(r);if(o<0)continue;let i=o+6;for(;i<r.length&&!/[\\s>+~]/.test(r[i]);)i++;let s=(r.slice(0,o)+r.slice(o+6,i)).trim();s=s.replace(/::?(before|after|first-letter|first-line|marker|placeholder)\\b/g,"").replace(/:(focus|focus-visible|focus-within|active|visited|link)\\b/g,""),!(!s||/^[>+~]/.test(s)||s.endsWith(">")||s.endsWith("+")||s.endsWith("~"))&&(/:hover/.test(s)&&(s=Ge(s,"")),e.add(s.replace(/\\s+/g," ").trim()))}return[...e]}function Un(e){let t=[],n=0,r="",o="";for(let i of e){if(o){r+=i,i===o&&(o="");continue}if(i===\'"\'||i==="\'"){o=i,r+=i;continue}if((i==="("||i==="[")&&n++,(i===")"||i==="]")&&n--,i===","&&n===0){t.push(r.trim()),r="";continue}r+=i}return r.trim()&&t.push(r.trim()),t}function qn(e){let t=0;for(let n=0;n<e.length;n++){let r=e[n];if(r==="("||r==="[")t++;else if(r===")"||r==="]")t--;else if(!t&&r===":"&&e[n-1]!==":"&&e.slice(n+1,n+6).toLowerCase()==="hover"&&!/[\\w-]/.test(e[n+6]??""))return n}return-1}var nt=["transform","translate","rotate","scale","opacity","width","height","background-color","background-image","box-shadow","filter","color","visibility","border-top-color","outline-color","text-decoration-line","text-decoration-color","max-height","clip-path","display","left","top"],Lt=new Set(["transform","translate","rotate","scale","opacity","width","height","box-shadow","filter","visibility","max-height","clip-path","display","left","top"]);function rt(e){let t=[],n=[e,...Array.from(e.querySelectorAll("*"))];for(let r of n)for(let o of["","::before","::after"]){let i=getComputedStyle(r,o||null);if(o&&i.content==="none"){t.push([]);continue}t.push(nt.map(s=>i.getPropertyValue(s)))}return t}function Yn(e,t){let n=0,r=0,o=new Set;for(let i=0;i<Math.min(e.length,t.length);i++){if(e[i].length!==t[i].length){n++,o.add("content");continue}for(let s=0;s<e[i].length;s++)e[i][s]!==t[i][s]&&(o.add(nt[s]),Lt.has(nt[s])?n++:r++)}return{pose:n,minor:r,props:[...o]}}function Be(e){return(e.querySelector(\'h1,h2,h3,h4,h5,h6,[class*="title"]\')?.textContent||e.innerText||e.textContent||"").replace(/\\s+/g," ").trim().slice(0,80)||e.tagName.toLowerCase()}function jn(e){for(let t=e;t;t=t.parentElement){let n=t.tagName;if(n==="HEADER"&&!t.closest("main, article, section")||n==="NAV"||n==="FOOTER")return!0;let r=t.getAttribute("role");if(r==="navigation"||r==="banner"||r==="contentinfo")return!0;let o=getComputedStyle(t).position;if(o==="fixed"||o==="sticky")return!0}return!1}function Pt(e,t=12){De();let n=innerWidth,r=new Map,o=new Map,i=c=>{if(!c)return-1;let d=o.get(c);return d===void 0&&(d=o.size,o.set(c,d)),d};for(let c of _n()){let d;try{d=Array.from(document.querySelectorAll(c))}catch{continue}for(let m of d){if(e(m))continue;let g=m.getBoundingClientRect();if(g.width<80||g.height<40||g.width>n*.95)continue;let R=getComputedStyle(m);if(R.visibility==="hidden"||parseFloat(R.opacity)===0||m.disabled)continue;let p=c+"§"+i(tt(m,c)),b=r.get(p)??{sel:c,els:[]};b.els.includes(m)||b.els.push(m),r.set(p,b)}}let s=[],l=[],f=document.createElement("style");f.textContent="*,*::before,*::after{transition:none!important}",document.documentElement.appendChild(f);try{for(let c of r.values()){let d=c.els[0],m=rt(d),g=d.getBoundingClientRect();$t(d);let R=rt(d),p=d.getBoundingClientRect();Le();let b=Yn(m,R),S=Math.abs(g.width-p.width)>.5||Math.abs(g.height-p.height)>.5;S&&(b.pose+=2);let v=b.pose+b.minor;if(!v)continue;let w=d.getBoundingClientRect(),h=w.width*w.height/(innerWidth*innerHeight),k=jn(d),M=c.els.length>=2,P=!!d.querySelector(\'svg, img, picture, canvas, [style*="background"]\')||/^(IMG|SVG|PICTURE|CANVAS)$/i.test(d.tagName),L=w.top+scrollY,x=b.props.filter(I=>Lt.has(I)).length+(S?1:0),T=x*2+Math.log2(1+b.pose)+(b.props.length-x)*.5,E=Math.log2(1+T)*(M?2:1)*(P?1.4:1)*(k?.15:1)*Math.min(1.5,.4+h*6)/(1+L/4e3);b.pose||(E*=.35),(w.width<140||w.height<70)&&(E*=.5),s.push({index:0,el:d,selector:c.sel,label:Be(d),score:E,box:[w.left+scrollX,L,w.width,w.height],changes:v,props:b.props});for(let[I,G]of c.els.slice(1,4).entries()){let A=G.getBoundingClientRect();l.push({index:0,el:G,selector:c.sel,label:Be(G),score:E*.5*.9**I,box:[A.left+scrollX,A.top+scrollY,A.width,A.height],changes:v,props:b.props})}}}finally{f.remove(),document.documentElement.offsetHeight}for(let c of s){let d=s.find(m=>m!==c&&m.score>=0&&m.el.contains(c.el)&&Ot(m.el));d&&(d.score=Math.max(d.score,c.score),c.score=-1)}let a=s.filter(c=>c.score>=0);a.sort((c,d)=>d.score-c.score);let u=new Set(a.slice(0,3).map(c=>c.selector+"§"+i(tt(c.el,c.selector))));return a.push(...l.filter(c=>u.has(c.selector+"§"+i(tt(c.el,c.selector)))&&!a.some(d=>d.el===c.el||d.el.contains(c.el)))),a.slice(0,t).map((c,d)=>({...c,index:d}))}function tt(e,t){let n=e.parentElement;for(let r=0;r<4&&n&&n.parentElement;r++){let o=0;try{o=n.querySelectorAll(t).length}catch{return e.parentElement}if(o>1)return n;n=n.parentElement}return n??e.parentElement}function $t(e){for(let t=e;t&&(t.setAttribute(be,""),t!==document.documentElement);t=t.parentElement??t.getRootNode().host??null);}function Ot(e){return/^(A|BUTTON|INPUT|SELECT|TEXTAREA|LABEL|SUMMARY)$/.test(e.tagName)||e.hasAttribute("onclick")||e.getAttribute("role")==="button"}async function Ht(e,t){De(),Le(),e.scrollIntoView({block:"center",inline:"nearest",behavior:"instant"}),await new Promise(d=>requestAnimationFrame(()=>requestAnimationFrame(d)));let n=e.getBoundingClientRect(),r=[[.5,.42],[.8,.42],[.5,.3],[.3,.5],[.65,.65],[.2,.2]],o=null;for(let[d,m]of r){let g=n.left+Math.max(4,Math.min(n.width-4,n.width*d)),R=n.top+Math.max(4,Math.min(n.height-4,n.height*m)),p=document.elementFromPoint(g,R);if(!p||!(e===p||e.contains(p)))continue;let b=null;for(let S=p;S&&S!==e;S=S.parentElement)if(Ot(S)){b=S;break}if(b){let S=b.getBoundingClientRect(),v=S.width*S.height>=.6*n.width*n.height;if(!v&&!o){o={el:p,x:g,y:R};continue}if(!v)continue}o={el:p,x:g,y:R};break}let i=scrollY,s=scrollX,l=o?.el??e,f=o?o.x+s:n.left+n.width/2+s,a=o?o.y+i:n.top+n.height/2+i;window.scrollTo({top:0,left:0,behavior:"instant"}),await new Promise(d=>requestAnimationFrame(()=>requestAnimationFrame(d))),$t(l);let u=!1;try{let d={bubbles:!0,cancelable:!0,clientX:f-scrollX,clientY:a-scrollY,view:window},m=[];for(let g=l;g;g=g.parentElement)m.push(g);l.dispatchEvent(new PointerEvent("pointerover",d));for(let g of m.reverse())g.dispatchEvent(new PointerEvent("pointerenter",{...d,bubbles:!1}));l.dispatchEvent(new MouseEvent("mouseover",d));for(let g of m)g.dispatchEvent(new MouseEvent("mouseenter",{...d,bubbles:!1}));l.dispatchEvent(new MouseEvent("mousemove",d)),u=!0}catch{}let c=0;for(let d=l;d;d=d.parentElement)c++;return{hit:t(l),point:[f,a],chain:c,synthetic:u}}function Bt(e){return rt(e).map(t=>t.join("|"))}var Pe=e=>new Promise(t=>setTimeout(t,e)),ye=(e=2)=>new Promise(t=>{let n=0,r=()=>++n>=e?t():requestAnimationFrame(r);requestAnimationFrame(r)});function xe(){let e=0,t=0,n=[];try{n=document.getAnimations()}catch{return{finished:e,paused:t}}for(let r of n)try{let i=r.effect?.getComputedTiming()?.endTime;i!==void 0&&Number.isFinite(i)?(r.finish(),e++):(r.pause(),r.currentTime=0,t++)}catch{}for(let r of Array.from(document.querySelectorAll("video, audio")))try{r.pause()}catch{}return{finished:e,paused:t}}async function Dt(e,t){return Promise.race([e,Pe(t).then(()=>"timeout")])}async function Xn(e,t){let n=performance.now(),r=new MutationObserver(()=>{n=performance.now()});r.observe(document,{subtree:!0,childList:!0,attributes:!0,characterData:!0});let o=performance.now();try{for(;performance.now()-o<t;){if(performance.now()-n>=e)return!0;await Pe(Math.min(50,e))}return!1}finally{r.disconnect()}}async function Kn(e){let t=Array.from(document.images),n=t.filter(r=>!r.complete);return await Dt(Promise.all(n.map(r=>r.decode().catch(()=>{}))),e),{pending:t.filter(r=>!r.complete).length,broken:t.filter(r=>r.complete&&r.naturalWidth===0&&(r.currentSrc||r.src)).map(r=>r.currentSrc||r.src).slice(0,50)}}function Gt(){let e=Array.from(document.body?.querySelectorAll("*")??[]).slice(0,4e3),t=0;for(let n of e){let r=n.getBoundingClientRect();t=t*31+Math.round(r.x*4)*7+Math.round(r.y*4)*13+Math.round(r.width*4)*17+Math.round(r.height*4)|0}return`${e.length}:${t}:${document.documentElement.scrollHeight}`}async function zt(e={}){let t=performance.now(),n=e.timeoutMs??8e3,r=await Dt(document.fonts.ready.then(()=>"ready"),Math.min(n,6e3)),o=await Xn(e.quietMs??250,Math.min(n,5e3)),i=await Kn(Math.min(n,5e3)),s=xe();await ye(2);let l=!1,f=Gt();for(let a=0;a<10&&performance.now()-t<n;a++){await Pe(80),s=xe(),await ye(1);let u=Gt();if(u===f){l=!0;break}f=u}return{fonts:String(r),mutationsQuiet:o,pendingImages:i.pending,brokenImages:i.broken,stable:l,animations:s,ms:Math.round(performance.now()-t)}}async function Wt(e={}){let t=new Map,n=innerHeight,r=Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight??0),o=ze(),i=[];for(let u of Array.from(document.body?.querySelectorAll("*")??[])){let c=getComputedStyle(u);(parseFloat(c.opacity)<1||c.visibility==="hidden"||c.transform!=="none"||c.translate!=="none"||c.filter!=="none")&&i.push(u)}let s=Math.max(200,n*(e.stepRatio??.7)),l=e.maxSteps??80,f=0;for(let u=0;u<r&&f<l;u+=s,f++){window.scrollTo({top:u,left:0,behavior:"instant"}),await ye(2),await Pe(e.waitMs??70),xe(),await ye(1);for(let c of i){let d=c.getBoundingClientRect();if(d.bottom<0||d.top>n)continue;let m=getComputedStyle(c),g=t.get(c);(!g||parseFloat(m.opacity)>parseFloat(g.opacity)||g.visibility==="hidden"&&m.visibility!=="hidden")&&t.set(c,{opacity:m.opacity,visibility:m.visibility,transform:m.transform,translate:m.translate,rotate:m.rotate,scale:m.scale,filter:m.filter})}}window.scrollTo({top:0,left:0,behavior:"instant"}),await ye(2),await Pe(150),xe(),await ye(2);let a=ze()===o;return{steps:f,poses:t,headerRestored:a}}function ze(){let e=[];for(let t of Array.from(document.body?.querySelectorAll("*")??[])){let n=getComputedStyle(t);if(n.position!=="fixed"&&n.position!=="sticky")continue;let r=t.getBoundingClientRect();e.push(`${t.tagName}.${t.getAttribute("class")??""}:${Math.round(r.top)}:${Math.round(r.height)}:${n.backgroundColor}:${n.boxShadow}:${n.transform}`)}return e.join("|")}var Qn=["display","position","visibility","opacity","z-index","float","overflow-x","overflow-y","transform","translate","rotate","scale","transform-origin","transform-style","perspective","zoom","filter","backdrop-filter","mix-blend-mode","isolation","will-change","contain","container-type","clip-path","mask-image","-webkit-mask-image","offset-path","background-color","background-image","background-size","background-position-x","background-position-y","background-repeat","background-origin","background-clip","background-attachment","background-blend-mode","border-top-width","border-right-width","border-bottom-width","border-left-width","border-top-style","border-right-style","border-bottom-style","border-left-style","border-top-color","border-right-color","border-bottom-color","border-left-color","border-top-left-radius","border-top-right-radius","border-bottom-right-radius","border-bottom-left-radius","border-image-source","padding-top","padding-right","padding-bottom","padding-left","margin-left","margin-right","box-shadow","outline-style","outline-width","outline-color","outline-offset","color","font-family","font-size","font-weight","font-style","font-variant-caps","font-stretch","line-height","letter-spacing","word-spacing","text-transform","text-align","text-align-last","direction","writing-mode","text-decoration-line","text-decoration-color","text-decoration-style","text-decoration-thickness","text-shadow","text-overflow","white-space","-webkit-line-clamp","-webkit-text-fill-color","-webkit-text-stroke-width","-webkit-text-stroke-color","text-indent","list-style-type","list-style-position","content","object-fit","object-position","appearance","pointer-events","cursor","width","height","box-sizing","counter-reset","counter-increment","hyphens","vertical-align","image-rendering"];function we(e){let t={};for(let n of Qn)t[n]=e.getPropertyValue(n);return t}var C=e=>{if(!e)return 0;let t=parseFloat(e);return Number.isFinite(t)?t:0};function z(e){let t=e.tagName.toLowerCase();e.id&&(t+="#"+e.id);let r=(typeof e.className=="string"?e.className:e.getAttribute("class")??"").trim().split(/\\s+/).filter(Boolean).slice(0,2);return r.length&&(t+="."+r.join(".")),t.slice(0,80)}var Vt=e=>e==="inline"||e==="ruby"||e==="ruby-text";function me(e){return e.transform!=="none"&&e.transform!==""||e.translate!=="none"&&e.translate!==""||e.rotate!=="none"&&e.rotate!==""||e.scale!=="none"&&e.scale!==""}function Se(e){return e["overflow-x"]!=="visible"||e["overflow-y"]!=="visible"}function it(e,t){return!!(!t&&e.position!=="static"||me(e)||e.perspective!=="none"||e.filter!=="none"||e["backdrop-filter"]&&e["backdrop-filter"]!=="none"||/transform|perspective|filter/.test(e["will-change"])||/layout|paint|strict|content/.test(e.contain)||e["container-type"]&&e["container-type"]!=="normal")}function st(e,t){return!!(e.position==="fixed"||e.position==="sticky"||(e.position==="absolute"||e.position==="relative")&&e["z-index"]!=="auto"||/flex|grid/.test(t)&&e["z-index"]!=="auto"||parseFloat(e.opacity)<1||e["mix-blend-mode"]!=="normal"||me(e)||e.filter!=="none"||e["backdrop-filter"]&&e["backdrop-filter"]!=="none"||e.perspective!=="none"||e["clip-path"]!=="none"||e["mask-image"]&&e["mask-image"]!=="none"||e["-webkit-mask-image"]&&e["-webkit-mask-image"]!=="none"||e.isolation==="isolate"||/transform|opacity|filter|perspective|clip-path|mask|isolation/.test(e["will-change"])||/layout|paint|strict|content/.test(e.contain))}var _t=new Set(["SCRIPT","STYLE","LINK","META","TEMPLATE","NOSCRIPT","HEAD","TITLE","BASE","OPTION","OPTGROUP","DATALIST","PARAM","SOURCE","TRACK","AREA","MAP"]);var oe=(e,t)=>[e[0][0]*t[0]+e[0][1]*t[1]+e[0][2]*t[2],e[1][0]*t[0]+e[1][1]*t[1]+e[1][2]*t[2],e[2][0]*t[0]+e[2][1]*t[1]+e[2][2]*t[2]],Zn=[[3.2409699419045226,-1.537383177570094,-.4986107602930034],[-.9692436362808796,1.8759675015077202,.04155505740717559],[.05563007969699366,-.20397695888897652,1.0569715142428786]],Jn=[[.4865709486482162,.26566769316909306,.1982172852343625],[.2289745640697488,.6917385218365064,.079286914093745],[0,.04511338185890264,1.043944368900976]],er=[[.5766690429101305,.1855582379065463,.1882286462349947],[.29734497525053605,.6273635662554661,.07529145849399788],[.02703136138641234,.07068885253582723,.9913375368376388]],tr=[[.7977604896723027,.13518583717574031,.0313493495815248],[.2880711282292934,.7118432178101014,8565396060525902e-20],[0,0,.8251046025104601]],nr=[[.6369580483012914,.14461690358620832,.1688809751641721],[.2627002120112671,.6779980715188708,.05930171646986196],[0,.028072693049087428,1.060985057710791]],We=[[.9554734527042182,-.023098536874261423,.0632593086610217],[-.028369706963208136,1.0099954580058226,.021041398966943008],[.012314001688319899,-.020507696433477912,1.3303659366080753]],rr=e=>{let t=Math.sign(e),n=Math.abs(e);return n<=.04045?e/12.92:t*Math.pow((n+.055)/1.055,2.4)},at=e=>{let t=Math.sign(e),n=Math.abs(e);return n>.0031308?t*(1.055*Math.pow(n,1/2.4)-.055):12.92*e};function _e(e){return[at(e[0]),at(e[1]),at(e[2])]}function ue(e){return _e(oe(Zn,e))}function Ut(e,t,n){let r=903.2962962962963,o=216/24389,i=(e+16)/116,s=t/500+i,l=i-n/200,f=Math.pow(s,3)>o?Math.pow(s,3):(116*s-16)/r,a=e>r*o?Math.pow((e+16)/116,3):e/r,u=Math.pow(l,3)>o?Math.pow(l,3):(116*l-16)/r;return[f*.3457/.3585,a,u*(1-.3457-.3585)/.3585]}function qt(e,t,n){let r=e+.3963377774*t+.2158037573*n,o=e-.1055613458*t-.0638541728*n,i=e-.0894841775*t-1.291485548*n,s=r*r*r,l=o*o*o,f=i*i*i;return[4.0767416621*s-3.3077115913*l+.2309699292*f,-1.2684380046*s+2.6097574011*l-.3413193965*f,-.0041960863*s-.7034186147*l+1.707614701*f]}var Ue=e=>Number.isFinite(e)?Math.min(1,Math.max(0,e)):0;function Me(e,t){let n=[],r=0,o="",i="";for(let s=0;s<e.length;s++){let l=e[s];if(o){if(i+=l,l==="\\\\"&&s+1<e.length){i+=e[++s];continue}l===o&&(o="");continue}if(l===\'"\'||l==="\'"){o=l,i+=l;continue}if(l==="("?r++:l===")"&&(r=Math.max(0,r-1)),(t===" "?/\\s/.test(l):l===t)&&r===0){(t!==" "||i.trim())&&n.push(i.trim()),i="";continue}i+=l}return(i.trim()||t!==" "&&n.length)&&n.push(i.trim()),n.filter(s=>s!==""||t!==" ")}var Yt={black:"000000",white:"ffffff",red:"ff0000",green:"008000",blue:"0000ff",yellow:"ffff00",cyan:"00ffff",aqua:"00ffff",magenta:"ff00ff",fuchsia:"ff00ff",gray:"808080",grey:"808080",silver:"c0c0c0",maroon:"800000",olive:"808000",lime:"00ff00",teal:"008080",navy:"000080",purple:"800080",orange:"ffa500",pink:"ffc0cb",brown:"a52a2a",gold:"ffd700",beige:"f5f5dc",ivory:"fffff0",khaki:"f0e68c",lavender:"e6e6fa",linen:"faf0e6",salmon:"fa8072",tan:"d2b48c",wheat:"f5deb3",coral:"ff7f50",crimson:"dc143c",indigo:"4b0082",violet:"ee82ee",orchid:"da70d6",plum:"dda0dd",sienna:"a0522d",tomato:"ff6347",turquoise:"40e0d0",skyblue:"87ceeb",snow:"fffafa",whitesmoke:"f5f5f5",gainsboro:"dcdcdc",lightgray:"d3d3d3",lightgrey:"d3d3d3",darkgray:"a9a9a9",darkgrey:"a9a9a9",dimgray:"696969",dimgrey:"696969",slategray:"708090",slategrey:"708090",steelblue:"4682b4",royalblue:"4169e1",midnightblue:"191970",darkblue:"00008b",darkred:"8b0000",darkgreen:"006400",forestgreen:"228b22",seagreen:"2e8b57",olivedrab:"6b8e23",chocolate:"d2691e",peru:"cd853f",firebrick:"b22222",indianred:"cd5c5c",rosybrown:"bc8f8f",moccasin:"ffe4b5",papayawhip:"ffefd5",bisque:"ffe4c4",antiquewhite:"faebd7",oldlace:"fdf5e6",seashell:"fff5ee",mintcream:"f5fffa",honeydew:"f0fff0",aliceblue:"f0f8ff",ghostwhite:"f8f8ff",floralwhite:"fffaf0",cornsilk:"fff8dc",lemonchiffon:"fffacd",lightyellow:"ffffe0",lightpink:"ffb6c1",hotpink:"ff69b4",deeppink:"ff1493",darkorange:"ff8c00",orangered:"ff4500",goldenrod:"daa520",darkgoldenrod:"b8860b",burlywood:"deb887",sandybrown:"f4a460",navajowhite:"ffdead",blanchedalmond:"ffebcd",mistyrose:"ffe4e1",lavenderblush:"fff0f5",thistle:"d8bfd8",mediumpurple:"9370db",rebeccapurple:"663399",slateblue:"6a5acd",darkslateblue:"483d8b",mediumslateblue:"7b68ee",cornflowerblue:"6495ed",dodgerblue:"1e90ff",deepskyblue:"00bfff",lightskyblue:"87cefa",lightblue:"add8e6",powderblue:"b0e0e6",cadetblue:"5f9ea0",darkcyan:"008b8b",lightseagreen:"20b2aa",mediumaquamarine:"66cdaa",aquamarine:"7fffd4",palegreen:"98fb98",lightgreen:"90ee90",springgreen:"00ff7f",mediumspringgreen:"00fa9a",lawngreen:"7cfc00",chartreuse:"7fff00",greenyellow:"adff2f",yellowgreen:"9acd32",limegreen:"32cd32",darkseagreen:"8fbc8f",darkolivegreen:"556b2f",darkkhaki:"bdb76b",palegoldenrod:"eee8aa",lightgoldenrodyellow:"fafad2",peachpuff:"ffdab9",lightsalmon:"ffa07a",darksalmon:"e9967a",lightcoral:"f08080",palevioletred:"db7093",mediumvioletred:"c71585",darkmagenta:"8b008b",darkviolet:"9400d3",darkorchid:"9932cc",mediumorchid:"ba55d3",blueviolet:"8a2be2",mediumblue:"0000cd",darkslategray:"2f4f4f",darkslategrey:"2f4f4f",lightslategray:"778899",lightslategrey:"778899",lightsteelblue:"b0c4de",lightcyan:"e0ffff",paleturquoise:"afeeee",mediumturquoise:"48d1cc",darkturquoise:"00ced1",azure:"f0ffff",saddlebrown:"8b4513"};function V(e,t=1){return e==="none"?0:e.endsWith("%")?parseFloat(e)/100*t:parseFloat(e)}function Ve(e){if(e==="none")return 0;let t=parseFloat(e);return e.endsWith("rad")?t*180/Math.PI:e.endsWith("grad")?t*.9:e.endsWith("turn")?t*360:t}function or(e){return e===void 0?1:Ue(V(e,1))}function jt(e,t,n){e=(e%360+360)%360;let r=o=>{let i=(o+e/30)%12,s=t*Math.min(n,1-n);return n-s*Math.max(-1,Math.min(i-3,9-i,1))};return[r(0),r(8),r(4)]}function ir(e){let t=e.split("/"),n=t[0],r=t[1]?.trim(),o;return n.includes(",")?(o=n.split(",").map(i=>i.trim()).filter(Boolean),o.length===4&&r===void 0&&(r=o.pop())):o=n.trim().split(/\\s+/).filter(Boolean),{parts:o,alpha:r}}function _(e){if(!e)return null;let t=e.trim().toLowerCase();if(t==="transparent")return{r:0,g:0,b:0,a:0};if(t==="currentcolor"||t==="inherit"||t==="initial"||t==="none")return null;if(t.startsWith("#")){let f=t.slice(1);if(!/^[0-9a-f]+$/.test(f)||((f.length===3||f.length===4)&&(f=f.split("").map(u=>u+u).join("")),f.length!==6&&f.length!==8))return null;let a=u=>parseInt(f.slice(u,u+2),16)/255;return{r:a(0),g:a(2),b:a(4),a:f.length===8?a(6):1}}if(Yt[t])return _("#"+Yt[t]);let n=/^([a-z-]+)\\((.*)\\)$/s.exec(t);if(!n)return null;let r=n[1],{parts:o,alpha:i}=ir(n[2]),s=or(i),l=null;try{switch(r){case"rgb":case"rgba":if(o.length<3)return null;l=[V(o[0],255)/255,V(o[1],255)/255,V(o[2],255)/255];break;case"hsl":case"hsla":if(o.length<3)return null;l=jt(Ve(o[0]),V(o[1].endsWith("%")?o[1]:o[1]+"%",1),V(o[2].endsWith("%")?o[2]:o[2]+"%",1));break;case"hwb":{let f=Ve(o[0]),a=V(o[1],1),u=V(o[2],1);if(o[1].endsWith("%")||(a/=100),o[2].endsWith("%")||(u/=100),a+u>=1){let c=a/(a+u);l=[c,c,c]}else l=jt(f,1,.5).map(d=>d*(1-a-u)+a);break}case"lab":{let f=o[0].endsWith("%")?parseFloat(o[0]):V(o[0]);l=ue(oe(We,Ut(f,V(o[1],125),V(o[2],125))));break}case"lch":{let f=o[0].endsWith("%")?parseFloat(o[0]):V(o[0]),a=V(o[1],150),u=Ve(o[2])*Math.PI/180;l=ue(oe(We,Ut(f,a*Math.cos(u),a*Math.sin(u))));break}case"oklab":l=_e(qt(V(o[0],1),V(o[1],.4),V(o[2],.4)));break;case"oklch":{let f=V(o[1],.4),a=Ve(o[2])*Math.PI/180;l=_e(qt(V(o[0],1),f*Math.cos(a),f*Math.sin(a)));break}case"color":{let f=o[0],a=[V(o[1]??"0",1),V(o[2]??"0",1),V(o[3]??"0",1)];switch(f){case"srgb":l=a;break;case"srgb-linear":l=_e(a);break;case"display-p3":l=ue(oe(Jn,a.map(rr)));break;case"a98-rgb":l=ue(oe(er,a.map(u=>Math.sign(u)*Math.pow(Math.abs(u),563/256))));break;case"prophoto-rgb":l=ue(oe(We,oe(tr,a.map(u=>Math.abs(u)<=16/512?u/16:Math.sign(u)*Math.pow(Math.abs(u),1.8)))));break;case"rec2020":{let u=1.09929682680944,c=.018053968510807;l=ue(oe(nr,a.map(d=>Math.abs(d)<c*4.5?d/4.5:Math.sign(d)*Math.pow((Math.abs(d)+u-1)/u,1/.45))));break}case"xyz":case"xyz-d65":l=ue(a);break;case"xyz-d50":l=ue(oe(We,a));break;default:return null}break}default:return null}}catch{return null}return!l||!l.every(Number.isFinite)||!Number.isFinite(s)?null:{r:Ue(l[0]),g:Ue(l[1]),b:Ue(l[2]),a:s}}var fe=[1,0,0,1,0,0];function q(e,t){return[1,0,0,1,e,t]}function Y(e,t){return[e[0]*t[0]+e[2]*t[1],e[1]*t[0]+e[3]*t[1],e[0]*t[2]+e[2]*t[3],e[1]*t[2]+e[3]*t[3],e[0]*t[4]+e[2]*t[5]+e[4],e[1]*t[4]+e[3]*t[5]+e[5]]}function $e(e){let t=e[0]*e[3]-e[1]*e[2];if(!Number.isFinite(t)||Math.abs(t)<1e-12)return null;let n=1/t;return[e[3]*n,-e[1]*n,-e[2]*n,e[0]*n,(e[2]*e[5]-e[3]*e[4])*n,(e[1]*e[4]-e[0]*e[5])*n]}function qe(e,t,n){return[e[0]*t+e[2]*n+e[4],e[1]*t+e[3]*n+e[5]]}function Xt(e,t,n){let r=[qe(e,0,0),qe(e,t,0),qe(e,t,n),qe(e,0,n)],o=r.map(f=>f[0]),i=r.map(f=>f[1]),s=Math.min(...o),l=Math.min(...i);return[s,l,Math.max(...o)-s,Math.max(...i)-l]}function sr(e){if(!e||e==="none")return{m:fe,is3d:!1,perspective:!1};let t=/^matrix\\(([^)]*)\\)$/.exec(e.trim());if(t){let r=t[1].split(",").map(o=>parseFloat(o));return r.length!==6||!r.every(Number.isFinite)?null:{m:r,is3d:!1,perspective:!1}}let n=/^matrix3d\\(([^)]*)\\)$/.exec(e.trim());if(n){let r=n[1].split(",").map(s=>parseFloat(s));if(r.length!==16||!r.every(Number.isFinite))return null;let o=Math.abs(r[2])<1e-9&&Math.abs(r[6])<1e-9&&Math.abs(r[8])<1e-9&&Math.abs(r[9])<1e-9&&Math.abs(r[10]-1)<1e-9&&Math.abs(r[11])<1e-9&&Math.abs(r[14])<1e-9&&Math.abs(r[3])<1e-9&&Math.abs(r[7])<1e-9&&Math.abs(r[15]-1)<1e-9,i=Math.abs(r[3])>1e-9||Math.abs(r[7])>1e-9||Math.abs(r[11])>1e-9;return{m:[r[0],r[1],r[4],r[5],r[12],r[13]],is3d:!o,perspective:i}}return null}function Ye(e,t){return e.endsWith("%")?parseFloat(e)/100*t:parseFloat(e)||0}function lt(e){let t=parseFloat(e);return Number.isFinite(t)?e.endsWith("rad")?t:e.endsWith("grad")?t*Math.PI/200:e.endsWith("turn")?t*2*Math.PI:t*Math.PI/180:0}function Kt(e){let t=[],n=sr(e.transform);if(!n)return null;n.is3d&&t.push(n.perspective?"perspective":"3d");let r=n.m;if(e.scale&&e.scale!=="none"){let f=e.scale.trim().split(/\\s+/).map(c=>c.endsWith("%")?parseFloat(c)/100:parseFloat(c)),a=f[0],u=f.length>1?f[1]:f[0];f.length>2&&Math.abs(f[2]-1)>1e-9&&t.push("scale-z"),Number.isFinite(a)&&Number.isFinite(u)&&(r=Y([a,0,0,u,0,0],r))}if(e.rotate&&e.rotate!=="none"){let f=e.rotate.trim().split(/\\s+/),a=0;if(f.length===1)a=lt(f[0]);else{let d=f.slice(0,f.length-1),m=f[f.length-1];d.length===1&&d[0]==="z"?a=lt(m):d.length===3&&Math.abs(parseFloat(d[0]))<1e-9&&Math.abs(parseFloat(d[1]))<1e-9?a=lt(m)*Math.sign(parseFloat(d[2])||1):t.push("rotate-3d")}let u=Math.cos(a),c=Math.sin(a);r=Y([u,c,-c,u,0,0],r)}if(e.translate&&e.translate!=="none"){let f=e.translate.trim().split(/\\s+/),a=Ye(f[0],e.width),u=f.length>1?Ye(f[1],e.height):0;f.length>2&&parseFloat(f[2])!==0&&t.push("translate-z"),r=Y(q(a,u),r)}let o=e.origin.trim().split(/\\s+/),i=Ye(o[0]??"0",e.width),s=Ye(o[1]??"0",e.height),l=Y(q(i,s),Y(r,q(-i,-s)));return l.every(Number.isFinite)?{m:l,unsupported:t}:null}function ke(e,t=!0){if(!e||e==="none")return[];let n=[];for(let r of Me(e,",")){let o=Me(r," "),i=!1,s=null,l=[];for(let f of o){if(f==="inset"){i=!0;continue}if(/^-?[\\d.]+(px)?$/.test(f)){l.push(parseFloat(f));continue}let a=_(f);if(a){s=a;continue}return null}if(l.length<2)return null;n.push({color:s??{r:0,g:0,b:0,a:1},x:l[0],y:l[1],blur:Math.max(0,l[2]??0),spread:t?l[3]??0:0,inset:i})}return n}function ft(e){return e.filter(t=>t.color.a>0).map(t=>({type:t.inset?"INNER_SHADOW":"DROP_SHADOW",color:t.color,x:t.x,y:t.y,blur:t.blur,spread:t.spread})).reverse()}function Jt(e){return Me(e,",").map(t=>t.trim().replace(/^[\'"]|[\'"]$/g,"").replace(/\\\\(.)/g,"$1").trim()).filter(Boolean)}var ar=new Set(["serif","sans-serif","monospace","cursive","fantasy","system-ui","ui-serif","ui-sans-serif","ui-monospace","ui-rounded","emoji","math","fangsong","-apple-system","blinkmacsystemfont"]),en=e=>ar.has(e.toLowerCase());function Qt(e){let t=[];for(let n of e){let r=Me(n," "),o=null,i=[];for(let s of r){let l=_(s);if(l)o=l;else if(/^-?[\\d.]+(%|px)?$/.test(s))i.push(s);else return null}if(!o){if(i.length===1){t.push({color:{r:0,g:0,b:0,a:0},hint:!0});continue}return null}i.length||t.push({color:o});for(let s of i)s.endsWith("px")?t.push({color:o,posPx:parseFloat(s)}):t.push({color:o,pos:parseFloat(s)/100})}return t}function ct(e,t){let n=e.some(a=>a.hint),r=e.filter(a=>!a.hint).map(a=>({color:a.color,pos:a.pos??(a.posPx!==void 0&&t>0?a.posPx/t:void 0)}));if(!r.length)return{stops:[],hints:n};r[0].pos===void 0&&(r[0].pos=0),r[r.length-1].pos===void 0&&(r[r.length-1].pos=1);let o=r[0].pos;for(let a of r)a.pos!==void 0&&(a.pos<o&&(a.pos=o),o=a.pos);for(let a=0;a<r.length;a++){if(r[a].pos!==void 0)continue;let u=a;for(;r[u].pos===void 0;)u++;let c=r[a-1].pos,d=r[u].pos;for(let m=a;m<u;m++)r[m].pos=c+(d-c)*(m-a+1)/(u-a+1)}let i=(a,u,c)=>{let d=a.a+(u.a-a.a)*c;if(d<=0)return{r:a.r,g:a.g,b:a.b,a:0};let m=g=>(a[g]*a.a+(u[g]*u.a-a[g]*a.a)*c)/d;return{r:m("r"),g:m("g"),b:m("b"),a:d}},s=a=>{if(a<=r[0].pos)return r[0].color;for(let u=1;u<r.length;u++){let c=r[u-1],d=r[u];if(a<=d.pos){let m=d.pos-c.pos;return m<=0?d.color:i(c.color,d.color,(a-c.pos)/m)}}return r[r.length-1].color},l=r.filter(a=>a.pos>=0&&a.pos<=1).map(a=>({position:a.pos,color:a.color}));(!l.length||l[0].position>0)&&l.unshift({position:0,color:s(0)}),l[l.length-1].position<1&&l.push({position:1,color:s(1)});let f=[];for(let a=0;a<l.length;a++){let u=l[a];if(u.color.a>.001){f.push(u);continue}let c=l[a-1],d=l[a+1];if(c&&d&&(c.color.r!==d.color.r||c.color.g!==d.color.g||c.color.b!==d.color.b)&&c.color.a>0&&d.color.a>0)f.push({position:u.position,color:{...c.color,a:0}}),f.push({position:Math.min(1,u.position+1e-4),color:{...d.color,a:0}});else{let m=c&&c.color.a>0?c.color:d?d.color:c?.color??u.color;f.push({position:u.position,color:{r:m.r,g:m.g,b:m.b,a:0}})}}return{stops:f.map(a=>({position:Math.min(1,Math.max(0,a.position)),color:a.color})),hints:n}}function lr(e,t,n){let r=e.replace(/^to\\s+/,"").split(/\\s+/),o=s=>r.includes(s);if(r.length===1)return{top:0,right:90,bottom:180,left:270}[r[0]]??null;let i=Math.atan2(t,n)*180/Math.PI;return o("top")&&o("right")?i:o("bottom")&&o("right")?180-i:o("bottom")&&o("left")?180+i:o("top")&&o("left")?360-i:null}var cr=(e,t)=>[1/e,0,0,1/t,0,0];function ut(e,t,n){let r=Y(cr(t,n),e);return $e(r)}function Zt(e,t,n){let r={left:0,top:0,center:.5,right:1,bottom:1},o=.5*t,i=.5*n;if(!e.length)return[o,i];let s=(a,u)=>a in r?r[a]*u:a.endsWith("%")?parseFloat(a)/100*u:parseFloat(a);if(e.length===1){let a=e[0];return a==="top"||a==="bottom"?i=s(a,n):o=s(a,t),[o,i]}let[l,f]=e;return(l==="top"||l==="bottom"||f==="left"||f==="right")&&([l,f]=[f,l]),o=s(l,t),i=s(f,n),[o,i]}function tn(e,t,n){let r=[],o=/^(repeating-)?(linear|radial|conic)-gradient\\((.*)\\)$/s.exec(e.trim());if(!o||t<=0||n<=0)return{paint:null,approx:["unparsed"]};if(o[1])return{paint:null,approx:["repeating"]};let i=o[2],s=Me(o[3],","),l=s[0],f=Qt([l])!==null&&!/^(to |at |circle|ellipse|from |in )/.test(l)&&!/deg|turn|rad|grad/.test(l.split(" ")[0]),a=f?"":l,u=f?s:s.slice(1);/\\bin\\s+\\w/.test(a)&&r.push("color-interpolation-space");let c=a.replace(/\\bin\\s+[\\w-]+(\\s+(shorter|longer|increasing|decreasing)\\s+hue)?/,"").trim(),d=Qt(u);if(!d)return{paint:null,approx:["unparsed-stops"]};if(i==="linear"){let L=180;if(c)if(c.startsWith("to ")){let O=lr(c,t,n);if(O===null)return{paint:null,approx:["unparsed-direction"]};L=O}else{let O=parseFloat(c);if(!Number.isFinite(O))return{paint:null,approx:["unparsed-angle"]};L=c.endsWith("turn")?O*360:c.endsWith("rad")?O*180/Math.PI:c.endsWith("grad")?O*.9:O}let x=L*Math.PI/180,T=Math.sin(x),E=-Math.cos(x),I=Math.abs(t*T)+Math.abs(n*E),G=t/2,A=n/2,F=G-T*I/2,W=A-E*I/2,K=-E,Q=T,ne=[T*I,E*I,K*I,Q*I,F-.5*K*I,W-.5*Q*I],U=ut(ne,t,n),{stops:j,hints:X}=ct(d,I);return X&&r.push("color-hint"),!U||j.length<2?{paint:null,approx:[...r,"degenerate"]}:{paint:{type:"GRADIENT_LINEAR",stops:j,transform:U,opacity:1},approx:r}}if(i==="radial"){let L="ellipse",x="farthest-corner",T=[],E=null;if(c){let[U,j]=c.split(/\\s*\\bat\\b\\s*/);j!==void 0&&(T=j.trim().split(/\\s+/));let X=(U||"").trim().split(/\\s+/).filter(Boolean),O=[];for(let H of X)if(H==="circle"||H==="ellipse")L=H;else if(/^(closest|farthest)-(side|corner)$/.test(H))x=H;else if(/^[\\d.]+(px|%)$/.test(H))O.push(H.endsWith("%")?parseFloat(H)/100*(O.length===0?t:n):parseFloat(H));else return{paint:null,approx:["unparsed-radial"]};O.length&&(E=O.length===1?[O[0],O[0]]:[O[0],O[1]]),O.length===1&&(L="circle")}let[I,G]=Zt(T,t,n),A,F;if(E)[A,F]=E;else{let U=I,j=t-I,X=G,O=n-G,H=x.endsWith("side"),te=x.startsWith("closest");if(L==="circle")if(H)A=F=te?Math.min(U,j,X,O):Math.max(U,j,X,O);else{let $=[Math.hypot(U,X),Math.hypot(j,X),Math.hypot(U,O),Math.hypot(j,O)];A=F=te?Math.min(...$):Math.max(...$)}else{let $=te?Math.min(U,j):Math.max(U,j),B=te?Math.min(X,O):Math.max(X,O);H?(A=$,F=B):(A=$*Math.SQRT2,F=B*Math.SQRT2)}}if(!(A>0)||!(F>0))return{paint:null,approx:["degenerate"]};let W=[2*A,0,0,2*F,I-A,G-F],K=ut(W,t,n),{stops:Q,hints:ne}=ct(d,A);return ne&&r.push("color-hint"),!K||Q.length<2?{paint:null,approx:[...r,"degenerate"]}:{paint:{type:"GRADIENT_RADIAL",stops:Q,transform:K,opacity:1},approx:r}}let m=0,g=[];if(c){let L=/from\\s+(-?[\\d.]+)(deg|turn|rad|grad)?/.exec(c);L&&(m=L[2]==="turn"?parseFloat(L[1])*360:L[2]==="rad"?parseFloat(L[1])*180/Math.PI:parseFloat(L[1]));let x=/\\bat\\s+(.*)$/.exec(c);x&&(g=x[1].trim().split(/\\s+/))}let[R,p]=Zt(g,t,n),b=Math.max(t,n),S=(m-90)*Math.PI/180,v=Math.cos(S),w=Math.sin(S),h=[2*b*v,2*b*w,-2*b*w,2*b*v,R-b*v+b*w,p-b*w-b*v],k=ut(h,t,n),{stops:M,hints:P}=ct(d,1);return r.push("conic"),P&&r.push("color-hint"),!k||M.length<2?{paint:null,approx:[...r,"degenerate"]}:{paint:{type:"GRADIENT_ANGULAR",stops:M,transform:k,opacity:1},approx:r}}function nn(e,t,n){let[r,o,i,s]=e.map(([m,g])=>[Math.max(0,m||0),Math.max(0,g||0)]),l=1,f=(m,g)=>{m>g&&m>0&&(l=Math.min(l,g/m))};f(r[0]+o[0],t),f(s[0]+i[0],t),f(r[1]+s[1],n),f(o[1]+i[1],n);let a=[r,o,i,s].map(([m,g])=>[m*l,g*l]),u=a.some(([m,g])=>Math.abs(m-g)>.5),c=u&&a.every(([m,g])=>Math.abs(m-t/2)<.5&&Math.abs(g-n/2)<.5);return{radii:a.map(([m,g])=>Math.min(m,g)),elliptical:u,ellipse:c}}function rn(e,t,n){let r=e.trim().split(/\\s+/),o=(l,f)=>l.endsWith("%")?parseFloat(l)/100*f:parseFloat(l)||0,i=o(r[0]??"0",t),s=r.length>1?o(r[1],n):r[0]?.endsWith("%")?o(r[0],n):i;return[i,s]}function dt(e){let t={blur:0,dropShadows:[],color:[],other:[]};if(!e||e==="none")return t;let n=/([a-z-]+)\\(((?:[^()]|\\([^()]*\\))*)\\)/g,r;for(;r=n.exec(e);){let o=r[1],i=r[2].trim();if(o==="blur")t.blur+=parseFloat(i)||0;else if(o==="drop-shadow"){let s=ke(i,!1);s&&s.length?t.dropShadows.push(...s):t.other.push(r[0])}else["grayscale","sepia","saturate","hue-rotate","invert","opacity","brightness","contrast"].includes(o)?t.color.push(r[0]):t.other.push(r[0])}return/url\\(/.test(e)&&t.other.push("url()"),t}function on(e){let t=/^([a-z-]+)\\(([^)]*)\\)$/.exec(e.trim());if(!t)return!1;let n=parseFloat(t[2]),r=t[2].trim().endsWith("%")?n/100:n;switch(t[1]){case"grayscale":case"sepia":case"invert":return r===0;case"saturate":case"brightness":case"contrast":case"opacity":return r===1;case"hue-rotate":return n===0}return!1}var pt={normal:"NORMAL",multiply:"MULTIPLY",screen:"SCREEN",overlay:"OVERLAY",darken:"DARKEN",lighten:"LIGHTEN","color-dodge":"COLOR_DODGE","color-burn":"COLOR_BURN","hard-light":"HARD_LIGHT","soft-light":"SOFT_LIGHT",difference:"DIFFERENCE",exclusion:"EXCLUSION",hue:"HUE",saturation:"SATURATION",color:"COLOR",luminosity:"LUMINOSITY","plus-lighter":"LINEAR_DODGE","plus-darker":"LINEAR_BURN"};function sn(e,t,n){let r=/^inset\\(([^)]*)\\)$/.exec(e.trim());if(!r||/calc|var|\\//.test(r[1]))return null;let[o,i]=r[1].split(/\\s+round\\s+/),s=o.trim().split(/\\s+/);if(!s.length||s.length>4)return null;let l=(b,S)=>b.endsWith("%")?parseFloat(b)/100*S:b==="0"?0:b.endsWith("px")?parseFloat(b):NaN,[f,a=f,u=f,c=a]=s,d=l(f,n),m=l(a,t),g=l(u,n),R=l(c,t);if(![d,m,g,R].every(Number.isFinite))return null;let p=0;if(i){let b=i.trim().split(/\\s+/);if(b.length!==1||!b[0].endsWith("px"))return null;p=parseFloat(b[0])}return{empty:t-R-m<=.01||n-d-g<=.01,zero:Math.max(Math.abs(d),Math.abs(m),Math.abs(g),Math.abs(R))<.01,round:p}}var ht="http://www.w3.org/2000/svg";var ur=["fill","fill-opacity","fill-rule","stroke","stroke-width","stroke-opacity","stroke-dasharray","stroke-dashoffset","stroke-linecap","stroke-linejoin","stroke-miterlimit","clip-rule","visibility","font-family","font-size","font-weight","font-style","text-anchor","dominant-baseline","letter-spacing","paint-order","marker-start","marker-mid","marker-end","color-interpolation-filters","shape-rendering","image-rendering"],fr=[["opacity",["1"]],["clip-path",["none"]],["mask",["none"]],["filter",["none"]],["stop-color",[]],["stop-opacity",["1"]],["flood-color",["rgb(0, 0, 0)"]],["flood-opacity",["1"]],["lighting-color",["rgb(255, 255, 255)"]],["mix-blend-mode",["normal"]],["isolation",["auto"]],["vector-effect",["none"]]],dr={circle:["cx","cy","r"],ellipse:["cx","cy","rx","ry"],rect:["x","y","width","height","rx","ry"],path:["d"],image:["x","y","width","height"],use:["x","y"],foreignObject:["x","y","width","height"]},an={filter:"фильтр SVG",mask:"маска SVG",pattern:"паттерн SVG",foreignObject:"foreignObject",image:"растровое изображение внутри SVG",textPath:"textPath",feTurbulence:"фактура feTurbulence"},pr=0;function je(e,t){if(!e)return;let n=/url\\(\\s*["\']?#([^"\')\\s]+)["\']?\\s*\\)/g,r;for(;r=n.exec(e);)t.add(decodeURIComponent(r[1]))}function hr(e,t){let n=t.transform;if(!n||n==="none")return null;let r=t.getPropertyValue("transform-box")||"view-box",o=t.transformOrigin.split(/\\s+/).map(a=>parseFloat(a)||0),i=o[0]??0,s=o[1]??0;if(r==="fill-box"||r==="content-box"||r==="border-box"||r==="stroke-box")try{let a=e.getBBox();i+=a.x,s+=a.y}catch{}let l=n.startsWith("matrix(")?n:null;if(!l){let a=/matrix3d\\(([^)]*)\\)/.exec(n)?.[1].split(",").map(parseFloat);return!a||a.length!==16?null:`translate(${i} ${s}) matrix(${a[0]} ${a[1]} ${a[4]} ${a[5]} ${a[12]} ${a[13]}) translate(${-i} ${-s})`}let f=l.slice(7,-1).split(",").map(a=>a.trim()).join(" ");return!i&&!s?`matrix(${f})`:`translate(${i} ${s}) matrix(${f}) translate(${-i} ${-s})`}function ln(e){return e.replace(/url\\(\\s*"([^"]*)"\\s*\\)/g,"url($1)")}function cn(e,t,n){let r=`h2f${(++pr).toString(36)}_`,o=new Set,i=new Set,s=[],l=0,f=0,a=!1,u=new Set,c=(S,v,w)=>{let h=S.localName;if(h==="script"||h==="animate"||h==="animateTransform"||h==="animateMotion"||h==="set"||h==="title"||h==="desc"||h==="metadata")return null;l++,an[h]&&o.add(an[h]),(h==="text"||h==="tspan")&&(a=!0);let k=getComputedStyle(S);if(!w&&k.display==="none"&&!["linearGradient","radialGradient","stop","clipPath","mask","filter","pattern","symbol","marker","defs"].includes(h)&&!h.startsWith("fe"))return null;let M=document.createElementNS(ht,h);for(let x of Array.from(S.attributes)){let T=x.name;if(/^on/i.test(T)||T==="style"||T==="class"||T==="transform"||T.startsWith("data-"))continue;if(T==="id"){u.add(x.value),M.setAttribute("id",r+x.value);continue}if(T==="href"||T==="xlink:href"){x.value.startsWith("#")?(i.add(decodeURIComponent(x.value.slice(1))),M.setAttribute("href","#"+r+decodeURIComponent(x.value.slice(1)))):(h==="image"||h==="feImage")&&(s.push(new URL(x.value,document.baseURI).toString()),M.setAttribute("href",new URL(x.value,document.baseURI).toString()));continue}let E=x.value;E.includes("url(")&&(je(E,i),E=E.replace(/url\\(\\s*["\']?#([^"\')\\s]+)["\']?\\s*\\)/g,(I,G)=>`url(#${r}${decodeURIComponent(G)})`)),M.setAttribute(T,E)}h==="path"&&(f+=(S.getAttribute("d")??"").length),w&&(M.setAttribute("xmlns",ht),M.setAttribute("width",String(+t.toFixed(3))),M.setAttribute("height",String(+n.toFixed(3))),M.removeAttribute("x"),M.removeAttribute("y"),(k.overflow==="visible"||k.overflowX==="visible")&&M.setAttribute("overflow","visible"));let P=!["linearGradient","radialGradient","stop","filter","clipPath","mask","pattern","defs","symbol","marker"].includes(h)&&!h.startsWith("fe");for(let x of ur){let T=k.getPropertyValue(x);if(T&&(w||!v||v.getPropertyValue(x)!==T)){if(x.startsWith("marker")&&T==="none"&&w)continue;je(T,i),M.setAttribute(x,ln(T).replace(/url\\(\\s*#([^)\\s]+)\\s*\\)/g,(E,I)=>`url(#${r}${I})`))}}for(let[x,T]of fr){if(x==="stop-color"&&h!=="stop"||(x==="flood-color"||x==="flood-opacity")&&!h.startsWith("fe")||x==="lighting-color"&&!h.startsWith("fe"))continue;let E=k.getPropertyValue(x);!E||T.includes(E)||(x==="filter"&&(je(E,i),E.includes("url(")||o.add("CSS filter внутри SVG")),x==="mask"&&o.add("маска SVG"),x==="mix-blend-mode"&&E!=="normal"&&o.add("mix-blend-mode внутри SVG"),x==="clip-path"&&!E.includes("url(")&&o.add("CSS clip-path внутри SVG"),je(E,i),M.setAttribute(x,ln(E).replace(/url\\(\\s*#([^)\\s]+)\\s*\\)/g,(I,G)=>`url(#${r}${G})`)))}if(P&&!w){let x=hr(S,k);x?M.setAttribute("transform",x):S.getAttribute("transform")&&k.transform}else!w&&S.getAttribute("transform")&&!P&&M.setAttribute("transform",S.getAttribute("transform"));let L=dr[h];if(L)for(let x of L){let T=k.getPropertyValue(x);if(!(!T||T==="auto"||T==="none"))if(x==="d"){let E=/^path\\(["\'](.*)["\']\\)$/s.exec(T);E&&E[1]!==S.getAttribute("d")&&M.setAttribute("d",E[1])}else{let E=T.endsWith("px")?String(parseFloat(T)):T;S.getAttribute(x)!==E&&M.setAttribute(x,E)}}for(let x of Array.from(S.childNodes)){if(x.nodeType===Node.TEXT_NODE){x.textContent&&/\\S/.test(x.textContent)?M.appendChild(document.createTextNode(x.textContent)):x.textContent&&M.appendChild(document.createTextNode(" "));continue}if(x.nodeType!==Node.ELEMENT_NODE)continue;let T=c(x,k,!1);T&&M.appendChild(T)}return M},d=c(e,null,!0),m=document.createElementNS(ht,"defs"),g=new Set,R=0;for(;R++<500;){let S=[...i].filter(v=>!u.has(v)&&!g.has(v));if(!S.length)break;for(let v of S){g.add(v);let w=document.getElementById(v);if(!w||!(w instanceof SVGElement))continue;let h=w.parentElement?getComputedStyle(w.parentElement):null,k=c(w,h,!1);k&&m.appendChild(k)}}m.childNodes.length&&d.insertBefore(m,d.firstChild),l>2500&&o.add("сложность (элементов: "+l+")"),f>4e5&&o.add("объём путей");let p=new XMLSerializer().serializeToString(d),b=getComputedStyle(e);return{markup:p,reasons:[...o],elements:l,pathChars:f,hasText:a,externalImages:s,overflowVisible:b.overflowX==="visible"||b.overflow==="visible"}}function un(e){let t=String(e).trim().split(/\\s+/).map(o=>o==="normal"?400:o==="bold"?700:parseFloat(o)),n=Number.isFinite(t[0])?t[0]:400,r=t.length>1&&Number.isFinite(t[1])?t[1]:n;return[Math.min(n,r),Math.max(n,r)]}function fn(e,t,n){if(!e.length)return null;let r=n?e.filter(a=>a.italic):e.filter(a=>!a.italic&&!a.oblique);!r.length&&n&&(r=e.filter(a=>a.oblique)),r.length||(r=n?e.filter(a=>!a.italic&&!a.oblique):e.filter(a=>a.oblique)),r.length||(r=e);let o=n&&!r.some(a=>a.italic||a.oblique),i=r.find(a=>t>=a.weightMin&&t<=a.weightMax),s,l;if(i)s=i,l=t;else{let a=m=>t<m.weightMin?m.weightMin:m.weightMax,u=r.filter(m=>m.weightMax<t).sort((m,g)=>g.weightMax-m.weightMax),c=r.filter(m=>m.weightMin>t).sort((m,g)=>m.weightMin-g.weightMin),d;if(t>=400&&t<=500){let m=c.filter(R=>R.weightMin<=500),g=c.filter(R=>R.weightMin>500);d=[...m,...u,...g]}else t<400?d=[...u,...c]:d=[...c,...u];s=d[0],l=a(s)}let f=t>=600&&l<=500;return{face:s,weight:l,syntheticBold:f,syntheticItalic:o}}var mr=document.createElement("canvas"),dn=mr.getContext("2d"),mt=new Map,pn=new Map,Re=null;function wn(e){return e.replace(/^[\'"]|[\'"]$/g,"").trim().toLowerCase()}function gr(){if(Re)return Re;Re=new Map;try{document.fonts.forEach(e=>{let t=wn(e.family),[n,r]=un(e.weight),o=e.style.toLowerCase(),i=Re.get(t)??[];i.push({weightMin:n,weightMax:r,italic:o.includes("italic"),oblique:o.includes("oblique"),status:e.status}),Re.set(t,i)})}catch{}return Re}function ie(e,t){return dn.font=e,dn.measureText(t).width}function Sn(e,t,n){let r=`${e}|${t}|${n}`,o=pn.get(r);if(o!==void 0)return o;let i="mmmmmmmmmmlli10WQ",s=`${n?"italic ":""}${t} 40px "${e.replace(/"/g,\'\\\\"\')}"`,l=ie(`${s}, monospace`,i),f=ie(`${s}, serif`,i),a=ie(`${s}, sans-serif`,i);if(o=l===f&&f===a,!o){let u="ЖЖЖЖЖшшшщщ",c=ie(`${s}, monospace`,u),d=ie(`${s}, serif`,u),m=ie(`${s}, sans-serif`,u);o=c===d&&d===m}return pn.set(r,o),o}function br(e,t,n,r){let o=`${e}|${t}|${n}|${r}`,i=mt.get(o);if(i!==void 0)return i;if(!Sn(e,t,n))return mt.set(o,!1),!1;let s=`${n?"italic ":""}${t} 40px "${e.replace(/"/g,\'\\\\"\')}"`,l=ie(`${s}, monospace`,r),f=ie(`${s}, serif`,r),a=ie(`${s}, sans-serif`,r);return i=l===f&&f===a,mt.set(o,i),i}var Oe=new Map,Xe=new Map;function hn(e,t,n,r){let o=Xe.get(e)??{system:new Set,chars:new Set};n&&(o.generic=n),r&&o.system.add(r),/^\\s$/.test(t)||o.chars.add(t),Xe.set(e,o)}function Mn(){return[...Oe.values()]}function yt(e,t){let n=/^\\s$/.test(t),r=null,o;for(let l of e.families){if(en(l)){o=l.toLowerCase();break}if(n?Sn(l,e.weight,e.italic):br(l,e.weight,e.italic,t)){r=l;break}}if(!r&&!o&&(o="default"),r){let l=gr().get(wn(r)),f=e.weight,a=e.italic,u="system",c=!1,d=[];if(l&&l.length){u="webfont";let R=l.filter(b=>b.status==="loaded"),p=fn(R.length?R:l,e.weight,e.italic);p&&(f=p.weight,a=p.face.italic||p.face.oblique,c=p.face.weightMax>p.face.weightMin,p.syntheticBold&&d.push("bold"),p.syntheticItalic&&(d.push("italic"),a=!1))}let m=`${r}|${f}|${a?"i":"n"}`,g=Oe.get(m);return g||(g={key:m,family:r,weight:f,italic:a,source:u,variable:c,synthetic:d.length?d:void 0},Oe.set(m,g)),u==="system"&&hn(e.el,t,void 0,m),g}let i=`@${o}|${e.weight}|${e.italic?"i":"n"}`;hn(e.el,t,o,void 0);let s=Oe.get(i);return s||(s={key:i,family:"",generic:o,weight:e.weight,italic:e.italic,source:"generic"},Oe.set(i,s)),s}var mn=new Map,gn=new Map,de=null;function yr(e){let t=`${e.fontFamily}|${e.fontSize}|${e.fontWeight}|${e.fontStyle}`,n=gn.get(t);if(n!==void 0)return n;de||(de=document.createElement("div"),de.setAttribute("data-h2f-probe",""),de.style.cssText="position:absolute!important;left:-100000px!important;top:0!important;visibility:hidden!important;contain:layout style!important;pointer-events:none!important;",document.documentElement.appendChild(de));let r=document.createElement("div");return r.style.cssText=`all:initial;display:block;white-space:pre;font-family:${e.fontFamily};font-size:${e.fontSize};font-weight:${e.fontWeight};font-style:${e.fontStyle};line-height:normal;`,r.textContent=`Hg\nHg`,de.appendChild(r),n=r.getBoundingClientRect().height/2,r.remove(),gn.set(t,n),n}function kn(){de?.remove(),de=null}function xr(e,t){let n=e,r={overline:!1};for(;n;){let o=getComputedStyle(n),i=o.textDecorationLine;if(i&&i!=="none"&&(!r.line&&i.includes("underline")?r.line="UNDERLINE":!r.line&&i.includes("line-through")&&(r.line="STRIKETHROUGH"),i.includes("overline")&&(r.overline=!0),r.line&&!r.color)){r.color=_(o.textDecorationColor)??void 0,r.style=o.textDecorationStyle;let s=o.textDecorationThickness;s&&s.endsWith("px")&&(r.thickness=parseFloat(s))}if(n===t){let s=o.display,l=o.position,f=o.cssFloat;if(/inline-|table|flex|grid/.test(s)&&s!=="inline"||l==="absolute"||l==="fixed"||f!=="none")break;t=n.parentElement}if(n=n.parentElement,!n||n===document.documentElement)break}return r}function Ee(e,t){let n=mn.get(e);if(n)return n;let r=getComputedStyle(e),o=C(r.fontSize),i;r.lineHeight==="normal"?i=yr(r):/^[\\d.]+$/.test(r.lineHeight)?i=parseFloat(r.lineHeight)*o:i=C(r.lineHeight);let s=_(r.color)??{r:0,g:0,b:0,a:1},l=r.getPropertyValue("-webkit-text-fill-color"),f=!1,a=_(l);if(a&&l!==r.color)if(a.a===0){let p=e;for(;p&&p!==t.parentElement;){let b=getComputedStyle(p);if(b.backgroundClip==="text"||b.getPropertyValue("-webkit-background-clip")==="text"){let S=/(rgba?\\([^)]*\\)|color\\([^)]*\\)|oklch\\([^)]*\\)|oklab\\([^)]*\\))/.exec(b.backgroundImage),v=S?_(S[1]):_(b.backgroundColor);v&&(s=v,f=!0);break}p=p.parentElement}f||(s=a)}else s=a;let u=1;for(let p=e;p&&p!==t;p=p.parentElement){let b=getComputedStyle(p);(b.display==="inline"||b.display==="contents")&&(u*=parseFloat(b.opacity))}s={...s,a:s.a*u};let c=xr(e,t),d,m=e.closest("a[href]");m&&/^(https?:|mailto:)/i.test(m.href)&&!m.href.startsWith(location.origin)&&(d=m.href);let g=C(r.getPropertyValue("-webkit-text-stroke-width")),R={el:e,families:Jt(r.fontFamily),size:o,weight:parseInt(r.fontWeight,10)||400,italic:r.fontStyle.startsWith("italic")||r.fontStyle.startsWith("oblique"),color:s,lineHeight:i,letterSpacing:r.letterSpacing==="normal"?0:C(r.letterSpacing),wordSpacing:r.wordSpacing==="normal"?0:C(r.wordSpacing),transform:r.textTransform,decoration:c.line,decorationColor:c.color,decorationStyle:c.style==="dotted"?"DOTTED":c.style==="wavy"?"WAVY":"SOLID",decorationThickness:c.thickness,overline:c.overline,link:d,visible:r.visibility==="visible",smallCaps:r.fontVariantCaps!=="normal",verticalAlign:r.verticalAlign,lang:e.closest("[lang]")?.getAttribute("lang")||document.documentElement.lang||"und",shadow:r.textShadow,stroke:g>0?{color:_(r.getPropertyValue("-webkit-text-stroke-color"))??s,width:g}:void 0,gradientText:f};return mn.set(e,R),R}function bn(e,t,n,r){try{if(t==="uppercase")return e.toLocaleUpperCase(n);if(t==="lowercase")return e.toLocaleLowerCase(n);if(t==="capitalize"&&r)return e.toLocaleUpperCase(n)}catch{}return t==="uppercase"?e.toUpperCase():t==="lowercase"?e.toLowerCase():t==="capitalize"&&r?e.toUpperCase():e}var gt=document.createRange();function Rn(e,t,n,r,o){let i=[],s=!1,l="",f=n?-1:0;for(let a of e){if(a.kind==="break"||a.kind==="br"){s=!0,l=" ";continue}if(a.kind==="inline-start"||a.kind==="inline-end"){a.hard&&(s=!0);continue}let u=a.node,c=u.parentElement;if(!c)continue;let d=Ee(c,t),m=u.data,g=getComputedStyle(c).whiteSpace,R=g==="pre"||g==="pre-wrap"||g==="break-spaces";for(let p=0;p<m.length;){if(r.chars>=o)return r.limitHit=!0,i;let S=m.codePointAt(p)>65535?2:1,v=m.slice(p,p+S);gt.setStart(u,p),gt.setEnd(u,p+S);let w=gt.getClientRects(),h=null;for(let T=0;T<w.length;T++)(w[T].width>0||!h)&&(h=w[T]);if(p+=S,v==="­"){h&&h.width>0&&i.length&&(i[i.length-1].softHyphen=!0);continue}let k=/\\s/.test(v)&&v!==" ";if((!h||h.width===0&&h.height===0)&&(k||!h)||k&&h.width<=.01)continue;if(v==="	"){s=!0,l=" ";continue}if(!d.visible){s=!0;continue}let M=k?R&&v!==`\n`?v:" ":v;if(v===`\n`&&!R&&(M=" "),v===`\n`&&R){s=!0;continue}let P=!l||/[\\s \\-–—(«"\'“„]/.test(l);M=bn(M,d.transform,d.lang,P);let L=d,x=!1;n&&f!==0&&(f===-1&&(f=1),L=n.st,x=!0,/[\\p{L}\\p{N}]/u.test(v)&&(f=0),M=bn(v,L.transform,L.lang,!0)),r.chars++,i.push({ch:M,x:h.left+scrollX,y:h.top+scrollY,w:h.width,h:h.height,st:L,font:yt(L,M),node:u,offset:p-S,breakBefore:s||void 0,firstLetter:x||void 0}),s=!1,l=v}}return i}function yn(e){let t=[],n=null;for(let r of e){if(n){let o=n.chars[n.chars.length-1],i=Math.min(n.bottom,r.y+r.h)-Math.max(n.top,r.y),s=Math.min(r.h,o.h)||1,l=r.x+.5<o.x&&r.y>o.y+.25*o.h;(i<.3*s||l)&&(t.push(n),n=null)}n||(n={chars:[],top:r.y,bottom:r.y+r.h,left:r.x,right:r.x+r.w}),n.chars.push(r),n.top=Math.min(n.top,r.y),n.bottom=Math.max(n.bottom,r.y+r.h),n.left=Math.min(n.left,r.x),n.right=Math.max(n.right,r.x+r.w)}return n&&t.push(n),t}function xn(e){let t=[],n=[],r=()=>{if(!n.length)return;for(;n.length>1&&n[n.length-1].ch===" ";)n.pop();for(;n.length>1&&n[0].ch===" ";)n.shift();if(n.length===1&&n[0].ch===" "){n=[];return}let o=Math.max(...n.map(s=>s.st.size)),i=n.find(s=>s.st.size===o);t.push({chars:n,left:Math.min(...n.map(s=>s.x)),right:Math.max(...n.map(s=>s.x+s.w)),line:e,maxSize:o,ref:i,firstLetter:!!n[0].firstLetter}),n=[]};for(let o of e.chars){if(n.length){let i=n[n.length-1],s=o.x-(i.x+i.w),l=Math.max(1.5,.35*Math.max(o.st.size,i.st.size))+Math.max(0,i.st.letterSpacing)+Math.max(0,i.st.wordSpacing),f=Math.max(o.st.size,i.st.size)/Math.max(.01,Math.min(o.st.size,i.st.size))>1.3,a=!!o.firstLetter!=!!i.firstLetter,u=Math.abs(o.y+o.h/2-(i.y+i.h/2))>.35*Math.max(o.h,i.h);(o.breakBefore||s>l||s<-Math.max(2,.5*i.w)||f||a||u)&&r()}n.push(o)}return r(),t}function wr(e,t){let n=t==="rtl";switch(e){case"center":case"-webkit-center":return"CENTER";case"right":case"-webkit-right":return"RIGHT";case"end":return n?"LEFT":"RIGHT";case"start":return n?"RIGHT":"LEFT";default:return"LEFT"}}function bt(e,t,n){let r="",o=[],i=(d,m,g)=>{let R=o[o.length-1];R&&R.st===m&&R.font===g?R.end+=d.length:o.push({start:r.length,end:r.length+d.length,st:m,font:g}),r+=d};e.forEach((d,m)=>{if(m>0){let g=o[o.length-1];i(`\n`,g.st,g.font)}d.chars.forEach((g,R)=>{if(i(g.ch,g.st,g.font),R===d.chars.length-1&&m<e.length-1){let p=e[m+1].chars[0],b=/[\\p{L}]/u.test(g.ch)&&p&&/[\\p{L}]/u.test(p.ch);(g.softHyphen||b&&getComputedStyle(g.st.el).hyphens==="auto")&&i("-",g.st,g.font)}})});let s=e.length>1?(e[e.length-1].ref.y+e[e.length-1].ref.h/2-(e[0].ref.y+e[0].ref.h/2))/(e.length-1):e[0].ref.st.lineHeight,l=Math.max(.5,s||e[0].ref.st.lineHeight||e[0].maxSize*1.2),f=e[0].ref,a=f.y+f.h/2-l/2,u=Math.min(...e.map(d=>d.left)),c=Math.max(...e.map(d=>d.right));return{x:u,y:a,w:c-u,h:l*e.length,text:r,runs:o,lineHeight:l,align:t,lines:e.length,name:n}}function En(e,t){if(!e.length)return[];let n=wr(t.align,t.direction);if(t.vertical){let a=yn(e).flatMap(xn);if(!a.length)return[];let u=bt([{...a[0],chars:a.flatMap(b=>b.chars)}],"LEFT",t.name),c=e.map(b=>b.x),d=e.map(b=>b.y),m=Math.min(...c),g=Math.max(...e.map(b=>b.x+b.w)),R=Math.min(...d),p=Math.max(...e.map(b=>b.y+b.h));return[{...u,x:m,y:R,w:p-R,h:g-m,lineHeight:g-m,vertical:!0}]}let r=yn(e),o=[],i=[],s=()=>{i.length&&o.push(bt(i,n,t.name)),i=[]},l=a=>n==="LEFT"?a.left:n==="RIGHT"?a.right:(a.left+a.right)/2,f=a=>a.ref.y+a.ref.h/2;for(let a of r){let u=xn(a);if(u.length!==1||u[0].firstLetter){s();for(let d of u)o.push(bt([d],d.firstLetter?"LEFT":n,t.name));continue}let c=u[0];if(i.length){let d=i[i.length-1],m=n==="CENTER"?1.5:1,g=f(c)-f(d),R=i.length===1?g>.5*d.maxSize&&g<2.2*Math.max(d.ref.st.lineHeight,d.maxSize):Math.abs(g-(f(d)-f(i[i.length-2])))<.75,p=Math.abs(c.maxSize-d.maxSize)<.01&&c.ref.st.lineHeight===d.ref.st.lineHeight;(Math.abs(l(c)-l(d))>m||!R||!p)&&s()}i.push(c)}if(s(),t.clamp&&o.length){let a=o[0];if(a.lines>t.clamp){let u=a.text.split(`\n`).slice(0,t.clamp+1).join(`\n`);a.text=u,a.runs=a.runs.filter(c=>c.start<u.length).map(c=>({...c,end:Math.min(c.end,u.length)})),a.lines=t.clamp+1,a.h=a.lineHeight*t.clamp,a.truncate=t.clamp}o.length=1}return t.ellipsis&&o.length===1&&o[0].lines===1&&(o[0].truncate=1,o[0].fixedWidth=t.ellipsis.width),o}function vn(e){return e.shadow&&e.shadow!=="none"?ke(e.shadow,!1):[]}var y=null;function N(e,t,n,r){if(!y)return;let o=t+"|"+n,i=y.diags.get(o);if(i){i.count=(i.count??1)+1;return}y.diags.set(o,{level:e,code:t,message:n,node:r,count:1})}function pe(e,t){let n=y.assetKey.get(e);if(n)return n;let r="ref"+y.assets.size;return y.assets.set(r,t),y.assetKey.set(e,r),r}function xt(e){if(e.shadowRoot)return Array.from(e.shadowRoot.childNodes);if(e.tagName==="SLOT"){let t=e.assignedNodes({flatten:!0});return t.length?t:Array.from(e.childNodes)}return Array.from(e.childNodes)}var Cn=new Set(["IMG","CANVAS","VIDEO","IFRAME","EMBED","OBJECT","INPUT","TEXTAREA","SELECT","METER","PROGRESS"]);function Sr(e,t){let n=y.poses.get(e);if(!n)return;let r=parseFloat(t.opacity);(parseFloat(n.opacity)>r+.01||t.visibility==="hidden"&&n.visibility!=="hidden")&&(t.opacity=n.opacity,t.visibility=n.visibility,t.transform=n.transform,t.translate=n.translate,t.rotate=n.rotate,t.scale=n.scale,t.filter=n.filter,y.stats.revealPoses=(y.stats.revealPoses??0)+1)}function Mr(e,t){if(!e||e==="none"||e==="normal")return null;let n="",r=/"((?:[^"\\\\]|\\\\.)*)"|\'((?:[^\'\\\\]|\\\\.)*)\'|attr\\(([^)]+)\\)|(open-quote|close-quote|no-open-quote|no-close-quote)|counters?\\([^)]*\\)|url\\([^)]*\\)|(\\S+)/g,o,i=!1;for(;o=r.exec(e);)if(o[1]!==void 0||o[2]!==void 0){let s=o[1]??o[2];n+=s.replace(/\\\\([0-9a-fA-F]{1,6})\\s?/g,(l,f)=>String.fromCodePoint(parseInt(f,16))).replace(/\\\\(.)/g,"$1")}else o[3]?n+=t.getAttribute(o[3].trim())??"":o[4]?n+=o[4]==="open-quote"?"«":o[4]==="close-quote"?"»":"":o[0].startsWith("counter")?i=!0:o[0].startsWith("url(")||o[5]&&o[5]!=="/"&&(i=!0);return i&&N("info","pseudo-counter","Счётчики CSS (counter()) в content псевдоэлементов не вычисляются",z(t)),n}function kr(e,t){let n=t["list-style-type"];if(!n||n==="none")return"";let r=1,o=e.parentElement;if(o&&o.tagName==="OL"){let l=parseInt(o.getAttribute("start")??"1",10)||1,f=Array.from(o.children).filter(u=>getComputedStyle(u).display==="list-item");r=l+Math.max(0,f.indexOf(e));let a=e.getAttribute("value");a&&(r=parseInt(a,10)||r)}let i=l=>{let f="";for(;l>0;)l--,f=String.fromCharCode(97+l%26)+f,l=Math.floor(l/26);return f},s=l=>{let f=[[1e3,"m"],[900,"cm"],[500,"d"],[400,"cd"],[100,"c"],[90,"xc"],[50,"l"],[40,"xl"],[10,"x"],[9,"ix"],[5,"v"],[4,"iv"],[1,"i"]],a="";for(let[u,c]of f)for(;l>=u;)a+=c,l-=u;return a};switch(n){case"disc":return"•";case"circle":return"◦";case"square":return"▪";case"decimal":return r+".";case"decimal-leading-zero":return String(r).padStart(2,"0")+".";case"lower-alpha":case"lower-latin":return i(r)+".";case"upper-alpha":case"upper-latin":return i(r).toUpperCase()+".";case"lower-roman":return s(r)+".";case"upper-roman":return s(r).toUpperCase()+".";default:return/^["\']/.test(n)?n.slice(1,-1):"•"}}function Rr(e){let t=e.filter(n=>{try{return document.querySelector(n),!0}catch{return!1}});return n=>t.some(r=>{try{return!!n.closest(r)}catch{return!1}})}async function An(e,t,n){y={opts:e,recs:[],byEl:new Map,textOrder:new Map,order:0,diags:new Map,assets:new Map,assetKey:new Map,bgSizes:new Map,poses:t,hoverCard:n.card,hoverPoint:n.point,rootRecs:[],nodeCount:0,limitHit:!1,chars:{chars:0,limitHit:!1},styleSheet:null,neutralSheet:null,geometryShift:0,mismatches:[],stats:{},canvasBg:"",bodyRecNeeded:!1,shots:0},window.scrollTo({top:0,left:0,behavior:"instant"}),(scrollY!==0||scrollX!==0)&&N("warn","scroll-locked",`Страница не вернулась в начало прокрутки (scrollY=${scrollY}); координаты учитывают смещение`),y.styleSheet=document.createElement("style"),y.styleSheet.setAttribute("data-h2f","freeze"),y.styleSheet.textContent="*,*::before,*::after{transition:none!important;caret-color:transparent!important}",document.documentElement.appendChild(y.styleSheet);let r=Rr(e.exclude),o=document.documentElement,i=document.body,s=getComputedStyle(o),l=i?getComputedStyle(i):s,f=_(s.backgroundColor),a=f&&f.a>0||s.backgroundImage!=="none";if(y.canvasBg=a?"html":"body",a&&i){let p=_(l.backgroundColor);y.bodyRecNeeded=p&&p.a>0||l.backgroundImage!=="none"}if(i){let p=we(l);(p["box-shadow"]!=="none"||C(p["border-top-width"])||C(p["border-left-width"])||me(p)||parseFloat(p.opacity)<1||Se(p)&&!1)&&(y.bodyRecNeeded=!0)}let u=0,c=(p,b,S,v)=>{if(y.nodeCount>e.maxNodes){y.limitHit=!0;return}if(p.nodeType===Node.TEXT_NODE){y.textOrder.set(p,y.order++),S&&S.items.push({kind:"text",node:p});return}if(p.nodeType!==Node.ELEMENT_NODE)return;let w=p;if(_t.has(w.tagName)||w.hasAttribute("data-h2f-probe")||w.getAttribute("data-h2f")==="freeze"||w.tagName==="INPUT"&&w.type==="hidden")return;if(r(w)){y.stats.excluded=(y.stats.excluded??0)+1;return}let h=getComputedStyle(w);if(h.display==="none")return;let k=w===o||w===i&&!y.bodyRecNeeded;if(w.tagName==="BR"){S&&S.items.push({kind:"br"});return}if(h.display==="contents"||k){let E=w!==o;E&&m(w,h,b,k?null:S,v);for(let I of xt(w))c(I,b,k?null:S,v);E&&g(w,b,k?null:S,v);return}let M=we(h);Sr(w,M);let P=w instanceof SVGSVGElement&&!(w.parentElement instanceof SVGElement);if(w instanceof SVGElement&&!P)return;let L=Vt(M.display)&&!Cn.has(w.tagName)&&!P,x={id:y.recs.length,el:w,s:M,kind:L?"inline":"box",parent:b,figmaParent:null,order:y.order++,endOrder:0,items:[],children:[],inlines:[],texts:[],sc:!1,fixed:M.position==="fixed",sticky:M.position==="sticky",cb:null,hasText:!1,depth:v,replaced:P?"SVG":Cn.has(w.tagName)?w.tagName:void 0};y.recs.push(x),y.byEl.set(w,x),y.nodeCount++;let T=w.getBoundingClientRect();if(x.aabbA={x:T.left+scrollX,y:T.top+scrollY,w:T.width,h:T.height},x.sc=st(M,b?b.s.display:"block"),y.hoverCard===w&&(x.hoverCard=!0),L){let E=C(M["padding-left"])+C(M["padding-right"])+C(M["border-left-width"])+C(M["border-right-width"])+Math.abs(C(M["margin-left"]))+Math.abs(C(M["margin-right"]))>.5;(S??b)?.inlines.push(x),S&&S.items.push({kind:"inline-start",el:w,hard:E}),m(w,h,b,S,v);for(let I of xt(w))c(I,b,S,v+1);g(w,b,S,v),S&&S.items.push({kind:"inline-end",el:w,hard:E}),x.endOrder=y.order++;return}if(S&&S.items.push({kind:"break"}),(b?b.children:y.rootRecs).push(x),P){let E=w,I=C(M["border-left-width"])+C(M["border-right-width"])+C(M["padding-left"])+C(M["padding-right"]),G=C(M["border-top-width"])+C(M["border-bottom-width"])+C(M["padding-top"])+C(M["padding-bottom"]),A=C(M.width),F=C(M.height);M["box-sizing"]==="border-box"&&(A-=I,F-=G),(!(A>0)||!(F>0))&&(A=Math.max(0,T.width-I),F=Math.max(0,T.height-G)),x.svgContent={w:A,h:F};try{x.svg=cn(E,A,F)}catch(W){N("warn","svg-serialize","Не удалось сериализовать SVG: "+String(W).slice(0,120),z(w))}x.endOrder=y.order++;return}if(x.replaced){x.endOrder=y.order++;return}m(w,h,x,x,v+1);for(let E of xt(w))c(E,x,x,v+1);g(w,x,x,v+1),x.endOrder=y.order++},d=(p,b,S,v,w)=>{let h=we(S),k=b==="marker"?kr(p,we(getComputedStyle(p))):Mr(h.content,p);if(k===null)return null;let M={id:y.recs.length,el:p,pseudo:b,s:h,kind:"box",parent:v,figmaParent:null,order:y.order++,endOrder:0,items:[],children:[],inlines:[],texts:[],sc:st(h,v?v.s.display:"block"),fixed:h.position==="fixed",sticky:h.position==="sticky",cb:null,hasText:!!k.trim(),depth:w,pseudoText:k};return M.endOrder=M.order,y.recs.push(M),y.nodeCount++,p.hasAttribute("data-h2f-p")||(p.setAttribute("data-h2f-p",String(y.byEl.get(p)?.id??"x"+M.id)),u++),M};function m(p,b,S,v,w){if(b.display==="list-item"&&b.listStyleType!=="none"){let k=d(p,"marker",getComputedStyle(p,"::marker"),S,w);k&&(S?S.children:y.rootRecs).push(k)}let h=getComputedStyle(p,"::before");if(h.content!=="none"&&h.content!=="normal"&&h.display!=="none"){let k=d(p,"before",h,S,w);k&&((S?S.children:y.rootRecs).push(k),v&&v.items.push({kind:"break"}))}}function g(p,b,S,v){let w=getComputedStyle(p,"::after");if(w.content!=="none"&&w.content!=="normal"&&w.display!=="none"){let h=d(p,"after",w,b,v);h&&((b?b.children:y.rootRecs).push(h),S&&S.items.push({kind:"break"}))}}c(o,null,null,0);for(let p of y.recs)if(p.s.position==="absolute"||p.s.position==="fixed"){let b=p.s.position==="fixed",S=b?"viewport":null;for(let v=p.pseudo?y.byEl.get(p.el)??p.parent:p.parent;v;v=v.parent)if(v.kind==="box"&&it(v.s,b)){S=v;break}p.pseudo&&y.byEl.get(p.el)?.kind==="box"&&it(y.byEl.get(p.el).s,b)&&(S=y.byEl.get(p.el)),p.cb=S,b&&S!=="viewport"&&(p.fixed=!1)}let R=new Set;for(let p of y.recs)for(let b of Ke(p.s["background-image"]))R.add(b);for(let p of Ke(s.backgroundImage))R.add(p);if(i)for(let p of Ke(l.backgroundImage))R.add(p);return await Promise.all([...R].map(p=>new Promise(b=>{let S=new Image,v=()=>{y.bgSizes.set(p,{w:S.naturalWidth,h:S.naturalHeight}),b()};S.onload=v,S.onerror=()=>{y.bgSizes.set(p,{w:0,h:0}),b()},S.src=p,setTimeout(v,4e3)}))),{recs:y.recs.length,pseudoMarked:u,bgUrls:R.size,limitHit:y.limitHit}}function Ke(e){let t=[],n=/url\\(\\s*"((?:[^"\\\\]|\\\\.)*)"\\s*\\)|url\\(\\s*\'([^\']*)\'\\s*\\)|url\\(\\s*([^)"\']+)\\s*\\)/g,r;for(;r=n.exec(e??"");)t.push((r[1]??r[2]??r[3]).replace(/\\\\(.)/g,"$1"));return t}function In(e){if(y)if(e){for(let t of y.recs)t.kind==="box"&&!t.pseudo&&me(t.s)&&t.el.setAttribute("data-h2f-tf","");y.neutralSheet=document.createElement("style"),y.neutralSheet.setAttribute("data-h2f","neutral"),y.neutralSheet.textContent="[data-h2f-tf]{transform:none!important;translate:none!important;rotate:none!important;scale:none!important;will-change:transform!important}*::before,*::after,*::marker{transform:none!important;translate:none!important;rotate:none!important;scale:none!important}",document.documentElement.appendChild(y.neutralSheet)}else{y.neutralSheet?.remove(),y.neutralSheet=null;for(let t of Array.from(document.querySelectorAll("[data-h2f-tf]")))t.removeAttribute("data-h2f-tf")}}function Er(e){if(!e||e.length<8)return;let t=[e[0],e[2],e[4],e[6]],n=[e[1],e[3],e[5],e[7]],r=Math.min(...t),o=Math.min(...n);return{x:r+scrollX,y:o+scrollY,w:Math.max(...t)-r,h:Math.max(...n)-o}}function Fn(e){if(!y)throw new Error("capture not started");let t=new Map;for(let n of Array.from(document.querySelectorAll("[data-h2f-p]"))){let r=e[n.getAttribute("data-h2f-p")];r&&t.set(n,r)}for(let n of y.recs){if(n.pseudo){let o=t.get(n.el);n.layout=Er(o?.[n.pseudo]);continue}let r=n.el.getBoundingClientRect();n.layout={x:r.left+scrollX,y:r.top+scrollY,w:r.width,h:r.height},n.kind==="inline"&&(n.frags=Array.from(n.el.getClientRects()).map(o=>({x:o.left+scrollX,y:o.top+scrollY,w:o.width,h:o.height})).filter(o=>o.w>0||o.h>0))}for(let n of y.recs){if(n.kind!=="box"||n.pseudo||!n.items.some(u=>u.kind==="text"))continue;let r=Cr(n),o=Rn(n.items,n.el,r,y.chars,y.opts.maxChars);if(!o.length)continue;let i=n.s,s=i["-webkit-line-clamp"]&&i["-webkit-line-clamp"]!=="none"?parseInt(i["-webkit-line-clamp"],10):null,l=n.el,f=i["text-overflow"]==="ellipsis"&&Se(i)&&l.scrollWidth>l.clientWidth+1&&/nowrap|pre/.test(i["white-space"])?{width:Math.max(1,n.layout.w-C(i["padding-left"])-C(i["padding-right"])-C(i["border-left-width"])-C(i["border-right-width"]))}:null,a=i["writing-mode"].startsWith("vertical")||i["writing-mode"].startsWith("sideways");a&&N("info","vertical-text","Вертикальный текст перенесён поворотом строки на 90°",z(n.el)),i["text-align"]==="justify"&&N("info","justify","Выравнивание по ширине перенесено как по левому краю (переносы строк сохранены)",z(n.el)),n.texts=En(o,{align:i["text-align"],direction:i.direction,clamp:s,ellipsis:f,vertical:a,name:vr(o)}),n.hasText=n.texts.length>0,n.textOrder=y.textOrder.get(o[0].node)??n.order}y.chars.limitHit&&N("warn","text-limit",`Достигнут лимит символов на страницу (${y.opts.maxChars}); остальной текст пропущен`),kn()}function vr(e){return e.slice(0,60).map(t=>t.ch).join("").replace(/\\s+/g," ").trim().slice(0,48)||"Текст"}function Cr(e){let t=getComputedStyle(e.el,"::first-letter"),n=getComputedStyle(e.el);if(t.fontSize===n.fontSize&&t.fontFamily===n.fontFamily&&t.color===n.color&&t.cssFloat==="none"&&t.fontWeight===n.fontWeight)return null;let r=Ee(e.el,e.el),o=C(t.fontSize),i=t.lineHeight==="normal"?o*1.2:/^[\\d.]+$/.test(t.lineHeight)?parseFloat(t.lineHeight)*o:C(t.lineHeight);i>0||(i=o*1.2);let s={...r,families:t.fontFamily.split(",").map(l=>l.trim().replace(/^[\'"]|[\'"]$/g,"")),size:o,weight:parseInt(t.fontWeight,10)||400,italic:t.fontStyle.startsWith("italic"),color:_(t.color)??r.color,lineHeight:i,letterSpacing:t.letterSpacing==="normal"?0:C(t.letterSpacing),transform:t.textTransform};return y.stats.firstLetters=(y.stats.firstLetters??0)+1,{st:s,count:1}}var Nn=0,Z=()=>"n"+(Nn++).toString(36);function wt(e,t=1){return e.a*t<=0?null:{type:"SOLID",color:{r:e.r,g:e.g,b:e.b},opacity:Math.min(1,e.a*t)}}function se(e){let t=[],n=0,r="";for(let o of e){if(o==="("&&n++,o===")"&&n--,o===","&&n===0){t.push(r.trim()),r="";continue}r+=o}return t.push(r.trim()),t}function Ce(e,t){e=e.trim();let n=/^calc\\((.*)\\)$/.exec(e);if(n){let r=0,o=/([+-]?)\\s*([\\d.]+)(%|px)/g,i;for(;i=o.exec(n[1]);)r+=(i[1]==="-"?-1:1)*(i[3]==="%"?parseFloat(i[2])/100*t:parseFloat(i[2]));return r}return e.endsWith("%")?parseFloat(e)/100*t:parseFloat(e)||0}function Ln(e,t,n,r){let o=[],i=[],s=parseFloat(e["border-left-width"])||0,l=parseFloat(e["border-top-width"])||0,f=parseFloat(e["border-right-width"])||0,a=parseFloat(e["border-bottom-width"])||0,u=C(e["padding-left"]),c=C(e["padding-top"]),d=C(e["padding-right"]),m=C(e["padding-bottom"]),g=_(e["background-color"]);e["background-color"]&&!g&&N("warn","color-parse",`Нераспознанный цвет фона: ${e["background-color"]}`,r);let R=E=>E==="padding-box"?{x:s,y:l,w:t-s-f,h:n-l-a}:E==="content-box"?{x:s+u,y:l+c,w:t-s-f-u-d,h:n-l-a-c-m}:{x:0,y:0,w:t,h:n},p=se(e["background-clip"]);if(g&&g.a>0){let E=R(p[p.length-1]??"border-box");E.x<.5&&E.y<.5&&Math.abs(E.w-t)<.5&&Math.abs(E.h-n)<.5?o.push(wt(g)):E.w>0&&E.h>0&&i.push({kind:"rect",id:Z(),name:"Фон",m:q(E.x,E.y),w:E.w,h:E.h,fills:[wt(g)]})}let b=e["background-image"];if(!b||b==="none")return{fills:o,under:i};let S=se(b),v=se(e["background-size"]),w=se(e["background-position-x"]),h=se(e["background-position-y"]),k=se(e["background-repeat"]),M=se(e["background-origin"]),P=se(e["background-blend-mode"]),L=se(e["background-attachment"]),x=(E,I)=>E[I%E.length],T=[];for(let E=S.length-1;E>=0;E--){let I=S[E];if(I==="none")continue;x(L,E)==="fixed"&&N("info","bg-fixed","background-attachment: fixed перенесён как обычный фон",r);let G=x(M,E),A=G==="border-box"?{x:0,y:0,w:t,h:n}:G==="content-box"?{x:s+u,y:l+c,w:t-s-f-u-d,h:n-l-a-c-m}:{x:s,y:l,w:t-s-f,h:n-l-a},F=R(x(p,E));if(A.w<=0||A.h<=0||F.w<=0||F.h<=0)continue;let W=pt[x(P,E)]??"NORMAL",K=Ke(I),Q=x(v,E).split(/\\s+/),ne=x(k,E).split(/\\s+/),U=ne[0],j=ne[1]??(ne[0]==="repeat-x"?"no-repeat":ne[0]==="repeat-y"?"repeat":ne[0]),X=U==="repeat-x"?"repeat":U==="repeat-y"?"no-repeat":U,O=U==="repeat-x"?"no-repeat":U==="repeat-y"?"repeat":j,H={w:A.w,h:A.h},te=!1;if(K.length===1&&I.startsWith("url(")){let D=y.bgSizes.get(K[0]);D&&D.w>0&&D.h>0&&(H=D,te=!0)}let $,B;if(Q[0]==="cover"||Q[0]==="contain"){let D=Q[0]==="cover"?Math.max(A.w/H.w,A.h/H.h):Math.min(A.w/H.w,A.h/H.h);$=H.w*D,B=H.h*D}else{let D=Q[0]??"auto",ae=Q[1]??"auto";$=D==="auto"?NaN:Ce(D,A.w),B=ae==="auto"?NaN:Ce(ae,A.h),Number.isNaN($)&&Number.isNaN(B)?($=te?H.w:A.w,B=te?H.h:A.h):Number.isNaN($)?$=te?B*H.w/H.h:A.w:Number.isNaN(B)&&(B=te?$*H.h/H.w:A.h)}if(!($>0)||!(B>0))continue;let J=A.x+Ce(x(w,E).replace(/^(left|right)\\s+/,""),A.w-$),ee=A.y+Ce(x(h,E).replace(/^(top|bottom)\\s+/,""),A.h-B),Et=/^(repeating-)?(linear|radial|conic)-gradient\\(/.test(I),vt=Math.abs($-A.w)<.5&&Math.abs(B-A.h)<.5&&Math.abs(J-A.x)<.5&&Math.abs(ee-A.y)<.5;if(Et&&!I.startsWith("repeating")&&(vt||X==="no-repeat"&&O==="no-repeat")){let D=tn(I,$,B);if(D.paint&&D.paint.type!=="IMAGE"&&D.paint.type!=="SOLID"){(D.approx.includes("conic")||D.approx.includes("color-interpolation-space")||D.approx.includes("color-hint"))&&N("info","gradient-approx","Градиент перенесён приближённо: "+D.approx.join(", "),r);let ae=[t/$,0,0,n/B,-J/$,-ee/B],re={...D.paint,transform:Y(D.paint.transform,ae),blend:W!=="NORMAL"?W:void 0};if((vt||J<=F.x+.5&&ee<=F.y+.5&&J+$>=F.x+F.w-.5&&ee+B>=F.y+F.h-.5)&&F.x<.5&&F.y<.5&&Math.abs(F.w-t)<.5&&Math.abs(F.h-n)<.5){T.unshift(re);continue}let le=Math.max(F.x,J),ce=Math.max(F.y,ee),Je=Math.min(F.x+F.w,J+$),Ae=Math.min(F.y+F.h,ee+B);if(Je-le>.1&&Ae-ce>.1){let Ie=Je-le,Tt=Ae-ce,Wn=[Ie/$,0,0,Tt/B,(le-J)/$,(ce-ee)/B];i.push({kind:"rect",id:Z(),name:"Градиент фона",m:q(le,ce),w:Ie,h:Tt,fills:[{...D.paint,transform:Y(D.paint.transform,Wn)}]})}continue}}if(!Et&&K.length===1&&I.startsWith("url(")){let D=K[0],ae=pe("url:"+D,{kind:"url",url:D,purpose:"bg"});if(X==="no-repeat"&&O==="no-repeat"){let re=Math.max(F.x,J),ge=Math.max(F.y,ee),le=Math.min(F.x+F.w,J+$),ce=Math.min(F.y+F.h,ee+B);if(le-re<=.1||ce-ge<=.1)continue;if(re<=.5&&ge<=.5&&le>=t-.5&&ce>=n-.5)T.unshift({type:"IMAGE",asset:ae,scaleMode:"CROP",imageTransform:[t/$,0,0,n/B,-J/$,-ee/B],opacity:1,blend:W!=="NORMAL"?W:void 0});else{let Ae=le-re,Ie=ce-ge;i.push({kind:"rect",id:Z(),name:"Изображение фона",m:q(re,ge),w:Ae,h:Ie,fills:[{type:"IMAGE",asset:ae,scaleMode:"CROP",imageTransform:[Ae/$,0,0,Ie/B,(re-J)/$,(ge-ee)/B],opacity:1}]})}continue}if(X==="repeat"&&O==="repeat"&&te){let re=Math.abs($/H.w-B/H.h)<.01;(Math.abs(J-A.x)>.5||Math.abs(ee-A.y)>.5)&&N("info","tile-offset","Смещение плитки фона (background-position) не переносится в Figma TILE",r),re||N("info","tile-aspect","Неравномерное масштабирование плитки фона перенесено приближённо",r),T.unshift({type:"IMAGE",asset:ae,scaleMode:"TILE",scalingFactor:$/H.w,opacity:1,blend:W!=="NORMAL"?W:void 0}),T[0].tileCss=$;continue}}let Ct={"background-image":I,"background-size":x(v,E),"background-position-x":x(w,E),"background-position-y":x(h,E),"background-repeat":x(k,E),"background-origin":G,"background-clip":x(p,E),"border-style":"solid","border-color":"transparent","border-width":`${l}px ${f}px ${a}px ${s}px`,padding:`${c}px ${d}px ${m}px ${u}px`,"box-sizing":"border-box"},zn=pe("bg:"+JSON.stringify(Ct)+t+"x"+n,{kind:"bglayer",css:Ct,w:t,h:n});T.unshift({type:"IMAGE",asset:zn,scaleMode:"CROP",imageTransform:fe,opacity:1,blend:W!=="NORMAL"?W:void 0}),y.stats.rasterBackgrounds=(y.stats.rasterBackgrounds??0)+1}return{fills:[...o,...T.reverse()],under:i}}function Tr(e,t,n,r){let i=["top","right","bottom","left"].map(u=>({w:parseFloat(e[`border-${u}-width`])||0,st:e[`border-${u}-style`],c:_(e[`border-${u}-color`])})).map(u=>u.st==="none"||u.st==="hidden"||!u.c||u.c.a<=0?{...u,w:0}:u),s=i.filter(u=>u.w>0);if(!s.length)return{extra:[]};let l=s.every(u=>u.c&&s[0].c&&Math.abs(u.c.r-s[0].c.r)<.002&&Math.abs(u.c.g-s[0].c.g)<.002&&Math.abs(u.c.b-s[0].c.b)<.002&&Math.abs(u.c.a-s[0].c.a)<.002&&u.st===s[0].st),f=s[0].st;if(["solid","dashed","dotted"].includes(f)||N("info","border-style",`Стиль рамки «${f}» перенесён сплошной линией`,t),l){let u=s[0].c,c=Math.max(...s.map(m=>m.w)),d=f==="dashed"?[c*3,c*3]:f==="dotted"?[c,c]:void 0;return{stroke:{color:{r:u.r,g:u.g,b:u.b},opacity:u.a,weights:i.map(m=>m.w),align:"INSIDE",dash:d},extra:[]}}N("info","border-sides","Рамка с разными цветами сторон перенесена отдельными линиями (скругление сторон не повторяется)",t);let a=[];return i.forEach((u,c)=>{if(u.w<=0||!u.c)return;let d=[[0,0,n,u.w],[n-u.w,0,u.w,r],[0,r-u.w,n,u.w],[0,0,u.w,r]][c];a.push({kind:"rect",id:Z(),name:`Рамка ${["сверху","справа","снизу","слева"][c]}`,m:q(d[0],d[1]),w:d[2],h:d[3],fills:[wt(u.c)]})}),{extra:a}}function Ar(e,t,n,r){let o=["border-top-left-radius","border-top-right-radius","border-bottom-right-radius","border-bottom-left-radius"].map(s=>rn(e[s]||"0",t,n));if(o.every(([s,l])=>s<=0&&l<=0))return{ellipse:!1};let i=nn(o,t,n);return i.elliptical&&!i.ellipse&&N("info","elliptical-radius","Эллиптические радиусы углов перенесены круговыми (меньшая полуось)",r),{r:i.radii,ellipse:i.ellipse}}function Pn(e,t,n){let r=e.s,o=z(e.el)+(e.pseudo?"::"+e.pseudo:""),i=r.visibility!=="visible",s={fills:[],under:[],extra:[],effects:[],ellipse:!1,rasterReasons:[]},l=parseFloat(r.opacity);Number.isFinite(l)&&l<1&&(s.opacity=Math.max(0,l));let f=pt[r["mix-blend-mode"]];if(f&&f!=="NORMAL"&&(s.blend=f),i)return s;let a=/(^|,\\s*)text(\\s*,|$)/.test(r["background-clip"]),u=Ln(a?{...r,"background-clip":r["background-clip"].replace(/\\btext\\b/g,"border-box")}:r,t,n,o);a?s.textFills=u.fills.filter(h=>h.type!=="SOLID"||h.opacity>0):(s.fills=u.fills,s.under=u.under);let c=Tr(r,o,t,n);s.stroke=c.stroke,s.extra=c.extra;let d=Ar(r,t,n,o);s.radius=d.r,s.ellipse=d.ellipse;let m=ke(r["box-shadow"])??[];r["box-shadow"]!=="none"&&!ke(r["box-shadow"])&&N("warn","shadow-parse","Нераспознанная тень: "+r["box-shadow"].slice(0,80),o);let g=m;if(!s.stroke){let h=m.find(k=>k.inset&&k.blur===0&&k.x===0&&k.y===0&&k.spread>0&&k.color.a>0);h&&(s.stroke={color:{r:h.color.r,g:h.color.g,b:h.color.b},opacity:h.color.a,weights:[h.spread,h.spread,h.spread,h.spread],align:"INSIDE"},g=m.filter(k=>k!==h))}s.effects=ft(g);let R=dt(r.filter);R.blur>0&&s.effects.push({type:"LAYER_BLUR",radius:R.blur*2});for(let h of R.dropShadows)s.effects.push({type:"DROP_SHADOW",color:h.color,x:h.x,y:h.y,blur:h.blur,spread:0});let p=R.color.filter(h=>!on(h));p.length&&(s.colorFilter=p.join(" ")),R.other.length&&s.rasterReasons.push("filter: "+R.other.join(" "));let b=dt(r["backdrop-filter"]);if(b.blur>0&&s.effects.push({type:"BACKGROUND_BLUR",radius:b.blur*2}),(b.color.length||b.other.length)&&N("info","backdrop","backdrop-filter кроме blur() не переносится",o),r["clip-path"]&&r["clip-path"]!=="none"){let h=/^circle\\(50%( at 50% 50%)?\\)$/.exec(r["clip-path"]),k=sn(r["clip-path"],t,n);h&&Math.abs(t-n)<.5?s.radius=[t/2,t/2,t/2,t/2]:k?.empty?(s.clipEmpty=!0,N("info","clip-hidden","Элемент полностью скрыт clip-path: "+r["clip-path"].slice(0,60)+" — перенесён скрытым слоем",o)):k?.zero?(s.clipBox=!0,k.round&&!s.radius&&(s.radius=[k.round,k.round,k.round,k.round])):s.rasterReasons.push("clip-path: "+r["clip-path"].slice(0,60))}(r["mask-image"]!=="none"&&r["mask-image"]?r["mask-image"]:r["-webkit-mask-image"]!=="none"&&r["-webkit-mask-image"])&&s.rasterReasons.push("mask-image"),r["border-image-source"]&&r["border-image-source"]!=="none"&&s.rasterReasons.push("border-image");let v=C(r["outline-width"]),w=_(r["outline-color"]);if(r["outline-style"]!=="none"&&v>0&&w&&w.a>0){let h=C(r["outline-offset"]);s.extra.push({kind:"rect",id:Z(),name:"Контур (outline)",m:q(-h,-h),w:t+2*h,h:n+2*h,fills:[],stroke:{color:{r:w.r,g:w.g,b:w.b},opacity:w.a,weights:[v,v,v,v],align:"OUTSIDE"}})}return s}function Ir(e,t){return e.effects.some(r=>(r.type==="DROP_SHADOW"||r.type==="INNER_SHADOW")&&r.spread!==0)?!(e.fills.some(r=>r.opacity>0)&&t):!1}function Te(e){let t=e.s,n=t["z-index"]==="auto"?0:parseInt(t["z-index"],10)||0,r=t.position!=="static",o=e.parent?/flex|grid/.test(e.parent.s.display):!1,i=r||o,s;return i&&n<0?s=0:i&&n>0?s=5:r||e.sc?s=4:t.float!=="none"?s=2:/^inline/.test(t.display)||e.replaced||e.pseudo&&t.display==="inline"?s=3:s=1,[s,i?n:0,e.order]}function Tn(e,t){if(t.s.position!=="absolute"&&t.s.position!=="fixed")return!0;if(t.cb==="viewport")return!1;for(let n=t.cb;n;n=n.parent)if(n===e)return!0;return!1}var He=new Map;function Fr(){He.clear();for(let e of y.recs){if(e.kind!=="box")continue;let t=e.parent;if(e.fixed)t=null;else if((e.s.position==="absolute"||e.s.position==="fixed")&&e.cb!=="viewport"){let o=!1;for(let i=e.parent;i&&i!==e.cb;i=i.parent)(Se(i.s)||i.replaced)&&(Tn(i,e)||(o=!0));o&&(t=e.cb)}let n=Te(e);if((n[0]===0||n[0]===5)&&t&&!t.sc){let o=t,i=!0;for(;o&&!o.sc;){if(Se(o.s)&&Tn(o,e)){i=!1;break}if(me(o.s))break;o=o.parent}i&&o!==t&&(t=o,y.stats.zHoisted=(y.stats.zHoisted??0)+1)}e.figmaParent=t;let r=He.get(t)??[];r.push(e),He.set(t,r)}}function Nr(e){let t=e.layout,n=e.figmaParent?.layout,r=q(t.x-(n?n.x:0),t.y-(n?n.y:0));if(!me(e.s))return r;let o=Kt({transform:e.s.transform,translate:e.s.translate,rotate:e.s.rotate,scale:e.s.scale,origin:e.s["transform-origin"],width:t.w,height:t.h});return o?(o.unsupported.length&&(e.tfUnsupported=o.unsupported,N("warn","transform-3d",`3D/перспективное преобразование (${o.unsupported.join(", ")}) перенесено как плоское`,z(e.el))),Y(r,o.m)):(N("warn","transform-parse","Нераспознанный transform: "+e.s.transform,z(e.el)),r)}var St=new Map;function Qe(e){if(!e)return fe;let t=St.get(e);if(t)return t;let n=Y(Qe(e.figmaParent),e.m);return St.set(e,n),n}function $n(e,t,n){let r=e.runs.map(c=>({start:c.start,end:c.end,font:c.font.key,size:c.st.size,color:c.st.color,letterSpacing:c.st.letterSpacing,decoration:c.st.decoration,decorationColor:c.st.decorationColor,decorationStyle:c.st.decoration?c.st.decorationStyle:void 0,decorationThickness:c.st.decoration?c.st.decorationThickness:void 0,link:c.st.link}));for(let c of e.runs)c.st.overline&&N("info","overline","Надчёркивание (overline) не поддерживается Figma",n),c.st.smallCaps&&N("info","small-caps","Капитель (font-variant-caps) не переносится",n),c.st.wordSpacing&&N("info","word-spacing","word-spacing учтён позициями строк, но в Figma не задаётся",n),c.st.gradientText&&N("info","gradient-text","Текст с background-clip:text перенесён сплошным цветом",n),c.font.synthetic&&N("warn","synthetic-font",`Браузер синтезировал начертание (${c.font.synthetic.join(", ")}) для ${c.font.family}; в Figma используется реальное начертание ${c.font.weight}`,n);let o=e.runs[0].st,i=[],s=vn(o);s&&s.length&&i.push(...ft(s));let l=q(e.x-t.x,e.y-t.y),f=e.w,a=e.h;e.vertical&&(l=[0,1,-1,0,e.x-t.x+e.h,e.y-t.y],f=e.w,a=e.h);let u={kind:"text",id:Z(),name:e.name,src:n,m:l,w:f,h:a,text:e.text,runs:r,lineHeight:e.lineHeight,align:e.align,lines:e.lines,truncate:e.truncate,effects:i.length?i:void 0,textStroke:o.stroke};return e.fixedWidth&&(u.w=e.fixedWidth),u}function ve(e,t){let n=e.aabbA;if(n.w<1||n.h<1)return null;let r="s"+y.shots++;e.el.setAttribute("data-h2f-shot",r);let o=pe("shot:"+r,{kind:"shot",rect:[n.x,n.y,n.w,n.h],mark:r,reason:t});N("info","rasterized",`Элемент растрирован: ${t}`,z(e.el)),y.stats.rasterized=(y.stats.rasterized??0)+1;let i=e.layout,s=$e(Qe(e.figmaParent))??fe,[l,f]=[s[0]*n.x+s[2]*n.y+s[4],s[1]*n.x+s[3]*n.y+s[5]];return{kind:"image",id:Z(),name:`Растр · ${z(e.el)}`,src:z(e.el),m:q(l,f),w:n.w,h:n.h,asset:o,scaleMode:"FILL",tags:["raster"]}}function On(e){return e.texts.length||e.pseudoText&&e.pseudoText.trim()?!0:e.children.some(On)||e.inlines.length>0&&e.items.some(t=>t.kind==="text"&&/\\S/.test(t.node.data))}function Mt(e){let t=e.layout;if(!t)return null;let n=z(e.el)+(e.pseudo?"::"+e.pseudo:"");e.m=Nr(e);let r=t.w,o=t.h,i=Pn(e,r,o),s=()=>{let p=e.aabbA;return p&&!e.pseudo?[p.x,p.y,p.w,p.h]:void 0},l={id:Z(),src:n,m:e.m,w:r,h:o,opacity:i.opacity,blend:i.blend,scroll:e.fixed?"fixed":e.sticky?"sticky":void 0,tags:e.hoverCard?["hover-card"]:void 0,visible:i.clipEmpty?!1:void 0},f=e.pseudo?`::${e.pseudo}`:Lr(e),a=[...i.rasterReasons,...e.tfUnsupported?.includes("perspective")?["перспектива"]:[]];if(a.length&&y.opts.rasterUnsupported&&!e.pseudo&&!On(e)){let p=ve(e,a.join("; "));if(p)return p}else a.length&&N("warn","unsupported-effect",`Эффект не перенесён (элемент содержит текст и остаётся редактируемым): ${a.join("; ")}`,n);if(e.replaced==="IMG")return Hr(e,l,i,f);if(e.replaced==="SVG")return Br(e,l,i,f);if(e.replaced==="CANVAS"){let p="";try{p=e.el.toDataURL("image/png")}catch{}if(p&&p.length>30){let b=pe("canvas:"+e.id,{kind:"dataurl",data:p});return N("info","canvas","Canvas перенесён растровым изображением",n),{kind:"image",...l,name:"Canvas",asset:b,scaleMode:"FILL",radius:i.radius,tags:["raster"]}}return ve(e,"canvas (защищён CORS — снимок области)")}if(e.replaced==="VIDEO"){let p=e.el.poster;if(p){let b=pe("url:"+p,{kind:"url",url:p,purpose:"poster"});return N("info","video","Видео перенесено постером",n),{kind:"image",...l,name:"Видео (постер)",asset:b,scaleMode:"CROP",imageTransform:fe,radius:i.radius}}return ve(e,"видео (кадр)")}if(e.replaced==="IFRAME"||e.replaced==="EMBED"||e.replaced==="OBJECT")return ve(e,"встроенный документ "+e.replaced.toLowerCase());if(e.replaced==="METER"||e.replaced==="PROGRESS")return ve(e,"системный элемент "+e.replaced.toLowerCase());if((e.replaced==="INPUT"||e.replaced==="SELECT")&&e.s.appearance!=="none"){let p=e.el.type;if((e.replaced==="SELECT"||["checkbox","radio","range","color","file","date","time","datetime-local","month","week","button","submit","reset","image"].includes(p))&&!["button","submit","reset"].includes(p))return ve(e,"системный элемент формы "+(p||e.replaced.toLowerCase()))}let u=[],c=[];for(let p of He.get(e)??[])c.push({key:Te(p),make:()=>{let b=Mt(p);return b?[b]:[]}});for(let p of e.inlines)p.frags?.length&&c.push({key:[3,0,p.order],make:()=>Pr(p,t)});for(let p of e.texts)c.push({key:[3,0,e.textOrder??e.order],make:()=>{let b=$n(p,t,n);if(i.textFills?.length){let S=p.x-t.x,v=p.y-t.y,w=[p.w/r,0,0,p.h/o,S/r,v/o];b.fills=i.textFills.map(h=>h.type==="SOLID"?h:h.type==="IMAGE"?{...h,imageTransform:Y(h.imageTransform??fe,w)}:{...h,transform:Y(h.transform,w)})}return[b]}});e.pseudo&&e.pseudoText&&e.pseudoText.trim()&&e.s.visibility==="visible"&&c.push({key:[3,0,e.order],make:()=>$r(e,t)}),(e.replaced==="INPUT"||e.replaced==="TEXTAREA"||e.replaced==="SELECT")&&c.push({key:[3,0,e.order],make:()=>Or(e,t)}),c.sort((p,b)=>p.key[0]-b.key[0]||p.key[1]-b.key[1]||p.key[2]-b.key[2]);for(let p of c)u.push(...p.make());let d=Se(e.s)||!!i.clipBox||e.replaced==="INPUT"||e.replaced==="TEXTAREA"||e.replaced==="SELECT";d&&e.el instanceof HTMLElement&&(e.el.scrollHeight>e.el.clientHeight+2||e.el.scrollWidth>e.el.clientWidth+2)&&/auto|scroll/.test(e.s["overflow-y"]+e.s["overflow-x"])&&N("info","inner-scroll","Внутренняя прокрутка перенесена как обрезанный контейнер в начальной позиции",n);let m=i.fills.length||i.under.length||i.stroke||i.extra.length||i.effects.length;if(!u.length&&!m&&!e.hoverCard||r<=.01&&o<=.01&&!u.length)return null;if(i.colorFilter&&N("info","color-filter",`CSS filter (${i.colorFilter}) не переносится на интерфейсные элементы`,n),i.ellipse&&!u.length)return{kind:"ellipse",...l,name:f,fills:i.fills,stroke:i.stroke,effects:i.effects.length?i.effects:void 0,expect:s()};if(!u.length&&!i.under.length&&!i.extra.length&&!d&&(e.pseudo||!e.hoverCard))return{kind:"rect",...l,name:f,fills:i.fills,stroke:i.stroke,radius:i.radius,effects:i.effects.length?i.effects:void 0,expect:s()};let g={kind:"frame",...l,name:f,fills:i.fills,stroke:i.stroke,radius:i.radius,clip:d,effects:i.effects.length?i.effects:void 0,children:[],expect:s()},R=[...i.under];if(Ir(i,d)&&(R.unshift({kind:"rect",id:Z(),name:"Фон и тень",m:fe,w:r,h:o,fills:i.fills.length?i.fills:[{type:"SOLID",color:{r:1,g:1,b:1},opacity:0}],radius:i.radius,effects:i.effects}),g.fills=[],g.effects=void 0),g.children=[...R,...u,...i.extra],e.hoverCard&&y.opts.cursor&&y.hoverPoint){let p=$e(Qe(e));if(p){let[b,S]=[p[0]*y.hoverPoint[0]+p[2]*y.hoverPoint[1]+p[4],p[1]*y.hoverPoint[0]+p[3]*y.hoverPoint[1]+p[5]],v=pe("cursor",{kind:"cursor"});g.children.push({kind:"svg",id:Z(),name:"Курсор (можно удалить)",m:q(b,S),w:14,h:21,asset:v,clip:!1,tags:["cursor"]})}}return g}function Lr(e){let t=e.el,n=t.tagName.toLowerCase(),r=t.getAttribute("aria-label"),o=(t.textContent??"").replace(/\\s+/g," ").trim().slice(0,30);return n==="button"||t.getAttribute("role")==="button"?`Кнопка «${r||o||"кнопка"}»`:n==="a"?`Ссылка «${r||o||t.getAttribute("href")||""}»`:n==="input"||n==="textarea"||n==="select"?`Поле ${z(t)}`:/^h[1-6]$/.test(n)?`${n.toUpperCase()} «${o}»`:z(t)}function Pr(e,t){let n=e.s,r=[];if(n.visibility!=="visible")return r;let o=e.frags;return o.forEach((i,s)=>{let l=Pn(e,i.w,i.h);if(!l.fills.length&&!l.stroke&&!l.effects.length)return;let f=l.radius;f&&o.length>1&&(f=[s===0?f[0]:0,s===o.length-1?f[1]:0,s===o.length-1?f[2]:0,s===0?f[3]:0]),r.push({kind:"rect",id:Z(),name:`Фон ${z(e.el)}`,src:z(e.el),m:q(i.x-t.x,i.y-t.y),w:i.w,h:i.h,fills:l.fills,stroke:l.stroke,radius:f,effects:l.effects.length?l.effects:void 0,opacity:l.opacity})}),r}function kt(e,t,n,r,o,i,s,l){if(!e)return[];let f=Array.from(e),a=[],u=0;for(let m of f){let g=yt(t,m),R=a[a.length-1];R&&R.font===g?R.end+=m.length:a.push({start:u,end:u+m.length,st:t,font:g}),u+=m.length}let c=t.lineHeight,d={x:n,y:r,w:i,h:c*e.split(`\n`).length,text:e,runs:a,lineHeight:c,align:o,lines:e.split(`\n`).length,name:s};return[$n(d,l,s)]}function $r(e,t){let n=e.s,r=Ee(e.el,e.el),o=e.pseudo==="marker"?getComputedStyle(e.el,"::marker"):getComputedStyle(e.el,"::"+e.pseudo),i=C(o.fontSize),s=o.lineHeight==="normal"?i*1.2:/^[\\d.]+$/.test(o.lineHeight)?parseFloat(o.lineHeight)*i:C(o.lineHeight);s>0||(s=i*1.25);let l={...r,families:o.fontFamily.split(",").map(p=>p.trim().replace(/^[\'"]|[\'"]$/g,"")),size:i,weight:parseInt(o.fontWeight,10)||400,italic:o.fontStyle.startsWith("italic"),color:_(o.color)??r.color,lineHeight:s,letterSpacing:o.letterSpacing==="normal"?0:C(o.letterSpacing),transform:o.textTransform,decoration:void 0,link:void 0,shadow:o.textShadow},f=e.pseudoText;l.transform==="uppercase"&&(f=f.toLocaleUpperCase(l.lang));let a=C(n["padding-left"])+C(n["border-left-width"]),u=C(n["padding-top"])+C(n["border-top-width"]),c=t.w-a-C(n["padding-right"])-C(n["border-right-width"]),d=t.h-u-C(n["padding-bottom"])-C(n["border-bottom-width"]),m=t.y+u;/flex|grid/.test(n.display)&&/center/.test(o.alignItems+o.placeItems)?m=t.y+u+(d-s)/2:n.display==="inline"&&(m=t.y+(t.h-s)/2);let g="LEFT";/flex|grid/.test(n.display)&&/center/.test(o.justifyContent+o.placeItems)||n["text-align"]==="center"?g="CENTER":(n["text-align"]==="right"||n["text-align"]==="end")&&(g="RIGHT");let R=t.x+a;return kt(f,l,R,m,g,Math.max(1,c),`${e.pseudo==="marker"?"Маркер":"::"+e.pseudo} «${f.slice(0,20)}»`,t)}function Or(e,t){let n=e.el,r=e.s,o="",i=Ee(n,n);if(e.replaced==="SELECT")o=n.selectedOptions?.[0]?.textContent?.trim()??"";else if(o=n.value??"",n.type==="password"&&(o="•".repeat(o.length)),!o&&n.placeholder){o=n.placeholder;let R=getComputedStyle(n,"::placeholder");i={...i,color:_(R.color)??i.color}}if(!o)return[];let s=C(r["padding-left"])+C(r["border-left-width"]),l=C(r["padding-top"])+C(r["border-top-width"]),f=t.w-s-C(r["padding-right"])-C(r["border-right-width"]),a=t.h-l-C(r["padding-bottom"])-C(r["border-bottom-width"]),u=i.lineHeight,c=e.replaced==="TEXTAREA";c&&N("info","textarea","Текст в textarea переносится по ширине средствами Figma",z(n));let d=c?t.y+l:t.y+l+(a-u)/2,m=r["text-align"]==="center"?"CENTER":r["text-align"]==="right"||r["text-align"]==="end"?"RIGHT":"LEFT",g=kt(c?o:o.replace(/\\n/g," "),i,t.x+s,d,m,Math.max(1,f),"Значение поля",t);return g[0]&&g[0].kind==="text"&&(g[0].w=Math.max(1,f),c?g[0].tags=["wrap"]:g[0].truncate=1),g}function Hr(e,t,n,r){let o=e.el,i=e.s,s=z(o),l=o.currentSrc||o.src,f=e.layout,a=C(i["padding-left"])+C(i["border-left-width"]),u=C(i["padding-top"])+C(i["border-top-width"]),c=f.w-a-C(i["padding-right"])-C(i["border-right-width"]),d=f.h-u-C(i["padding-bottom"])-C(i["border-bottom-width"]);if(!l||!o.complete||o.naturalWidth===0){N("warn","broken-image",`Изображение не загрузилось: ${l?l.slice(0,160):"(нет src)"}`,s);let W=o.alt?.trim(),K=[];if(W){let Q=Ee(o,o);K.push(...kt(W,{...Q,color:{r:.4,g:.4,b:.4,a:1}},f.x+4,f.y+4,"LEFT",Math.max(1,f.w-8),"Альтернативный текст",f))}return{kind:"frame",...t,name:`Нет изображения · ${s}`,fills:[{type:"SOLID",color:{r:.95,g:.95,b:.95},opacity:1}],stroke:{color:{r:.7,g:.7,b:.7},opacity:1,weights:[1,1,1,1],align:"INSIDE",dash:[4,4]},clip:!0,children:K,tags:["broken-image"]}}let m=o.naturalWidth,g=o.naturalHeight,R=i["object-fit"]||"fill",p=c,b=d;if(R==="contain"||R==="cover"||R==="none"||R==="scale-down"){let W=R==="cover"?Math.max(c/m,d/g):R==="contain"?Math.min(c/m,d/g):1;R==="scale-down"&&(W=Math.min(1,Math.min(c/m,d/g))),p=m*W,b=g*W}let S=(i["object-position"]||"50% 50%").split(/\\s+/),v=a+Ce(S[0]??"50%",c-p),w=u+Ce(S[1]??"50%",d-b),h=n.colorFilter,k=pe("url:"+l+"|"+(h??""),{kind:"url",url:l,filter:h,purpose:"img"});h&&(y.stats.bakedFilters=(y.stats.bakedFilters??0)+1);let M=Math.max(a,v),P=Math.max(u,w),L=Math.min(a+c,v+p),x=Math.min(u+d,w+b),T=L-M,E=x-P;if(T<=0||E<=0)return null;let I=[T/p,0,0,E/b,(M-v)/p,(P-w)/b],G=M<.5&&P<.5&&Math.abs(T-f.w)<.5&&Math.abs(E-f.h)<.5,A=n.fills.length||n.stroke||n.under.length;if(G&&!n.under.length)return{kind:"image",...t,name:`Изображение ${o.alt?"«"+o.alt.slice(0,30)+"»":s}`,asset:k,scaleMode:"CROP",imageTransform:I,radius:n.radius,stroke:n.stroke,fills:n.fills.length?n.fills:void 0,effects:n.effects.length?n.effects:void 0,expect:e.aabbA?[e.aabbA.x,e.aabbA.y,e.aabbA.w,e.aabbA.h]:void 0};let F={kind:"image",id:Z(),name:"Изображение",m:q(M,P),w:T,h:E,asset:k,scaleMode:"CROP",imageTransform:I};return{kind:"frame",...t,name:r,fills:n.fills,stroke:n.stroke,radius:n.radius,clip:!0,effects:n.effects.length?n.effects:void 0,children:[...n.under,F]}}function Br(e,t,n,r){let o=e.svg,i=e.layout,s=e.s,l=z(e.el);if(!o||!e.svgContent||e.svgContent.w<=0||e.svgContent.h<=0)return null;let f=y.opts.svgMode,a=f==="raster"||f==="auto"&&o.reasons.length>0,u=pe("svg:"+o.markup,{kind:"svg",markup:o.markup,w:e.svgContent.w,h:e.svgContent.h,reasons:o.reasons,overflowVisible:o.overflowVisible,raster:a,externalImages:o.externalImages});a?(y.stats.svgRaster=(y.stats.svgRaster??0)+1,N("info","svg-raster",`SVG растрирован: ${o.reasons.join(", ")||"режим профиля"}`,l)):y.stats.svgVector=(y.stats.svgVector??0)+1;let c=C(s["padding-left"])+C(s["border-left-width"]),d=C(s["padding-top"])+C(s["border-top-width"]),m=!o.overflowVisible,g=n.fills.length||n.stroke||n.under.length||c>.01||d>.01||n.radius&&m,R={kind:"svg",id:Z(),name:g?"Рисунок SVG":`SVG ${l}`,src:l,m:q(c,d),w:e.svgContent.w,h:e.svgContent.h,asset:u,clip:m,tags:a?["raster"]:void 0};return g?{kind:"frame",...t,name:r,fills:n.fills,stroke:n.stroke,radius:n.radius,clip:m&&!!n.radius,effects:n.effects.length?n.effects:void 0,children:[...n.under,R]}:{...R,...t,name:`SVG ${l}`,m:Y(t.m,q(c,d)),w:e.svgContent.w,h:e.svgContent.h,effects:n.effects.length?n.effects:void 0,expect:e.aabbA?[e.aabbA.x,e.aabbA.y,e.aabbA.w,e.aabbA.h]:void 0}}function Hn(){if(!y)throw new Error("capture not started");Nn=0,St.clear();let e=0;for(let h of y.recs){if(h.pseudo||!h.aabbA)continue;let k=h.el.getBoundingClientRect(),M=Math.max(Math.abs(k.left+scrollX-h.aabbA.x),Math.abs(k.top+scrollY-h.aabbA.y),Math.abs(k.width-h.aabbA.w),Math.abs(k.height-h.aabbA.h));M>e&&(e=M)}e>.5&&N("warn","prep-shift",`Подготовка захвата сместила элементы до ${e.toFixed(1)} px`),Fr();let t=(He.get(null)??[]).filter(h=>h.layout),n=t.filter(h=>!h.fixed).sort((h,k)=>{let M=Te(h),P=Te(k);return M[0]-P[0]||M[1]-P[1]||M[2]-P[2]}),r=t.filter(h=>h.fixed).sort((h,k)=>{let M=Te(h),P=Te(k);return M[1]-P[1]||M[2]-P[2]}),o=[];for(let h of n){let k=Mt(h);k&&o.push(k)}let i=0;for(let h of r){let k=Mt(h);k&&(o.push(k),i++)}let s=[];for(let h of y.recs){if(!h.m||!h.layout||!h.aabbA||h.pseudo||h.kind!=="box"||h.aabbA.w===0&&h.aabbA.h===0)continue;let[k,M,P,L]=Xt(Qe(h),h.layout.w,h.layout.h),x=h.aabbA,T=k-x.x,E=M-x.y,I=P-x.w,G=L-x.h;Math.max(Math.abs(T),Math.abs(E),Math.abs(I),Math.abs(G))>1&&s.push({src:z(h.el),dx:+T.toFixed(2),dy:+E.toFixed(2),dw:+I.toFixed(2),dh:+G.toFixed(2)})}s.length&&N("warn","transform-mismatch",`Восстановленная геометрия ${s.length} элементов отличается от браузерной более чем на 1 px`);let l=document.documentElement,f=document.body,a=y.canvasBg==="html"?l:f??l,u=l.clientWidth,c=Math.max(l.scrollHeight,f?.scrollHeight??0),d=we(getComputedStyle(a)),m=Ln({...d,"border-top-width":"0","border-left-width":"0","border-right-width":"0","border-bottom-width":"0","padding-top":"0","padding-left":"0","padding-right":"0","padding-bottom":"0"},u,c,"canvas"),g=m.fills.length?m.fills:[{type:"SOLID",color:{r:1,g:1,b:1},opacity:1}];m.fills.length&&!m.fills.some(h=>h.type==="SOLID"&&h.opacity>=1)&&g.unshift({type:"SOLID",color:{r:1,g:1,b:1},opacity:1}),o.unshift(...m.under);let R={},p=h=>{if(h.kind==="text")for(let k of h.runs){let M=R[k.font],P=h.text.slice(k.start,k.end);M&&(M.chars+=k.end-k.start,M.sample.length<40&&(M.sample+=P.slice(0,40-M.sample.length)))}h.kind==="frame"&&h.children.forEach(p)};for(let h of Gr())R[h.key]={family:h.family,generic:h.generic,weight:h.weight,italic:h.italic,source:h.source,variable:h.variable,synthetic:h.synthetic,chars:0,sample:""};o.forEach(p);for(let h of Object.keys(R))R[h].chars||delete R[h];let b=[],S=0;for(let[h,k]of Xe){let M="g"+S++;h.setAttribute("data-h2f-f",M),b.push({mark:M,generic:k.generic,system:k.system.size?[...k.system]:void 0,chars:[...k.chars].join("")})}let v={};for(let[h,k]of y.assets)v[h]=k;let w={...y.stats,nodes:y.nodeCount,chars:y.chars.chars,fixed:i};return y.limitHit&&N("warn","node-limit",`Достигнут лимит элементов (${y.opts.maxNodes}); часть страницы не перенесена`),{url:location.href,title:document.title,viewport:{width:innerWidth,height:innerHeight},width:u,height:c,background:g,children:o,fixedCount:i,assets:v,fonts:R,genericMarks:b,diagnostics:[...y.diags.values()],stats:w,geometry:{maxShift:+e.toFixed(3),mismatches:s.slice(0,50)}}}function Gr(){return Mn()}function Bn(){for(let e of["data-h2f-p","data-h2f-tf","data-h2f-f","data-h2f-shot"])for(let t of Array.from(document.querySelectorAll(`[${e}]`)))t.removeAttribute(e);y?.styleSheet?.remove(),y?.neutralSheet?.remove()}function Gn(e,t){let n="h2f-iso";if(document.getElementById(n)?.remove(),!t)return;let r=document.createElement("style");r.id=n,r.textContent=`html,body{background:transparent!important}html *,html *::before,html *::after{visibility:hidden!important}[data-h2f-shot="${e}"],[data-h2f-shot="${e}"] *,[data-h2f-shot="${e}"] *::before,[data-h2f-shot="${e}"] *::after{visibility:visible!important}`,document.documentElement.appendChild(r)}var Dn=new Map,he=[],Ze={card:null,point:null};function Rt(e){let t=e.filter(n=>{try{return document.querySelector(n),!0}catch{return!1}});return n=>t.some(r=>{try{return!!n.closest(r)}catch{return!1}})}var Dr={version:1,settle:zt,finishAnimations:xe,snapshotFixed:ze,async scrollPass(e){let t=await Wt(e);return Dn=t.poses,{steps:t.steps,poses:t.poses.size,headerRestored:t.headerRestored}},links(e){return At(Rt(e))},linkLabel:et,fingerprint(e){return It(Rt(e))},installHoverPinning:De,uninstallHoverPinning:Nt,rewriteHoverSelector:Ge,hoverCandidates(e){return he=Pt(Rt(e)),he.map(t=>({index:t.index,selector:t.selector,label:t.label,score:+t.score.toFixed(3),box:t.box.map(n=>+n.toFixed(1)),changes:t.changes,props:t.props}))},async pin(e,t){Le(),Ze={card:null,point:null};let n=null;if(t)try{n=document.querySelector(t)}catch{n=null}if(!n&&e!==null&&he[e]&&(n=he[e].el),!n)return null;let r=await Ht(n,z);return Ze={card:n,point:r.point},{...r,label:Be(n)}},hoverSnapshot(e,t){let n=Ze.card;if(e)try{n=document.querySelector(e)}catch{}return!n&&t!==null&&he[t]&&(n=he[t].el),n?Bt(n):null},markCard(e,t){let n=null;if(e)try{n=document.querySelector(e)}catch{}return!n&&t!==null&&he[t]&&(n=he[t].el),n?(n.setAttribute("data-h2f-card",""),!0):!1},async begin(e){return An(e,Dn,Ze)},neutral(e){In(e)},measure(e){return Fn(e),!0},finish:Hn,cleanup:Bn,shotIsolation:Gn};window.__H2F_KEY_PLACEHOLDER__=Dr;})();\n'.replace(/__H2F_KEY_PLACEHOLDER__/g, key);
  await page.evaluate(src);
  return key;
}
async function call(page, key, method, ...args) {
  return page.evaluate(({ key: key2, method: method2, args: args2 }) => {
    const api = window[key2];
    if (!api) throw new Error("capture api missing");
    return api[method2](...args2);
  }, { key, method, args });
}
async function waitAfterNavigation(page, timeoutMs) {
  try {
    await page.waitForLoadState("load", { timeout: timeoutMs });
  } catch {
  }
  try {
    await page.waitForLoadState("networkidle", { timeout: Math.min(3e3, timeoutMs) });
  } catch {
  }
}
async function pseudoBoxes(cdp) {
  await cdp.send("DOM.enable");
  const doc = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  const res = {};
  const jobs = [];
  const walk = (n) => {
    const attrs = n.attributes ?? [];
    const i = attrs.indexOf("data-h2f-p");
    if (i >= 0 && n.pseudoElements) {
      const id = attrs[i + 1];
      const box = {};
      res[id] = box;
      for (const p of n.pseudoElements) {
        const t = p.pseudoType;
        if (t !== "before" && t !== "after" && t !== "marker") continue;
        jobs.push(cdp.send("DOM.getBoxModel", { nodeId: p.nodeId }).then((bm) => {
          box[t] = bm.model.border;
        }).catch(() => void 0));
      }
    }
    for (const c of n.children ?? []) walk(c);
    for (const c of n.shadowRoots ?? []) walk(c);
  };
  walk(doc.root);
  await Promise.all(jobs);
  return res;
}
async function platformFonts(cdp, marks) {
  const out = {};
  if (!marks.length) return out;
  await cdp.send("CSS.enable").catch(() => void 0);
  const doc = await cdp.send("DOM.getDocument", { depth: 0 });
  const q = await cdp.send("DOM.querySelectorAll", { nodeId: doc.root.nodeId, selector: "[data-h2f-f]" });
  await Promise.all(q.nodeIds.map(async (id) => {
    try {
      const attrs = (await cdp.send("DOM.getAttributes", { nodeId: id })).attributes;
      const mark = attrs[attrs.indexOf("data-h2f-f") + 1];
      const f = await cdp.send("CSS.getPlatformFontsForNode", { nodeId: id });
      out[mark] = f.fonts;
    } catch {
    }
  }));
  return out;
}
async function capturePage(page, key, opts) {
  const t = {};
  let t0 = Date.now();
  const cdp = await page.context().newCDPSession(page);
  try {
    await call(page, key, "begin", opts);
    t.phaseA = Date.now() - t0;
    t0 = Date.now();
    await call(page, key, "neutral", true);
    const boxes = await pseudoBoxes(cdp);
    t.cdp = Date.now() - t0;
    t0 = Date.now();
    await call(page, key, "measure", boxes);
    t.phaseB = Date.now() - t0;
    t0 = Date.now();
    await call(page, key, "neutral", false);
    const raw = await call(page, key, "finish");
    t.phaseC = Date.now() - t0;
    t0 = Date.now();
    const platform = await platformFonts(cdp, raw.genericMarks.map((m) => m.mark));
    t.fonts = Date.now() - t0;
    return { raw, platform, timings: t };
  } finally {
    await cdp.detach().catch(() => void 0);
  }
}

// processor/src/config.ts
var import_node_crypto2 = __toESM(require("node:crypto"), 1);
var import_node_fs2 = __toESM(require("node:fs"), 1);
var import_node_os2 = __toESM(require("node:os"), 1);
var import_node_path2 = __toESM(require("node:path"), 1);
var DEFAULT_LIMITS = {
  maxUploadBytes: 300 * 1024 * 1024,
  maxZipEntries: 5e3,
  maxZipTotalBytes: 1024 * 1024 * 1024,
  maxFileBytes: 200 * 1024 * 1024,
  maxRoutes: 80,
  maxDepth: 4,
  perShapeLimit: 12,
  discoveryTimeoutMs: 24e4,
  routeTimeoutMs: 9e4,
  maxNodesPerRoute: 3e4,
  maxCharsPerRoute: 4e5,
  maxAssetsPerJob: 4e3,
  maxAssetBytesPerJob: 800 * 1024 * 1024,
  concurrency: 2,
  jobTtlHours: 24
};
function defaultDataDir() {
  if (process.env.H2F_DATA) return process.env.H2F_DATA;
  if (process.platform === "win32") return import_node_path2.default.join(process.env.LOCALAPPDATA || import_node_path2.default.join(import_node_os2.default.homedir(), "AppData", "Local"), "HtmlToFigma");
  return import_node_path2.default.join(import_node_os2.default.homedir(), ".html-to-figma");
}
function code() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = import_node_crypto2.default.randomBytes(10);
  let s = "";
  for (let i = 0; i < 10; i++) s += alphabet[b[i] % alphabet.length];
  return s.slice(0, 5) + "-" + s.slice(5);
}
function loadConfig(overrides = {}) {
  const dataDir = overrides.dataDir ?? defaultDataDir();
  import_node_fs2.default.mkdirSync(dataDir, { recursive: true });
  const file = import_node_path2.default.join(dataDir, "config.json");
  let saved = {};
  try {
    saved = JSON.parse(import_node_fs2.default.readFileSync(file, "utf8"));
  } catch {
  }
  const cfg = {
    port: Number(process.env.H2F_PORT) || overrides.port || saved.port || 47821,
    host: "127.0.0.1",
    dataDir,
    limits: { ...DEFAULT_LIMITS, ...saved.limits ?? {}, ...overrides.limits ?? {} },
    pairingCode: overrides.pairingCode ?? saved.pairingCode ?? code(),
    tokens: overrides.tokens ?? saved.tokens ?? [],
    profilesDir: overrides.profilesDir ?? ""
  };
  if (!overrides.dataDir || !process.env.H2F_EPHEMERAL) saveConfig(cfg);
  return cfg;
}
function saveConfig(cfg) {
  const file = import_node_path2.default.join(cfg.dataDir, "config.json");
  const { port, limits, pairingCode, tokens } = cfg;
  import_node_fs2.default.writeFileSync(file, JSON.stringify({ port, limits, pairingCode, tokens }, null, 2), { mode: 384 });
}
function issueToken(cfg) {
  const t = import_node_crypto2.default.randomBytes(32).toString("base64url");
  cfg.tokens = [...cfg.tokens.slice(-9), t];
  saveConfig(cfg);
  return t;
}
function tokenValid(cfg, t) {
  if (!t) return false;
  const a = Buffer.from(t);
  return cfg.tokens.some((x) => {
    const b = Buffer.from(x);
    return a.length === b.length && import_node_crypto2.default.timingSafeEqual(a, b);
  });
}

// processor/src/jobs.ts
var import_node_crypto4 = __toESM(require("node:crypto"), 1);
var import_node_fs6 = __toESM(require("node:fs"), 1);
var import_node_path6 = __toESM(require("node:path"), 1);
var import_node_os3 = __toESM(require("node:os"), 1);

// shared/routes.ts
var DOWNLOAD_EXT = /\.(pdf|zip|rar|7z|gz|tar|docx?|xlsx?|pptx?|mp3|mp4|webm|mov|wav|ogg|png|jpe?g|gif|webp|avif|svg|ico|txt|csv|json|xml|epub|woff2?|ttf|otf)$/i;
function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
function routeKey(url, siteBase) {
  const u = new URL(url);
  const base = new URL(siteBase);
  let path10 = u.pathname;
  if (path10.startsWith(base.pathname)) path10 = path10.slice(base.pathname.length);
  path10 = safeDecode(path10);
  const hash = u.hash && u.hash !== "#" ? safeDecode(u.hash) : "";
  return `${path10}${safeDecode(u.search)}${hash}`;
}
function urlFromKey(key, siteBase) {
  const hashAt = key.indexOf("#");
  const pathQuery = hashAt >= 0 ? key.slice(0, hashAt) : key;
  const hash = hashAt >= 0 ? key.slice(hashAt) : "";
  const qAt = pathQuery.indexOf("?");
  const path10 = qAt >= 0 ? pathQuery.slice(0, qAt) : pathQuery;
  const query = qAt >= 0 ? pathQuery.slice(qAt) : "";
  const u = new URL(path10.split("/").map(encodeURIComponent).join("/"), siteBase);
  u.search = query;
  u.hash = hash ? encodeURI(hash.slice(1)) : "";
  return u.toString();
}
function isHashRoute(fragment) {
  return /^#!?\//.test(fragment);
}
function classifyHref(href, pageUrl, siteBase, ids, opts = {}) {
  const raw = (href ?? "").trim();
  if (!raw) return { kind: "invalid", reason: "пустая ссылка" };
  if (/^(mailto|tel|sms|javascript|data|blob|ftp|file):/i.test(raw)) return { kind: "scheme", reason: raw.split(":")[0] };
  let u;
  try {
    u = new URL(raw, pageUrl);
  } catch {
    return { kind: "invalid", reason: "неразборчивый адрес" };
  }
  const base = new URL(siteBase);
  if (u.origin === base.origin && !u.pathname.startsWith(base.pathname) && !/^\/j\/[a-z0-9]+\//.test(u.pathname)) u = new URL(base.pathname + u.pathname.replace(/^\/+/, "") + u.search + u.hash, base);
  if (u.origin !== base.origin || !u.pathname.startsWith(base.pathname)) return { kind: "external", url: u.toString() };
  if (opts.download || DOWNLOAD_EXT.test(u.pathname)) return { kind: "download", url: u.toString(), reason: "файл/загрузка" };
  const cur = new URL(pageUrl);
  const samePath = u.pathname === cur.pathname || u.pathname.endsWith("/") && cur.pathname === u.pathname + "index.html" || cur.pathname.endsWith("/") && u.pathname === cur.pathname + "index.html";
  const key = routeKey(u.toString(), siteBase);
  if (samePath && u.search === cur.search) {
    if (!u.hash || u.hash === "#") return cur.hash && cur.hash !== "#" && isHashRoute(cur.hash) ? { kind: "hash-route", url: u.toString(), key } : { kind: "same", reason: "та же страница" };
    if (isHashRoute(u.hash)) return { kind: "hash-route", url: u.toString(), key };
    const frag = safeDecode(u.hash.slice(1));
    if (ids.has(frag)) return { kind: "anchor", url: u.toString(), key, reason: `якорь #${frag} на этой странице` };
    return { kind: "hash-candidate", url: u.toString(), key };
  }
  if (isHashRoute(u.hash)) return { kind: "hash-route", url: u.toString(), key };
  if (u.hash && !isHashRoute(u.hash)) {
    const p = new URL(u.toString());
    p.hash = "";
    return { kind: "page", url: p.toString(), key: routeKey(p.toString(), siteBase), reason: "якорь на другой странице" };
  }
  return { kind: "page", url: u.toString(), key };
}
function routeShape(key) {
  return key.replace(/\d+/g, "#").replace(/=[^&#]*/g, "=*").replace(/\/[0-9a-f]{8,}/gi, "/~");
}
function routeGroup(key) {
  const hashAt = key.indexOf("#");
  const target = hashAt >= 0 && isHashRoute(key.slice(hashAt)) ? key.slice(hashAt).replace(/^#!?\//, "") : key.slice(0, hashAt >= 0 ? hashAt : void 0);
  const seg = target.split(/[/?]/).filter(Boolean)[0] ?? "";
  return seg.replace(/\.html?$/i, "") || "главная";
}
function routeDepth(key) {
  const hashAt = key.indexOf("#");
  const t = hashAt >= 0 ? key.slice(hashAt + 1) : key;
  return t.split("?")[0].split("/").filter(Boolean).length;
}
function routeFileId(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const slug = key.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "root";
  return `${slug}-${(h >>> 0).toString(36)}`;
}
function extractHashLiterals(source, limit = 400) {
  const out = /* @__PURE__ */ new Set();
  const re = /["'`](#!?\/[^"'`\s<>{}$\\]{0,120})["'`]/g;
  let m;
  while ((m = re.exec(source)) && out.size < limit) {
    const v = m[1];
    if (/[()]/.test(v)) continue;
    out.add(v);
  }
  return [...out];
}

// processor/src/jobs.ts
init_assets();

// shared/matrix.ts
var IDENTITY = [1, 0, 0, 1, 0, 0];
function translate(x, y) {
  return [1, 0, 0, 1, x, y];
}
function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5]
  ];
}
function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
function aabb(m, w, h) {
  const pts = [apply(m, 0, 0), apply(m, w, 0), apply(m, w, h), apply(m, 0, h)];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0];
}
function decompose(m) {
  const [a, b, c, d, e, f] = m;
  const sx = Math.hypot(a, b);
  const rotation = Math.atan2(b, a);
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  const c2 = cos * c + sin * d;
  const d2 = -sin * c + cos * d;
  const sy = d2;
  const skew = sy !== 0 ? c2 / sy : 0;
  return { rotation, scaleX: sx, scaleY: sy, skew, tx: e, ty: f };
}
function rotationOnly(m) {
  const d = decompose(m);
  const c = Math.cos(d.rotation), s = Math.sin(d.rotation);
  return [c, s, -s, c, m[4], m[5]];
}
function hasUnitAxes(m, eps = 1e-6) {
  return Math.abs(Math.hypot(m[0], m[1]) - 1) < eps && Math.abs(Math.hypot(m[2], m[3]) - 1) < eps;
}
function isFiniteMat(m) {
  return Array.isArray(m) && m.length === 6 && m.every((x) => typeof x === "number" && Number.isFinite(x));
}

// shared/fonts.ts
var STYLE_WEIGHTS = [
  [/(hairline|thin)/, 100],
  [/(extra|ultra)light/, 200],
  [/light/, 300],
  [/(semi|demi)bold/, 600],
  [/(extra|ultra)bold/, 800],
  [/(black|heavy)/, 900],
  [/bold/, 700],
  [/medium/, 500],
  [/(regular|normal|book|roman)/, 400]
];
function styleWeight(style) {
  const s = style.toLowerCase().replace(/[\s_-]/g, "");
  for (const [re, w] of STYLE_WEIGHTS) if (re.test(s)) return w;
  return 400;
}
function faceFromPostScript(ps) {
  if (!ps) return null;
  const i = ps.lastIndexOf("-");
  const suffix = i > 0 ? ps.slice(i + 1).replace(/(MT|PS)+$/, "") : "";
  if (!suffix) return { weight: 400, italic: false };
  const italic = /italic|oblique|^it$|kursiv/i.test(suffix);
  return { weight: styleWeight(suffix.replace(/italic|oblique|kursiv/gi, "") || "regular"), italic };
}

// shared/validate.ts
var fin = (v) => typeof v === "number" && Number.isFinite(v);
var unit = (v) => fin(v) && v >= 0 && v <= 1;
function checkColor(c, path10, out, alpha = true) {
  if (!c || !unit(c.r) || !unit(c.g) || !unit(c.b) || alpha && !unit(c.a)) out.push({ path: path10, message: "неверный цвет" });
}
function checkPaints(ps, path10, out, assets) {
  if (ps === void 0) return;
  if (!Array.isArray(ps)) {
    out.push({ path: path10, message: "fills не массив" });
    return;
  }
  ps.forEach((p, i) => {
    const pp = `${path10}.fills[${i}]`;
    if (!unit(p.opacity)) out.push({ path: pp, message: "opacity вне 0..1" });
    if (p.type === "SOLID") checkColor({ ...p.color, a: 1 }, pp, out);
    else if (p.type === "IMAGE") {
      if (!assets.has(p.asset)) out.push({ path: pp, message: `нет ассета ${p.asset}` });
      if (p.imageTransform && !isFiniteMat(p.imageTransform)) out.push({ path: pp, message: "imageTransform не конечен" });
      if (p.scalingFactor !== void 0 && !(fin(p.scalingFactor) && p.scalingFactor > 0)) out.push({ path: pp, message: "scalingFactor" });
    } else {
      if (!isFiniteMat(p.transform)) out.push({ path: pp, message: "gradientTransform не конечен" });
      if (!p.stops || p.stops.length < 2) out.push({ path: pp, message: "меньше двух остановок градиента" });
      p.stops?.forEach((s, j) => {
        if (!unit(s.position)) out.push({ path: `${pp}.stops[${j}]`, message: "позиция вне 0..1" });
        checkColor(s.color, `${pp}.stops[${j}]`, out);
      });
    }
  });
}
function checkEffects(es, path10, out) {
  es?.forEach((e, i) => {
    const pp = `${path10}.effects[${i}]`;
    if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
      if (![e.x, e.y, e.blur, e.spread].every(fin) || e.blur < 0) out.push({ path: pp, message: "параметры тени" });
      checkColor(e.color, pp, out);
    } else if (e.type === "LAYER_BLUR" || e.type === "BACKGROUND_BLUR") {
      if (!(fin(e.radius) && e.radius >= 0)) out.push({ path: pp, message: "радиус размытия" });
    }
  });
}
function checkStroke(s, path10, out) {
  if (!s) return;
  if (!s.weights.every((w) => fin(w) && w >= 0)) out.push({ path: path10, message: "толщина обводки" });
  if (!unit(s.opacity)) out.push({ path: path10, message: "opacity обводки" });
  checkColor({ ...s.color, a: 1 }, path10, out);
  if (s.dash && !s.dash.every((d) => fin(d) && d >= 0)) out.push({ path: path10, message: "dashPattern" });
}
function validateNode(n, path10, out, ctx) {
  ctx.count.n++;
  if (!isFiniteMat(n.m)) out.push({ path: path10, message: "матрица не конечна" });
  else if (!hasUnitAxes(n.m, 1e-4)) out.push({ path: path10, message: "матрица содержит масштаб (оси не единичные)" });
  if (!(fin(n.w) && n.w >= 0 && fin(n.h) && n.h >= 0)) out.push({ path: path10, message: `размер ${n.w}×${n.h}` });
  if (n.opacity !== void 0 && !unit(n.opacity)) out.push({ path: path10, message: "opacity вне 0..1" });
  checkEffects(n.effects, path10, out);
  switch (n.kind) {
    case "frame":
      checkPaints(n.fills, path10, out, ctx.assets);
      checkStroke(n.stroke, path10, out);
      if (n.radius && !n.radius.every((r) => fin(r) && r >= 0)) out.push({ path: path10, message: "радиусы" });
      n.children.forEach((c, i) => validateNode(c, `${path10}/${i}`, out, ctx));
      break;
    case "rect":
    case "ellipse":
      checkPaints(n.fills, path10, out, ctx.assets);
      checkStroke(n.stroke, path10, out);
      break;
    case "text": {
      if (typeof n.text !== "string" || !n.text.length) out.push({ path: path10, message: "пустой текст" });
      if (!(fin(n.lineHeight) && n.lineHeight > 0)) out.push({ path: path10, message: "lineHeight" });
      let pos = 0;
      for (const r of n.runs) {
        if (r.start !== pos || r.end <= r.start || r.end > n.text.length) {
          out.push({ path: path10, message: `run ${r.start}-${r.end} не покрывает текст последовательно` });
          break;
        }
        pos = r.end;
        if (!ctx.fonts.has(r.font)) out.push({ path: path10, message: `шрифт ${r.font} не объявлен` });
        if (!(fin(r.size) && r.size > 0)) out.push({ path: path10, message: "размер шрифта" });
        if (!fin(r.letterSpacing)) out.push({ path: path10, message: "letterSpacing" });
        checkColor(r.color, path10, out);
      }
      if (pos !== n.text.length) out.push({ path: path10, message: "runs не покрывают весь текст" });
      checkPaints(n.fills, path10, out, ctx.assets);
      break;
    }
    case "image":
      if (!ctx.assets.has(n.asset)) out.push({ path: path10, message: `нет ассета ${n.asset}` });
      checkPaints(n.fills, path10, out, ctx.assets);
      break;
    case "svg":
      if (!ctx.assets.has(n.asset)) out.push({ path: path10, message: `нет ассета ${n.asset}` });
      if (n.fallback && !ctx.assets.has(n.fallback)) out.push({ path: path10, message: `нет запасного ассета ${n.fallback}` });
      break;
  }
}
function validateSnapshot(s, fonts, assets) {
  const out = [];
  const count = { n: 0 };
  if (!(fin(s.width) && s.width > 0 && fin(s.height) && s.height > 0)) out.push({ path: "root", message: "размер страницы" });
  if (!(Number.isInteger(s.fixedCount) && s.fixedCount >= 0 && s.fixedCount <= s.children.length)) out.push({ path: "root", message: "fixedCount" });
  checkPaints(s.background, "root", out, assets);
  s.children.forEach((c, i) => validateNode(c, `root/${i}`, out, { fonts, assets, count }));
  return { issues: out, nodes: count.n };
}

// processor/src/finalize.ts
init_assets();
var CURSOR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="21" viewBox="0 0 14 21"><path d="M1 1 L1 17 L5 13 L8 20 L10.5 19 L7.6 12.3 L13 12.3 Z" fill="#111" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg>';
function fromDataUrl(u) {
  const m = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(u);
  if (!m) return null;
  const isB64 = m[2].includes(";base64");
  try {
    return isB64 ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "utf8");
  } catch {
    return null;
  }
}
function scaleSubtree(n, sx, sy) {
  const su = Math.sqrt(Math.abs(sx * sy));
  n.w *= sx;
  n.h *= sy;
  const scaleEffects = (es) => es?.forEach((e) => {
    if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
      e.x *= sx;
      e.y *= sy;
      e.blur *= su;
      e.spread *= su;
    } else e.radius *= su;
  });
  scaleEffects(n.effects);
  if ("radius" in n && n.radius) n.radius = n.radius.map((r) => r * su);
  if ("stroke" in n && n.stroke) n.stroke = { ...n.stroke, weights: n.stroke.weights.map((w) => w * su), dash: n.stroke.dash?.map((d) => d * su) };
  if (n.kind === "text") {
    n.lineHeight *= sy;
    for (const r of n.runs) {
      r.size *= su;
      r.letterSpacing *= sx;
      if (r.decorationThickness) r.decorationThickness *= su;
    }
    if (n.textStroke) n.textStroke = { ...n.textStroke, width: n.textStroke.width * su };
  }
  if (n.kind === "frame") {
    for (const c of n.children) {
      c.m = [c.m[0], c.m[1], c.m[2], c.m[3], c.m[4] * sx, c.m[5] * sy];
      scaleSubtree(c, sx, sy);
    }
  }
}
function normalizeScales(nodes, diags, route) {
  const visit = (n) => {
    const d = decompose(n.m);
    const sx = d.scaleX, sy = d.scaleY;
    if (Math.abs(sx - 1) > 1e-5 || Math.abs(sy - 1) > 1e-5 || Math.abs(d.skew) > 1e-5) {
      const uniform = Math.abs(sx - sy) < 1e-3 && Math.abs(d.skew) < 1e-4;
      if (!uniform) {
        if (Math.abs(d.skew) > 1e-4) diags.push({ level: "warn", code: "skew", message: "Наклон (skew) не поддерживается Figma — перенесено без наклона", route, node: n.src });
        else if (Math.abs(d.rotation) > 1e-4) diags.push({ level: "warn", code: "nonuniform-scale", message: "Неравномерный масштаб с поворотом перенесён приближённо", route, node: n.src });
        if (n.kind === "text" && Math.abs(sx - sy) > 1e-3) diags.push({ level: "info", code: "text-stretch", message: "Растянутый текст перенесён без искажения глифов", route, node: n.src });
      }
      n.m = rotationOnly(n.m);
      if (sy < 0) n.m = [n.m[0], n.m[1], -n.m[2], -n.m[3], n.m[4], n.m[5]];
      scaleSubtree(n, sx, Math.abs(sy));
    }
    if (n.kind === "frame") n.children.forEach(visit);
  };
  nodes.forEach(visit);
}
function pruneWrappers(nodes) {
  let removed = 0;
  const visit = (list) => list.map((n) => {
    if (n.kind !== "frame") return n;
    n.children = visit(n.children);
    const plain = !n.fills.length && !n.stroke && !n.effects?.length && !n.clip && (n.opacity === void 0 || n.opacity === 1) && !n.blend && !n.scroll && !n.tags?.length && n.visible !== false;
    if (plain && n.children.length === 1 && Math.abs(n.m[0] - 1) < 1e-9 && Math.abs(n.m[3] - 1) < 1e-9 && Math.abs(n.m[1]) < 1e-9 && Math.abs(n.m[2]) < 1e-9) {
      const c = n.children[0];
      c.m = multiply(n.m, c.m);
      removed++;
      return c;
    }
    return n;
  });
  const out = visit(nodes);
  nodes.splice(0, nodes.length, ...out);
  return removed;
}
function computeExpect(nodes, parent = IDENTITY) {
  for (const n of nodes) {
    const c = multiply(parent, n.m);
    const b = aabb(c, n.w, n.h);
    n.expect = [round2(b[0]), round2(b[1]), round2(b[2]), round2(b[3])];
    if (n.kind === "text") {
      const ax = n.align === "CENTER" ? n.w / 2 : n.align === "RIGHT" ? n.w : 0;
      n.anchor = [round2(c[0] * ax + c[4]), round2(c[1] * ax + c[5])];
    }
    if (n.kind === "frame") computeExpect(n.children, c);
  }
}
var round2 = (v) => Math.round(v * 100) / 100;
function hasFilterMarkup(m) {
  return /<filter[\s>]/.test(m);
}
async function finalizeRoute(run, meta, ctx) {
  const raw = run.raw;
  const route = meta.routeKey;
  const diags = raw.diagnostics.map((d) => ({ ...d, route }));
  const stats = { ...raw.stats };
  const named = new Set(Object.values(raw.fonts).filter((f) => f.family && f.source === "webfont").map((f) => f.family.toLowerCase()));
  const platformOf = (pred) => {
    const acc = /* @__PURE__ */ new Map();
    for (const m of raw.genericMarks) {
      if (!pred(m)) continue;
      for (const f of run.platform[m.mark] ?? []) {
        if (f.isCustomFont || named.has(f.familyName.toLowerCase())) continue;
        const k = f.familyName + "|" + (f.postScriptName ?? "");
        const have = acc.get(k);
        if (have) have.glyphCount += f.glyphCount;
        else acc.set(k, { ...f });
      }
    }
    return [...acc.values()].sort((a, b) => b.glyphCount - a.glyphCount);
  };
  const keyMap = /* @__PURE__ */ new Map();
  const fonts = /* @__PURE__ */ new Map();
  for (const [k, f] of Object.entries(raw.fonts)) {
    let family = f.family, source = f.source, weight = f.weight, italic = f.italic;
    let synthetic = f.synthetic;
    let pick;
    if (!family && f.generic) {
      pick = platformOf((m) => m.generic === f.generic)[0];
      family = pick?.familyName ?? "";
      if (!family) {
        family = f.generic === "monospace" ? "Courier New" : f.generic === "serif" ? "Times New Roman" : "Arial";
        diags.push({ level: "warn", code: "generic-font", message: `Не удалось определить системный шрифт для «${f.generic}»; предполагается ${family}`, route });
      } else diags.push({ level: "info", code: "generic-font", message: `Универсальное семейство «${f.generic}» отрисовано браузером шрифтом ${family}`, route });
      source = "system";
    } else if (source === "system") {
      const list = platformOf((m) => !!m.system?.includes(k));
      pick = list.find((x) => x.familyName.toLowerCase() === family.toLowerCase()) ?? list[0];
      if (pick && pick.familyName.toLowerCase() !== family.toLowerCase()) {
        diags.push({ level: "info", code: "font-alias", message: `«${family}» в этой системе — псевдоним: браузер отрисовал шрифтом ${pick.familyName}`, route });
        family = pick.familyName;
      }
    }
    if (pick) {
      const face = faceFromPostScript(pick.postScriptName);
      if (face) {
        if (f.weight >= 600 && face.weight < 600) synthetic = [...synthetic ?? [], "bold"];
        if (f.italic && !face.italic) synthetic = [...synthetic ?? [], "italic"];
        weight = face.weight;
        italic = face.italic;
      }
    }
    const nk = fontKey(family, weight, italic);
    keyMap.set(k, nk);
    const have = fonts.get(nk);
    if (have) {
      have.chars += f.chars;
      continue;
    }
    fonts.set(nk, { key: nk, family, weight, italic, source, variable: f.variable, synthetic, chars: f.chars, sample: f.sample, routes: [route] });
  }
  const refMap = /* @__PURE__ */ new Map();
  const failures = /* @__PURE__ */ new Map();
  const putImage = (bytes, source, note) => ctx.store.put(bytes, "image", source, note);
  const prepareRaster = async (bytes, mime, filter) => {
    if (FIGMA_NATIVE.has(mime) && !filter) {
      const info = sniffMime(bytes);
      if (FIGMA_NATIVE.has(info)) {
        const { imageSize: imageSize2 } = await Promise.resolve().then(() => (init_assets(), assets_exports));
        const sz = imageSize2(bytes, info);
        if (sz && sz.width <= FIGMA_MAX_PX && sz.height <= FIGMA_MAX_PX && sz.width > 0) return bytes;
      }
    }
    const t = await ctx.renderer.transcode(bytes, mime, { filter, scale: mime === "image/svg+xml" ? ctx.rasterScale : 1 });
    return t.png;
  };
  const inlineExternal = async (markup) => {
    const re = /href="(https?:[^"]+)"/g;
    const urls = /* @__PURE__ */ new Set();
    let m;
    while (m = re.exec(markup)) urls.add(m[1]);
    for (const u of urls) {
      const b = u.startsWith(ctx.siteOrigin) ? ctx.readSiteFile(u) : await ctx.fetchExternal(u);
      if (b) markup = markup.split(`href="${u}"`).join(`href="data:${sniffMime(b)};base64,${b.toString("base64")}"`);
    }
    return markup;
  };
  const cache = ctx.cache ?? /* @__PURE__ */ new Map();
  for (const [ref, a] of Object.entries(raw.assets)) {
    const ck = a.kind === "svg" ? `svg|${a.raster}|${a.w}|${a.h}|${ctx.rasterScale}|${a.markup}` : a.kind === "url" ? `url|${a.url}|${a.filter ?? ""}` : a.kind === "bglayer" ? `bg|${a.w}|${a.h}|${JSON.stringify(a.css)}` : a.kind === "cursor" ? "cursor" : "";
    const hit = ck ? cache.get(ck) : void 0;
    if (hit) {
      refMap.set(ref, { ...hit, info: hit.id ? ctx.store.get(hit.id) : void 0 });
      continue;
    }
    const remember = () => {
      const v2 = refMap.get(ref);
      if (ck && v2) cache.set(ck, { id: v2.id, kind: v2.kind, box: v2.box, raster: v2.raster });
    };
    try {
      if (a.kind === "cursor") {
        const info = ctx.store.put(Buffer.from(CURSOR_SVG), "svg", "cursor");
        refMap.set(ref, { id: info.id, kind: "svg", info });
        continue;
      }
      if (a.kind === "url" || a.kind === "dataurl") {
        const url = a.kind === "url" ? a.url : a.data;
        let bytes = null;
        if (url.startsWith("data:")) bytes = fromDataUrl(url);
        else if (url.startsWith(ctx.siteOrigin)) bytes = ctx.readSiteFile(url);
        else if (/^https?:/.test(url)) bytes = await ctx.fetchExternal(url);
        if (!bytes || !bytes.length) {
          failures.set(ref, `ресурс недоступен: ${url.slice(0, 140)}`);
          continue;
        }
        const mime = sniffMime(bytes);
        if (mime === "application/octet-stream") {
          failures.set(ref, `повреждённое или неизвестное изображение: ${url.slice(0, 140)}`);
          continue;
        }
        const filter = a.kind === "url" ? a.filter : void 0;
        const png = await prepareRaster(bytes, mime, filter);
        const info = putImage(png, a.kind === "url" ? a.url.slice(0, 300) : "canvas", filter ? "filter: " + filter : mime !== sniffMime(png) ? `перекодировано из ${mime}` : void 0);
        refMap.set(ref, { id: info.id, kind: "image", info });
        continue;
      }
      if (a.kind === "svg") {
        const markup = await inlineExternal(a.markup);
        if (a.raster) {
          const r = await ctx.renderer.renderSvg(markup, a.w, a.h, { overflow: a.overflowVisible, filters: hasFilterMarkup(markup), scale: ctx.rasterScale });
          if (r.empty) {
            refMap.set(ref, { id: "", kind: "image", raster: true });
            continue;
          }
          const info = putImage(r.png, "inline-svg", "растр: " + a.reasons.join(", "));
          refMap.set(ref, { id: info.id, kind: "image", info, box: [r.x, r.y, r.w, r.h], raster: true });
        } else {
          const info = ctx.store.put(Buffer.from(markup, "utf8"), "svg", "inline-svg");
          refMap.set(ref, { id: info.id, kind: "svg", info });
        }
        continue;
      }
      if (a.kind === "bglayer") {
        const r = await ctx.renderer.renderCss(a.css, a.w, a.h, ctx.sitePrefix, Math.min(ctx.rasterScale, 2));
        const info = putImage(r.png, "css-background", "растр слоя фона");
        refMap.set(ref, { id: info.id, kind: "image", info });
        continue;
      }
      if (a.kind === "shot") {
        await ctx.page.evaluate(({ k, mark }) => window[k].shotIsolation(mark, true), { k: ctx.apiKey, mark: a.mark });
        const [x, y, w, h] = a.rect;
        const png = await ctx.page.screenshot({ type: "png", omitBackground: true, fullPage: true, clip: { x: Math.max(0, x), y: Math.max(0, y), width: Math.max(1, w), height: Math.max(1, h) }, timeout: 3e4 });
        await ctx.page.evaluate(({ k, mark }) => window[k].shotIsolation(mark, false), { k: ctx.apiKey, mark: a.mark });
        const info = putImage(await prepareRaster(png, "image/png"), "element-shot", "снимок области: " + a.reason);
        refMap.set(ref, { id: info.id, kind: "image", info });
      }
    } catch (e) {
      failures.set(ref, `ошибка обработки ресурса: ${String(e.message).slice(0, 160)}`);
    } finally {
      remember();
    }
  }
  for (const [ref, msg] of failures) diags.push({ level: "warn", code: "asset-failed", message: msg, route, node: ref });
  const broken = (n, why) => ({ kind: "frame", id: n.id, name: "Нет ресурса · " + n.name, src: n.src, m: n.m, w: n.w, h: n.h, fills: [{ type: "SOLID", color: { r: 0.94, g: 0.94, b: 0.94 }, opacity: 1 }], stroke: { color: { r: 0.75, g: 0.6, b: 0.6 }, opacity: 1, weights: [1, 1, 1, 1], align: "INSIDE", dash: [4, 4] }, clip: true, children: [], tags: ["broken-asset"], opacity: n.opacity });
  const fixPaints = (ps) => {
    if (!ps) return ps;
    const out = [];
    for (const p of ps) {
      if (p.type !== "IMAGE") {
        out.push(p);
        continue;
      }
      const r = refMap.get(p.asset);
      if (!r || !r.id || r.kind !== "image") continue;
      const np = { ...p, asset: r.id };
      if (p.scaleMode === "TILE" && p.tileCss && r.info) np.scalingFactor = p.tileCss / r.info.width;
      delete np.tileCss;
      out.push(np);
    }
    return out;
  };
  const fixNode = (n) => {
    if (n.kind === "frame" || n.kind === "rect" || n.kind === "ellipse") n.fills = fixPaints(n.fills) ?? [];
    if (n.kind === "text") n.runs = n.runs.map((r) => ({ ...r, font: keyMap.get(r.font) ?? r.font }));
    if (n.kind === "image") {
      n.fills = fixPaints(n.fills);
      const r = refMap.get(n.asset);
      if (!r || !r.id) return broken(n, "image");
      n.asset = r.id;
    }
    if (n.kind === "svg") {
      const r = refMap.get(n.asset);
      if (!r) return broken(n, "svg");
      if (r.raster) {
        if (!r.id || !r.box) return null;
        const [bx, by, bw, bh] = r.box;
        const img = { kind: "image", id: n.id, name: n.name.replace(/^SVG/, "Иллюстрация (растр)"), src: n.src, m: multiply(n.m, translate(bx, by)), w: bw, h: bh, asset: r.id, scaleMode: "FILL", opacity: n.opacity, blend: n.blend, effects: n.effects, tags: [...(n.tags ?? []).filter((t) => t !== "raster"), "raster"] };
        if (n.clip && (bx < -0.5 || by < -0.5 || bx + bw > n.w + 0.5 || by + bh > n.h + 0.5)) {
          const wrap = { kind: "frame", id: n.id + "c", name: n.name, src: n.src, m: n.m, w: n.w, h: n.h, fills: [], clip: true, children: [{ ...img, m: translate(bx, by) }], opacity: n.opacity, blend: n.blend, effects: n.effects };
          img.opacity = void 0;
          img.blend = void 0;
          img.effects = void 0;
          return wrap;
        }
        return img;
      }
      n.asset = r.id;
    }
    if (n.kind === "frame") n.children = n.children.map(fixNode).filter((c) => !!c);
    return n;
  };
  const children = raw.children.map(fixNode).filter((c) => !!c);
  const background = fixPaints(raw.background) ?? [];
  let fixedCount = 0;
  for (let i = children.length - 1; i >= 0 && children[i].scroll === "fixed"; i--) fixedCount++;
  normalizeScales(children, diags, route);
  if (meta.prune) stats.prunedWrappers = pruneWrappers(children);
  computeExpect(children);
  const usedAssets = /* @__PURE__ */ new Set();
  const usedFonts = /* @__PURE__ */ new Set();
  const collect = (n) => {
    const ps = n.fills;
    ps?.forEach((p) => {
      if (p.type === "IMAGE") usedAssets.add(p.asset);
    });
    if (n.kind === "image" || n.kind === "svg") usedAssets.add(n.asset);
    if (n.kind === "svg" && n.fallback) usedAssets.add(n.fallback);
    if (n.kind === "text") n.runs.forEach((r) => usedFonts.add(r.font));
    if (n.kind === "frame") n.children.forEach(collect);
  };
  children.forEach(collect);
  background.forEach((p) => {
    if (p.type === "IMAGE") usedAssets.add(p.asset);
  });
  const snapshot = {
    schemaVersion: SCHEMA_VERSION,
    routeKey: route,
    url: route,
    title: raw.title,
    label: meta.label,
    viewport: raw.viewport,
    width: raw.width,
    height: Math.max(1, raw.height),
    background,
    children,
    fixedCount,
    hover: meta.hover,
    stats,
    diagnostics: diags,
    fonts: [...usedFonts],
    assets: [...usedAssets],
    capturedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  const v = validateSnapshot(snapshot, new Set(fonts.keys()), new Set(ctx.store.all().map((a) => a.id)));
  stats.irNodes = v.nodes;
  stats.transformMismatches = raw.geometry.mismatches.length;
  stats.prepShift = raw.geometry.maxShift;
  if (v.issues.length) {
    diags.push({ level: "error", code: "ir-invalid", message: `Модель страницы не прошла проверку: ${v.issues.slice(0, 5).map((i) => i.path + ": " + i.message).join("; ")}`, route, count: v.issues.length });
  }
  for (const f of fonts.values()) if (!usedFonts.has(f.key)) fonts.delete(f.key);
  return { snapshot, fonts: [...fonts.values()], diagnostics: diags };
}

// processor/src/profiles.ts
var import_node_fs4 = __toESM(require("node:fs"), 1);
var import_node_path4 = __toESM(require("node:path"), 1);
function loadAdapters(dirs) {
  const out = [];
  for (const d of dirs) {
    if (!d || !import_node_fs4.default.existsSync(d)) continue;
    for (const f of import_node_fs4.default.readdirSync(d)) {
      if (!f.endsWith(".json")) continue;
      try {
        const a = JSON.parse(import_node_fs4.default.readFileSync(import_node_path4.default.join(d, f), "utf8"));
        if (a.id && a.match && a.profile) out.push(a);
      } catch {
      }
    }
  }
  return out;
}
function matchAdapter(adapters, source, sha256) {
  for (const a of adapters) {
    if (a.match.sha256?.includes(sha256)) return a;
    const all = a.match.allOf ?? [];
    const any = a.match.anyOf ?? [];
    if ((all.length || any.length) && all.every((s) => source.includes(s)) && (!any.length || any.some((s) => source.includes(s)))) return a;
  }
  return null;
}
function storageHints(keys, sources) {
  const text = sources.join("\n");
  const out = [];
  const allKeys = new Set(keys);
  const re = /(?:getItem|setItem|\.get|\.set|\.json|\.put)\(\s*['"]([\w.:-]{2,40})['"]/g;
  let m;
  while (m = re.exec(text)) allKeys.add(m[1]);
  for (const key of allKeys) {
    const values = /* @__PURE__ */ new Set();
    const suffix = key.split(/[-_.:]/).pop().toLowerCase();
    if (suffix.length >= 2) {
      const arr = new RegExp(`(?:const|let|var)\\s+\\w*${suffix}\\w*\\s*=\\s*\\[([^\\]]{0,400})\\]`, "gi");
      let a;
      while (a = arr.exec(text)) for (const v of a[1].matchAll(/['"]([\w-]{1,24})['"]/g)) values.add(v[1]);
    }
    const def = new RegExp(`['"]${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]\\s*,\\s*['"]([\\w-]{1,24})['"]`, "g");
    let d;
    while (d = def.exec(text)) values.add(d[1]);
    if (!keys.includes(key) && !values.size) continue;
    out.push({ key, values: [...values].slice(0, 12), read: keys.includes(key) });
  }
  return out.sort((a, b) => Number(b.read) - Number(a.read) || a.key.localeCompare(b.key)).slice(0, 30);
}
function hoverPreferFor(map, key) {
  if (!map) return null;
  if (map[key] !== void 0) return map[key];
  const hash = key.indexOf("#");
  if (hash >= 0 && map[key.slice(hash)] !== void 0) return map[key.slice(hash)];
  const file = key.split(/[?#]/)[0];
  if (hash < 0 && map[file] !== void 0) return map[file];
  if (hash < 0 && !key.includes("?") && map["#/"] !== void 0) return map["#/"];
  return null;
}

// processor/src/render.ts
init_png();
var MAX = 4096;
var PIXEL_BUDGET = 4e6;
var budgetScale = (scale, w, h) => Math.max(0.05, Math.min(scale, MAX / w, MAX / h, Math.sqrt(PIXEL_BUDGET / Math.max(1, w * h))));
var Renderer = class {
  constructor(browser, allowOrigins, blockExternal) {
    this.browser = browser;
    this.allowOrigins = allowOrigins;
    this.blockExternal = blockExternal;
  }
  browser;
  allowOrigins;
  blockExternal;
  ctx = null;
  page = null;
  async ensure() {
    if (this.page && !this.page.isClosed()) return this.page;
    this.ctx = await this.browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1, serviceWorkers: "block" });
    await this.ctx.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith("data:") || url.startsWith("blob:") || url === "about:blank" || this.allowOrigins.some((o) => url.startsWith(o))) return route.continue();
      if (this.blockExternal || !/^https?:/.test(url) || /^https?:\/\/(localhost|127\.|10\.|192\.168\.)/.test(url)) return route.abort();
      return route.continue();
    });
    this.page = await this.ctx.newPage();
    return this.page;
  }
  async close() {
    await this.ctx?.close().catch(() => void 0);
    this.ctx = null;
    this.page = null;
  }
  async shot(html, cw, ch, baseUrl) {
    const page = await this.ensure();
    await page.setViewportSize({ width: Math.max(1, Math.ceil(cw)), height: Math.max(1, Math.ceil(ch)) });
    const base = baseUrl ? `<base href="${baseUrl.replace(/"/g, "&quot;")}">` : "";
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8">${base}<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}</style></head><body>${html}</body></html>`, { waitUntil: "load", timeout: 3e4 });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images).map((i) => i.decode().catch(() => void 0)));
    });
    return page.screenshot({ type: "png", omitBackground: true, clip: { x: 0, y: 0, width: Math.max(1, Math.ceil(cw)), height: Math.max(1, Math.ceil(ch)) }, timeout: 3e4 });
  }
  /** SVG → PNG. pad — запас вокруг viewport для overflow:visible/фильтров; результат обрезан по альфе. */
  async renderSvg(markup, w, h, opts) {
    const pad = opts.overflow ? Math.max(16, Math.round(0.3 * Math.max(w, h))) : 0;
    const W = w + 2 * pad, H = h + 2 * pad;
    const s = budgetScale(opts.scale, W, H);
    const html = `<div style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0;transform:scale(${s})"><div style="position:absolute;left:${pad}px;top:${pad}px;width:${w}px;height:${h}px;line-height:0">${markup}</div></div>`;
    const png = await this.shot(html, W * s, H * s);
    if (!pad) return { png, x: 0, y: 0, w, h, scale: s };
    const img = decodePng(png);
    const b = alphaBounds(img);
    if (!b) return { png: encodePng({ width: 1, height: 1, data: Buffer.alloc(4) }), x: 0, y: 0, w: 0, h: 0, scale: s, empty: true };
    const r = pad ? b : { x: 0, y: 0, w: img.width, h: img.height };
    const out = encodePng(crop(img, r));
    return { png: out, x: r.x / s - pad, y: r.y / s - pad, w: r.w / s, h: r.h / s, scale: s };
  }
  /** Один CSS-слой фона, отрисованный браузером в коробке w×h. */
  async renderCss(css, w, h, baseUrl, scale) {
    const s = budgetScale(scale, w, h);
    const style = Object.entries(css).map(([k, v]) => `${k}:${v}`).join(";");
    const html = `<div style="position:absolute;left:0;top:0;width:${w}px;height:${h}px;transform-origin:0 0;transform:scale(${s});${style.replace(/"/g, "'")}"></div>`;
    const png = await this.shot(html, w * s, h * s, baseUrl);
    return { png, x: 0, y: 0, w, h, scale: s };
  }
  /** Перекодирование (webp/avif/svg/bmp → PNG), уменьшение до 4096 px, запекание CSS filter. */
  async transcode(bytes, mime, opts) {
    const page = await this.ensure();
    await page.setContent("<!doctype html><html><body></body></html>");
    const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;
    const res = await page.evaluate(async ({ dataUrl: dataUrl2, filter, w, h, scale, max, mime: mime2, jpeg }) => {
      const img = new Image();
      img.src = dataUrl2;
      await img.decode();
      let tw = w || img.naturalWidth || 300, th = h || img.naturalHeight || 150;
      if (mime2 === "image/svg+xml" && scale) {
        tw *= scale;
        th *= scale;
      }
      const k = Math.min(1, max / tw, max / th);
      tw = Math.max(1, Math.round(tw * k));
      th = Math.max(1, Math.round(th * k));
      const c = document.createElement("canvas");
      c.width = tw;
      c.height = th;
      const ctx = c.getContext("2d");
      if (filter) ctx.filter = filter;
      ctx.drawImage(img, 0, 0, tw, th);
      return { url: jpeg ? c.toDataURL("image/jpeg", jpeg) : c.toDataURL("image/png"), width: tw, height: th };
    }, { dataUrl, filter: opts.filter ?? "", w: opts.width ?? 0, h: opts.height ?? 0, scale: opts.scale ?? 1, max: MAX, mime, jpeg: opts.jpeg ?? 0 });
    return { png: Buffer.from(res.url.split(",")[1], "base64"), width: res.width, height: res.height };
  }
};

// processor/src/zip.ts
var import_node_fs5 = __toESM(require("node:fs"), 1);
var import_node_path5 = __toESM(require("node:path"), 1);
var import_node_zlib2 = __toESM(require("node:zlib"), 1);
var DEFAULT_ZIP_LIMITS = { maxEntries: 5e3, maxFileBytes: 200 * 1024 * 1024, maxTotalBytes: 1024 * 1024 * 1024, maxRatio: 250 };
var ZipError = class extends Error {
  constructor(message, code2 = "ZIP") {
    super(message);
    this.code = code2;
  }
  code;
};
var CP866_HIGH = "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмноп░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀рстуфхцчшщъыьэюяЁёЄєЇїЎў°∙·√№¤■ ";
function decodeName(buf, utf8Flag) {
  if (utf8Flag) return buf.toString("utf8");
  const asUtf8 = buf.toString("utf8");
  if (!asUtf8.includes("�")) return asUtf8;
  let s = "";
  for (const b of buf) s += b < 128 ? String.fromCharCode(b) : CP866_HIGH[b - 128];
  return s;
}
function safeEntryPath(name) {
  let n = name.replace(/\\/g, "/");
  if (/^[a-zA-Z]:/.test(n) || n.startsWith("//")) return null;
  n = n.replace(/^\/+/, "");
  const parts = [];
  for (const p of n.split("/")) {
    if (p === "" || p === ".") continue;
    if (p === "..") return null;
    if (/[\u0000-\u001f<>:"|?*]/.test(p)) return null;
    parts.push(p);
  }
  return parts.length ? parts.join("/") : null;
}
function readEntries(buf, limits = DEFAULT_ZIP_LIMITS) {
  const min = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) if (buf.readUInt32LE(i) === 101010256) {
    eocd = i;
    break;
  }
  if (eocd < 0) throw new ZipError("Файл не является ZIP-архивом или повреждён (нет каталога).", "ZIP_FORMAT");
  let count = buf.readUInt16LE(eocd + 10);
  let cdSize = buf.readUInt32LE(eocd + 12);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 65535 || cdOffset === 4294967295) {
    const loc = eocd - 20;
    if (loc >= 0 && buf.readUInt32LE(loc) === 117853008) {
      const e64 = Number(buf.readBigUInt64LE(loc + 8));
      if (buf.readUInt32LE(e64) !== 101075792) throw new ZipError("Повреждён каталог ZIP64.", "ZIP_FORMAT");
      count = Number(buf.readBigUInt64LE(e64 + 32));
      cdSize = Number(buf.readBigUInt64LE(e64 + 40));
      cdOffset = Number(buf.readBigUInt64LE(e64 + 48));
    }
  }
  if (count > limits.maxEntries) throw new ZipError(`В архиве слишком много файлов (${count}; предел ${limits.maxEntries}).`, "ZIP_LIMIT");
  if (cdOffset + cdSize > buf.length) throw new ZipError("Повреждённый ZIP: каталог за пределами файла.", "ZIP_FORMAT");
  const out = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 33639248) throw new ZipError("Повреждённая запись каталога ZIP.", "ZIP_FORMAT");
    const made = buf.readUInt16LE(p + 4);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    let csize = buf.readUInt32LE(p + 20);
    let size = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const ext = buf.readUInt32LE(p + 38);
    let offset = buf.readUInt32LE(p + 42);
    const name = decodeName(buf.subarray(p + 46, p + 46 + nlen), (flags & 2048) !== 0);
    let x = p + 46 + nlen;
    const xend = x + xlen;
    while (x + 4 <= xend) {
      const id = buf.readUInt16LE(x), sz = buf.readUInt16LE(x + 2);
      if (id === 1) {
        let q = x + 4;
        if (size === 4294967295) {
          size = Number(buf.readBigUInt64LE(q));
          q += 8;
        }
        if (csize === 4294967295) {
          csize = Number(buf.readBigUInt64LE(q));
          q += 8;
        }
        if (offset === 4294967295) {
          offset = Number(buf.readBigUInt64LE(q));
          q += 8;
        }
      }
      x += 4 + sz;
    }
    const unixMode = made >> 8 === 3 ? ext >>> 16 : 0;
    const symlink = (unixMode & 61440) === 40960;
    out.push({ name, method, compressedSize: csize, size, crc, offset, isDir: name.endsWith("/") || name.endsWith("\\"), flags, symlink });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}
function readEntryData(buf, e, limits = DEFAULT_ZIP_LIMITS) {
  if (e.flags & 1) throw new ZipError(`Файл «${e.name}» зашифрован — архивы с паролем не поддерживаются.`, "ZIP_ENCRYPTED");
  const p = e.offset;
  if (buf.readUInt32LE(p) !== 67324752) throw new ZipError("Повреждённый локальный заголовок ZIP.", "ZIP_FORMAT");
  const nlen = buf.readUInt16LE(p + 26), xlen = buf.readUInt16LE(p + 28);
  const start = p + 30 + nlen + xlen;
  const raw = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return Buffer.from(raw);
  if (e.method !== 8) throw new ZipError(`Метод сжатия ${e.method} не поддерживается (файл «${e.name}»).`, "ZIP_METHOD");
  const max = Math.min(limits.maxFileBytes, Math.max(1024 * 1024, e.compressedSize * limits.maxRatio)) + 1;
  try {
    return import_node_zlib2.default.inflateRawSync(raw, { maxOutputLength: max });
  } catch (err) {
    if (String(err.message).includes("maxOutputLength") || err.code === "ERR_BUFFER_TOO_LARGE") {
      throw new ZipError(`Файл «${e.name}» распаковывается в слишком большой объём (возможна zip-бомба).`, "ZIP_LIMIT");
    }
    throw new ZipError(`Не удалось распаковать «${e.name}»: ${err.message}`, "ZIP_FORMAT");
  }
}
function extractZip(buf, dest, limits = DEFAULT_ZIP_LIMITS) {
  const entries = readEntries(buf, limits);
  const root = import_node_path5.default.resolve(dest);
  import_node_fs5.default.mkdirSync(root, { recursive: true });
  const rep = { files: [], skipped: [], totalBytes: 0 };
  for (const e of entries) {
    if (e.isDir) continue;
    const safe = safeEntryPath(e.name);
    if (!safe) {
      rep.skipped.push({ name: e.name, reason: "небезопасный путь" });
      continue;
    }
    if (e.symlink) {
      rep.skipped.push({ name: e.name, reason: "символическая ссылка" });
      continue;
    }
    if (/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/.test(safe)) {
      rep.skipped.push({ name: e.name, reason: "служебный файл" });
      continue;
    }
    if (e.size > limits.maxFileBytes) throw new ZipError(`Файл «${safe}» слишком большой (${Math.round(e.size / 1048576)} МБ).`, "ZIP_LIMIT");
    const data = readEntryData(buf, e, limits);
    rep.totalBytes += data.length;
    if (rep.totalBytes > limits.maxTotalBytes) throw new ZipError("Распакованный объём архива превышает предел.", "ZIP_LIMIT");
    const target = import_node_path5.default.resolve(root, safe);
    if (!target.startsWith(root + import_node_path5.default.sep)) {
      rep.skipped.push({ name: e.name, reason: "выход за пределы папки" });
      continue;
    }
    import_node_fs5.default.mkdirSync(import_node_path5.default.dirname(target), { recursive: true });
    import_node_fs5.default.writeFileSync(target, data);
    rep.files.push(safe);
  }
  return rep;
}
var crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc322(b) {
  const z = import_node_zlib2.default;
  if (typeof z.crc32 === "function") return z.crc32(b) >>> 0;
  let c = 4294967295;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 255] ^ c >>> 8;
  return (c ^ 4294967295) >>> 0;
}
function createZip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  const dosTime = 0, dosDate = 2026 - 1980 << 9 | 1 << 5 | 1;
  for (const f of files) {
    const name = Buffer.from(f.name.replace(/\\/g, "/"), "utf8");
    const crc = crc322(f.data);
    const comp = f.store ? f.data : import_node_zlib2.default.deflateRawSync(f.data, { level: 6 });
    const method = f.store ? 0 : 8;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(67324752, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(2048, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(dosTime, 10);
    lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(33639248, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(2048, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(dosTime, 12);
    ch.writeUInt16LE(dosDate, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(101010256, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// processor/src/jobs.ts
var UserError = class extends Error {
  constructor(message, action, code2 = "USER") {
    super(message);
    this.action = action;
    this.code = code2;
  }
  action;
  code;
};
var sha = (b) => import_node_crypto4.default.createHash("sha256").update(b).digest("hex");
function listHtml(dir, max = 400) {
  const out = [];
  const walk = (d, depth) => {
    if (depth > 6 || out.length >= max) return;
    for (const f of import_node_fs6.default.readdirSync(d)) {
      const p = import_node_path6.default.join(d, f);
      const st = import_node_fs6.default.statSync(p);
      if (st.isDirectory()) {
        if (!/^(node_modules|\.git|__MACOSX)$/.test(f)) walk(p, depth + 1);
      } else if (/\.html?$/i.test(f)) out.push(import_node_path6.default.relative(dir, p).split(import_node_path6.default.sep).join("/"));
    }
  };
  walk(dir, 0);
  return out.sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
}
function chooseEntry(files) {
  if (!files.length) return null;
  const idx = files.find((f) => /^index\.html?$/i.test(f));
  if (idx) return idx;
  const nested = files.filter((f) => /(^|\/)index\.html?$/i.test(f)).sort((a, b) => a.split("/").length - b.split("/").length);
  if (nested.length) return nested[0];
  return files[0];
}
var Job = class {
  constructor(mgr, name) {
    this.mgr = mgr;
    this.dir = import_node_path6.default.join(mgr.jobsDir, this.id);
    this.siteDir = import_node_path6.default.join(this.dir, "site");
    import_node_fs6.default.mkdirSync(this.siteDir, { recursive: true });
    for (const d of ["routes", "thumbs", "shots", "verify"]) import_node_fs6.default.mkdirSync(import_node_path6.default.join(this.dir, d), { recursive: true });
    this.sourceName = name.replace(/[^\p{L}\p{N}._ -]+/gu, "_").slice(0, 120) || "project";
    this.store = new AssetStore(import_node_path6.default.join(this.dir, "assets"), { maxAssets: mgr.cfg.limits.maxAssetsPerJob, maxTotalBytes: mgr.cfg.limits.maxAssetBytesPerJob });
  }
  mgr;
  id = import_node_crypto4.default.randomBytes(9).toString("hex").replace(/[^a-z0-9]/g, "");
  dir;
  siteDir;
  state = "analyzing";
  error = null;
  progress = { stage: "upload", done: 0, total: 1, message: "Файл получен" };
  createdAt = (/* @__PURE__ */ new Date()).toISOString();
  updatedAt = Date.now();
  sourceName;
  sourceHash = "";
  entries = [];
  entry = "";
  projectKey = "";
  adapter = null;
  profile = { ...DEFAULT_PROFILE };
  routeSelector = null;
  routes = [];
  storage = [];
  diagnostics = [];
  fontsPreview = [];
  fonts = /* @__PURE__ */ new Map();
  snapshots = /* @__PURE__ */ new Map();
  store;
  cancelled = false;
  contexts = /* @__PURE__ */ new Set();
  sources = [];
  rasterCache = /* @__PURE__ */ new Map();
  extraRoutes = [];
  options = {};
  get prefix() {
    return this.mgr.site.prefix(this.id);
  }
  set(p) {
    this.progress = { ...this.progress, ...p };
    this.updatedAt = Date.now();
  }
  diag(d) {
    const same = this.diagnostics.find((x) => x.code === d.code && x.message === d.message && x.route === d.route);
    if (same) same.count = (same.count ?? 1) + 1;
    else this.diagnostics.push(d);
  }
  checkCancel() {
    if (this.cancelled) throw new UserError("Операция отменена", "Можно запустить анализ заново.", "CANCELLED");
  }
  async cancel() {
    this.cancelled = true;
    for (const c of this.contexts) await c.close().catch(() => void 0);
    this.contexts.clear();
  }
  // ---------------- загрузка и распаковка ----------------
  unpack(buf) {
    this.sourceHash = sha(buf);
    const isZip = buf.length > 4 && buf[0] === 80 && buf[1] === 75 && (buf[2] === 3 || buf[2] === 5);
    const head = buf.subarray(0, 2048).toString("utf8").trimStart().toLowerCase();
    if (isZip) {
      this.set({ stage: "unpack", message: "Распаковываю ZIP" });
      const l = this.mgr.cfg.limits;
      const rep = extractZip(buf, this.siteDir, { maxEntries: l.maxZipEntries, maxFileBytes: l.maxFileBytes, maxTotalBytes: l.maxZipTotalBytes, maxRatio: 250 });
      for (const s of rep.skipped.slice(0, 20)) this.diag({ level: "warn", code: "zip-skip", message: `Файл из архива пропущен (${s.reason}): ${s.name}` });
    } else if (head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<") || /\.html?$/i.test(this.sourceName)) {
      const name = /\.html?$/i.test(this.sourceName) ? this.sourceName : "index.html";
      import_node_fs6.default.writeFileSync(import_node_path6.default.join(this.siteDir, name), buf);
    } else {
      throw new UserError("Файл не похож на HTML или ZIP.", "Выберите файл .html/.htm или ZIP-архив с HTML, CSS, JS и ресурсами.", "FORMAT");
    }
    this.entries = listHtml(this.siteDir);
    if (!this.entries.length) throw new UserError("В архиве не найдено ни одного HTML-файла.", "Добавьте в ZIP файл index.html (или другой .html) и загрузите снова.", "NO_HTML");
  }
  readSources() {
    const out = [];
    let total = 0;
    const entryText = import_node_fs6.default.readFileSync(import_node_path6.default.join(this.siteDir, this.entry), "utf8");
    out.push(entryText);
    total += entryText.length;
    const walk = (d) => {
      for (const f of import_node_fs6.default.readdirSync(d)) {
        const p = import_node_path6.default.join(d, f);
        if (import_node_fs6.default.statSync(p).isDirectory()) walk(p);
        else if (/\.(m?js)$/i.test(f) && total < 8e6) {
          const t = import_node_fs6.default.readFileSync(p, "utf8");
          out.push(t);
          total += t.length;
        }
      }
    };
    walk(this.siteDir);
    this.sources = out;
  }
  // ---------------- анализ ----------------
  async analyze(opts) {
    this.options = opts;
    this.state = "analyzing";
    this.error = null;
    this.cancelled = false;
    try {
      this.entry = opts.entry && this.entries.includes(opts.entry) ? opts.entry : chooseEntry(this.entries);
      this.readSources();
      this.projectKey = sha(this.sourceName.replace(/\.(zip|html?)$/i, "").toLowerCase() + "|" + this.entry).slice(0, 16);
      this.adapter = opts.useAdapter === false ? null : matchAdapter(this.mgr.adapters, this.sources[0], this.sourceHash);
      this.profile = { ...DEFAULT_PROFILE, ...this.adapter?.profile ?? {}, ...opts.profile ?? {} };
      this.profile.storage = { ...this.adapter?.profile.storage ?? {}, ...opts.profile?.storage ?? {} };
      if (this.adapter) {
        this.profile.adapterId = this.adapter.id;
        this.diag({ level: "info", code: "adapter", message: `Применён профиль проекта: ${this.adapter.label}` });
      }
      this.routeSelector = opts.routeSelector !== void 0 ? opts.routeSelector : this.adapter?.routeSelector ?? null;
      this.extraRoutes = [...this.adapter?.extraRoutes ?? [], ...opts.extraRoutes ?? []];
      this.mgr.site.mount(this.id, { dir: this.siteDir, spaFallback: this.profile.spaFallback, entry: this.entry });
      await this.discover(opts);
      this.storage = storageHints(this.storageKeys, this.sources);
      this.state = "ready";
      const ok = this.routes.filter((r) => r.status === "ok").length;
      this.set({ stage: "ready", done: 1, total: 1, message: `Найдено страниц: ${ok}` });
    } catch (e) {
      this.fail(e);
    }
  }
  storageKeys = [];
  fail(e) {
    if (this.cancelled) {
      this.state = "cancelled";
      this.error = { message: "Операция отменена.", action: "Нажмите «Анализировать» ещё раз, когда будете готовы." };
      return;
    }
    this.state = "error";
    if (e instanceof UserError) this.error = { message: e.message, action: e.action };
    else if (e instanceof ZipError) this.error = { message: e.message, action: "Проверьте архив: распакуйте его на компьютере и упакуйте заново стандартным ZIP без пароля." };
    else if (e.code === "NO_BROWSER") this.error = { message: "Обработчик не нашёл браузер Chromium/Edge/Chrome.", action: "Установите Microsoft Edge или Google Chrome, либо запустите «install-browser.cmd» из папки обработчика." };
    else this.error = { message: "Внутренняя ошибка обработчика: " + String(e?.message ?? e).slice(0, 300), action: "Повторите попытку. Если ошибка повторяется — скачайте отчёт и приложите его к сообщению об ошибке." };
    this.set({ stage: "error", message: this.error.message });
  }
  async visit(url, extra = {}) {
    const { browser } = await getBrowser();
    const rec = { storageKeys: /* @__PURE__ */ new Set(), external: /* @__PURE__ */ new Set(), failed: /* @__PURE__ */ new Map() };
    const ctx = await newContext(browser, { profile: this.profile, siteOrigin: this.mgr.site.origin() + "/", injectCss: this.injectCss(), record: rec });
    this.contexts.add(ctx);
    try {
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
      const resp = await page.goto(url, { waitUntil: "load", timeout: this.mgr.cfg.limits.routeTimeoutMs }).catch((e) => {
        throw new Error("страница не открылась: " + String(e.message).split("\n")[0]);
      });
      if (resp && resp.status() >= 400) return { error: `HTTP ${resp.status()}` };
      await waitAfterNavigation(page, 8e3);
      const key = await inject(page);
      await call(page, key, "settle", { timeoutMs: 6e3 });
      const finalUrl = page.url();
      const links = await call(page, key, "links", this.profile.exclude);
      const fp = await call(page, key, "fingerprint", this.profile.exclude);
      let selected = null;
      if (extra.selector) {
        selected = await page.evaluate(({ sel, k }) => {
          try {
            const api = window[k];
            return Array.from(document.querySelectorAll(sel)).map((a) => ({ href: a.getAttribute("href") ?? "", text: (api.linkLabel ? api.linkLabel(a) : a.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80) }));
          } catch {
            return null;
          }
        }, { sel: extra.selector, k: key });
      }
      const keys = await page.evaluate(() => [...window.__h2fKeys ?? []]).catch(() => []);
      const fonts = await page.evaluate(() => {
        const s = /* @__PURE__ */ new Set();
        for (const el of Array.from(document.querySelectorAll("body *")).slice(0, 5e3)) {
          if (!Array.from(el.childNodes).some((n) => n.nodeType === 3 && /\S/.test(n.textContent ?? ""))) continue;
          const cs = getComputedStyle(el);
          if (cs.display === "none") continue;
          s.add(`${cs.fontFamily.split(",")[0].replace(/["']/g, "").trim()} ${cs.fontWeight}${cs.fontStyle.startsWith("italic") ? " italic" : ""}`);
        }
        return [...s];
      });
      const title = await page.title();
      const thumb = await page.screenshot({ type: "jpeg", quality: 60, timeout: 2e4 }).catch(() => null);
      return { finalUrl, links: links.links, ids: links.ids, fp, selected, keys, fonts, title, thumb, errors: errors.slice(0, 5), failed: [...rec.failed] };
    } finally {
      this.contexts.delete(ctx);
      await ctx.close().catch(() => void 0);
    }
  }
  injectCss() {
    return (this.profile.injectCss ?? []).map((p) => ({ url: /^https?:/.test(p) ? p : this.prefix + p.replace(/^\/+/, "") }));
  }
  async discover(opts) {
    const L = this.mgr.cfg.limits;
    const maxRoutes = Math.min(opts.maxRoutes ?? L.maxRoutes, 400);
    const maxDepth = Math.min(opts.maxDepth ?? L.maxDepth, 8);
    const deadline = Date.now() + L.discoveryTimeoutMs;
    const base = this.prefix;
    const routes = /* @__PURE__ */ new Map();
    const fpOwner = /* @__PURE__ */ new Map();
    const shapes = /* @__PURE__ */ new Map();
    const linkText = /* @__PURE__ */ new Map();
    const queue = [];
    const seen = /* @__PURE__ */ new Set();
    const push = (it, label) => {
      if (seen.has(it.key)) return;
      seen.add(it.key);
      if (label && !linkText.has(it.key)) linkText.set(it.key, label);
      queue.push(it);
    };
    const entryUrl = base + this.entry.split("/").map(encodeURIComponent).join("/");
    push({ key: routeKey(entryUrl, base), url: entryUrl, depth: 0, source: "entry" }, "Главная");
    for (const f of this.entries) if (f !== this.entry) {
      const u = base + f.split("/").map(encodeURIComponent).join("/");
      push({ key: routeKey(u, base), url: u, depth: 0, source: "file" });
    }
    for (const r of this.extraRoutes) {
      const u = /^https?:/.test(r) ? r : r.startsWith("#") ? entryUrl + r : base + r.replace(/^\/+/, "");
      try {
        push({ key: routeKey(u, base), url: u, depth: 0, source: "manual" });
      } catch {
        this.diag({ level: "warn", code: "manual-route", message: `Неверный адрес маршрута: ${r}` });
      }
    }
    let probeFp = null;
    let codeAdded = false;
    let selectorMode = false;
    const indexKeys = /* @__PURE__ */ new Set();
    let processed = 0;
    const active = /* @__PURE__ */ new Set();
    const okCount = () => [...routes.values()].filter((r) => r.status === "ok").length;
    const handle = async (it) => {
      this.set({ stage: "discover", done: processed, total: processed + queue.length + active.size, message: `Проверяю ${it.key}` });
      const shape = routeShape(it.key);
      const nShape = (shapes.get(shape) ?? 0) + 1;
      shapes.set(shape, nShape);
      const info = { key: it.key, url: it.key, label: linkText.get(it.key) ?? "", title: "", group: routeGroup(it.key), depth: it.depth, source: it.source, status: "ok" };
      routes.set(it.key, info);
      if (nShape > L.perShapeLimit && it.source !== "manual") {
        info.status = "limit";
        info.reason = `однотипных адресов больше ${L.perShapeLimit} (пагинация/календарь)`;
        return;
      }
      if (okCount() >= maxRoutes) {
        info.status = "limit";
        info.reason = `достигнут предел страниц (${maxRoutes})`;
        return;
      }
      if (Date.now() > deadline) {
        info.status = "limit";
        info.reason = "исчерпано время обхода";
        return;
      }
      let v;
      try {
        v = await this.visit(it.url, { selector: it.source === "entry" ? this.routeSelector : null });
      } catch (e) {
        this.checkCancel();
        info.status = "error";
        info.reason = String(e.message).slice(0, 200);
        return;
      }
      this.checkCancel();
      if ("error" in v && v.error) {
        info.status = "error";
        info.reason = v.error;
        return;
      }
      const r = v;
      for (const k of r.keys ?? []) if (!this.storageKeys.includes(k)) this.storageKeys.push(k);
      for (const f of r.fonts ?? []) if (!this.fontsPreview.includes(f)) this.fontsPreview.push(f);
      for (const [u, why] of r.failed ?? []) if (!/ERR_ABORTED/.test(why)) this.diag({ level: "warn", code: "resource-failed", message: `Ресурс не загружен (${why}): ${u.slice(0, 160)}` });
      for (const e of r.errors ?? []) this.diag({ level: "info", code: "page-error", message: `Ошибка JavaScript страницы: ${e}`, route: it.key });
      info.title = r.title;
      if (!info.label) info.label = r.fp.heading || r.title || it.key;
      else if (/^[·•–—-]\s*/.test(info.label) && r.fp.heading) {
        const kind = info.label.replace(/^[·•–—-]\s*/, "");
        info.label = kind.charAt(0).toUpperCase() + kind.slice(1) + " · " + r.fp.heading;
      } else if (r.fp.heading && info.label !== r.fp.heading) {
        if (info.label.length > 40) info.label = r.fp.heading;
        else if (info.label.length <= 3 || /^\d+$/.test(info.label)) info.label = r.fp.heading + " · " + info.label;
      }
      const finalKey = routeKey(r.finalUrl, base);
      if (finalKey !== it.key) {
        info.finalUrl = finalKey;
        const target = routes.get(finalKey);
        if (target && target !== info) {
          info.status = "duplicate";
          info.duplicateOf = finalKey;
          info.reason = `перенаправляет на ${finalKey}`;
          return;
        }
        info.reason = `адрес после перехода: ${finalKey}`;
      }
      if (it.source === "code" && probeFp && r.fp.fp === probeFp) {
        info.status = "excluded";
        info.reason = "адрес из кода не открывает отдельную страницу (как несуществующий маршрут)";
        return;
      }
      if (it.parentFp && r.fp.fp === it.parentFp && it.source !== "manual") {
        info.status = "anchor";
        info.reason = "не меняет содержимое страницы (якорь)";
        return;
      }
      const owner = fpOwner.get(r.fp.fp);
      if (owner && owner !== it.key) {
        info.status = "duplicate";
        info.duplicateOf = owner;
        info.reason = `содержимое совпадает с ${owner}`;
        return;
      }
      fpOwner.set(r.fp.fp, it.key);
      if (probeFp && r.fp.fp === probeFp) info.label = `${info.label} (страница «не найдено»)`;
      if (r.thumb) {
        import_node_fs6.default.writeFileSync(import_node_path6.default.join(this.dir, "thumbs", routeFileId(it.key) + ".jpg"), r.thumb);
        info.thumbnail = true;
      }
      const ids = new Set(r.ids);
      const fromSelector = !!r.selected && r.selected.length > 0;
      if (r.selected && !r.selected.length) this.diag({ level: "warn", code: "route-selector", message: `Указатель страниц профиля «${this.routeSelector}» не найден — используется обычный обход` });
      if (fromSelector) selectorMode = true;
      const list = [...fromSelector ? r.selected : [], ...it.depth >= maxDepth ? [] : r.links];
      for (const l of list) {
        const c = classifyHref(l.href, r.finalUrl, base, ids, { download: l.download });
        if (fromSelector && r.selected.includes(l) && c.key) indexKeys.add(c.key);
        if (c.kind === "hash-route" || c.kind === "page") push({ key: c.key, url: c.url, depth: it.depth + 1, source: "link" }, l.text);
        else if (c.kind === "hash-candidate") push({ key: c.key, url: c.url, depth: it.depth + 1, source: "link", parentFp: r.fp.fp }, l.text);
        else if (c.kind === "anchor" && !routes.has(c.key) && !seen.has(c.key)) {
          seen.add(c.key);
          routes.set(c.key, { key: c.key, url: c.key, label: l.text, title: "", group: routeGroup(it.key), depth: it.depth + 1, source: "link", status: "anchor", reason: c.reason });
        }
      }
      if (it.source === "entry" && !fromSelector) {
        const hasHashRoutes = r.links.some((l) => /^#!?\//.test(l.href));
        if (hasHashRoutes) {
          try {
            const pv = await this.visit(it.url.split("#")[0] + "#/__h2f-probe-404__");
            if (!("error" in pv)) probeFp = pv.fp.fp;
          } catch {
          }
          if (!codeAdded) {
            codeAdded = true;
            for (const lit of this.sources.flatMap((s) => extractHashLiterals(s)).slice(0, 200)) {
              const c = classifyHref(lit, r.finalUrl, base, ids);
              if (c.kind === "hash-route") push({ key: c.key, url: c.url, depth: it.depth + 1, source: "code" });
            }
          }
        }
      }
    };
    const conc = Math.max(1, Math.min(4, L.concurrency + 1));
    let first = true;
    while (queue.length || active.size) {
      this.checkCancel();
      while (queue.length && active.size < (first ? 1 : conc)) {
        const it = queue.shift();
        const p = handle(it).catch((e) => {
          if (this.cancelled) throw e;
          this.diag({ level: "warn", code: "discover", message: String(e.message).slice(0, 200), route: it.key });
        }).finally(() => {
          active.delete(p);
          processed++;
        });
        active.add(p);
      }
      if (active.size) await Promise.race(active);
      first = false;
    }
    const discovered = [...routes.values()];
    if (selectorMode) {
      for (const r of discovered) {
        r.suggested = r.source === "entry" || r.source === "manual" || indexKeys.has(r.key);
        if (!r.suggested && r.status === "ok") r.reason = r.reason ?? "найдена обходом вне указателя страниц профиля";
      }
    }
    const order = (r) => r.status === "ok" ? r.suggested === false ? 1 : 0 : r.status === "duplicate" ? 2 : r.status === "anchor" ? 3 : 4;
    const idx = new Map(discovered.map((r, i) => [r.key, i]));
    this.routes = discovered.sort((a, b) => order(a) - order(b) || idx.get(a.key) - idx.get(b.key));
    for (const r of this.routes) r.depth = r.depth ?? routeDepth(r.key);
  }
  // ---------------- захват ----------------
  async capture(req) {
    this.state = "capturing";
    this.cancelled = false;
    this.error = null;
    const keys = req.routes.filter((k) => this.routes.some((r) => r.key === k));
    if (!keys.length) {
      this.fail(new UserError("Не выбрано ни одной страницы.", "Отметьте нужные страницы в списке и повторите."));
      return;
    }
    let done = 0;
    const errors = [];
    try {
      const { browser } = await getBrowser();
      const conc = Math.max(1, this.mgr.cfg.limits.concurrency);
      const renderers = Array.from({ length: conc }, () => new Renderer(browser, [this.mgr.site.origin() + "/"], this.profile.blockExternal));
      const queue = [...keys];
      const worker = async (w) => {
        while (queue.length) {
          this.checkCancel();
          const key = queue.shift();
          this.set({ stage: "capture", done, total: keys.length, message: `Снимаю страницу ${done + 1} из ${keys.length}: ${key}` });
          try {
            await this.captureRoute(key, req.hover?.[key] ?? "auto", renderers[w], req.prune !== false);
          } catch (e) {
            this.checkCancel();
            const msg = String(e.message).split("\n")[0].slice(0, 240);
            errors.push(`${key}: ${msg}`);
            const r = this.routes.find((x) => x.key === key);
            if (r) {
              r.captured = false;
              r.reason = "ошибка захвата: " + msg;
            }
            this.diag({ level: "error", code: "capture-failed", message: `Страница не снята: ${msg}`, route: key });
          }
          done++;
          this.set({ done, total: keys.length });
        }
      };
      await Promise.all(renderers.map((_, i) => worker(i)));
      await Promise.all(renderers.map((r) => r.close()));
      this.state = "captured";
      this.set({ stage: "captured", done, total: keys.length, message: errors.length ? `Снято страниц: ${keys.length - errors.length} из ${keys.length}` : `Снято страниц: ${keys.length}` });
    } catch (e) {
      this.fail(e);
    }
  }
  async captureRoute(key, hoverChoice, renderer, prune) {
    const info = this.routes.find((r) => r.key === key);
    const { browser } = await getBrowser();
    const rec = { storageKeys: /* @__PURE__ */ new Set(), external: /* @__PURE__ */ new Set(), failed: /* @__PURE__ */ new Map() };
    const ctx = await newContext(browser, { profile: this.profile, siteOrigin: this.mgr.site.origin() + "/", injectCss: this.injectCss(), record: rec });
    this.contexts.add(ctx);
    try {
      const page = await ctx.newPage();
      const pageErrors = [];
      page.on("pageerror", (e) => pageErrors.push(e.message.slice(0, 200)));
      const url = urlFromKey(key, this.prefix);
      await page.goto(url, { waitUntil: "load", timeout: this.mgr.cfg.limits.routeTimeoutMs });
      await waitAfterNavigation(page, 1e4);
      const apiKey = await inject(page);
      const T = {};
      let t0 = Date.now();
      const lap = (k) => {
        T[k] = Date.now() - t0;
        t0 = Date.now();
      };
      await call(page, apiKey, "settle", { timeoutMs: 8e3 });
      lap("load");
      const sp = await call(page, apiKey, "scrollPass", {});
      await call(page, apiKey, "settle", { timeoutMs: 6e3 });
      this.checkCancel();
      let hover = { active: false, reason: "Наведение отключено в настройках", candidates: [] };
      if (this.profile.hover && hoverChoice !== "none") {
        const cands = await call(page, apiKey, "hoverCandidates", this.profile.exclude);
        const prefer = hoverPreferFor(this.profile.hoverPrefer, key);
        let pick = typeof hoverChoice === "number" ? hoverChoice : cands.length && cands[0].score >= 0.5 ? 0 : null;
        let selector = null;
        if (hoverChoice === "auto" && prefer) {
          if (prefer === "none") pick = null;
          else selector = prefer;
        }
        if (pick !== null && !cands[pick]) pick = null;
        if (hoverChoice === "auto" && prefer === "none") hover = { active: false, reason: "Профиль проекта: страница без позы наведения", candidates: cands };
        else if (pick === null && !selector) hover = { active: false, reason: cands.length ? "Подходящая карточка не выбрана (эффект слабый)" : "На странице нет элементов с эффектом наведения", candidates: cands };
        else {
          const pin = await call(page, apiKey, "pin", pick, selector);
          if (pin) {
            await call(page, apiKey, "settle", { timeoutMs: 3e3 });
            hover = { active: true, selector: selector ?? cands[pick]?.selector, label: pin.label, reason: selector ? "профиль проекта" : typeof hoverChoice === "number" ? "выбрано пользователем" : "выбрано автоматически", hit: pin.hit, point: pin.point, candidates: cands, chosenIndex: pick ?? void 0 };
          } else hover = { active: false, reason: "Цель наведения не найдена", candidates: cands };
        }
      }
      this.checkCancel();
      lap("settleHover");
      const run = await capturePage(page, apiKey, {
        exclude: this.profile.exclude,
        maxNodes: this.mgr.cfg.limits.maxNodesPerRoute,
        maxChars: this.mgr.cfg.limits.maxCharsPerRoute,
        rasterUnsupported: true,
        svgMode: this.profile.svgMode,
        cursor: this.profile.cursor && hover.active
      });
      if (!sp.headerRestored) run.raw.diagnostics.push({ level: "warn", code: "header-pose", message: "После пробной прокрутки шапка/закреплённые элементы не вернулись в исходный вид" });
      for (const e of pageErrors) run.raw.diagnostics.push({ level: "info", code: "page-error", message: "Ошибка JavaScript страницы: " + e });
      for (const [u, why] of rec.failed) if (!/ERR_ABORTED/.test(why)) this.diag({ level: "warn", code: "resource-failed", message: `Ресурс не загружен (${why}): ${u.slice(0, 160)}` });
      lap("capture");
      try {
        if (this.profile.exclude.length) await page.addStyleTag({ content: this.profile.exclude.join(",") + "{visibility:hidden!important}" });
        const shot = await page.screenshot({ type: "png", fullPage: true, timeout: 6e4 });
        import_node_fs6.default.writeFileSync(import_node_path6.default.join(this.dir, "shots", routeFileId(key) + ".png"), shot);
      } catch {
      }
      lap("shot");
      const fin2 = await finalizeRoute(run, { routeKey: key, label: info.label, hover, prune }, {
        store: this.store,
        renderer,
        page,
        apiKey,
        siteOrigin: this.mgr.site.origin() + "/",
        siteDir: this.siteDir,
        sitePrefix: this.prefix,
        rasterScale: this.profile.rasterScale,
        readSiteFile: (u) => this.mgr.site.readUrl(u, this.id),
        fetchExternal: (u) => this.mgr.fetchExternal(u, this.profile.blockExternal),
        cache: this.rasterCache
      });
      lap("finalize");
      for (const [k, v] of Object.entries(T)) fin2.snapshot.stats["ms_" + k] = v;
      const file = import_node_path6.default.join(this.dir, "routes", routeFileId(key) + ".json");
      import_node_fs6.default.writeFileSync(file, JSON.stringify(fin2.snapshot));
      for (const f of fin2.fonts) {
        const have = this.fonts.get(f.key);
        if (have) {
          have.chars += f.chars;
          if (!have.routes.includes(key)) have.routes.push(key);
        } else this.fonts.set(f.key, { ...f, routes: [key] });
      }
      for (const d of fin2.diagnostics) this.diag(d);
      info.captured = true;
      info.height = fin2.snapshot.height;
      info.hoverCandidates = hover.candidates.length;
      info.reason = info.reason?.startsWith("ошибка захвата") ? void 0 : info.reason;
      this.snapshots.set(key, { file, height: fin2.snapshot.height, hover, fonts: fin2.snapshot.fonts, assets: fin2.snapshot.assets });
    } finally {
      this.contexts.delete(ctx);
      await ctx.close().catch(() => void 0);
    }
  }
  // ---------------- выдача ----------------
  document(onlyCaptured = true) {
    const routes = this.routes.filter((r) => !onlyCaptured || this.snapshots.has(r.key));
    const used = new Set(routes.flatMap((r) => this.snapshots.get(r.key)?.assets ?? []));
    const fonts = new Set(routes.flatMap((r) => this.snapshots.get(r.key)?.fonts ?? []));
    return {
      schemaVersion: SCHEMA_VERSION,
      generator: { name: GENERATOR, version: GENERATOR_VERSION },
      projectKey: this.projectKey,
      sourceHash: this.sourceHash,
      sourceName: this.sourceName,
      entry: this.entry,
      createdAt: this.createdAt,
      profile: this.profile,
      routes,
      fonts: [...this.fonts.values()].filter((f) => fonts.has(f.key)),
      assets: this.store.all().filter((a) => used.has(a.id)),
      diagnostics: this.diagnostics
    };
  }
  snapshot(key) {
    const s = this.snapshots.get(key);
    if (!s) return null;
    return JSON.parse(import_node_fs6.default.readFileSync(s.file, "utf8"));
  }
  status() {
    return {
      id: this.id,
      state: this.state,
      error: this.error,
      progress: this.progress,
      sourceName: this.sourceName,
      sourceHash: this.sourceHash,
      entries: this.entries,
      entry: this.entry,
      projectKey: this.projectKey,
      adapter: this.adapter ? { id: this.adapter.id, label: this.adapter.label, notes: this.adapter.notes } : null,
      profile: this.profile,
      routeSelector: this.routeSelector,
      routes: this.routes.map((r) => ({ ...r, fileId: routeFileId(r.key), hover: this.snapshots.get(r.key)?.hover })),
      storage: this.storage,
      diagnostics: this.diagnostics.slice(0, 300),
      fontsPreview: this.fontsPreview.slice(0, 60),
      fonts: [...this.fonts.values()],
      captured: [...this.snapshots.keys()]
    };
  }
};
var JobManager = class {
  constructor(cfg, site, adapterDirs) {
    this.cfg = cfg;
    this.site = site;
    this.jobsDir = import_node_path6.default.join(cfg.dataDir, "jobs");
    import_node_fs6.default.mkdirSync(this.jobsDir, { recursive: true });
    this.adapters = loadAdapters(adapterDirs);
    this.cleanupOld();
  }
  cfg;
  site;
  jobs = /* @__PURE__ */ new Map();
  jobsDir;
  adapters;
  cleanupOld() {
    const ttl = this.cfg.limits.jobTtlHours * 36e5;
    for (const d of import_node_fs6.default.existsSync(this.jobsDir) ? import_node_fs6.default.readdirSync(this.jobsDir) : []) {
      const p = import_node_path6.default.join(this.jobsDir, d);
      try {
        if (Date.now() - import_node_fs6.default.statSync(p).mtimeMs > ttl) import_node_fs6.default.rmSync(p, { recursive: true, force: true });
      } catch {
      }
    }
  }
  create(buf, name) {
    const job = new Job(this, name);
    this.jobs.set(job.id, job);
    job.unpack(buf);
    return job;
  }
  get(id) {
    return this.jobs.get(id);
  }
  async remove(id) {
    const j = this.jobs.get(id);
    if (!j) return;
    await j.cancel();
    this.site.unmount(id);
    this.jobs.delete(id);
    import_node_fs6.default.rmSync(j.dir, { recursive: true, force: true });
  }
  async fetchExternal(url, blocked) {
    if (blocked) return null;
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol) || /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(u.hostname)) return null;
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 15e3);
      const r = await fetch(url, { signal: ctl.signal, redirect: "follow" });
      clearTimeout(t);
      if (!r.ok) return null;
      const len = Number(r.headers.get("content-length") ?? 0);
      if (len > 50 * 1024 * 1024) return null;
      const b = Buffer.from(await r.arrayBuffer());
      return b.length > 50 * 1024 * 1024 ? null : b;
    } catch {
      return null;
    }
  }
  tmpDir() {
    return import_node_os3.default.tmpdir();
  }
};

// processor/src/server.ts
var import_node_fs7 = __toESM(require("node:fs"), 1);
var import_node_http = __toESM(require("node:http"), 1);
var import_node_path7 = __toESM(require("node:path"), 1);
init_png();
function send(res, status, body, headers = {}) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "content-type": Buffer.isBuffer(body) ? headers["content-type"] ?? "application/octet-stream" : "application/json; charset=utf-8", "content-length": data.length, "cache-control": "no-store", ...headers });
  res.end(data);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new UserError(`Файл больше допустимого (${Math.round(limit / 1048576)} МБ).`, "Уменьшите архив (удалите лишние видео/исходники) или увеличьте лимит maxUploadBytes в config.json обработчика.", "TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
async function json(req, limit = 2 * 1024 * 1024) {
  const b = await readBody(req, limit);
  if (!b.length) return {};
  try {
    return JSON.parse(b.toString("utf8"));
  } catch {
    throw new UserError("Неверный JSON запроса.", "Обновите плагин до версии, совместимой с обработчиком.", "BAD_JSON");
  }
}
var attempts = [];
function createServer(d) {
  const { cfg, jobs } = d;
  const allowedHosts = /* @__PURE__ */ new Set([`127.0.0.1:${cfg.port}`, `localhost:${cfg.port}`, `[::1]:${cfg.port}`]);
  return import_node_http.default.createServer(async (req, res) => {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type, x-file-name, x-h2f-protocol",
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      "access-control-allow-private-network": "true",
      "access-control-max-age": "600",
      "access-control-expose-headers": "content-disposition"
    };
    for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
    try {
      if (!allowedHosts.has(String(req.headers.host))) {
        send(res, 403, { error: "host not allowed" });
        return;
      }
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      const p = url.pathname;
      if (p === "/" || p === "/index.html") {
        send(res, 200, import_node_fs7.default.readFileSync(import_node_path7.default.join(d.webDir, "index.html")), { "content-type": "text/html; charset=utf-8", "x-frame-options": "DENY", "content-security-policy": "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'" });
        return;
      }
      if (p === "/web.js") {
        send(res, 200, import_node_fs7.default.readFileSync(import_node_path7.default.join(d.webDir, "web.js")), { "content-type": "text/javascript; charset=utf-8" });
        return;
      }
      if (p === "/api/health") {
        const auth = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
        const browser = url.searchParams.get("browser") === "1" ? await browserStatus() : void 0;
        send(res, 200, { app: GENERATOR, version: GENERATOR_VERSION, protocol: PROTOCOL_VERSION, paired: tokenValid(cfg, auth), browser, limits: { maxUploadBytes: cfg.limits.maxUploadBytes } });
        return;
      }
      if (p === "/api/pair" && req.method === "POST") {
        const now = Date.now();
        while (attempts.length && now - attempts[0] > 5 * 6e4) attempts.shift();
        if (attempts.length >= 10) {
          send(res, 429, { error: "Слишком много попыток. Подождите 5 минут." });
          return;
        }
        attempts.push(now);
        const body = await json(req);
        const got = String(body.code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        const want = cfg.pairingCode.replace(/[^A-Z0-9]/g, "");
        if (!got || got !== want) {
          send(res, 401, { error: "Неверный код подключения.", action: "Скопируйте код из окна обработчика (строка «Код подключения»)." });
          return;
        }
        send(res, 200, { token: issueToken(cfg) });
        return;
      }
      const token = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      if (!tokenValid(cfg, token)) {
        send(res, 401, { error: "Нужен код подключения.", action: "Введите в плагине код из окна обработчика." });
        return;
      }
      const proto = req.headers["x-h2f-protocol"];
      if (proto && Number(proto) !== PROTOCOL_VERSION) {
        send(res, 409, { error: `Версия протокола плагина (${proto}) не совпадает с обработчиком (${PROTOCOL_VERSION}).`, action: "Обновите плагин и обработчик из одного установочного архива." });
        return;
      }
      if (p === "/api/jobs" && req.method === "POST") {
        const name = decodeURIComponent(String(req.headers["x-file-name"] ?? url.searchParams.get("name") ?? "project.html"));
        const buf = await readBody(req, cfg.limits.maxUploadBytes);
        if (!buf.length) throw new UserError("Пустой файл.", "Выберите HTML или ZIP ещё раз.");
        const job2 = jobs.create(buf, name);
        let opts = {};
        const o = url.searchParams.get("options");
        if (o) {
          try {
            opts = JSON.parse(o);
          } catch {
          }
        }
        void job2.analyze(opts);
        send(res, 200, { id: job2.id });
        return;
      }
      const m = /^\/api\/jobs\/([a-z0-9]+)(\/.*)?$/.exec(p);
      if (!m) {
        send(res, 404, { error: "not found" });
        return;
      }
      const job = jobs.get(m[1]);
      if (!job) {
        send(res, 404, { error: "Задание не найдено (обработчик перезапускался?).", action: "Загрузите файл заново и нажмите «Анализировать»." });
        return;
      }
      const sub = m[2] ?? "";
      if (sub === "" && req.method === "GET") {
        send(res, 200, job.status());
        return;
      }
      if (sub === "" && req.method === "DELETE") {
        await jobs.remove(job.id);
        send(res, 200, { ok: true });
        return;
      }
      if (sub === "/analyze" && req.method === "POST") {
        if (job.state === "analyzing" || job.state === "capturing") {
          send(res, 409, { error: "Задание уже выполняется.", action: "Дождитесь завершения или нажмите «Отмена»." });
          return;
        }
        const opts = await json(req);
        void job.analyze(opts);
        send(res, 200, { ok: true });
        return;
      }
      if (sub === "/capture" && req.method === "POST") {
        if (job.state === "analyzing" || job.state === "capturing") {
          send(res, 409, { error: "Задание уже выполняется.", action: "Дождитесь завершения или нажмите «Отмена»." });
          return;
        }
        const body = await json(req);
        if (body.profile) job.profile = { ...job.profile, ...body.profile, storage: job.profile.storage };
        void job.capture(body);
        send(res, 200, { ok: true });
        return;
      }
      if (sub === "/cancel" && req.method === "POST") {
        await job.cancel();
        send(res, 200, { ok: true });
        return;
      }
      if (sub === "/document") {
        send(res, 200, job.document());
        return;
      }
      if (sub === "/report") {
        send(res, 200, { ...job.status(), document: job.document(false) }, { "content-disposition": `attachment; filename="report-${job.id}.json"` });
        return;
      }
      const rm = /^\/routes\/([^/]+)$/.exec(sub);
      if (rm) {
        const r = job.routes.find((x) => routeFileId(x.key) === rm[1]);
        const s = r ? job.snapshot(r.key) : null;
        if (!s) {
          send(res, 404, { error: "Страница ещё не снята.", action: "Нажмите «Создать макеты» — страница будет снята автоматически." });
          return;
        }
        send(res, 200, s);
        return;
      }
      const am = /^\/assets\/([a-z0-9]+)$/.exec(sub);
      if (am) {
        const info = job.store.get(am[1]);
        if (!info) {
          send(res, 404, { error: "нет ресурса" });
          return;
        }
        send(res, 200, import_node_fs7.default.readFileSync(job.store.path(info.id)), { "content-type": info.mime });
        return;
      }
      const tm = /^\/thumbs\/([^/]+)$/.exec(sub);
      if (tm) {
        const f = import_node_path7.default.join(job.dir, "thumbs", tm[1].replace(/[^\w.-]/g, "") + ".jpg");
        if (!import_node_fs7.default.existsSync(f)) {
          send(res, 404, { error: "нет превью" });
          return;
        }
        send(res, 200, import_node_fs7.default.readFileSync(f), { "content-type": "image/jpeg" });
        return;
      }
      if (sub === "/package") {
        const doc = job.document();
        const files = [
          { name: "h2f-package.json", data: Buffer.from(JSON.stringify({ format: "h2f-package", version: 1, protocol: PROTOCOL_VERSION })) },
          { name: "document.json", data: Buffer.from(JSON.stringify(doc)) }
        ];
        for (const r of doc.routes) {
          const s = job.snapshot(r.key);
          if (s) files.push({ name: `routes/${routeFileId(r.key)}.json`, data: Buffer.from(JSON.stringify(s)) });
        }
        for (const a of doc.assets) files.push({ name: `assets/${a.id}`, data: import_node_fs7.default.readFileSync(job.store.path(a.id)), store: a.mime !== "image/svg+xml" });
        const name = job.sourceName.replace(/\.(zip|html?)$/i, "") + ".h2f.zip";
        send(res, 200, createZip(files), { "content-type": "application/zip", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}` });
        return;
      }
      const vm = /^\/verify\/([^/]+)(\/diff\.png)?$/.exec(sub);
      if (vm) {
        const src = import_node_path7.default.join(job.dir, "shots", vm[1].replace(/[^\w.-]/g, "") + ".png");
        const out = import_node_path7.default.join(job.dir, "verify", vm[1].replace(/[^\w.-]/g, "") + "-diff.png");
        if (vm[2]) {
          if (!import_node_fs7.default.existsSync(out)) {
            send(res, 404, { error: "нет сравнения" });
            return;
          }
          send(res, 200, import_node_fs7.default.readFileSync(out), { "content-type": "image/png" });
          return;
        }
        if (req.method !== "POST") {
          send(res, 405, { error: "POST" });
          return;
        }
        if (!import_node_fs7.default.existsSync(src)) {
          send(res, 404, { error: "Нет эталонного снимка этой страницы.", action: "Снимите страницу заново." });
          return;
        }
        const body = await readBody(req, 200 * 1024 * 1024);
        const a = decodePng(import_node_fs7.default.readFileSync(src)), b = decodePng(body);
        const cmp = compareImages(a, b, 40);
        import_node_fs7.default.writeFileSync(out, encodePng(downscale(cmp.diff, 2)));
        const result = { source: [a.width, a.height], figma: [b.width, b.height], sizeMatch: a.width === b.width && Math.abs(a.height - b.height) <= 2, meanAbs: +cmp.meanAbs.toFixed(3), changedRatio: +cmp.changedRatio.toFixed(5), scope: "Исходник в Chromium ↔ PNG, экспортированный из нативных нод Figma (exportAsync)" };
        import_node_fs7.default.writeFileSync(import_node_path7.default.join(job.dir, "verify", vm[1].replace(/[^\w.-]/g, "") + ".json"), JSON.stringify(result));
        send(res, 200, result);
        return;
      }
      send(res, 404, { error: "not found" });
    } catch (e) {
      if (e instanceof UserError) send(res, e.code === "TOO_LARGE" ? 413 : 400, { error: e.message, action: e.action, code: e.code });
      else send(res, 500, { error: "Ошибка обработчика: " + String(e?.message ?? e).slice(0, 300), action: "Повторите действие; при повторении — перезапустите обработчик." });
    }
  });
}

// processor/src/site.ts
var import_node_fs8 = __toESM(require("node:fs"), 1);
var import_node_http2 = __toESM(require("node:http"), 1);
var import_node_path8 = __toESM(require("node:path"), 1);
var MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".wasm": "application/wasm",
  ".map": "application/json"
};
var SiteServer = class {
  server = null;
  mounts = /* @__PURE__ */ new Map();
  port = 0;
  mount(jobId, m) {
    this.mounts.set(jobId, m);
  }
  unmount(jobId) {
    this.mounts.delete(jobId);
  }
  update(jobId, patch) {
    const m = this.mounts.get(jobId);
    if (m) Object.assign(m, patch);
  }
  origin() {
    return `http://127.0.0.1:${this.port}`;
  }
  prefix(jobId) {
    return `${this.origin()}/j/${jobId}/`;
  }
  /** Чтение файла сайта по URL (для ресурсов, без повторного HTTP). */
  readUrl(url, jobId) {
    const f = this.resolve(url, jobId);
    if (!f) return null;
    try {
      return import_node_fs8.default.readFileSync(f);
    } catch {
      return null;
    }
  }
  /**
   * Файл по URL. Путь вне «/j/<задание>/» — путь от корня сайта («/css/a.css»): он относится
   * к заданию fallbackJob (страница, с которой пришёл запрос, или задание финализации).
   */
  resolve(url, fallbackJob) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    if (u.origin !== this.origin()) return null;
    let m = /^\/j\/([a-z0-9]+)\/(.*)$/.exec(u.pathname);
    if ((!m || !this.mounts.has(m[1])) && fallbackJob && this.mounts.has(fallbackJob)) m = [u.pathname, fallbackJob, u.pathname.replace(/^\/+/, "")];
    if (!m) return null;
    const mount = this.mounts.get(m[1]);
    if (!mount) return null;
    let rel;
    try {
      rel = decodeURIComponent(m[2]);
    } catch {
      return null;
    }
    const root = import_node_path8.default.resolve(mount.dir);
    let f = import_node_path8.default.resolve(root, rel);
    if (f !== root && !f.startsWith(root + import_node_path8.default.sep)) return null;
    if (import_node_fs8.default.existsSync(f) && import_node_fs8.default.statSync(f).isDirectory()) f = import_node_path8.default.join(f, "index.html");
    if (!import_node_fs8.default.existsSync(f)) {
      if (mount.spaFallback && !import_node_path8.default.extname(rel)) return import_node_path8.default.join(root, mount.entry);
      return null;
    }
    return f;
  }
  start() {
    return new Promise((resolve, reject) => {
      this.server = import_node_http2.default.createServer((req, res) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          res.writeHead(405);
          res.end();
          return;
        }
        const ref = /\/j\/([a-z0-9]+)\//.exec(String(req.headers.referer ?? ""));
        if (!/^\/j\/[a-z0-9]+\//.test(req.url ?? "/") && ref && this.mounts.has(ref[1])) {
          res.writeHead(307, { location: `/j/${ref[1]}/${(req.url ?? "/").replace(/^\/+/, "")}`, "cache-control": "no-store" });
          res.end();
          return;
        }
        const f = this.resolve(this.origin() + (req.url ?? "/"));
        if (!f) {
          res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          res.end("Not found");
          return;
        }
        const type = MIME[import_node_path8.default.extname(f).toLowerCase()] ?? "application/octet-stream";
        const st = import_node_fs8.default.statSync(f);
        res.writeHead(200, { "content-type": type, "content-length": st.size, "cache-control": "no-store", "access-control-allow-origin": "*", "x-content-type-options": "nosniff" });
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        import_node_fs8.default.createReadStream(f).pipe(res);
      });
      this.server.on("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.port = this.server.address().port;
        resolve();
      });
    });
  }
  stop() {
    this.server?.close();
  }
};

// processor/src/main.ts
async function startProcessor(opts = {}) {
  const cfg = loadConfig({ port: opts.port, dataDir: opts.dataDir });
  const site = new SiteServer();
  await site.start();
  const here = typeof __dirname !== "undefined" ? __dirname : process.cwd();
  const profileDirs = opts.profilesDirs ?? [import_node_path9.default.join(here, "..", "profiles"), import_node_path9.default.join(here, "profiles"), import_node_path9.default.join(cfg.dataDir, "profiles")];
  const jobs = new JobManager(cfg, site, profileDirs);
  const webDir = opts.webDir ?? [here, import_node_path9.default.join(here, "web"), import_node_path9.default.join(here, "..", "dist")].find((d) => import_node_fs9.default.existsSync(import_node_path9.default.join(d, "index.html")) && import_node_fs9.default.existsSync(import_node_path9.default.join(d, "web.js"))) ?? here;
  const server = createServer({ cfg, jobs, webDir });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", (e) => {
        if (e.code === "EADDRINUSE") reject(Object.assign(new Error(`Порт ${cfg.port} уже занят — возможно, обработчик уже запущен в другом окне.`), { code: "EADDRINUSE" }));
        else reject(e);
      });
      server.listen(cfg.port, "127.0.0.1", () => resolve());
    });
  } catch (e) {
    site.stop();
    server.close();
    throw e;
  }
  const server6 = import_node_http3.default.createServer();
  for (const l of server.listeners("request")) server6.on("request", l);
  const v6 = await new Promise((resolve) => {
    server6.once("error", () => resolve(false));
    server6.listen(cfg.port, "::1", () => resolve(true));
  });
  const stop = async () => {
    server.close();
    if (v6) server6.close();
    site.stop();
    for (const j of jobs.jobs.values()) await j.cancel();
    await closeBrowser();
  };
  return { cfg, site, jobs, server, ipv6: v6, stop };
}
async function main() {
  const line = "─".repeat(64);
  console.log(line);
  console.log(` HTML → Figma · локальный обработчик ${GENERATOR_VERSION} (протокол ${PROTOCOL_VERSION})`);
  console.log(line);
  let started;
  try {
    started = await startProcessor();
  } catch (e) {
    console.error("\n ОШИБКА: " + e.message);
    console.error(" Закройте другое окно обработчика или измените порт: переменная H2F_PORT.\n");
    process.exit(1);
  }
  const { cfg, stop } = started;
  console.log(` Адрес:            http://localhost:${cfg.port}   (то же: http://127.0.0.1:${cfg.port})`);
  console.log(` Код подключения:  ${cfg.pairingCode}   (вводится в плагине один раз)`);
  console.log(` Папка данных:     ${cfg.dataDir}`);
  console.log(" Проверяю браузер…");
  const b = await browserStatus();
  if (b.ok) console.log(` Браузер:          ${b.name} ${b.version}`);
  else {
    console.log(" Браузер:          НЕ НАЙДЕН");
    console.log("   Установите Microsoft Edge или Google Chrome, либо запустите install-browser.cmd.");
    console.log("   " + (b.error ?? "").slice(0, 300));
  }
  console.log(line);
  console.log(" Обработчик работает. Не закрывайте это окно, пока импортируете макеты.");
  console.log(" Остановить: Ctrl+C или закрыть окно.");
  console.log(line);
  const bye = async () => {
    console.log("\n Останавливаю…");
    await stop();
    process.exit(0);
  };
  process.on("SIGINT", bye);
  process.on("SIGTERM", bye);
}

// processor/src/cli.ts
var major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  console.error(`Нужен Node.js 20 или новее (сейчас ${process.versions.node}). Запустите start-windows.cmd — он предложит скачать подходящую версию.`);
  process.exit(1);
}
void main();
