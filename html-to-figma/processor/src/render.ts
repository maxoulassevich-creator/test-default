/*
 * Служебный рендерер (отдельный контекст браузера обработчика, не связанный с
 * исполняемым HTML): растеризация SVG с расширенной областью для overflow:visible
 * и фильтров, отрисовка CSS-слоёв фона, перекодирование изображений и запекание
 * CSS-фильтров через canvas. Прозрачность сохраняется (PNG), поля обрезаются.
 */
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { alphaBounds, crop, decodePng, encodePng } from './png';

export interface RasterResult { png: Buffer; x: number; y: number; w: number; h: number; scale: number; empty?: boolean }

const MAX = 4096;
/** Бюджет пикселей одного растра: мягкие крупные пятна не нужно хранить в 2× (память, время, размер файла). */
export const PIXEL_BUDGET = 4_000_000;
const budgetScale = (scale: number, w: number, h: number) => Math.max(0.05, Math.min(scale, MAX / w, MAX / h, Math.sqrt(PIXEL_BUDGET / Math.max(1, w * h))));

export class Renderer {
  private ctx: BrowserContext | null = null;
  private page: Page | null = null;
  constructor(private browser: Browser, private allowOrigins: string[], private blockExternal: boolean) {}

  private async ensure(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    this.ctx = await this.browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    await this.ctx.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('data:') || url.startsWith('blob:') || url === 'about:blank' || this.allowOrigins.some((o) => url.startsWith(o))) return route.continue();
      if (this.blockExternal || !/^https?:/.test(url) || /^https?:\/\/(localhost|127\.|10\.|192\.168\.)/.test(url)) return route.abort();
      return route.continue();
    });
    this.page = await this.ctx.newPage();
    return this.page;
  }

  async close() { await this.ctx?.close().catch(() => undefined); this.ctx = null; this.page = null; }

  private async shot(html: string, cw: number, ch: number, baseUrl?: string): Promise<Buffer> {
    const page = await this.ensure();
    await page.setViewportSize({ width: Math.max(1, Math.ceil(cw)), height: Math.max(1, Math.ceil(ch)) });
    const base = baseUrl ? `<base href="${baseUrl.replace(/"/g, '&quot;')}">` : '';
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8">${base}<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}</style></head><body>${html}</body></html>`, { waitUntil: 'load', timeout: 30000 });
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images).map((i) => i.decode().catch(() => undefined))); });
    return page.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: Math.max(1, Math.ceil(cw)), height: Math.max(1, Math.ceil(ch)) }, timeout: 30000 });
  }

  /** SVG → PNG. pad — запас вокруг viewport для overflow:visible/фильтров; результат обрезан по альфе. */
  async renderSvg(markup: string, w: number, h: number, opts: { overflow: boolean; filters: boolean; scale: number }): Promise<RasterResult> {
    // при overflow:hidden (по умолчанию у svg) эффекты фильтров обрезаются viewport — запас не нужен
    const pad = opts.overflow ? Math.max(16, Math.round(0.3 * Math.max(w, h))) : 0;
    const W = w + 2 * pad, H = h + 2 * pad;
    const s = budgetScale(opts.scale, W, H);
    const html = `<div style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0;transform:scale(${s})"><div style="position:absolute;left:${pad}px;top:${pad}px;width:${w}px;height:${h}px;line-height:0">${markup}</div></div>`;
    const png = await this.shot(html, W * s, H * s);
    // без запаса обрезка не нужна — снимок уже ровно по viewport svg
    if (!pad) return { png, x: 0, y: 0, w, h, scale: s };
    const img = decodePng(png);
    const b = alphaBounds(img);
    if (!b) return { png: encodePng({ width: 1, height: 1, data: Buffer.alloc(4) }), x: 0, y: 0, w: 0, h: 0, scale: s, empty: true };
    // без overflow обрезаем строго по viewport, иначе — по фактически закрашенной области
    const r = pad ? b : { x: 0, y: 0, w: img.width, h: img.height };
    const out = encodePng(crop(img, r));
    return { png: out, x: r.x / s - pad, y: r.y / s - pad, w: r.w / s, h: r.h / s, scale: s };
  }

  /** Один CSS-слой фона, отрисованный браузером в коробке w×h. */
  async renderCss(css: Record<string, string>, w: number, h: number, baseUrl: string, scale: number): Promise<RasterResult> {
    const s = budgetScale(scale, w, h);
    const style = Object.entries(css).map(([k, v]) => `${k}:${v}`).join(';');
    const html = `<div style="position:absolute;left:0;top:0;width:${w}px;height:${h}px;transform-origin:0 0;transform:scale(${s});${style.replace(/"/g, "'")}"></div>`;
    const png = await this.shot(html, w * s, h * s, baseUrl);
    return { png, x: 0, y: 0, w, h, scale: s };
  }

  /** Перекодирование (webp/avif/svg/bmp → PNG), уменьшение до 4096 px, запекание CSS filter. */
  async transcode(bytes: Buffer, mime: string, opts: { filter?: string; width?: number; height?: number; scale?: number; jpeg?: number }): Promise<{ png: Buffer; width: number; height: number }> {
    const page = await this.ensure();
    await page.setContent('<!doctype html><html><body></body></html>');
    const dataUrl = `data:${mime};base64,${bytes.toString('base64')}`;
    const res = await page.evaluate(async ({ dataUrl, filter, w, h, scale, max, mime, jpeg }) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      let tw = w || img.naturalWidth || 300, th = h || img.naturalHeight || 150;
      if (mime === 'image/svg+xml' && scale) { tw *= scale; th *= scale; }
      const k = Math.min(1, max / tw, max / th);
      tw = Math.max(1, Math.round(tw * k)); th = Math.max(1, Math.round(th * k));
      const c = document.createElement('canvas');
      c.width = tw; c.height = th;
      const ctx = c.getContext('2d')!;
      if (filter) ctx.filter = filter;
      ctx.drawImage(img, 0, 0, tw, th);
      return { url: jpeg ? c.toDataURL('image/jpeg', jpeg) : c.toDataURL('image/png'), width: tw, height: th };
    }, { dataUrl, filter: opts.filter ?? '', w: opts.width ?? 0, h: opts.height ?? 0, scale: opts.scale ?? 1, max: MAX, mime, jpeg: opts.jpeg ?? 0 });
    return { png: Buffer.from(res.url.split(',')[1], 'base64'), width: res.width, height: res.height };
  }
}
