// Установочный пакет: dist/package/HtmlToFigma/ и dist/HtmlToFigma-<версия>.zip.
// Воспроизводимость: сначала полная сборка, файлы в отсортированном порядке,
// фиксированная дата в ZIP, без временных меток и путей машины сборки.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = (...p) => path.join(root, ...p);
const pkg = JSON.parse(fs.readFileSync(r('package.json'), 'utf8'));
const NAME = 'HtmlToFigma';
const stage = r('dist', 'package', NAME);

if (!process.argv.includes('--no-build')) execFileSync(process.execPath, [r('scripts/build.mjs')], { stdio: 'inherit' });

fs.rmSync(r('dist', 'package'), { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

const put = (rel, data) => { const f = path.join(stage, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };
const copy = (from, rel) => put(rel, fs.readFileSync(r(from)));
const crlf = (s) => s.replace(/\r?\n/g, '\r\n');
const copyDir = (from, rel, skip = () => false) => {
  for (const f of fs.readdirSync(from).sort()) {
    const p = path.join(from, f);
    if (skip(p)) continue;
    if (fs.statSync(p).isDirectory()) copyDir(p, path.join(rel, f), skip);
    else put(path.join(rel, f), fs.readFileSync(p));
  }
};

// плагин Figma
for (const f of ['manifest.json', 'code.js', 'ui.html']) copy(`plugin/dist/${f}`, `figma-plugin/${f}`);
// обработчик
for (const f of ['processor.cjs', 'web.js', 'index.html']) copy(`processor/dist/${f}`, `processor/${f}`);
copyDir(r('processor', 'profiles'), 'processor/profiles');
// единственная зависимость времени выполнения (Apache-2.0, LICENSE/NOTICE внутри)
const pw = r('node_modules', 'playwright-core');
const pwVer = JSON.parse(fs.readFileSync(path.join(pw, 'package.json'), 'utf8')).version;
if (pwVer !== pkg.dependencies['playwright-core']) throw new Error(`playwright-core ${pwVer} не совпадает с package.json (${pkg.dependencies['playwright-core']}) — выполните npm ci`);
copyDir(pw, 'processor/node_modules/playwright-core', (p) => /\.map$/.test(p));
// запуск
put('start-windows.cmd', crlf(fs.readFileSync(r('packaging/start-windows.cmd'), 'utf8')));
put('install-browser.cmd', crlf(fs.readFileSync(r('packaging/install-browser.cmd'), 'utf8')));
put('start.sh', fs.readFileSync(r('packaging/start.sh'), 'utf8').replace(/\r\n/g, '\n'));
copy('packaging/tools/get-node.ps1', 'tools/get-node.ps1');
// пример для первой проверки: 2 страницы, шрифты и их лицензии внутри ZIP
{
  const ex = [];
  const add = (from, name) => ex.push({ name, data: fs.readFileSync(from) });
  for (const f of fs.readdirSync(r('tests/fixtures/ui-flow')).sort()) add(r('tests/fixtures/ui-flow', f), f);
  add(r('tests/fixtures/blogs/fonts.css'), 'fonts.css');
  for (const f of fs.readdirSync(r('tests/fixtures/blogs/Fonts')).sort()) {
    const p = r('tests/fixtures/blogs/Fonts', f);
    if (fs.statSync(p).isDirectory()) { for (const l of fs.readdirSync(p).sort()) add(path.join(p, l), `Fonts/${f}/${l}`); }
    else add(p, `Fonts/${f}`);
  }
  put('examples/masterskaya.zip', zipFiles(ex));
}
// документация и отчёты
for (const f of ['README-RU.md', 'SUPPORT-RU.md', 'VERIFICATION-RU.md']) copy(f, f);
copyDir(r('reports'), 'reports');
put('VERSION.txt', `HTML → Figma (локальный импорт) ${pkg.version}\nplaywright-core ${pwVer}\nсхема IR и протокол — см. figma-plugin/code.js и processor/processor.cjs\n`);

// контрольные суммы
const files = [];
const walk = (d, rel = '') => { for (const f of fs.readdirSync(d).sort()) { const p = path.join(d, f); const q = rel ? rel + '/' + f : f; if (fs.statSync(p).isDirectory()) walk(p, q); else files.push(q); } };
walk(stage);
const sums = files.filter((f) => !f.startsWith('processor/node_modules/')).map((f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(stage, f))).digest('hex') + '  ' + f).join('\n') + '\n';
put('SHA256SUMS.txt', sums);
files.push('SHA256SUMS.txt');
files.sort();

// ZIP (deflate, UTF-8 имена, фиксированная дата 2026-01-01 00:00)
function zipFiles(entries) {
  const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const DOS_TIME = 0, DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const data = e.data;
    const name = Buffer.from(e.name, 'utf8');
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(DOS_TIME, 10); lh.writeUInt16LE(DOS_DATE, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(0x0314, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(DOS_TIME, 12); ch.writeUInt16LE(DOS_DATE, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(((e.exec ? 0o100755 : 0o100644) << 16) >>> 0, 38); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
const zip = zipFiles(files.map((f) => ({ name: `${NAME}/${f}`, data: fs.readFileSync(path.join(stage, f)), exec: f.endsWith('.sh') })));
const out = r('dist', `${NAME}-${pkg.version}.zip`);
for (const old of fs.readdirSync(r('dist')).filter((f) => /^HtmlToFigma-.*\.zip$/.test(f))) fs.rmSync(r('dist', old));
fs.writeFileSync(out, zip);
fs.chmodSync(path.join(stage, 'start.sh'), 0o755);
console.log(`пакет: ${path.relative(root, out)} · ${(zip.length / 1048576).toFixed(2)} МБ · ${files.length} файлов · sha256 ${crypto.createHash('sha256').update(zip).digest('hex')}`);
