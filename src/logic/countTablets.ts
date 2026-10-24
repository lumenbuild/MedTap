// Counting tablets or capsules in a photo, on the phone: tablets laid out (not stacked) on a plain surface, spread out
// or packed together. Classic image steps, no network:
//  1. Smooth the photo so surface grain and JPEG noise don't count as edges.
//  2. Work out the surface's colour across the photo: from the photo's edges inwards, each part taking its colour
//     closest to the surface around it, so a part packed with tablets still finds the surface in the gaps, and uneven
//     light or a shadow over part of it is followed rather than found. Then how far each pixel is from the surface,
//     and whether it is just the surface in shadow (the same colour, darker).
//  3. Threshold that (Otsu, with a floor so a bare surface finds nothing), keep weak edges only where they join strong
//     ones, fill holes inside tablets (shine, imprints, score lines) but not the surface showing between packed ones,
//     and open the mask to drop specks and thin lines.
//  4. Round tablets: the usual radius is the depth most of the found area comes in, so specks, crumbs, shadows and
//     lines (all thinner) don't set it. Each tablet is then found by its outline (a circle Hough transform), which
//     parts tablets pressed together, one dot each.
//  5. Capsules and long ovals: by size instead. The typical one is the size most of the found area comes in; touching
//     ones count as two or three; specks, crumbs, shadows, long thin things and big things running off the photo are
//     dropped.
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

/** The surface's colour on a coarse grid. Each cell has a few colours that cover a fair share of it (the surface, and
 *  tablets where there are some); the photo's edges are taken to be mostly surface, so the edge cells take their most
 *  common colour, and cells further in take whichever of their colours is closest to the surface around them. So a
 *  cell packed with tablets still finds the surface in the gaps between them, and light falling off or a shadow over
 *  part of the surface is followed rather than found. A cell with none of its colours near its neighbours' (all
 *  tablet) takes theirs. */
function surface(rgb: Float32Array[], w: number, h: number) {
  const S = Math.max(w, h);
  const cell = Math.max(8, Math.round(S / 8));
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const key = (i: number) => ((rgb[0][i] >> 5) << 6) | ((rgb[1][i] >> 5) << 3) | (rgb[2][i] >> 5);
  // Each cell's colours with 8%+ of its pixels, most common first.
  const cands: { c: number[]; share: number }[][] = [];
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const px: number[] = [];
    for (let y = gy * cell; y < Math.min(h, (gy + 1) * cell); y += 2) for (let x = gx * cell; x < Math.min(w, (gx + 1) * cell); x += 2) px.push(y * w + x);
    const bins = new Map<number, number[]>();
    for (const i of px) { const k = key(i); const b = bins.get(k); if (b) b.push(i); else bins.set(k, [i]); }
    const out: { c: number[]; share: number }[] = [];
    for (const ids of [...bins.values()].sort((a, b) => b.length - a.length)) {
      if (ids.length < px.length * 0.08) break;
      const centre = [0, 1, 2].map((c) => ids.reduce((a, i) => a + rgb[c][i], 0) / ids.length);
      if (out.some((o) => dist(o.c, centre) < 28)) continue;
      const near = px.filter((i) => dist([rgb[0][i], rgb[1][i], rgb[2][i]], centre) < 28);
      out.push({ c: [0, 1, 2].map((c) => medianOf(near.map((i) => rgb[c][i]))), share: near.length / px.length });
    }
    cands.push(out.length ? out : [{ c: [0, 1, 2].map((c) => medianOf(px.map((i) => rgb[c][i]))), share: 1 }]);
  }
  // The edges are mostly surface: each edge cell takes its colour that the most other edge cells also have (so tablets
  // running off one edge don't count as surface). Then inwards, each cell taking its colour closest to the cells
  // around it already done.
  const ring = (i: number) => { const x = i % gw, y = (i - x) / gw; return Math.min(x, y, gw - 1 - x, gh - 1 - y); };
  const edge = cands.map((_, i) => i).filter((i) => ring(i) === 0);
  const support = (c: number[]) => edge.reduce((a, j) => a + Math.max(0, ...cands[j].filter((o) => dist(o.c, c) < 40).map((o) => o.share)), 0);
  const grid: (number[] | null)[] = new Array(gw * gh).fill(null);
  const queue: number[] = [];
  const scored = edge.map((i) => cands[i].map((c) => ({ c: c.c, v: support(c.c) })).reduce((a, b) => (b.v > a.v ? b : a)));
  const most = Math.max(...scored.map((x) => x.v));
  // A colour along much less of the edge than the main surface is tablets running off it; a second surface (the
  // table and the floor) runs along a good share of it.
  edge.forEach((i, n) => { if (scored[n].v >= most * 0.5) { grid[i] = scored[n].c; queue.push(i); } });
  if (!queue.length) { const i = edge[0] ?? 0; grid[i] = cands[i][0].c; queue.push(i); }
  for (let q = 0; q < queue.length; q++) {
    const x0 = queue[q] % gw, y0 = (queue[q] - x0) / gw;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = x0 + dx, y = y0 + dy, i = y * gw + x;
      if (x < 0 || y < 0 || x >= gw || y >= gh || grid[i]) continue;
      const ns: number[][] = [];
      for (let ey = -1; ey <= 1; ey++) for (let ex = -1; ex <= 1; ex++) {
        const g = x + ex >= 0 && y + ey >= 0 && x + ex < gw && y + ey < gh ? grid[(y + ey) * gw + x + ex] : null;
        if (g) ns.push(g);
      }
      const around = [0, 1, 2].map((c) => medianOf(ns.map((n) => n[c])));
      const best = cands[i].reduce((a, c) => (dist(c.c, around) < dist(a.c, around) ? c : a));
      grid[i] = dist(best.c, around) < 80 ? best.c : around;
      queue.push(i);
    }
  }
  /** How far pixel i is from the surface: the nearer of the smooth (bilinear) estimate and the four cells around it,
   *  so a pixel just inside a shadow's edge matches the shadow, not a blend of shadow and light. And whether it looks
   *  like a shadow cast on the surface: the same colour, only darker. */
  return (i: number, x: number, y: number, src = rgb): { d: number; shadow: boolean } => {
    const fx = Math.min(gw - 1, Math.max(0, x / cell - 0.5)), fy = Math.min(gh - 1, Math.max(0, y / cell - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1);
    const ax = fx - x0, ay = fy - y0;
    const g = (a: number, b: number) => grid[b * gw + a]!;
    const r = src[0][i], gg = src[1][i], b = src[2][i];
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

/** Connected regions of the mask; each pixel's region (from 1) goes in `labels`. */
function regions(mask: Uint8Array, w: number, h: number, shade: Uint8Array, labels = new Int32Array(w * h)): Region[] {
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

/** Distance from each mask pixel to the nearest pixel outside it (a 3-4 chamfer, close to straight-line distance). */
function distanceMap(m: Uint8Array, w: number, h: number): Float32Array {
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = m[i] ? 1e9 : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (d[i]) d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (d[i]) d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
  }
  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
}

/** The middles of round tablets of radius r by their outlines (a circle Hough transform): every edge point votes for
 *  the point one radius inwards, so each tablet's outline piles its votes on its middle, even when much of it touches
 *  other tablets, while a line or a speck's few votes scatter. `f` is how far each pixel is from the surface (lightly
 *  smoothed, so the thin line where two tablets touch still shows); `inside` limits the middles to the found tablets. */
function circleCentres(f: Float32Array, w: number, h: number, r: number, inside: (i: number) => boolean): number[] {
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h), mag = new Float32Array(w * h);
  const sample: number[] = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const a = f[i - w - 1], b = f[i - w], c = f[i - w + 1], d = f[i - 1], e = f[i + 1], g = f[i + w - 1], hh = f[i + w], k = f[i + w + 1];
    gx[i] = c + 2 * e + k - a - 2 * d - g;
    gy[i] = g + 2 * hh + k - a - 2 * b - c;
    mag[i] = Math.hypot(gx[i], gy[i]);
    if ((x + y) % 7 === 0) sample.push(mag[i]);
  }
  sample.sort((a, b) => a - b);
  const thr = Math.max(8, sample[Math.floor(sample.length * 0.99)] * 0.2);
  const acc = new Float32Array(w * h);
  for (let i = 0; i < mag.length; i++) {
    if (mag[i] < thr) continue;
    const x = i % w, y = (i - x) / w, ux = gx[i] / mag[i], uy = gy[i] / mag[i];
    for (const s of [0.85, 0.95, 1.05, 1.15]) {
      const cx = Math.round(x + ux * r * s), cy = Math.round(y + uy * r * s);
      if (cx >= 0 && cy >= 0 && cx < w && cy < h) acc[cy * w + cx]++;
    }
  }
  const br = Math.max(1, Math.round(r * 0.12));
  boxBlur(acc, w, h, br); boxBlur(acc, w, h, br);
  const cand: number[] = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, v = acc[i];
    if (v <= 0 || !inside(i)) continue;
    if (v >= acc[i - 1] && v >= acc[i + 1] && v >= acc[i - w] && v >= acc[i + w] && v >= acc[i - w - 1] && v >= acc[i - w + 1] && v >= acc[i + w - 1] && v >= acc[i + w + 1]) cand.push(i);
  }
  const kept = spaced(cand.sort((a, b) => acc[b] - acc[a]), w, 1.2 * r);
  if (!kept.length) return [];
  // A full outline's votes, from the clearer half; middles with well under that are an imprint or a gap, not a tablet.
  const ref = acc[kept[Math.floor(kept.length * 0.25)]];
  return kept.filter((i) => acc[i] >= ref * 0.35);
}

/** The points in order, skipping any closer than `sep` to one already kept. */
function spaced(order: number[], w: number, sep: number): number[] {
  const size = Math.max(1, Math.ceil(sep));
  const grid = new Map<number, number[]>();
  const kept: number[] = [];
  for (const i of order) {
    const x = i % w, y = (i - x) / w, cx = Math.floor(x / size), cy = Math.floor(y / size);
    let clash = false;
    for (let dy = -1; dy <= 1 && !clash; dy++) for (let dx = -1; dx <= 1 && !clash; dx++) {
      for (const j of grid.get((cy + dy) * 100_000 + cx + dx) ?? []) { const jx = j % w, jy = (j - jx) / w; if (Math.hypot(jx - x, jy - y) < sep) { clash = true; break; } }
    }
    if (clash) continue;
    kept.push(i);
    const k = cy * 100_000 + cx;
    grid.set(k, [...(grid.get(k) ?? []), i]);
  }
  return kept;
}

/** Round tablets, even packed together and touching: one count for each middle. Each tablet's middle is the point
 *  furthest inside it, about one radius from its edge; the radius is the one most of the found area comes in, so dust,
 *  crumbs, thin shadows and lines (all much thinner) have no middle that counts. Null when the tablets aren't round
 *  (capsules, long ovals: their middles are lines, not points), so they're counted by size instead. */
function countByMiddles(mask: Uint8Array, w: number, h: number, shade: Uint8Array, sharp: Float32Array): TabletCount | null {
  const d = distanceMap(mask, w, h);
  const peaks: number[] = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, v = d[i];
    if (v < 2) continue;
    if (v >= d[i - 1] && v >= d[i + 1] && v >= d[i - w] && v >= d[i + w] && v >= d[i - w - 1] && v >= d[i - w + 1] && v >= d[i + w - 1] && v >= d[i + w + 1]) peaks.push(i);
  }
  if (!peaks.length) return null;
  // The usual radius: a histogram of the peaks' depths, each weighted by the area it stands for.
  const hist: number[] = [];
  for (const i of peaks) { const b = Math.round(d[i] * 2); hist[b] = (hist[b] ?? 0) + d[i] * d[i]; }
  let best = 0, top = 0;
  for (let b = 0; b < hist.length; b++) {
    const v = (hist[b - 1] ?? 0) + (hist[b] ?? 0) * 2 + (hist[b + 1] ?? 0);
    if (v > best) { best = v; top = b / 2; }
  }
  const near = peaks.map((i) => d[i]).filter((v) => v > top * 0.75 && v < top * 1.3).sort((a, b) => a - b);
  const r = near[near.length >> 1] ?? top;
  if (r < 3) return null;
  // Regions that are lines or rings (a table edge, a tray) don't count.
  const labels = new Int32Array(w * h);
  const regs = regions(mask, w, h, shade, labels);
  const ok = regs.map((g) => {
    const bw = g.x1 - g.x0 + 1, bh = g.y1 - g.y0 + 1;
    return g.area <= w * h * 0.6 && g.area / (bw * bh) >= 0.2 && Math.max(bw, bh) / Math.min(bw, bh) <= 8;
  });
  // The middles, deepest first, at least most of a radius apart.
  const kept = spaced(peaks.filter((i) => d[i] >= r * 0.55 && d[i] <= r * 1.6 && ok[labels[i] - 1]).sort((a, b) => d[b] - d[a]), w, 1.2 * r);
  if (!kept.length) return null;
  // Round or not: from a round middle the depth falls away in every direction; along a capsule it stays.
  const flat = kept.map((i) => {
    const x = i % w, y = (i - x) / w;
    let most = 0;
    for (let a = 0; a < 8; a++) {
      const px = Math.round(x + Math.cos((a * Math.PI) / 4) * r * 0.8), py = Math.round(y + Math.sin((a * Math.PI) / 4) * r * 0.8);
      if (px >= 0 && py >= 0 && px < w && py < h) most = Math.max(most, d[py * w + px]);
    }
    return most / d[i];
  }).sort((a, b) => a - b);
  if (flat[flat.length >> 1] > 0.55) return null;
  // Round: find each one by its outline, which still parts tablets pressed together that the mask has joined.
  const byOutline = circleCentres(sharp, w, h, r, (i) => mask[i] === 1 && d[i] >= r * 0.3);
  const centres = byOutline.length ? byOutline : kept;
  return { count: centres.length, blobs: centres.map((i) => ({ x: i % w, y: Math.floor(i / w), n: 1 })), typicalArea: Math.PI * r * r };
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
  // A lightly smoothed copy keeps the thin line where two tablets touch, for finding round tablets by their outlines.
  const light = rgb.map((ch) => { const c = ch.slice(); boxBlur(c, w, h, 1); return c; });
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
  // Fill holes: anything not reachable from the photo's edge is inside a tablet (shine, an imprint, a score line),
  // unless it looks like the surface: that's a gap between tablets packed together, and stays open.
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
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] || outside[i]) continue;
    const hole: number[] = [i];
    outside[i] = 1;
    let sum = 0;
    for (let n = 0; n < hole.length; n++) {
      const j = hole[n], x = j % w;
      sum += dist[j];
      for (const k of [j - 1, j + 1, j - w, j + w]) {
        if (k < 0 || k >= mask.length || mask[k] || outside[k]) continue;
        if ((k === j - 1 && x === 0) || (k === j + 1 && x === w - 1)) continue;
        outside[k] = 1; hole.push(k);
      }
    }
    if (sum / hole.length > t * 0.6) for (const j of hole) mask[j] = 1;
  }
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
  const sharp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) sharp[y * w + x] = fromSurface(y * w + x, x, y, light).d;
  const round = countByMiddles(mask, w, h, shade, sharp);
  if (round) return round;
  // Capsules and long ovals: by size, with touching ones counted as two or three.
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
