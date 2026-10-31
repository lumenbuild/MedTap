// Across medicines: resting heart rate drifting up (stimulants and retatrutide can both raise it), and days when a
// GLP-1 and a stimulant together push eating very low. From the person's own records. Pure.
import type { DailyHealth, Dose, FoodLog, Medication } from '../db/schema';
import { inGroup } from './interactions';
import { isStimulant } from './stimulant';
import { getDayBounds, type ScheduleSettings } from './schedule';
import { dayKey } from './stats';
import { totalsFor } from './nutrition';

const DAY = 86_400_000;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const live = (d: Dose) => !d.deletedAt && !d.skipped;
const glp1 = (m: Medication) => inGroup(m, 'glp1');

// ── Resting heart rate ──────────────────────────────────────────────────────────────────────────────

export interface HeartWatch {
  /** The last 2 weeks against the 4 before (bpm). */
  now: number; before: number;
  /** On days with a stimulant against days without (last 6 weeks), when there are enough of each. */
  stimDays?: { on: number; off: number };
  /** A GLP-1 dose change in the window, as "2 mg → 3 mg". */
  change?: string;
}

/** Resting heart rate up 5+ bpm over the last 2 weeks against the 4 before (10+ and 14+ days with a reading). */
export function heartWatch(meds: Medication[], doses: Dose[], daily: DailyHealth[], now: number, s: ScheduleSettings): HeartWatch | null {
  const rows = daily.filter((x) => !x.deletedAt && typeof x.restingHr === 'number').map((x) => ({ t: new Date(`${x.date}T12:00`).getTime(), date: x.date, v: x.restingHr! }));
  const recent = rows.filter((x) => x.t > now - 14 * DAY && x.t <= now), before = rows.filter((x) => x.t <= now - 14 * DAY && x.t > now - 42 * DAY);
  if (recent.length < 10 || before.length < 14) return null;
  const a = Math.round(mean(recent.map((x) => x.v))), b = Math.round(mean(before.map((x) => x.v)));
  if (a - b < 5) return null;
  const out: HeartWatch = { now: a, before: b };
  const stim = new Set(meds.filter((m) => isStimulant(m)).map((m) => m.id));
  if (stim.size) {
    const days = new Set(doses.filter((d) => live(d) && stim.has(d.medicationId)).map((d) => dayKey(Date.parse(d.takenAt), s)));
    const w = rows.filter((x) => x.t > now - 42 * DAY);
    const on = w.filter((x) => days.has(x.date)).map((x) => x.v), off = w.filter((x) => !days.has(x.date)).map((x) => x.v);
    if (on.length >= 5 && off.length >= 5) out.stimDays = { on: Math.round(mean(on)), off: Math.round(mean(off)) };
  }
  for (const m of meds.filter(glp1)) {
    const ds = doses.filter((d) => live(d) && d.medicationId === m.id && Date.parse(d.takenAt) > now - 42 * DAY).sort((x, y) => x.takenAt.localeCompare(y.takenAt));
    const i = ds.findIndex((d, k) => k > 0 && d.amount > ds[k - 1].amount);
    if (i > 0) { out.change = `${m.nickname || m.name} ${ds[i - 1].amount} → ${ds[i].amount} ${m.unit}`; break; }
  }
  return out;
}

// ── Eating very little ──────────────────────────────────────────────────────────────────────────────

export interface UnderEating {
  /** Today so far, with both on board: eaten against the targets, and the hour it's checked at. */
  today?: { kcal: number; protein: number; kcalTarget?: number; proteinTarget?: number };
  /** Over the last 4 weeks: days with both against days without (average Cal and protein). */
  pattern?: { both: { kcal: number; protein: number; days: number }; other: { kcal: number; protein: number; days: number } };
}

/** With a GLP-1 and a stimulant both taken today, from 3 pm: under a third of the calorie target, or under 40% of the
 *  protein target. And the pattern: days with both average at least 20% fewer calories than other logged days. */
export function underEating(meds: Medication[], doses: Dose[], foodLogs: FoodLog[], targets: { kcal?: number | null; protein?: number | null }, now: number, s: ScheduleSettings): UnderEating | null {
  const g = new Set(meds.filter((m) => !m.archived && glp1(m)).map((m) => m.id));
  const st = new Set(meds.filter((m) => !m.archived && isStimulant(m)).map((m) => m.id));
  if (!g.size || !st.size) return null;
  const logs = foodLogs.filter((f) => !f.deletedAt);
  // A GLP-1 is "on board" for a week after a shot; a stimulant on the day it's taken.
  const glpOn = (dayStart: number) => doses.some((d) => live(d) && g.has(d.medicationId) && Date.parse(d.takenAt) <= dayStart + DAY && Date.parse(d.takenAt) > dayStart - 7 * DAY);
  const stimOn = (dayStart: number, end: number) => doses.some((d) => live(d) && st.has(d.medicationId) && Date.parse(d.takenAt) >= dayStart && Date.parse(d.takenAt) < end);
  const start = getDayBounds(now, s.dayStartsAt, s.tz).start;
  const out: UnderEating = {};
  const hour = (now - start) / 3_600_000;
  if (hour >= 11 && glpOn(start) && stimOn(start, now)) {
    const t = totalsFor(logs, start, now);
    const kcal = t.kcal ?? 0, protein = t.protein ?? 0;
    const lowK = targets.kcal ? kcal < targets.kcal / 3 : false, lowP = targets.protein ? protein < targets.protein * 0.4 : false;
    if (lowK || lowP) out.today = { kcal: Math.round(kcal), protein: Math.round(protein), kcalTarget: targets.kcal ?? undefined, proteinTarget: targets.protein ?? undefined };
  }
  const both: { k: number; p: number }[] = [], other: { k: number; p: number }[] = [];
  for (let i = 1; i <= 28; i++) {
    const d0 = start - i * DAY;
    const t = totalsFor(logs, d0, d0 + DAY);
    if (!t.kcal || t.kcal < 300) continue; // a day with hardly anything logged isn't a day of eating
    (glpOn(d0) && stimOn(d0, d0 + DAY) ? both : other).push({ k: t.kcal, p: t.protein ?? 0 });
  }
  if (both.length >= 4 && other.length >= 4) {
    const bk = mean(both.map((x) => x.k)), ok = mean(other.map((x) => x.k));
    if (bk <= ok * 0.8) out.pattern = { both: { kcal: Math.round(bk), protein: Math.round(mean(both.map((x) => x.p))), days: both.length }, other: { kcal: Math.round(ok), protein: Math.round(mean(other.map((x) => x.p))), days: other.length } };
  }
  return out.today || out.pattern ? out : null;
}
