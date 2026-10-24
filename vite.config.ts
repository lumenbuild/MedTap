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
      // The Android build checks this matches the app it's building (android/app/build.gradle).
      if (native) this.emitFile({ type: 'asset', fileName: 'edition.txt', source: process.env.VITE_STORE === 'play' ? `${editionId}+play` : editionId });
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
// VITE_EDITION picks the app (see src/edition.ts); MedTap by default. The others' websites live in folders under
// MedTap's (tapdose/, tapweigh/, taplift/), so MedTap's service worker must leave those folders alone.
const EDITIONS = ['medtap', 'tapdose', 'tapweigh', 'taplift'] as const;
const editionId = EDITIONS.find((e) => e === process.env.VITE_EDITION) ?? 'medtap';
const BRANDS = {
  medtap: { name: 'MedTap', icons: 'icons/', description: 'Log doses with an NFC tap and track how you feel. Your data stays on your phone.' },
  tapdose: { name: 'TapDose', icons: 'icons/tapdose/', description: 'Log doses with an NFC tap, see when the next one is due, and track how you feel. Your data stays on your phone.' },
  tapweigh: { name: 'TapWeigh', icons: 'icons/tapweigh/', description: 'Tap an NFC tag on your scales to log your weight, and see where it’s heading. Food, measurements and goals too. Your data stays on your phone.' },
  taplift: { name: 'TapLift', icons: 'icons/taplift/', description: 'Tap an NFC tag on a machine or rack to log your sets, with what to aim for next time. Your data stays on your phone.' },
};
const brand = { ...BRANDS[editionId], theme: '#FFFFFF' };

/** index.html carries __APP_NAME__, __THEME__, __ICONS__ and __EDITION__ for the edition being built. */
function brandHtml(): Plugin {
  return {
    name: 'brand-html',
    transformIndexHtml: (html) => html.replaceAll('__APP_NAME__', brand.name).replaceAll('__THEME__', brand.theme).replaceAll('__ICONS__', brand.icons).replaceAll('__EDITION__', editionId),
  };
}

export default defineConfig({
  base,
  plugins: [
    react(),
    ocrAssets(),
    brandHtml(),
    VitePWA({
      disable: native,
      registerType: 'prompt',
      includeAssets: [`${brand.icons}apple-touch-icon.png`, `${brand.icons}icon.svg`],
      manifest: {
        name: brand.name,
        short_name: brand.name,
        description: brand.description,
        theme_color: brand.theme,
        background_color: '#FFFFFF',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: `${brand.icons}icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${brand.icons}icon-512.png`, sizes: '512x512', type: 'image/png' },
          { src: `${brand.icons}maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,woff}'],
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist: [/^\/404\.html$/, ...(editionId === 'medtap' ? ['tapdose', 'tapweigh', 'taplift'].map((f) => new RegExp(`^${base}${f}/`)) : [])],
        // The label reader is big; it's cached the first time someone scans a label, not up front.
        globIgnores: ['ocr/**'],
        runtimeCaching: [{ urlPattern: /\/ocr\//, handler: 'CacheFirst', options: { cacheName: 'ocr', expiration: { maxEntries: 10 } } }],
      },
    }),
  ],
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
