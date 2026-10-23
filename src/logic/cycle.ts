// Cycle-aware readings: from "Period started" check-ins, how each phase of the person's own cycle shifts their weight
// (water), appetite, mood, focus, side effects and how well a stimulant works; weight with that water taken out; and
// the coming weeks by phase. Needs two or more starts. Pure.
import type { BodyEntry, CheckIn, Dose, Medication } from '../db/schema';
import { PERIOD, PHASES } from './lifestyle';
import { smoothTrend, type Pt } from './forecast';
import { EFFECT_CHIPS } from './predict';
import { ingredientsOf } from './ingredients';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const r = (n: number, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
const STIMULANTS = ['lisdexamfetamine', 'dexamfetamine', 'methylphenidate'];

/** Period starts, oldest first (starts within 10 days of each other count once). */
export function cycleStarts(checkIns: CheckIn[]): number[] {
  const out: number[] = [];
  for (const t of checkIns.filter((c) => !c.deletedAt && c.chips.includes(PERIOD)).map((c) => Date.parse(c.at)).sort((a, b) => a - b)) {
    if (!out.length || t - out[out.length - 1] > 10 * DAY) out.push(t);
  }
  return out;
}

/** Day of the cycle (1 = the day a period started), or undefined before the first start or past day 45. */
export function cycleDay(starts: number[], t: number): number | undefined {
  const st = starts.filter((x) => x <= t).pop();
  if (st === undefined) return undefined;
  const d = Math.floor((t - st) / DAY) + 1;
  return d <= 45 ? d : undefined;
}
const phaseOf = (d: number | undefined) => (d === undefined ? undefined : PHASES.findIndex((p) => d >= p.from && d <= p.to));

export interface CycleWeight { offsets: { name: string; kg: number; n: number }[] }

/** How far weigh-ins sit above or below the trend in each phase (water), when the phases differ by 0.3 kg or more. */
export function cycleWeightEffect(body: BodyEntry[], checkIns: CheckIn[], now: number): CycleWeight | null {
  const starts = cycleStarts(checkIns);
  if (starts.length < 2) return null;
  const pts = body.filter((b) => !b.deletedAt && typeof b.weightKg === 'number').map((b) => ({ t: new Date(`${b.date}T08:00`).getTime(), v: b.weightKg! }))
    .filter((p) => p.t > now - 200 * DAY).sort((a, b) => a.t - b.t);
  if (pts.length < 12) return null;
  const trend = smoothTrend(pts);
  const groups = PHASES.map(() => [] as number[]);
  pts.forEach((p, i) => { const ph = phaseOf(cycleDay(starts, p.t)); if (ph !== undefined && ph >= 0) groups[ph].push(p.v - trend[i].v); });
  if (groups.some((g) => g.length < 3)) return null;
  const means = groups.map((g) => mean(g)!);
  const centre = mean(means)!;
  const offsets = PHASES.map((p, i) => ({ name: p.name, kg: r(means[i] - centre, 2), n: groups[i].length }));
  const spread = Math.max(...offsets.map((o) => o.kg)) - Math.min(...offsets.map((o) => o.kg));
  return spread >= 0.3 ? { offsets } : null;
}

/** Weigh-ins with the cycle's water taken out (unchanged when there's no clear cycle effect). */
export function cycleAdjusted(points: Pt[], checkIns: CheckIn[], effect: CycleWeight | null): Pt[] {
  if (!effect) return points;
  const starts = cycleStarts(checkIns);
  return points.map((p) => { const ph = phaseOf(cycleDay(starts, p.t)); return ph !== undefined && ph >= 0 ? { t: p.t, v: r(p.v - effect.offsets[ph].kg, 2) } : p; });
}

export interface PhaseNote { name: string; from: number; to: number; notes: string[] }
export interface CycleForecast { day?: number; length: number; nextStart: number; today?: PhaseNote; upcoming: PhaseNote[] }

/** The person's own differences by phase (against their average), and the next five weeks laid out by phase. */
export function cycleForecast(checkIns: CheckIn[], body: BodyEntry[], meds: Medication[], doses: Dose[], now: number): CycleForecast | null {
  const starts = cycleStarts(checkIns);
  if (starts.length < 2) return null;
  const gaps = starts.slice(1).map((t, i) => (t - starts[i]) / DAY).filter((g) => g >= 20 && g <= 45);
  const length = Math.round(mean(gaps) ?? 28);
  const cis = checkIns.filter((c) => !c.deletedAt && Date.parse(c.at) > now - 200 * DAY);
  const rows = cis.map((c) => ({ c, ph: phaseOf(cycleDay(starts, Date.parse(c.at))) })).filter((x) => x.ph !== undefined && x.ph >= 0);
  const field = (f: 'mood' | 'focus' | 'appetite' | 'energy', ph?: number) => mean(rows.filter((x) => ph === undefined || x.ph === ph).map((x) => x.c[f]).filter((v): v is number => typeof v === 'number'));
  const effectPct = (ph?: number) => { const xs = rows.filter((x) => ph === undefined || x.ph === ph); return xs.length >= 3 ? (xs.filter((x) => x.c.chips.some((ch) => EFFECT_CHIPS.includes(ch))).length / xs.length) * 100 : undefined; };
  // Focus 1–8 hours after a stimulant dose, by phase.
  const stimIds = new Set(meds.filter((m) => ingredientsOf(m).some((i) => STIMULANTS.includes(i.name))).map((m) => m.id));
  const stimTimes = doses.filter((d) => stimIds.has(d.medicationId) && !d.deletedAt && !d.skipped).map((d) => Date.parse(d.takenAt)).sort((a, b) => a - b);
  const onStim = rows.filter((x) => { const t = Date.parse(x.c.at); const last = stimTimes.filter((s) => s <= t).pop(); return last !== undefined && t - last >= HOUR && t - last <= 8 * HOUR && typeof x.c.focus === 'number'; });
  const stimFocus = (ph?: number) => { const xs = onStim.filter((x) => ph === undefined || x.ph === ph).map((x) => x.c.focus!); return xs.length >= 3 ? mean(xs) : undefined; };
  const water = cycleWeightEffect(body, checkIns, now);

  const notesFor = (ph: number) => {
    const n: string[] = [];
    const cmp = (label: string, v?: number, all?: number) => {
      if (v === undefined || all === undefined || Math.abs(v - all) < 0.5) return;
      n.push(`${label} usually ${v > all ? 'higher' : 'lower'}`);
    };
    if (stimIds.size) cmp('Focus on your stimulant', stimFocus(ph), stimFocus());
    else cmp('Focus', field('focus', ph), field('focus'));
    cmp('Mood', field('mood', ph), field('mood'));
    cmp('Energy', field('energy', ph), field('energy'));
    cmp('Appetite', field('appetite', ph), field('appetite'));
    const e = effectPct(ph), eAll = effectPct();
    if (e !== undefined && eAll !== undefined && Math.abs(e - eAll) >= 15) n.push(`Side effects ${e > eAll ? 'more' : 'less'} often`);
    const w = water?.offsets[ph];
    if (w && Math.abs(w.kg) >= 0.3) n.push(`Weight ${w.kg > 0 ? '+' : '−'}${Math.abs(w.kg).toFixed(1)} kg (water)`);
    return n;
  };

  const last = starts[starts.length - 1];
  const cycleStartsAhead = [last, last + length * DAY, last + 2 * length * DAY];
  const upcoming: PhaseNote[] = [];
  for (const st of cycleStartsAhead) {
    PHASES.forEach((p, i) => {
      const from = st + (p.from - 1) * DAY;
      const to = Math.min(st + p.to * DAY, st + length * DAY);
      if (to <= now || from > now + 35 * DAY || from >= to) return;
      upcoming.push({ name: p.name, from, to, notes: notesFor(i) });
    });
  }
  const day = cycleDay(starts, now);
  const today = upcoming.find((u) => u.from <= now && u.to > now);
  const nextStart = cycleStartsAhead.find((t) => t > now) ?? last + length * DAY;
  return { day, length, nextStart, today, upcoming };
}
