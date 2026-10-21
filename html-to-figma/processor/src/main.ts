/*
 * Запуск локального обработчика: `node processor.cjs` (или start-windows.cmd).
 * Слушает только loopback: 127.0.0.1 и ::1 (localhost). В окне показывается код подключения.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { GENERATOR_VERSION, PROTOCOL_VERSION } from '../../shared/schema';
import { browserStatus, closeBrowser } from './browser';
import { loadConfig } from './config';
import { JobManager } from './jobs';
import { createServer } from './server';
import { SiteServer } from './site';

export async function startProcessor(opts: { port?: number; dataDir?: string; quiet?: boolean; profilesDirs?: string[]; webDir?: string } = {}) {
  const cfg = loadConfig({ port: opts.port, dataDir: opts.dataDir });
  const site = new SiteServer();
  await site.start();
  const here = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
  const profileDirs = opts.profilesDirs ?? [path.join(here, '..', 'profiles'), path.join(here, 'profiles'), path.join(cfg.dataDir, 'profiles')];
  const jobs = new JobManager(cfg, site, profileDirs);
  // страница резервного режима: index.html + web.js в одной папке (сборка кладёт их рядом с processor.cjs)
  const webDir = opts.webDir ?? [here, path.join(here, 'web'), path.join(here, '..', 'dist')].find((d) => fs.existsSync(path.join(d, 'index.html')) && fs.existsSync(path.join(d, 'web.js'))) ?? here;
  const server = createServer({ cfg, jobs, webDir });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', (e: NodeJS.ErrnoException) => {
        if (e.code === 'EADDRINUSE') reject(Object.assign(new Error(`Порт ${cfg.port} уже занят — возможно, обработчик уже запущен в другом окне.`), { code: 'EADDRINUSE' }));
        else reject(e);
      });
      server.listen(cfg.port, '127.0.0.1', () => resolve());
    });
  } catch (e) {
    // освобождаем уже открытое (сервер сайта), иначе процесс не завершится
    site.stop();
    server.close();
    throw e;
  }
  // «localhost» в Windows сначала разрешается в IPv6 ::1 — слушаем и его (тоже только loopback).
  // Без IPv6 в системе это просто пропускается.
  const server6 = http.createServer();
  for (const l of server.listeners('request')) server6.on('request', l as (...a: unknown[]) => void);
  const v6 = await new Promise<boolean>((resolve) => {
    server6.once('error', () => resolve(false));
    server6.listen(cfg.port, '::1', () => resolve(true));
  });
  const stop = async () => { server.close(); if (v6) server6.close(); site.stop(); for (const j of jobs.jobs.values()) await j.cancel(); await closeBrowser(); };
  return { cfg, site, jobs, server, ipv6: v6, stop };
}

export async function main() {
  const line = '─'.repeat(64);
  console.log(line);
  console.log(` HTML → Figma · локальный обработчик ${GENERATOR_VERSION} (протокол ${PROTOCOL_VERSION})`);
  console.log(line);
  let started;
  try {
    started = await startProcessor();
  } catch (e) {
    console.error('\n ОШИБКА: ' + (e as Error).message);
    console.error(' Закройте другое окно обработчика или измените порт: переменная H2F_PORT.\n');
    process.exit(1);
  }
  const { cfg, stop } = started;
  console.log(` Адрес:            http://localhost:${cfg.port}   (то же: http://127.0.0.1:${cfg.port})`);
  console.log(` Код подключения:  ${cfg.pairingCode}   (вводится в плагине один раз)`);
  console.log(` Папка данных:     ${cfg.dataDir}`);
  console.log(' Проверяю браузер…');
  const b = await browserStatus();
  if (b.ok) console.log(` Браузер:          ${b.name} ${b.version}`);
  else {
    console.log(' Браузер:          НЕ НАЙДЕН');
    console.log('   Установите Microsoft Edge или Google Chrome, либо запустите install-browser.cmd.');
    console.log('   ' + (b.error ?? '').slice(0, 300));
  }
  console.log(line);
  console.log(' Обработчик работает. Не закрывайте это окно, пока импортируете макеты.');
  console.log(' Остановить: Ctrl+C или закрыть окно.');
  console.log(line);
  const bye = async () => { console.log('\n Останавливаю…'); await stop(); process.exit(0); };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}

