// Counting tablets or capsules in a photo, on the phone: tablets laid out (not stacked) on a plain background that
// contrasts with them. Classic image steps, no network: greyscale, Otsu threshold (the tablets are the smaller of the
// two areas), a small opening to separate touching edges, connected regions, then each region counts as its area over
// the typical tablet's area (so two touching tablets count as two). The person checks and corrects the count.

export interface Pixels { width: number; height: number; data: Uint8ClampedArray | Uint8Array }
export interface Blob { x: number; y: number; n: number }
export interface TabletCount { count: number; blobs: Blob[]; typicalArea: number }

function otsu(gray: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (const g of gray) hist[g]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; t = i; }
  }
  return t;
}

function erode(m: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(m.length);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    out[i] = m[i] & m[i - 1] & m[i + 1] & m[i - w] & m[i + w];
  }
  return out;
}

function dilate(m: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(m.length);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    out[i] = m[i] | m[i - 1] | m[i + 1] | m[i - w] | m[i + w];
  }
  return out;
}

export function countTablets(img: Pixels): TabletCount {
  const { width: w, height: h, data } = img;
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
  const t = otsu(gray);
  let mask: Uint8Array = new Uint8Array(w * h);
  let above = 0;
  for (let i = 0; i < gray.length; i++) if (gray[i] > t) { mask[i] = 1; above++; }
  if (above > gray.length / 2) for (let i = 0; i < mask.length; i++) mask[i] ^= 1; // tablets are the smaller area
  // Opening (2 erosions, 2 dilations) separates edges that only just touch and removes specks.
  mask = dilate(dilate(erode(erode(mask, w, h), w, h), w, h), w, h);
  const labels = new Int32Array(w * h);
  const regions: { area: number; sx: number; sy: number }[] = [];
  const stack: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || labels[i]) continue;
    const id = regions.length + 1;
    let area = 0, sx = 0, sy = 0;
    labels[i] = id; stack.push(i);
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % w, y = (j - x) / w;
      area++; sx += x; sy += y;
      for (const k of [j - 1, j + 1, j - w, j + w]) {
        if (k < 0 || k >= mask.length || labels[k] || !mask[k]) continue;
        if ((k === j - 1 && x === 0) || (k === j + 1 && x === w - 1)) continue;
        labels[k] = id; stack.push(k);
      }
    }
    regions.push({ area, sx, sy });
  }
  const minArea = Math.max(12, w * h * 0.0002);
  const kept = regions.filter((r) => r.area >= minArea && r.area < w * h * 0.25);
  if (!kept.length) return { count: 0, blobs: [], typicalArea: 0 };
  // The typical tablet: the median area of the smaller half-plus (touching groups are the big ones).
  const areas = kept.map((r) => r.area).sort((a, b) => a - b);
  const typical = areas[Math.floor((areas.length - 1) * 0.4)];
  const blobs = kept
    .filter((r) => r.area >= typical * 0.35) // crumbs and reflections
    .map((r) => ({ x: Math.round(r.sx / r.area), y: Math.round(r.sy / r.area), n: Math.max(1, Math.round(r.area / typical)) }));
  return { count: blobs.reduce((n, b) => n + b.n, 0), blobs, typicalArea: typical };
}
