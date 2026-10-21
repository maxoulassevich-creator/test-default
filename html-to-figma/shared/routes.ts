/*
 * Классификация ссылок и нормализация адресов маршрутов.
 * Различаем: внешние ссылки, якоря на той же странице, hash-маршруты (#/…, #!/…),
 * отдельные HTML-файлы/пути внутри проекта, query-варианты.
 * Значимые query (в пути и внутри hash) сохраняются: «#/login?invite=1» и «#/login» —
 * разные адреса; совпадение содержимого затем выявляется отпечатком (fingerprint).
 */

export type LinkKind = 'external' | 'scheme' | 'same' | 'anchor' | 'hash-route' | 'hash-candidate' | 'page' | 'download' | 'invalid';

export interface ClassifiedLink { kind: LinkKind; url?: string; key?: string; reason?: string }

const DOWNLOAD_EXT = /\.(pdf|zip|rar|7z|gz|tar|docx?|xlsx?|pptx?|mp3|mp4|webm|mov|wav|ogg|png|jpe?g|gif|webp|avif|svg|ico|txt|csv|json|xml|epub|woff2?|ttf|otf)$/i;

export function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Ключ маршрута: путь относительно корня проекта + query + hash (hash в читаемом виде). */
export function routeKey(url: string, siteBase: string): string {
  const u = new URL(url);
  const base = new URL(siteBase);
  let path = u.pathname;
  if (path.startsWith(base.pathname)) path = path.slice(base.pathname.length);
  path = safeDecode(path);
  const hash = u.hash && u.hash !== '#' ? safeDecode(u.hash) : '';
  return `${path}${safeDecode(u.search)}${hash}`;
}

/** Обратное преобразование ключа в URL обработчика. */
export function urlFromKey(key: string, siteBase: string): string {
  const hashAt = key.indexOf('#');
  const pathQuery = hashAt >= 0 ? key.slice(0, hashAt) : key;
  const hash = hashAt >= 0 ? key.slice(hashAt) : '';
  const qAt = pathQuery.indexOf('?');
  const path = qAt >= 0 ? pathQuery.slice(0, qAt) : pathQuery;
  const query = qAt >= 0 ? pathQuery.slice(qAt) : '';
  const u = new URL(path.split('/').map(encodeURIComponent).join('/'), siteBase);
  u.search = query;
  // hash кодируем так же, как это делает браузер для location.hash
  u.hash = hash ? encodeURI(hash.slice(1)) : '';
  return u.toString();
}

export function isHashRoute(fragment: string): boolean {
  return /^#!?\//.test(fragment);
}

/**
 * @param href атрибут ссылки
 * @param pageUrl текущий URL документа
 * @param siteBase корень проекта (http://127.0.0.1:port/j/<job>/)
 * @param ids множество id/name элементов текущего документа (для распознавания якорей)
 */
export function classifyHref(href: string, pageUrl: string, siteBase: string, ids: Set<string>, opts: { download?: boolean } = {}): ClassifiedLink {
  const raw = (href ?? '').trim();
  if (!raw) return { kind: 'invalid', reason: 'пустая ссылка' };
  if (/^(mailto|tel|sms|javascript|data|blob|ftp|file):/i.test(raw)) return { kind: 'scheme', reason: raw.split(':')[0] };
  let u: URL;
  try { u = new URL(raw, pageUrl); } catch { return { kind: 'invalid', reason: 'неразборчивый адрес' }; }
  const base = new URL(siteBase);
  // путь от корня сайта («/about.html»): проект обслуживается из подпапки — переносим в неё
  // (служебные адреса других заданий «/j/<id>/…» не переносятся — проекты изолированы)
  if (u.origin === base.origin && !u.pathname.startsWith(base.pathname) && !/^\/j\/[a-z0-9]+\//.test(u.pathname)) u = new URL(base.pathname + u.pathname.replace(/^\/+/, '') + u.search + u.hash, base);
  if (u.origin !== base.origin || !u.pathname.startsWith(base.pathname)) return { kind: 'external', url: u.toString() };
  if (opts.download || DOWNLOAD_EXT.test(u.pathname)) return { kind: 'download', url: u.toString(), reason: 'файл/загрузка' };
  const cur = new URL(pageUrl);
  const samePath = u.pathname === cur.pathname || (u.pathname.endsWith('/') && cur.pathname === u.pathname + 'index.html') || (cur.pathname.endsWith('/') && u.pathname === cur.pathname + 'index.html');
  const key = routeKey(u.toString(), siteBase);
  if (samePath && u.search === cur.search) {
    if (!u.hash || u.hash === '#') return cur.hash && cur.hash !== '#' && isHashRoute(cur.hash) ? { kind: 'hash-route', url: u.toString(), key } : { kind: 'same', reason: 'та же страница' };
    if (isHashRoute(u.hash)) return { kind: 'hash-route', url: u.toString(), key };
    const frag = safeDecode(u.hash.slice(1));
    if (ids.has(frag)) return { kind: 'anchor', url: u.toString(), key, reason: `якорь #${frag} на этой странице` };
    return { kind: 'hash-candidate', url: u.toString(), key };
  }
  if (isHashRoute(u.hash)) return { kind: 'hash-route', url: u.toString(), key };
  if (u.hash && !isHashRoute(u.hash)) {
    // ссылка на якорь другой страницы — маршрутом считаем саму страницу
    const p = new URL(u.toString());
    p.hash = '';
    return { kind: 'page', url: p.toString(), key: routeKey(p.toString(), siteBase), reason: 'якорь на другой странице' };
  }
  return { kind: 'page', url: u.toString(), key };
}

/** «Форма» адреса для ограничения однотипных маршрутов (пагинация, календари). */
export function routeShape(key: string): string {
  return key
    .replace(/\d+/g, '#')
    .replace(/=[^&#]*/g, '=*')
    .replace(/\/[0-9a-f]{8,}/gi, '/~');
}

/** Группа для списка страниц в UI: первый сегмент hash-маршрута или пути. */
export function routeGroup(key: string): string {
  const hashAt = key.indexOf('#');
  const target = hashAt >= 0 && isHashRoute(key.slice(hashAt)) ? key.slice(hashAt).replace(/^#!?\//, '') : key.slice(0, hashAt >= 0 ? hashAt : undefined);
  const seg = target.split(/[/?]/).filter(Boolean)[0] ?? '';
  return seg.replace(/\.html?$/i, '') || 'главная';
}

/** Глубина маршрута в сегментах. */
export function routeDepth(key: string): number {
  const hashAt = key.indexOf('#');
  const t = hashAt >= 0 ? key.slice(hashAt + 1) : key;
  return t.split('?')[0].split('/').filter(Boolean).length;
}

/** Безопасное имя файла по ключу маршрута. */
export function routeFileId(key: string): string {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  // только ASCII: имя файла и сегмент URL без кодирования на любой ОС
  const slug = key.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'root';
  return `${slug}-${(h >>> 0).toString(36)}`;
}

/** Строковые литералы hash-маршрутов из исходного JS (дополнительный источник кандидатов). */
export function extractHashLiterals(source: string, limit = 400): string[] {
  const out = new Set<string>();
  const re = /["'`](#!?\/[^"'`\s<>{}$\\]{0,120})["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) && out.size < limit) {
    const v = m[1];
    if (/[()]/.test(v)) continue;
    out.add(v);
  }
  return [...out];
}
