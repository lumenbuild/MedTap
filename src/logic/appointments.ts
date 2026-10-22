// "Since my last appointment" (both apps): what changed between one appointment and now, against the same length of
// time before it, for a one-page summary to bring along. Pure; from the person's own records.
import type { Appointment, BodyEntry, CheckIn, Dose, LabResult, MedEvent, Medication, Question, Vital } from '../db/schema';
import type { ScheduleSettings } from './schedule';
import { adherenceByDay, daysBetween, ymdToMs } from './stats';
import { seriesOf, robustFit } from './forecast';

const DAY = 86_400_000;
const r = (n: number, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;
const avg = (xs: number[]) => (xs.length ? r(xs.reduce((a, b) => a + b, 0) / xs.length) : undefined);

/** The latest appointment on or before today, and the next one after. */
export function appointmentsAround(appts: Appointment[], todayYmd: string): { last?: Appointment; next?: Appointment } {
  const live = appts.filter((a) => !a.deletedAt).sort((a, b) => a.date.localeCompare(b.date));
  return { last: live.filter((a) => a.date <= todayYmd).pop(), next: live.find((a) => a.date > todayYmd) };
}

export interface Compare { since?: number; before?: number }
export interface MedSummary { med: Medication; taken: number; planned: number; pct?: number; pctBefore?: number; changes: string[] }
export interface AppointmentSummary {
  from: number; to: number; days: number;
  meds: MedSummary[];
  checkIns: { n: number; mood: Compare; focus: Compare; energy: Compare; appetite: Compare; sleepHours: Compare; sleepQuality: Compare };
  chips: { chip: string; since: number; before: number }[];
  weight?: { change?: number; perWeek?: number; first?: number; last?: number };
  bp?: { since?: { sys: number; dia: number; n: number }; before?: { sys: number; dia: number; n: number } };
  labs: LabResult[];
  questions: Question[];
}

/** Everything since `fromYmd` (the last appointment), each compared with the same number of days before it. */
export function summarySince(fromYmd: string, now: number, s: ScheduleSettings, data: {
  meds: Medication[]; doses: Dose[]; checkIns: CheckIn[]; body: BodyEntry[]; vitals: Vital[]; events: MedEvent[]; labs: LabResult[]; questions: Question[];
}): AppointmentSummary {
  const from = new Date(`${fromYmd}T00:00`).getTime();
  const span = Math.max(DAY, now - from);
  const prevFrom = from - span;
  const inNow = (t: number) => t >= from && t <= now;
  const inPrev = (t: number) => t >= prevFrom && t < from;

  const meds = data.meds.filter((m) => !m.archived || data.doses.some((d) => d.medicationId === m.id && inNow(Date.parse(d.takenAt)))).map((med) => {
    const pct = (a: number, b: number) => {
      const days = adherenceByDay(data.doses, med, daysBetween(a, b, s), s);
      const planned = days.reduce((n, d) => n + (d.target ?? 0), 0);
      const taken = days.reduce((n, d) => n + Math.min(d.count, d.target ?? d.count), 0);
      return { planned, taken, pct: planned ? Math.round((taken / planned) * 100) : undefined };
    };
    const cur = pct(from, now), prev = pct(prevFrom, from);
    const changes = data.events.filter((e) => e.medicationId === med.id && inNow(Date.parse(e.at))).sort((a, b) => a.at.localeCompare(b.at)).map((e) => e.summary);
    const total = data.doses.filter((d) => d.medicationId === med.id && !d.deletedAt && !d.skipped && inNow(Date.parse(d.takenAt))).length;
    return { med, taken: med.schedule.type === 'prn' ? total : cur.taken, planned: cur.planned, pct: cur.pct, pctBefore: prev.pct, changes };
  }).filter((x) => x.taken || x.planned || x.changes.length);

  const cis = data.checkIns.filter((c) => !c.deletedAt);
  const now_ = cis.filter((c) => inNow(Date.parse(c.at))), prev_ = cis.filter((c) => inPrev(Date.parse(c.at)));
  const cmp = (f: 'mood' | 'focus' | 'energy' | 'appetite' | 'sleepHours' | 'sleepQuality'): Compare => ({
    since: avg(now_.map((c) => c[f]).filter((x): x is number => typeof x === 'number')),
    before: avg(prev_.map((c) => c[f]).filter((x): x is number => typeof x === 'number')),
  });
  const count = (xs: CheckIn[]) => { const m = new Map<string, number>(); for (const c of xs) for (const chip of c.chips) m.set(chip, (m.get(chip) ?? 0) + 1); return m; };
  const cn = count(now_), cp = count(prev_);
  const chips = [...new Set([...cn.keys(), ...cp.keys()])].map((chip) => ({ chip, since: cn.get(chip) ?? 0, before: cp.get(chip) ?? 0 }))
    .sort((a, b) => b.since - a.since || b.before - a.before).slice(0, 8);

  const pts = seriesOf(data.body, 'weightKg').filter((p) => p.t >= from - DAY && p.t <= now + DAY);
  const fit = pts.length >= 3 ? robustFit(pts, now) : undefined;
  const weight = pts.length >= 2 ? { first: pts[0].v, last: pts[pts.length - 1].v, change: r(pts[pts.length - 1].v - pts[0].v), perWeek: fit && fit.spanDays >= 7 ? r(fit.slope * 7, 2) : undefined } : undefined;

  const bpOf = (xs: Vital[]) => { const v = xs.filter((x) => typeof x.systolic === 'number' && typeof x.diastolic === 'number'); return v.length ? { sys: Math.round(v.reduce((a, x) => a + x.systolic!, 0) / v.length), dia: Math.round(v.reduce((a, x) => a + x.diastolic!, 0) / v.length), n: v.length } : undefined; };
  const vit = data.vitals.filter((v) => !v.deletedAt);
  const bpNow = bpOf(vit.filter((v) => inNow(Date.parse(v.at)))), bpPrev = bpOf(vit.filter((v) => inPrev(Date.parse(v.at))));

  return {
    from, to: now, days: Math.round(span / DAY), meds,
    checkIns: { n: now_.length, mood: cmp('mood'), focus: cmp('focus'), energy: cmp('energy'), appetite: cmp('appetite'), sleepHours: cmp('sleepHours'), sleepQuality: cmp('sleepQuality') },
    chips,
    weight,
    bp: bpNow || bpPrev ? { since: bpNow, before: bpPrev } : undefined,
    labs: data.labs.filter((l) => !l.deletedAt && ymdToMs(l.date) >= prevFrom).sort((a, b) => b.date.localeCompare(a.date)),
    questions: data.questions.filter((q) => !q.deletedAt && !q.done),
  };
}
