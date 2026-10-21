/*
 * Профили проектов (адаптеры): данные, а не код ядра. Профиль может задать начальное
 * состояние localStorage (роль/язык/тема демо), исключаемые служебные панели,
 * собственный указатель страниц сайта (routeSelector) и предпочтительные hover-цели.
 * Пользовательские профили сохраняются плагином и передаются с заданием.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { CaptureProfile } from '../../shared/schema';

export interface Adapter {
  id: string;
  label: string;
  match: { allOf?: string[]; anyOf?: string[]; sha256?: string[] };
  profile: Partial<CaptureProfile>;
  routeSelector?: string;
  extraRoutes?: string[];
  notes?: string;
}

export function loadAdapters(dirs: string[]): Adapter[] {
  const out: Adapter[] = [];
  for (const d of dirs) {
    if (!d || !fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith('.json')) continue;
      try {
        const a = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')) as Adapter;
        if (a.id && a.match && a.profile) out.push(a);
      } catch { /* битый профиль пропускается */ }
    }
  }
  return out;
}

export function matchAdapter(adapters: Adapter[], source: string, sha256: string): Adapter | null {
  for (const a of adapters) {
    if (a.match.sha256?.includes(sha256)) return a;
    const all = a.match.allOf ?? [];
    const any = a.match.anyOf ?? [];
    if ((all.length || any.length) && all.every((s) => source.includes(s)) && (!any.length || any.some((s) => source.includes(s)))) return a;
  }
  return null;
}

export interface StorageHint { key: string; values: string[]; read: boolean }

/** Подсказки значений для ключей localStorage, которые читает приложение. */
export function storageHints(keys: string[], sources: string[]): StorageHint[] {
  const text = sources.join('\n');
  const out: StorageHint[] = [];
  const allKeys = new Set(keys);
  // ключи, встречающиеся в коде рядом с getItem/store.get
  const re = /(?:getItem|setItem|\.get|\.set|\.json|\.put)\(\s*['"]([\w.:-]{2,40})['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) allKeys.add(m[1]);
  for (const key of allKeys) {
    const values = new Set<string>();
    const suffix = key.split(/[-_.:]/).pop()!.toLowerCase();
    if (suffix.length >= 2) {
      const arr = new RegExp(`(?:const|let|var)\\s+\\w*${suffix}\\w*\\s*=\\s*\\[([^\\]]{0,400})\\]`, 'gi');
      let a: RegExpExecArray | null;
      while ((a = arr.exec(text))) for (const v of a[1].matchAll(/['"]([\w-]{1,24})['"]/g)) values.add(v[1]);
    }
    const def = new RegExp(`['"]${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\s*,\\s*['"]([\\w-]{1,24})['"]`, 'g');
    let d: RegExpExecArray | null;
    while ((d = def.exec(text))) values.add(d[1]);
    if (!keys.includes(key) && !values.size) continue;
    out.push({ key, values: [...values].slice(0, 12), read: keys.includes(key) });
  }
  return out.sort((a, b) => Number(b.read) - Number(a.read) || a.key.localeCompare(b.key)).slice(0, 30);
}
