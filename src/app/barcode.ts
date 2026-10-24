// Read a product barcode from a photo, on the phone: the browser's own barcode reader where there is one (Android),
// otherwise ZXing (loaded only when needed).
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

/** The barcode's digits, or null if none could be read. */
export async function readBarcode(file: Blob): Promise<string | null> {
  const canvas = await bitmap(file);
  if (window.BarcodeDetector) {
    try {
      const found = await new window.BarcodeDetector({ formats: FORMATS }).detect(canvas);
      if (found[0]?.rawValue) return found[0].rawValue;
    } catch { /* fall back to ZXing */ }
  }
  const z = await import('@zxing/library');
  const hints = new Map<import('@zxing/library').DecodeHintType, unknown>();
  hints.set(z.DecodeHintType.POSSIBLE_FORMATS, [z.BarcodeFormat.EAN_13, z.BarcodeFormat.EAN_8, z.BarcodeFormat.UPC_A, z.BarcodeFormat.UPC_E]);
  hints.set(z.DecodeHintType.TRY_HARDER, true);
  const reader = new z.MultiFormatReader();
  reader.setHints(hints);
  const lumOf = (c: HTMLCanvasElement) => {
    const { data, width, height } = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height);
    const lum = new Uint8ClampedArray(width * height);
    for (let i = 0; i < lum.length; i++) lum[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000;
    return new z.RGBLuminanceSource(lum, width, height);
  };
  // As it is, then turned a quarter (a barcode photographed sideways).
  const turned = document.createElement('canvas');
  turned.width = canvas.height; turned.height = canvas.width;
  const tg = turned.getContext('2d', { willReadFrequently: true })!;
  tg.translate(turned.width, 0); tg.rotate(Math.PI / 2); tg.drawImage(canvas, 0, 0);
  for (const c of [canvas, turned]) {
    try { return reader.decode(new z.BinaryBitmap(new z.HybridBinarizer(lumOf(c)))).getText(); } catch { /* next */ }
  }
  return null;
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
