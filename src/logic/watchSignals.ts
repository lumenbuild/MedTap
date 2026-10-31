// What the watch shows about a medicine: how heart rate rises and settles after each stimulant dose (learned from
// heart rate in 5-minute blocks, at rest only), whether today's dose is still showing, sleep on and off a course (DSIP,
// Epitalon), and resting heart rate and HRV through the week after a weekly shot, and by dose. From the person's own
// watch data. Pure.
import type { CheckIn, DailyHealth, Dose, Medication } from '../db/schema';
import { CAFFEINE } from './caffeine';
import { courseInfo, getDayBounds, type ScheduleSettings } from './schedule';
import { dayKey } from './stats';
import { zonedParts } from './tz';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const BLOCK = 5 * MIN;
/** Steps in a 5-minute block above which it isn't "at rest" (a short walk to the kitchen is fine). */
const MOVING = 120;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs: number[]) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r1 = (n: number) => Math.round(n * 10) / 10;
const live = (d: Dose) => !d.deletedAt && !d.skipped;

/** Resting heart rate in 5-minute blocks from `from` to `to` (null where there's no reading or the person was moving). */
export function restingSeries(daily: DailyHealth[], from: number, to: number, s: ScheduleSettings): (number | null)[] {
  const byDate = new Map(daily.filter((x) => !x.deletedAt && x.hr5).map((x) => [x.date, x]));
  const out: (number | null)[] = [];
  for (let t = from; t < to; t += BLOCK) {
    const p = zonedParts(t, s.tz);
    const date = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
    const row = byDate.get(date);
    const i = p.h * 12 + Math.floor(p.mi / 5);
    const hr = row?.hr5?.[i];
    const steps = row?.steps5 ? (row.steps5[i] ?? 0) + (i > 0 ? row.steps5[i - 1] ?? 0 : 0) : 0;
    out.push(typeof hr === 'number' && steps <= MOVING ? hr : null);
  }
  return out;
}

/** A 3-block (15-minute) rolling mean that skips gaps. */
function smooth(xs: (number | null)[]): (number | null)[] {
  return xs.map((_, i) => { const w = [xs[i - 1], xs[i], xs[i + 1]].filter((v): v is number => typeof v === 'number'); return w.length >= 2 ? mean(w) : null; });
}

// ── How a dose shows in the heart rate ──────────────────────────────────────────────────────────────

export interface HeartResponse {
  /** Doses with enough resting readings, and their usual resting heart rate just before the dose. */
  doses: number; baseline: number;
  /** The usual rise over that baseline, every 5 minutes from the dose to 8 hours after (null where too few doses). */
  curve: { min: number; delta: number | null }[];
  /** When it starts showing (40% of the peak), peaks, and settles back (under 30% of the peak for half an hour). */
  onsetMin?: number; peakMin?: number; peakBpm: number; wearOffMin?: number;
  /** The rise is big enough to read (4+ bpm at the peak). */
  signal: boolean;
  /** Days without a dose used to take out the usual rise at that time of day (waking, moving, the body clock). */
  controlDays: number;
}

const SPAN = 8 * HOUR;

/** One dose's rise over its own baseline (the hour before), at rest, every 5 minutes for 8 hours. Null without a
 *  baseline (fewer than 4 resting readings in the hour before). */
function doseCurve(t: number, daily: DailyHealth[], s: ScheduleSettings): { baseline: number; delta: (number | null)[] } | null {
  const before = restingSeries(daily, t - HOUR, t, s).filter((v): v is number => typeof v === 'number');
  if (before.length < 4) return null;
  const baseline = median(before);
  const after = restingSeries(daily, t, t + SPAN, s);
  if (after.filter((v) => v !== null).length < 24) return null; // under 2 hours of resting readings
  return { baseline, delta: after.map((v) => (v === null ? null : v - baseline)) };
}

/** One dose's peak rise over its own baseline (15-minute smoothed, within 5 hours), or null without enough readings. */
export function dosePeak(t: number, daily: DailyHealth[], s: ScheduleSettings): number | null {
  const c = doseCurve(t, daily, s);
  if (!c) return null;
  const sm = smooth(c.delta.slice(0, 60)).filter((v): v is number => typeof v === 'number');
  return sm.length >= 12 ? r1(Math.max(...sm)) : null;
}

/** Learned from the first stimulant dose of each day (a second dose starts with the first still working), leaving out
 *  doses with caffeine from an hour before to two hours after when there are enough others. Needs 4+ doses. */
export function heartResponse(med: Medication, doses: Dose[], checkIns: CheckIn[], daily: DailyHealth[], now: number, s: ScheduleSettings): HeartResponse | null {
  const all = doses.filter((d) => live(d) && Date.parse(d.takenAt) > now - 60 * DAY && Date.parse(d.takenAt) <= now - 2 * HOUR).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  const mine = all.filter((d) => d.medicationId === med.id);
  if (mine.length < 4 || !daily.some((x) => x.hr5)) return null;
  const firsts = mine.filter((d) => !all.some((o) => o !== d && Date.parse(o.takenAt) < Date.parse(d.takenAt) && Date.parse(d.takenAt) - Date.parse(o.takenAt) < 6 * HOUR && o.medicationId === d.medicationId));
  const coffee = checkIns.filter((c) => !c.deletedAt && c.chips.includes(CAFFEINE)).map((c) => Date.parse(c.at));
  const clean = firsts.filter((d) => { const t = Date.parse(d.takenAt); return !coffee.some((c) => c > t - HOUR && c < t + 2 * HOUR); });
  const use = clean.length >= 4 ? clean : firsts;
  const curves = use.map((d) => doseCurve(Date.parse(d.takenAt), daily, s)).filter((c): c is NonNullable<typeof c> => !!c);
  if (curves.length < 4) return null;
  const n = SPAN / BLOCK;
  const raw = Array.from({ length: n }, (_, i) => { const v = curves.map((c) => c.delta[i]).filter((x): x is number => typeof x === 'number'); return v.length >= 3 ? median(v) : null; });
  // Heart rate climbs through the morning anyway (getting up, moving, the body clock). On days without a dose, the same
  // window at the usual dose time shows that rise; it's taken off, so what's left is the dose's own.
  const dosedDays = new Set(mine.map((d) => dayKey(Date.parse(d.takenAt), s)));
  const mins = use.map((d) => { const p = zonedParts(Date.parse(d.takenAt), s.tz); return p.h * 60 + p.mi; });
  const usualMin = median(mins);
  const controls: (number | null)[][] = [];
  for (const row of daily.filter((x) => !x.deletedAt && x.hr5 && !dosedDays.has(x.date) && new Date(`${x.date}T12:00`).getTime() > now - 60 * DAY)) {
    const t = new Date(`${row.date}T00:00`).getTime() + usualMin * MIN;
    const c = doseCurve(t, daily, s);
    if (c) controls.push(c.delta);
  }
  const control = controls.length >= 3 ? Array.from({ length: n }, (_, i) => { const v = controls.map((c) => c[i]).filter((x): x is number => typeof x === 'number'); return v.length >= 3 ? median(v) : null; }) : null;
  const med_ = raw.map((v, i) => (v === null ? null : control?.[i] != null ? v - control[i]! : v));
  const sm = smooth(med_);
  const known = sm.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => typeof x.v === 'number');
  const top = known.reduce((m, x) => (x.v > m.v ? x : m), { v: -Infinity, i: 0 });
  const peakBpm = Number.isFinite(top.v) ? r1(top.v) : 0;
  const out: HeartResponse = { doses: curves.length, baseline: Math.round(median(curves.map((c) => c.baseline))), curve: med_.map((v, i) => ({ min: i * 5, delta: v === null ? null : r1(v) })), peakBpm, signal: peakBpm >= 4, controlDays: control ? controls.length : 0 };
  if (!out.signal) return out;
  out.peakMin = top.i * 5;
  const on = known.find((x) => x.i <= top.i && x.v >= Math.max(3, top.v * 0.4));
  out.onsetMin = on ? on.i * 5 : undefined;
  // Settled: the first point after the peak below 30% of it that stays there (or has no readings) for 30 minutes.
  for (const x of known.filter((k) => k.i > top.i)) {
    if (x.v >= top.v * 0.3) continue;
    const next = sm.slice(x.i, x.i + 6).filter((v): v is number => typeof v === 'number');
    if (next.every((v) => v < top.v * 0.3)) { out.wearOffMin = x.i * 5; break; }
  }
  return out;
}

export interface HeartToday { dosedAt: number; delta?: number; rising: boolean; settled: boolean; minutes: number }

/** Today's dose against the learned curve: how far over its own baseline the heart rate is now (at rest), whether the
 *  rise has come, and whether it's settled back after the usual peak. */
export function heartToday(r: HeartResponse, dose: Dose, daily: DailyHealth[], now: number, s: ScheduleSettings): HeartToday | null {
  if (!r.signal) return null;
  const t = Date.parse(dose.takenAt);
  const before = restingSeries(daily, t - HOUR, t, s).filter((v): v is number => typeof v === 'number');
  const base = before.length >= 4 ? median(before) : r.baseline;
  const after = smooth(restingSeries(daily, t, Math.min(now, t + SPAN), s));
  const recent = after.slice(-6).filter((v): v is number => typeof v === 'number');
  if (!recent.length) return { dosedAt: t, rising: false, settled: false, minutes: Math.round((now - t) / MIN) };
  const delta = r1(recent[recent.length - 1] - base);
  const peaked = after.some((v) => typeof v === 'number' && v - base >= r.peakBpm * 0.6);
  const settled = peaked && (now - t) / MIN > (r.peakMin ?? 60) && recent.length >= 3 && recent.every((v) => v - base < r.peakBpm * 0.3);
  return { dosedAt: t, delta, rising: delta >= Math.max(3, r.peakBpm * 0.4), settled, minutes: Math.round((now - t) / MIN) };
}

// ── Sleep on and off a course ───────────────────────────────────────────────────────────────────────

export interface NightStats { nights: number; sleepH?: number; deepMin?: number; wakes?: number }
export interface CourseSleep { on: NightStats; off: NightStats; better?: boolean; lines: string[] }

const nights = (rows: DailyHealth[]): NightStats => {
  const v = (f: (x: DailyHealth) => number | undefined) => { const xs = rows.map(f).filter((x): x is number => typeof x === 'number'); return xs.length >= 3 ? xs : null; };
  const h = v((x) => (x.sleepMin ? x.sleepMin / 60 : undefined)), d = v((x) => x.sleepDeepMin), w = v((x) => x.sleepWakes);
  return { nights: rows.length, sleepH: h ? r1(mean(h)) : undefined, deepMin: d ? Math.round(mean(d)) : undefined, wakes: w ? r1(mean(w)) : undefined };
};

/** Watch nights after a dose of this medicine against nights without one (within 90 days): time asleep, deep sleep and
 *  how often awake. Needs 5+ nights on each side. */
export function courseSleep(med: Medication, doses: Dose[], daily: DailyHealth[], now: number, s: ScheduleSettings): CourseSleep | null {
  const dosed = new Set(doses.filter((d) => live(d) && d.medicationId === med.id && Date.parse(d.takenAt) > now - 90 * DAY).map((d) => dayKey(Date.parse(d.takenAt) + DAY, s)));
  if (dosed.size < 5) return null;
  const rows = daily.filter((x) => !x.deletedAt && x.sleepMin && new Date(`${x.date}T12:00`).getTime() > now - 90 * DAY);
  const on = rows.filter((x) => dosed.has(x.date)), off = rows.filter((x) => !dosed.has(x.date));
  if (on.length < 5 || off.length < 5) return null;
  const a = nights(on), b = nights(off);
  const lines: string[] = [];
  let score = 0;
  if (a.sleepH !== undefined && b.sleepH !== undefined && Math.abs(a.sleepH - b.sleepH) >= 0.25) { lines.push(`Asleep ${a.sleepH} h against ${b.sleepH} h`); score += Math.sign(a.sleepH - b.sleepH); }
  if (a.deepMin !== undefined && b.deepMin !== undefined && Math.abs(a.deepMin - b.deepMin) >= 8) { lines.push(`Deep sleep ${a.deepMin} min against ${b.deepMin}`); score += Math.sign(a.deepMin - b.deepMin); }
  if (a.wakes !== undefined && b.wakes !== undefined && Math.abs(a.wakes - b.wakes) >= 0.7) { lines.push(`Awake ${a.wakes} times against ${b.wakes}`); score -= Math.sign(a.wakes - b.wakes); }
  return { on: a, off: b, better: lines.length ? score > 0 : undefined, lines };
}

/** On a course: where it is (for the wording). */
export const onCourse = (med: Medication, now: number, s: ScheduleSettings) => {
  const c = med.schedule.course;
  return c ? courseInfo(c, getDayBounds(now, s.dayStartsAt, s.tz).start, s).phase === 'on' : false;
};

// ── Through the week after a shot ───────────────────────────────────────────────────────────────────

export interface ShotWeek {
  /** Average resting heart rate and HRV by days since the last shot (0 = shot day). */
  byDay: { day: number; rhr?: number; hrv?: number; n: number }[];
  /** By dose: average resting heart rate and HRV while on it. */
  byDose: { dose: number; rhr?: number; hrv?: number; days: number }[];
  /** The highest-day rise in resting heart rate over the lowest, when there's a pattern. */
  swing?: { high: number; low: number; bpm: number };
}

/** For a shot taken once or a few times a week: the last 12 weeks of resting heart rate and HRV, by days since the shot
 *  and by dose. Needs 14+ days with a reading. */
export function shotWeek(med: Medication, doses: Dose[], daily: DailyHealth[], now: number, s: ScheduleSettings): ShotWeek | null {
  const shots = doses.filter((d) => live(d) && d.medicationId === med.id && Date.parse(d.takenAt) > now - 98 * DAY).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  if (shots.length < 3) return null;
  const rows = daily.filter((x) => !x.deletedAt && (x.restingHr || x.hrvMs)).map((x) => ({ x, t: new Date(`${x.date}T12:00`).getTime() })).filter((r) => r.t > Date.parse(shots[0].takenAt) && r.t <= now);
  if (rows.length < 14) return null;
  const maxGap = Math.max(...shots.slice(1).map((d, i) => Math.round((Date.parse(d.takenAt) - Date.parse(shots[i].takenAt)) / DAY)), 1);
  const days = Math.min(7, Math.max(2, maxGap));
  const buckets = Array.from({ length: days }, () => ({ rhr: [] as number[], hrv: [] as number[] }));
  const doses_ = new Map<number, { rhr: number[]; hrv: number[]; days: number }>();
  for (const { x, t } of rows) {
    const last = [...shots].reverse().find((d) => Date.parse(d.takenAt) <= t + 12 * HOUR);
    if (!last) continue;
    const k = Math.floor((new Date(`${x.date}T12:00`).getTime() - new Date(`${dayKey(Date.parse(last.takenAt), s)}T12:00`).getTime()) / DAY);
    if (k >= 0 && k < days) { if (x.restingHr) buckets[k].rhr.push(x.restingHr); if (x.hrvMs) buckets[k].hrv.push(x.hrvMs); }
    const b = doses_.get(last.amount) ?? { rhr: [], hrv: [], days: 0 };
    if (x.restingHr) b.rhr.push(x.restingHr); if (x.hrvMs) b.hrv.push(x.hrvMs); b.days++;
    doses_.set(last.amount, b);
  }
  const byDay = buckets.map((b, day) => ({ day, rhr: b.rhr.length >= 2 ? Math.round(mean(b.rhr)) : undefined, hrv: b.hrv.length >= 2 ? Math.round(mean(b.hrv)) : undefined, n: Math.max(b.rhr.length, b.hrv.length) }));
  const byDose = [...doses_].sort((a, b) => a[0] - b[0]).filter(([, b]) => b.days >= 5)
    .map(([dose, b]) => ({ dose, rhr: b.rhr.length ? Math.round(mean(b.rhr)) : undefined, hrv: b.hrv.length ? Math.round(mean(b.hrv)) : undefined, days: b.days }));
  const withR = byDay.filter((d) => d.rhr !== undefined);
  let swing: ShotWeek['swing'];
  if (withR.length >= 2) {
    const hi = withR.reduce((m, d) => (d.rhr! > m.rhr! ? d : m)), lo = withR.reduce((m, d) => (d.rhr! < m.rhr! ? d : m));
    if (hi.rhr! - lo.rhr! >= 2) swing = { high: hi.day, low: lo.day, bpm: hi.rhr! - lo.rhr! };
  }
  return { byDay, byDose, swing };
}
