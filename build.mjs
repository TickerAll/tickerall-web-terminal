/**
 * Build the web terminal with esbuild:
 *   - web          → dist/web/web.mjs  (ESM; src/web/index.tsx installs
 *                    window.terminal = WebTerminalApi, then loads the renderer)
 *   - web.js       → a two-line classic-script loader that imports web.mjs
 *   - index.html   → dist/web/index.html  (renderer template, repointed at the
 *                    web bundle, with a CSP that reaches the TickerAll API)
 *
 * Shared code lands in chunks/ (code splitting on the renderer's dynamic import).
 */
import * as esbuild from 'esbuild';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const common = { bundle: true, sourcemap: false, logLevel: 'info', define: { 'process.env.NODE_ENV': '"production"' } };

await rm('dist/web', { recursive: true, force: true });
await mkdir('dist/web', { recursive: true });

// The app. `web.js` installs window.terminal then dynamic-imports the renderer;
// the renderer reads window.terminal at module load, so the order is load-bearing.
await esbuild.build({
  ...common,
  entryPoints: { web: 'src/web/index.tsx' },
  outdir: 'dist/web',
  entryNames: '[name]',
  chunkNames: 'chunks/[name]-[hash]',
  outExtension: { '.js': '.mjs' },
  splitting: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  loader: { '.ttf': 'dataurl' }, // bitmap/pixel-theme fonts → inlined data URL
});

// A classic <script src="web.js"> loader. A host page keeps this exact tag and
// may string-replace it to inject config + a CSP nonce, so it must NOT be a module
// tag. A dynamic import from a classic script resolves against the document base.
await writeFile('dist/web/web.js', '// TickerAll web terminal loader — the app is an ES module (web.mjs + chunks/).\nimport("./web.mjs");\n');

// Generate dist/web/index.html from the renderer template: repointed at the web
// bundle, responsive <html> marker + viewport baked in (before first paint), and a
// CSP that lets the browser reach the TickerAll API (REST + WSS stream). When the
// terminal is embedded, the host page supplies its own document + CSP; this
// standalone HTML is for direct serving / dev. Self-hosting against a different
// API or a direct sign-in endpoint? widen connect-src accordingly.
const WEB_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self' data:; worker-src 'self' blob:; " +
  "connect-src 'self' https://api.tickerall.com wss://api.tickerall.com";
let webHtml = await readFile('src/renderer/index.html', 'utf8');
webHtml = webHtml
  .replace(/<html\b([^>]*)>/, '<html$1 class="web" data-platform="web">')
  .replace('<meta charset="utf-8" />', '<meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />')
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*\/>/, `<meta http-equiv="Content-Security-Policy" content="${WEB_CSP}" />`)
  .replace('href="renderer.css"', 'href="web.css"')
  .replace('src="renderer.js"', 'src="web.js"')
  .replace('<title>TickerAll Terminal</title>', '<title>TickerAll Web Terminal</title>');
for (const [label, needle] of [['viewport', 'name="viewport"'], ['platform marker', 'data-platform="web"']]) {
  if (!webHtml.includes(needle)) {
    throw new Error(`build.mjs web: ${label} injection no-op'd — src/renderer/index.html <html>/<head> shape changed`);
  }
}
await writeFile('dist/web/index.html', webHtml);
console.log('✓ web terminal built → dist/web/');
