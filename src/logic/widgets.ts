// Everything the home-screen widgets show, worked out by the app and handed to Android in one payload (the widgets
// can't run the app's logic themselves). The next-dose fields stay at the top level for the original widget and the
// watch. Pure; names follow the privacy setting.
import type { BodyEntry, CheckIn, DailyHealth, Dose, MedEvent, Medication, Workout, BodyGoal } from '../db/schema';
import type { ScheduleSettings } from './schedule';
import { byUrgency, getStatus } from './schedule';
import { widgetData, type WidgetData } from './widget';
import { wearOffToday } from './wearOff';
import { weekStrip } from './protocol';
import { sideEffectForecast, appetiteCurve, weightPath } from './predict';
import { getNextDue } from './schedule';
import { fmtTime, fmtWhen } from './format';
import { vialStatus } from './peptide';
import { readiness, working } from './training';
import { smartTarget } from './progression';
import { allExercises } from './exercises';
import { fmtLoad } from './load';
import { whatChanged } from './changes';
import { goalView } from '../screens/Body/Goals';
import { shownName } from './privacy';
import { dayKey } from './stats';
import { kgTo, weightUnit } from './units';
import type { Units } from '../db/repos/settings';
import { CAFFEINE, ALCOHOL } from './lifestyle';

const DAY = 86_400_000;
const WEEK = 7 * DAY;

export type QuickItem = { kind: 'dose'; id: string; label: string } | { kind: 'chip'; chip: string; label: string } | { kind: 'open'; route: string; label: string };
export interface WidgetsPayload extends WidgetData {
  v: 2; t: number;
  /** Doses done today out of those planned (scheduled medicines). */
  done: number; total: number;
  wear?: { name: string; dosedAt: number; at: number; early: number; late: number };
  shot?: { name: string; days: { label: string; state: string; today: boolean }[]; next: string; feel?: string; left?: string };
  intake?: { date: string; protein: number; proteinTarget?: number; water: number; waterTarget?: number };
  quick: QuickItem[];
  weight?: { unit: string; points: number[]; forecast: number[]; latest: string; text: string };
  training?: { score?: number; label?: string; lift?: string; target?: string };
  glance: { next: string; steps?: string; change?: string };
}

export interface WidgetsInput {
  app: string; meds: Medication[]; doses: Dose[]; checkIns: CheckIn[]; body: BodyEntry[]; daily: DailyHealth[]; workouts: Workout[]; events: MedEvent[];
  own: Parameters<typeof allExercises>[0]; goals: BodyGoal[]; units: Units; proteinTarget: number | null; waterTarget: number | null; body_: boolean; training: boolean; peptides: boolean;
}

export function widgetsPayload(d: WidgetsInput, now: number, s: ScheduleSettings): WidgetsPayload {
  const base = widgetData(d.app, d.meds, d.doses, now, s);
  const active = d.meds.filter((m) => !m.archived);
  const scheduled = byUrgency(active.filter((m) => m.schedule.type !== 'prn'), d.doses, now, s);
  const done = scheduled.filter((m) => getStatus(m, d.doses, now, s) === 'done-today').length;
  const out: WidgetsPayload = { ...base, v: 2, t: now, done, total: scheduled.length, quick: [], glance: { next: base.title ? `${base.label}: ${base.title}${base.when ? ` · ${base.when}` : ''}` : 'Nothing scheduled' } };

  // 2. Wear-off: the first medicine with a forecast today.
  for (const m of active.filter((x) => !x.peptide)) {
    const w = wearOffToday(m, d.doses, d.checkIns, d.daily, now, s);
    if (w && w.late > now - 2 * 3_600_000) { out.wear = { name: shownName(m), dosedAt: w.dosedAt, at: w.at, early: w.early, late: w.late }; break; }
  }

  // 3. Shot week: the next injection.
  const pep = d.peptides ? active.filter((m) => m.peptide && getNextDue(m, d.doses, now, s) !== null).sort((a, b) => getNextDue(a, d.doses, now, s)! - getNextDue(b, d.doses, now, s)!)[0] : undefined;
  if (pep) {
    const next = getNextDue(pep, d.doses, now, s)!;
    const fc = sideEffectForecast(pep, d.doses, d.checkIns, now, s);
    const todayFc = fc?.days.find((x) => x.start <= now && x.start + DAY > now);
    const curve = appetiteCurve(pep, d.doses, d.checkIns, now);
    const vs = vialStatus(pep, d.doses, now);
    out.shot = {
      name: shownName(pep),
      days: weekStrip(pep, d.doses, now, s).map((x) => ({ label: x.label, state: x.state, today: x.isToday })),
      next: fmtWhen(next, now),
      feel: [todayFc?.likely[0] ? `${todayFc.likely[0].chip} likely` : null, curve?.todayAppetite !== undefined ? `appetite ${curve.todayAppetite}` : null].filter(Boolean).join(' · ') || undefined,
      left: vs ? `${vs.dosesLeft} dose${vs.dosesLeft === 1 ? '' : 's'} left in the ${pep.peptide?.kind === 'pen' ? 'pen' : 'vial'}` : undefined,
    };
  }

  // 4. Protein and water today.
  const todayK = dayKey(now, s);
  if (d.body_ && d.training) {
    const row = d.daily.find((x) => !x.deletedAt && x.date === todayK);
    out.intake = { date: todayK, protein: Math.round(row?.proteinG ?? 0), proteinTarget: d.proteinTarget ?? undefined, water: row?.waterMl ?? 0, waterTarget: d.waterTarget ?? undefined };
  }

  // 5. Quick log: as-needed medicines, then coffee, then a check-in.
  for (const m of active.filter((x) => x.schedule.type === 'prn').slice(0, 2)) out.quick.push({ kind: 'dose', id: m.id, label: shownName(m) });
  out.quick.push({ kind: 'chip', chip: CAFFEINE, label: 'Coffee' });
  if (out.quick.length < 3) out.quick.push({ kind: 'chip', chip: ALCOHOL, label: 'Alcohol' });
  out.quick.push({ kind: 'open', route: '/checkin', label: 'Check in' });

  // 6. Weight: weekly averages for 8 weeks, then 4 weeks ahead (through the dose plan, else towards the goal).
  if (d.body_) {
    const pts = d.body.filter((b) => !b.deletedAt && typeof b.weightKg === 'number').map((b) => ({ t: new Date(`${b.date}T08:00`).getTime(), v: b.weightKg! }));
    const weeks: number[] = [];
    for (let k = 7; k >= 0; k--) {
      const w = pts.filter((p) => p.t > now - (k + 1) * WEEK && p.t <= now - k * WEEK).map((p) => p.v);
      if (w.length) weeks.push(w.reduce((a, b) => a + b, 0) / w.length);
    }
    if (weeks.length >= 2) {
      const wGoal = d.goals.find((g) => g.metric === 'weightKg');
      const path = pep ? weightPath(pep, d.doses, d.body, now, 4, wGoal?.target) : null;
      const gv = wGoal ? goalView(wGoal, d.body, now) : null;
      const forecast = path ? path.points.slice(1, 5).map((p) => p.v)
        : gv?.f.perWeek !== undefined && gv.f.level !== undefined ? [1, 2, 3, 4].map((k) => gv.f.level! + gv.f.perWeek! * k) : [];
      const u = weightUnit(d.units);
      const eta = gv?.f.eta ? Math.max(1, Math.round((gv.f.eta - now) / WEEK)) : undefined;
      out.weight = { unit: u, points: weeks.map((v) => kgTo(v, d.units)), forecast: forecast.map((v) => kgTo(v, d.units)),
        latest: `${kgTo(pts.sort((a, b) => b.t - a.t)[0].v, d.units)} ${u}`, text: eta ? `Goal in about ${eta} week${eta === 1 ? '' : 's'}` : forecast.length ? `${kgTo(forecast[forecast.length - 1], d.units)} ${u} in 4 weeks` : '' };
    }
  }

  // 7. Training: readiness and the first lift of the last session, at today's target.
  if (d.body_ && d.training) {
    const r = readiness(d.daily, d.checkIns, now, s);
    const last = d.workouts.filter((w) => !w.deletedAt && !w.cardio && working(w.sets).length).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    const exId = last ? working(last.sets)[0]?.exerciseId : undefined;
    const def = exId ? allExercises(d.own).find((x) => x.id === exId) : undefined;
    const t = def ? smartTarget(def, d.workouts, { units: d.units, readiness: r?.score ?? null, now }) : undefined;
    out.training = { score: r?.score, label: r?.label, lift: def?.name,
      target: t && def ? `${t.sets} × ${t.reps}${def.timed ? ' s' : ''}${t.weightKg ? ` · ${fmtLoad(t.weightKg, d.units)}` : ''}` : undefined };
  }

  // 8. At a glance: steps today and the newest change.
  const steps = d.daily.find((x) => !x.deletedAt && x.date === todayK)?.steps;
  if (steps) out.glance.steps = `${steps.toLocaleString('en-AU')} steps`;
  const ch = whatChanged({ meds: d.meds, doses: d.doses, checkIns: d.checkIns, daily: d.daily, events: d.events }, now).find((c) => now - c.at < 10 * DAY);
  if (ch) out.glance.change = `${ch.label} ${ch.after > ch.before ? 'up' : 'down'}${ch.event ? ` after ${ch.event.text}` : ''}`;
  if (out.wear) out.glance.next += ` · focus to ${fmtTime(out.wear.at)}`;
  return out;
}
