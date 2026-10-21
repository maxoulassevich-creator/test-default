/*
 * Сбор кандидатов маршрутов в отрисованном документе и отпечаток содержимого
 * для распознавания дубликатов/редиректов. Ничего не нажимает и не отправляет.
 */

export interface LinkInfo { href: string; text: string; download: boolean; source: 'a' | 'data' }

/** Текст ссылки по частям (номер пункта, заголовок, примечание) — первая содержательная часть. */
export function linkLabel(a: Element): string {
  const parts: string[] = [];
  const walk = (n: Node, acc: { s: string }) => {
    if (n.nodeType === Node.TEXT_NODE) { acc.s += n.textContent ?? ''; return; }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as Element;
    if (getComputedStyle(el).display === 'none') return;
    for (const c of Array.from(el.childNodes)) walk(c, acc);
  };
  for (const c of Array.from(a.childNodes)) {
    const acc = { s: '' };
    walk(c, acc);
    const t = acc.s.replace(/\s+/g, ' ').trim();
    if (t) parts.push(t);
  }
  const meaningful = parts.filter((p) => !/^[\d.\s/№#-]+$/.test(p));
  const label = (meaningful[0] ?? parts.join(' ')).trim();
  return label || (a.getAttribute('aria-label') ?? a.getAttribute('title') ?? '').trim();
}

export function collectLinks(isExcluded: (e: Element) => boolean): { links: LinkInfo[]; ids: string[] } {
  const links: LinkInfo[] = [];
  for (const a of Array.from(document.querySelectorAll('a[href], area[href]'))) {
    const href = a.getAttribute('href') ?? '';
    const text = linkLabel(a).slice(0, 80);
    links.push({ href, text, download: a.hasAttribute('download'), source: 'a' });
  }
  for (const e of Array.from(document.querySelectorAll('[data-href], [data-route], [data-link], [routerlink]'))) {
    const v = e.getAttribute('data-href') ?? e.getAttribute('data-route') ?? e.getAttribute('data-link') ?? e.getAttribute('routerlink') ?? '';
    if (!/^(#|\/|\.\/|[\w-]+\.html?)/.test(v)) continue;
    links.push({ href: v, text: ((e as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80), download: false, source: 'data' });
  }
  void isExcluded;
  const ids: string[] = [];
  for (const e of Array.from(document.querySelectorAll('[id], a[name]'))) {
    const id = e.getAttribute('id') ?? e.getAttribute('name');
    if (id) ids.push(id);
  }
  return { links, ids };
}

function hash(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/** Отпечаток: видимый текст + структура (теги/классы) без исключённых областей. */
export function fingerprint(isExcluded: (e: Element) => boolean): { fp: string; textLength: number; heading: string } {
  const parts: string[] = [];
  let textLength = 0;
  const walk = (el: Element) => {
    if (isExcluded(el)) return;
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return;
    parts.push(tag + '.' + (el.getAttribute('class') ?? '').split(/\s+/).filter((c) => !/active|current|is-|open|selected|hover|focus/.test(c)).slice(0, 3).join('.'));
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === Node.TEXT_NODE) {
        const t = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (t) { parts.push(t); textLength += t.length; }
      } else if (n.nodeType === Node.ELEMENT_NODE) walk(n as Element);
    }
  };
  if (document.body) walk(document.body);
  // заголовок страницы: первый видимый h1 (затем h2) вне шапки, навигации и подвала
  const inChrome = (e: Element) => !!e.closest('header, nav, footer, [role="navigation"], [role="banner"], [role="contentinfo"]') || isExcluded(e);
  const visible = (e: Element) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0; };
  const pick = (sel: string) => Array.from(document.querySelectorAll(sel)).find((e) => visible(e) && !inChrome(e));
  const h = pick('h1') ?? pick('h2') ?? document.querySelector('h1');
  const heading = (h?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
  return { fp: hash(parts.join('\u0001')), textLength, heading };
}
