/*
 * Наведение.
 *
 * Закрепление позы: правила CSSOM, в СЕЛЕКТОРАХ которых встречается псевдокласс
 * :hover, переписываются (rule.selectorText) на атрибут [data-h2f-hover]. Условия
 * @media/@supports/@container/@layer НЕ трогаются (они в отдельных объектах
 * CSSGroupingRule.conditionText), поэтому «(hover:hover)» сохраняется.
 * Специфичность :hover и [attr] одинакова (0,1,0). После этого реальный курсор
 * больше не влияет на страницу, а атрибут ставится на настоящую цепочку цели под
 * курсором (hit target + все предки), как это делает браузер.
 */

export const HOVER_ATTR = 'data-h2f-hover';

/** Замена токена :hover только в тексте селектора (вне строк и [атрибутов]). */
export function rewriteHoverSelector(sel: string, replacement = `[${HOVER_ATTR}]`): string {
  let out = '';
  let quote = '';
  let bracket = 0;
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i];
    if (ch === '\\') { out += ch + (sel[i + 1] ?? ''); i++; continue; }
    if (quote) { out += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; out += ch; continue; }
    if (ch === '[') { bracket++; out += ch; continue; }
    if (ch === ']') { bracket = Math.max(0, bracket - 1); out += ch; continue; }
    if (!bracket && ch === ':' && sel[i - 1] !== ':' && sel.slice(i + 1, i + 6).toLowerCase() === 'hover' && !/[\w-]/.test(sel[i + 6] ?? '')) {
      out += replacement;
      i += 5;
      continue;
    }
    out += ch;
  }
  return out;
}

interface Rewritten { rule: CSSStyleRule; original: string }
let rewritten: Rewritten[] = [];
let installed = false;

function* walkRules(list: CSSRuleList): Generator<CSSRule> {
  for (const r of Array.from(list)) {
    yield r;
    const inner = (r as CSSGroupingRule).cssRules;
    if (inner && inner.length) yield* walkRules(inner);
  }
}

function sheets(): CSSStyleSheet[] {
  const out: CSSStyleSheet[] = [];
  const add = (root: Document | ShadowRoot) => {
    for (const s of Array.from(root.styleSheets)) out.push(s);
    for (const s of (root as Document).adoptedStyleSheets ?? []) out.push(s);
  };
  add(document);
  for (const el of Array.from(document.querySelectorAll('*'))) if (el.shadowRoot) add(el.shadowRoot);
  return out;
}

export interface PinInstallReport { rules: number; rewritten: number; failed: number; crossOrigin: number; mediaConditions: string[] }

export function installHoverPinning(): PinInstallReport {
  const rep: PinInstallReport = { rules: 0, rewritten: 0, failed: 0, crossOrigin: 0, mediaConditions: [] };
  if (installed) { rep.rewritten = rewritten.length; return rep; }
  for (const sh of sheets()) {
    let rules: CSSRuleList;
    try { rules = sh.cssRules; } catch { rep.crossOrigin++; continue; }
    for (const r of walkRules(rules)) {
      if ((r as CSSMediaRule).conditionText !== undefined && (r as CSSMediaRule).conditionText.includes('hover')) rep.mediaConditions.push((r as CSSMediaRule).conditionText);
      if (!(r instanceof CSSStyleRule)) continue;
      rep.rules++;
      const sel = r.selectorText;
      if (!/:hover/i.test(sel)) continue;
      const next = rewriteHoverSelector(sel);
      if (next === sel) continue;
      r.selectorText = next;
      if (r.selectorText === sel) { rep.failed++; continue; }
      rewritten.push({ rule: r, original: sel });
      rep.rewritten++;
    }
  }
  installed = true;
  return rep;
}

export function uninstallHoverPinning() {
  for (const { rule, original } of rewritten) { try { rule.selectorText = original; } catch { /* */ } }
  rewritten = [];
  installed = false;
  clearHoverMarks();
}

export function clearHoverMarks() {
  for (const e of Array.from(document.querySelectorAll(`[${HOVER_ATTR}]`))) e.removeAttribute(HOVER_ATTR);
}

/** Субъекты hover-правил: часть селектора до составного с :hover включительно. */
export function hoverSubjects(): string[] {
  const subjects = new Set<string>();
  const list = installed ? rewritten.map((r) => r.original) : [];
  if (!installed) {
    for (const sh of sheets()) {
      let rules: CSSRuleList;
      try { rules = sh.cssRules; } catch { continue; }
      for (const r of walkRules(rules)) if (r instanceof CSSStyleRule && /:hover/i.test(r.selectorText)) list.push(r.selectorText);
    }
  }
  for (const full of list) {
    for (const sel of splitSelectorList(full)) {
      const idx = findHover(sel);
      if (idx < 0) continue;
      // конец составного селектора с :hover
      let end = idx + 6;
      while (end < sel.length && !/[\s>+~]/.test(sel[end])) end++;
      let subject = (sel.slice(0, idx) + sel.slice(idx + 6, end)).trim();
      subject = subject.replace(/::?(before|after|first-letter|first-line|marker|placeholder)\b/g, '').replace(/:(focus|focus-visible|focus-within|active|visited|link)\b/g, '');
      if (!subject || /^[>+~]/.test(subject) || subject.endsWith('>') || subject.endsWith('+') || subject.endsWith('~')) continue;
      if (/:hover/.test(subject)) subject = rewriteHoverSelector(subject, '');
      subjects.add(subject.replace(/\s+/g, ' ').trim());
    }
  }
  return [...subjects];
}

function splitSelectorList(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '', quote = '';
  for (const ch of s) {
    if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function findHover(sel: string): number {
  let depth = 0;
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (!depth && ch === ':' && sel[i - 1] !== ':' && sel.slice(i + 1, i + 6).toLowerCase() === 'hover' && !/[\w-]/.test(sel[i + 6] ?? '')) return i;
  }
  return -1;
}

const DIFF_PROPS = ['transform', 'translate', 'rotate', 'scale', 'opacity', 'width', 'height', 'background-color', 'background-image', 'box-shadow', 'filter', 'color', 'visibility', 'border-top-color', 'outline-color', 'text-decoration-line', 'text-decoration-color', 'max-height', 'clip-path', 'display', 'left', 'top'];

function snapSubtree(root: Element): string[] {
  const out: string[] = [];
  const els = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const e of els) {
    for (const pseudo of ['', '::before', '::after']) {
      const cs = getComputedStyle(e, pseudo || null);
      if (pseudo && cs.content === 'none') { out.push(''); continue; }
      out.push(DIFF_PROPS.map((p) => cs.getPropertyValue(p)).join('|'));
    }
  }
  return out;
}

export interface HoverCandidateRaw { index: number; el: Element; selector: string; label: string; score: number; box: [number, number, number, number]; changes: number }

function labelOf(el: Element): string {
  const h = el.querySelector('h1,h2,h3,h4,h5,h6,[class*="title"]');
  const t = (h?.textContent || (el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  return t.slice(0, 80) || el.tagName.toLowerCase();
}

function inChrome(el: Element): boolean {
  for (let c: Element | null = el; c; c = c.parentElement) {
    const tag = c.tagName;
    if (tag === 'HEADER' && !c.closest('main, article, section') || tag === 'NAV' || tag === 'FOOTER') return true;
    const role = c.getAttribute('role');
    if (role === 'navigation' || role === 'banner' || role === 'contentinfo') return true;
    const pos = getComputedStyle(c).position;
    if (pos === 'fixed' || pos === 'sticky') return true;
  }
  return false;
}

/**
 * Кандидаты для позы наведения: элементы, совпадающие с субъектами hover-правил,
 * у которых закрепление действительно меняет внешний вид поддерева.
 * Предпочитаются повторяющиеся карточки в основном содержимом.
 */
export function findHoverCandidates(isExcluded: (e: Element) => boolean, limit = 12): HoverCandidateRaw[] {
  installHoverPinning();
  const vw = innerWidth;
  const groups = new Map<string, { sel: string; els: Element[] }>();
  const parentIds = new Map<Element, number>();
  const pid = (e: Element | null) => {
    if (!e) return -1;
    let v = parentIds.get(e);
    if (v === undefined) { v = parentIds.size; parentIds.set(e, v); }
    return v;
  };
  for (const sel of hoverSubjects()) {
    let els: Element[];
    try { els = Array.from(document.querySelectorAll(sel)); } catch { continue; }
    for (const el of els) {
      if (isExcluded(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 40 || r.width > vw * 0.95) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0 || (el as HTMLButtonElement).disabled) continue;
      const key = sel + '§' + pid(el.parentElement);
      const g = groups.get(key) ?? { sel, els: [] };
      if (!g.els.includes(el)) g.els.push(el);
      groups.set(key, g);
    }
  }
  const out: HoverCandidateRaw[] = [];
  for (const g of groups.values()) {
    const el = g.els[0];
    // проверка эффекта: закрепляем на элементе и его предках
    const before = snapSubtree(el);
    const rb = el.getBoundingClientRect();
    markChain(el);
    const after = snapSubtree(el);
    const ra = el.getBoundingClientRect();
    clearHoverMarks();
    let changes = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) changes++;
    if (Math.abs(rb.width - ra.width) > 0.5 || Math.abs(rb.height - ra.height) > 0.5) changes += 2;
    if (!changes) continue;
    const r = el.getBoundingClientRect();
    const area = (r.width * r.height) / (innerWidth * innerHeight);
    const chrome = inChrome(el);
    const repeated = g.els.length >= 2;
    const hasMedia = !!el.querySelector('svg, img, picture, canvas, [style*="background"]');
    const top = r.top + scrollY;
    let score = Math.log2(1 + changes) * (repeated ? 2 : 1) * (hasMedia ? 1.4 : 1) * (chrome ? 0.15 : 1) * Math.min(1.5, 0.4 + area * 6) / (1 + top / 4000);
    if (r.width < 140 || r.height < 70) score *= 0.5;
    out.push({ index: 0, el, selector: g.sel, label: labelOf(el), score, box: [r.left + scrollX, top, r.width, r.height], changes });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit).map((c, i) => ({ ...c, index: i }));
}

function markChain(target: Element) {
  for (let e: Element | null = target; e; e = e.parentElement ?? ((e.getRootNode() as ShadowRoot).host ?? null)) {
    e.setAttribute(HOVER_ATTR, '');
    if (e === document.documentElement) break;
  }
}

function isInteractive(e: Element) {
  return /^(A|BUTTON|INPUT|SELECT|TEXTAREA|LABEL|SUMMARY)$/.test(e.tagName) || e.hasAttribute('onclick') || e.getAttribute('role') === 'button';
}

export interface PinResult { hit: string; point: [number, number]; chain: number; synthetic: boolean }

/**
 * Определяет настоящую цель под курсором (через elementFromPoint после прокрутки
 * карточки в зону видимости), затем возвращает прокрутку в начало и ставит атрибут
 * на цепочку hit target → предки. Псевдоэлемент-оверлей (a::after) даёт hit = ссылка.
 */
export async function pinHover(card: Element, describe: (e: Element) => string): Promise<PinResult> {
  installHoverPinning();
  clearHoverMarks();
  card.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' as ScrollBehavior });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const r = card.getBoundingClientRect();
  const pts: Array<[number, number]> = [
    [0.5, 0.42], [0.8, 0.42], [0.5, 0.3], [0.3, 0.5], [0.65, 0.65], [0.2, 0.2],
  ];
  let best: { el: Element; x: number; y: number } | null = null;
  for (const [fx, fy] of pts) {
    const x = r.left + Math.max(4, Math.min(r.width - 4, r.width * fx));
    const y = r.top + Math.max(4, Math.min(r.height - 4, r.height * fy));
    const hit = document.elementFromPoint(x, y);
    if (!hit || !(card === hit || card.contains(hit))) continue;
    // избегаем мелких интерактивных детей, если это не оверлей во всю карточку
    let inter: Element | null = null;
    for (let e: Element | null = hit; e && e !== card; e = e.parentElement) if (isInteractive(e)) { inter = e; break; }
    if (inter) {
      const ir = inter.getBoundingClientRect();
      const overlay = ir.width * ir.height >= 0.6 * r.width * r.height;
      if (!overlay && !best) { best = { el: hit, x, y }; continue; }
      if (!overlay) continue;
    }
    best = { el: hit, x, y };
    break;
  }
  const scrollYAtHit = scrollY, scrollXAtHit = scrollX;
  const target = best?.el ?? card;
  const px = best ? best.x + scrollXAtHit : r.left + r.width / 2 + scrollXAtHit;
  const py = best ? best.y + scrollYAtHit : r.top + r.height / 2 + scrollYAtHit;
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  markChain(target);
  let synthetic = false;
  try {
    const opts = { bubbles: true, cancelable: true, clientX: px - scrollX, clientY: py - scrollY, view: window } as MouseEventInit;
    const chain: Element[] = [];
    for (let e: Element | null = target; e; e = e.parentElement) chain.push(e);
    target.dispatchEvent(new PointerEvent('pointerover', opts));
    for (const e of chain.reverse()) e.dispatchEvent(new PointerEvent('pointerenter', { ...opts, bubbles: false }));
    target.dispatchEvent(new MouseEvent('mouseover', opts));
    for (const e of chain) e.dispatchEvent(new MouseEvent('mouseenter', { ...opts, bubbles: false }));
    target.dispatchEvent(new MouseEvent('mousemove', opts));
    synthetic = true;
  } catch { /* */ }
  let chainLen = 0;
  for (let e: Element | null = target; e; e = e.parentElement) chainLen++;
  return { hit: describe(target), point: [px, py], chain: chainLen, synthetic };
}

/** Снимок вычисленных стилей поддерева (для сравнения с настоящим наведением в тестах). */
export function hoverStyleSnapshot(root: Element): string[] {
  return snapSubtree(root);
}
