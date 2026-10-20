// On-device text recognition (Tesseract, WebAssembly). The photo never leaves the phone.
// Its files are served from our own site under ocr/ (see vite.config.ts), downloaded on the first scan.
import type { Worker } from 'tesseract.js';
import { isNative } from '../platform';

const base = `${import.meta.env.BASE_URL}ocr/`;
let worker: Promise<Worker> | null = null;
let onProgress: ((p: number, stage: string) => void) | null = null;

function getWorker(): Promise<Worker> {
  worker ??= import('tesseract.js').then(({ createWorker, OEM }) =>
    createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: `${base}worker.min.js`,
      corePath: base,
      langPath: base,
      // The app ships the language data uncompressed (see vite.config.ts); the website serves it gzipped.
      gzip: !isNative,
      workerBlobURL: false,
      logger: (m) => onProgress?.(m.progress, m.status),
    }));
  worker.catch(() => { worker = null; });
  return worker;
}

/** Scale big phone photos down: faster, and reads labels just as well. */
async function prepare(file: Blob): Promise<Blob | HTMLCanvasElement> {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  const g = c.getContext('2d')!;
  g.filter = 'grayscale(1) contrast(1.3)';
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

export async function readText(file: Blob, progress: (p: number, stage: string) => void): Promise<string> {
  onProgress = progress;
  try {
    progress(0, 'loading');
    const w = await getWorker();
    const { data } = await w.recognize(await prepare(file));
    return data.text;
  } finally {
    onProgress = null;
  }
}
