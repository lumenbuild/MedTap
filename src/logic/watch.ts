// What the watch app needs beyond the widgets' data, so it works on its own for the day: today's doses with where each
// stands, the reminders for the next day (the watch buzzes for them itself, with Log, Snooze and Skip), last night and
// tonight's bedtime, caffeine and water, the next injection, and the stimulant doses to check heart rate after.
// Pure: the native layer sends whatever this returns.
import type { CheckIn, DailyHealth, Dose, Medication } from '../db/schema';
import { getDayBounds, getDosesToday, getExpectedAmount, getSlots, getStatus, getNextDue, isScheduledDay, timeInDay, type ScheduleSettings } from './schedule';
import { planReminders } from './notify';
import { fmtAmount } from './format';
import { isStimulant } from './stimulant';
import { bedtimeTonight, fmtHM, nightsOf, sleepDebt, sleepScore, usualNight } from './sleep';
import { intakesOf, level, usualDrinks } from './caffeine';
import { dayKey } from './stats';

const HOUR = 3_600_000;

export type WatchDoseState = 'done' | 'skipped' | 'due' | 'later' | 'missed';
export interface WatchDose { medId: string; name: string; at: number | null; amount: string; state: WatchDoseState }
export interface WatchReminder { id: number; medId: string; name: string; amount: string; at: number; dueAt: number }
export interface WatchExtras {
  /** Today's planned doses, in time order; as-needed medicines aren't here (they're in `prn`). */
  doses: WatchDose[];
  /** Set times in the next 24 hours, for the watch's own reminders (only when the person turned them on). */
  reminders: WatchReminder[];
  snoozeMin: number;
  sleep?: { score?: number; word?: string; asleep?: string; deep?: string; bedtime?: number; windDown?: number; wake?: number; debt?: string; ask: boolean };
  /** The next injection (peptide tools). */
  shot?: { name: string; at: number };
  drinks: { caffeineMg: number; caffeineNow: number; limitMg?: number; usual: { name: string; mg: number }[]; waterMl: number; waterTarget?: number; waterAdd: number };
  /** Stimulant doses taken in the last 2 hours: the watch offers a heart-rate reading 30–90 minutes after each. */
  hr: { doseId: string; name: string; at: number }[];
}

export interface WatchInput {
  meds: Medication[]; doses: Dose[]; checkIns: CheckIn[]; daily: DailyHealth[];
  /** The name the watch shows (discreet when reminders are discreet or a privacy PIN hides it). */
  nameOf: (m: Medication) => string;
  remindersOnWatch: boolean; snoozeMin: number; sleepTools: boolean; sleepTargetH: number;
  caffeineLimitMg: number | null; caffeineHalfLifeH: number; waterTarget: number | null; waterAdd: number;
  peptides: boolean;
}

/** Each set time today and where it stands: the k-th dose today fills the k-th slot. */
function dosesToday(m: Medication, doses: Dose[], now: number, s: ScheduleSettings, name: string): WatchDose[] {
  const taken = getDosesToday(doses, m.id, now, s);
  const status = getStatus(m, doses, now, s);
  if (m.schedule.type === 'fixed') {
    const start = getDayBounds(now, s.dayStartsAt, s.tz).start;
    return getSlots(m).map((slot) => timeInDay(start, slot.time, s)).sort((a, b) => a - b).map((at, k) => {
      const d = taken[k];
      const amount = fmtAmount(d?.amount ?? getExpectedAmount(m, doses, at, s), m.unit);
      const state: WatchDoseState = d ? (d.skipped ? 'skipped' : 'done') : at <= now ? (status === 'past-latest-time' && at < now - 4 * HOUR ? 'missed' : 'due') : 'later';
      return { medId: m.id, name, at, amount, state };
    });
  }
  // Every few hours: the doses so far, then the next one.
  const out: WatchDose[] = taken.map((d) => ({ medId: m.id, name, at: Date.parse(d.takenAt), amount: fmtAmount(d.amount, m.unit), state: d.skipped ? 'skipped' as const : 'done' as const }));
  const next = getNextDue(m, doses, now, s);
  if (status === 'due' || status === 'not-due' || status === 'none-today')
    out.push({ medId: m.id, name, at: next, amount: fmtAmount(getExpectedAmount(m, doses, next ?? now, s), m.unit), state: status === 'due' || (status === 'none-today' && !taken.length) ? 'due' : 'later' });
  return out;
}

export function watchExtras(d: WatchInput, now: number, s: ScheduleSettings): WatchExtras {
  const active = d.meds.filter((m) => !m.archived);
  const live = d.doses.filter((x) => !x.deletedAt);
  const doses = active.filter((m) => m.schedule.type !== 'prn' && isScheduledDay(m, now, s))
    .flatMap((m) => dosesToday(m, live, now, s, d.nameOf(m)))
    .sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));

  const byId = new Map(active.map((m) => [m.id, m]));
  const reminders = d.remindersOnWatch
    ? planReminders(active, live, now, s, 2, 30).filter((r) => r.kind === 'due' && r.at < now + 24 * HOUR).map((r) => {
      const m = byId.get(r.medId)!;
      return { id: r.id, medId: r.medId, name: d.nameOf(m), amount: fmtAmount(r.amount, m.unit), at: r.at, dueAt: r.dueAt };
    })
    : [];

  // Sleep: last night's score and tonight's bedtime (the sleep tools).
  let sleep: WatchExtras['sleep'];
  if (d.sleepTools) {
    const ns = nightsOf(d.daily, now);
    const last = ns[ns.length - 1];
    const target = d.sleepTargetH * 60;
    const fresh = last && now - new Date(`${last.date}T12:00`).getTime() < 1.5 * 24 * HOUR;
    const usual = usualNight(ns, s);
    const sc = fresh ? sleepScore(last, target, usualNight(ns, s, last.date), s) : undefined;
    const debt = sleepDebt(ns, target, now);
    const start = getDayBounds(now, s.dayStartsAt, s.tz).start;
    const coach = usual?.wake !== undefined ? bedtimeTonight({ usualWake: usual.wake, targetMin: target, debtMin: debt?.minutes }) : undefined;
    const hhmm = (x: number) => { const min = ((Math.round(x) % 1440) + 1440) % 1440; return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; };
    // Tonight, in the day `now` is in (just after midnight counts as that same night).
    const clock = (min: number) => timeInDay(start, hhmm(min), s);
    sleep = {
      score: sc?.score, word: sc?.word, asleep: fresh ? fmtHM(last.asleep) : undefined, deep: fresh && last.deep ? fmtHM(last.deep) : undefined,
      bedtime: coach ? clock(coach.bedtime) : undefined, windDown: coach ? clock(coach.windDown) : undefined, wake: usual?.wake,
      debt: debt && debt.minutes >= 30 ? `${fmtHM(debt.minutes)} behind this week` : undefined,
      // Ask how they slept once a day, until they've answered.
      ask: !d.checkIns.some((c) => !c.deletedAt && typeof c.sleepQuality === 'number' && dayKey(Date.parse(c.at), s) === dayKey(now, s)),
    };
  }

  const pep = d.peptides ? active.filter((m) => m.peptide).map((m) => ({ m, at: getNextDue(m, live, now, s) })).filter((x): x is { m: Medication; at: number } => x.at !== null).sort((a, b) => a.at - b.at)[0] : undefined;

  // Caffeine today and in your system now; water today.
  const intakes = intakesOf(d.checkIns.filter((c) => !c.deletedAt));
  const { start, end } = getDayBounds(now, s.dayStartsAt, s.tz);
  const today = dayKey(now, s);
  const water = d.daily.filter((x) => !x.deletedAt && x.date === today).reduce((a, x) => a + (x.waterMl ?? 0), 0);
  const drinks = {
    caffeineMg: Math.round(intakes.filter((x) => x.t >= start && x.t < end && x.t <= now).reduce((a, x) => a + x.mg, 0)),
    caffeineNow: Math.round(level(intakes, now, d.caffeineHalfLifeH)), limitMg: d.caffeineLimitMg ?? undefined,
    usual: usualDrinks(intakes, now, 3), waterMl: water, waterTarget: d.waterTarget ?? undefined, waterAdd: d.waterAdd,
  };

  const stim = new Map(active.filter((m) => isStimulant(m) && !m.peptide).map((m) => [m.id, m]));
  const hr = live.filter((x) => !x.skipped && stim.has(x.medicationId) && Date.parse(x.takenAt) > now - 2 * HOUR && Date.parse(x.takenAt) <= now)
    .map((x) => ({ doseId: x.id, name: d.nameOf(stim.get(x.medicationId)!), at: Date.parse(x.takenAt) }));

  return { doses, reminders, snoozeMin: d.snoozeMin, sleep, shot: pep ? { name: d.nameOf(pep.m), at: pep.at } : undefined, drinks, hr };
}

/** The watch never shows a medicine's name: "Dose", "Shot", or "As needed" (numbered when there are several). */
export function watchLabel(meds: Medication[]): (m: Medication) => string {
  const prn = meds.filter((m) => !m.archived && m.schedule.type === 'prn' && !m.peptide);
  return (m) => m.peptide ? 'Shot' : m.schedule.type === 'prn' ? (prn.length > 1 ? `As needed ${prn.indexOf(m) + 1}` : 'As needed') : 'Dose';
}

/** What the watch is sent: only what it uses, with no medicine names (the phone's widgets keep theirs). */
export function watchPayload(w: { app: string; t: number; done: number; total: number; label: string; when: string; dueAt: number | null; logId: string; detail: string; prn: { id: string }[];
  wear?: { dosedAt: number; at: number; early: number; late: number } }, meds: Medication[], extras: WatchExtras, bio?: { ring?: { from: number; to: number }; readiness?: number; chips: string[] }) {
  const name = watchLabel(meds);
  const byId = new Map(meds.map((m) => [m.id, m]));
  const logged = byId.get(w.logId);
  return {
    v: 2, app: w.app, t: w.t, done: w.done, total: w.total,
    label: w.label, title: logged ? name(logged) : '', when: w.when, dueAt: w.dueAt, logId: w.logId, detail: w.detail,
    prn: w.prn.filter((p) => byId.has(p.id)).map((p) => ({ id: p.id, name: name(byId.get(p.id)!) })),
    ...(w.wear ? { wear: { name: 'Focus', dosedAt: w.wear.dosedAt, at: w.wear.at, early: w.wear.early, late: w.wear.late } } : {}),
    ...(bio ? { bio: { readiness: bio.readiness, chips: bio.chips, ...(bio.ring ? { ring: { name: 'Focus', from: bio.ring.from, to: bio.ring.to } } : {}) } } : {}),
    watch: extras,
  };
}
