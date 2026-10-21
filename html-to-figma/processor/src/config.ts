/*
 * Конфигурация обработчика: порт, лимиты, папка данных, код подключения и токены.
 * Код подключения (pairing code) показывается в окне обработчика и вводится в
 * плагине один раз; плагин получает длинный токен и хранит его в clientStorage.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Limits {
  maxUploadBytes: number;
  maxZipEntries: number;
  maxZipTotalBytes: number;
  maxFileBytes: number;
  maxRoutes: number;
  maxDepth: number;
  perShapeLimit: number;
  discoveryTimeoutMs: number;
  routeTimeoutMs: number;
  maxNodesPerRoute: number;
  maxCharsPerRoute: number;
  maxAssetsPerJob: number;
  maxAssetBytesPerJob: number;
  concurrency: number;
  jobTtlHours: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxUploadBytes: 300 * 1024 * 1024,
  maxZipEntries: 5000,
  maxZipTotalBytes: 1024 * 1024 * 1024,
  maxFileBytes: 200 * 1024 * 1024,
  maxRoutes: 80,
  maxDepth: 4,
  perShapeLimit: 12,
  discoveryTimeoutMs: 240_000,
  routeTimeoutMs: 90_000,
  maxNodesPerRoute: 30_000,
  maxCharsPerRoute: 400_000,
  maxAssetsPerJob: 4000,
  maxAssetBytesPerJob: 800 * 1024 * 1024,
  concurrency: 2,
  jobTtlHours: 24,
};

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  limits: Limits;
  pairingCode: string;
  tokens: string[];
  profilesDir: string;
}

function defaultDataDir(): string {
  if (process.env.H2F_DATA) return process.env.H2F_DATA;
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'HtmlToFigma');
  return path.join(os.homedir(), '.html-to-figma');
}

function code(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.randomBytes(10);
  let s = '';
  for (let i = 0; i < 10; i++) s += alphabet[b[i] % alphabet.length];
  return s.slice(0, 5) + '-' + s.slice(5);
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const dataDir = overrides.dataDir ?? defaultDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'config.json');
  let saved: Partial<Config> & { limits?: Partial<Limits> } = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* первый запуск */ }
  const cfg: Config = {
    port: Number(process.env.H2F_PORT) || overrides.port || saved.port || 47821,
    host: '127.0.0.1',
    dataDir,
    limits: { ...DEFAULT_LIMITS, ...(saved.limits ?? {}), ...(overrides.limits ?? {}) },
    pairingCode: overrides.pairingCode ?? saved.pairingCode ?? code(),
    tokens: overrides.tokens ?? saved.tokens ?? [],
    profilesDir: overrides.profilesDir ?? '',
  };
  if (!overrides.dataDir || !process.env.H2F_EPHEMERAL) saveConfig(cfg);
  return cfg;
}

export function saveConfig(cfg: Config) {
  const file = path.join(cfg.dataDir, 'config.json');
  const { port, limits, pairingCode, tokens } = cfg;
  fs.writeFileSync(file, JSON.stringify({ port, limits, pairingCode, tokens }, null, 2), { mode: 0o600 });
}

export function issueToken(cfg: Config): string {
  const t = crypto.randomBytes(32).toString('base64url');
  cfg.tokens = [...cfg.tokens.slice(-9), t];
  saveConfig(cfg);
  return t;
}

export function tokenValid(cfg: Config, t: string | undefined | null): boolean {
  if (!t) return false;
  const a = Buffer.from(t);
  return cfg.tokens.some((x) => { const b = Buffer.from(x); return a.length === b.length && crypto.timingSafeEqual(a, b); });
}
