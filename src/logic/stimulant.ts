// Stimulants (Ritalin, Vyvanse, dexamfetamine, modafinil, and Semax among the peptides): a one-tap focus check after
// a dose, when the second dose is due (always the schedule's time), which dose and time works best,
// evening crashes, and what's stacking up today (other stimulants and caffeine). From the person's own records. Pure.
import type { CheckIn, DailyHealth, Dose, Medication } from '../db/schema';
import { usualHours } from './durations';
import { sleepImpact } from './habits';
import { wearOffToday } from './wearOff';
import { getDayBounds, getNextDue, type ScheduleSettings } from './schedule';
import { dayKey } from './stats';
import { zonedParts } from './tz';
import { level, type Intake } from './caffeine';
import { focusReader, hasFocus } from './focusReading';
import { fmtTime } from './format';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const r1 = (n: number) => Math.round(n * 10) / 10;
const live = (d: Dose) => !d.deletedAt && !d.skipped;

/** Hours a stimulant usually works: the medicine's usual range, or a few hours for a stimulating peptide (Semax). */
export function stimulantHours(med: Pick<Medication, 'name' | 'ingredients'>): number | undefined {
  const u = usualHours(med);
  if (u) return (u.min + u.max) / 2;
  return /\bsemax\b/i.test(med.name) ? 4 : undefined;
}
export const isStimulant = (med: Pick<Medication, 'name' | 'ingredients'>) => stimulantHours(med) !== undefined;

const hourOf = (t: number, s: ScheduleSettings) => { const p = zonedParts(t, s.tz); return p.h + p.mi / 60; };
export const clock = (h: number) => { const hh = Math.floor(h), mm = Math.round((h - hh) * 60); const d = new Date(2000, 0, 1, hh, mm); return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: mm ? '2-digit' : undefined }).replace(/\s/g, ' ').toLowerCase(); };

// ── One-tap focus check ─────────────────────────────────────────────────────────────────────────────

/** The stimulant dose to ask "how's your focus?" about: taken 45 minutes to 4 hours ago, with no focus answer since. */
export function focusAsk(meds: Medication[], doses: Dose[], checkIns: CheckIn[], now: number): { med: Medication; dose: Dose } | null {
  const stim = new Map(meds.filter((m) => !m.archived && isStimulant(m)).map((m) => [m.id, m]));
  const d = doses.filter((x) => live(x) && stim.has(x.medicationId) && Date.parse(x.takenAt) <= now - 45 * 60_000 && Date.parse(x.takenAt) >= now - 4 * HOUR)
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt))[0];
  if (!d) return null;
  const t = Date.parse(d.takenAt);
  // A rating or a test since the dose answers it.
  if (checkIns.some((c) => !c.deletedAt && hasFocus(c) && Date.parse(c.at) > t && Date.parse(c.at) <= now)) return null;
  return { med: stim.get(d.medicationId)!, dose: d };
}

// ── The second dose ─────────────────────────────────────────────────────────────────────────────────

export interface SecondDose {
  med: Medication; firstAt: number; wearAt: number;
  /** When the second dose is due: the schedule's time (or, with no schedule, the person's own usual gap). Never earlier. */
  at: number;
  source: 'schedule' | 'usual';
  /** The first dose is forecast to wear off 30+ minutes before the second is due. Information only: never moves the dose. */
  gapBefore: boolean;
  afterCutoff?: number;
}

/** For a stimulant taken more than once a day: with today's first dose in and no second yet, when the second is due.
 *  The time always comes from the schedule (or, with none, the person's own usual gap between doses). A forecast
 *  wear-off never moves it earlier or later; it's only noted when the first often wears off well before then. */
export function secondDose(med: Medication, doses: Dose[], checkIns: CheckIn[], daily: DailyHealth[], now: number, s: ScheduleSettings): SecondDose | null {
  if (med.archived || !usualHours(med)) return null;
  const mine = doses.filter((d) => live(d) && d.medicationId === med.id);
  const sc = med.schedule;
  const scheduled = (sc.type === 'fixed' && (sc.slots?.length ?? sc.times?.length ?? 0) >= 2) || (sc.type === 'interval' && !!sc.intervalHours);
  const start = getDayBounds(now, s.dayStartsAt, s.tz).start;
  const today = mine.filter((d) => Date.parse(d.takenAt) >= start && Date.parse(d.takenAt) <= now);
  if (today.length !== 1) return null;
  const firstAt = Date.parse(today[0].takenAt);
  let at: number | null = null;
  let source: SecondDose['source'] = 'schedule';
  if (scheduled) {
    at = getNextDue(med, doses, now, s);
  } else {
    // No twice-a-day schedule: the person's own usual gap between the first and second dose (5+ days in 3 weeks).
    const byDay = new Map<string, number[]>();
    for (const d of mine.filter((x) => Date.parse(x.takenAt) > now - 21 * DAY && Date.parse(x.takenAt) < start)) {
      const k = dayKey(Date.parse(d.takenAt), s); byDay.set(k, [...(byDay.get(k) ?? []), Date.parse(d.takenAt)]);
    }
    const gaps = [...byDay.values()].filter((ts) => ts.length >= 2).map((ts) => { const o = [...ts].sort((a, b) => a - b); return o[1] - o[0]; }).sort((a, b) => a - b);
    if (gaps.length < 5 || gaps.length / Math.max(1, byDay.size) < 0.5) return null;
    at = firstAt + gaps[Math.floor(gaps.length / 2)];
    source = 'usual';
  }
  if (at === null || at < firstAt || at >= start + DAY || at < now - HOUR) return null;
  const w = wearOffToday(med, doses, checkIns, daily, now, s);
  const wearAt = w?.at ?? firstAt + (stimulantHours(med) ?? 4) * HOUR;
  const cut = sleepImpact([med], doses, checkIns, now, s, daily)?.cutoffHour;
  return { med, firstAt, wearAt, at, source, gapBefore: wearAt < at - 30 * 60_000, afterCutoff: cut !== undefined && hourOf(at, s) >= cut ? cut : undefined };
}

/** "Second Ritalin at 11:36 am", or "due now" once the time has come. */
export const secondTitle = (name: string, sd: SecondDose, now: number) => `Second ${name} ${sd.at <= now ? 'due now' : `at ${fmtTime(sd.at)}`}`;
/** Where the time comes from, and plain facts about it. Never a suggestion to take it at another time. */
export function secondDetail(sd: SecondDose): string {
  const parts = [sd.source === 'schedule' ? 'Your scheduled time.' : 'Your usual gap between doses.'];
  if (sd.afterCutoff !== undefined) parts.push('Later than your usual sleep cut-off.');
  if (sd.gapBefore) parts.push(`The first is forecast to wear off about ${fmtTime(sd.wearAt)}: if that's a problem, raise it with your prescriber.`);
  return parts.join(' ');
}

// ── Which dose and time works best ──────────────────────────────────────────────────────────────────

export interface DoseResponse { by: 'amount' | 'time'; better: string; worse: string; focusBetter: number; focusWorse: number; n: number }

/** Focus (ratings and brain or reaction tests) 45 minutes to 4 hours after a dose, by amount and by time taken (before or after 8 am, or the person's middle
 *  time). Says which is better when the gap is half a point or more with 4+ answers each side. */
export function doseResponse(med: Medication, doses: Dose[], checkIns: CheckIn[], now: number, s: ScheduleSettings): DoseResponse | null {
  const ds = doses.filter((d) => live(d) && d.medicationId === med.id && Date.parse(d.takenAt) > now - 120 * DAY).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  const rows: { amount: number; hour: number; focus: number }[] = [];
  const focusOf = focusReader(checkIns);
  for (const c of checkIns.filter((x) => !x.deletedAt && hasFocus(x))) {
    const t = Date.parse(c.at);
    const d = [...ds].reverse().find((x) => Date.parse(x.takenAt) <= t - 45 * 60_000);
    const f = focusOf(c);
    if (!d || t - Date.parse(d.takenAt) > 4 * HOUR || f === undefined) continue;
    rows.push({ amount: d.amount, hour: hourOf(Date.parse(d.takenAt), s), focus: f });
  }
  if (rows.length < 8) return null;
  const out: DoseResponse[] = [];
  const amounts = [...new Set(rows.map((x) => x.amount))].sort((a, b) => a - b);
  if (amounts.length >= 2) {
    const groups = amounts.map((a) => ({ a, f: rows.filter((x) => x.amount === a).map((x) => x.focus) })).filter((g) => g.f.length >= 4);
    if (groups.length >= 2) {
      const sorted = [...groups].sort((x, y) => mean(y.f) - mean(x.f));
      const [b, w] = [sorted[0], sorted[sorted.length - 1]];
      if (mean(b.f) - mean(w.f) >= 0.5) out.push({ by: 'amount', better: `${b.a} ${med.unit}`, worse: `${w.a} ${med.unit}`, focusBetter: r1(mean(b.f)), focusWorse: r1(mean(w.f)), n: b.f.length + w.f.length });
    }
  }
  const hours = rows.map((x) => x.hour).sort((a, b) => a - b);
  const mid = Math.round(hours[Math.floor(hours.length / 2)] * 2) / 2;
  const early = rows.filter((x) => x.hour < mid).map((x) => x.focus), late = rows.filter((x) => x.hour >= mid).map((x) => x.focus);
  if (early.length >= 4 && late.length >= 4 && Math.abs(mean(early) - mean(late)) >= 0.5) {
    const e = mean(early) > mean(late);
    out.push({ by: 'time', better: `${e ? 'before' : 'after'} ${clock(mid)}`, worse: `${e ? 'after' : 'before'} ${clock(mid)}`, focusBetter: r1(Math.max(mean(early), mean(late))), focusWorse: r1(Math.min(mean(early), mean(late))), n: early.length + late.length });
  }
  return out.sort((a, b) => (b.focusBetter - b.focusWorse) - (a.focusBetter - a.focusWorse))[0] ?? null;
}

// ── Evening crash ───────────────────────────────────────────────────────────────────────────────────

export interface Crash { days: number; crashDays: number; lastDoseCrash?: string; lastDoseOk?: string; withSecond?: { crash: number; of: number }; withoutSecond?: { crash: number; of: number } }

const CRASH_CHIPS = ['Crash', 'Irritable', 'Wearing off', 'Low mood', 'Tired'];

/** Evenings (4–10 pm) on stimulant days: a crash is mood or energy at 2 or under, or a crash-like chip. Against the
 *  day's last dose time, and whether a second dose was taken. Needs 10+ evenings with a check-in. */
export function eveningCrash(meds: Medication[], doses: Dose[], checkIns: CheckIn[], now: number, s: ScheduleSettings): Crash | null {
  const ids = new Set(meds.filter((m) => !m.archived && usualHours(m)).map((m) => m.id));
  if (!ids.size) return null;
  const byDay = new Map<string, number[]>();
  for (const d of doses.filter((x) => live(x) && ids.has(x.medicationId) && Date.parse(x.takenAt) > now - 60 * DAY)) {
    const k = dayKey(Date.parse(d.takenAt), s);
    byDay.set(k, [...(byDay.get(k) ?? []), Date.parse(d.takenAt)]);
  }
  const days: { crash: boolean; last: number; n: number }[] = [];
  for (const [k, ts] of byDay) {
    const evening = checkIns.filter((c) => !c.deletedAt && dayKey(Date.parse(c.at), s) === k && hourOf(Date.parse(c.at), s) >= 16 && hourOf(Date.parse(c.at), s) < 22);
    if (!evening.length) continue;
    const crash = evening.some((c) => (c.mood !== undefined && c.mood <= 2) || (c.energy !== undefined && c.energy <= 2) || c.chips.some((x) => CRASH_CHIPS.includes(x)));
    days.push({ crash, last: hourOf(Math.max(...ts), s), n: ts.length });
  }
  if (days.length < 10) return null;
  const crashes = days.filter((d) => d.crash);
  if (crashes.length < 3 || crashes.length / days.length < 0.25) return null;
  const ok = days.filter((d) => !d.crash);
  const lc = mean(crashes.map((d) => d.last)), lo = mean(ok.map((d) => d.last));
  const out: Crash = { days: days.length, crashDays: crashes.length };
  if (ok.length >= 3 && Math.abs(lc - lo) >= 0.75) { out.lastDoseCrash = clock(lc); out.lastDoseOk = clock(lo); }
  const two = days.filter((d) => d.n >= 2), one = days.filter((d) => d.n === 1);
  if (two.length >= 3 && one.length >= 3) { out.withSecond = { crash: two.filter((d) => d.crash).length, of: two.length }; out.withoutSecond = { crash: one.filter((d) => d.crash).length, of: one.length }; }
  return out;
}

// ── What's stacking up today ────────────────────────────────────────────────────────────────────────

export interface Lane { label: string; from: number; to: number }
export interface Load { lanes: Lane[]; caffeinePeakMg: number; overlapFrom?: number; overlapTo?: number; sources: number; edgy?: { withLoad: number; of: number } }

const EDGY = ['Jittery', 'Anxious', 'Heart racing', 'Restless', 'Irritable'];

/** Today's stimulants as lanes (each dose until it usually wears off) plus caffeine in the system, and where two or more
 *  overlap. With history: how often a day with 2+ stimulants and 150+ mg caffeine had an edgy check-in. */
export function stimulantLoad(meds: Medication[], doses: Dose[], intakes: Intake[], checkIns: CheckIn[], now: number, s: ScheduleSettings, halfLifeH = 5): Load | null {
  const stim = new Map(meds.filter((m) => !m.archived && isStimulant(m)).map((m) => [m.id, m]));
  if (!stim.size) return null;
  const laneFor = (from: number, to: number) => doses.filter((d) => live(d) && stim.has(d.medicationId) && Date.parse(d.takenAt) >= from && Date.parse(d.takenAt) < to)
    .map((d) => { const m = stim.get(d.medicationId)!; const t = Date.parse(d.takenAt); return { label: m.nickname || m.name, from: t, to: t + stimulantHours(m)! * HOUR }; });
  const start = getDayBounds(now, s.dayStartsAt, s.tz).start;
  const lanes = laneFor(start, now + 1);
  const peak = (from: number, to: number) => { let p = 0; for (let t = from; t <= to; t += 15 * 60_000) p = Math.max(p, level(intakes, t, halfLifeH)); return Math.round(p); };
  const caffeinePeakMg = peak(start, Math.min(now, start + DAY));
  const sources = new Set(lanes.map((l) => l.label)).size + (caffeinePeakMg >= 100 ? 1 : 0);
  if (sources < 2) return null;
  // Where two or more medicine lanes overlap (or one with 100+ mg caffeine in the system).
  let overlapFrom: number | undefined, overlapTo: number | undefined;
  for (let t = start; t < start + DAY; t += 15 * 60_000) {
    const n = lanes.filter((l) => t >= l.from && t < l.to).length + (level(intakes, t, halfLifeH) >= 100 ? 1 : 0);
    if (n >= 2) { overlapFrom ??= t; overlapTo = t + 15 * 60_000; }
  }
  // History: heavy days against edgy check-ins.
  let edgy: Load['edgy'];
  const heavy: boolean[] = [];
  for (let i = 1; i <= 30; i++) {
    const d0 = start - i * DAY, d1 = d0 + DAY;
    const ls = laneFor(d0, d1);
    if (new Set(ls.map((l) => l.label)).size + (peak(d0, d1) >= 150 ? 1 : 0) < 2) continue;
    heavy.push(checkIns.some((c) => !c.deletedAt && Date.parse(c.at) >= d0 && Date.parse(c.at) < d1 && c.chips.some((x) => EDGY.includes(x))));
  }
  if (heavy.length >= 4) edgy = { withLoad: heavy.filter(Boolean).length, of: heavy.length };
  return { lanes, caffeinePeakMg, overlapFrom, overlapTo, sources, edgy };
}
