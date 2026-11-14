// Features built from how the app is really used: what started together, a rough day explained, the first weeks on a
// blood-pressure medicine, stock against the plan, a check of the records themselves, walking minutes, and watch
// strength sessions with nothing logged in them. Facts, never instructions: dose and timing are the prescriber's. Pure.
import type { BodyEntry, CheckIn, DailyHealth, Dose, Experiment, MedEvent, Medication, Vital, Workout } from '../db/schema';
import { ingredientsOf } from './ingredients';
import { dayKey } from './stats';
import { getDayBounds, isScheduledDay, type ScheduleSettings } from './schedule';
import { plannedInjections } from './protocol';
import { currentVial, stockVials, vialStatus } from './peptide';
import { conditionOn, testDayFor } from './experiments';
import { strengthCheck } from './supplements';
import { burnIsRestingOnly } from './energy';
import { methodChange } from './bodyComp';
import { isStrengthSession } from './training';

const DAY = 86_400_000;
const live = <T extends { deletedAt?: string }>(x: T) => !x.deletedAt;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const ymdMs = (k: string) => new Date(`${k}T12:00`).getTime();
const startOf = (m: Medication) => (m.startedOn ? ymdMs(m.startedOn) : Date.parse(m.createdAt));

// ── 1. What started together ───────────────────────────────────────────────────────────────────────

export interface StartCluster {
  from: number; to: number; meds: Medication[];
  /** Two weeks before the first start against everything since (or two weeks after). */
  hrv?: { before: number; after: number }; rhr?: { before: number; after: number }; sleepH?: { before: number; after: number };
}

/** Starts within 10 days of each other, 3 or more: effects from that stretch can't be told apart. Newest first. */
export function startClusters(meds: Medication[], daily: DailyHealth[], now: number): StartCluster[] {
  const ms = meds.filter((m) => !m.archived).map((m) => ({ m, t: startOf(m) })).sort((a, b) => a.t - b.t);
  const out: StartCluster[] = [];
  let i = 0;
  while (i < ms.length) {
    let j = i;
    while (j + 1 < ms.length && ms[j + 1].t - ms[i].t <= 10 * DAY) j++;
    if (j - i + 1 >= 3) {
      const from = ms[i].t, to = ms[j].t;
      const rows = daily.filter(live);
      const avg = (k: 'hrvMs' | 'restingHr' | 'sleepMin', a: number, b: number) => mean(rows.filter((d) => typeof d[k] === 'number' && ymdMs(d.date) >= a && ymdMs(d.date) < b).map((d) => d[k] as number));
      const pair = (k: 'hrvMs' | 'restingHr' | 'sleepMin', scale = 1, dp = 0) => {
        const b = avg(k, from - 14 * DAY, from), a = avg(k, from, Math.min(now, to + 21 * DAY)), f = 10 ** dp;
        return Number.isFinite(a) && Number.isFinite(b) ? { before: Math.round((b / scale) * f) / f, after: Math.round((a / scale) * f) / f } : undefined;
      };
      out.push({ from, to, meds: ms.slice(i, j + 1).map((x) => x.m), hrv: pair('hrvMs'), rhr: pair('restingHr'), sleepH: pair('sleepMin', 60, 1) });
    }
    i = j + 1;
  }
  return out.reverse();
}

/** The other medicines started within 10 days of this one. */
export function startedWith(med: Medication, meds: Medication[]): Medication[] {
  const t = startOf(med);
  return meds.filter((m) => m.id !== med.id && !m.archived && Math.abs(startOf(m) - t) <= 10 * DAY);
}

// ── 2. A rough day, and what keeps going with rough days ───────────────────────────────────────────

export interface DayFacts { date: string; sleepH?: number; hrv?: number; rhr?: number; steps?: number; lastCaffeineH?: number; caffeineMg?: number; missed: string[] }
export interface RoughDay { date: string; score: number; facts: DayFacts; usual: Omit<DayFacts, 'date' | 'missed'>; different: string[] }

const ratingOf = (c: CheckIn) => { const xs = [c.mood, c.energy, c.focus].filter((v): v is number => typeof v === 'number'); return xs.length ? mean(xs) : undefined; };

function facts(k: string, d: { checkIns: CheckIn[]; daily: DailyHealth[]; doses: Dose[]; meds: Medication[] }, s: ScheduleSettings): DayFacts {
  // Night readings are on the morning's row: the night before day k is k's row.
  const row = d.daily.find((x) => live(x) && x.date === k);
  const drinks = d.checkIns.filter((c) => live(c) && (c.caffeineMg ?? 0) > 0 && dayKey(Date.parse(c.at), s) === k);
  const last = drinks.length ? Math.max(...drinks.map((c) => { const t = new Date(Date.parse(c.at)); return t.getHours() + t.getMinutes() / 60; })) : undefined;
  const t = ymdMs(k);
  const missed = d.meds.filter((m) => !m.archived && m.schedule.type !== 'prn' && Date.parse(m.createdAt) < t - DAY && isScheduledDay(m, t, s)
    && !d.doses.some((x) => live(x) && !x.skipped && x.medicationId === m.id && dayKey(Date.parse(x.takenAt), s) === k)).map((m) => m.nickname?.trim() || m.name);
  return { date: k, sleepH: row?.sleepMin ? row.sleepMin / 60 : undefined, hrv: row?.hrvMs, rhr: row?.restingHr, steps: row?.steps,
    lastCaffeineH: last, caffeineMg: drinks.length ? drinks.reduce((a, c) => a + (c.caffeineMg ?? 0), 0) : undefined, missed };
}

function usualOf(all: DayFacts[]) {
  const m = (k: 'sleepH' | 'hrv' | 'rhr' | 'steps' | 'lastCaffeineH' | 'caffeineMg') => { const xs = all.map((x) => x[k]).filter((v): v is number => typeof v === 'number'); return xs.length >= 5 ? mean(xs) : undefined; };
  return { sleepH: m('sleepH'), hrv: m('hrv'), rhr: m('rhr'), steps: m('steps'), lastCaffeineH: m('lastCaffeineH'), caffeineMg: m('caffeineMg') };
}

function differences(f: DayFacts, u: ReturnType<typeof usualOf>): string[] {
  const out: string[] = [];
  const h = (v: number) => `${Math.floor(v)}h ${String(Math.round((v % 1) * 60)).padStart(2, '0')}`;
  if (f.sleepH !== undefined && u.sleepH !== undefined && u.sleepH - f.sleepH >= 0.75) out.push(`${h(f.sleepH)} asleep the night before (usual ${h(u.sleepH)})`);
  if (f.hrv !== undefined && u.hrv !== undefined && f.hrv <= u.hrv * 0.85) out.push(`HRV ${Math.round(f.hrv)} ms (usual ${Math.round(u.hrv)})`);
  if (f.rhr !== undefined && u.rhr !== undefined && f.rhr - u.rhr >= 3) out.push(`resting heart rate ${Math.round(f.rhr)} (usual ${Math.round(u.rhr)})`);
  if (f.steps !== undefined && u.steps !== undefined && f.steps < u.steps * 0.6) out.push(`${f.steps.toLocaleString('en-AU')} steps (usual ${Math.round(u.steps).toLocaleString('en-AU')})`);
  if (f.lastCaffeineH !== undefined && u.lastCaffeineH !== undefined && f.lastCaffeineH - u.lastCaffeineH >= 2) out.push('caffeine later than usual');
  if (f.missed.length) out.push(`no dose logged: ${f.missed.join(', ')}`);
  return out;
}

/** Yesterday, when its check-ins averaged 2 or lower across mood, energy and focus: what was different about it. */
export function roughYesterday(d: { checkIns: CheckIn[]; daily: DailyHealth[]; doses: Dose[]; meds: Medication[] }, now: number, s: ScheduleSettings): RoughDay | null {
  const k = dayKey(now - DAY, s);
  const rs = d.checkIns.filter((c) => live(c) && dayKey(Date.parse(c.at), s) === k).map(ratingOf).filter((v): v is number => v !== undefined);
  if (!rs.length || mean(rs) > 2) return null;
  const days: DayFacts[] = [];
  for (let i = 2; i <= 30; i++) days.push(facts(dayKey(now - i * DAY, s), d, s));
  const f = facts(k, d, s), u = usualOf(days);
  const different = differences(f, u);
  return { date: k, score: Math.round(mean(rs) * 10) / 10, facts: f, usual: u, different };
}

export interface RoughPattern { what: string; of: number; days: number }
/** Something that went with 3+ of the lowest-rated days (and with under half of the rest): said once there's proof. */
export function roughPattern(d: { checkIns: CheckIn[]; daily: DailyHealth[]; doses: Dose[]; meds: Medication[] }, now: number, s: ScheduleSettings): RoughPattern | null {
  const by = new Map<string, number[]>();
  for (const c of d.checkIns.filter(live)) { const r = ratingOf(c); if (r === undefined) continue; const k = dayKey(Date.parse(c.at), s); if (Date.parse(c.at) < now - 60 * DAY) continue; by.set(k, [...(by.get(k) ?? []), r]); }
  const scored = [...by].map(([k, xs]) => ({ k, v: mean(xs) })).sort((a, b) => a.v - b.v);
  if (scored.length < 12) return null;
  const low = scored.filter((x) => x.v <= 2).slice(0, 6), rest = scored.filter((x) => x.v > 2.5);
  if (low.length < 3) return null;
  const F = (k: string) => facts(k, d, s);
  const tests: { what: string; test: (f: DayFacts) => boolean }[] = [
    { what: 'under 6.5 h of sleep the night before', test: (f) => f.sleepH !== undefined && f.sleepH < 6.5 },
    { what: 'HRV under 20 ms', test: (f) => f.hrv !== undefined && f.hrv < 20 },
    { what: 'a dose not logged', test: (f) => f.missed.length > 0 },
    { what: 'under 4,000 steps', test: (f) => f.steps !== undefined && f.steps < 4000 },
  ];
  const lowF = low.map((x) => F(x.k)), restF = rest.map((x) => F(x.k));
  for (const t of tests) {
    const n = lowF.filter(t.test).length, r = restF.length ? restF.filter(t.test).length / restF.length : 1;
    if (n >= 3 && n / lowF.length >= 0.6 && r < 0.5) return { what: t.what, of: n, days: lowF.length };
  }
  return null;
}

// ── 3. The first weeks on a medicine that lowers blood pressure (guanfacine, clonidine) ──────────

const ALPHA2 = ['guanfacine', 'clonidine'];
export const lowersBp = (m: Medication) => ingredientsOf(m).some((i) => ALPHA2.includes(i.name));

export interface StartWatch {
  med: Medication; day: number;
  bpThisWeek: number; bp: { s: number; d: number }[];
  rhr?: { before: number; since: number };
  /** Scheduled days in a row with no dose logged, up to yesterday. */
  missedRun: number;
}

/** In its first 6 weeks: blood pressure readings this week, resting heart rate before and since, and any run of
 *  scheduled days without a logged dose. */
export function startWatch(meds: Medication[], doses: Dose[], vitals: Vital[], daily: DailyHealth[], now: number, s: ScheduleSettings): StartWatch[] {
  return meds.filter((m) => !m.archived && lowersBp(m) && now - startOf(m) < 42 * DAY && now >= startOf(m)).map((m) => {
    const t0 = startOf(m);
    const vs = vitals.filter((v) => live(v) && v.systolic && v.diastolic && Date.parse(v.at) >= t0).sort((a, b) => a.at.localeCompare(b.at));
    const rows = daily.filter((d) => live(d) && typeof d.restingHr === 'number');
    const before = mean(rows.filter((d) => ymdMs(d.date) < t0 && ymdMs(d.date) >= t0 - 14 * DAY).map((d) => d.restingHr!));
    const since = mean(rows.filter((d) => ymdMs(d.date) > t0 + DAY).map((d) => d.restingHr!));
    let missedRun = 0;
    for (let i = 1; i <= 7; i++) {
      const t = getDayBounds(now - i * DAY, s.dayStartsAt, s.tz).start + DAY / 2;
      if (t < Date.parse(m.createdAt)) break;
      if (!isScheduledDay(m, t, s)) continue;
      const k = dayKey(t, s);
      if (doses.some((d) => live(d) && !d.skipped && d.medicationId === m.id && dayKey(Date.parse(d.takenAt), s) === k)) break;
      missedRun++;
    }
    return { med: m, day: Math.floor((now - t0) / DAY) + 1, bpThisWeek: vs.filter((v) => Date.parse(v.at) > now - 7 * DAY).length,
      bp: vs.slice(-6).map((v) => ({ s: v.systolic!, d: v.diastolic! })),
      rhr: Number.isFinite(before) && Number.isFinite(since) ? { before: Math.round(before), since: Math.round(since) } : undefined, missedRun };
  });
}

// ── 4. Stock against the plan ──────────────────────────────────────────────────────────────────────

export interface StockOutlook {
  med: Medication; unopened: number; inHand: number;
  /** About how many days what's in hand lasts at the planned doses. */
  lastsDays: number;
  /** The course's last day, when it has one that ends before the stock does. */
  courseEnds?: number;
  /** Unopened vials whose printed expiry comes before the day they'd be reached. */
  expireFirst: number;
  /** A course-based medicine: how many whole courses of its length what's in hand covers. */
  courses?: { n: number; days: number };
}

export function stockOutlook(med: Medication, doses: Dose[], now: number, s: ScheduleSettings): StockOutlook | null {
  if (!med.peptide || med.archived || med.schedule.type === 'prn') return null;
  const per = plannedInjections([med], doses, now, s, 84).map((d) => d.byMed[0]?.amounts.reduce((a, x) => a + x, 0) ?? 0);
  const perDay = per.reduce((a, x) => a + x, 0) / 84;
  if (!(perDay > 0)) return null;
  const v = vialStatus(med, doses, now);
  const stock = stockVials(med);
  const inHand = (v && !v.expired ? v.left : 0) + stock.reduce((a, x) => a + x.amount, 0);
  const lastsDays = Math.round(inHand / perDay);
  const c = med.schedule.course;
  const courseEnds = c ? Date.parse(`${c.start}T12:00`) + (c.days - 1) * DAY : undefined;
  // Vials are opened oldest first: when each is reached, against its printed expiry.
  let used = v && !v.expired ? v.left : 0, expireFirst = 0;
  for (const x of [...stock].sort((a, b) => (a.expiry ?? '9999').localeCompare(b.expiry ?? '9999'))) {
    const reached = now + (used / perDay) * DAY;
    if (x.expiry && Date.parse(`${x.expiry}T23:59`) < reached) expireFirst++;
    used += x.amount;
  }
  // On a course, the stock is counted in courses: averaging a 2-week course over months would say it lasts years.
  let courses: StockOutlook['courses'];
  if (c) {
    const slots = Math.max(1, med.schedule.slots?.length ?? med.schedule.times?.length ?? 1);
    const daysShare = med.schedule.days?.length ? med.schedule.days.length / 7 : 1;
    const perDose = med.schedule.slots?.[0]?.amount ?? med.defaultAmount;
    const perCourse = perDose * slots * c.days * daysShare;
    if (perCourse > 0) courses = { n: Math.floor((inHand / perCourse) * 10) / 10, days: c.days };
  }
  return { med, courses, unopened: stock.length, inHand, lastsDays, courseEnds: courseEnds && courseEnds > now && courseEnds < now + lastsDays * DAY ? courseEnds : undefined, expireFirst };
}

// ── 5. A check of the records ──────────────────────────────────────────────────────────────────────

export type CheckKind = 'scale' | 'burn' | 'food' | 'test' | 'strength' | 'twice' | 'start' | 'double';
export interface DataIssue { key: string; kind: CheckKind; title: string; detail: string; medId?: string; otherId?: string; doseIds?: string[]; fixed?: boolean }

const norm = (n: string) => n.toLowerCase().replace(/[^a-z0-9+]/g, '');

export function dataCheck(d: { meds: Medication[]; doses: Dose[]; body: BodyEntry[]; daily: DailyHealth[]; foodLogs: { at: string; deletedAt?: string }[]; experiments: Experiment[]; foodOn: boolean }, now: number, s: ScheduleSettings): DataIssue[] {
  const out: DataIssue[] = [];
  const fmt = (t: number) => new Date(t).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  const bf = methodChange(d.body, 'bodyFatPct');
  if (bf) out.push({ key: `scale|${bf}`, kind: 'scale', fixed: true, title: `Your scale changed how it measures on ${fmt(ymdMs(bf))}`, detail: 'Body make-up counts from then, so the switch doesn’t read as fat lost or muscle gained.' });
  if (d.daily.some((x) => x.kcalEstimated) || burnIsRestingOnly([...d.daily].sort((a, b) => a.date.localeCompare(b.date)))) out.push({ key: 'burn', kind: 'burn', fixed: true, title: 'Your watch sends only your resting calories', detail: 'The same total every day, whatever your steps. Your walking is added to it, so calories burned and eaten are realistic.' });
  if (d.foodOn) {
    const last = Math.max(0, ...d.foodLogs.filter(live).map((l) => Date.parse(l.at)));
    if (last && now - last > 4 * DAY) out.push({ key: `food|${dayKey(last, s)}`, kind: 'food', title: `No food logged since ${fmt(last)}`, detail: 'Days without food logged show as “not logged”, not as eating nothing. Calorie and protein patterns wait for logged days.' });
  }
  for (const e of d.experiments.filter(live)) {
    const med = d.meds.find((m) => testDayFor(m, [e], e.start) !== null || testDayFor(m, [e], dayKey(now, s)) !== null);
    if (!med) continue;
    const off = d.doses.filter((x) => live(x) && !x.skipped && x.medicationId === med.id && Date.parse(x.takenAt) <= now).filter((x) => {
      const k = dayKey(Date.parse(x.takenAt), s); return conditionOn(e, k) && testDayFor(med, [e], k)?.on === false;
    });
    const days = [...new Set(off.map((x) => dayKey(Date.parse(x.takenAt), s)))].sort();
    if (days.length) out.push({ key: `test|${e.id}|${days.length}`, kind: 'test', title: `${med.nickname?.trim() || med.name} taken on ${days.length} off day${days.length === 1 ? '' : 's'} of “${e.title}”`, detail: `${days.map((k) => fmt(ymdMs(k))).join(', ')}. Those days can’t count towards the result. Today’s rows now show which side of the test the day is.`, medId: med.id });
  }
  for (const m of d.meds.filter((x) => !x.archived)) {
    const c = strengthCheck(m);
    if (c) out.push({ key: `strength|${m.id}|${m.strength}`, kind: 'strength', title: `Check ${m.nickname?.trim() || m.name}’s strength`, detail: c.text, medId: m.id });
  }
  // The same medicine added twice (an archived one and a new one): merge keeps one history.
  for (const a of d.meds) for (const b of d.meds) {
    if (a.id >= b.id || norm(a.name) !== norm(b.name) || (!a.archived && !b.archived && a.personId !== b.personId)) continue;
    const keep = a.archived ? b : a, from = a.archived ? a : b;
    out.push({ key: `twice|${from.id}`, kind: 'twice', title: `${keep.name} is on your list twice`, detail: `“${from.name}”${from.archived ? ' (archived)' : ''} and “${keep.name}”. Merging puts all doses under one, so courses and “Is it working” see the whole history.`, medId: keep.id, otherId: from.id });
  }
  // Doses of the same medicine logged twice within 10 minutes (before the guard, or from another phone).
  for (const m of d.meds) {
    const xs = d.doses.filter((x) => live(x) && !x.skipped && x.medicationId === m.id).sort((p, q) => p.createdAt.localeCompare(q.createdAt));
    const pairs: string[] = [];
    for (let i = 1; i < xs.length; i++) {
      const p = xs[i - 1], q = xs[i];
      if (Date.parse(q.createdAt) - Date.parse(p.createdAt) < 10 * 60_000 && Math.abs(Date.parse(q.takenAt) - Date.parse(p.takenAt)) <= 90 * 60_000 && q.amount === p.amount && (q.personId ?? '') === (p.personId ?? '')) pairs.push(q.id);
    }
    if (pairs.length) out.push({ key: `double|${m.id}|${pairs.length}`, kind: 'double', title: `${m.nickname?.trim() || m.name}: ${pairs.length} dose${pairs.length === 1 ? '' : 's'} logged twice`, detail: 'The same dose saved twice within a few minutes. Removing the second keeps stock and adherence right.', medId: m.id, doseIds: pairs });
  }
  return out;
}

// ── 8. Walking ─────────────────────────────────────────────────────────────────────────────────────

export interface Walking { minutes: number; walks: number; zones?: { easy: number; steady: number; harder: number } }
/** Today's walks from the watch: minutes, how many, and time by effort (from each walk's heart rate). */
export function walkingToday(workouts: Workout[], now: number, s: ScheduleSettings, maxHr: number): Walking | null {
  const b = getDayBounds(now, s.dayStartsAt, s.tz);
  const ws = workouts.filter((w) => live(w) && w.cardio?.activity === 'walk' && Date.parse(w.startedAt) >= b.start && Date.parse(w.startedAt) < b.end);
  if (!ws.length) return null;
  const zones = { easy: 0, steady: 0, harder: 0 };
  let any = false;
  for (const w of ws) for (const hr of w.cardio?.hrMin ?? []) { if (!hr) continue; any = true; const f = hr / maxHr; if (f < 0.6) zones.easy++; else if (f < 0.75) zones.steady++; else zones.harder++; }
  return { minutes: Math.round(ws.reduce((a, w) => a + (w.cardio?.durationMin ?? 0), 0)), walks: ws.length, zones: any ? zones : undefined };
}

// ── 9. Watch strength sessions with nothing logged ─────────────────────────────────────────────────

/** The last week's strength sessions from the watch with no sets in them, newest first. */
export function unfilledStrength(workouts: Workout[], now: number): Workout[] {
  return workouts.filter((w) => live(w) && w.source === 'health' && !w.sets.some((x) => x.done) && isStrengthSession(w) && Date.parse(w.startedAt) > now - 7 * DAY)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
