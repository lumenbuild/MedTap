// Stall detector: a real weight-loss plateau, told apart from water (alcohol, a big training session),
// and what's different during it from the weeks of loss before: protein, steps, sleep, shots late or missed, a new
// batch, alcohol, training. From the person's own records. Pure.
import type { BodyEntry, CheckIn, DailyHealth, Dose, Medication, Workout } from '../db/schema';
import { robustFit, type Pt } from './forecast';
import { ALCOHOL } from './lifestyle';
import { vialsOf } from './peptide';

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
const r1 = (n: number) => Math.round(n * 10) / 10;

export interface StallDiff { key: string; label: string; before: string; during: string }
export interface Stall {
  since: number; days: number;
  /** kg a week before the stall, and during it (negative = losing). */
  before: number; during: number;
  /** Short and with a water reason: probably water rather than a real stall. */
  likelyWater: boolean; water: string[];
  diffs: StallDiff[];
}

export interface StallData { body: BodyEntry[]; checkIns: CheckIn[]; daily: DailyHealth[]; doses: Dose[]; meds: Medication[]; workouts: Workout[] }

export function weightStall(d: StallData, now: number): Stall | null {
  const pts: Pt[] = d.body.filter((b) => !b.deletedAt && typeof b.weightKg === 'number').map((b) => ({ t: new Date(`${b.date}T08:00`).getTime(), v: b.weightKg! }))
    .filter((p) => p.t > now - 150 * DAY && p.t <= now + DAY).sort((a, b) => a.t - b.t);
  if (pts.length < 8) return null;
  const fitIn = (a: number, b: number) => { const w = pts.filter((p) => p.t >= a && p.t <= b); return w.length >= 4 ? robustFit(w, b) : undefined; };

  // The longest recent stretch that's flat (under 0.15 kg a week down) after losing at least 0.3 kg a week.
  let since: number | undefined, during = 0, before = 0;
  for (let back = 10; back <= 70; back++) {
    const s = now - back * DAY;
    const fw = fitIn(s, now), fb = fitIn(s - 35 * DAY, s);
    if (!fw || !fb || fw.spanDays < 9) continue;
    if (fw.slope * 7 > -0.15 && fb.slope * 7 < -0.3) { since = s; during = fw.slope * 7; before = fb.slope * 7; }
    else if (since !== undefined) break;
  }
  if (since === undefined) return null;
  const days = Math.round((now - since) / DAY);

  // Water: the last 5 days.
  const water: string[] = [];
  const recent = (t: number) => t > now - 5 * DAY && t <= now;
  if (d.checkIns.some((c) => !c.deletedAt && recent(Date.parse(c.at)) && c.chips.includes(ALCOHOL))) water.push('alcohol in the last few days');
  if (d.workouts.some((w) => !w.deletedAt && recent(Date.parse(w.startedAt)) && w.sets.filter((s) => s.done && !s.warmup).length >= 15)) water.push('a big training session');

  // Before (5 weeks) against during.
  const B: [number, number] = [since - 35 * DAY, since], W: [number, number] = [since, now];
  const inW = (t: number, [a, b]: [number, number]) => t >= a && t < b;
  const dayRows = (w: [number, number]) => d.daily.filter((x) => !x.deletedAt && inW(new Date(`${x.date}T12:00`).getTime(), w));
  const diffs: StallDiff[] = [];
  const addAvg = (key: string, label: string, f: (x: DailyHealth) => number | undefined, fmt: (v: number) => string, rel: number) => {
    const b = mean(dayRows(B).map(f).filter((v): v is number => typeof v === 'number' && v > 0));
    const w = mean(dayRows(W).map(f).filter((v): v is number => typeof v === 'number' && v > 0));
    if (b !== undefined && w !== undefined && Math.abs(w - b) >= rel * b) diffs.push({ key, label, before: fmt(b), during: fmt(w) });
  };
  addAvg('protein', 'Protein a day', (x) => x.proteinG, (v) => `${Math.round(v)} g`, 0.1);
  addAvg('steps', 'Steps a day', (x) => x.steps, (v) => Math.round(v).toLocaleString('en-AU'), 0.15);
  // Sleep: imported, else check-ins.
  const sleepIn = (w: [number, number]) => mean(dayRows(w).map((x) => (x.sleepMin ? x.sleepMin / 60 : undefined)).filter((v): v is number => !!v))
    ?? mean(d.checkIns.filter((c) => !c.deletedAt && c.sleepHours && inW(Date.parse(c.at), w)).map((c) => c.sleepHours!));
  const sb = sleepIn(B), sw = sleepIn(W);
  if (sb !== undefined && sw !== undefined && Math.abs(sw - sb) >= 0.4) diffs.push({ key: 'sleep', label: 'Sleep', before: `${r1(sb)} h`, during: `${r1(sw)} h` });
  // Alcohol, per week.
  const alc = (w: [number, number]) => (d.checkIns.filter((c) => !c.deletedAt && inW(Date.parse(c.at), w) && c.chips.includes(ALCOHOL)).length / ((w[1] - w[0]) / WEEK));
  if (alc(W) - alc(B) >= 1) diffs.push({ key: 'alcohol', label: 'Alcohol', before: `${r1(alc(B))} a week`, during: `${r1(alc(W))} a week` });
  // Training sessions, per week.
  const sess = (w: [number, number]) => d.workouts.filter((x) => !x.deletedAt && inW(Date.parse(x.startedAt), w)).length / ((w[1] - w[0]) / WEEK);
  if (Math.abs(sess(W) - sess(B)) >= 1) diffs.push({ key: 'training', label: 'Training', before: `${r1(sess(B))} a week`, during: `${r1(sess(W))} a week` });
  // Injections: late or missed, and the batch in use.
  for (const m of d.meds.filter((x) => x.peptide && !x.archived)) {
    const shots = d.doses.filter((x) => x.medicationId === m.id && !x.deletedAt).map((x) => ({ t: Date.parse(x.takenAt), skipped: !!x.skipped, a: x.amount })).sort((a, b) => a.t - b.t);
    const taken = (w: [number, number]) => shots.filter((x) => !x.skipped && inW(x.t, w));
    const gaps = (w: [number, number]) => { const t = taken(w).map((x) => x.t); return t.slice(1).map((x, i) => (x - t[i]) / DAY); };
    const gb = mean(gaps(B)), gw = mean(gaps(W));
    if (gb !== undefined && gw !== undefined && gw - gb >= 1) diffs.push({ key: `gap-${m.id}`, label: `Days between shots`, before: `${r1(gb)}`, during: `${r1(gw)}` });
    const skips = shots.filter((x) => x.skipped && inW(x.t, W)).length;
    if (skips) diffs.push({ key: `skip-${m.id}`, label: 'Shots skipped', before: '0', during: String(skips) });
    const lotAt = (t: number) => vialsOf(m).filter((v) => v.startedAt && Date.parse(v.startedAt) <= t).sort((a, b) => a.startedAt!.localeCompare(b.startedAt!)).pop()?.lot;
    const lb = lotAt(since - DAY), lw = lotAt(now);
    if (lb && lw && lb !== lw) diffs.push({ key: `lot-${m.id}`, label: 'Batch', before: lb, during: lw });
  }
  const ab = mean(d.checkIns.filter((c) => !c.deletedAt && typeof c.appetite === 'number' && inW(Date.parse(c.at), B)).map((c) => c.appetite!));
  const aw = mean(d.checkIns.filter((c) => !c.deletedAt && typeof c.appetite === 'number' && inW(Date.parse(c.at), W)).map((c) => c.appetite!));
  if (ab !== undefined && aw !== undefined && Math.abs(aw - ab) >= 0.5) diffs.push({ key: 'appetite', label: 'Appetite', before: r1(ab).toFixed(1), during: r1(aw).toFixed(1) });

  return { since, days, before: Math.round(before * 100) / 100, during: Math.round(during * 100) / 100,
    likelyWater: days < 14 && water.length > 0, water, diffs };
}
