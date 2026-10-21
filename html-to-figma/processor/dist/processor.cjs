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
  const src = '(()=>{function Je(e){let t=[],n=(i,s)=>{if(i.nodeType===Node.TEXT_NODE){s.s+=i.textContent??"";return}if(i.nodeType!==Node.ELEMENT_NODE)return;let l=i;if(getComputedStyle(l).display!=="none")for(let c of Array.from(l.childNodes))n(c,s)};for(let i of Array.from(e.childNodes)){let s={s:""};n(i,s);let l=s.s.replace(/\\s+/g," ").trim();l&&t.push(l)}return(t.filter(i=>!/^[\\d.\\s/№#-]+$/.test(i))[0]??t.join(" ")).trim()||(e.getAttribute("aria-label")??e.getAttribute("title")??"").trim()}function vt(e){let t=[];for(let r of Array.from(document.querySelectorAll("a[href], area[href]"))){let o=r.getAttribute("href")??"",i=Je(r).slice(0,80);t.push({href:o,text:i,download:r.hasAttribute("download"),source:"a"})}for(let r of Array.from(document.querySelectorAll("[data-href], [data-route], [data-link], [routerlink]"))){let o=r.getAttribute("data-href")??r.getAttribute("data-route")??r.getAttribute("data-link")??r.getAttribute("routerlink")??"";/^(#|\\/|\\.\\/|[\\w-]+\\.html?)/.test(o)&&t.push({href:o,text:(r.innerText||"").replace(/\\s+/g," ").trim().slice(0,80),download:!1,source:"data"})}let n=[];for(let r of Array.from(document.querySelectorAll("[id], a[name]"))){let o=r.getAttribute("id")??r.getAttribute("name");o&&n.push(o)}return{links:t,ids:n}}function On(e){let t=2166136261,n=16777619;for(let r=0;r<e.length;r++){let o=e.charCodeAt(r);t=Math.imul(t^o,16777619),n=Math.imul(n^o,2246822519)}return(t>>>0).toString(16).padStart(8,"0")+(n>>>0).toString(16).padStart(8,"0")}function Tt(e){let t=[],n=0,r=a=>{if(e(a))return;let u=a.tagName;if(!(u==="SCRIPT"||u==="STYLE"||u==="NOSCRIPT"||u==="TEMPLATE"||getComputedStyle(a).display==="none")){t.push(u+"."+(a.getAttribute("class")??"").split(/\\s+/).filter(h=>!/active|current|is-|open|selected|hover|focus/.test(h)).slice(0,3).join("."));for(let h of Array.from(a.childNodes))if(h.nodeType===Node.TEXT_NODE){let m=(h.textContent??"").replace(/\\s+/g," ").trim();m&&(t.push(m),n+=m.length)}else h.nodeType===Node.ELEMENT_NODE&&r(h)}};document.body&&r(document.body);let o=a=>!!a.closest(\'header, nav, footer, [role="navigation"], [role="banner"], [role="contentinfo"]\')||e(a),i=a=>{let u=a.getBoundingClientRect(),f=getComputedStyle(a);return u.width>0&&u.height>0&&f.visibility!=="hidden"&&parseFloat(f.opacity)>0},s=a=>Array.from(document.querySelectorAll(a)).find(u=>i(u)&&!o(u)),c=((s("h1")??s("h2")??document.querySelector("h1"))?.textContent??"").replace(/\\s+/g," ").trim().slice(0,100);return{fp:On(t.join("")),textLength:n,heading:c}}var be="data-h2f-hover";function Be(e,t=`[${be}]`){let n="",r="",o=0;for(let i=0;i<e.length;i++){let s=e[i];if(s==="\\\\"){n+=s+(e[i+1]??""),i++;continue}if(r){n+=s,s===r&&(r="");continue}if(s===\'"\'||s==="\'"){r=s,n+=s;continue}if(s==="["){o++,n+=s;continue}if(s==="]"){o=Math.max(0,o-1),n+=s;continue}if(!o&&s===":"&&e[i-1]!==":"&&e.slice(i+1,i+6).toLowerCase()==="hover"&&!/[\\w-]/.test(e[i+6]??"")){n+=t,i+=5;continue}n+=s}return n}var Fe=[],Ne=!1;function*tt(e){for(let t of Array.from(e)){yield t;let n=t.cssRules;n&&n.length&&(yield*tt(n))}}function Ct(){let e=[],t=n=>{for(let r of Array.from(n.styleSheets))e.push(r);for(let r of n.adoptedStyleSheets??[])e.push(r)};t(document);for(let n of Array.from(document.querySelectorAll("*")))n.shadowRoot&&t(n.shadowRoot);return e}function Ge(){let e={rules:0,rewritten:0,failed:0,crossOrigin:0,mediaConditions:[]};if(Ne)return e.rewritten=Fe.length,e;for(let t of Ct()){let n;try{n=t.cssRules}catch{e.crossOrigin++;continue}for(let r of tt(n)){if(r.conditionText!==void 0&&r.conditionText.includes("hover")&&e.mediaConditions.push(r.conditionText),!(r instanceof CSSStyleRule))continue;e.rules++;let o=r.selectorText;if(!/:hover/i.test(o))continue;let i=Be(o);if(i!==o){if(r.selectorText=i,r.selectorText===o){e.failed++;continue}Fe.push({rule:r,original:o}),e.rewritten++}}}return Ne=!0,e}function At(){for(let{rule:e,original:t}of Fe)try{e.selectorText=t}catch{}Fe=[],Ne=!1,Le()}function Le(){for(let e of Array.from(document.querySelectorAll(`[${be}]`)))e.removeAttribute(be)}function Hn(){let e=new Set,t=Ne?Fe.map(n=>n.original):[];if(!Ne)for(let n of Ct()){let r;try{r=n.cssRules}catch{continue}for(let o of tt(r))o instanceof CSSStyleRule&&/:hover/i.test(o.selectorText)&&t.push(o.selectorText)}for(let n of t)for(let r of Bn(n)){let o=Gn(r);if(o<0)continue;let i=o+6;for(;i<r.length&&!/[\\s>+~]/.test(r[i]);)i++;let s=(r.slice(0,o)+r.slice(o+6,i)).trim();s=s.replace(/::?(before|after|first-letter|first-line|marker|placeholder)\\b/g,"").replace(/:(focus|focus-visible|focus-within|active|visited|link)\\b/g,""),!(!s||/^[>+~]/.test(s)||s.endsWith(">")||s.endsWith("+")||s.endsWith("~"))&&(/:hover/.test(s)&&(s=Be(s,"")),e.add(s.replace(/\\s+/g," ").trim()))}return[...e]}function Bn(e){let t=[],n=0,r="",o="";for(let i of e){if(o){r+=i,i===o&&(o="");continue}if(i===\'"\'||i==="\'"){o=i,r+=i;continue}if((i==="("||i==="[")&&n++,(i===")"||i==="]")&&n--,i===","&&n===0){t.push(r.trim()),r="";continue}r+=i}return r.trim()&&t.push(r.trim()),t}function Gn(e){let t=0;for(let n=0;n<e.length;n++){let r=e[n];if(r==="("||r==="[")t++;else if(r===")"||r==="]")t--;else if(!t&&r===":"&&e[n-1]!==":"&&e.slice(n+1,n+6).toLowerCase()==="hover"&&!/[\\w-]/.test(e[n+6]??""))return n}return-1}var Dn=["transform","translate","rotate","scale","opacity","width","height","background-color","background-image","box-shadow","filter","color","visibility","border-top-color","outline-color","text-decoration-line","text-decoration-color","max-height","clip-path","display","left","top"];function et(e){let t=[],n=[e,...Array.from(e.querySelectorAll("*"))];for(let r of n)for(let o of["","::before","::after"]){let i=getComputedStyle(r,o||null);if(o&&i.content==="none"){t.push("");continue}t.push(Dn.map(s=>i.getPropertyValue(s)).join("|"))}return t}function Wn(e){return(e.querySelector(\'h1,h2,h3,h4,h5,h6,[class*="title"]\')?.textContent||e.innerText||e.textContent||"").replace(/\\s+/g," ").trim().slice(0,80)||e.tagName.toLowerCase()}function zn(e){for(let t=e;t;t=t.parentElement){let n=t.tagName;if(n==="HEADER"&&!t.closest("main, article, section")||n==="NAV"||n==="FOOTER")return!0;let r=t.getAttribute("role");if(r==="navigation"||r==="banner"||r==="contentinfo")return!0;let o=getComputedStyle(t).position;if(o==="fixed"||o==="sticky")return!0}return!1}function It(e,t=12){Ge();let n=innerWidth,r=new Map,o=new Map,i=l=>{if(!l)return-1;let c=o.get(l);return c===void 0&&(c=o.size,o.set(l,c)),c};for(let l of Hn()){let c;try{c=Array.from(document.querySelectorAll(l))}catch{continue}for(let a of c){if(e(a))continue;let u=a.getBoundingClientRect();if(u.width<80||u.height<40||u.width>n*.95)continue;let f=getComputedStyle(a);if(f.visibility==="hidden"||parseFloat(f.opacity)===0||a.disabled)continue;let h=l+"§"+i(a.parentElement),m=r.get(h)??{sel:l,els:[]};m.els.includes(a)||m.els.push(a),r.set(h,m)}}let s=[];for(let l of r.values()){let c=l.els[0],a=et(c),u=c.getBoundingClientRect();Ft(c);let f=et(c),h=c.getBoundingClientRect();Le();let m=0;for(let d=0;d<a.length;d++)a[d]!==f[d]&&m++;if((Math.abs(u.width-h.width)>.5||Math.abs(u.height-h.height)>.5)&&(m+=2),!m)continue;let g=c.getBoundingClientRect(),R=g.width*g.height/(innerWidth*innerHeight),p=zn(c),b=l.els.length>=2,w=!!c.querySelector(\'svg, img, picture, canvas, [style*="background"]\'),M=g.top+scrollY,S=Math.log2(1+m)*(b?2:1)*(w?1.4:1)*(p?.15:1)*Math.min(1.5,.4+R*6)/(1+M/4e3);(g.width<140||g.height<70)&&(S*=.5),s.push({index:0,el:c,selector:l.sel,label:Wn(c),score:S,box:[g.left+scrollX,M,g.width,g.height],changes:m})}return s.sort((l,c)=>c.score-l.score),s.slice(0,t).map((l,c)=>({...l,index:c}))}function Ft(e){for(let t=e;t&&(t.setAttribute(be,""),t!==document.documentElement);t=t.parentElement??t.getRootNode().host??null);}function Vn(e){return/^(A|BUTTON|INPUT|SELECT|TEXTAREA|LABEL|SUMMARY)$/.test(e.tagName)||e.hasAttribute("onclick")||e.getAttribute("role")==="button"}async function Nt(e,t){Ge(),Le(),e.scrollIntoView({block:"center",inline:"nearest",behavior:"instant"}),await new Promise(h=>requestAnimationFrame(()=>requestAnimationFrame(h)));let n=e.getBoundingClientRect(),r=[[.5,.42],[.8,.42],[.5,.3],[.3,.5],[.65,.65],[.2,.2]],o=null;for(let[h,m]of r){let g=n.left+Math.max(4,Math.min(n.width-4,n.width*h)),R=n.top+Math.max(4,Math.min(n.height-4,n.height*m)),p=document.elementFromPoint(g,R);if(!p||!(e===p||e.contains(p)))continue;let b=null;for(let w=p;w&&w!==e;w=w.parentElement)if(Vn(w)){b=w;break}if(b){let w=b.getBoundingClientRect(),M=w.width*w.height>=.6*n.width*n.height;if(!M&&!o){o={el:p,x:g,y:R};continue}if(!M)continue}o={el:p,x:g,y:R};break}let i=scrollY,s=scrollX,l=o?.el??e,c=o?o.x+s:n.left+n.width/2+s,a=o?o.y+i:n.top+n.height/2+i;window.scrollTo({top:0,left:0,behavior:"instant"}),await new Promise(h=>requestAnimationFrame(()=>requestAnimationFrame(h))),Ft(l);let u=!1;try{let h={bubbles:!0,cancelable:!0,clientX:c-scrollX,clientY:a-scrollY,view:window},m=[];for(let g=l;g;g=g.parentElement)m.push(g);l.dispatchEvent(new PointerEvent("pointerover",h));for(let g of m.reverse())g.dispatchEvent(new PointerEvent("pointerenter",{...h,bubbles:!1}));l.dispatchEvent(new MouseEvent("mouseover",h));for(let g of m)g.dispatchEvent(new MouseEvent("mouseenter",{...h,bubbles:!1}));l.dispatchEvent(new MouseEvent("mousemove",h)),u=!0}catch{}let f=0;for(let h=l;h;h=h.parentElement)f++;return{hit:t(l),point:[c,a],chain:f,synthetic:u}}function Lt(e){return et(e)}var Pe=e=>new Promise(t=>setTimeout(t,e)),ye=(e=2)=>new Promise(t=>{let n=0,r=()=>++n>=e?t():requestAnimationFrame(r);requestAnimationFrame(r)});function xe(){let e=0,t=0,n=[];try{n=document.getAnimations()}catch{return{finished:e,paused:t}}for(let r of n)try{let i=r.effect?.getComputedTiming()?.endTime;i!==void 0&&Number.isFinite(i)?(r.finish(),e++):(r.pause(),r.currentTime=0,t++)}catch{}for(let r of Array.from(document.querySelectorAll("video, audio")))try{r.pause()}catch{}return{finished:e,paused:t}}async function $t(e,t){return Promise.race([e,Pe(t).then(()=>"timeout")])}async function _n(e,t){let n=performance.now(),r=new MutationObserver(()=>{n=performance.now()});r.observe(document,{subtree:!0,childList:!0,attributes:!0,characterData:!0});let o=performance.now();try{for(;performance.now()-o<t;){if(performance.now()-n>=e)return!0;await Pe(Math.min(50,e))}return!1}finally{r.disconnect()}}async function Un(e){let t=Array.from(document.images),n=t.filter(r=>!r.complete);return await $t(Promise.all(n.map(r=>r.decode().catch(()=>{}))),e),{pending:t.filter(r=>!r.complete).length,broken:t.filter(r=>r.complete&&r.naturalWidth===0&&(r.currentSrc||r.src)).map(r=>r.currentSrc||r.src).slice(0,50)}}function Pt(){let e=Array.from(document.body?.querySelectorAll("*")??[]).slice(0,4e3),t=0;for(let n of e){let r=n.getBoundingClientRect();t=t*31+Math.round(r.x*4)*7+Math.round(r.y*4)*13+Math.round(r.width*4)*17+Math.round(r.height*4)|0}return`${e.length}:${t}:${document.documentElement.scrollHeight}`}async function Ot(e={}){let t=performance.now(),n=e.timeoutMs??8e3,r=await $t(document.fonts.ready.then(()=>"ready"),Math.min(n,6e3)),o=await _n(e.quietMs??250,Math.min(n,5e3)),i=await Un(Math.min(n,5e3)),s=xe();await ye(2);let l=!1,c=Pt();for(let a=0;a<10&&performance.now()-t<n;a++){await Pe(80),s=xe(),await ye(1);let u=Pt();if(u===c){l=!0;break}c=u}return{fonts:String(r),mutationsQuiet:o,pendingImages:i.pending,brokenImages:i.broken,stable:l,animations:s,ms:Math.round(performance.now()-t)}}async function Ht(e={}){let t=new Map,n=innerHeight,r=Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight??0),o=De(),i=[];for(let u of Array.from(document.body?.querySelectorAll("*")??[])){let f=getComputedStyle(u);(parseFloat(f.opacity)<1||f.visibility==="hidden"||f.transform!=="none"||f.translate!=="none"||f.filter!=="none")&&i.push(u)}let s=Math.max(200,n*(e.stepRatio??.7)),l=e.maxSteps??80,c=0;for(let u=0;u<r&&c<l;u+=s,c++){window.scrollTo({top:u,left:0,behavior:"instant"}),await ye(2),await Pe(e.waitMs??70),xe(),await ye(1);for(let f of i){let h=f.getBoundingClientRect();if(h.bottom<0||h.top>n)continue;let m=getComputedStyle(f),g=t.get(f);(!g||parseFloat(m.opacity)>parseFloat(g.opacity)||g.visibility==="hidden"&&m.visibility!=="hidden")&&t.set(f,{opacity:m.opacity,visibility:m.visibility,transform:m.transform,translate:m.translate,rotate:m.rotate,scale:m.scale,filter:m.filter})}}window.scrollTo({top:0,left:0,behavior:"instant"}),await ye(2),await Pe(150),xe(),await ye(2);let a=De()===o;return{steps:c,poses:t,headerRestored:a}}function De(){let e=[];for(let t of Array.from(document.body?.querySelectorAll("*")??[])){let n=getComputedStyle(t);if(n.position!=="fixed"&&n.position!=="sticky")continue;let r=t.getBoundingClientRect();e.push(`${t.tagName}.${t.getAttribute("class")??""}:${Math.round(r.top)}:${Math.round(r.height)}:${n.backgroundColor}:${n.boxShadow}:${n.transform}`)}return e.join("|")}var Yn=["display","position","visibility","opacity","z-index","float","overflow-x","overflow-y","transform","translate","rotate","scale","transform-origin","transform-style","perspective","zoom","filter","backdrop-filter","mix-blend-mode","isolation","will-change","contain","container-type","clip-path","mask-image","-webkit-mask-image","offset-path","background-color","background-image","background-size","background-position-x","background-position-y","background-repeat","background-origin","background-clip","background-attachment","background-blend-mode","border-top-width","border-right-width","border-bottom-width","border-left-width","border-top-style","border-right-style","border-bottom-style","border-left-style","border-top-color","border-right-color","border-bottom-color","border-left-color","border-top-left-radius","border-top-right-radius","border-bottom-right-radius","border-bottom-left-radius","border-image-source","padding-top","padding-right","padding-bottom","padding-left","margin-left","margin-right","box-shadow","outline-style","outline-width","outline-color","outline-offset","color","font-family","font-size","font-weight","font-style","font-variant-caps","font-stretch","line-height","letter-spacing","word-spacing","text-transform","text-align","text-align-last","direction","writing-mode","text-decoration-line","text-decoration-color","text-decoration-style","text-decoration-thickness","text-shadow","text-overflow","white-space","-webkit-line-clamp","-webkit-text-fill-color","-webkit-text-stroke-width","-webkit-text-stroke-color","text-indent","list-style-type","list-style-position","content","object-fit","object-position","appearance","pointer-events","cursor","width","height","box-sizing","counter-reset","counter-increment","hyphens","vertical-align","image-rendering"];function we(e){let t={};for(let n of Yn)t[n]=e.getPropertyValue(n);return t}var T=e=>{if(!e)return 0;let t=parseFloat(e);return Number.isFinite(t)?t:0};function D(e){let t=e.tagName.toLowerCase();e.id&&(t+="#"+e.id);let r=(typeof e.className=="string"?e.className:e.getAttribute("class")??"").trim().split(/\\s+/).filter(Boolean).slice(0,2);return r.length&&(t+="."+r.join(".")),t.slice(0,80)}var Bt=e=>e==="inline"||e==="ruby"||e==="ruby-text";function me(e){return e.transform!=="none"&&e.transform!==""||e.translate!=="none"&&e.translate!==""||e.rotate!=="none"&&e.rotate!==""||e.scale!=="none"&&e.scale!==""}function Se(e){return e["overflow-x"]!=="visible"||e["overflow-y"]!=="visible"}function nt(e,t){return!!(!t&&e.position!=="static"||me(e)||e.perspective!=="none"||e.filter!=="none"||e["backdrop-filter"]&&e["backdrop-filter"]!=="none"||/transform|perspective|filter/.test(e["will-change"])||/layout|paint|strict|content/.test(e.contain)||e["container-type"]&&e["container-type"]!=="normal")}function rt(e,t){return!!(e.position==="fixed"||e.position==="sticky"||(e.position==="absolute"||e.position==="relative")&&e["z-index"]!=="auto"||/flex|grid/.test(t)&&e["z-index"]!=="auto"||parseFloat(e.opacity)<1||e["mix-blend-mode"]!=="normal"||me(e)||e.filter!=="none"||e["backdrop-filter"]&&e["backdrop-filter"]!=="none"||e.perspective!=="none"||e["clip-path"]!=="none"||e["mask-image"]&&e["mask-image"]!=="none"||e["-webkit-mask-image"]&&e["-webkit-mask-image"]!=="none"||e.isolation==="isolate"||/transform|opacity|filter|perspective|clip-path|mask|isolation/.test(e["will-change"])||/layout|paint|strict|content/.test(e.contain))}var Gt=new Set(["SCRIPT","STYLE","LINK","META","TEMPLATE","NOSCRIPT","HEAD","TITLE","BASE","OPTION","OPTGROUP","DATALIST","PARAM","SOURCE","TRACK","AREA","MAP"]);var oe=(e,t)=>[e[0][0]*t[0]+e[0][1]*t[1]+e[0][2]*t[2],e[1][0]*t[0]+e[1][1]*t[1]+e[1][2]*t[2],e[2][0]*t[0]+e[2][1]*t[1]+e[2][2]*t[2]],qn=[[3.2409699419045226,-1.537383177570094,-.4986107602930034],[-.9692436362808796,1.8759675015077202,.04155505740717559],[.05563007969699366,-.20397695888897652,1.0569715142428786]],jn=[[.4865709486482162,.26566769316909306,.1982172852343625],[.2289745640697488,.6917385218365064,.079286914093745],[0,.04511338185890264,1.043944368900976]],Xn=[[.5766690429101305,.1855582379065463,.1882286462349947],[.29734497525053605,.6273635662554661,.07529145849399788],[.02703136138641234,.07068885253582723,.9913375368376388]],Kn=[[.7977604896723027,.13518583717574031,.0313493495815248],[.2880711282292934,.7118432178101014,8565396060525902e-20],[0,0,.8251046025104601]],Qn=[[.6369580483012914,.14461690358620832,.1688809751641721],[.2627002120112671,.6779980715188708,.05930171646986196],[0,.028072693049087428,1.060985057710791]],We=[[.9554734527042182,-.023098536874261423,.0632593086610217],[-.028369706963208136,1.0099954580058226,.021041398966943008],[.012314001688319899,-.020507696433477912,1.3303659366080753]],Zn=e=>{let t=Math.sign(e),n=Math.abs(e);return n<=.04045?e/12.92:t*Math.pow((n+.055)/1.055,2.4)},ot=e=>{let t=Math.sign(e),n=Math.abs(e);return n>.0031308?t*(1.055*Math.pow(n,1/2.4)-.055):12.92*e};function Ve(e){return[ot(e[0]),ot(e[1]),ot(e[2])]}function ue(e){return Ve(oe(qn,e))}function Dt(e,t,n){let r=903.2962962962963,o=216/24389,i=(e+16)/116,s=t/500+i,l=i-n/200,c=Math.pow(s,3)>o?Math.pow(s,3):(116*s-16)/r,a=e>r*o?Math.pow((e+16)/116,3):e/r,u=Math.pow(l,3)>o?Math.pow(l,3):(116*l-16)/r;return[c*.3457/.3585,a,u*(1-.3457-.3585)/.3585]}function Wt(e,t,n){let r=e+.3963377774*t+.2158037573*n,o=e-.1055613458*t-.0638541728*n,i=e-.0894841775*t-1.291485548*n,s=r*r*r,l=o*o*o,c=i*i*i;return[4.0767416621*s-3.3077115913*l+.2309699292*c,-1.2684380046*s+2.6097574011*l-.3413193965*c,-.0041960863*s-.7034186147*l+1.707614701*c]}var _e=e=>Number.isFinite(e)?Math.min(1,Math.max(0,e)):0;function ke(e,t){let n=[],r=0,o="",i="";for(let s=0;s<e.length;s++){let l=e[s];if(o){if(i+=l,l==="\\\\"&&s+1<e.length){i+=e[++s];continue}l===o&&(o="");continue}if(l===\'"\'||l==="\'"){o=l,i+=l;continue}if(l==="("?r++:l===")"&&(r=Math.max(0,r-1)),(t===" "?/\\s/.test(l):l===t)&&r===0){(t!==" "||i.trim())&&n.push(i.trim()),i="";continue}i+=l}return(i.trim()||t!==" "&&n.length)&&n.push(i.trim()),n.filter(s=>s!==""||t!==" ")}var zt={black:"000000",white:"ffffff",red:"ff0000",green:"008000",blue:"0000ff",yellow:"ffff00",cyan:"00ffff",aqua:"00ffff",magenta:"ff00ff",fuchsia:"ff00ff",gray:"808080",grey:"808080",silver:"c0c0c0",maroon:"800000",olive:"808000",lime:"00ff00",teal:"008080",navy:"000080",purple:"800080",orange:"ffa500",pink:"ffc0cb",brown:"a52a2a",gold:"ffd700",beige:"f5f5dc",ivory:"fffff0",khaki:"f0e68c",lavender:"e6e6fa",linen:"faf0e6",salmon:"fa8072",tan:"d2b48c",wheat:"f5deb3",coral:"ff7f50",crimson:"dc143c",indigo:"4b0082",violet:"ee82ee",orchid:"da70d6",plum:"dda0dd",sienna:"a0522d",tomato:"ff6347",turquoise:"40e0d0",skyblue:"87ceeb",snow:"fffafa",whitesmoke:"f5f5f5",gainsboro:"dcdcdc",lightgray:"d3d3d3",lightgrey:"d3d3d3",darkgray:"a9a9a9",darkgrey:"a9a9a9",dimgray:"696969",dimgrey:"696969",slategray:"708090",slategrey:"708090",steelblue:"4682b4",royalblue:"4169e1",midnightblue:"191970",darkblue:"00008b",darkred:"8b0000",darkgreen:"006400",forestgreen:"228b22",seagreen:"2e8b57",olivedrab:"6b8e23",chocolate:"d2691e",peru:"cd853f",firebrick:"b22222",indianred:"cd5c5c",rosybrown:"bc8f8f",moccasin:"ffe4b5",papayawhip:"ffefd5",bisque:"ffe4c4",antiquewhite:"faebd7",oldlace:"fdf5e6",seashell:"fff5ee",mintcream:"f5fffa",honeydew:"f0fff0",aliceblue:"f0f8ff",ghostwhite:"f8f8ff",floralwhite:"fffaf0",cornsilk:"fff8dc",lemonchiffon:"fffacd",lightyellow:"ffffe0",lightpink:"ffb6c1",hotpink:"ff69b4",deeppink:"ff1493",darkorange:"ff8c00",orangered:"ff4500",goldenrod:"daa520",darkgoldenrod:"b8860b",burlywood:"deb887",sandybrown:"f4a460",navajowhite:"ffdead",blanchedalmond:"ffebcd",mistyrose:"ffe4e1",lavenderblush:"fff0f5",thistle:"d8bfd8",mediumpurple:"9370db",rebeccapurple:"663399",slateblue:"6a5acd",darkslateblue:"483d8b",mediumslateblue:"7b68ee",cornflowerblue:"6495ed",dodgerblue:"1e90ff",deepskyblue:"00bfff",lightskyblue:"87cefa",lightblue:"add8e6",powderblue:"b0e0e6",cadetblue:"5f9ea0",darkcyan:"008b8b",lightseagreen:"20b2aa",mediumaquamarine:"66cdaa",aquamarine:"7fffd4",palegreen:"98fb98",lightgreen:"90ee90",springgreen:"00ff7f",mediumspringgreen:"00fa9a",lawngreen:"7cfc00",chartreuse:"7fff00",greenyellow:"adff2f",yellowgreen:"9acd32",limegreen:"32cd32",darkseagreen:"8fbc8f",darkolivegreen:"556b2f",darkkhaki:"bdb76b",palegoldenrod:"eee8aa",lightgoldenrodyellow:"fafad2",peachpuff:"ffdab9",lightsalmon:"ffa07a",darksalmon:"e9967a",lightcoral:"f08080",palevioletred:"db7093",mediumvioletred:"c71585",darkmagenta:"8b008b",darkviolet:"9400d3",darkorchid:"9932cc",mediumorchid:"ba55d3",blueviolet:"8a2be2",mediumblue:"0000cd",darkslategray:"2f4f4f",darkslategrey:"2f4f4f",lightslategray:"778899",lightslategrey:"778899",lightsteelblue:"b0c4de",lightcyan:"e0ffff",paleturquoise:"afeeee",mediumturquoise:"48d1cc",darkturquoise:"00ced1",azure:"f0ffff",saddlebrown:"8b4513"};function V(e,t=1){return e==="none"?0:e.endsWith("%")?parseFloat(e)/100*t:parseFloat(e)}function ze(e){if(e==="none")return 0;let t=parseFloat(e);return e.endsWith("rad")?t*180/Math.PI:e.endsWith("grad")?t*.9:e.endsWith("turn")?t*360:t}function Jn(e){return e===void 0?1:_e(V(e,1))}function Vt(e,t,n){e=(e%360+360)%360;let r=o=>{let i=(o+e/30)%12,s=t*Math.min(n,1-n);return n-s*Math.max(-1,Math.min(i-3,9-i,1))};return[r(0),r(8),r(4)]}function er(e){let t=e.split("/"),n=t[0],r=t[1]?.trim(),o;return n.includes(",")?(o=n.split(",").map(i=>i.trim()).filter(Boolean),o.length===4&&r===void 0&&(r=o.pop())):o=n.trim().split(/\\s+/).filter(Boolean),{parts:o,alpha:r}}function _(e){if(!e)return null;let t=e.trim().toLowerCase();if(t==="transparent")return{r:0,g:0,b:0,a:0};if(t==="currentcolor"||t==="inherit"||t==="initial"||t==="none")return null;if(t.startsWith("#")){let c=t.slice(1);if(!/^[0-9a-f]+$/.test(c)||((c.length===3||c.length===4)&&(c=c.split("").map(u=>u+u).join("")),c.length!==6&&c.length!==8))return null;let a=u=>parseInt(c.slice(u,u+2),16)/255;return{r:a(0),g:a(2),b:a(4),a:c.length===8?a(6):1}}if(zt[t])return _("#"+zt[t]);let n=/^([a-z-]+)\\((.*)\\)$/s.exec(t);if(!n)return null;let r=n[1],{parts:o,alpha:i}=er(n[2]),s=Jn(i),l=null;try{switch(r){case"rgb":case"rgba":if(o.length<3)return null;l=[V(o[0],255)/255,V(o[1],255)/255,V(o[2],255)/255];break;case"hsl":case"hsla":if(o.length<3)return null;l=Vt(ze(o[0]),V(o[1].endsWith("%")?o[1]:o[1]+"%",1),V(o[2].endsWith("%")?o[2]:o[2]+"%",1));break;case"hwb":{let c=ze(o[0]),a=V(o[1],1),u=V(o[2],1);if(o[1].endsWith("%")||(a/=100),o[2].endsWith("%")||(u/=100),a+u>=1){let f=a/(a+u);l=[f,f,f]}else l=Vt(c,1,.5).map(h=>h*(1-a-u)+a);break}case"lab":{let c=o[0].endsWith("%")?parseFloat(o[0]):V(o[0]);l=ue(oe(We,Dt(c,V(o[1],125),V(o[2],125))));break}case"lch":{let c=o[0].endsWith("%")?parseFloat(o[0]):V(o[0]),a=V(o[1],150),u=ze(o[2])*Math.PI/180;l=ue(oe(We,Dt(c,a*Math.cos(u),a*Math.sin(u))));break}case"oklab":l=Ve(Wt(V(o[0],1),V(o[1],.4),V(o[2],.4)));break;case"oklch":{let c=V(o[1],.4),a=ze(o[2])*Math.PI/180;l=Ve(Wt(V(o[0],1),c*Math.cos(a),c*Math.sin(a)));break}case"color":{let c=o[0],a=[V(o[1]??"0",1),V(o[2]??"0",1),V(o[3]??"0",1)];switch(c){case"srgb":l=a;break;case"srgb-linear":l=Ve(a);break;case"display-p3":l=ue(oe(jn,a.map(Zn)));break;case"a98-rgb":l=ue(oe(Xn,a.map(u=>Math.sign(u)*Math.pow(Math.abs(u),563/256))));break;case"prophoto-rgb":l=ue(oe(We,oe(Kn,a.map(u=>Math.abs(u)<=16/512?u/16:Math.sign(u)*Math.pow(Math.abs(u),1.8)))));break;case"rec2020":{let u=1.09929682680944,f=.018053968510807;l=ue(oe(Qn,a.map(h=>Math.abs(h)<f*4.5?h/4.5:Math.sign(h)*Math.pow((Math.abs(h)+u-1)/u,1/.45))));break}case"xyz":case"xyz-d65":l=ue(a);break;case"xyz-d50":l=ue(oe(We,a));break;default:return null}break}default:return null}}catch{return null}return!l||!l.every(Number.isFinite)||!Number.isFinite(s)?null:{r:_e(l[0]),g:_e(l[1]),b:_e(l[2]),a:s}}var fe=[1,0,0,1,0,0];function Y(e,t){return[1,0,0,1,e,t]}function q(e,t){return[e[0]*t[0]+e[2]*t[1],e[1]*t[0]+e[3]*t[1],e[0]*t[2]+e[2]*t[3],e[1]*t[2]+e[3]*t[3],e[0]*t[4]+e[2]*t[5]+e[4],e[1]*t[4]+e[3]*t[5]+e[5]]}function $e(e){let t=e[0]*e[3]-e[1]*e[2];if(!Number.isFinite(t)||Math.abs(t)<1e-12)return null;let n=1/t;return[e[3]*n,-e[1]*n,-e[2]*n,e[0]*n,(e[2]*e[5]-e[3]*e[4])*n,(e[1]*e[4]-e[0]*e[5])*n]}function Ue(e,t,n){return[e[0]*t+e[2]*n+e[4],e[1]*t+e[3]*n+e[5]]}function _t(e,t,n){let r=[Ue(e,0,0),Ue(e,t,0),Ue(e,t,n),Ue(e,0,n)],o=r.map(c=>c[0]),i=r.map(c=>c[1]),s=Math.min(...o),l=Math.min(...i);return[s,l,Math.max(...o)-s,Math.max(...i)-l]}function tr(e){if(!e||e==="none")return{m:fe,is3d:!1,perspective:!1};let t=/^matrix\\(([^)]*)\\)$/.exec(e.trim());if(t){let r=t[1].split(",").map(o=>parseFloat(o));return r.length!==6||!r.every(Number.isFinite)?null:{m:r,is3d:!1,perspective:!1}}let n=/^matrix3d\\(([^)]*)\\)$/.exec(e.trim());if(n){let r=n[1].split(",").map(s=>parseFloat(s));if(r.length!==16||!r.every(Number.isFinite))return null;let o=Math.abs(r[2])<1e-9&&Math.abs(r[6])<1e-9&&Math.abs(r[8])<1e-9&&Math.abs(r[9])<1e-9&&Math.abs(r[10]-1)<1e-9&&Math.abs(r[11])<1e-9&&Math.abs(r[14])<1e-9&&Math.abs(r[3])<1e-9&&Math.abs(r[7])<1e-9&&Math.abs(r[15]-1)<1e-9,i=Math.abs(r[3])>1e-9||Math.abs(r[7])>1e-9||Math.abs(r[11])>1e-9;return{m:[r[0],r[1],r[4],r[5],r[12],r[13]],is3d:!o,perspective:i}}return null}function Ye(e,t){return e.endsWith("%")?parseFloat(e)/100*t:parseFloat(e)||0}function it(e){let t=parseFloat(e);return Number.isFinite(t)?e.endsWith("rad")?t:e.endsWith("grad")?t*Math.PI/200:e.endsWith("turn")?t*2*Math.PI:t*Math.PI/180:0}function Ut(e){let t=[],n=tr(e.transform);if(!n)return null;n.is3d&&t.push(n.perspective?"perspective":"3d");let r=n.m;if(e.scale&&e.scale!=="none"){let c=e.scale.trim().split(/\\s+/).map(f=>f.endsWith("%")?parseFloat(f)/100:parseFloat(f)),a=c[0],u=c.length>1?c[1]:c[0];c.length>2&&Math.abs(c[2]-1)>1e-9&&t.push("scale-z"),Number.isFinite(a)&&Number.isFinite(u)&&(r=q([a,0,0,u,0,0],r))}if(e.rotate&&e.rotate!=="none"){let c=e.rotate.trim().split(/\\s+/),a=0;if(c.length===1)a=it(c[0]);else{let h=c.slice(0,c.length-1),m=c[c.length-1];h.length===1&&h[0]==="z"?a=it(m):h.length===3&&Math.abs(parseFloat(h[0]))<1e-9&&Math.abs(parseFloat(h[1]))<1e-9?a=it(m)*Math.sign(parseFloat(h[2])||1):t.push("rotate-3d")}let u=Math.cos(a),f=Math.sin(a);r=q([u,f,-f,u,0,0],r)}if(e.translate&&e.translate!=="none"){let c=e.translate.trim().split(/\\s+/),a=Ye(c[0],e.width),u=c.length>1?Ye(c[1],e.height):0;c.length>2&&parseFloat(c[2])!==0&&t.push("translate-z"),r=q(Y(a,u),r)}let o=e.origin.trim().split(/\\s+/),i=Ye(o[0]??"0",e.width),s=Ye(o[1]??"0",e.height),l=q(Y(i,s),q(r,Y(-i,-s)));return l.every(Number.isFinite)?{m:l,unsupported:t}:null}function Me(e,t=!0){if(!e||e==="none")return[];let n=[];for(let r of ke(e,",")){let o=ke(r," "),i=!1,s=null,l=[];for(let c of o){if(c==="inset"){i=!0;continue}if(/^-?[\\d.]+(px)?$/.test(c)){l.push(parseFloat(c));continue}let a=_(c);if(a){s=a;continue}return null}if(l.length<2)return null;n.push({color:s??{r:0,g:0,b:0,a:1},x:l[0],y:l[1],blur:Math.max(0,l[2]??0),spread:t?l[3]??0:0,inset:i})}return n}function lt(e){return e.filter(t=>t.color.a>0).map(t=>({type:t.inset?"INNER_SHADOW":"DROP_SHADOW",color:t.color,x:t.x,y:t.y,blur:t.blur,spread:t.spread})).reverse()}function jt(e){return ke(e,",").map(t=>t.trim().replace(/^[\'"]|[\'"]$/g,"").replace(/\\\\(.)/g,"$1").trim()).filter(Boolean)}var nr=new Set(["serif","sans-serif","monospace","cursive","fantasy","system-ui","ui-serif","ui-sans-serif","ui-monospace","ui-rounded","emoji","math","fangsong","-apple-system","blinkmacsystemfont"]),Xt=e=>nr.has(e.toLowerCase());function Yt(e){let t=[];for(let n of e){let r=ke(n," "),o=null,i=[];for(let s of r){let l=_(s);if(l)o=l;else if(/^-?[\\d.]+(%|px)?$/.test(s))i.push(s);else return null}if(!o){if(i.length===1){t.push({color:{r:0,g:0,b:0,a:0},hint:!0});continue}return null}i.length||t.push({color:o});for(let s of i)s.endsWith("px")?t.push({color:o,posPx:parseFloat(s)}):t.push({color:o,pos:parseFloat(s)/100})}return t}function st(e,t){let n=e.some(a=>a.hint),r=e.filter(a=>!a.hint).map(a=>({color:a.color,pos:a.pos??(a.posPx!==void 0&&t>0?a.posPx/t:void 0)}));if(!r.length)return{stops:[],hints:n};r[0].pos===void 0&&(r[0].pos=0),r[r.length-1].pos===void 0&&(r[r.length-1].pos=1);let o=r[0].pos;for(let a of r)a.pos!==void 0&&(a.pos<o&&(a.pos=o),o=a.pos);for(let a=0;a<r.length;a++){if(r[a].pos!==void 0)continue;let u=a;for(;r[u].pos===void 0;)u++;let f=r[a-1].pos,h=r[u].pos;for(let m=a;m<u;m++)r[m].pos=f+(h-f)*(m-a+1)/(u-a+1)}let i=(a,u,f)=>{let h=a.a+(u.a-a.a)*f;if(h<=0)return{r:a.r,g:a.g,b:a.b,a:0};let m=g=>(a[g]*a.a+(u[g]*u.a-a[g]*a.a)*f)/h;return{r:m("r"),g:m("g"),b:m("b"),a:h}},s=a=>{if(a<=r[0].pos)return r[0].color;for(let u=1;u<r.length;u++){let f=r[u-1],h=r[u];if(a<=h.pos){let m=h.pos-f.pos;return m<=0?h.color:i(f.color,h.color,(a-f.pos)/m)}}return r[r.length-1].color},l=r.filter(a=>a.pos>=0&&a.pos<=1).map(a=>({position:a.pos,color:a.color}));(!l.length||l[0].position>0)&&l.unshift({position:0,color:s(0)}),l[l.length-1].position<1&&l.push({position:1,color:s(1)});let c=[];for(let a=0;a<l.length;a++){let u=l[a];if(u.color.a>.001){c.push(u);continue}let f=l[a-1],h=l[a+1];if(f&&h&&(f.color.r!==h.color.r||f.color.g!==h.color.g||f.color.b!==h.color.b)&&f.color.a>0&&h.color.a>0)c.push({position:u.position,color:{...f.color,a:0}}),c.push({position:Math.min(1,u.position+1e-4),color:{...h.color,a:0}});else{let m=f&&f.color.a>0?f.color:h?h.color:f?.color??u.color;c.push({position:u.position,color:{r:m.r,g:m.g,b:m.b,a:0}})}}return{stops:c.map(a=>({position:Math.min(1,Math.max(0,a.position)),color:a.color})),hints:n}}function rr(e,t,n){let r=e.replace(/^to\\s+/,"").split(/\\s+/),o=s=>r.includes(s);if(r.length===1)return{top:0,right:90,bottom:180,left:270}[r[0]]??null;let i=Math.atan2(t,n)*180/Math.PI;return o("top")&&o("right")?i:o("bottom")&&o("right")?180-i:o("bottom")&&o("left")?180+i:o("top")&&o("left")?360-i:null}var or=(e,t)=>[1/e,0,0,1/t,0,0];function at(e,t,n){let r=q(or(t,n),e);return $e(r)}function qt(e,t,n){let r={left:0,top:0,center:.5,right:1,bottom:1},o=.5*t,i=.5*n;if(!e.length)return[o,i];let s=(a,u)=>a in r?r[a]*u:a.endsWith("%")?parseFloat(a)/100*u:parseFloat(a);if(e.length===1){let a=e[0];return a==="top"||a==="bottom"?i=s(a,n):o=s(a,t),[o,i]}let[l,c]=e;return(l==="top"||l==="bottom"||c==="left"||c==="right")&&([l,c]=[c,l]),o=s(l,t),i=s(c,n),[o,i]}function Kt(e,t,n){let r=[],o=/^(repeating-)?(linear|radial|conic)-gradient\\((.*)\\)$/s.exec(e.trim());if(!o||t<=0||n<=0)return{paint:null,approx:["unparsed"]};if(o[1])return{paint:null,approx:["repeating"]};let i=o[2],s=ke(o[3],","),l=s[0],c=Yt([l])!==null&&!/^(to |at |circle|ellipse|from |in )/.test(l)&&!/deg|turn|rad|grad/.test(l.split(" ")[0]),a=c?"":l,u=c?s:s.slice(1);/\\bin\\s+\\w/.test(a)&&r.push("color-interpolation-space");let f=a.replace(/\\bin\\s+[\\w-]+(\\s+(shorter|longer|increasing|decreasing)\\s+hue)?/,"").trim(),h=Yt(u);if(!h)return{paint:null,approx:["unparsed-stops"]};if(i==="linear"){let L=180;if(f)if(f.startsWith("to ")){let O=rr(f,t,n);if(O===null)return{paint:null,approx:["unparsed-direction"]};L=O}else{let O=parseFloat(f);if(!Number.isFinite(O))return{paint:null,approx:["unparsed-angle"]};L=f.endsWith("turn")?O*360:f.endsWith("rad")?O*180/Math.PI:f.endsWith("grad")?O*.9:O}let x=L*Math.PI/180,C=Math.sin(x),E=-Math.cos(x),F=Math.abs(t*C)+Math.abs(n*E),W=t/2,A=n/2,I=W-C*F/2,z=A-E*F/2,K=-E,Q=C,ne=[C*F,E*F,K*F,Q*F,I-.5*K*F,z-.5*Q*F],U=at(ne,t,n),{stops:j,hints:X}=st(h,F);return X&&r.push("color-hint"),!U||j.length<2?{paint:null,approx:[...r,"degenerate"]}:{paint:{type:"GRADIENT_LINEAR",stops:j,transform:U,opacity:1},approx:r}}if(i==="radial"){let L="ellipse",x="farthest-corner",C=[],E=null;if(f){let[U,j]=f.split(/\\s*\\bat\\b\\s*/);j!==void 0&&(C=j.trim().split(/\\s+/));let X=(U||"").trim().split(/\\s+/).filter(Boolean),O=[];for(let H of X)if(H==="circle"||H==="ellipse")L=H;else if(/^(closest|farthest)-(side|corner)$/.test(H))x=H;else if(/^[\\d.]+(px|%)$/.test(H))O.push(H.endsWith("%")?parseFloat(H)/100*(O.length===0?t:n):parseFloat(H));else return{paint:null,approx:["unparsed-radial"]};O.length&&(E=O.length===1?[O[0],O[0]]:[O[0],O[1]]),O.length===1&&(L="circle")}let[F,W]=qt(C,t,n),A,I;if(E)[A,I]=E;else{let U=F,j=t-F,X=W,O=n-W,H=x.endsWith("side"),te=x.startsWith("closest");if(L==="circle")if(H)A=I=te?Math.min(U,j,X,O):Math.max(U,j,X,O);else{let P=[Math.hypot(U,X),Math.hypot(j,X),Math.hypot(U,O),Math.hypot(j,O)];A=I=te?Math.min(...P):Math.max(...P)}else{let P=te?Math.min(U,j):Math.max(U,j),B=te?Math.min(X,O):Math.max(X,O);H?(A=P,I=B):(A=P*Math.SQRT2,I=B*Math.SQRT2)}}if(!(A>0)||!(I>0))return{paint:null,approx:["degenerate"]};let z=[2*A,0,0,2*I,F-A,W-I],K=at(z,t,n),{stops:Q,hints:ne}=st(h,A);return ne&&r.push("color-hint"),!K||Q.length<2?{paint:null,approx:[...r,"degenerate"]}:{paint:{type:"GRADIENT_RADIAL",stops:Q,transform:K,opacity:1},approx:r}}let m=0,g=[];if(f){let L=/from\\s+(-?[\\d.]+)(deg|turn|rad|grad)?/.exec(f);L&&(m=L[2]==="turn"?parseFloat(L[1])*360:L[2]==="rad"?parseFloat(L[1])*180/Math.PI:parseFloat(L[1]));let x=/\\bat\\s+(.*)$/.exec(f);x&&(g=x[1].trim().split(/\\s+/))}let[R,p]=qt(g,t,n),b=Math.max(t,n),w=(m-90)*Math.PI/180,M=Math.cos(w),S=Math.sin(w),d=[2*b*M,2*b*S,-2*b*S,2*b*M,R-b*M+b*S,p-b*S-b*M],v=at(d,t,n),{stops:k,hints:$}=st(h,1);return r.push("conic"),$&&r.push("color-hint"),!v||k.length<2?{paint:null,approx:[...r,"degenerate"]}:{paint:{type:"GRADIENT_ANGULAR",stops:k,transform:v,opacity:1},approx:r}}function Qt(e,t,n){let[r,o,i,s]=e.map(([m,g])=>[Math.max(0,m||0),Math.max(0,g||0)]),l=1,c=(m,g)=>{m>g&&m>0&&(l=Math.min(l,g/m))};c(r[0]+o[0],t),c(s[0]+i[0],t),c(r[1]+s[1],n),c(o[1]+i[1],n);let a=[r,o,i,s].map(([m,g])=>[m*l,g*l]),u=a.some(([m,g])=>Math.abs(m-g)>.5),f=u&&a.every(([m,g])=>Math.abs(m-t/2)<.5&&Math.abs(g-n/2)<.5);return{radii:a.map(([m,g])=>Math.min(m,g)),elliptical:u,ellipse:f}}function Zt(e,t,n){let r=e.trim().split(/\\s+/),o=(l,c)=>l.endsWith("%")?parseFloat(l)/100*c:parseFloat(l)||0,i=o(r[0]??"0",t),s=r.length>1?o(r[1],n):r[0]?.endsWith("%")?o(r[0],n):i;return[i,s]}function ct(e){let t={blur:0,dropShadows:[],color:[],other:[]};if(!e||e==="none")return t;let n=/([a-z-]+)\\(((?:[^()]|\\([^()]*\\))*)\\)/g,r;for(;r=n.exec(e);){let o=r[1],i=r[2].trim();if(o==="blur")t.blur+=parseFloat(i)||0;else if(o==="drop-shadow"){let s=Me(i,!1);s&&s.length?t.dropShadows.push(...s):t.other.push(r[0])}else["grayscale","sepia","saturate","hue-rotate","invert","opacity","brightness","contrast"].includes(o)?t.color.push(r[0]):t.other.push(r[0])}return/url\\(/.test(e)&&t.other.push("url()"),t}function Jt(e){let t=/^([a-z-]+)\\(([^)]*)\\)$/.exec(e.trim());if(!t)return!1;let n=parseFloat(t[2]),r=t[2].trim().endsWith("%")?n/100:n;switch(t[1]){case"grayscale":case"sepia":case"invert":return r===0;case"saturate":case"brightness":case"contrast":case"opacity":return r===1;case"hue-rotate":return n===0}return!1}var ut={normal:"NORMAL",multiply:"MULTIPLY",screen:"SCREEN",overlay:"OVERLAY",darken:"DARKEN",lighten:"LIGHTEN","color-dodge":"COLOR_DODGE","color-burn":"COLOR_BURN","hard-light":"HARD_LIGHT","soft-light":"SOFT_LIGHT",difference:"DIFFERENCE",exclusion:"EXCLUSION",hue:"HUE",saturation:"SATURATION",color:"COLOR",luminosity:"LUMINOSITY","plus-lighter":"LINEAR_DODGE","plus-darker":"LINEAR_BURN"};var ft="http://www.w3.org/2000/svg";var ir=["fill","fill-opacity","fill-rule","stroke","stroke-width","stroke-opacity","stroke-dasharray","stroke-dashoffset","stroke-linecap","stroke-linejoin","stroke-miterlimit","clip-rule","visibility","font-family","font-size","font-weight","font-style","text-anchor","dominant-baseline","letter-spacing","paint-order","marker-start","marker-mid","marker-end","color-interpolation-filters","shape-rendering","image-rendering"],sr=[["opacity",["1"]],["clip-path",["none"]],["mask",["none"]],["filter",["none"]],["stop-color",[]],["stop-opacity",["1"]],["flood-color",["rgb(0, 0, 0)"]],["flood-opacity",["1"]],["lighting-color",["rgb(255, 255, 255)"]],["mix-blend-mode",["normal"]],["isolation",["auto"]],["vector-effect",["none"]]],ar={circle:["cx","cy","r"],ellipse:["cx","cy","rx","ry"],rect:["x","y","width","height","rx","ry"],path:["d"],image:["x","y","width","height"],use:["x","y"],foreignObject:["x","y","width","height"]},en={filter:"фильтр SVG",mask:"маска SVG",pattern:"паттерн SVG",foreignObject:"foreignObject",image:"растровое изображение внутри SVG",textPath:"textPath",feTurbulence:"фактура feTurbulence"},lr=0;function qe(e,t){if(!e)return;let n=/url\\(\\s*["\']?#([^"\')\\s]+)["\']?\\s*\\)/g,r;for(;r=n.exec(e);)t.add(decodeURIComponent(r[1]))}function cr(e,t){let n=t.transform;if(!n||n==="none")return null;let r=t.getPropertyValue("transform-box")||"view-box",o=t.transformOrigin.split(/\\s+/).map(a=>parseFloat(a)||0),i=o[0]??0,s=o[1]??0;if(r==="fill-box"||r==="content-box"||r==="border-box"||r==="stroke-box")try{let a=e.getBBox();i+=a.x,s+=a.y}catch{}let l=n.startsWith("matrix(")?n:null;if(!l){let a=/matrix3d\\(([^)]*)\\)/.exec(n)?.[1].split(",").map(parseFloat);return!a||a.length!==16?null:`translate(${i} ${s}) matrix(${a[0]} ${a[1]} ${a[4]} ${a[5]} ${a[12]} ${a[13]}) translate(${-i} ${-s})`}let c=l.slice(7,-1).split(",").map(a=>a.trim()).join(" ");return!i&&!s?`matrix(${c})`:`translate(${i} ${s}) matrix(${c}) translate(${-i} ${-s})`}function tn(e){return e.replace(/url\\(\\s*"([^"]*)"\\s*\\)/g,"url($1)")}function nn(e,t,n){let r=`h2f${(++lr).toString(36)}_`,o=new Set,i=new Set,s=[],l=0,c=0,a=!1,u=new Set,f=(w,M,S)=>{let d=w.localName;if(d==="script"||d==="animate"||d==="animateTransform"||d==="animateMotion"||d==="set"||d==="title"||d==="desc"||d==="metadata")return null;l++,en[d]&&o.add(en[d]),(d==="text"||d==="tspan")&&(a=!0);let v=getComputedStyle(w);if(!S&&v.display==="none"&&!["linearGradient","radialGradient","stop","clipPath","mask","filter","pattern","symbol","marker","defs"].includes(d)&&!d.startsWith("fe"))return null;let k=document.createElementNS(ft,d);for(let x of Array.from(w.attributes)){let C=x.name;if(/^on/i.test(C)||C==="style"||C==="class"||C==="transform"||C.startsWith("data-"))continue;if(C==="id"){u.add(x.value),k.setAttribute("id",r+x.value);continue}if(C==="href"||C==="xlink:href"){x.value.startsWith("#")?(i.add(decodeURIComponent(x.value.slice(1))),k.setAttribute("href","#"+r+decodeURIComponent(x.value.slice(1)))):(d==="image"||d==="feImage")&&(s.push(new URL(x.value,document.baseURI).toString()),k.setAttribute("href",new URL(x.value,document.baseURI).toString()));continue}let E=x.value;E.includes("url(")&&(qe(E,i),E=E.replace(/url\\(\\s*["\']?#([^"\')\\s]+)["\']?\\s*\\)/g,(F,W)=>`url(#${r}${decodeURIComponent(W)})`)),k.setAttribute(C,E)}d==="path"&&(c+=(w.getAttribute("d")??"").length),S&&(k.setAttribute("xmlns",ft),k.setAttribute("width",String(+t.toFixed(3))),k.setAttribute("height",String(+n.toFixed(3))),k.removeAttribute("x"),k.removeAttribute("y"),(v.overflow==="visible"||v.overflowX==="visible")&&k.setAttribute("overflow","visible"));let $=!["linearGradient","radialGradient","stop","filter","clipPath","mask","pattern","defs","symbol","marker"].includes(d)&&!d.startsWith("fe");for(let x of ir){let C=v.getPropertyValue(x);if(C&&(S||!M||M.getPropertyValue(x)!==C)){if(x.startsWith("marker")&&C==="none"&&S)continue;qe(C,i),k.setAttribute(x,tn(C).replace(/url\\(\\s*#([^)\\s]+)\\s*\\)/g,(E,F)=>`url(#${r}${F})`))}}for(let[x,C]of sr){if(x==="stop-color"&&d!=="stop"||(x==="flood-color"||x==="flood-opacity")&&!d.startsWith("fe")||x==="lighting-color"&&!d.startsWith("fe"))continue;let E=v.getPropertyValue(x);!E||C.includes(E)||(x==="filter"&&(qe(E,i),E.includes("url(")||o.add("CSS filter внутри SVG")),x==="mask"&&o.add("маска SVG"),x==="mix-blend-mode"&&E!=="normal"&&o.add("mix-blend-mode внутри SVG"),x==="clip-path"&&!E.includes("url(")&&o.add("CSS clip-path внутри SVG"),qe(E,i),k.setAttribute(x,tn(E).replace(/url\\(\\s*#([^)\\s]+)\\s*\\)/g,(F,W)=>`url(#${r}${W})`)))}if($&&!S){let x=cr(w,v);x?k.setAttribute("transform",x):w.getAttribute("transform")&&v.transform}else!S&&w.getAttribute("transform")&&!$&&k.setAttribute("transform",w.getAttribute("transform"));let L=ar[d];if(L)for(let x of L){let C=v.getPropertyValue(x);if(!(!C||C==="auto"||C==="none"))if(x==="d"){let E=/^path\\(["\'](.*)["\']\\)$/s.exec(C);E&&E[1]!==w.getAttribute("d")&&k.setAttribute("d",E[1])}else{let E=C.endsWith("px")?String(parseFloat(C)):C;w.getAttribute(x)!==E&&k.setAttribute(x,E)}}for(let x of Array.from(w.childNodes)){if(x.nodeType===Node.TEXT_NODE){x.textContent&&/\\S/.test(x.textContent)?k.appendChild(document.createTextNode(x.textContent)):x.textContent&&k.appendChild(document.createTextNode(" "));continue}if(x.nodeType!==Node.ELEMENT_NODE)continue;let C=f(x,v,!1);C&&k.appendChild(C)}return k},h=f(e,null,!0),m=document.createElementNS(ft,"defs"),g=new Set,R=0;for(;R++<500;){let w=[...i].filter(M=>!u.has(M)&&!g.has(M));if(!w.length)break;for(let M of w){g.add(M);let S=document.getElementById(M);if(!S||!(S instanceof SVGElement))continue;let d=S.parentElement?getComputedStyle(S.parentElement):null,v=f(S,d,!1);v&&m.appendChild(v)}}m.childNodes.length&&h.insertBefore(m,h.firstChild),l>2500&&o.add("сложность (элементов: "+l+")"),c>4e5&&o.add("объём путей");let p=new XMLSerializer().serializeToString(h),b=getComputedStyle(e);return{markup:p,reasons:[...o],elements:l,pathChars:c,hasText:a,externalImages:s,overflowVisible:b.overflowX==="visible"||b.overflow==="visible"}}function rn(e){let t=String(e).trim().split(/\\s+/).map(o=>o==="normal"?400:o==="bold"?700:parseFloat(o)),n=Number.isFinite(t[0])?t[0]:400,r=t.length>1&&Number.isFinite(t[1])?t[1]:n;return[Math.min(n,r),Math.max(n,r)]}function on(e,t,n){if(!e.length)return null;let r=n?e.filter(a=>a.italic):e.filter(a=>!a.italic&&!a.oblique);!r.length&&n&&(r=e.filter(a=>a.oblique)),r.length||(r=n?e.filter(a=>!a.italic&&!a.oblique):e.filter(a=>a.oblique)),r.length||(r=e);let o=n&&!r.some(a=>a.italic||a.oblique),i=r.find(a=>t>=a.weightMin&&t<=a.weightMax),s,l;if(i)s=i,l=t;else{let a=m=>t<m.weightMin?m.weightMin:m.weightMax,u=r.filter(m=>m.weightMax<t).sort((m,g)=>g.weightMax-m.weightMax),f=r.filter(m=>m.weightMin>t).sort((m,g)=>m.weightMin-g.weightMin),h;if(t>=400&&t<=500){let m=f.filter(R=>R.weightMin<=500),g=f.filter(R=>R.weightMin>500);h=[...m,...u,...g]}else t<400?h=[...u,...f]:h=[...f,...u];s=h[0],l=a(s)}let c=t>=600&&l<=500;return{face:s,weight:l,syntheticBold:c,syntheticItalic:o}}var ur=document.createElement("canvas"),sn=ur.getContext("2d"),dt=new Map,an=new Map,Re=null;function pn(e){return e.replace(/^[\'"]|[\'"]$/g,"").trim().toLowerCase()}function fr(){if(Re)return Re;Re=new Map;try{document.fonts.forEach(e=>{let t=pn(e.family),[n,r]=rn(e.weight),o=e.style.toLowerCase(),i=Re.get(t)??[];i.push({weightMin:n,weightMax:r,italic:o.includes("italic"),oblique:o.includes("oblique"),status:e.status}),Re.set(t,i)})}catch{}return Re}function ie(e,t){return sn.font=e,sn.measureText(t).width}function hn(e,t,n){let r=`${e}|${t}|${n}`,o=an.get(r);if(o!==void 0)return o;let i="mmmmmmmmmmlli10WQ",s=`${n?"italic ":""}${t} 40px "${e.replace(/"/g,\'\\\\"\')}"`,l=ie(`${s}, monospace`,i),c=ie(`${s}, serif`,i),a=ie(`${s}, sans-serif`,i);if(o=l===c&&c===a,!o){let u="ЖЖЖЖЖшшшщщ",f=ie(`${s}, monospace`,u),h=ie(`${s}, serif`,u),m=ie(`${s}, sans-serif`,u);o=f===h&&h===m}return an.set(r,o),o}function dr(e,t,n,r){let o=`${e}|${t}|${n}|${r}`,i=dt.get(o);if(i!==void 0)return i;if(!hn(e,t,n))return dt.set(o,!1),!1;let s=`${n?"italic ":""}${t} 40px "${e.replace(/"/g,\'\\\\"\')}"`,l=ie(`${s}, monospace`,r),c=ie(`${s}, serif`,r),a=ie(`${s}, sans-serif`,r);return i=l===c&&c===a,dt.set(o,i),i}var Oe=new Map,je=new Map;function mn(){return[...Oe.values()]}function mt(e,t){let n=/^\\s$/.test(t),r=null,o;for(let c of e.families){if(Xt(c)){o=c.toLowerCase();break}if(n?hn(c,e.weight,e.italic):dr(c,e.weight,e.italic,t)){r=c;break}}if(!r&&!o&&(o="default"),r){let c=fr().get(pn(r)),a=e.weight,u=e.italic,f="system",h=!1,m=[];if(c&&c.length){f="webfont";let p=c.filter(w=>w.status==="loaded"),b=on(p.length?p:c,e.weight,e.italic);b&&(a=b.weight,u=b.face.italic||b.face.oblique,h=b.face.weightMax>b.face.weightMin,b.syntheticBold&&m.push("bold"),b.syntheticItalic&&(m.push("italic"),u=!1))}let g=`${r}|${a}|${u?"i":"n"}`,R=Oe.get(g);return R||(R={key:g,family:r,weight:a,italic:u,source:f,variable:h,synthetic:m.length?m:void 0},Oe.set(g,R)),R}let i=`@${o}|${e.weight}|${e.italic?"i":"n"}`,s=je.get(e.el)??{generic:o,chars:new Set};n||s.chars.add(t),je.set(e.el,s);let l=Oe.get(i);return l||(l={key:i,family:"",generic:o,weight:e.weight,italic:e.italic,source:"generic"},Oe.set(i,l)),l}var ln=new Map,cn=new Map,de=null;function pr(e){let t=`${e.fontFamily}|${e.fontSize}|${e.fontWeight}|${e.fontStyle}`,n=cn.get(t);if(n!==void 0)return n;de||(de=document.createElement("div"),de.setAttribute("data-h2f-probe",""),de.style.cssText="position:absolute!important;left:-100000px!important;top:0!important;visibility:hidden!important;contain:layout style!important;pointer-events:none!important;",document.documentElement.appendChild(de));let r=document.createElement("div");return r.style.cssText=`all:initial;display:block;white-space:pre;font-family:${e.fontFamily};font-size:${e.fontSize};font-weight:${e.fontWeight};font-style:${e.fontStyle};line-height:normal;`,r.textContent=`Hg\nHg`,de.appendChild(r),n=r.getBoundingClientRect().height/2,r.remove(),cn.set(t,n),n}function gn(){de?.remove(),de=null}function hr(e,t){let n=e,r={overline:!1};for(;n;){let o=getComputedStyle(n),i=o.textDecorationLine;if(i&&i!=="none"&&(!r.line&&i.includes("underline")?r.line="UNDERLINE":!r.line&&i.includes("line-through")&&(r.line="STRIKETHROUGH"),i.includes("overline")&&(r.overline=!0),r.line&&!r.color)){r.color=_(o.textDecorationColor)??void 0,r.style=o.textDecorationStyle;let s=o.textDecorationThickness;s&&s.endsWith("px")&&(r.thickness=parseFloat(s))}if(n===t){let s=o.display,l=o.position,c=o.cssFloat;if(/inline-|table|flex|grid/.test(s)&&s!=="inline"||l==="absolute"||l==="fixed"||c!=="none")break;t=n.parentElement}if(n=n.parentElement,!n||n===document.documentElement)break}return r}function Ee(e,t){let n=ln.get(e);if(n)return n;let r=getComputedStyle(e),o=T(r.fontSize),i;r.lineHeight==="normal"?i=pr(r):/^[\\d.]+$/.test(r.lineHeight)?i=parseFloat(r.lineHeight)*o:i=T(r.lineHeight);let s=_(r.color)??{r:0,g:0,b:0,a:1},l=r.getPropertyValue("-webkit-text-fill-color"),c=!1,a=_(l);if(a&&l!==r.color)if(a.a===0){let p=e;for(;p&&p!==t.parentElement;){let b=getComputedStyle(p);if(b.backgroundClip==="text"||b.getPropertyValue("-webkit-background-clip")==="text"){let w=/(rgba?\\([^)]*\\)|color\\([^)]*\\)|oklch\\([^)]*\\)|oklab\\([^)]*\\))/.exec(b.backgroundImage),M=w?_(w[1]):_(b.backgroundColor);M&&(s=M,c=!0);break}p=p.parentElement}c||(s=a)}else s=a;let u=1;for(let p=e;p&&p!==t;p=p.parentElement){let b=getComputedStyle(p);(b.display==="inline"||b.display==="contents")&&(u*=parseFloat(b.opacity))}s={...s,a:s.a*u};let f=hr(e,t),h,m=e.closest("a[href]");m&&/^(https?:|mailto:)/i.test(m.href)&&!m.href.startsWith(location.origin)&&(h=m.href);let g=T(r.getPropertyValue("-webkit-text-stroke-width")),R={el:e,families:jt(r.fontFamily),size:o,weight:parseInt(r.fontWeight,10)||400,italic:r.fontStyle.startsWith("italic")||r.fontStyle.startsWith("oblique"),color:s,lineHeight:i,letterSpacing:r.letterSpacing==="normal"?0:T(r.letterSpacing),wordSpacing:r.wordSpacing==="normal"?0:T(r.wordSpacing),transform:r.textTransform,decoration:f.line,decorationColor:f.color,decorationStyle:f.style==="dotted"?"DOTTED":f.style==="wavy"?"WAVY":"SOLID",decorationThickness:f.thickness,overline:f.overline,link:h,visible:r.visibility==="visible",smallCaps:r.fontVariantCaps!=="normal",verticalAlign:r.verticalAlign,lang:e.closest("[lang]")?.getAttribute("lang")||document.documentElement.lang||"und",shadow:r.textShadow,stroke:g>0?{color:_(r.getPropertyValue("-webkit-text-stroke-color"))??s,width:g}:void 0,gradientText:c};return ln.set(e,R),R}function un(e,t,n,r){try{if(t==="uppercase")return e.toLocaleUpperCase(n);if(t==="lowercase")return e.toLocaleLowerCase(n);if(t==="capitalize"&&r)return e.toLocaleUpperCase(n)}catch{}return t==="uppercase"?e.toUpperCase():t==="lowercase"?e.toLowerCase():t==="capitalize"&&r?e.toUpperCase():e}var pt=document.createRange();function bn(e,t,n,r,o){let i=[],s=!1,l="",c=n?-1:0;for(let a of e){if(a.kind==="break"||a.kind==="br"){s=!0,l=" ";continue}if(a.kind==="inline-start"||a.kind==="inline-end"){a.hard&&(s=!0);continue}let u=a.node,f=u.parentElement;if(!f)continue;let h=Ee(f,t),m=u.data,g=getComputedStyle(f).whiteSpace,R=g==="pre"||g==="pre-wrap"||g==="break-spaces";for(let p=0;p<m.length;){if(r.chars>=o)return r.limitHit=!0,i;let w=m.codePointAt(p)>65535?2:1,M=m.slice(p,p+w);pt.setStart(u,p),pt.setEnd(u,p+w);let S=pt.getClientRects(),d=null;for(let C=0;C<S.length;C++)(S[C].width>0||!d)&&(d=S[C]);if(p+=w,M==="­"){d&&d.width>0&&i.length&&(i[i.length-1].softHyphen=!0);continue}let v=/\\s/.test(M)&&M!==" ";if((!d||d.width===0&&d.height===0)&&(v||!d)||v&&d.width<=.01)continue;if(M==="	"){s=!0,l=" ";continue}if(!h.visible){s=!0;continue}let k=v?R&&M!==`\n`?M:" ":M;if(M===`\n`&&!R&&(k=" "),M===`\n`&&R){s=!0;continue}let $=!l||/[\\s \\-–—(«"\'“„]/.test(l);k=un(k,h.transform,h.lang,$);let L=h,x=!1;n&&c!==0&&(c===-1&&(c=1),L=n.st,x=!0,/[\\p{L}\\p{N}]/u.test(M)&&(c=0),k=un(M,L.transform,L.lang,!0)),r.chars++,i.push({ch:k,x:d.left+scrollX,y:d.top+scrollY,w:d.width,h:d.height,st:L,font:mt(L,k),node:u,offset:p-w,breakBefore:s||void 0,firstLetter:x||void 0}),s=!1,l=M}}return i}function fn(e){let t=[],n=null;for(let r of e){if(n){let o=n.chars[n.chars.length-1],i=Math.min(n.bottom,r.y+r.h)-Math.max(n.top,r.y),s=Math.min(r.h,o.h)||1,l=r.x+.5<o.x&&r.y>o.y+.25*o.h;(i<.3*s||l)&&(t.push(n),n=null)}n||(n={chars:[],top:r.y,bottom:r.y+r.h,left:r.x,right:r.x+r.w}),n.chars.push(r),n.top=Math.min(n.top,r.y),n.bottom=Math.max(n.bottom,r.y+r.h),n.left=Math.min(n.left,r.x),n.right=Math.max(n.right,r.x+r.w)}return n&&t.push(n),t}function dn(e){let t=[],n=[],r=()=>{if(!n.length)return;for(;n.length>1&&n[n.length-1].ch===" ";)n.pop();for(;n.length>1&&n[0].ch===" ";)n.shift();if(n.length===1&&n[0].ch===" "){n=[];return}let o=Math.max(...n.map(s=>s.st.size)),i=n.find(s=>s.st.size===o);t.push({chars:n,left:Math.min(...n.map(s=>s.x)),right:Math.max(...n.map(s=>s.x+s.w)),line:e,maxSize:o,ref:i,firstLetter:!!n[0].firstLetter}),n=[]};for(let o of e.chars){if(n.length){let i=n[n.length-1],s=o.x-(i.x+i.w),l=Math.max(1.5,.35*Math.max(o.st.size,i.st.size))+Math.max(0,i.st.letterSpacing)+Math.max(0,i.st.wordSpacing),c=Math.max(o.st.size,i.st.size)/Math.max(.01,Math.min(o.st.size,i.st.size))>1.3,a=!!o.firstLetter!=!!i.firstLetter,u=Math.abs(o.y+o.h/2-(i.y+i.h/2))>.35*Math.max(o.h,i.h);(o.breakBefore||s>l||s<-Math.max(2,.5*i.w)||c||a||u)&&r()}n.push(o)}return r(),t}function mr(e,t){let n=t==="rtl";switch(e){case"center":case"-webkit-center":return"CENTER";case"right":case"-webkit-right":return"RIGHT";case"end":return n?"LEFT":"RIGHT";case"start":return n?"RIGHT":"LEFT";default:return"LEFT"}}function ht(e,t,n){let r="",o=[],i=(h,m,g)=>{let R=o[o.length-1];R&&R.st===m&&R.font===g?R.end+=h.length:o.push({start:r.length,end:r.length+h.length,st:m,font:g}),r+=h};e.forEach((h,m)=>{if(m>0){let g=o[o.length-1];i(`\n`,g.st,g.font)}h.chars.forEach((g,R)=>{if(i(g.ch,g.st,g.font),R===h.chars.length-1&&m<e.length-1){let p=e[m+1].chars[0],b=/[\\p{L}]/u.test(g.ch)&&p&&/[\\p{L}]/u.test(p.ch);(g.softHyphen||b&&getComputedStyle(g.st.el).hyphens==="auto")&&i("-",g.st,g.font)}})});let s=e.length>1?(e[e.length-1].ref.y+e[e.length-1].ref.h/2-(e[0].ref.y+e[0].ref.h/2))/(e.length-1):e[0].ref.st.lineHeight,l=Math.max(.5,s||e[0].ref.st.lineHeight||e[0].maxSize*1.2),c=e[0].ref,a=c.y+c.h/2-l/2,u=Math.min(...e.map(h=>h.left)),f=Math.max(...e.map(h=>h.right));return{x:u,y:a,w:f-u,h:l*e.length,text:r,runs:o,lineHeight:l,align:t,lines:e.length,name:n}}function yn(e,t){if(!e.length)return[];let n=mr(t.align,t.direction);if(t.vertical){let a=fn(e).flatMap(dn);if(!a.length)return[];let u=ht([{...a[0],chars:a.flatMap(b=>b.chars)}],"LEFT",t.name),f=e.map(b=>b.x),h=e.map(b=>b.y),m=Math.min(...f),g=Math.max(...e.map(b=>b.x+b.w)),R=Math.min(...h),p=Math.max(...e.map(b=>b.y+b.h));return[{...u,x:m,y:R,w:p-R,h:g-m,lineHeight:g-m,vertical:!0}]}let r=fn(e),o=[],i=[],s=()=>{i.length&&o.push(ht(i,n,t.name)),i=[]},l=a=>n==="LEFT"?a.left:n==="RIGHT"?a.right:(a.left+a.right)/2,c=a=>a.ref.y+a.ref.h/2;for(let a of r){let u=dn(a);if(u.length!==1||u[0].firstLetter){s();for(let h of u)o.push(ht([h],h.firstLetter?"LEFT":n,t.name));continue}let f=u[0];if(i.length){let h=i[i.length-1],m=n==="CENTER"?1.5:1,g=c(f)-c(h),R=i.length===1?g>.5*h.maxSize&&g<2.2*Math.max(h.ref.st.lineHeight,h.maxSize):Math.abs(g-(c(h)-c(i[i.length-2])))<.75,p=Math.abs(f.maxSize-h.maxSize)<.01&&f.ref.st.lineHeight===h.ref.st.lineHeight;(Math.abs(l(f)-l(h))>m||!R||!p)&&s()}i.push(f)}if(s(),t.clamp&&o.length){let a=o[0];if(a.lines>t.clamp){let u=a.text.split(`\n`).slice(0,t.clamp+1).join(`\n`);a.text=u,a.runs=a.runs.filter(f=>f.start<u.length).map(f=>({...f,end:Math.min(f.end,u.length)})),a.lines=t.clamp+1,a.h=a.lineHeight*t.clamp,a.truncate=t.clamp}o.length=1}return t.ellipsis&&o.length===1&&o[0].lines===1&&(o[0].truncate=1,o[0].fixedWidth=t.ellipsis.width),o}function xn(e){return e.shadow&&e.shadow!=="none"?Me(e.shadow,!1):[]}var y=null;function N(e,t,n,r){if(!y)return;let o=t+"|"+n,i=y.diags.get(o);if(i){i.count=(i.count??1)+1;return}y.diags.set(o,{level:e,code:t,message:n,node:r,count:1})}function pe(e,t){let n=y.assetKey.get(e);if(n)return n;let r="ref"+y.assets.size;return y.assets.set(r,t),y.assetKey.set(e,r),r}function gt(e){if(e.shadowRoot)return Array.from(e.shadowRoot.childNodes);if(e.tagName==="SLOT"){let t=e.assignedNodes({flatten:!0});return t.length?t:Array.from(e.childNodes)}return Array.from(e.childNodes)}var wn=new Set(["IMG","CANVAS","VIDEO","IFRAME","EMBED","OBJECT","INPUT","TEXTAREA","SELECT","METER","PROGRESS"]);function gr(e,t){let n=y.poses.get(e);if(!n)return;let r=parseFloat(t.opacity);(parseFloat(n.opacity)>r+.01||t.visibility==="hidden"&&n.visibility!=="hidden")&&(t.opacity=n.opacity,t.visibility=n.visibility,t.transform=n.transform,t.translate=n.translate,t.rotate=n.rotate,t.scale=n.scale,t.filter=n.filter,y.stats.revealPoses=(y.stats.revealPoses??0)+1)}function br(e,t){if(!e||e==="none"||e==="normal")return null;let n="",r=/"((?:[^"\\\\]|\\\\.)*)"|\'((?:[^\'\\\\]|\\\\.)*)\'|attr\\(([^)]+)\\)|(open-quote|close-quote|no-open-quote|no-close-quote)|counters?\\([^)]*\\)|url\\([^)]*\\)|(\\S+)/g,o,i=!1;for(;o=r.exec(e);)if(o[1]!==void 0||o[2]!==void 0){let s=o[1]??o[2];n+=s.replace(/\\\\([0-9a-fA-F]{1,6})\\s?/g,(l,c)=>String.fromCodePoint(parseInt(c,16))).replace(/\\\\(.)/g,"$1")}else o[3]?n+=t.getAttribute(o[3].trim())??"":o[4]?n+=o[4]==="open-quote"?"«":o[4]==="close-quote"?"»":"":o[0].startsWith("counter")?i=!0:o[0].startsWith("url(")||o[5]&&o[5]!=="/"&&(i=!0);return i&&N("info","pseudo-counter","Счётчики CSS (counter()) в content псевдоэлементов не вычисляются",D(t)),n}function yr(e,t){let n=t["list-style-type"];if(!n||n==="none")return"";let r=1,o=e.parentElement;if(o&&o.tagName==="OL"){let l=parseInt(o.getAttribute("start")??"1",10)||1,c=Array.from(o.children).filter(u=>getComputedStyle(u).display==="list-item");r=l+Math.max(0,c.indexOf(e));let a=e.getAttribute("value");a&&(r=parseInt(a,10)||r)}let i=l=>{let c="";for(;l>0;)l--,c=String.fromCharCode(97+l%26)+c,l=Math.floor(l/26);return c},s=l=>{let c=[[1e3,"m"],[900,"cm"],[500,"d"],[400,"cd"],[100,"c"],[90,"xc"],[50,"l"],[40,"xl"],[10,"x"],[9,"ix"],[5,"v"],[4,"iv"],[1,"i"]],a="";for(let[u,f]of c)for(;l>=u;)a+=f,l-=u;return a};switch(n){case"disc":return"•";case"circle":return"◦";case"square":return"▪";case"decimal":return r+".";case"decimal-leading-zero":return String(r).padStart(2,"0")+".";case"lower-alpha":case"lower-latin":return i(r)+".";case"upper-alpha":case"upper-latin":return i(r).toUpperCase()+".";case"lower-roman":return s(r)+".";case"upper-roman":return s(r).toUpperCase()+".";default:return/^["\']/.test(n)?n.slice(1,-1):"•"}}function xr(e){let t=e.filter(n=>{try{return document.querySelector(n),!0}catch{return!1}});return n=>t.some(r=>{try{return!!n.closest(r)}catch{return!1}})}async function kn(e,t,n){y={opts:e,recs:[],byEl:new Map,textOrder:new Map,order:0,diags:new Map,assets:new Map,assetKey:new Map,bgSizes:new Map,poses:t,hoverCard:n.card,hoverPoint:n.point,rootRecs:[],nodeCount:0,limitHit:!1,chars:{chars:0,limitHit:!1},styleSheet:null,neutralSheet:null,geometryShift:0,mismatches:[],stats:{},canvasBg:"",bodyRecNeeded:!1,shots:0},window.scrollTo({top:0,left:0,behavior:"instant"}),(scrollY!==0||scrollX!==0)&&N("warn","scroll-locked",`Страница не вернулась в начало прокрутки (scrollY=${scrollY}); координаты учитывают смещение`),y.styleSheet=document.createElement("style"),y.styleSheet.setAttribute("data-h2f","freeze"),y.styleSheet.textContent="*,*::before,*::after{transition:none!important;caret-color:transparent!important}",document.documentElement.appendChild(y.styleSheet);let r=xr(e.exclude),o=document.documentElement,i=document.body,s=getComputedStyle(o),l=i?getComputedStyle(i):s,c=_(s.backgroundColor),a=c&&c.a>0||s.backgroundImage!=="none";if(y.canvasBg=a?"html":"body",a&&i){let p=_(l.backgroundColor);y.bodyRecNeeded=p&&p.a>0||l.backgroundImage!=="none"}if(i){let p=we(l);(p["box-shadow"]!=="none"||T(p["border-top-width"])||T(p["border-left-width"])||me(p)||parseFloat(p.opacity)<1||Se(p)&&!1)&&(y.bodyRecNeeded=!0)}let u=0,f=(p,b,w,M)=>{if(y.nodeCount>e.maxNodes){y.limitHit=!0;return}if(p.nodeType===Node.TEXT_NODE){y.textOrder.set(p,y.order++),w&&w.items.push({kind:"text",node:p});return}if(p.nodeType!==Node.ELEMENT_NODE)return;let S=p;if(Gt.has(S.tagName)||S.hasAttribute("data-h2f-probe")||S.getAttribute("data-h2f")==="freeze"||S.tagName==="INPUT"&&S.type==="hidden")return;if(r(S)){y.stats.excluded=(y.stats.excluded??0)+1;return}let d=getComputedStyle(S);if(d.display==="none")return;let v=S===o||S===i&&!y.bodyRecNeeded;if(S.tagName==="BR"){w&&w.items.push({kind:"br"});return}if(d.display==="contents"||v){let E=S!==o;E&&m(S,d,b,v?null:w,M);for(let F of gt(S))f(F,b,v?null:w,M);E&&g(S,b,v?null:w,M);return}let k=we(d);gr(S,k);let $=S instanceof SVGSVGElement&&!(S.parentElement instanceof SVGElement);if(S instanceof SVGElement&&!$)return;let L=Bt(k.display)&&!wn.has(S.tagName)&&!$,x={id:y.recs.length,el:S,s:k,kind:L?"inline":"box",parent:b,figmaParent:null,order:y.order++,endOrder:0,items:[],children:[],inlines:[],texts:[],sc:!1,fixed:k.position==="fixed",sticky:k.position==="sticky",cb:null,hasText:!1,depth:M,replaced:$?"SVG":wn.has(S.tagName)?S.tagName:void 0};y.recs.push(x),y.byEl.set(S,x),y.nodeCount++;let C=S.getBoundingClientRect();if(x.aabbA={x:C.left+scrollX,y:C.top+scrollY,w:C.width,h:C.height},x.sc=rt(k,b?b.s.display:"block"),y.hoverCard===S&&(x.hoverCard=!0),L){let E=T(k["padding-left"])+T(k["padding-right"])+T(k["border-left-width"])+T(k["border-right-width"])+Math.abs(T(k["margin-left"]))+Math.abs(T(k["margin-right"]))>.5;(w??b)?.inlines.push(x),w&&w.items.push({kind:"inline-start",el:S,hard:E}),m(S,d,b,w,M);for(let F of gt(S))f(F,b,w,M+1);g(S,b,w,M),w&&w.items.push({kind:"inline-end",el:S,hard:E}),x.endOrder=y.order++;return}if(w&&w.items.push({kind:"break"}),(b?b.children:y.rootRecs).push(x),$){let E=S,F=T(k["border-left-width"])+T(k["border-right-width"])+T(k["padding-left"])+T(k["padding-right"]),W=T(k["border-top-width"])+T(k["border-bottom-width"])+T(k["padding-top"])+T(k["padding-bottom"]),A=T(k.width),I=T(k.height);k["box-sizing"]==="border-box"&&(A-=F,I-=W),(!(A>0)||!(I>0))&&(A=Math.max(0,C.width-F),I=Math.max(0,C.height-W)),x.svgContent={w:A,h:I};try{x.svg=nn(E,A,I)}catch(z){N("warn","svg-serialize","Не удалось сериализовать SVG: "+String(z).slice(0,120),D(S))}x.endOrder=y.order++;return}if(x.replaced){x.endOrder=y.order++;return}m(S,d,x,x,M+1);for(let E of gt(S))f(E,x,x,M+1);g(S,x,x,M+1),x.endOrder=y.order++},h=(p,b,w,M,S)=>{let d=we(w),v=b==="marker"?yr(p,we(getComputedStyle(p))):br(d.content,p);if(v===null)return null;let k={id:y.recs.length,el:p,pseudo:b,s:d,kind:"box",parent:M,figmaParent:null,order:y.order++,endOrder:0,items:[],children:[],inlines:[],texts:[],sc:rt(d,M?M.s.display:"block"),fixed:d.position==="fixed",sticky:d.position==="sticky",cb:null,hasText:!!v.trim(),depth:S,pseudoText:v};return k.endOrder=k.order,y.recs.push(k),y.nodeCount++,p.hasAttribute("data-h2f-p")||(p.setAttribute("data-h2f-p",String(y.byEl.get(p)?.id??"x"+k.id)),u++),k};function m(p,b,w,M,S){if(b.display==="list-item"&&b.listStyleType!=="none"){let v=h(p,"marker",getComputedStyle(p,"::marker"),w,S);v&&(w?w.children:y.rootRecs).push(v)}let d=getComputedStyle(p,"::before");if(d.content!=="none"&&d.content!=="normal"&&d.display!=="none"){let v=h(p,"before",d,w,S);v&&((w?w.children:y.rootRecs).push(v),M&&M.items.push({kind:"break"}))}}function g(p,b,w,M){let S=getComputedStyle(p,"::after");if(S.content!=="none"&&S.content!=="normal"&&S.display!=="none"){let d=h(p,"after",S,b,M);d&&((b?b.children:y.rootRecs).push(d),w&&w.items.push({kind:"break"}))}}f(o,null,null,0);for(let p of y.recs)if(p.s.position==="absolute"||p.s.position==="fixed"){let b=p.s.position==="fixed",w=b?"viewport":null;for(let M=p.pseudo?y.byEl.get(p.el)??p.parent:p.parent;M;M=M.parent)if(M.kind==="box"&&nt(M.s,b)){w=M;break}p.pseudo&&y.byEl.get(p.el)?.kind==="box"&&nt(y.byEl.get(p.el).s,b)&&(w=y.byEl.get(p.el)),p.cb=w,b&&w!=="viewport"&&(p.fixed=!1)}let R=new Set;for(let p of y.recs)for(let b of Xe(p.s["background-image"]))R.add(b);for(let p of Xe(s.backgroundImage))R.add(p);if(i)for(let p of Xe(l.backgroundImage))R.add(p);return await Promise.all([...R].map(p=>new Promise(b=>{let w=new Image,M=()=>{y.bgSizes.set(p,{w:w.naturalWidth,h:w.naturalHeight}),b()};w.onload=M,w.onerror=()=>{y.bgSizes.set(p,{w:0,h:0}),b()},w.src=p,setTimeout(M,4e3)}))),{recs:y.recs.length,pseudoMarked:u,bgUrls:R.size,limitHit:y.limitHit}}function Xe(e){let t=[],n=/url\\(\\s*"((?:[^"\\\\]|\\\\.)*)"\\s*\\)|url\\(\\s*\'([^\']*)\'\\s*\\)|url\\(\\s*([^)"\']+)\\s*\\)/g,r;for(;r=n.exec(e??"");)t.push((r[1]??r[2]??r[3]).replace(/\\\\(.)/g,"$1"));return t}function Mn(e){if(y)if(e){for(let t of y.recs)t.kind==="box"&&!t.pseudo&&me(t.s)&&t.el.setAttribute("data-h2f-tf","");y.neutralSheet=document.createElement("style"),y.neutralSheet.setAttribute("data-h2f","neutral"),y.neutralSheet.textContent="[data-h2f-tf]{transform:none!important;translate:none!important;rotate:none!important;scale:none!important;will-change:transform!important}*::before,*::after,*::marker{transform:none!important;translate:none!important;rotate:none!important;scale:none!important}",document.documentElement.appendChild(y.neutralSheet)}else{y.neutralSheet?.remove(),y.neutralSheet=null;for(let t of Array.from(document.querySelectorAll("[data-h2f-tf]")))t.removeAttribute("data-h2f-tf")}}function wr(e){if(!e||e.length<8)return;let t=[e[0],e[2],e[4],e[6]],n=[e[1],e[3],e[5],e[7]],r=Math.min(...t),o=Math.min(...n);return{x:r+scrollX,y:o+scrollY,w:Math.max(...t)-r,h:Math.max(...n)-o}}function Rn(e){if(!y)throw new Error("capture not started");let t=new Map;for(let n of Array.from(document.querySelectorAll("[data-h2f-p]"))){let r=e[n.getAttribute("data-h2f-p")];r&&t.set(n,r)}for(let n of y.recs){if(n.pseudo){let o=t.get(n.el);n.layout=wr(o?.[n.pseudo]);continue}let r=n.el.getBoundingClientRect();n.layout={x:r.left+scrollX,y:r.top+scrollY,w:r.width,h:r.height},n.kind==="inline"&&(n.frags=Array.from(n.el.getClientRects()).map(o=>({x:o.left+scrollX,y:o.top+scrollY,w:o.width,h:o.height})).filter(o=>o.w>0||o.h>0))}for(let n of y.recs){if(n.kind!=="box"||n.pseudo||!n.items.some(u=>u.kind==="text"))continue;let r=kr(n),o=bn(n.items,n.el,r,y.chars,y.opts.maxChars);if(!o.length)continue;let i=n.s,s=i["-webkit-line-clamp"]&&i["-webkit-line-clamp"]!=="none"?parseInt(i["-webkit-line-clamp"],10):null,l=n.el,c=i["text-overflow"]==="ellipsis"&&Se(i)&&l.scrollWidth>l.clientWidth+1&&/nowrap|pre/.test(i["white-space"])?{width:Math.max(1,n.layout.w-T(i["padding-left"])-T(i["padding-right"])-T(i["border-left-width"])-T(i["border-right-width"]))}:null,a=i["writing-mode"].startsWith("vertical")||i["writing-mode"].startsWith("sideways");a&&N("info","vertical-text","Вертикальный текст перенесён поворотом строки на 90°",D(n.el)),i["text-align"]==="justify"&&N("info","justify","Выравнивание по ширине перенесено как по левому краю (переносы строк сохранены)",D(n.el)),n.texts=yn(o,{align:i["text-align"],direction:i.direction,clamp:s,ellipsis:c,vertical:a,name:Sr(o)}),n.hasText=n.texts.length>0,n.textOrder=y.textOrder.get(o[0].node)??n.order}y.chars.limitHit&&N("warn","text-limit",`Достигнут лимит символов на страницу (${y.opts.maxChars}); остальной текст пропущен`),gn()}function Sr(e){return e.slice(0,60).map(t=>t.ch).join("").replace(/\\s+/g," ").trim().slice(0,48)||"Текст"}function kr(e){let t=getComputedStyle(e.el,"::first-letter"),n=getComputedStyle(e.el);if(t.fontSize===n.fontSize&&t.fontFamily===n.fontFamily&&t.color===n.color&&t.cssFloat==="none"&&t.fontWeight===n.fontWeight)return null;let r=Ee(e.el,e.el),o=T(t.fontSize),i=t.lineHeight==="normal"?o*1.2:/^[\\d.]+$/.test(t.lineHeight)?parseFloat(t.lineHeight)*o:T(t.lineHeight);i>0||(i=o*1.2);let s={...r,families:t.fontFamily.split(",").map(l=>l.trim().replace(/^[\'"]|[\'"]$/g,"")),size:o,weight:parseInt(t.fontWeight,10)||400,italic:t.fontStyle.startsWith("italic"),color:_(t.color)??r.color,lineHeight:i,letterSpacing:t.letterSpacing==="normal"?0:T(t.letterSpacing),transform:t.textTransform};return y.stats.firstLetters=(y.stats.firstLetters??0)+1,{st:s,count:1}}var En=0,Z=()=>"n"+(En++).toString(36);function bt(e,t=1){return e.a*t<=0?null:{type:"SOLID",color:{r:e.r,g:e.g,b:e.b},opacity:Math.min(1,e.a*t)}}function se(e){let t=[],n=0,r="";for(let o of e){if(o==="("&&n++,o===")"&&n--,o===","&&n===0){t.push(r.trim()),r="";continue}r+=o}return t.push(r.trim()),t}function Te(e,t){e=e.trim();let n=/^calc\\((.*)\\)$/.exec(e);if(n){let r=0,o=/([+-]?)\\s*([\\d.]+)(%|px)/g,i;for(;i=o.exec(n[1]);)r+=(i[1]==="-"?-1:1)*(i[3]==="%"?parseFloat(i[2])/100*t:parseFloat(i[2]));return r}return e.endsWith("%")?parseFloat(e)/100*t:parseFloat(e)||0}function vn(e,t,n,r){let o=[],i=[],s=parseFloat(e["border-left-width"])||0,l=parseFloat(e["border-top-width"])||0,c=parseFloat(e["border-right-width"])||0,a=parseFloat(e["border-bottom-width"])||0,u=T(e["padding-left"]),f=T(e["padding-top"]),h=T(e["padding-right"]),m=T(e["padding-bottom"]),g=_(e["background-color"]);e["background-color"]&&!g&&N("warn","color-parse",`Нераспознанный цвет фона: ${e["background-color"]}`,r);let R=E=>E==="padding-box"?{x:s,y:l,w:t-s-c,h:n-l-a}:E==="content-box"?{x:s+u,y:l+f,w:t-s-c-u-h,h:n-l-a-f-m}:{x:0,y:0,w:t,h:n},p=se(e["background-clip"]);if(g&&g.a>0){let E=R(p[p.length-1]??"border-box");E.x<.5&&E.y<.5&&Math.abs(E.w-t)<.5&&Math.abs(E.h-n)<.5?o.push(bt(g)):E.w>0&&E.h>0&&i.push({kind:"rect",id:Z(),name:"Фон",m:Y(E.x,E.y),w:E.w,h:E.h,fills:[bt(g)]})}let b=e["background-image"];if(!b||b==="none")return{fills:o,under:i};let w=se(b),M=se(e["background-size"]),S=se(e["background-position-x"]),d=se(e["background-position-y"]),v=se(e["background-repeat"]),k=se(e["background-origin"]),$=se(e["background-blend-mode"]),L=se(e["background-attachment"]),x=(E,F)=>E[F%E.length],C=[];for(let E=w.length-1;E>=0;E--){let F=w[E];if(F==="none")continue;x(L,E)==="fixed"&&N("info","bg-fixed","background-attachment: fixed перенесён как обычный фон",r);let W=x(k,E),A=W==="border-box"?{x:0,y:0,w:t,h:n}:W==="content-box"?{x:s+u,y:l+f,w:t-s-c-u-h,h:n-l-a-f-m}:{x:s,y:l,w:t-s-c,h:n-l-a},I=R(x(p,E));if(A.w<=0||A.h<=0||I.w<=0||I.h<=0)continue;let z=ut[x($,E)]??"NORMAL",K=Xe(F),Q=x(M,E).split(/\\s+/),ne=x(v,E).split(/\\s+/),U=ne[0],j=ne[1]??(ne[0]==="repeat-x"?"no-repeat":ne[0]==="repeat-y"?"repeat":ne[0]),X=U==="repeat-x"?"repeat":U==="repeat-y"?"no-repeat":U,O=U==="repeat-x"?"no-repeat":U==="repeat-y"?"repeat":j,H={w:A.w,h:A.h},te=!1;if(K.length===1&&F.startsWith("url(")){let G=y.bgSizes.get(K[0]);G&&G.w>0&&G.h>0&&(H=G,te=!0)}let P,B;if(Q[0]==="cover"||Q[0]==="contain"){let G=Q[0]==="cover"?Math.max(A.w/H.w,A.h/H.h):Math.min(A.w/H.w,A.h/H.h);P=H.w*G,B=H.h*G}else{let G=Q[0]??"auto",ae=Q[1]??"auto";P=G==="auto"?NaN:Te(G,A.w),B=ae==="auto"?NaN:Te(ae,A.h),Number.isNaN(P)&&Number.isNaN(B)?(P=te?H.w:A.w,B=te?H.h:A.h):Number.isNaN(P)?P=te?B*H.w/H.h:A.w:Number.isNaN(B)&&(B=te?P*H.h/H.w:A.h)}if(!(P>0)||!(B>0))continue;let J=A.x+Te(x(S,E).replace(/^(left|right)\\s+/,""),A.w-P),ee=A.y+Te(x(d,E).replace(/^(top|bottom)\\s+/,""),A.h-B),kt=/^(repeating-)?(linear|radial|conic)-gradient\\(/.test(F),Mt=Math.abs(P-A.w)<.5&&Math.abs(B-A.h)<.5&&Math.abs(J-A.x)<.5&&Math.abs(ee-A.y)<.5;if(kt&&!F.startsWith("repeating")&&(Mt||X==="no-repeat"&&O==="no-repeat")){let G=Kt(F,P,B);if(G.paint&&G.paint.type!=="IMAGE"&&G.paint.type!=="SOLID"){(G.approx.includes("conic")||G.approx.includes("color-interpolation-space")||G.approx.includes("color-hint"))&&N("info","gradient-approx","Градиент перенесён приближённо: "+G.approx.join(", "),r);let ae=[t/P,0,0,n/B,-J/P,-ee/B],re={...G.paint,transform:q(G.paint.transform,ae),blend:z!=="NORMAL"?z:void 0};if((Mt||J<=I.x+.5&&ee<=I.y+.5&&J+P>=I.x+I.w-.5&&ee+B>=I.y+I.h-.5)&&I.x<.5&&I.y<.5&&Math.abs(I.w-t)<.5&&Math.abs(I.h-n)<.5){C.unshift(re);continue}let le=Math.max(I.x,J),ce=Math.max(I.y,ee),Ze=Math.min(I.x+I.w,J+P),Ae=Math.min(I.y+I.h,ee+B);if(Ze-le>.1&&Ae-ce>.1){let Ie=Ze-le,Et=Ae-ce,$n=[Ie/P,0,0,Et/B,(le-J)/P,(ce-ee)/B];i.push({kind:"rect",id:Z(),name:"Градиент фона",m:Y(le,ce),w:Ie,h:Et,fills:[{...G.paint,transform:q(G.paint.transform,$n)}]})}continue}}if(!kt&&K.length===1&&F.startsWith("url(")){let G=K[0],ae=pe("url:"+G,{kind:"url",url:G,purpose:"bg"});if(X==="no-repeat"&&O==="no-repeat"){let re=Math.max(I.x,J),ge=Math.max(I.y,ee),le=Math.min(I.x+I.w,J+P),ce=Math.min(I.y+I.h,ee+B);if(le-re<=.1||ce-ge<=.1)continue;if(re<=.5&&ge<=.5&&le>=t-.5&&ce>=n-.5)C.unshift({type:"IMAGE",asset:ae,scaleMode:"CROP",imageTransform:[t/P,0,0,n/B,-J/P,-ee/B],opacity:1,blend:z!=="NORMAL"?z:void 0});else{let Ae=le-re,Ie=ce-ge;i.push({kind:"rect",id:Z(),name:"Изображение фона",m:Y(re,ge),w:Ae,h:Ie,fills:[{type:"IMAGE",asset:ae,scaleMode:"CROP",imageTransform:[Ae/P,0,0,Ie/B,(re-J)/P,(ge-ee)/B],opacity:1}]})}continue}if(X==="repeat"&&O==="repeat"&&te){let re=Math.abs(P/H.w-B/H.h)<.01;(Math.abs(J-A.x)>.5||Math.abs(ee-A.y)>.5)&&N("info","tile-offset","Смещение плитки фона (background-position) не переносится в Figma TILE",r),re||N("info","tile-aspect","Неравномерное масштабирование плитки фона перенесено приближённо",r),C.unshift({type:"IMAGE",asset:ae,scaleMode:"TILE",scalingFactor:P/H.w,opacity:1,blend:z!=="NORMAL"?z:void 0}),C[0].tileCss=P;continue}}let Rt={"background-image":F,"background-size":x(M,E),"background-position-x":x(S,E),"background-position-y":x(d,E),"background-repeat":x(v,E),"background-origin":W,"background-clip":x(p,E),"border-style":"solid","border-color":"transparent","border-width":`${l}px ${c}px ${a}px ${s}px`,padding:`${f}px ${h}px ${m}px ${u}px`,"box-sizing":"border-box"},Pn=pe("bg:"+JSON.stringify(Rt)+t+"x"+n,{kind:"bglayer",css:Rt,w:t,h:n});C.unshift({type:"IMAGE",asset:Pn,scaleMode:"CROP",imageTransform:fe,opacity:1,blend:z!=="NORMAL"?z:void 0}),y.stats.rasterBackgrounds=(y.stats.rasterBackgrounds??0)+1}return{fills:[...o,...C.reverse()],under:i}}function Mr(e,t,n,r){let i=["top","right","bottom","left"].map(u=>({w:parseFloat(e[`border-${u}-width`])||0,st:e[`border-${u}-style`],c:_(e[`border-${u}-color`])})).map(u=>u.st==="none"||u.st==="hidden"||!u.c||u.c.a<=0?{...u,w:0}:u),s=i.filter(u=>u.w>0);if(!s.length)return{extra:[]};let l=s.every(u=>u.c&&s[0].c&&Math.abs(u.c.r-s[0].c.r)<.002&&Math.abs(u.c.g-s[0].c.g)<.002&&Math.abs(u.c.b-s[0].c.b)<.002&&Math.abs(u.c.a-s[0].c.a)<.002&&u.st===s[0].st),c=s[0].st;if(["solid","dashed","dotted"].includes(c)||N("info","border-style",`Стиль рамки «${c}» перенесён сплошной линией`,t),l){let u=s[0].c,f=Math.max(...s.map(m=>m.w)),h=c==="dashed"?[f*3,f*3]:c==="dotted"?[f,f]:void 0;return{stroke:{color:{r:u.r,g:u.g,b:u.b},opacity:u.a,weights:i.map(m=>m.w),align:"INSIDE",dash:h},extra:[]}}N("info","border-sides","Рамка с разными цветами сторон перенесена отдельными линиями (скругление сторон не повторяется)",t);let a=[];return i.forEach((u,f)=>{if(u.w<=0||!u.c)return;let h=[[0,0,n,u.w],[n-u.w,0,u.w,r],[0,r-u.w,n,u.w],[0,0,u.w,r]][f];a.push({kind:"rect",id:Z(),name:`Рамка ${["сверху","справа","снизу","слева"][f]}`,m:Y(h[0],h[1]),w:h[2],h:h[3],fills:[bt(u.c)]})}),{extra:a}}function Rr(e,t,n,r){let o=["border-top-left-radius","border-top-right-radius","border-bottom-right-radius","border-bottom-left-radius"].map(s=>Zt(e[s]||"0",t,n));if(o.every(([s,l])=>s<=0&&l<=0))return{ellipse:!1};let i=Qt(o,t,n);return i.elliptical&&!i.ellipse&&N("info","elliptical-radius","Эллиптические радиусы углов перенесены круговыми (меньшая полуось)",r),{r:i.radii,ellipse:i.ellipse}}function Tn(e,t,n){let r=e.s,o=D(e.el)+(e.pseudo?"::"+e.pseudo:""),i=r.visibility!=="visible",s={fills:[],under:[],extra:[],effects:[],ellipse:!1,rasterReasons:[]},l=parseFloat(r.opacity);Number.isFinite(l)&&l<1&&(s.opacity=Math.max(0,l));let c=ut[r["mix-blend-mode"]];if(c&&c!=="NORMAL"&&(s.blend=c),i)return s;let a=/(^|,\\s*)text(\\s*,|$)/.test(r["background-clip"]),u=vn(a?{...r,"background-clip":r["background-clip"].replace(/\\btext\\b/g,"border-box")}:r,t,n,o);a?s.textFills=u.fills.filter(d=>d.type!=="SOLID"||d.opacity>0):(s.fills=u.fills,s.under=u.under);let f=Mr(r,o,t,n);s.stroke=f.stroke,s.extra=f.extra;let h=Rr(r,t,n,o);s.radius=h.r,s.ellipse=h.ellipse;let m=Me(r["box-shadow"])??[];r["box-shadow"]!=="none"&&!Me(r["box-shadow"])&&N("warn","shadow-parse","Нераспознанная тень: "+r["box-shadow"].slice(0,80),o);let g=m;if(!s.stroke){let d=m.find(v=>v.inset&&v.blur===0&&v.x===0&&v.y===0&&v.spread>0&&v.color.a>0);d&&(s.stroke={color:{r:d.color.r,g:d.color.g,b:d.color.b},opacity:d.color.a,weights:[d.spread,d.spread,d.spread,d.spread],align:"INSIDE"},g=m.filter(v=>v!==d))}s.effects=lt(g);let R=ct(r.filter);R.blur>0&&s.effects.push({type:"LAYER_BLUR",radius:R.blur*2});for(let d of R.dropShadows)s.effects.push({type:"DROP_SHADOW",color:d.color,x:d.x,y:d.y,blur:d.blur,spread:0});let p=R.color.filter(d=>!Jt(d));p.length&&(s.colorFilter=p.join(" ")),R.other.length&&s.rasterReasons.push("filter: "+R.other.join(" "));let b=ct(r["backdrop-filter"]);b.blur>0&&s.effects.push({type:"BACKGROUND_BLUR",radius:b.blur*2}),(b.color.length||b.other.length)&&N("info","backdrop","backdrop-filter кроме blur() не переносится",o),r["clip-path"]&&r["clip-path"]!=="none"&&(/^circle\\(50%( at 50% 50%)?\\)$/.exec(r["clip-path"])&&Math.abs(t-n)<.5?s.radius=[t/2,t/2,t/2,t/2]:s.rasterReasons.push("clip-path: "+r["clip-path"].slice(0,60))),(r["mask-image"]!=="none"&&r["mask-image"]?r["mask-image"]:r["-webkit-mask-image"]!=="none"&&r["-webkit-mask-image"])&&s.rasterReasons.push("mask-image"),r["border-image-source"]&&r["border-image-source"]!=="none"&&s.rasterReasons.push("border-image");let M=T(r["outline-width"]),S=_(r["outline-color"]);if(r["outline-style"]!=="none"&&M>0&&S&&S.a>0){let d=T(r["outline-offset"]);s.extra.push({kind:"rect",id:Z(),name:"Контур (outline)",m:Y(-d,-d),w:t+2*d,h:n+2*d,fills:[],stroke:{color:{r:S.r,g:S.g,b:S.b},opacity:S.a,weights:[M,M,M,M],align:"OUTSIDE"}})}return s}function Er(e,t){return e.effects.some(r=>(r.type==="DROP_SHADOW"||r.type==="INNER_SHADOW")&&r.spread!==0)?!(e.fills.some(r=>r.opacity>0)&&t):!1}function Ce(e){let t=e.s,n=t["z-index"]==="auto"?0:parseInt(t["z-index"],10)||0,r=t.position!=="static",o=e.parent?/flex|grid/.test(e.parent.s.display):!1,i=r||o,s;return i&&n<0?s=0:i&&n>0?s=5:r||e.sc?s=4:t.float!=="none"?s=2:/^inline/.test(t.display)||e.replaced||e.pseudo&&t.display==="inline"?s=3:s=1,[s,i?n:0,e.order]}function Sn(e,t){if(t.s.position!=="absolute"&&t.s.position!=="fixed")return!0;if(t.cb==="viewport")return!1;for(let n=t.cb;n;n=n.parent)if(n===e)return!0;return!1}var He=new Map;function vr(){He.clear();for(let e of y.recs){if(e.kind!=="box")continue;let t=e.parent;if(e.fixed)t=null;else if((e.s.position==="absolute"||e.s.position==="fixed")&&e.cb!=="viewport"){let o=!1;for(let i=e.parent;i&&i!==e.cb;i=i.parent)(Se(i.s)||i.replaced)&&(Sn(i,e)||(o=!0));o&&(t=e.cb)}let n=Ce(e);if((n[0]===0||n[0]===5)&&t&&!t.sc){let o=t,i=!0;for(;o&&!o.sc;){if(Se(o.s)&&Sn(o,e)){i=!1;break}if(me(o.s))break;o=o.parent}i&&o!==t&&(t=o,y.stats.zHoisted=(y.stats.zHoisted??0)+1)}e.figmaParent=t;let r=He.get(t)??[];r.push(e),He.set(t,r)}}function Tr(e){let t=e.layout,n=e.figmaParent?.layout,r=Y(t.x-(n?n.x:0),t.y-(n?n.y:0));if(!me(e.s))return r;let o=Ut({transform:e.s.transform,translate:e.s.translate,rotate:e.s.rotate,scale:e.s.scale,origin:e.s["transform-origin"],width:t.w,height:t.h});return o?(o.unsupported.length&&(e.tfUnsupported=o.unsupported,N("warn","transform-3d",`3D/перспективное преобразование (${o.unsupported.join(", ")}) перенесено как плоское`,D(e.el))),q(r,o.m)):(N("warn","transform-parse","Нераспознанный transform: "+e.s.transform,D(e.el)),r)}var yt=new Map;function Ke(e){if(!e)return fe;let t=yt.get(e);if(t)return t;let n=q(Ke(e.figmaParent),e.m);return yt.set(e,n),n}function Cn(e,t,n){let r=e.runs.map(f=>({start:f.start,end:f.end,font:f.font.key,size:f.st.size,color:f.st.color,letterSpacing:f.st.letterSpacing,decoration:f.st.decoration,decorationColor:f.st.decorationColor,decorationStyle:f.st.decoration?f.st.decorationStyle:void 0,decorationThickness:f.st.decoration?f.st.decorationThickness:void 0,link:f.st.link}));for(let f of e.runs)f.st.overline&&N("info","overline","Надчёркивание (overline) не поддерживается Figma",n),f.st.smallCaps&&N("info","small-caps","Капитель (font-variant-caps) не переносится",n),f.st.wordSpacing&&N("info","word-spacing","word-spacing учтён позициями строк, но в Figma не задаётся",n),f.st.gradientText&&N("info","gradient-text","Текст с background-clip:text перенесён сплошным цветом",n),f.font.synthetic&&N("warn","synthetic-font",`Браузер синтезировал начертание (${f.font.synthetic.join(", ")}) для ${f.font.family}; в Figma используется реальное начертание ${f.font.weight}`,n);let o=e.runs[0].st,i=[],s=xn(o);s&&s.length&&i.push(...lt(s));let l=Y(e.x-t.x,e.y-t.y),c=e.w,a=e.h;e.vertical&&(l=[0,1,-1,0,e.x-t.x+e.h,e.y-t.y],c=e.w,a=e.h);let u={kind:"text",id:Z(),name:e.name,src:n,m:l,w:c,h:a,text:e.text,runs:r,lineHeight:e.lineHeight,align:e.align,lines:e.lines,truncate:e.truncate,effects:i.length?i:void 0,textStroke:o.stroke};return e.fixedWidth&&(u.w=e.fixedWidth),u}function ve(e,t){let n=e.aabbA;if(n.w<1||n.h<1)return null;let r="s"+y.shots++;e.el.setAttribute("data-h2f-shot",r);let o=pe("shot:"+r,{kind:"shot",rect:[n.x,n.y,n.w,n.h],mark:r,reason:t});N("info","rasterized",`Элемент растрирован: ${t}`,D(e.el)),y.stats.rasterized=(y.stats.rasterized??0)+1;let i=e.layout,s=$e(Ke(e.figmaParent))??fe,[l,c]=[s[0]*n.x+s[2]*n.y+s[4],s[1]*n.x+s[3]*n.y+s[5]];return{kind:"image",id:Z(),name:`Растр · ${D(e.el)}`,src:D(e.el),m:Y(l,c),w:n.w,h:n.h,asset:o,scaleMode:"FILL",tags:["raster"]}}function An(e){return e.texts.length||e.pseudoText&&e.pseudoText.trim()?!0:e.children.some(An)||e.inlines.length>0&&e.items.some(t=>t.kind==="text"&&/\\S/.test(t.node.data))}function xt(e){let t=e.layout;if(!t)return null;let n=D(e.el)+(e.pseudo?"::"+e.pseudo:"");e.m=Tr(e);let r=t.w,o=t.h,i=Tn(e,r,o),s=()=>{let p=e.aabbA;return p&&!e.pseudo?[p.x,p.y,p.w,p.h]:void 0},l={id:Z(),src:n,m:e.m,w:r,h:o,opacity:i.opacity,blend:i.blend,scroll:e.fixed?"fixed":e.sticky?"sticky":void 0,tags:e.hoverCard?["hover-card"]:void 0},c=e.pseudo?`::${e.pseudo}`:Cr(e),a=[...i.rasterReasons,...e.tfUnsupported?.includes("perspective")?["перспектива"]:[]];if(a.length&&y.opts.rasterUnsupported&&!e.pseudo&&!An(e)){let p=ve(e,a.join("; "));if(p)return p}else a.length&&N("warn","unsupported-effect",`Эффект не перенесён (элемент содержит текст и остаётся редактируемым): ${a.join("; ")}`,n);if(e.replaced==="IMG")return Nr(e,l,i,c);if(e.replaced==="SVG")return Lr(e,l,i,c);if(e.replaced==="CANVAS"){let p="";try{p=e.el.toDataURL("image/png")}catch{}if(p&&p.length>30){let b=pe("canvas:"+e.id,{kind:"dataurl",data:p});return N("info","canvas","Canvas перенесён растровым изображением",n),{kind:"image",...l,name:"Canvas",asset:b,scaleMode:"FILL",radius:i.radius,tags:["raster"]}}return ve(e,"canvas (защищён CORS — снимок области)")}if(e.replaced==="VIDEO"){let p=e.el.poster;if(p){let b=pe("url:"+p,{kind:"url",url:p,purpose:"poster"});return N("info","video","Видео перенесено постером",n),{kind:"image",...l,name:"Видео (постер)",asset:b,scaleMode:"CROP",imageTransform:fe,radius:i.radius}}return ve(e,"видео (кадр)")}if(e.replaced==="IFRAME"||e.replaced==="EMBED"||e.replaced==="OBJECT")return ve(e,"встроенный документ "+e.replaced.toLowerCase());if(e.replaced==="METER"||e.replaced==="PROGRESS")return ve(e,"системный элемент "+e.replaced.toLowerCase());if((e.replaced==="INPUT"||e.replaced==="SELECT")&&e.s.appearance!=="none"){let p=e.el.type;if((e.replaced==="SELECT"||["checkbox","radio","range","color","file","date","time","datetime-local","month","week","button","submit","reset","image"].includes(p))&&!["button","submit","reset"].includes(p))return ve(e,"системный элемент формы "+(p||e.replaced.toLowerCase()))}let u=[],f=[];for(let p of He.get(e)??[])f.push({key:Ce(p),make:()=>{let b=xt(p);return b?[b]:[]}});for(let p of e.inlines)p.frags?.length&&f.push({key:[3,0,p.order],make:()=>Ar(p,t)});for(let p of e.texts)f.push({key:[3,0,e.textOrder??e.order],make:()=>{let b=Cn(p,t,n);if(i.textFills?.length){let w=p.x-t.x,M=p.y-t.y,S=[p.w/r,0,0,p.h/o,w/r,M/o];b.fills=i.textFills.map(d=>d.type==="SOLID"?d:d.type==="IMAGE"?{...d,imageTransform:q(d.imageTransform??fe,S)}:{...d,transform:q(d.transform,S)})}return[b]}});e.pseudo&&e.pseudoText&&e.pseudoText.trim()&&e.s.visibility==="visible"&&f.push({key:[3,0,e.order],make:()=>Ir(e,t)}),(e.replaced==="INPUT"||e.replaced==="TEXTAREA"||e.replaced==="SELECT")&&f.push({key:[3,0,e.order],make:()=>Fr(e,t)}),f.sort((p,b)=>p.key[0]-b.key[0]||p.key[1]-b.key[1]||p.key[2]-b.key[2]);for(let p of f)u.push(...p.make());let h=Se(e.s)||e.replaced==="INPUT"||e.replaced==="TEXTAREA"||e.replaced==="SELECT";h&&e.el instanceof HTMLElement&&(e.el.scrollHeight>e.el.clientHeight+2||e.el.scrollWidth>e.el.clientWidth+2)&&/auto|scroll/.test(e.s["overflow-y"]+e.s["overflow-x"])&&N("info","inner-scroll","Внутренняя прокрутка перенесена как обрезанный контейнер в начальной позиции",n);let m=i.fills.length||i.under.length||i.stroke||i.extra.length||i.effects.length;if(!u.length&&!m&&!e.hoverCard||r<=.01&&o<=.01&&!u.length)return null;if(i.colorFilter&&N("info","color-filter",`CSS filter (${i.colorFilter}) не переносится на интерфейсные элементы`,n),i.ellipse&&!u.length)return{kind:"ellipse",...l,name:c,fills:i.fills,stroke:i.stroke,effects:i.effects.length?i.effects:void 0,expect:s()};if(!u.length&&!i.under.length&&!i.extra.length&&!h&&(e.pseudo||!e.hoverCard))return{kind:"rect",...l,name:c,fills:i.fills,stroke:i.stroke,radius:i.radius,effects:i.effects.length?i.effects:void 0,expect:s()};let g={kind:"frame",...l,name:c,fills:i.fills,stroke:i.stroke,radius:i.radius,clip:h,effects:i.effects.length?i.effects:void 0,children:[],expect:s()},R=[...i.under];if(Er(i,h)&&(R.unshift({kind:"rect",id:Z(),name:"Фон и тень",m:fe,w:r,h:o,fills:i.fills.length?i.fills:[{type:"SOLID",color:{r:1,g:1,b:1},opacity:0}],radius:i.radius,effects:i.effects}),g.fills=[],g.effects=void 0),g.children=[...R,...u,...i.extra],e.hoverCard&&y.opts.cursor&&y.hoverPoint){let p=$e(Ke(e));if(p){let[b,w]=[p[0]*y.hoverPoint[0]+p[2]*y.hoverPoint[1]+p[4],p[1]*y.hoverPoint[0]+p[3]*y.hoverPoint[1]+p[5]],M=pe("cursor",{kind:"cursor"});g.children.push({kind:"svg",id:Z(),name:"Курсор (можно удалить)",m:Y(b,w),w:14,h:21,asset:M,clip:!1,tags:["cursor"]})}}return g}function Cr(e){let t=e.el,n=t.tagName.toLowerCase(),r=t.getAttribute("aria-label"),o=(t.textContent??"").replace(/\\s+/g," ").trim().slice(0,30);return n==="button"||t.getAttribute("role")==="button"?`Кнопка «${r||o||"кнопка"}»`:n==="a"?`Ссылка «${r||o||t.getAttribute("href")||""}»`:n==="input"||n==="textarea"||n==="select"?`Поле ${D(t)}`:/^h[1-6]$/.test(n)?`${n.toUpperCase()} «${o}»`:D(t)}function Ar(e,t){let n=e.s,r=[];if(n.visibility!=="visible")return r;let o=e.frags;return o.forEach((i,s)=>{let l=Tn(e,i.w,i.h);if(!l.fills.length&&!l.stroke&&!l.effects.length)return;let c=l.radius;c&&o.length>1&&(c=[s===0?c[0]:0,s===o.length-1?c[1]:0,s===o.length-1?c[2]:0,s===0?c[3]:0]),r.push({kind:"rect",id:Z(),name:`Фон ${D(e.el)}`,src:D(e.el),m:Y(i.x-t.x,i.y-t.y),w:i.w,h:i.h,fills:l.fills,stroke:l.stroke,radius:c,effects:l.effects.length?l.effects:void 0,opacity:l.opacity})}),r}function wt(e,t,n,r,o,i,s,l){if(!e)return[];let c=Array.from(e),a=[],u=0;for(let m of c){let g=mt(t,m),R=a[a.length-1];R&&R.font===g?R.end+=m.length:a.push({start:u,end:u+m.length,st:t,font:g}),u+=m.length}let f=t.lineHeight,h={x:n,y:r,w:i,h:f*e.split(`\n`).length,text:e,runs:a,lineHeight:f,align:o,lines:e.split(`\n`).length,name:s};return[Cn(h,l,s)]}function Ir(e,t){let n=e.s,r=Ee(e.el,e.el),o=e.pseudo==="marker"?getComputedStyle(e.el,"::marker"):getComputedStyle(e.el,"::"+e.pseudo),i=T(o.fontSize),s=o.lineHeight==="normal"?i*1.2:/^[\\d.]+$/.test(o.lineHeight)?parseFloat(o.lineHeight)*i:T(o.lineHeight);s>0||(s=i*1.25);let l={...r,families:o.fontFamily.split(",").map(p=>p.trim().replace(/^[\'"]|[\'"]$/g,"")),size:i,weight:parseInt(o.fontWeight,10)||400,italic:o.fontStyle.startsWith("italic"),color:_(o.color)??r.color,lineHeight:s,letterSpacing:o.letterSpacing==="normal"?0:T(o.letterSpacing),transform:o.textTransform,decoration:void 0,link:void 0,shadow:o.textShadow},c=e.pseudoText;l.transform==="uppercase"&&(c=c.toLocaleUpperCase(l.lang));let a=T(n["padding-left"])+T(n["border-left-width"]),u=T(n["padding-top"])+T(n["border-top-width"]),f=t.w-a-T(n["padding-right"])-T(n["border-right-width"]),h=t.h-u-T(n["padding-bottom"])-T(n["border-bottom-width"]),m=t.y+u;/flex|grid/.test(n.display)&&/center/.test(o.alignItems+o.placeItems)?m=t.y+u+(h-s)/2:n.display==="inline"&&(m=t.y+(t.h-s)/2);let g="LEFT";/flex|grid/.test(n.display)&&/center/.test(o.justifyContent+o.placeItems)||n["text-align"]==="center"?g="CENTER":(n["text-align"]==="right"||n["text-align"]==="end")&&(g="RIGHT");let R=t.x+a;return wt(c,l,R,m,g,Math.max(1,f),`${e.pseudo==="marker"?"Маркер":"::"+e.pseudo} «${c.slice(0,20)}»`,t)}function Fr(e,t){let n=e.el,r=e.s,o="",i=Ee(n,n);if(e.replaced==="SELECT")o=n.selectedOptions?.[0]?.textContent?.trim()??"";else if(o=n.value??"",n.type==="password"&&(o="•".repeat(o.length)),!o&&n.placeholder){o=n.placeholder;let R=getComputedStyle(n,"::placeholder");i={...i,color:_(R.color)??i.color}}if(!o)return[];let s=T(r["padding-left"])+T(r["border-left-width"]),l=T(r["padding-top"])+T(r["border-top-width"]),c=t.w-s-T(r["padding-right"])-T(r["border-right-width"]),a=t.h-l-T(r["padding-bottom"])-T(r["border-bottom-width"]),u=i.lineHeight,f=e.replaced==="TEXTAREA";f&&N("info","textarea","Текст в textarea переносится по ширине средствами Figma",D(n));let h=f?t.y+l:t.y+l+(a-u)/2,m=r["text-align"]==="center"?"CENTER":r["text-align"]==="right"||r["text-align"]==="end"?"RIGHT":"LEFT",g=wt(f?o:o.replace(/\\n/g," "),i,t.x+s,h,m,Math.max(1,c),"Значение поля",t);return g[0]&&g[0].kind==="text"&&(g[0].w=Math.max(1,c),f?g[0].tags=["wrap"]:g[0].truncate=1),g}function Nr(e,t,n,r){let o=e.el,i=e.s,s=D(o),l=o.currentSrc||o.src,c=e.layout,a=T(i["padding-left"])+T(i["border-left-width"]),u=T(i["padding-top"])+T(i["border-top-width"]),f=c.w-a-T(i["padding-right"])-T(i["border-right-width"]),h=c.h-u-T(i["padding-bottom"])-T(i["border-bottom-width"]);if(!l||!o.complete||o.naturalWidth===0){N("warn","broken-image",`Изображение не загрузилось: ${l?l.slice(0,160):"(нет src)"}`,s);let z=o.alt?.trim(),K=[];if(z){let Q=Ee(o,o);K.push(...wt(z,{...Q,color:{r:.4,g:.4,b:.4,a:1}},c.x+4,c.y+4,"LEFT",Math.max(1,c.w-8),"Альтернативный текст",c))}return{kind:"frame",...t,name:`Нет изображения · ${s}`,fills:[{type:"SOLID",color:{r:.95,g:.95,b:.95},opacity:1}],stroke:{color:{r:.7,g:.7,b:.7},opacity:1,weights:[1,1,1,1],align:"INSIDE",dash:[4,4]},clip:!0,children:K,tags:["broken-image"]}}let m=o.naturalWidth,g=o.naturalHeight,R=i["object-fit"]||"fill",p=f,b=h;if(R==="contain"||R==="cover"||R==="none"||R==="scale-down"){let z=R==="cover"?Math.max(f/m,h/g):R==="contain"?Math.min(f/m,h/g):1;R==="scale-down"&&(z=Math.min(1,Math.min(f/m,h/g))),p=m*z,b=g*z}let w=(i["object-position"]||"50% 50%").split(/\\s+/),M=a+Te(w[0]??"50%",f-p),S=u+Te(w[1]??"50%",h-b),d=n.colorFilter,v=pe("url:"+l+"|"+(d??""),{kind:"url",url:l,filter:d,purpose:"img"});d&&(y.stats.bakedFilters=(y.stats.bakedFilters??0)+1);let k=Math.max(a,M),$=Math.max(u,S),L=Math.min(a+f,M+p),x=Math.min(u+h,S+b),C=L-k,E=x-$;if(C<=0||E<=0)return null;let F=[C/p,0,0,E/b,(k-M)/p,($-S)/b],W=k<.5&&$<.5&&Math.abs(C-c.w)<.5&&Math.abs(E-c.h)<.5,A=n.fills.length||n.stroke||n.under.length;if(W&&!n.under.length)return{kind:"image",...t,name:`Изображение ${o.alt?"«"+o.alt.slice(0,30)+"»":s}`,asset:v,scaleMode:"CROP",imageTransform:F,radius:n.radius,stroke:n.stroke,fills:n.fills.length?n.fills:void 0,effects:n.effects.length?n.effects:void 0,expect:e.aabbA?[e.aabbA.x,e.aabbA.y,e.aabbA.w,e.aabbA.h]:void 0};let I={kind:"image",id:Z(),name:"Изображение",m:Y(k,$),w:C,h:E,asset:v,scaleMode:"CROP",imageTransform:F};return{kind:"frame",...t,name:r,fills:n.fills,stroke:n.stroke,radius:n.radius,clip:!0,effects:n.effects.length?n.effects:void 0,children:[...n.under,I]}}function Lr(e,t,n,r){let o=e.svg,i=e.layout,s=e.s,l=D(e.el);if(!o||!e.svgContent||e.svgContent.w<=0||e.svgContent.h<=0)return null;let c=y.opts.svgMode,a=c==="raster"||c==="auto"&&o.reasons.length>0,u=pe("svg:"+o.markup,{kind:"svg",markup:o.markup,w:e.svgContent.w,h:e.svgContent.h,reasons:o.reasons,overflowVisible:o.overflowVisible,raster:a,externalImages:o.externalImages});a?(y.stats.svgRaster=(y.stats.svgRaster??0)+1,N("info","svg-raster",`SVG растрирован: ${o.reasons.join(", ")||"режим профиля"}`,l)):y.stats.svgVector=(y.stats.svgVector??0)+1;let f=T(s["padding-left"])+T(s["border-left-width"]),h=T(s["padding-top"])+T(s["border-top-width"]),m=!o.overflowVisible,g=n.fills.length||n.stroke||n.under.length||f>.01||h>.01||n.radius&&m,R={kind:"svg",id:Z(),name:g?"Рисунок SVG":`SVG ${l}`,src:l,m:Y(f,h),w:e.svgContent.w,h:e.svgContent.h,asset:u,clip:m,tags:a?["raster"]:void 0};return g?{kind:"frame",...t,name:r,fills:n.fills,stroke:n.stroke,radius:n.radius,clip:m&&!!n.radius,effects:n.effects.length?n.effects:void 0,children:[...n.under,R]}:{...R,...t,name:`SVG ${l}`,m:q(t.m,Y(f,h)),w:e.svgContent.w,h:e.svgContent.h,effects:n.effects.length?n.effects:void 0,expect:e.aabbA?[e.aabbA.x,e.aabbA.y,e.aabbA.w,e.aabbA.h]:void 0}}function In(){if(!y)throw new Error("capture not started");En=0,yt.clear();let e=0;for(let d of y.recs){if(d.pseudo||!d.aabbA)continue;let v=d.el.getBoundingClientRect(),k=Math.max(Math.abs(v.left+scrollX-d.aabbA.x),Math.abs(v.top+scrollY-d.aabbA.y),Math.abs(v.width-d.aabbA.w),Math.abs(v.height-d.aabbA.h));k>e&&(e=k)}e>.5&&N("warn","prep-shift",`Подготовка захвата сместила элементы до ${e.toFixed(1)} px`),vr();let t=(He.get(null)??[]).filter(d=>d.layout),n=t.filter(d=>!d.fixed).sort((d,v)=>{let k=Ce(d),$=Ce(v);return k[0]-$[0]||k[1]-$[1]||k[2]-$[2]}),r=t.filter(d=>d.fixed).sort((d,v)=>{let k=Ce(d),$=Ce(v);return k[1]-$[1]||k[2]-$[2]}),o=[];for(let d of n){let v=xt(d);v&&o.push(v)}let i=0;for(let d of r){let v=xt(d);v&&(o.push(v),i++)}let s=[];for(let d of y.recs){if(!d.m||!d.layout||!d.aabbA||d.pseudo||d.kind!=="box"||d.aabbA.w===0&&d.aabbA.h===0)continue;let[v,k,$,L]=_t(Ke(d),d.layout.w,d.layout.h),x=d.aabbA,C=v-x.x,E=k-x.y,F=$-x.w,W=L-x.h;Math.max(Math.abs(C),Math.abs(E),Math.abs(F),Math.abs(W))>1&&s.push({src:D(d.el),dx:+C.toFixed(2),dy:+E.toFixed(2),dw:+F.toFixed(2),dh:+W.toFixed(2)})}s.length&&N("warn","transform-mismatch",`Восстановленная геометрия ${s.length} элементов отличается от браузерной более чем на 1 px`);let l=document.documentElement,c=document.body,a=y.canvasBg==="html"?l:c??l,u=l.clientWidth,f=Math.max(l.scrollHeight,c?.scrollHeight??0),h=we(getComputedStyle(a)),m=vn({...h,"border-top-width":"0","border-left-width":"0","border-right-width":"0","border-bottom-width":"0","padding-top":"0","padding-left":"0","padding-right":"0","padding-bottom":"0"},u,f,"canvas"),g=m.fills.length?m.fills:[{type:"SOLID",color:{r:1,g:1,b:1},opacity:1}];m.fills.length&&!m.fills.some(d=>d.type==="SOLID"&&d.opacity>=1)&&g.unshift({type:"SOLID",color:{r:1,g:1,b:1},opacity:1}),o.unshift(...m.under);let R={},p=d=>{if(d.kind==="text")for(let v of d.runs){let k=R[v.font],$=d.text.slice(v.start,v.end);k&&(k.chars+=v.end-v.start,k.sample.length<40&&(k.sample+=$.slice(0,40-k.sample.length)))}d.kind==="frame"&&d.children.forEach(p)};for(let d of Pr())R[d.key]={family:d.family,generic:d.generic,weight:d.weight,italic:d.italic,source:d.source,variable:d.variable,synthetic:d.synthetic,chars:0,sample:""};o.forEach(p);for(let d of Object.keys(R))R[d].chars||delete R[d];let b=[],w=0;for(let[d,v]of je){let k="g"+w++;d.setAttribute("data-h2f-f",k),b.push({mark:k,generic:v.generic,chars:[...v.chars].join("")})}let M={};for(let[d,v]of y.assets)M[d]=v;let S={...y.stats,nodes:y.nodeCount,chars:y.chars.chars,fixed:i};return y.limitHit&&N("warn","node-limit",`Достигнут лимит элементов (${y.opts.maxNodes}); часть страницы не перенесена`),{url:location.href,title:document.title,viewport:{width:innerWidth,height:innerHeight},width:u,height:f,background:g,children:o,fixedCount:i,assets:M,fonts:R,genericMarks:b,diagnostics:[...y.diags.values()],stats:S,geometry:{maxShift:+e.toFixed(3),mismatches:s.slice(0,50)}}}function Pr(){return mn()}function Fn(){for(let e of["data-h2f-p","data-h2f-tf","data-h2f-f","data-h2f-shot"])for(let t of Array.from(document.querySelectorAll(`[${e}]`)))t.removeAttribute(e);y?.styleSheet?.remove(),y?.neutralSheet?.remove()}function Nn(e,t){let n="h2f-iso";if(document.getElementById(n)?.remove(),!t)return;let r=document.createElement("style");r.id=n,r.textContent=`html,body{background:transparent!important}html *,html *::before,html *::after{visibility:hidden!important}[data-h2f-shot="${e}"],[data-h2f-shot="${e}"] *,[data-h2f-shot="${e}"] *::before,[data-h2f-shot="${e}"] *::after{visibility:visible!important}`,document.documentElement.appendChild(r)}var Ln=new Map,he=[],Qe={card:null,point:null};function St(e){let t=e.filter(n=>{try{return document.querySelector(n),!0}catch{return!1}});return n=>t.some(r=>{try{return!!n.closest(r)}catch{return!1}})}var $r={version:1,settle:Ot,finishAnimations:xe,snapshotFixed:De,async scrollPass(e){let t=await Ht(e);return Ln=t.poses,{steps:t.steps,poses:t.poses.size,headerRestored:t.headerRestored}},links(e){return vt(St(e))},linkLabel:Je,fingerprint(e){return Tt(St(e))},installHoverPinning:Ge,uninstallHoverPinning:At,rewriteHoverSelector:Be,hoverCandidates(e){return he=It(St(e)),he.map(t=>({index:t.index,selector:t.selector,label:t.label,score:+t.score.toFixed(3),box:t.box.map(n=>+n.toFixed(1)),changes:t.changes}))},async pin(e,t){Le(),Qe={card:null,point:null};let n=null;if(t)try{n=document.querySelector(t)}catch{n=null}if(!n&&e!==null&&he[e]&&(n=he[e].el),!n)return null;let r=await Nt(n,D);return Qe={card:n,point:r.point},{...r,label:n.innerText?.replace(/\\s+/g," ").trim().slice(0,80)??""}},hoverSnapshot(e,t){let n=Qe.card;if(e)try{n=document.querySelector(e)}catch{}return!n&&t!==null&&he[t]&&(n=he[t].el),n?Lt(n):null},markCard(e,t){let n=null;if(e)try{n=document.querySelector(e)}catch{}return!n&&t!==null&&he[t]&&(n=he[t].el),n?(n.setAttribute("data-h2f-card",""),!0):!1},async begin(e){return kn(e,Ln,Qe)},neutral(e){Mn(e)},measure(e){return Rn(e),!0},finish:In,cleanup:Fn,shotIsolation:Nn};window.__H2F_KEY_PLACEHOLDER__=$r;})();\n'.replace(/__H2F_KEY_PLACEHOLDER__/g, key);
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
  const generic = /* @__PURE__ */ new Map();
  const named = new Set(Object.values(raw.fonts).filter((f) => f.family).map((f) => f.family.toLowerCase()));
  for (const m of raw.genericMarks) {
    const fonts2 = run.platform[m.mark] ?? [];
    const pick = fonts2.filter((f) => !f.isCustomFont && !named.has(f.familyName.toLowerCase())).sort((a, b) => b.glyphCount - a.glyphCount)[0] ?? fonts2.filter((f) => !named.has(f.familyName.toLowerCase()))[0];
    if (pick && !generic.has("@" + m.generic)) generic.set("@" + m.generic, pick.familyName);
  }
  const keyMap = /* @__PURE__ */ new Map();
  const fonts = /* @__PURE__ */ new Map();
  for (const [k, f] of Object.entries(raw.fonts)) {
    let family = f.family, source = f.source;
    if (!family && f.generic) {
      family = generic.get("@" + f.generic) ?? "";
      if (!family) {
        family = f.generic === "monospace" ? "Courier New" : f.generic === "serif" ? "Times New Roman" : "Arial";
        diags.push({ level: "warn", code: "generic-font", message: `Не удалось определить системный шрифт для «${f.generic}»; предполагается ${family}`, route });
      } else diags.push({ level: "info", code: "generic-font", message: `Универсальное семейство «${f.generic}» отрисовано браузером шрифтом ${family}`, route });
      source = "system";
    }
    const nk = fontKey(family, f.weight, f.italic);
    keyMap.set(k, nk);
    const have = fonts.get(nk);
    if (have) {
      have.chars += f.chars;
      continue;
    }
    fonts.set(nk, { key: nk, family, weight: f.weight, italic: f.italic, source, variable: f.variable, synthetic: f.synthetic, chars: f.chars, sample: f.sample, routes: [route] });
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
      const list = fromSelector ? r.selected : selectorMode || it.depth >= maxDepth ? [] : r.links;
      for (const l of list) {
        const c = classifyHref(l.href, r.finalUrl, base, ids, { download: l.download });
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
    const order = (r) => r.status === "ok" ? 0 : r.status === "duplicate" ? 1 : r.status === "anchor" ? 2 : 3;
    const discovered = [...routes.values()];
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
        const prefer = this.profile.hoverPrefer?.[key];
        let pick = typeof hoverChoice === "number" ? hoverChoice : cands.length && cands[0].score >= 0.5 ? 0 : null;
        let selector = null;
        if (hoverChoice === "auto" && prefer) selector = prefer;
        if (pick !== null && !cands[pick]) pick = null;
        if (pick === null && !selector) hover = { active: false, reason: cands.length ? "Подходящая карточка не выбрана (эффект слабый)" : "На странице нет элементов с эффектом наведения", candidates: cands };
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
        readSiteFile: (u) => this.mgr.site.readUrl(u),
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
  const allowedHosts = /* @__PURE__ */ new Set([`127.0.0.1:${cfg.port}`, `localhost:${cfg.port}`]);
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
  readUrl(url) {
    const f = this.resolve(url);
    if (!f) return null;
    try {
      return import_node_fs8.default.readFileSync(f);
    } catch {
      return null;
    }
  }
  resolve(url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    if (u.origin !== this.origin()) return null;
    const m = /^\/j\/([a-z0-9]+)\/(.*)$/.exec(u.pathname);
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
  const webDir = opts.webDir ?? [import_node_path9.default.join(here, "..", "web"), import_node_path9.default.join(here, "web")].find((d) => import_node_fs9.default.existsSync(import_node_path9.default.join(d, "index.html"))) ?? here;
  const server = createServer({ cfg, jobs, webDir: import_node_fs9.default.existsSync(import_node_path9.default.join(webDir, "web.js")) ? webDir : here });
  await new Promise((resolve, reject) => {
    server.once("error", (e) => {
      if (e.code === "EADDRINUSE") reject(Object.assign(new Error(`Порт ${cfg.port} уже занят — возможно, обработчик уже запущен в другом окне.`), { code: "EADDRINUSE" }));
      else reject(e);
    });
    server.listen(cfg.port, "127.0.0.1", () => resolve());
  });
  const stop = async () => {
    server.close();
    site.stop();
    for (const j of jobs.jobs.values()) await j.cancel();
    await closeBrowser();
  };
  return { cfg, site, jobs, server, stop };
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
    process.exitCode = 1;
    return;
  }
  const { cfg, stop } = started;
  console.log(` Адрес:            http://127.0.0.1:${cfg.port}`);
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
void main();
