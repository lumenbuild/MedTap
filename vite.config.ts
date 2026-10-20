import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import type { Plugin } from 'vite';

// Label scanning runs Tesseract on the phone. Serve its worker, WebAssembly and English data from our own site
// (ocr/), never a CDN, so nothing about the person's medications is requested from anyone else.
const require = createRequire(import.meta.url);
const OCR_FILES = [
  require.resolve('tesseract.js/dist/worker.min.js'),
  ...['tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js']
    .map((f) => join(dirname(require.resolve('tesseract.js-core/package.json')), f)),
  join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int/eng.traineddata.gz'),
];
function ocrAssets(): Plugin {
  return {
    name: 'ocr-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = OCR_FILES.find((f) => req.url?.endsWith(`/ocr/${basename(f)}`));
        if (!file) return next();
        res.setHeader('Content-Type', file.endsWith('.gz') ? 'application/octet-stream' : 'text/javascript');
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const f of OCR_FILES) {
        // Android's packager unzips .gz assets and drops the extension, so app builds ship the language data
        // uncompressed under its plain name (and src/app/ocr.ts asks for that name in the app).
        if (native && f.endsWith('.gz')) this.emitFile({ type: 'asset', fileName: `ocr/${basename(f, '.gz')}`, source: gunzipSync(readFileSync(f)) });
        else this.emitFile({ type: 'asset', fileName: `ocr/${basename(f)}`, source: readFileSync(f) });
      }
    },
  };
}

// BASE_PATH lets the app be tested at username.github.io/repo/ before the custom domain exists.
const base = process.env.BASE_PATH ?? '/';
// NATIVE=1 builds for the iOS/Android app: no service worker (the app ships its files itself).
const native = !!process.env.NATIVE;

export default defineConfig({
  base,
  plugins: [
    react(),
    ocrAssets(),
    VitePWA({
      disable: native,
      registerType: 'prompt',
      includeAssets: ['icons/apple-touch-icon.png', 'icons/icon.svg'],
      manifest: {
        name: 'MedTap',
        short_name: 'MedTap',
        description: 'Log doses with an NFC tap and track how you feel. Your data stays on your phone.',
        theme_color: '#0B7A75',
        background_color: '#F6F7F9',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,woff}'],
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist: [/^\/404\.html$/],
        // The label reader is big; it's cached the first time someone scans a label, not up front.
        globIgnores: ['ocr/**'],
        runtimeCaching: [{ urlPattern: /\/ocr\//, handler: 'CacheFirst', options: { cacheName: 'ocr', expiration: { maxEntries: 10 } } }],
      },
    }),
  ],
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
