/*
 * Сетка размещения фреймов на странице Figma: столбцы настраиваются, высота ряда
 * равна высоте самого высокого макета ряда, пересечения с существующими объектами
 * исключаются сдвигом всего комплекта вправо.
 */

export interface Box { x: number; y: number; width: number; height: number }

export interface GridItem { key: string; width: number; height: number }

export interface GridPlacement { key: string; x: number; y: number; slot: [number, number] }

export const GRID_GAP = 200;

export function overlaps(a: Box, b: Box, eps = 0.1): boolean {
  return a.x < b.x + b.width - eps && a.x + a.width > b.x + eps && a.y < b.y + b.height - eps && a.y + a.height > b.y + eps;
}

/** Раскладка по слотам (column,row) относительно начала (0,0). */
export function layoutGrid(items: GridItem[], columns: number, gap = GRID_GAP): GridPlacement[] {
  const cols = Math.max(1, Math.min(24, Math.floor(columns) || 1));
  const colWidth = Math.max(0, ...items.map((i) => i.width));
  const out: GridPlacement[] = [];
  let y = 0;
  for (let start = 0, row = 0; start < items.length; start += cols, row++) {
    const rowItems = items.slice(start, start + cols);
    rowItems.forEach((it, i) => out.push({ key: it.key, x: i * (colWidth + gap), y, slot: [i, row] }));
    y += Math.max(...rowItems.map((i) => i.height)) + gap;
  }
  return out;
}

export function boundsOf(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width)), y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Начало нового комплекта: правее всего существующего содержимого страницы
 * (или в точке origin, если страница пуста). Возвращает абсолютные позиции.
 */
export function placeNewSet(items: GridItem[], columns: number, occupied: Box[], origin: { x: number; y: number }, gap = GRID_GAP): GridPlacement[] {
  const rel = layoutGrid(items, columns, gap);
  const existing = boundsOf(occupied);
  const ox = existing ? existing.x + existing.width + gap : origin.x;
  const oy = existing ? existing.y : origin.y;
  let placed = rel.map((p) => ({ ...p, x: p.x + ox, y: p.y + oy }));
  // страховка: если что-то всё равно пересекается — сдвигаем комплект вправо
  for (let guard = 0; guard < 50; guard++) {
    const hit = placed.some((p, i) => occupied.some((o) => overlaps({ x: p.x, y: p.y, width: items[i].width, height: items[i].height }, o)));
    if (!hit) break;
    const shift = (existing ? existing.width : 1000) + gap;
    placed = placed.map((p) => ({ ...p, x: p.x + shift }));
  }
  return placed;
}

/**
 * Позиция для восстановления пропущенного фрейма существующего комплекта:
 * исходный слот, если он свободен; иначе ближайшее свободное место справа от комплекта.
 */
export function placeIntoSet(item: GridItem, slot: [number, number] | null, setOrigin: { x: number; y: number }, rowTops: number[], colWidth: number, occupied: Box[], gap = GRID_GAP): { x: number; y: number } {
  if (slot) {
    const x = setOrigin.x + slot[0] * (colWidth + gap);
    const y = setOrigin.y + (rowTops[slot[1]] ?? 0);
    if (!occupied.some((o) => overlaps({ x, y, width: item.width, height: item.height }, o))) return { x, y };
  }
  const b = boundsOf(occupied) ?? { x: setOrigin.x, y: setOrigin.y, width: 0, height: 0 };
  let x = b.x + b.width + gap;
  const y = setOrigin.y;
  while (occupied.some((o) => overlaps({ x, y, width: item.width, height: item.height }, o))) x += item.width + gap;
  return { x, y };
}

/** Проверка комплекта на пересечения (используется и тестами, и кнопкой «Проверить»). */
export function findOverlaps(boxes: Array<Box & { key: string }>): Array<[string, string]> {
  const res: Array<[string, string]> = [];
  const sorted = [...boxes].sort((a, b) => a.x - b.x);
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j].x < sorted[i].x + sorted[i].width; j++) {
      if (overlaps(sorted[i], sorted[j])) res.push([sorted[i].key, sorted[j].key]);
    }
  }
  return res;
}
