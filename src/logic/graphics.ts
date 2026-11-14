// The numbers behind the app's pictures: your usual day as a clock, heart rate as a heatmap, today against your usual,
// dose strips, the fridge shelf, the interaction map and the monthly recap. Pure.
import type { BodyEntry, CheckIn, DailyHealth, Dose, Experiment, Medication, Workout } from '../db/schema';
import { dayKey } from './stats';
import { getDayBounds, isScheduledDay, courseInfo, type ScheduleSettings } from './schedule';
import { testDayFor } from './experiments';
import { currentVial, stockVials, vialStatus } from './peptide';
import { zonedParts } from './tz';

const DAY = 86_400_000;
const live = <T extends { deletedAt?: string }>(x: T) => !x.deletedAt;
const median = (xs: number[]) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const hourOf = (t: number, tz: string) => { const p = zonedParts(t, tz); return p.h + p.mi / 60; };
/** A median of clock times that wraps past midnight (11 pm and 1 am average to midnight, not noon). */
const clockMedian = (hs: number[]) => { if (!hs.length) return NaN; const shifted = hs.map((h) => (h < 12 ? h + 24 : h)); const nightish = hs.filter((h) => h >= 18 || h < 6).length > hs.length / 2; return nightish ? median(shifted) % 24 : median(hs); };

// ── 1. Your usual day, as a clock ──────────────────────────────────────────────────────────────────

export interface ClockMark { h: number; kind: 'dose' | 'drink' | 'focus'; colour?: string; value?: number; label: string }
export interface DayClock {
  sleep?: { from: number; to: number }; todaySleep?: { from: number; to: number };
  usual: ClockMark[]; today: ClockMark[];
  walks: { from: number; to: number }[]; todayWalks: { from: number; to: number }[];
}

export function dayClock(d: { meds: Medication[]; doses: Dose[]; checkIns: CheckIn[]; daily: DailyHealth[]; workouts: Workout[] }, now: number, s: ScheduleSettings): DayClock {
  const today = getDayBounds(now, s.dayStartsAt, s.tz);
  const from = today.start - 14 * DAY;
  const nights = d.daily.filter((x) => live(x) && x.sleepStart && x.sleepEnd && new Date(`${x.date}T12:00`).getTime() > from);
  const sleep = nights.length >= 4 ? { from: clockMedian(nights.map((x) => hourOf(x.sleepStart!, s.tz))), to: clockMedian(nights.map((x) => hourOf(x.sleepEnd!, s.tz))) } : undefined;
  const lastNight = d.daily.find((x) => live(x) && x.date === dayKey(now, s) && x.sleepStart && x.sleepEnd);
  const usual: ClockMark[] = [];
  for (const m of d.meds.filter((x) => !x.archived && x.schedule.type !== 'prn')) {
    const ts = d.doses.filter((x) => live(x) && !x.skipped && x.medicationId === m.id && Date.parse(x.takenAt) >= from && Date.parse(x.takenAt) < today.start).map((x) => hourOf(Date.parse(x.takenAt), s.tz));
    if (ts.length < 3) continue;
    // Each cluster of times (a dose a day can be 3: 6 am, 11 am, 3 pm), its median.
    const sorted = [...ts].sort((a, b) => a - b); const groups: number[][] = [];
    for (const h of sorted) { const g = groups[groups.length - 1]; if (g && h - g[g.length - 1] < 1.5) g.push(h); else groups.push([h]); }
    for (const g of groups.filter((x) => x.length >= Math.max(2, ts.length / 10))) usual.push({ h: median(g), kind: 'dose', colour: m.color, label: m.nickname?.trim() || m.name });
  }
  const drinks = d.checkIns.filter((c) => live(c) && (c.caffeineMg ?? 0) > 0 && Date.parse(c.at) >= from && Date.parse(c.at) < today.start).map((c) => hourOf(Date.parse(c.at), s.tz));
  if (drinks.length >= 4) usual.push({ h: median(drinks), kind: 'drink', label: 'Caffeine' });
  const focus = d.checkIns.filter((c) => live(c) && typeof c.focus === 'number' && Date.parse(c.at) >= from && Date.parse(c.at) < today.start)
    .map((c) => ({ h: hourOf(Date.parse(c.at), s.tz), v: c.focus! }));
  for (const f of focus) usual.push({ h: f.h, kind: 'focus', value: f.v, label: `Focus ${f.v}` });
  const todayMarks: ClockMark[] = [
    ...d.doses.filter((x) => live(x) && !x.skipped && Date.parse(x.takenAt) >= today.start && Date.parse(x.takenAt) <= now).map((x) => { const m = d.meds.find((y) => y.id === x.medicationId); return { h: hourOf(Date.parse(x.takenAt), s.tz), kind: 'dose' as const, colour: m?.color, label: m ? (m.nickname?.trim() || m.name) : 'Dose' }; }),
    ...d.checkIns.filter((c) => live(c) && (c.caffeineMg ?? 0) > 0 && Date.parse(c.at) >= today.start).map((c) => ({ h: hourOf(Date.parse(c.at), s.tz), kind: 'drink' as const, label: 'Caffeine' })),
    ...d.checkIns.filter((c) => live(c) && typeof c.focus === 'number' && Date.parse(c.at) >= today.start).map((c) => ({ h: hourOf(Date.parse(c.at), s.tz), kind: 'focus' as const, value: c.focus, label: `Focus ${c.focus}` })),
  ];
  const walksIn = (a: number, b: number) => d.workouts.filter((w) => live(w) && w.cardio?.activity === 'walk' && Date.parse(w.startedAt) >= a && Date.parse(w.startedAt) < b)
    .map((w) => { const h = hourOf(Date.parse(w.startedAt), s.tz); return { from: h, to: h + (w.cardio?.durationMin ?? 15) / 60 }; });
  return { sleep, todaySleep: lastNight ? { from: hourOf(lastNight.sleepStart!, s.tz), to: hourOf(lastNight.sleepEnd!, s.tz) } : undefined,
    usual, today: todayMarks, walks: walksIn(from, today.start), todayWalks: walksIn(today.start, now) };
}

// ── 2. Heart rate as a heatmap ─────────────────────────────────────────────────────────────────────

export interface HeatRow { date: string; hours: (number | null)[]; doses: number[]; started?: string[] }
export function hrHeatmap(daily: DailyHealth[], doses: Dose[], meds: Medication[], s: ScheduleSettings, days = 90, now = Date.now()): HeatRow[] {
  const from = now - days * DAY;
  const stim = new Set(meds.filter((m) => !m.archived && m.schedule.type === 'interval').map((m) => m.id));
  const startDay = new Map<string, string[]>();
  for (const m of meds.filter((x) => !x.archived)) { const k = m.startedOn ?? dayKey(Date.parse(m.createdAt), s); startDay.set(k, [...(startDay.get(k) ?? []), m.nickname?.trim() || m.name]); }
  return daily.filter((x) => live(x) && x.hrByHour?.some((v) => typeof v === 'number') && new Date(`${x.date}T12:00`).getTime() > from)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((x) => ({ date: x.date, hours: x.hrByHour!.slice(0, 24).map((v) => (typeof v === 'number' ? v : null)),
      doses: doses.filter((d) => live(d) && !d.skipped && (stim.size ? stim.has(d.medicationId) : true) && dayKey(Date.parse(d.takenAt), s) === x.date).map((d) => hourOf(Date.parse(d.takenAt), s.tz)),
      started: startDay.get(x.date) }));
}

// ── 3. Today against your usual ────────────────────────────────────────────────────────────────────

export interface UsualBand { hour: number; low: number; mid: number; high: number; today?: number }
export function todayAgainstUsual(daily: DailyHealth[], now: number, s: ScheduleSettings): UsualBand[] | null {
  const todayK = dayKey(now, s);
  const rows = daily.filter((x) => live(x) && x.hrByHour && x.date < todayK && new Date(`${x.date}T12:00`).getTime() > now - 29 * DAY);
  const todayRow = daily.find((x) => live(x) && x.date === todayK);
  if (rows.length < 7 || !todayRow?.hrByHour) return null;
  const q = (xs: number[], p: number) => { const s2 = [...xs].sort((a, b) => a - b); return s2[Math.min(s2.length - 1, Math.max(0, Math.round(p * (s2.length - 1))))]; };
  const out: UsualBand[] = [];
  for (let h = 0; h < 24; h++) {
    const xs = rows.map((r) => r.hrByHour![h]).filter((v): v is number => typeof v === 'number');
    if (xs.length < 5) continue;
    const t = todayRow.hrByHour[h];
    out.push({ hour: h, low: q(xs, 0.2), mid: q(xs, 0.5), high: q(xs, 0.8), today: typeof t === 'number' ? t : undefined });
  }
  return out.length >= 12 ? out : null;
}

// ── 4. Dose strips ─────────────────────────────────────────────────────────────────────────────────

export type StripCell = 'taken' | 'missed' | 'none' | 'future' | 'break' | 'pre';
export interface DoseStrip { med: Medication; cells: { date: string; state: StripCell; offTest: boolean }[] }
export function doseStrips(meds: Medication[], doses: Dose[], experiments: Experiment[], now: number, s: ScheduleSettings, days = 42): DoseStrip[] {
  const today = getDayBounds(now, s.dayStartsAt, s.tz).start;
  return meds.filter((m) => !m.archived && m.schedule.type !== 'prn').map((m) => {
    const added = new Date(new Date(m.createdAt).setHours(0, 0, 0, 0)).getTime();
    const by = new Set(doses.filter((d) => live(d) && !d.skipped && d.medicationId === m.id).map((d) => dayKey(Date.parse(d.takenAt), s)));
    const cells = [];
    for (let i = days - 1; i >= 0; i--) {
      const t = today - i * DAY + DAY / 2, k = dayKey(t, s);
      const planned = isScheduledDay(m, t, s);
      const c = m.schedule.course ? courseInfo(m.schedule.course, t - DAY / 2, s) : undefined;
      const state: StripCell = t < added ? 'pre' : by.has(k) ? 'taken' : c && c.phase === 'break' ? 'break' : !planned ? 'none' : i === 0 ? 'future' : 'missed';
      cells.push({ date: k, state, offTest: testDayFor(m, experiments, k)?.on === false });
    }
    return { med: m, cells };
  }).filter((x) => x.cells.some((c) => c.state === 'taken'));
}

// ── 5. The fridge shelf ────────────────────────────────────────────────────────────────────────────

export interface ShelfItem { med: Medication; fill?: number; mixedAt?: string; unopened: number; oldestExpiry?: string }
export function fridgeShelf(meds: Medication[], doses: Dose[], now: number): ShelfItem[] {
  return meds.filter((m) => !m.archived && m.peptide && (m.vials?.length ?? 0) > 0).map((m) => {
    const v = vialStatus(m, doses, now);
    const stock = stockVials(m);
    const exp = stock.map((x) => x.expiry).filter((x): x is string => !!x).sort()[0];
    return { med: m, fill: v && v.vial.amount > 0 ? Math.max(0, Math.min(1, v.left / v.vial.amount)) : undefined, mixedAt: currentVial(m)?.startedAt, unopened: stock.length, oldestExpiry: exp };
  });
}

// ── 7. The month in review ─────────────────────────────────────────────────────────────────────────

export interface MonthRecap {
  month: string; from: number; to: number;
  weight?: { start: number; end: number }; bodyFat?: { start: number; end: number };
  bestSleepWeek?: { from: number; hours: number }; walkingMin: number; walks: number;
  started: string[]; streak: number; doses: number;
}

export function monthRecap(d: { meds: Medication[]; doses: Dose[]; body: BodyEntry[]; daily: DailyHealth[]; workouts: Workout[] }, year: number, month: number, s: ScheduleSettings): MonthRecap {
  const from = new Date(year, month, 1).getTime(), to = new Date(year, month + 1, 1).getTime();
  const inM = (t: number) => t >= from && t < to;
  const ws = d.body.filter((b) => live(b) && typeof b.weightKg === 'number' && inM(new Date(`${b.date}T08:00`).getTime())).sort((a, b) => a.date.localeCompare(b.date));
  const avg3 = (xs: BodyEntry[], k: 'weightKg' | 'bodyFatPct') => { const v = xs.map((x) => x[k]).filter((y): y is number => typeof y === 'number'); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : undefined; };
  const w0 = avg3(ws.slice(0, 3), 'weightKg'), w1 = avg3(ws.slice(-3), 'weightKg');
  const bf = ws.filter((b) => typeof b.bodyFatPct === 'number');
  const f0 = avg3(bf.slice(0, 3), 'bodyFatPct'), f1 = avg3(bf.slice(-3), 'bodyFatPct');
  const nights = d.daily.filter((x) => live(x) && x.sleepMin && inM(new Date(`${x.date}T12:00`).getTime())).sort((a, b) => a.date.localeCompare(b.date));
  let best: MonthRecap['bestSleepWeek'];
  for (let i = 0; i + 7 <= nights.length; i++) { const h = nights.slice(i, i + 7).reduce((a, x) => a + x.sleepMin!, 0) / 7 / 60; if (!best || h > best.hours) best = { from: new Date(`${nights[i].date}T12:00`).getTime(), hours: Math.round(h * 10) / 10 }; }
  const walks = d.workouts.filter((w) => live(w) && w.cardio?.activity === 'walk' && inM(Date.parse(w.startedAt)));
  const started = d.meds.filter((m) => inM(m.startedOn ? new Date(`${m.startedOn}T12:00`).getTime() : Date.parse(m.createdAt))).map((m) => m.nickname?.trim() || m.name);
  const days = new Set(d.doses.filter((x) => live(x) && !x.skipped && inM(Date.parse(x.takenAt))).map((x) => dayKey(Date.parse(x.takenAt), s)));
  let streak = 0, run = 0;
  for (let t = from + DAY / 2; t < to; t += DAY) { if (days.has(dayKey(t, s))) { run++; streak = Math.max(streak, run); } else run = 0; }
  const monthName = new Date(from).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
  return { month: monthName, from, to, weight: w0 !== undefined && w1 !== undefined && ws.length >= 4 ? { start: w0, end: w1 } : undefined,
    bodyFat: f0 !== undefined && f1 !== undefined && bf.length >= 4 ? { start: f0, end: f1 } : undefined, bestSleepWeek: best,
    walkingMin: Math.round(walks.reduce((a, w) => a + (w.cardio?.durationMin ?? 0), 0)), walks: walks.length, started, streak,
    doses: d.doses.filter((x) => live(x) && !x.skipped && inM(Date.parse(x.takenAt))).length };
}
