// Self-experiments (biohacking tools): A against B in blocks of days in a random order (balanced: as many of each),
// today's condition, and the result: each day's outcome by condition, the difference, how big it is against the day-to-
// day spread, and how likely a difference that big is by chance (shuffling the blocks' labels). Pure.
import type { CheckIn, DailyHealth, BodyEntry, Experiment } from '../db/schema';
import { brainScore } from './biohack';

const DAY = 86_400_000;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
const r1 = (n: number) => Math.round(n * 10) / 10;

export const METRICS: Record<Experiment['metric'], { label: string; unit: string; higherBetter: boolean; night?: boolean }> = {
  brain: { label: 'Brain test score', unit: '', higherBetter: true },
  focus: { label: 'Focus (1–5)', unit: '', higherBetter: true },
  mood: { label: 'Mood (1–5)', unit: '', higherBetter: true },
  energy: { label: 'Energy (1–5)', unit: '', higherBetter: true },
  sleepH: { label: 'Sleep', unit: 'h', higherBetter: true, night: true },
  deepMin: { label: 'Deep sleep', unit: 'min', higherBetter: true, night: true },
  hrv: { label: 'HRV', unit: 'ms', higherBetter: true, night: true },
  rhr: { label: 'Resting heart rate', unit: 'bpm', higherBetter: false, night: true },
  weight: { label: 'Weight', unit: 'kg', higherBetter: false },
};

export const TEMPLATES: Omit<Experiment, 'id' | 'createdAt' | 'updatedAt' | 'blocks' | 'start' | 'personId'>[] = [
  { title: 'Magnesium for sleep', a: 'Magnesium in the evening', b: 'No magnesium', metric: 'deepMin', blockDays: 7 },
  { title: 'First dose before or after breakfast', a: 'Before breakfast', b: 'After breakfast', metric: 'brain', blockDays: 3 },
  { title: 'Semax for focus', a: 'Semax', b: 'No Semax', metric: 'focus', blockDays: 7 },
  { title: 'Caffeine cut-off', a: 'No caffeine after 12 pm', b: 'Caffeine until 3 pm', metric: 'sleepH', blockDays: 3 },
  { title: 'DSIP for deep sleep', a: 'DSIP', b: 'No DSIP', metric: 'deepMin', blockDays: 3 },
  { title: 'L-theanine with Ritalin', a: 'With L-theanine', b: 'Without', metric: 'brain', blockDays: 3 },
];

/** `n` blocks, half A and half B, in a random order (no more than 2 the same in a row). */
export function randomBlocks(n: number, rand: () => number = Math.random): ('a' | 'b')[] {
  for (let tries = 0; tries < 200; tries++) {
    const xs: ('a' | 'b')[] = [...Array(Math.ceil(n / 2)).fill('a'), ...Array(Math.floor(n / 2)).fill('b')];
    for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; }
    if (!xs.some((x, i) => i >= 2 && x === xs[i - 1] && x === xs[i - 2])) return xs;
  }
  return Array.from({ length: n }, (_, i) => (i % 2 ? 'b' : 'a'));
}

const dayIndex = (e: Experiment, ymd: string) => Math.round((new Date(`${ymd}T12:00`).getTime() - new Date(`${e.start}T12:00`).getTime()) / DAY);
const ymdOf = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const addDays = (ymd: string, n: number) => ymdOf(new Date(`${ymd}T12:00`).getTime() + n * DAY);

/** The condition on a day ('a', 'b'), or null before the start or after the last block. */
export function conditionOn(e: Experiment, ymd: string): { arm: 'a' | 'b'; block: number; dayInBlock: number } | null {
  const i = dayIndex(e, ymd);
  if (i < 0 || (e.ended && ymd > e.ended)) return null;
  const block = Math.floor(i / e.blockDays);
  if (block >= e.blocks.length) return null;
  return { arm: e.blocks[block], block, dayInBlock: (i % e.blockDays) + 1 };
}

export const lastDay = (e: Experiment) => addDays(e.start, e.blocks.length * e.blockDays - 1);

/** Each day's outcome. Night outcomes (sleep, HRV, resting heart rate) count for the day before the morning they're
 *  recorded. Ratings and tests: the day's average. */
export function dayValues(e: Experiment, d: { checkIns: CheckIn[]; daily: DailyHealth[]; body: BodyEntry[] }): Map<string, number> {
  const out = new Map<string, number[]>();
  const put = (k: string, v: number | undefined) => { if (typeof v === 'number' && Number.isFinite(v)) out.set(k, [...(out.get(k) ?? []), v]); };
  const m = e.metric;
  if (m === 'brain' || m === 'focus' || m === 'mood' || m === 'energy') {
    for (const c of d.checkIns.filter((x) => !x.deletedAt)) put(ymdOf(Date.parse(c.at)), m === 'brain' ? brainScore(c) : c[m]);
  } else if (m === 'weight') {
    for (const b of d.body.filter((x) => !x.deletedAt)) put(b.date, b.weightKg);
  } else {
    for (const r of d.daily.filter((x) => !x.deletedAt)) put(addDays(r.date, -1), m === 'sleepH' ? (r.sleepMin ? r.sleepMin / 60 : undefined) : m === 'deepMin' ? r.sleepDeepMin : m === 'hrv' ? r.hrvMs : r.restingHr);
  }
  return new Map([...out].map(([k, v]) => [k, mean(v)]));
}

export interface ExperimentResult {
  a: { days: number; mean?: number }; b: { days: number; mean?: number };
  /** B minus A, and how big against the day-to-day spread (Cohen's d). */
  diff?: number; effect?: number;
  /** How often shuffling the blocks' labels gives a difference at least this big (lower = less likely chance). */
  p?: number;
  verdict: 'running' | 'too-few' | 'a-better' | 'b-better' | 'no-difference' | 'leaning-a' | 'leaning-b';
  progress: { blocksDone: number; blocks: number };
}

/** The result so far. A verdict needs 2+ finished blocks of each and 5+ days of each: under p 0.05 it's a difference,
 *  under 0.2 it's leaning, otherwise no clear difference. */
export function analyse(e: Experiment, d: { checkIns: CheckIn[]; daily: DailyHealth[]; body: BodyEntry[] }, now: number, rand: () => number = Math.random): ExperimentResult {
  const vals = dayValues(e, d);
  const today = ymdOf(now);
  const byBlock: { arm: 'a' | 'b'; v: number[] }[] = e.blocks.map((arm) => ({ arm, v: [] }));
  for (const [k, v] of vals) {
    if (k >= today) continue; // today isn't over (and tonight's sleep isn't in yet)
    const c = conditionOn(e, k);
    if (c) byBlock[c.block].v.push(v);
  }
  const blocksDone = Math.min(e.blocks.length, Math.max(0, Math.floor((dayIndex(e, today)) / e.blockDays)));
  const done = byBlock.slice(0, blocksDone).filter((b) => b.v.length);
  const A = done.filter((b) => b.arm === 'a').flatMap((b) => b.v), B = done.filter((b) => b.arm === 'b').flatMap((b) => b.v);
  const res: ExperimentResult = { a: { days: A.length, mean: A.length ? r1(mean(A)) : undefined }, b: { days: B.length, mean: B.length ? r1(mean(B)) : undefined }, verdict: 'running', progress: { blocksDone, blocks: e.blocks.length } };
  const nA = done.filter((b) => b.arm === 'a').length, nB = done.filter((b) => b.arm === 'b').length;
  if (nA < 2 || nB < 2 || A.length < 5 || B.length < 5) { res.verdict = blocksDone >= e.blocks.length ? 'too-few' : 'running'; return res; }
  const diff = mean(B) - mean(A);
  const pooled = sd([...A.map((x) => x - mean(A)), ...B.map((x) => x - mean(B))]);
  res.diff = r1(diff);
  res.effect = pooled > 0 ? Math.round((diff / pooled) * 100) / 100 : undefined;
  // Permutation over the blocks: shuffle which blocks were A and B, keeping each block's days together.
  const blockMeans = done.map((b) => ({ arm: b.arm, sum: b.v.reduce((x, y) => x + y, 0), n: b.v.length }));
  const stat = (arms: ('a' | 'b')[]) => { let sa = 0, na = 0, sb = 0, nb = 0; blockMeans.forEach((b, i) => { if (arms[i] === 'a') { sa += b.sum; na += b.n; } else { sb += b.sum; nb += b.n; } }); return na && nb ? sb / nb - sa / na : 0; };
  let as = 0; const N = 2000;
  for (let k = 0; k < N; k++) {
    const arms = blockMeans.map((b) => b.arm);
    for (let i = arms.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arms[i], arms[j]] = [arms[j], arms[i]]; }
    if (Math.abs(stat(arms)) >= Math.abs(diff) - 1e-9) as++;
  }
  res.p = Math.round((as / N) * 1000) / 1000;
  const better = (METRICS[e.metric].higherBetter ? diff > 0 : diff < 0) ? 'b' : 'a';
  res.verdict = res.p < 0.05 ? (better === 'a' ? 'a-better' : 'b-better') : res.p < 0.2 ? (better === 'a' ? 'leaning-a' : 'leaning-b') : 'no-difference';
  return res;
}
