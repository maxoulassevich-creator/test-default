/*
 * Запуск распространяемого обработчика так, как его запускает пользователь:
 * отдельный процесс `node processor.cjs` (из сборки и из установочного пакета, если он
 * собран). Проверяются баннер с кодом подключения, страница резервного режима,
 * /api/health, сопряжение кодом, отказ без токена и с чужим Host (DNS rebinding),
 * повторный запуск на занятом порту — понятная ошибка.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from '../support/env';

function freePort(): Promise<number> {
  return new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); });
}

function launch(script: string, port: number, data: string): { child: ChildProcess; out: () => string; ready: Promise<void>; exited: Promise<number | null> } {
  let buf = '';
  const child = spawn(process.execPath, [script], { env: { ...process.env, H2F_PORT: String(port), H2F_DATA: data }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout!.on('data', (d) => { buf += d; });
  child.stderr!.on('data', (d) => { buf += d; });
  const exited = new Promise<number | null>((res) => child.on('exit', (c) => res(c)));
  const ready = new Promise<void>((res, rej) => {
    const t0 = Date.now();
    const tick = () => { if (/Обработчик работает/.test(buf)) res(); else if (Date.now() - t0 > 60000 || child.exitCode !== null) rej(new Error('не запустился: ' + buf)); else setTimeout(tick, 100); };
    tick();
  });
  return { child, out: () => buf, ready, exited };
}

function raw(port: number, p: string, headers: Record<string, string> = {}, method = 'GET', body?: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((res, rej) => {
    const q = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (r) => { let b = ''; r.setEncoding('utf8'); r.on('data', (d) => { b += d; }); r.on('end', () => res({ status: r.statusCode ?? 0, body: b, headers: r.headers })); });
    q.on('error', rej);
    if (body) q.write(body);
    q.end();
  });
}

const targets = [path.join(ROOT, 'processor', 'dist', 'processor.cjs')];
const packaged = path.join(ROOT, 'dist', 'package', 'HtmlToFigma', 'processor', 'processor.cjs');
if (fs.existsSync(packaged)) targets.push(packaged);

for (const script of targets) {
  test('запуск ' + path.relative(ROOT, script), async () => {
    const port = await freePort();
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'h2f-launch-'));
    const p = launch(script, port, data);
    try {
      await p.ready;
      const code = /Код подключения:\s+([A-Z0-9]{5}-[A-Z0-9]{5})/.exec(p.out())?.[1];
      assert.ok(code, 'код подключения в окне: ' + p.out());
      assert.match(p.out(), /Браузер:\s+\S+/, 'строка о браузере');
      const page = await raw(port, '/', { host: `127.0.0.1:${port}` });
      assert.equal(page.status, 200);
      assert.match(page.body, /<script src="\/?web\.js"/, 'страница резервного режима');
      assert.equal((await raw(port, '/web.js', { host: `127.0.0.1:${port}` })).status, 200);
      const h = JSON.parse((await raw(port, '/api/health', { host: `127.0.0.1:${port}` })).body);
      assert.equal(h.paired, false);
      assert.equal((await raw(port, '/api/health', { host: `evil.example:${port}` })).status, 403, 'чужой Host отклоняется');
      assert.equal((await raw(port, '/api/jobs', { host: `127.0.0.1:${port}`, 'x-h2f-protocol': String(h.protocol) }, 'POST', 'x')).status, 401, 'без токена нельзя');
      const bad = await raw(port, '/api/pair', { host: `127.0.0.1:${port}`, 'content-type': 'application/json' }, 'POST', JSON.stringify({ code: 'AAAAA-AAAAA' }));
      assert.notEqual(bad.status, 200, 'неверный код не принимается');
      const ok = JSON.parse((await raw(port, '/api/pair', { host: `127.0.0.1:${port}`, 'content-type': 'application/json' }, 'POST', JSON.stringify({ code }))).body);
      assert.ok(ok.token && ok.token.length >= 32, 'токен выдан');
      const h2 = JSON.parse((await raw(port, '/api/health', { host: `127.0.0.1:${port}`, authorization: 'Bearer ' + ok.token })).body);
      assert.equal(h2.paired, true);
      // второй экземпляр на том же порту — понятная ошибка, а не падение
      const second = launch(script, port, data);
      const codeExit = await second.exited;
      assert.equal(codeExit, 1);
      assert.match(second.out(), /уже занят/);
    } finally {
      p.child.kill('SIGTERM');
      await p.exited;
      fs.rmSync(data, { recursive: true, force: true });
    }
  });
}
