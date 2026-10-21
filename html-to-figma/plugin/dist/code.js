(() => {
  // shared/schema.ts
  var PROTOCOL_VERSION = 1;
  var PLUGIN_DATA_KEY = "h2f";

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
  var styleItalic = (style) => /italic|oblique|kursiv/i.test(style);
  var KNOWN_SUFFIX = /^(?:(?:hairline|thin|extralight|ultralight|light|regular|normal|book|roman|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy)(?:italic|oblique)?|italic|oblique)$/;
  var norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
  function matchFigmaFont(req, available2, variableFamilies) {
    const names = [req.family, req.fileFamily].filter(Boolean).map((x) => norm(x));
    const faces = [];
    for (const f of available2) {
      const fam2 = norm(f.family);
      for (const base of names) {
        let suffix = null;
        if (fam2 === base) suffix = "";
        else if (fam2.startsWith(base + " ")) suffix = fam2.slice(base.length + 1);
        if (suffix === null) continue;
        if (suffix && !KNOWN_SUFFIX.test(suffix.replace(/[\s_-]/g, "").toLowerCase())) continue;
        faces.push({ font: f, style: (suffix + " " + f.style).trim(), exact: suffix === "" });
        break;
      }
    }
    if (!faces.length) return { key: req.key, font: null, exact: false, note: "семейство отсутствует" };
    const sameStyle = faces.filter((x) => styleItalic(x.style) === req.italic);
    const exact = sameStyle.filter((x) => styleWeight(x.style) === req.weight).sort((a, b) => Number(b.exact) - Number(a.exact) || a.style.length - b.style.length);
    if (exact.length) return { key: req.key, font: exact[0].font, exact: true };
    const fam = faces[0].font.family;
    if (variableFamilies && variableFamilies.has(fam) && sameStyle.length) {
      const base = sameStyle.sort((a, b) => Math.abs(styleWeight(a.style) - req.weight) - Math.abs(styleWeight(b.style) - req.weight))[0];
      return { key: req.key, font: base.font, variation: req.weight, exact: true, note: "вариативная ось wght" };
    }
    return { key: req.key, font: null, exact: false, note: `нет начертания ${req.weight}${req.italic ? " Italic" : ""} (есть: ${[...new Set(faces.map((f) => f.font.style))].join(", ")})` };
  }

  // shared/grid.ts
  var GRID_GAP = 200;
  function overlaps(a, b, eps = 0.1) {
    return a.x < b.x + b.width - eps && a.x + a.width > b.x + eps && a.y < b.y + b.height - eps && a.y + a.height > b.y + eps;
  }
  function layoutGrid(items, columns, gap = GRID_GAP) {
    const cols = Math.max(1, Math.min(24, Math.floor(columns) || 1));
    const colWidth = Math.max(0, ...items.map((i) => i.width));
    const out = [];
    let y = 0;
    for (let start = 0, row = 0; start < items.length; start += cols, row++) {
      const rowItems = items.slice(start, start + cols);
      rowItems.forEach((it, i) => out.push({ key: it.key, x: i * (colWidth + gap), y, slot: [i, row] }));
      y += Math.max(...rowItems.map((i) => i.height)) + gap;
    }
    return out;
  }
  function boundsOf(boxes) {
    if (!boxes.length) return null;
    const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.width)), y1 = Math.max(...boxes.map((b) => b.y + b.height));
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }
  function placeNewSet(items, columns, occupied, origin, gap = GRID_GAP) {
    const rel = layoutGrid(items, columns, gap);
    const existing = boundsOf(occupied);
    const ox = existing ? existing.x + existing.width + gap : origin.x;
    const oy = existing ? existing.y : origin.y;
    let placed = rel.map((p) => ({ ...p, x: p.x + ox, y: p.y + oy }));
    for (let guard = 0; guard < 50; guard++) {
      const hit = placed.some((p, i) => occupied.some((o) => overlaps({ x: p.x, y: p.y, width: items[i].width, height: items[i].height }, o)));
      if (!hit) break;
      const shift = (existing ? existing.width : 1e3) + gap;
      placed = placed.map((p) => ({ ...p, x: p.x + shift }));
    }
    return placed;
  }
  function placeIntoSet(item, slot, setOrigin, rowTops, colWidth, occupied, gap = GRID_GAP) {
    if (slot) {
      const x2 = setOrigin.x + slot[0] * (colWidth + gap);
      const y2 = setOrigin.y + (rowTops[slot[1]] ?? 0);
      if (!occupied.some((o) => overlaps({ x: x2, y: y2, width: item.width, height: item.height }, o))) return { x: x2, y: y2 };
    }
    const b = boundsOf(occupied) ?? { x: setOrigin.x, y: setOrigin.y, width: 0, height: 0 };
    let x = b.x + b.width + gap;
    const y = setOrigin.y;
    while (occupied.some((o) => overlaps({ x, y, width: item.width, height: item.height }, o))) x += item.width + gap;
    return { x, y };
  }

  // shared/matrix.ts
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
  function toFigmaTransform(m) {
    return [[m[0], m[2], m[4]], [m[1], m[3], m[5]]];
  }

  // shared/validate.ts
  var fin = (v) => typeof v === "number" && Number.isFinite(v);
  var unit = (v) => fin(v) && v >= 0 && v <= 1;
  function checkColor(c, path, out, alpha = true) {
    if (!c || !unit(c.r) || !unit(c.g) || !unit(c.b) || alpha && !unit(c.a)) out.push({ path, message: "неверный цвет" });
  }
  function checkPaints(ps, path, out, assets) {
    if (ps === void 0) return;
    if (!Array.isArray(ps)) {
      out.push({ path, message: "fills не массив" });
      return;
    }
    ps.forEach((p, i) => {
      const pp = `${path}.fills[${i}]`;
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
  function checkEffects(es, path, out) {
    es?.forEach((e, i) => {
      const pp = `${path}.effects[${i}]`;
      if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
        if (![e.x, e.y, e.blur, e.spread].every(fin) || e.blur < 0) out.push({ path: pp, message: "параметры тени" });
        checkColor(e.color, pp, out);
      } else if (e.type === "LAYER_BLUR" || e.type === "BACKGROUND_BLUR") {
        if (!(fin(e.radius) && e.radius >= 0)) out.push({ path: pp, message: "радиус размытия" });
      }
    });
  }
  function checkStroke(s, path, out) {
    if (!s) return;
    if (!s.weights.every((w) => fin(w) && w >= 0)) out.push({ path, message: "толщина обводки" });
    if (!unit(s.opacity)) out.push({ path, message: "opacity обводки" });
    checkColor({ ...s.color, a: 1 }, path, out);
    if (s.dash && !s.dash.every((d) => fin(d) && d >= 0)) out.push({ path, message: "dashPattern" });
  }
  function validateNode(n, path, out, ctx) {
    ctx.count.n++;
    if (!isFiniteMat(n.m)) out.push({ path, message: "матрица не конечна" });
    else if (!hasUnitAxes(n.m, 1e-4)) out.push({ path, message: "матрица содержит масштаб (оси не единичные)" });
    if (!(fin(n.w) && n.w >= 0 && fin(n.h) && n.h >= 0)) out.push({ path, message: `размер ${n.w}×${n.h}` });
    if (n.opacity !== void 0 && !unit(n.opacity)) out.push({ path, message: "opacity вне 0..1" });
    checkEffects(n.effects, path, out);
    switch (n.kind) {
      case "frame":
        checkPaints(n.fills, path, out, ctx.assets);
        checkStroke(n.stroke, path, out);
        if (n.radius && !n.radius.every((r) => fin(r) && r >= 0)) out.push({ path, message: "радиусы" });
        n.children.forEach((c, i) => validateNode(c, `${path}/${i}`, out, ctx));
        break;
      case "rect":
      case "ellipse":
        checkPaints(n.fills, path, out, ctx.assets);
        checkStroke(n.stroke, path, out);
        break;
      case "text": {
        if (typeof n.text !== "string" || !n.text.length) out.push({ path, message: "пустой текст" });
        if (!(fin(n.lineHeight) && n.lineHeight > 0)) out.push({ path, message: "lineHeight" });
        let pos = 0;
        for (const r of n.runs) {
          if (r.start !== pos || r.end <= r.start || r.end > n.text.length) {
            out.push({ path, message: `run ${r.start}-${r.end} не покрывает текст последовательно` });
            break;
          }
          pos = r.end;
          if (!ctx.fonts.has(r.font)) out.push({ path, message: `шрифт ${r.font} не объявлен` });
          if (!(fin(r.size) && r.size > 0)) out.push({ path, message: "размер шрифта" });
          if (!fin(r.letterSpacing)) out.push({ path, message: "letterSpacing" });
          checkColor(r.color, path, out);
        }
        if (pos !== n.text.length) out.push({ path, message: "runs не покрывают весь текст" });
        checkPaints(n.fills, path, out, ctx.assets);
        break;
      }
      case "image":
        if (!ctx.assets.has(n.asset)) out.push({ path, message: `нет ассета ${n.asset}` });
        checkPaints(n.fills, path, out, ctx.assets);
        break;
      case "svg":
        if (!ctx.assets.has(n.asset)) out.push({ path, message: `нет ассета ${n.asset}` });
        if (n.fallback && !ctx.assets.has(n.fallback)) out.push({ path, message: `нет запасного ассета ${n.fallback}` });
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

  // plugin/src/build.ts
  var clamp01 = (v) => Math.max(0, Math.min(1, v));
  function paint(p, ctx) {
    const blendMode = p.blend && p.blend !== "PASS_THROUGH" ? p.blend : void 0;
    if (p.type === "SOLID") {
      const s = { type: "SOLID", color: { r: clamp01(p.color.r), g: clamp01(p.color.g), b: clamp01(p.color.b) }, opacity: clamp01(p.opacity), ...blendMode ? { blendMode } : {} };
      return s;
    }
    if (p.type === "IMAGE") {
      const hash = ctx.images.get(p.asset);
      if (!hash) {
        ctx.warnings.push({ code: "image-missing", message: `Нет изображения ${p.asset}` });
        return null;
      }
      const ip = {
        type: "IMAGE",
        imageHash: hash,
        scaleMode: p.scaleMode,
        opacity: clamp01(p.opacity),
        ...p.scaleMode === "CROP" && p.imageTransform ? { imageTransform: toFigmaTransform(p.imageTransform) } : {},
        ...p.scaleMode === "TILE" && p.scalingFactor ? { scalingFactor: p.scalingFactor } : {},
        ...blendMode ? { blendMode } : {}
      };
      return ip;
    }
    const g = {
      type: p.type,
      gradientTransform: toFigmaTransform(p.transform),
      gradientStops: p.stops.map((s) => ({ position: clamp01(s.position), color: { r: clamp01(s.color.r), g: clamp01(s.color.g), b: clamp01(s.color.b), a: clamp01(s.color.a) } })),
      opacity: clamp01(p.opacity),
      ...blendMode ? { blendMode } : {}
    };
    return g;
  }
  function paints(list, ctx) {
    const out = [];
    for (const p of list ?? []) {
      const f = paint(p, ctx);
      if (f) out.push(f);
    }
    return out;
  }
  function effects(list) {
    const out = [];
    for (const e of list ?? []) {
      if (e.type === "DROP_SHADOW") out.push({ type: "DROP_SHADOW", color: { r: e.color.r, g: e.color.g, b: e.color.b, a: e.color.a }, offset: { x: e.x, y: e.y }, radius: Math.max(0, e.blur), spread: e.spread, visible: true, blendMode: "NORMAL", showShadowBehindNode: false });
      else if (e.type === "INNER_SHADOW") out.push({ type: "INNER_SHADOW", color: { r: e.color.r, g: e.color.g, b: e.color.b, a: e.color.a }, offset: { x: e.x, y: e.y }, radius: Math.max(0, e.blur), spread: e.spread, visible: true, blendMode: "NORMAL" });
      else out.push({ type: e.type, blurType: "NORMAL", radius: Math.max(0, e.radius), visible: true });
    }
    return out;
  }
  function applyStroke(n, s) {
    if (!s) return;
    n.strokes = [{ type: "SOLID", color: { r: s.color.r, g: s.color.g, b: s.color.b }, opacity: clamp01(s.opacity) }];
    n.strokeAlign = s.align;
    const [t, r, b, l] = s.weights;
    if (t === r && r === b && b === l) n.strokeWeight = t;
    else {
      n.strokeTopWeight = t;
      n.strokeRightWeight = r;
      n.strokeBottomWeight = b;
      n.strokeLeftWeight = l;
    }
    if (s.dash && s.dash.length) n.dashPattern = s.dash;
  }
  function applyRadius(n, r) {
    if (!r) return;
    n.topLeftRadius = r[0];
    n.topRightRadius = r[1];
    n.bottomRightRadius = r[2];
    n.bottomLeftRadius = r[3];
  }
  function applyCommon(node, ir, defaultBlend) {
    node.opacity = ir.opacity === void 0 ? 1 : clamp01(ir.opacity);
    node.blendMode = ir.blend ? ir.blend : defaultBlend;
    if (ir.visible === false) node.visible = false;
  }
  function place(node, ir, dx = 0) {
    let m = ir.m;
    if (!hasUnitAxes(m, 1e-4)) m = rotationOnly(m);
    const e = m[4] + m[0] * dx, f = m[5] + m[1] * dx;
    node.relativeTransform = [[m[0], m[2], e], [m[1], m[3], f]];
  }
  var size = (v) => Math.max(0.01, Number.isFinite(v) ? v : 0.01);
  function setExpect(node, ir) {
    if (ir.expect) node.setPluginData("e", ir.expect.join(","));
    if (ir.anchor) node.setPluginData("ea", ir.anchor.join(","));
  }
  async function buildText(parent, ir, ctx) {
    const t = figma.createText();
    parent.appendChild(t);
    t.name = ir.name;
    t.autoRename = false;
    const first = ir.runs[0];
    const f0 = ctx.fonts.get(first.font);
    if (!f0) throw new Error(`шрифт ${first.font} не загружен`);
    t.fontName = f0;
    t.fontSize = first.size;
    t.lineHeight = { unit: "PIXELS", value: ir.lineHeight };
    t.letterSpacing = { unit: "PIXELS", value: first.letterSpacing };
    t.fills = [{ type: "SOLID", color: { r: first.color.r, g: first.color.g, b: first.color.b }, opacity: clamp01(first.color.a) }];
    t.textAlignHorizontal = ir.align;
    t.textAlignVertical = "TOP";
    t.paragraphSpacing = 0;
    t.paragraphIndent = 0;
    t.characters = ir.text;
    for (const r of ir.runs) {
      const font = ctx.fonts.get(r.font);
      if (!font) throw new Error(`шрифт ${r.font} не загружен`);
      if (r !== first || ir.runs.length > 1) {
        if (font.family !== f0.family || font.style !== f0.style || JSON.stringify(font.variationSettings ?? null) !== JSON.stringify(f0.variationSettings ?? null)) t.setRangeFontName(r.start, r.end, font);
        if (r.size !== first.size) t.setRangeFontSize(r.start, r.end, r.size);
        if (r.letterSpacing !== first.letterSpacing) t.setRangeLetterSpacing(r.start, r.end, { unit: "PIXELS", value: r.letterSpacing });
        if (r.color.r !== first.color.r || r.color.g !== first.color.g || r.color.b !== first.color.b || r.color.a !== first.color.a) t.setRangeFills(r.start, r.end, [{ type: "SOLID", color: { r: r.color.r, g: r.color.g, b: r.color.b }, opacity: clamp01(r.color.a) }]);
      }
      if (r.decoration) {
        t.setRangeTextDecoration(r.start, r.end, r.decoration);
        if (r.decorationStyle && r.decorationStyle !== "SOLID") t.setRangeTextDecorationStyle(r.start, r.end, r.decorationStyle);
        if (r.decorationColor) t.setRangeTextDecorationColor(r.start, r.end, { value: { type: "SOLID", color: { r: r.decorationColor.r, g: r.decorationColor.g, b: r.decorationColor.b }, opacity: clamp01(r.decorationColor.a) } });
        if (r.decorationThickness) t.setRangeTextDecorationThickness(r.start, r.end, { unit: "PIXELS", value: r.decorationThickness });
      }
      if (r.link) {
        try {
          t.setRangeHyperlink(r.start, r.end, { type: "URL", value: r.link });
        } catch {
        }
      }
    }
    if (ir.fills?.length) {
      const f = paints(ir.fills, ctx);
      if (f.length) t.fills = f;
    }
    if (ir.textStroke && ir.textStroke.width > 0) {
      t.strokes = [{ type: "SOLID", color: { r: ir.textStroke.color.r, g: ir.textStroke.color.g, b: ir.textStroke.color.b }, opacity: clamp01(ir.textStroke.color.a) }];
      t.strokeWeight = ir.textStroke.width;
      t.strokeAlign = "CENTER";
    }
    applyCommon(t, ir, "PASS_THROUGH");
    if (ir.effects?.length) t.effects = effects(ir.effects);
    let dx = 0;
    if (ir.truncate) {
      t.textAutoResize = "NONE";
      t.resize(size(ir.w), size(ir.lineHeight * ir.truncate));
      t.textTruncation = "ENDING";
      if (ir.truncate > 1) t.maxLines = ir.truncate;
    } else if (ir.tags?.includes("wrap")) {
      t.textAutoResize = "HEIGHT";
      t.resize(size(ir.w), t.height);
    } else {
      t.textAutoResize = "WIDTH_AND_HEIGHT";
      const w = t.width;
      if (!Number.isFinite(w) || w <= 0) throw new Error("не удалось измерить текст");
      if (ir.align === "CENTER") dx = (ir.w - w) / 2;
      else if (ir.align === "RIGHT") dx = ir.w - w;
    }
    place(t, ir, dx);
    t.setPluginData("l", String(ir.lines));
    t.setPluginData("a", ir.align);
    return t;
  }
  function buildShape(parent, ir, ctx) {
    const n = ir.kind === "ellipse" ? figma.createEllipse() : figma.createRectangle();
    parent.appendChild(n);
    n.name = ir.name;
    n.resize(size(ir.w), size(ir.h));
    n.fills = paints(ir.fills, ctx);
    if (ir.kind === "rect") applyRadius(n, ir.radius);
    applyStroke(n, ir.stroke);
    if (ir.effects?.length) n.effects = effects(ir.effects);
    applyCommon(n, ir, "NORMAL");
    place(n, ir);
    return n;
  }
  function buildImage(parent, ir, ctx) {
    const n = figma.createRectangle();
    parent.appendChild(n);
    n.name = ir.name;
    n.resize(size(ir.w), size(ir.h));
    const hash = ctx.images.get(ir.asset);
    const under = paints(ir.fills, ctx);
    if (hash) {
      const p = { type: "IMAGE", imageHash: hash, scaleMode: ir.scaleMode, ...ir.scaleMode === "CROP" ? { imageTransform: toFigmaTransform(ir.imageTransform ?? [1, 0, 0, 1, 0, 0]) } : {} };
      n.fills = [...under, p];
    } else {
      n.fills = [...under, { type: "SOLID", color: { r: 0.93, g: 0.93, b: 0.93 } }];
      ctx.warnings.push({ code: "image-missing", message: "Изображение не передано в Figma — вставлена заглушка", node: ir.src });
    }
    applyRadius(n, ir.radius);
    applyStroke(n, ir.stroke);
    if (ir.effects?.length) n.effects = effects(ir.effects);
    applyCommon(n, ir, "NORMAL");
    place(n, ir);
    if (ir.tags?.includes("raster")) n.setPluginData("raster", "1");
    return n;
  }
  function buildSvg(parent, ir, ctx) {
    const markup = ctx.svgs.get(ir.asset);
    let n = null;
    if (markup) {
      try {
        n = figma.createNodeFromSvg(markup);
      } catch (e) {
        ctx.warnings.push({ code: "svg-import", message: `SVG не импортирован Figma: ${String(e.message ?? e).slice(0, 120)}`, node: ir.src });
      }
    }
    if (!n) {
      const hash = ir.fallback ? ctx.images.get(ir.fallback) : void 0;
      const r = figma.createRectangle();
      parent.appendChild(r);
      r.name = ir.name + (hash ? " (растр)" : " (нет SVG)");
      r.resize(size(ir.w), size(ir.h));
      r.fills = hash ? [{ type: "IMAGE", imageHash: hash, scaleMode: "FILL" }] : [];
      if (!hash) {
        r.strokes = [{ type: "SOLID", color: { r: 0.8, g: 0.5, b: 0.5 } }];
        r.dashPattern = [3, 3];
      }
      applyCommon(r, ir, "NORMAL");
      place(r, ir);
      return r;
    }
    parent.appendChild(n);
    n.name = ir.name;
    if (Math.abs(n.width - ir.w) > 0.01 || Math.abs(n.height - ir.h) > 0.01) n.resizeWithoutConstraints(size(ir.w), size(ir.h));
    n.clipsContent = ir.clip;
    n.fills = [];
    if (ir.effects?.length) n.effects = effects(ir.effects);
    applyCommon(n, ir, "PASS_THROUGH");
    place(n, ir);
    return n;
  }
  async function buildFrame(parent, ir, ctx) {
    const n = figma.createFrame();
    parent.appendChild(n);
    n.name = ir.name;
    n.layoutMode = "NONE";
    n.resizeWithoutConstraints(size(ir.w), size(ir.h));
    n.fills = paints(ir.fills, ctx);
    n.clipsContent = ir.clip;
    applyRadius(n, ir.radius);
    applyStroke(n, ir.stroke);
    if (ir.effects?.length) n.effects = effects(ir.effects);
    applyCommon(n, ir, "PASS_THROUGH");
    place(n, ir);
    for (const c of ir.children) await buildNode(n, c, ctx);
    return n;
  }
  async function buildNode(parent, ir, ctx) {
    ctx.checkCancel();
    let n;
    try {
      switch (ir.kind) {
        case "frame":
          n = await buildFrame(parent, ir, ctx);
          break;
        case "text":
          n = await buildText(parent, ir, ctx);
          break;
        case "rect":
        case "ellipse":
          n = buildShape(parent, ir, ctx);
          break;
        case "image":
          n = buildImage(parent, ir, ctx);
          break;
        case "svg":
          n = buildSvg(parent, ir, ctx);
          break;
        default:
          return null;
      }
    } catch (e) {
      const err = e;
      if (err.h2f) throw err;
      const wrapped = new Error(`Страница ${ctx.route}: ошибка при создании слоя «${ir.name}» (${ir.kind}${ir.src ? ", " + ir.src : ""}, id ${ir.id}): ${String(err.message ?? err).slice(0, 200)}`);
      wrapped.h2f = true;
      throw wrapped;
    }
    setExpect(n, ir);
    if (ir.scroll) n.setPluginData("scroll", ir.scroll);
    if (ir.tags?.length) n.setPluginData("tags", ir.tags.join(","));
    ctx.onNode?.(n, ir);
    if (++ctx.count % 150 === 0) await ctx.tick();
    return n;
  }
  async function buildRoute(snapshot, ctx, name, onRoot) {
    const root = figma.createFrame();
    onRoot?.(root);
    root.name = name;
    root.layoutMode = "NONE";
    root.resizeWithoutConstraints(size(snapshot.width), size(snapshot.height));
    root.fills = paints(snapshot.background, ctx);
    root.clipsContent = true;
    for (const c of snapshot.children) await buildNode(root, c, ctx);
    return root;
  }
  function fingerprint(root) {
    let h1 = 2166136261, h2 = 324508639, count = 0;
    const mix = (s) => {
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 16777619);
        h2 = Math.imul(h2 ^ c, 2246822519);
      }
    };
    const walk = (n) => {
      count++;
      mix(n.type + "|" + n.name + "|" + (n.visible ? 1 : 0));
      if ("x" in n) mix(n === root ? `${Math.round(n.width * 10)},${Math.round(n.height * 10)}` : `${Math.round(n.x * 10)},${Math.round(n.y * 10)},${Math.round(n.width * 10)},${Math.round(n.height * 10)}`);
      if (n.type === "TEXT") mix(n.characters);
      if ("fills" in n && n.fills !== figma.mixed) {
        try {
          mix(JSON.stringify(n.fills).slice(0, 400));
        } catch {
        }
      }
      if ("children" in n) for (const c of n.children) walk(c);
    };
    walk(root);
    return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16) + ":" + count;
  }

  // plugin/src/code.ts
  var post = (m) => figma.ui.postMessage(m);
  figma.showUI(__html__, { width: 480, height: 780, themeColors: true, title: "HTML → Figma" });
  var tickN = 0;
  var waiting = /* @__PURE__ */ new Map();
  function tick() {
    const n = ++tickN;
    return new Promise((res) => {
      waiting.set(n, res);
      post({ type: "tick", n });
    });
  }
  function registry(n) {
    if (n.type !== "FRAME") return null;
    const raw = n.getPluginData(PLUGIN_DATA_KEY);
    if (!raw) return null;
    try {
      const r = JSON.parse(raw);
      return r && r.v === PROTOCOL_VERSION && r.project && r.route ? r : null;
    } catch {
      return null;
    }
  }
  function roots(project) {
    const out = [];
    for (const n of figma.currentPage.children) {
      const reg = registry(n);
      if (reg && (!project || reg.project === project)) out.push({ node: n, reg });
    }
    return out;
  }
  function latestSet(project) {
    const all = roots(project);
    const bySet = /* @__PURE__ */ new Map();
    for (const r of all) {
      const l = bySet.get(r.reg.set) ?? [];
      l.push(r);
      bySet.set(r.reg.set, l);
    }
    let best = null, bestTime = "";
    for (const [s, l] of bySet) {
      const t = l.map((x) => x.reg.createdAt).sort().pop() ?? "";
      if (t >= bestTime) {
        best = s;
        bestTime = t;
      }
    }
    return best ? { set: best, items: bySet.get(best) } : null;
  }
  function summarize() {
    const bySet = /* @__PURE__ */ new Map();
    for (const { node, reg } of roots()) {
      const k = reg.project + "|" + reg.set;
      const s = bySet.get(k) ?? { project: reg.project, label: reg.label.split(" · ")[0], set: reg.set, source: reg.source, routes: [], createdAt: reg.createdAt };
      s.routes.push({ key: reg.route, label: node.name, id: node.id, edited: fingerprint(node) !== reg.fp, mode: reg.mode });
      if (reg.createdAt > s.createdAt) s.createdAt = reg.createdAt;
      bySet.set(k, s);
    }
    return [...bySet.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  function boxOf(n) {
    const b = n.absoluteBoundingBox;
    return b ? { x: b.x, y: b.y, width: b.width, height: b.height } : { x: n.x, y: n.y, width: n.width, height: n.height };
  }
  var job = null;
  var CancelError = class extends Error {
    constructor() {
      super("Создание отменено. Новые объекты этой попытки удалены.");
    }
  };
  async function rollback(j, reason) {
    let removed = 0;
    for (let i = j.created.length - 1; i >= 0; i--) {
      const n = j.created[i];
      try {
        if (!n.removed) {
          n.remove();
          removed++;
        }
      } catch {
      }
    }
    j.created = [];
    post({ type: "aborted", jobId: j.id, removed, reason });
    job = null;
  }
  var availableCache = null;
  async function available() {
    if (!availableCache) availableCache = await figma.listAvailableFontsAsync();
    return availableCache;
  }
  async function checkFonts(reqs, substitutions = {}) {
    const list = await available();
    const lite = list.map((f) => ({ family: f.fontName.family, style: f.fontName.style }));
    const variable = /* @__PURE__ */ new Set();
    const fams = [...new Set(lite.map((f) => f.family))];
    for (const r of reqs) {
      for (const fam of fams.filter((f) => f.toLowerCase() === r.family.toLowerCase())) {
        try {
          if (figma.getFontFamilyVariationAxes(fam)?.includes("wght")) variable.add(fam);
        } catch {
        }
      }
    }
    const results = reqs.map((r) => {
      const sub = substitutions[r.key];
      const m = matchFigmaFont(sub ? { ...r, family: sub, fileFamily: void 0 } : r, lite, variable);
      return { key: r.key, family: r.family, weight: r.weight, italic: r.italic, found: m.font ? { family: m.font.family, style: m.font.style, wght: m.variation } : null, note: sub ? `замена пользователем: ${sub}` + (m.note ? "; " + m.note : "") : m.note };
    });
    return { results, families: fams.sort() };
  }
  function plan(msg) {
    const existing = msg.mode === "copy" ? null : latestSet(msg.project);
    const set = existing && msg.mode !== "copy" ? existing.set : Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const j = {
      id: msg.jobId,
      project: msg.project,
      label: msg.projectLabel,
      source: msg.source,
      set,
      mode: msg.mode,
      columns: Math.max(1, Math.min(12, msg.columns || 4)),
      viewportMode: msg.viewportMode,
      created: [],
      replace: /* @__PURE__ */ new Map(),
      edited: /* @__PURE__ */ new Map(),
      positions: /* @__PURE__ */ new Map(),
      grid: { origin: { x: 0, y: 0 }, colWidth: 0, rowTops: [], slots: {} },
      order: /* @__PURE__ */ new Map(),
      fonts: /* @__PURE__ */ new Map(),
      images: /* @__PURE__ */ new Map(),
      svgs: /* @__PURE__ */ new Map(),
      cancel: false,
      busy: false,
      routes: new Map(msg.routes.map((r) => [r.key, r])),
      stats: { texts: 0, nodes: 0, warnings: 0 }
    };
    msg.routes.forEach((r, i) => j.order.set(r.key, i));
    const have = new Map((existing?.items ?? []).map((x) => [x.reg.route, x]));
    const build = [];
    const skip = [];
    for (const r of msg.routes) {
      const ex = have.get(r.key);
      if (!ex) {
        build.push(r);
        continue;
      }
      if (msg.mode === "missing") {
        skip.push({ key: r.key, reason: "уже есть в комплекте" });
        continue;
      }
      if (msg.mode === "update") {
        if (fingerprint(ex.node) === ex.reg.fp) j.replace.set(r.key, ex.node);
        else j.edited.set(r.key, ex.node);
        build.push(r);
      }
    }
    const replacedIds = new Set([...j.replace.values()].map((n) => n.id));
    const occupied = figma.currentPage.children.filter((n) => !replacedIds.has(n.id)).map(boxOf);
    const items = build.map((r) => ({ key: r.key, width: r.width, height: r.viewportHeight && msg.viewportMode ? r.viewportHeight : r.height }));
    if (!existing) {
      const vc = figma.viewport.center;
      const placed = placeNewSet(items, j.columns, occupied, { x: Math.round(vc.x - 720), y: Math.round(vc.y - 400) });
      const all = layoutGrid(items, j.columns);
      placed.forEach((p) => j.positions.set(p.key, { x: p.x, y: p.y, slot: p.slot }));
      if (placed.length) {
        const o = { x: placed[0].x - all[0].x, y: placed[0].y - all[0].y };
        const rowTops = [];
        const slots = {};
        for (const p of all) {
          rowTops[p.slot[1]] = p.y;
          slots[p.key] = p.slot;
        }
        j.grid = { origin: o, colWidth: Math.max(...items.map((i) => i.width)), rowTops, slots };
      }
    } else {
      const ref = existing.items[0];
      const g = ref.reg.grid;
      j.columns = ref.reg.columns || j.columns;
      j.grid = g ? { ...g, slots: { ...g.slots ?? {} } } : { origin: { x: ref.node.x, y: ref.node.y }, colWidth: ref.reg.width, rowTops: [0], slots: {} };
      const occ = [...occupied];
      for (const it of items) {
        const old = j.replace.get(it.key);
        if (old) {
          j.positions.set(it.key, { x: old.x, y: old.y, slot: registry(old)?.slot ?? [0, 0] });
          occ.push({ x: old.x, y: old.y, width: Math.max(it.width, old.width), height: Math.max(it.height, old.height) });
        }
      }
      for (const it of items) {
        if (j.replace.has(it.key)) continue;
        const slot = j.edited.has(it.key) ? null : j.grid.slots[it.key] ?? null;
        const pos = placeIntoSet(it, slot, j.grid.origin, j.grid.rowTops, j.grid.colWidth, occ);
        occ.push({ x: pos.x, y: pos.y, width: it.width, height: it.height });
        j.positions.set(it.key, { ...pos, slot: slot ?? [-1, -1] });
      }
    }
    post({ type: "plan", jobId: j.id, build: build.map((r) => r.key), skip, replace: [...j.replace.keys()] });
    return j;
  }
  async function loadFonts(j, choices) {
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    const failed = [];
    for (const c of choices) {
      const fn = c.wght ? { family: c.family, style: c.style, variationSettings: { wght: c.wght } } : { family: c.family, style: c.style };
      try {
        await figma.loadFontAsync({ family: c.family, style: c.style });
        j.fonts.set(c.key, fn);
      } catch {
        failed.push(`${c.family} ${c.style}`);
      }
    }
    if (failed.length) throw Object.assign(new Error("Не удалось загрузить шрифты: " + failed.join(", ")), { action: "Установите эти шрифты в систему, перезапустите Figma и повторите. Холст не изменён." });
  }
  async function buildOne(j, s, index) {
    const pr = j.routes.get(s.routeKey);
    if (!pr) throw new Error("маршрут не входит в план: " + s.routeKey);
    const v = validateSnapshot(s, new Set(j.fonts.keys()), /* @__PURE__ */ new Set([...j.images.keys(), ...j.svgs.keys()]));
    const fatal = v.issues.filter((i) => !/нет ассета|нет запасного ассета/.test(i.message));
    if (fatal.length) throw new Error(`Страница ${s.routeKey}: модель не прошла проверку (${fatal.slice(0, 3).map((i) => i.path + ": " + i.message).join("; ")})`);
    const warnings = [];
    let nodes = 0, texts = 0;
    const ctx = {
      fonts: j.fonts,
      images: j.images,
      svgs: j.svgs,
      route: s.routeKey,
      warnings,
      count: 0,
      tick: async () => {
        post({ type: "progress", jobId: j.id, route: s.routeKey, nodes: ctx.count, total: v.nodes, index });
        await tick();
        if (j.cancel) throw new CancelError();
      },
      checkCancel: () => {
        if (j.cancel) throw new CancelError();
      },
      onNode: (n) => {
        nodes++;
        if (n.type === "TEXT") texts++;
      }
    };
    const order = j.order.get(s.routeKey) ?? index;
    const name = `${String(order + 1).padStart(2, "0")} · ${s.label || s.title || s.routeKey}`;
    const root = await buildRoute(s, ctx, name, (r) => j.created.push(r));
    const pos = j.positions.get(s.routeKey);
    root.x = pos.x;
    root.y = pos.y;
    if (j.viewportMode) {
      root.resizeWithoutConstraints(root.width, Math.min(s.height, s.viewport.height));
      root.overflowDirection = "VERTICAL";
      root.numberOfFixedChildren = s.fixedCount;
    }
    const reg = {
      v: PROTOCOL_VERSION,
      project: j.project,
      set: j.set,
      route: s.routeKey,
      label: j.label + " · " + (s.label || s.routeKey),
      source: j.source,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      fp: "",
      slot: pos.slot,
      columns: j.columns,
      fixed: s.fixedCount,
      height: s.height,
      width: s.width,
      viewportHeight: s.viewport.height,
      mode: j.viewportMode ? "viewport" : "design",
      grid: j.grid
    };
    if (s.hover.active) root.setPluginData("hover", s.hover.selector ?? "");
    root.setRelaunchData({ open: "Открыть импортёр HTML → Figma" });
    reg.fp = fingerprint(root);
    root.setPluginData(PLUGIN_DATA_KEY, JSON.stringify(reg));
    j.stats.nodes += nodes;
    j.stats.texts += texts;
    j.stats.warnings += warnings.length;
    post({ type: "route-done", jobId: j.id, key: s.routeKey, nodeId: root.id, warnings: warnings.slice(0, 50), nodes });
  }
  function commit(j) {
    let replaced = 0;
    for (const [, old] of j.replace) {
      try {
        old.remove();
        replaced++;
      } catch {
      }
    }
    for (const [, ed] of j.edited) {
      if (!ed.name.endsWith("(изменён вручную)")) ed.name = ed.name + " (изменён вручную)";
    }
    if (j.created.length) {
      figma.currentPage.selection = j.created;
      figma.viewport.scrollAndZoomIntoView(j.created);
    }
    figma.root.setRelaunchData({ open: "Открыть импортёр HTML → Figma" });
    post({ type: "done", jobId: j.id, summary: { created: j.created.length, replaced, kept: j.edited.size, skipped: 0, texts: j.stats.texts, nodes: j.stats.nodes, warnings: j.stats.warnings, set: j.set } });
    post({ type: "sets", sets: summarize() });
    job = null;
  }
  function verify(project) {
    const rep = { frames: 0, texts: 0, checkedNodes: 0, positionIssues: [], textIssues: [], newOverlaps: [], frameOverlaps: [], ok: true, scope: "Проверка в Figma: абсолютные рамки нативных слоёв сравниваются с рамками модели; пересечения фреймов на странице." };
    const list = roots(project);
    rep.frames = list.length;
    for (const { node: root, reg } of list) {
      const ox = root.absoluteTransform[0][2], oy = root.absoluteTransform[1][2];
      const texts = [];
      const walk = (n) => {
        const e = n.getPluginData("e");
        if (e && n.absoluteBoundingBox) {
          const exp = e.split(",").map(Number);
          const b = n.absoluteBoundingBox;
          const got = { x: b.x - ox, y: b.y - oy, width: b.width, height: b.height };
          rep.checkedNodes++;
          if (n.type === "TEXT") {
            rep.texts++;
            texts.push({ name: n.name, exp, got });
            const a = n.getPluginData("a") || "LEFT";
            const ea = n.getPluginData("ea").split(",").map(Number);
            const m = n.absoluteTransform;
            const lx = a === "CENTER" ? n.width / 2 : a === "RIGHT" ? n.width : 0;
            const kx = ea.length === 2 ? m[0][0] * lx + m[0][2] - ox - ea[0] : got.x - exp[0];
            const dy = ea.length === 2 ? m[1][0] * lx + m[1][2] - oy - ea[1] : got.y - exp[1];
            if (Math.abs(kx) > 2 || Math.abs(dy) > 2) rep.positionIssues.push({ route: reg.route, node: n.name, dx: +kx.toFixed(2), dy: +dy.toFixed(2), dw: +(got.width - exp[2]).toFixed(2), dh: +(got.height - exp[3]).toFixed(2) });
            const lines = Number(n.getPluginData("l")) || 0;
            if (lines && n.characters.split("\n").length !== lines) rep.textIssues.push({ route: reg.route, node: n.name, problem: "изменилось число строк" });
            if (n.textAutoResize === "WIDTH_AND_HEIGHT" && exp[2] > 4 && got.width > exp[2] * 1.06 + 2) rep.textIssues.push({ route: reg.route, node: n.name, problem: `шире исходного на ${(got.width - exp[2]).toFixed(1)} px (метрики шрифта в Figma)` });
          } else if (Math.abs(got.x - exp[0]) > 1 || Math.abs(got.y - exp[1]) > 1 || Math.abs(got.width - exp[2]) > 1 || Math.abs(got.height - exp[3]) > 1) {
            rep.positionIssues.push({ route: reg.route, node: n.name, dx: +(got.x - exp[0]).toFixed(2), dy: +(got.y - exp[1]).toFixed(2), dw: +(got.width - exp[2]).toFixed(2), dh: +(got.height - exp[3]).toFixed(2) });
          }
        }
        if ("children" in n) for (const c of n.children) walk(c);
      };
      for (const c of root.children) walk(c);
      texts.sort((a, b) => a.got.y - b.got.y);
      for (let i = 0; i < texts.length; i++) {
        for (let k = i + 1; k < texts.length && texts[k].got.y < texts[i].got.y + texts[i].got.height; k++) {
          const A = texts[i], B = texts[k];
          const was = overlaps({ x: A.exp[0], y: A.exp[1], width: A.exp[2], height: A.exp[3] }, { x: B.exp[0], y: B.exp[1], width: B.exp[2], height: B.exp[3] }, 0.5);
          if (!was && overlaps(A.got, B.got, 1)) rep.newOverlaps.push({ route: reg.route, a: A.name, b: B.name });
        }
      }
    }
    const boxes = list.map(({ node, reg }) => ({ key: reg.route + "@" + reg.set, ...boxOf(node) }));
    for (let i = 0; i < boxes.length; i++) for (let k = i + 1; k < boxes.length; k++) if (overlaps(boxes[i], boxes[k])) rep.frameOverlaps.push([boxes[i].key, boxes[k].key]);
    rep.positionIssues = rep.positionIssues.slice(0, 200);
    rep.textIssues = rep.textIssues.slice(0, 200);
    rep.newOverlaps = rep.newOverlaps.slice(0, 200);
    rep.ok = !rep.positionIssues.length && !rep.newOverlaps.length && !rep.frameOverlaps.length && !rep.textIssues.some((t) => t.problem.includes("строк"));
    return rep;
  }
  function setMode(project, viewport) {
    const s = latestSet(project);
    if (!s) throw new Error("Сначала создайте макеты.");
    for (const { node, reg } of s.items) {
      const wasClean = fingerprint(node) === reg.fp;
      const h = viewport ? Math.min(reg.height, reg.viewportHeight) : reg.height;
      node.resizeWithoutConstraints(node.width, h);
      node.clipsContent = true;
      node.overflowDirection = viewport ? "VERTICAL" : "NONE";
      node.numberOfFixedChildren = viewport ? reg.fixed : 0;
      reg.mode = viewport ? "viewport" : "design";
      if (wasClean) reg.fp = fingerprint(node);
      node.setPluginData(PLUGIN_DATA_KEY, JSON.stringify(reg));
    }
  }
  figma.ui.onmessage = async (msg) => {
    try {
      switch (msg.type) {
        case "tock": {
          const r = waiting.get(msg.n);
          waiting.delete(msg.n);
          r?.();
          return;
        }
        case "cancel":
          if (job && job.id === msg.jobId) job.cancel = true;
          return;
        case "init": {
          const keys = ["token", "settings", "profiles", "processorUrl"];
          const storage = {};
          for (const k of keys) storage[k] = await figma.clientStorage.getAsync(k);
          post({ type: "init", page: figma.currentPage.name, editor: figma.editorType, sets: summarize(), storage });
          return;
        }
        case "storage-get":
          post({ type: "storage", id: msg.id, value: await figma.clientStorage.getAsync(msg.key) });
          return;
        case "storage-set":
          await figma.clientStorage.setAsync(msg.key, msg.value);
          post({ type: "storage", id: msg.id, value: true });
          return;
        case "notify":
          figma.notify(msg.text, { error: !!msg.error, timeout: 4e3 });
          return;
        case "resize":
          figma.ui.resize(Math.max(360, Math.min(900, msg.width)), Math.max(420, Math.min(1200, msg.height)));
          return;
        case "fonts-check": {
          const r = await checkFonts(msg.fonts, msg.substitutions);
          post({ type: "fonts-result", id: msg.id, results: r.results, families: r.families });
          return;
        }
        case "begin": {
          if (job?.busy) {
            post({ type: "error", jobId: msg.jobId, message: "Уже идёт создание макетов.", action: "Дождитесь завершения или нажмите «Отмена»." });
            return;
          }
          if (figma.editorType !== "figma") {
            post({ type: "error", jobId: msg.jobId, message: "Плагин работает только в Figma Design.", action: "Откройте файл Figma Design (не FigJam/Slides)." });
            return;
          }
          const j = plan(msg);
          job = j;
          try {
            await loadFonts(j, msg.fonts);
          } catch (e) {
            job = null;
            post({ type: "error", jobId: msg.jobId, message: e.message, action: e.action });
          }
          return;
        }
        case "asset": {
          const j = job;
          if (!j || j.id !== msg.jobId) return;
          try {
            if (msg.kind === "image" && msg.bytes) j.images.set(msg.id, figma.createImage(msg.bytes).hash);
            else if (msg.kind === "svg" && msg.text !== void 0) j.svgs.set(msg.id, msg.text);
            post({ type: "asset-ok", jobId: j.id, id: msg.id });
          } catch (e) {
            post({ type: "asset-error", jobId: j.id, id: msg.id, message: String(e.message ?? e).slice(0, 200) });
          }
          return;
        }
        case "route": {
          const j = job;
          if (!j || j.id !== msg.jobId) return;
          j.busy = true;
          try {
            await buildOne(j, msg.snapshot, msg.index);
          } catch (e) {
            j.busy = false;
            if (e instanceof CancelError) {
              await rollback(j, e.message);
              return;
            }
            await rollback(j, "Ошибка: " + e.message);
            post({ type: "error", jobId: j.id, message: e.message, action: "Все новые объекты этой попытки удалены, старые макеты не затронуты. Скачайте отчёт и повторите." });
            return;
          }
          j.busy = false;
          return;
        }
        case "commit": {
          const j = job;
          if (j && j.id === msg.jobId) commit(j);
          return;
        }
        case "abort": {
          const j = job;
          if (j && j.id === msg.jobId) await rollback(j, msg.reason);
          return;
        }
        case "show": {
          const list = roots(msg.project).filter((r) => !msg.route || r.reg.route === msg.route).map((r) => r.node);
          if (list.length) {
            figma.currentPage.selection = list;
            figma.viewport.scrollAndZoomIntoView(list);
          }
          return;
        }
        case "mode":
          setMode(msg.project, msg.viewport);
          post({ type: "sets", sets: summarize() });
          post({ type: "status", text: msg.viewport ? "Режим просмотра: экран с вертикальной прокруткой, закреплённые элементы зафиксированы." : "Макеты развёрнуты на полную высоту." });
          return;
        case "verify":
          post({ type: "verify-result", report: verify(msg.project) });
          return;
        case "export": {
          const r = roots(msg.project).find((x) => x.reg.route === msg.route);
          if (!r) {
            post({ type: "export-result", id: msg.id, route: msg.route, error: "макет не найден" });
            return;
          }
          const h = r.node.height;
          const full = r.reg.height;
          if (Math.abs(h - full) > 0.5) r.node.resizeWithoutConstraints(r.node.width, full);
          try {
            const bytes = await r.node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 1 } });
            post({ type: "export-result", id: msg.id, route: msg.route, bytes });
          } finally {
            if (Math.abs(h - full) > 0.5) r.node.resizeWithoutConstraints(r.node.width, h);
          }
          return;
        }
      }
    } catch (e) {
      post({ type: "error", message: String(e.message ?? e), action: "Повторите действие. Если ошибка повторяется — скачайте отчёт." });
    }
  };
})();
