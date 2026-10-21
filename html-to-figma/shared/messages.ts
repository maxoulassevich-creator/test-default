/*
 * Сообщения UI ↔ sandbox плагина. У каждой операции сборки есть jobId:
 * устаревшие сообщения прежних попыток отбрасываются.
 */
import type { FontRequirement, RouteSnapshot } from './schema';

export type BuildMode = 'missing' | 'copy' | 'update';

export interface PlanRoute { key: string; label: string; width: number; height: number; viewportHeight: number; fixed: number }

export interface FontChoice { key: string; family: string; style: string; wght?: number }

export type UiToCode =
  | { type: 'init' }
  | { type: 'storage-get'; id: number; key: string }
  | { type: 'storage-set'; id: number; key: string; value: unknown }
  | { type: 'fonts-check'; id: number; fonts: FontRequirement[]; substitutions?: Record<string, string> }
  | { type: 'begin'; jobId: string; project: string; projectLabel: string; source: string; mode: BuildMode; routes: PlanRoute[]; columns: number; fonts: FontChoice[]; viewportMode: boolean }
  | { type: 'asset'; jobId: string; id: string; kind: 'image' | 'svg'; bytes?: Uint8Array; text?: string }
  | { type: 'route'; jobId: string; snapshot: RouteSnapshot; index: number }
  | { type: 'commit'; jobId: string }
  | { type: 'abort'; jobId: string; reason: string }
  | { type: 'cancel'; jobId: string }
  | { type: 'tock'; n: number }
  | { type: 'show'; project?: string; route?: string }
  | { type: 'mode'; project: string; viewport: boolean }
  | { type: 'verify'; project?: string }
  | { type: 'export'; id: number; project: string; route: string }
  | { type: 'notify'; text: string; error?: boolean }
  | { type: 'resize'; width: number; height: number };

export interface SetSummary { project: string; label: string; set: string; source: string; routes: Array<{ key: string; label: string; id: string; edited: boolean; mode: 'design' | 'viewport' }>; createdAt: string }

export interface FontCheckResult { key: string; family: string; weight: number; italic: boolean; found: { family: string; style: string; wght?: number } | null; note?: string }

export type CodeToUi =
  | { type: 'init'; page: string; editor: string; sets: SetSummary[]; storage: Record<string, unknown> }
  | { type: 'storage'; id: number; value: unknown }
  | { type: 'fonts-result'; id: number; results: FontCheckResult[]; families: string[] }
  | { type: 'plan'; jobId: string; build: string[]; skip: Array<{ key: string; reason: string }>; replace: string[] }
  | { type: 'asset-ok'; jobId: string; id: string }
  | { type: 'asset-error'; jobId: string; id: string; message: string }
  | { type: 'progress'; jobId: string; route: string; nodes: number; total: number; index: number }
  | { type: 'route-done'; jobId: string; key: string; nodeId: string; warnings: Array<{ code: string; message: string; node?: string }>; nodes: number }
  | { type: 'done'; jobId: string; summary: { created: number; replaced: number; kept: number; skipped: number; texts: number; nodes: number; warnings: number; set: string } }
  | { type: 'aborted'; jobId: string; removed: number; reason: string }
  | { type: 'error'; jobId?: string; message: string; action?: string }
  | { type: 'tick'; n: number }
  | { type: 'verify-result'; report: VerifyReport }
  | { type: 'export-result'; id: number; route: string; bytes?: Uint8Array; error?: string }
  | { type: 'sets'; sets: SetSummary[] }
  | { type: 'status'; text: string };

export interface VerifyReport {
  frames: number;
  texts: number;
  checkedNodes: number;
  positionIssues: Array<{ route: string; node: string; dx: number; dy: number; dw: number; dh: number }>;
  textIssues: Array<{ route: string; node: string; problem: string }>;
  newOverlaps: Array<{ route: string; a: string; b: string }>;
  frameOverlaps: Array<[string, string]>;
  ok: boolean;
  scope: string;
}
