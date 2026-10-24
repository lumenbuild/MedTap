// Read a product barcode on the phone, from a photo or live from the camera: the browser's own barcode reader where
// there is one (Android), otherwise ZXing (loaded only when needed).
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

type Detector = { detect: (src: ImageBitmapSource) => Promise<{ rawValue: string }[]> };
declare global { interface Window { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> } } }

async function bitmap(file: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d', { willReadFrequently: true })!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

let detector: Detector | null | undefined;
/** The browser's barcode reader, if it has one that reads product barcodes. */
async function nativeDetector(): Promise<Detector | null> {
  if (detector !== undefined) return detector;
  try {
    const BD = window.BarcodeDetector;
    const ok = BD && (!BD.getSupportedFormats || (await BD.getSupportedFormats()).some((f) => FORMATS.includes(f)));
    detector = ok ? new BD!({ formats: FORMATS }) : null;
  } catch { detector = null; }
  return detector;
}

type Zx = typeof import('@zxing/library');
let zx: Promise<{ z: Zx; reader: InstanceType<Zx['MultiFormatReader']> }> | null = null;
function zxing(tryHarder: boolean) {
  zx ??= import('@zxing/library').then((z) => ({ z, reader: new z.MultiFormatReader() }));
  return zx.then(({ z, reader }) => {
    const hints = new Map<import('@zxing/library').DecodeHintType, unknown>();
    hints.set(z.DecodeHintType.POSSIBLE_FORMATS, [z.BarcodeFormat.EAN_13, z.BarcodeFormat.EAN_8, z.BarcodeFormat.UPC_A, z.BarcodeFormat.UPC_E]);
    if (tryHarder) hints.set(z.DecodeHintType.TRY_HARDER, true);
    reader.setHints(hints);
    return { z, reader };
  });
}

/** ZXing on a canvas, as it is and (photos) turned a quarter, for a barcode photographed sideways. */
async function zxingCanvas(canvas: HTMLCanvasElement, sideways: boolean): Promise<string | null> {
  const { z, reader } = await zxing(sideways);
  const lumOf = (c: HTMLCanvasElement) => {
    const { data, width, height } = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height);
    const lum = new Uint8ClampedArray(width * height);
    for (let i = 0; i < lum.length; i++) lum[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000;
    return new z.RGBLuminanceSource(lum, width, height);
  };
  const tries = [canvas];
  if (sideways) {
    const turned = document.createElement('canvas');
    turned.width = canvas.height; turned.height = canvas.width;
    const tg = turned.getContext('2d', { willReadFrequently: true })!;
    tg.translate(turned.width, 0); tg.rotate(Math.PI / 2); tg.drawImage(canvas, 0, 0);
    tries.push(turned);
  }
  for (const c of tries) {
    try { return reader.decode(new z.BinaryBitmap(new z.HybridBinarizer(lumOf(c)))).getText(); } catch { /* next */ }
  }
  return null;
}

/** The barcode's digits in a photo, or null if none could be read. */
export async function readBarcode(file: Blob): Promise<string | null> {
  const canvas = await bitmap(file);
  const d = await nativeDetector();
  if (d) {
    try {
      const found = await d.detect(canvas);
      if (found[0]?.rawValue) return found[0].rawValue;
    } catch { /* fall back to ZXing */ }
  }
  return zxingCanvas(canvas, true);
}

/** A reader for live camera frames: reads the middle band of the picture (where the guide is) each time it's called. */
export async function frameReader(): Promise<(video: HTMLVideoElement) => Promise<string | null>> {
  const d = await nativeDetector();
  const c = document.createElement('canvas');
  return async (video) => {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return null;
    if (d) {
      try { const found = await d.detect(video); return found[0]?.rawValue ?? null; } catch { /* ZXing below */ }
    }
    // The middle 80% across and 40% down, scaled to at most 800 wide: quick enough for a few frames a second.
    const sw = Math.round(w * 0.8), sh = Math.round(h * 0.4);
    const scale = Math.min(1, 800 / sw);
    c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
    c.getContext('2d', { willReadFrequently: true })!.drawImage(video, (w - sw) / 2, (h - sh) / 2, sw, sh, 0, 0, c.width, c.height);
    return zxingCanvas(c, false);
  };
}

/** EAN/UPC digits with a valid check digit. */
export function validBarcode(code: string): boolean {
  const d = code.replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(d.length)) return false;
  const digits = d.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((s, x, i) => s + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}
