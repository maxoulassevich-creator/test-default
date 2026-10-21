/*
 * Точка входа скрипта, который обработчик внедряет в изолированную страницу
 * (через page.evaluate). Экспортирует API в window[__H2F_KEY__].
 */
import { collectLinks, fingerprint, linkLabel } from './discover';
import { clearHoverMarks, findHoverCandidates, hoverStyleSnapshot, installHoverPinning, labelOf, pinHover, rewriteHoverSelector, uninstallHoverPinning, type HoverCandidateRaw } from './hover';
import { finishAnimations, scrollPass, settle, snapshotFixed, type RevealPose } from './settle';
import { describe } from './style';
import { beginCapture, cleanup, finish, measure, setNeutral, shotIsolation, type CaptureOptions, type PseudoBox } from './walk';

declare const __H2F_KEY__: string;

let poses = new Map<Element, RevealPose>();
let candidates: HoverCandidateRaw[] = [];
let hoverState: { card: Element | null; point: [number, number] | null } = { card: null, point: null };

function excluder(sel: string[]) {
  const valid = sel.filter((s) => { try { document.querySelector(s); return true; } catch { return false; } });
  return (e: Element) => valid.some((s) => { try { return !!e.closest(s); } catch { return false; } });
}

const api = {
  version: 1,
  settle,
  finishAnimations,
  snapshotFixed,
  async scrollPass(opts?: { stepRatio?: number; maxSteps?: number; waitMs?: number }) {
    const r = await scrollPass(opts);
    poses = r.poses;
    return { steps: r.steps, poses: r.poses.size, headerRestored: r.headerRestored };
  },
  links(exclude: string[]) { return collectLinks(excluder(exclude)); },
  linkLabel,
  fingerprint(exclude: string[]) { return fingerprint(excluder(exclude)); },
  installHoverPinning,
  uninstallHoverPinning,
  rewriteHoverSelector,
  hoverCandidates(exclude: string[]) {
    candidates = findHoverCandidates(excluder(exclude));
    return candidates.map((c) => ({ index: c.index, selector: c.selector, label: c.label, score: +c.score.toFixed(3), box: c.box.map((v) => +v.toFixed(1)), changes: c.changes, props: c.props }));
  },
  async pin(index: number | null, selector: string | null) {
    clearHoverMarks();
    hoverState = { card: null, point: null };
    let card: Element | null = null;
    if (selector) { try { card = document.querySelector(selector); } catch { card = null; } }
    if (!card && index !== null && candidates[index]) card = candidates[index].el;
    if (!card) return null;
    const r = await pinHover(card, describe);
    hoverState = { card, point: r.point };
    return { ...r, label: labelOf(card) };
  },
  /** Снимок стилей поддерева выбранной карточки (для сравнения с настоящим наведением). */
  hoverSnapshot(selector: string | null, index: number | null) {
    let card: Element | null = hoverState.card;
    if (selector) { try { card = document.querySelector(selector); } catch { /* */ } }
    if (!card && index !== null && candidates[index]) card = candidates[index].el;
    return card ? hoverStyleSnapshot(card) : null;
  },
  markCard(selector: string | null, index: number | null) {
    let card: Element | null = null;
    if (selector) { try { card = document.querySelector(selector); } catch { /* */ } }
    if (!card && index !== null && candidates[index]) card = candidates[index].el;
    if (!card) return false;
    card.setAttribute('data-h2f-card', '');
    return true;
  },
  async begin(opts: CaptureOptions) { return beginCapture(opts, poses, hoverState); },
  neutral(on: boolean) { setNeutral(on); },
  measure(boxes: Record<string, PseudoBox>) { measure(boxes); return true; },
  finish,
  cleanup,
  shotIsolation,
};

(window as unknown as Record<string, unknown>)[__H2F_KEY__] = api;
export type CaptureApi = typeof api;
