// Counting tablets or capsules in a photo, on the phone: tablets laid out (not stacked) on a plain surface. Classic
// image steps, no network:
//  1. Smooth the photo so surface grain and JPEG noise don't count as edges.
//  2. Work out the surface's colour across the photo (a coarse grid, so uneven light and a shadow over part of it are
//     part of the surface, not things on it), then how far each pixel is from the surface there, and whether it is
//     just the surface in shadow (the same colour, darker).
//  3. Threshold that (Otsu, with a floor so a bare surface finds nothing), keep weak edges only where they join strong
//     ones, fill holes (shine, imprints, score lines) and open the mask to drop specks and thin lines.
//  4. Find the typical tablet: the size that most of the found area comes in. Specks are many but tiny, so they carry
//     little area and can't set the size the way they did when the typical size was a plain median.
//  5. Open again in proportion to that size (parting tablets that touch, cutting off lines), set aside the shadows
//     tablets cast, and keep only regions near the tablet size or bigger (two or three touching count as two or
//     three). Specks, crumbs, long thin things and big things running off the photo (a tray's edge) are dropped.
// The person checks the dots on the photo and taps to correct them.

export interface Pixels { width: number; height: number; data: Uint8ClampedArray | Uint8Array }
export interface Blob { x: number; y: number; n: number }
export interface TabletCount { count: number; blobs: Blob[]; typicalArea: number }

function otsu(hist: number[]): number {
  let total = 0, sum = 0;
  for (let i = 0; i < hist.length; i++) { total += hist[i]; sum += i * hist[i]; }
  let sumB = 0, wB = 0, best = 0, t = hist.length >> 1;
  for (let i = 0; i < hist.length; i++) {
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

/** A box blur of radius r along rows then columns, in place. */
function boxBlur(ch: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(Math.max(w, h));
  const pass = (len: number, count: number, at: (line: number, i: number) => number) => {
    for (let line = 0; line < count; line++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += ch[at(line, Math.min(len - 1, Math.max(0, i)))];
      for (let i = 0; i < len; i++) {
        tmp[i] = acc / (2 * r + 1);
        acc += ch[at(line, Math.min(len - 1, i + r + 1))] - ch[at(line, Math.max(0, i - r))];
      }
      for (let i = 0; i < len; i++) ch[at(line, i)] = tmp[i];
    }
  };
  pass(w, h, (y, x) => y * w + x);
  pass(h, w, (x, y) => y * w + x);
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

/** The surface's colour on a coarse grid: in each cell, the most common colour (tablets rarely fill most of a cell),
 *  then the median of the pixels near it. A cell that disagrees with its neighbours and isn't mostly one colour (a
 *  tablet filling it) takes their median instead. Light falling off and a shadow over part of the surface each give
 *  their cells their own colour. */
function surface(rgb: Float32Array[], w: number, h: number) {
  const S = Math.max(w, h);
  const cell = Math.max(8, Math.round(S / 6));
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  const est: number[][] = [], share: number[] = [];
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const px: number[] = [];
    for (let y = gy * cell; y < Math.min(h, (gy + 1) * cell); y += 2) for (let x = gx * cell; x < Math.min(w, (gx + 1) * cell); x += 2) px.push(y * w + x);
    const bins = new Map<number, number>();
    const key = (i: number) => ((rgb[0][i] >> 5) << 6) | ((rgb[1][i] >> 5) << 3) | (rgb[2][i] >> 5);
    for (const i of px) bins.set(key(i), (bins.get(key(i)) ?? 0) + 1);
    let mode = 0, most = -1;
    for (const [k, n] of bins) if (n > most) { most = n; mode = k; }
    const inMode = px.filter((i) => key(i) === mode);
    const centre = [0, 1, 2].map((c) => inMode.reduce((a, i) => a + rgb[c][i], 0) / inMode.length);
    const near = px.filter((i) => Math.hypot(rgb[0][i] - centre[0], rgb[1][i] - centre[1], rgb[2][i] - centre[2]) < 28);
    est.push([0, 1, 2].map((c) => medianOf(near.map((i) => rgb[c][i]))));
    share.push(near.length / Math.max(1, px.length));
  }
  const grid = est.map((v, i) => {
    const x = i % gw, y = (i - x) / gw;
    const ns: number[][] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && x + dx >= 0 && y + dy >= 0 && x + dx < gw && y + dy < gh) ns.push(est[(y + dy) * gw + x + dx]);
    if (!ns.length) return v;
    const m = [0, 1, 2].map((c) => medianOf(ns.map((n) => n[c])));
    return share[i] < 0.5 && Math.hypot(v[0] - m[0], v[1] - m[1], v[2] - m[2]) > 40 ? m : v;
  });
  /** How far pixel i is from the surface: the nearer of the smooth (bilinear) estimate and the four cells around it,
   *  so a pixel just inside a shadow's edge matches the shadow, not a blend of shadow and light. And whether it looks
   *  like a shadow cast on the surface: the same colour, only darker. */
  return (i: number, x: number, y: number): { d: number; shadow: boolean } => {
    const fx = Math.min(gw - 1, Math.max(0, x / cell - 0.5)), fy = Math.min(gh - 1, Math.max(0, y / cell - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1);
    const ax = fx - x0, ay = fy - y0;
    const g = (a: number, b: number) => grid[b * gw + a];
    const r = rgb[0][i], gg = rgb[1][i], b = rgb[2][i];
    const d = (v: number[]) => Math.hypot(r - v[0], gg - v[1], b - v[2]);
    const smooth = [0, 1, 2].map((c) => (g(x0, y0)[c] * (1 - ax) + g(x1, y0)[c] * ax) * (1 - ay) + (g(x0, y1)[c] * (1 - ax) + g(x1, y1)[c] * ax) * ay);
    let best = smooth, bd = d(smooth);
    for (const v of [g(x0, y0), g(x1, y0), g(x0, y1), g(x1, y1)]) { const dv = d(v); if (dv < bd) { bd = dv; best = v; } }
    const lp = r + gg + b + 1, ls = best[0] + best[1] + best[2] + 1;
    const shadow = lp / ls > 0.3 && lp / ls < 0.9
      && Math.abs(r / lp - best[0] / ls) + Math.abs(gg / lp - best[1] / ls) + Math.abs(b / lp - best[2] / ls) < 0.06;
    return { d: bd, shadow };
  };
}

function medianOf(v: number[]): number {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[s.length >> 1];
}

interface Region { area: number; sx: number; sy: number; x0: number; y0: number; x1: number; y1: number; edge: boolean; dark: number }

function regions(mask: Uint8Array, w: number, h: number, shade: Uint8Array): Region[] {
  const labels = new Int32Array(w * h);
  const out: Region[] = [];
  const stack: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || labels[i]) continue;
    const r: Region = { area: 0, sx: 0, sy: 0, x0: w, y0: h, x1: 0, y1: 0, edge: false, dark: 0 };
    labels[i] = out.length + 1; stack.push(i);
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % w, y = (j - x) / w;
      r.area++; r.sx += x; r.sy += y; r.dark += shade[j];
      if (x < r.x0) r.x0 = x; if (x > r.x1) r.x1 = x; if (y < r.y0) r.y0 = y; if (y > r.y1) r.y1 = y;
      if (x <= 2 || y <= 2 || x >= w - 3 || y >= h - 3) r.edge = true;
      for (const k of [j - 1, j + 1, j - w, j + w]) {
        if (k < 0 || k >= mask.length || labels[k] || !mask[k]) continue;
        if ((k === j - 1 && x === 0) || (k === j + 1 && x === w - 1)) continue;
        labels[k] = out.length + 1; stack.push(k);
      }
    }
    out.push(r);
  }
  return out;
}

/** The typical tablet's area: the size most of the found area comes in (a histogram of log area, weighted by area),
 *  then the median of the regions close to it. */
export function typicalArea(areas: number[]): number {
  if (!areas.length) return 0;
  const lo = Math.log2(Math.min(...areas));
  const bin = (a: number) => Math.floor((Math.log2(a) - lo) / 0.25);
  const hist: number[] = [];
  for (const a of areas) hist[bin(a)] = (hist[bin(a)] ?? 0) + a;
  let best = 0, peak = 0;
  for (let i = 0; i < hist.length; i++) {
    const v = (hist[i - 1] ?? 0) * 0.5 + (hist[i] ?? 0) + (hist[i + 1] ?? 0) * 0.5;
    if (v > best) { best = v; peak = i; }
  }
  const centre = 2 ** (lo + (peak + 0.5) * 0.25);
  const near = areas.filter((a) => a > centre * 0.6 && a < centre * 1.6).sort((a, b) => a - b);
  return near.length ? near[Math.floor(near.length / 2)] : centre;
}

export function countTablets(img: Pixels): TabletCount {
  const { width: w, height: h, data } = img;
  const S = Math.max(w, h);
  const rgb = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)];
  for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) rgb[c][i] = data[i * 4 + c];
  const r = Math.max(1, Math.round(S / 320));
  for (const ch of rgb) { boxBlur(ch, w, h, r); boxBlur(ch, w, h, r); }

  // How far each pixel is from the surface under it.
  const fromSurface = surface(rgb, w, h);
  const dist = new Uint8Array(w * h), shade = new Uint8Array(w * h);
  const hist = new Array<number>(256).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const f = fromSurface(i, x, y);
    const d = Math.min(255, Math.round(f.d));
    dist[i] = d; hist[d]++;
    shade[i] = f.shadow ? 1 : 0;
  }
  // Otsu on the distances, but never so low that grain on a bare surface counts.
  const t = Math.max(24, otsu(hist));
  let mask: Uint8Array = new Uint8Array(w * h);
  // Strong pixels, then weak ones (half the threshold) joined to them: the pale middle of a tablet with a dark rim.
  const stack: number[] = [];
  for (let i = 0; i < dist.length; i++) if (dist[i] > t) { mask[i] = 1; stack.push(i); }
  while (stack.length) {
    const j = stack.pop()!;
    const x = j % w;
    for (const k of [j - 1, j + 1, j - w, j + w]) {
      if (k < 0 || k >= mask.length || mask[k] || dist[k] <= t * 0.5) continue;
      if ((k === j - 1 && x === 0) || (k === j + 1 && x === w - 1)) continue;
      mask[k] = 1; stack.push(k);
    }
  }
  // Fill holes: anything not reachable from the photo's edge through the surface is inside a tablet.
  const outside = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) if (!mask[y * w + x] && !outside[y * w + x]) { outside[y * w + x] = 1; stack.push(y * w + x); }
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) if (!mask[y * w + x] && !outside[y * w + x]) { outside[y * w + x] = 1; stack.push(y * w + x); }
  while (stack.length) {
    const j = stack.pop()!;
    const x = j % w;
    for (const k of [j - 1, j + 1, j - w, j + w]) {
      if (k < 0 || k >= mask.length || mask[k] || outside[k]) continue;
      if ((k === j - 1 && x === 0) || (k === j + 1 && x === w - 1)) continue;
      outside[k] = 1; stack.push(k);
    }
  }
  for (let i = 0; i < mask.length; i++) if (!outside[i]) mask[i] = 1;
  // Opening: drops specks and thin lines, and parts tablets that only just touch.
  const k = Math.max(2, Math.round(S / 260));
  const open = (m: Uint8Array, n: number) => {
    for (let i = 0; i < n; i++) m = erode(m, w, h);
    for (let i = 0; i < n; i++) m = dilate(m, w, h);
    return m;
  };
  const minArea = Math.max(16, w * h * 0.0006);
  const shapely = (g: Region) => {
    if (g.area < minArea || g.area > w * h * 0.2) return false;
    const bw = g.x1 - g.x0 + 1, bh = g.y1 - g.y0 + 1;
    return g.area / (bw * bh) >= 0.2 && Math.max(bw, bh) / Math.min(bw, bh) <= 8; // not a line or a ring
  };
  mask = open(mask, k);
  const first = regions(mask, w, h, shade).filter(shapely);
  if (!first.length) return { count: 0, blobs: [], typicalArea: 0 };
  let typical = typicalArea(first.map((g) => g.area));
  // Now the tablet size is known, open again in proportion to it: that cuts off lines joined to a tablet, and parts
  // tablets that touch at a narrow neck. Every region is split again, including the odd shapes passed over above: a
  // tablet with a line through it is one.
  const k2 = Math.round(Math.sqrt(typical / Math.PI) * 0.3);
  let pieces = first;
  if (k2 > k) pieces = regions(open(mask, k2 - k), w, h, shade).filter((g) => g.area >= minArea);
  // A shadow cast by a tablet (mostly surface colour, only darker) next to a tablet is part of it, not a tablet of its
  // own, and doesn't add to its size. A dark piece on its own may be a dark tablet, so it stays.
  const isShadow = (g: Region) => g.dark > g.area * 0.6;
  const size = (g: Region) => (isShadow(g) ? g.area : g.area - g.dark);
  const lit = pieces.filter((g) => !isShadow(g) && shapely(g));
  if (lit.length) typical = typicalArea(lit.map(size));
  const width = 2 * Math.sqrt(typical / Math.PI);
  const centre = (g: Region) => [g.sx / g.area, g.sy / g.area];
  const near = (a: Region, b: Region) => Math.hypot(centre(a)[0] - centre(b)[0], centre(a)[1] - centre(b)[1]) < width;
  const kept = [...lit, ...pieces.filter((g) => isShadow(g) && shapely(g) && !lit.some((m) => near(m, g)))];
  if (!kept.length) return { count: 0, blobs: [], typicalArea: 0 };
  typical = typicalArea(kept.map(size));
  const blobs = kept
    .filter((g) => size(g) >= typical * 0.4) // specks, crumbs, reflections
    .filter((g) => !(g.edge && size(g) > typical * 5)) // the edge of a tray, a hand or the table running off the photo
    .map((g) => ({ x: Math.round(g.sx / g.area), y: Math.round(g.sy / g.area), n: size(g) < typical * 1.7 ? 1 : Math.round(size(g) / typical) }));
  return { count: blobs.reduce((n, b) => n + b.n, 0), blobs, typicalArea: typical };
}
