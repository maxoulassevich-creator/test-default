// Воспроизводимая сборка: capture-бандл, обработчик, плагин (code.js + ui.html), тесты.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const r = (...p) => path.join(root, ...p);
const common = { bundle: true, logLevel: 'warning', legalComments: 'none', charset: 'utf8' };

// 1. скрипт захвата (исполняется внутри недоверенной страницы)
const cap = await build({
  ...common, entryPoints: [r('capture/index.ts')], format: 'iife', platform: 'browser', target: 'chrome110', write: false,
  define: { __H2F_KEY__: '"__H2F_KEY_PLACEHOLDER__"' }, minify: !args.has('--dev'),
});
fs.mkdirSync(r('build'), { recursive: true });
const captureJs = cap.outputFiles[0].text;
fs.writeFileSync(r('build/capture.js'), captureJs);

// 2. обработчик (Node), capture-бандл встраивается строкой
await build({
  ...common, entryPoints: [r('processor/src/cli.ts')], outfile: r('processor/dist/processor.cjs'), platform: 'node', target: 'node20', format: 'cjs',
  external: ['playwright-core'], define: { __CAPTURE_SOURCE__: JSON.stringify(captureJs) }, sourcemap: false,
});

// 3. плагин: sandbox-код
await build({ ...common, entryPoints: [r('plugin/src/code.ts')], outfile: r('plugin/dist/code.js'), platform: 'neutral', target: 'es2020', format: 'iife' });

// 4. плагин: UI (скрипт и стили встраиваются в один ui.html)
const ui = await build({ ...common, entryPoints: [r('plugin/src/ui/ui.ts')], write: false, platform: 'browser', target: 'chrome100', format: 'iife', minify: !args.has('--dev') });
const tpl = fs.readFileSync(r('plugin/src/ui/ui.html'), 'utf8');
const css = fs.readFileSync(r('plugin/src/ui/ui.css'), 'utf8');
const uiJs = ui.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
fs.writeFileSync(r('plugin/dist/ui.html'), tpl.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => uiJs));
fs.copyFileSync(r('plugin/manifest.json'), r('plugin/dist/manifest.json'));

// 5. веб-страница обработчика (резервный режим) использует тот же UI-бандл в режиме браузера
await build({ ...common, entryPoints: [r('processor/web/web.ts')], outfile: r('processor/dist/web.js'), platform: 'browser', target: 'chrome100', format: 'iife', minify: !args.has('--dev') });

// 6. тесты
if (args.has('--tests')) {
  const files = [];
  const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.test\.ts$/.test(f)) files.push(p); } };
  walk(r('tests'));
  await build({
    ...common, entryPoints: files, outdir: r('build/tests'), outbase: r('tests'), platform: 'node', target: 'node20', format: 'cjs', outExtension: { '.js': '.cjs' },
    external: ['playwright-core'], define: { __CAPTURE_SOURCE__: JSON.stringify(captureJs) },
  });
}
console.log('build ok');
