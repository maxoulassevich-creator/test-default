import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createZip, extractZip, readEntries, safeEntryPath, ZipError } from '../../processor/src/zip';
import { alphaBounds, compareImages, crop, decodePng, encodePng } from '../../processor/src/png';

test('ZIP: распаковка, кириллица, защита от выхода за пределы', () => {
  const zip = createZip([{ name: 'index.html', data: Buffer.from('<h1>Привет</h1>') }, { name: 'img/логотип.png', data: Buffer.from('x') }]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h2f-zip-'));
  const rep = extractZip(zip, dir);
  assert.deepEqual(rep.files.sort(), ['img/логотип.png', 'index.html']);
  assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), '<h1>Привет</h1>');
  assert.equal(safeEntryPath('../../etc/passwd'), null);
  assert.equal(safeEntryPath('C:\\Windows\\x'), null);
  assert.equal(safeEntryPath('/abs/path.txt'), 'abs/path.txt');
  const evil = createZip([{ name: '../evil.txt', data: Buffer.from('x') }]);
  const r2 = extractZip(evil, dir);
  assert.equal(r2.files.length, 0);
  assert.equal(r2.skipped[0].reason, 'небезопасный путь');
  assert.ok(!fs.existsSync(path.join(path.dirname(dir), 'evil.txt')));
});

test('ZIP: лимиты (zip-бомба, число файлов), повреждённый архив', () => {
  const big = Buffer.alloc(5 * 1024 * 1024, 0);
  const bomb = createZip([{ name: 'z.txt', data: big }]);
  assert.throws(() => extractZip(bomb, fs.mkdtempSync(path.join(os.tmpdir(), 'h2f-zb-')), { maxEntries: 10, maxFileBytes: 1024 * 1024, maxTotalBytes: 10e6, maxRatio: 250 }), ZipError);
  const many = createZip(Array.from({ length: 30 }, (_, i) => ({ name: `f${i}.txt`, data: Buffer.from('1') })));
  assert.throws(() => readEntries(many, { maxEntries: 10, maxFileBytes: 1e6, maxTotalBytes: 1e7, maxRatio: 250 }), /много файлов/);
  assert.throws(() => readEntries(Buffer.from('not a zip at all')), ZipError);
});

test('ZIP: имена CP866 без флага UTF-8 (архивы проводника Windows)', () => {
  const name = Buffer.from([0x8f, 0xe0, 0xa8, 0xa2, 0xa5, 0xe2, 0x2e, 0x68, 0x74, 0x6d, 0x6c]); // «Привет.html» в CP866
  const data = Buffer.from('<p>x</p>');
  const comp = zlib.deflateRawSync(data);
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(0, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
  const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(0, 42);
  const cd = Buffer.concat([ch, name]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(30 + name.length + comp.length, 16);
  const zip = Buffer.concat([lh, name, comp, cd, end]);
  assert.equal(readEntries(zip)[0].name, 'Привет.html');
});

test('PNG: кодирование/декодирование, обрезка по альфе, сравнение', () => {
  const w = 20, h = 10, data = Buffer.alloc(w * h * 4);
  for (let y = 3; y < 6; y++) for (let x = 5; x < 9; x++) { const o = (y * w + x) * 4; data[o] = 200; data[o + 3] = 255; }
  const png = encodePng({ width: w, height: h, data });
  const back = decodePng(png);
  assert.deepEqual([back.width, back.height], [w, h]);
  assert.deepEqual(alphaBounds(back), { x: 5, y: 3, w: 4, h: 3 });
  assert.equal(crop(back, { x: 5, y: 3, w: 4, h: 3 }).data[0], 200);
  assert.equal(compareImages(back, back).changedRatio, 0);
});
