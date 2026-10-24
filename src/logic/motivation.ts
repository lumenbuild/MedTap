// Motivation from the person's own records: forgiving streaks (one off day a week doesn't break a run of doses or
// check-ins, one off week in four doesn't break training), milestones worth a moment (streaks, workouts, personal
// bests, steps towards a body goal) and today's ring (how much of today's plan is done). Pure.
import type { BodyEntry, BodyGoal, CheckIn, DailyHealth, Dose, Medication, Workout } from '../db/schema';
import type { Units } from '../db/repos/settings';
import type { ScheduleSettings } from './schedule';
import { getDailyTarget, getDayBounds } from './schedule';
import { dayStartOffset } from './protocol';
import { dayKey } from './stats';
import { answersCheckIn } from './reminders';
import { newPBs, working } from './training';
import type { ExerciseDef } from './exercises';
import { kgTo, weightUnit } from './units';

const DAY = 86_400_000;
const live = <T extends { deletedAt?: string }>(x: T) => !x.deletedAt;

/** A day (or week) in a streak: done, missed, nothing to do (keeps the run going), still open (today, not done yet:
 *  neither adds nor breaks), or before there were any records (where a run can't reach back to). */
export type Mark = 'done' | 'miss' | 'none' | 'open' | 'before';

export interface Run { length: number; best: number; forgiven: number; hits: { length: number; at: number }[] }

/** Walk the marks oldest first. A miss is forgiven if no other was within `window` steps before it; a second one
 *  inside the window ends the run. `at(i)` is when step i ended, for the milestones reached. */
export function runOf(marks: Mark[], window: number, at: (i: number) => number, thresholds: number[] = []): Run {
  let length = 0, best = 0, lastForgiven = -Infinity, forgiven = 0;
  const hits: Run['hits'] = [];
  marks.forEach((m, i) => {
    if (m === 'before') { length = 0; lastForgiven = -Infinity; forgiven = 0; return; }
    if (m === 'open') return;
    if (m === 'miss') {
      if (i - lastForgiven < window) { length = 0; lastForgiven = -Infinity; forgiven = 0; return; }
      lastForgiven = i; forgiven++;
    }
    length++;
    if (thresholds.includes(length)) hits.push({ length, at: at(i) });
    best = Math.max(best, length);
  });
  return { length, best, forgiven, hits };
}

export interface Streak { key: 'doses' | 'checkins' | 'training'; label: string; unit: 'day' | 'week'; length: number; best: number; todayDone: boolean; hits: Run['hits'] }

const DAY_MILESTONES = [7, 14, 30, 60, 100, 150, 200, 300, 365];
const WEEK_MILESTONES = [4, 8, 12, 26, 52];

export interface MotivationData {
  meds: Medication[]; doses: Dose[]; checkIns: CheckIn[]; workouts: Workout[]; daily: DailyHealth[]; body: BodyEntry[];
  goals: BodyGoal[]; perWeek?: number; defs: ExerciseDef[];
}

/** The person's streaks, newest-first relevance: doses (set-time medicines), check-ins and training weeks. */
export function streaks(d: MotivationData, now: number, s: ScheduleSettings, opts: { training: boolean; checkIns: boolean }, days = 400): Streak[] {
  const out: Streak[] = [];
  const dayStart = (back: number) => dayStartOffset(now, -back, s);
  const keys = Array.from({ length: days }, (_, i) => dayKey(dayStart(days - 1 - i) + 12 * 3_600_000, s));
  const endOf = (i: number) => getDayBounds(dayStart(days - 1 - i) + 12 * 3_600_000, s.dayStartsAt, s.tz).end;

  // Doses: each set-time medicine's doses (taken or skipped on purpose) reach the day's target.
  const sched = d.meds.filter((m) => !m.archived && m.schedule.type !== 'prn');
  if (sched.length) {
    const counts = new Map<string, number>();
    let first = Infinity;
    for (const x of d.doses) {
      if (!live(x) || !sched.some((m) => m.id === x.medicationId)) continue;
      const t = Date.parse(x.takenAt);
      first = Math.min(first, t);
      const k = `${x.medicationId}|${dayKey(t, s)}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const marks = keys.map((k, i): Mark => {
      const start = dayStart(days - 1 - i);
      if (getDayBounds(start, s.dayStartsAt, s.tz).end <= first) return 'before';
      let want = 0, got = 0;
      for (const m of sched) {
        const target = getDailyTarget(m, start + 12 * 3_600_000, s) ?? 0;
        if (Date.parse(m.createdAt) > endOf(i) || !target) continue;
        want += target; got += Math.min(target, counts.get(`${m.id}|${k}`) ?? 0);
      }
      if (!want) return 'none';
      if (got >= want) return 'done';
      return i === keys.length - 1 ? 'open' : 'miss';
    });
    const r = runOf(marks, 7, endOf, DAY_MILESTONES);
    if (r.best) out.push({ key: 'doses', label: 'Doses on track', unit: 'day', length: r.length, best: r.best, todayDone: marks.at(-1) === 'done' || marks.at(-1) === 'none', hits: r.hits });
  }

  // Check-ins: a day with one that says how you are.
  if (opts.checkIns) {
    const answered = new Set(d.checkIns.filter(answersCheckIn).map((c) => dayKey(Date.parse(c.at), s)));
    const firstT = Math.min(...d.checkIns.filter(answersCheckIn).map((c) => Date.parse(c.at)));
    const marks = keys.map((k, i): Mark => (endOf(i) <= firstT ? 'before' : answered.has(k) ? 'done' : i === keys.length - 1 ? 'open' : 'miss'));
    const r = runOf(marks, 7, endOf, DAY_MILESTONES);
    if (r.best) out.push({ key: 'checkins', label: 'Check-ins', unit: 'day', length: r.length, best: r.best, todayDone: marks.at(-1) === 'done', hits: r.hits });
  }

  // Training: weeks (Monday to Sunday) with the week's sessions; one off week in four is forgiven.
  if (opts.training) {
    const ws = d.workouts.filter((w) => live(w) && (working(w.sets).length || w.cardio));
    if (ws.length) {
      const per = d.perWeek ?? 1;
      const today = getDayBounds(now, s.dayStartsAt, s.tz).start;
      const monday = dayStartOffset(now, -((new Date(today + 12 * 3_600_000).getDay() + 6) % 7), s);
      const weeks = 60;
      const firstT = Math.min(...ws.map((w) => Date.parse(w.startedAt)));
      const startOf = (i: number) => dayStartOffset(monday, -7 * (weeks - 1 - i), s);
      const marks = Array.from({ length: weeks }, (_, i): Mark => {
        const a = startOf(i), b = i === weeks - 1 ? Infinity : startOf(i + 1);
        if (b <= firstT) return 'before';
        const n = ws.filter((w) => { const t = Date.parse(w.startedAt); return t >= a && t < b; }).length;
        return n >= per ? 'done' : i === weeks - 1 ? 'open' : 'miss';
      });
      const r = runOf(marks, 4, (i) => (i === weeks - 1 ? now : startOf(i + 1)), WEEK_MILESTONES);
      if (r.best) out.push({ key: 'training', label: per > 1 ? `Training weeks (${per}+ sessions)` : 'Training weeks', unit: 'week', length: r.length, best: r.best, todayDone: marks.at(-1) === 'done', hits: r.hits });
    }
  }
  return out;
}

export interface Milestone { id: string; at: number; title: string; detail?: string; kind: 'streak' | 'workouts' | 'pb' | 'goal' }

const WORKOUT_COUNTS = [1, 10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500];

/** Every milestone reached, newest first: streak lengths, workout counts, personal bests and steps towards a goal. */
export function milestones(d: MotivationData, st: Streak[], now: number, units: Units, opts: { training: boolean; body: boolean }): Milestone[] {
  const out: Milestone[] = [];
  for (const x of st) for (const h of x.hits) {
    out.push({ id: `streak:${x.key}:${h.length}:${Math.round(h.at / DAY)}`, at: h.at, kind: 'streak',
      title: `${h.length} ${x.unit}s: ${x.label.toLowerCase()}`, detail: x.unit === 'day' ? 'A run with no more than one off day in any week.' : 'Weeks with your sessions, one off week in four allowed.' });
  }
  if (opts.training) {
    const ws = d.workouts.filter((w) => live(w) && (working(w.sets).length || w.cardio)).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    ws.forEach((w, i) => { if (WORKOUT_COUNTS.includes(i + 1)) out.push({ id: `workouts:${i + 1}`, at: Date.parse(w.startedAt), kind: 'workouts', title: i ? `${i + 1} workouts` : 'Your first workout' }); });
    // Personal bests in the last fortnight (one per lift per workout, the headline one).
    for (const w of ws.filter((x) => Date.parse(x.startedAt) > now - 14 * DAY && working(x.sets).length)) {
      const seen = new Set<string>();
      for (const p of newPBs(w, d.workouts, d.defs, units)) {
        if (seen.has(p.exerciseId)) continue;
        seen.add(p.exerciseId);
        out.push({ id: `pb:${w.id}:${p.exerciseId}`, at: Date.parse(w.startedAt), kind: 'pb', title: `New best: ${d.defs.find((x) => x.id === p.exerciseId)?.name ?? 'a lift'}`, detail: p.text });
      }
    }
  }
  if (opts.body) {
    for (const g of d.goals) {
      if (g.metric !== 'weightKg') continue;
      const ws = d.body.filter((b) => live(b) && typeof b.weightKg === 'number').sort((a, b) => a.date.localeCompare(b.date));
      const total = g.target - g.start;
      if (!total) continue;
      const step = units === 'imperial' ? 4.5359237 : 5; // 10 lb or 5 kg
      const reached = new Set<number>();
      ws.forEach((b, i) => {
        // The average of this weigh-in and the two before, so one low reading isn't a milestone.
        const recent = ws.slice(Math.max(0, i - 2), i + 1).map((x) => x.weightKg!);
        const v = recent.reduce((a, c) => a + c, 0) / recent.length;
        const moved = (v - g.start) * Math.sign(total);
        const at = Date.parse(`${b.date}T12:00`);
        if (at < Date.parse(`${g.startDate}T00:00`)) return;
        for (let k = 1; k * step <= Math.abs(total) + 1e-9; k++) {
          if (moved >= k * step && !reached.has(k)) {
            reached.add(k);
            out.push({ id: `goal:${g.startDate}:${k}`, at, kind: 'goal', title: `${kgTo(k * step, units)} ${weightUnit(units)} ${total < 0 ? 'down' : 'up'}`, detail: `On the way to ${kgTo(g.target, units)} ${weightUnit(units)}.` });
          }
        }
        if (moved >= Math.abs(total) / 2 && !reached.has(-1)) { reached.add(-1); out.push({ id: `goal:${g.startDate}:half`, at, kind: 'goal', title: 'Halfway to your goal', detail: `${kgTo(Math.abs(v - g.start), units)} of ${kgTo(Math.abs(total), units)} ${weightUnit(units)}.` }); }
        if (moved >= Math.abs(total) && !reached.has(-2)) { reached.add(-2); out.push({ id: `goal:${g.startDate}:done`, at, kind: 'goal', title: 'Goal reached', detail: `${kgTo(g.target, units)} ${weightUnit(units)}.` }); }
      });
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

export interface RingPart { key: 'doses' | 'checkin' | 'water' | 'protein'; label: string; got: number; want: number; text: string }
export interface Ring { parts: RingPart[]; value: number; done: number }

/** Today's plan, and how much of it is done: set-time doses due today, a check-in (when there are daily check-in
 *  times), and water and protein against the person's own targets. Each part counts the same. */
export function todayRing(d: Pick<MotivationData, 'meds' | 'doses' | 'checkIns' | 'daily'>, now: number, s: ScheduleSettings,
  o: { checkInTimes: string[]; water: number | null; protein: number | null; intake: boolean }): Ring | null {
  const parts: RingPart[] = [];
  const k = dayKey(now, s);
  const sched = d.meds.filter((m) => !m.archived && m.schedule.type !== 'prn');
  let want = 0, got = 0;
  for (const m of sched) {
    const target = getDailyTarget(m, now, s) ?? 0;
    if (!target) continue;
    want += target;
    got += Math.min(target, d.doses.filter((x) => live(x) && x.medicationId === m.id && dayKey(Date.parse(x.takenAt), s) === k).length);
  }
  if (want) parts.push({ key: 'doses', label: 'Doses', got, want, text: `${got} of ${want}` });
  if (o.checkInTimes.length) {
    const done = d.checkIns.some((c) => answersCheckIn(c) && dayKey(Date.parse(c.at), s) === k);
    parts.push({ key: 'checkin', label: 'Check-in', got: done ? 1 : 0, want: 1, text: done ? 'Done' : 'Not yet' });
  }
  if (o.intake) {
    const day = d.daily.find((x) => live(x) && x.date === k);
    if (o.water) parts.push({ key: 'water', label: 'Water', got: Math.min(o.water, day?.waterMl ?? 0), want: o.water, text: `${Math.round((day?.waterMl ?? 0) / 100) / 10} of ${o.water / 1000} L` });
    if (o.protein) parts.push({ key: 'protein', label: 'Protein', got: Math.min(o.protein, day?.proteinG ?? 0), want: o.protein, text: `${Math.round(day?.proteinG ?? 0)} of ${o.protein} g` });
  }
  if (!parts.length) return null;
  const value = parts.reduce((a, p) => a + p.got / p.want, 0) / parts.length;
  return { parts, value, done: parts.filter((p) => p.got >= p.want).length };
}
