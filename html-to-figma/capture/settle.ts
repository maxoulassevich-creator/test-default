/*
 * Ожидание устойчивого состояния страницы: шрифты, изображения, затихание DOM,
 * завершение анимаций, устойчивость геометрии. Один networkidle не используется.
 */

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const frames = (n = 2) => new Promise<void>((r) => {
  let k = 0;
  const step = () => (++k >= n ? r() : requestAnimationFrame(step));
  requestAnimationFrame(step);
});

/** Конечные анимации/переходы — в конечное состояние; бесконечные — на паузу в t=0. */
export function finishAnimations(): { finished: number; paused: number } {
  let finished = 0, paused = 0;
  let list: Animation[] = [];
  try { list = document.getAnimations(); } catch { return { finished, paused }; }
  for (const a of list) {
    try {
      const t = a.effect?.getComputedTiming();
      const end = t?.endTime as number | undefined;
      if (end !== undefined && Number.isFinite(end)) { a.finish(); finished++; }
      else { a.pause(); a.currentTime = 0; paused++; }
    } catch { /* animation может быть отменена страницей */ }
  }
  for (const v of Array.from(document.querySelectorAll('video, audio'))) {
    try { (v as HTMLMediaElement).pause(); } catch { /* */ }
  }
  return { finished, paused };
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([p, sleep(ms).then(() => 'timeout' as const)]);
}

export async function waitMutationsQuiet(quietMs: number, timeoutMs: number): Promise<boolean> {
  let last = performance.now();
  const mo = new MutationObserver(() => { last = performance.now(); });
  mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  const start = performance.now();
  try {
    while (performance.now() - start < timeoutMs) {
      if (performance.now() - last >= quietMs) return true;
      await sleep(Math.min(50, quietMs));
    }
    return false;
  } finally { mo.disconnect(); }
}

export async function waitImages(timeoutMs: number): Promise<{ pending: number; broken: string[] }> {
  const imgs = Array.from(document.images);
  const pending = imgs.filter((i) => !i.complete);
  await withTimeout(Promise.all(pending.map((i) => i.decode().catch(() => undefined))), timeoutMs);
  return {
    pending: imgs.filter((i) => !i.complete).length,
    broken: imgs.filter((i) => i.complete && i.naturalWidth === 0 && (i.currentSrc || i.src)).map((i) => i.currentSrc || i.src).slice(0, 50),
  };
}

function geometrySignature(): string {
  const els = Array.from(document.body?.querySelectorAll('*') ?? []).slice(0, 4000);
  let h = 0;
  for (const e of els) {
    const r = e.getBoundingClientRect();
    h = (h * 31 + Math.round(r.x * 4) * 7 + Math.round(r.y * 4) * 13 + Math.round(r.width * 4) * 17 + Math.round(r.height * 4)) | 0;
  }
  return `${els.length}:${h}:${document.documentElement.scrollHeight}`;
}

export interface SettleReport { fonts: string; mutationsQuiet: boolean; pendingImages: number; brokenImages: string[]; stable: boolean; animations: { finished: number; paused: number }; ms: number }

export async function settle(opts: { timeoutMs?: number; quietMs?: number } = {}): Promise<SettleReport> {
  const t0 = performance.now();
  const timeout = opts.timeoutMs ?? 8000;
  const fonts = await withTimeout(document.fonts.ready.then(() => 'ready'), Math.min(timeout, 6000));
  const quiet = await waitMutationsQuiet(opts.quietMs ?? 250, Math.min(timeout, 5000));
  const img = await waitImages(Math.min(timeout, 5000));
  let animations = finishAnimations();
  await frames(2);
  let stable = false;
  let sig = geometrySignature();
  for (let i = 0; i < 10 && performance.now() - t0 < timeout; i++) {
    await sleep(80);
    animations = finishAnimations();
    await frames(1);
    const next = geometrySignature();
    if (next === sig) { stable = true; break; }
    sig = next;
  }
  return { fonts: String(fonts), mutationsQuiet: quiet, pendingImages: img.pending, brokenImages: img.broken, stable, animations, ms: Math.round(performance.now() - t0) };
}

export interface RevealPose { opacity: string; visibility: string; transform: string; translate: string; rotate: string; scale: string; filter: string }

/**
 * Пробная прокрутка для lazy loading и reveal-эффектов. Для элементов, которые
 * при попадании в зону видимости становятся видимыми, запоминается «поза в зоне
 * видимости», чтобы полный макет показывал раскрытое содержимое, не меняя раскладку.
 * После прокрутки страница возвращается в начало, анимации завершаются.
 */
export async function scrollPass(opts: { stepRatio?: number; maxSteps?: number; waitMs?: number } = {}): Promise<{ steps: number; poses: Map<Element, RevealPose>; headerRestored: boolean }> {
  const poses = new Map<Element, RevealPose>();
  const vh = innerHeight;
  const H = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0);
  const fixedBefore = snapshotFixed();
  const cand: Element[] = [];
  for (const e of Array.from(document.body?.querySelectorAll('*') ?? [])) {
    const cs = getComputedStyle(e);
    if (parseFloat(cs.opacity) < 1 || cs.visibility === 'hidden' || cs.transform !== 'none' || cs.translate !== 'none' || cs.filter !== 'none') cand.push(e);
  }
  const step = Math.max(200, vh * (opts.stepRatio ?? 0.7));
  const maxSteps = opts.maxSteps ?? 80;
  let steps = 0;
  for (let y = 0; y < H && steps < maxSteps; y += step, steps++) {
    window.scrollTo({ top: y, left: 0, behavior: 'instant' as ScrollBehavior });
    await frames(2);
    await sleep(opts.waitMs ?? 70);
    finishAnimations();
    await frames(1);
    for (const e of cand) {
      const r = e.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) continue;
      const cs = getComputedStyle(e);
      const prev = poses.get(e);
      if (!prev || parseFloat(cs.opacity) > parseFloat(prev.opacity) || (prev.visibility === 'hidden' && cs.visibility !== 'hidden')) {
        poses.set(e, { opacity: cs.opacity, visibility: cs.visibility, transform: cs.transform, translate: cs.translate, rotate: cs.rotate, scale: cs.scale, filter: cs.filter });
      }
    }
  }
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  await frames(2);
  await sleep(150);
  finishAnimations();
  await frames(2);
  const headerRestored = snapshotFixed() === fixedBefore;
  return { steps, poses, headerRestored };
}

/** Снимок fixed/sticky-элементов (классы и геометрия) для контроля восстановления шапки. */
export function snapshotFixed(): string {
  const parts: string[] = [];
  for (const e of Array.from(document.body?.querySelectorAll('*') ?? [])) {
    const cs = getComputedStyle(e);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
    const r = e.getBoundingClientRect();
    parts.push(`${e.tagName}.${e.getAttribute('class') ?? ''}:${Math.round(r.top)}:${Math.round(r.height)}:${cs.backgroundColor}:${cs.boxShadow}:${cs.transform}`);
  }
  return parts.join('|');
}
