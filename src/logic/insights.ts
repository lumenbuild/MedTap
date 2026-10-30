// The insight engine: everything the app's detectors notice, in one shape and one order. Each insight says how much
// it matters and how sure it is, a headline, what it rests on, and one thing to do about it. Today shows the top
// couple; Progress shows them all. Anything put away stays away for a while; anything done from one (a cut-off set,
// a target raised) is checked back on a few weeks later against what actually happened. Pure.
import { format } from 'date-fns';
import type { Appointment, BodyEntry, BodyGoal, CheckIn, DailyHealth, Dose, FoodLog, MedEvent, Medication, Vital, Workout } from '../db/schema';
import type { AppSettings, FollowUp, Units } from '../db/repos/settings';
import type { ScheduleSettings } from './schedule';
import { scriptVisits, oddRecords } from './records';
import { readingsWorthMentioning } from './readings';
import { weightStall } from './stall';
import { whatChanged, fmtChangeValue } from './changes';
import { wearOffToday } from './wearOff';
import { caffeineDays, findCutoff, intakesOf } from './caffeine';
import { calorieTarget, expenditure, latestWeight, leanAlert, proteinTarget } from './energy';
import { robustFit } from './forecast';
import { sleepRegularity, stepsChange } from './movement';
import { dayKey } from './stats';
import { kgTo, weightUnit } from './units';
import { shownName } from './privacy';
import { fmtTime } from './format';

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const day = (t: number) => format(t, 'EEE d MMM');
const hourText = (h: number) => (h === 12 ? '12 pm' : h > 12 ? `${h - 12} pm` : `${h} am`);

export type InsightKind = 'script' | 'reading' | 'stall' | 'wearoff' | 'change' | 'odd' | 'cutoff' | 'calories' | 'protein' | 'lean' | 'appointment' | 'followup' | 'steps' | 'sleep';

export type InsightAction =
  | { kind: 'go'; label: string; href: string }
  | { kind: 'odd'; label: string }
  /** Change a setting; with `followUp`, check back on it in a few weeks. */
  | { kind: 'setting'; label: string; key: keyof AppSettings; value: unknown; followUp?: Omit<FollowUp, 'id' | 'at'>; done: string };

export interface Insight {
  /** Stable while it means the same thing, so putting it away sticks (a new week or a new value is a new one). */
  id: string;
  kind: InsightKind;
  /** 0 to 100: safety and deadlines highest, then what changes the plan, then what's worth knowing. */
  importance: number;
  confidence: 'medium' | 'high';
  headline: string;
  /** What it rests on, in a few words. */
  evidence?: string;
  tone: 'watch' | 'good' | 'plain';
  action?: InsightAction;
  /** How long "Not now" puts it away (days); 0 = until it changes. */
  snoozeDays: number;
  /** A time bar: from the dose to the likely wear-off (the wear-off forecast). */
  bar?: { from: number; early: number; late: number };
}

export interface InsightInput {
  meds: Medication[]; doses: Dose[]; checkIns: CheckIn[]; daily: DailyHealth[]; body: BodyEntry[]; vitals: Vital[];
  workouts: Workout[]; events: MedEvent[]; foodLogs: FoodLog[]; appointments: Appointment[]; goals: BodyGoal[];
  settings: Pick<AppSettings, 'bedtime' | 'caffeineHalfLifeH' | 'caffeineCutoff' | 'proteinTargetG' | 'energyTargetKcal' | 'energyAuto' | 'lossRateKgWeek'
    | 'mentionsDismissed' | 'oddDismissed' | 'insightsHidden' | 'followUps'>;
  units: Units;
  has: { body: boolean; food: boolean; training: boolean; meds: boolean };
}

/** Every insight there is now, most important first, without the ones put away. */
export function insights(d: InsightInput, now: number, s: ScheduleSettings): Insight[] {
  const out: Insight[] = [];
  const st = d.settings;
  const u = weightUnit(d.units);
  const kg = (v: number) => `${kgTo(v, d.units)} ${u}`;

  // Deadlines: a new script to book for.
  if (d.has.meds) {
    for (const v of scriptVisits(d.meds, d.doses, now, s).filter((x) => x.bookBy - now < 21 * DAY)) {
      out.push({ id: `script:${v.meds[0].med.id}:${Math.floor(v.bookBy / DAY)}`, kind: 'script', importance: v.bookBy - now < 7 * DAY ? 85 : 65, confidence: 'high', tone: 'watch',
        headline: `Book your doctor ${v.bookBy < now ? 'soon' : `by ${day(v.bookBy)}`}`, evidence: `For a new script: ${v.meds.map((x) => shownName(x.med)).join(', ')}`,
        action: { kind: 'go', label: 'See', href: `#/meds/${v.meds[0].med.id}` }, snoozeDays: 3 });
    }
  }

  // Readings worth raising with a doctor.
  for (const m of readingsWorthMentioning(d.vitals, d.daily, now).filter((x) => !st.mentionsDismissed.includes(x.key))) {
    out.push({ id: `reading:${m.key}`, kind: 'reading', importance: 80, confidence: 'high', tone: 'watch', headline: m.text, snoozeDays: 7,
      action: { kind: 'go', label: 'See readings', href: '#/progress/body' } });
  }

  // Today's wear-off, while it's ahead or just past.
  if (d.has.meds) {
    for (const m of d.meds.filter((x) => !x.archived && !x.peptide)) {
      const w = wearOffToday(m, d.doses, d.checkIns, d.daily, now, s);
      if (!w || w.late < now - 2 * 3_600_000) continue;
      const past = now > w.at;
      out.push({ id: `wearoff:${m.id}:${Math.floor(w.dosedAt / DAY)}`, kind: 'wearoff', importance: past ? 35 : 60, confidence: 'medium', tone: past ? 'plain' : 'good',
        headline: `${shownName(m)}: ${past ? `likely wearing off since ${fmtTime(w.at)}` : `focus likely drops about ${fmtTime(w.at)}`}`,
        evidence: w.reasons.length ? w.reasons.join(' · ') : 'From when your focus usually drops after a dose', snoozeDays: 1,
        bar: { from: w.dosedAt, early: w.early, late: w.late } });
    }
  }

  // A real plateau (or water), and what's different during it.
  if (d.has.body) {
    const stall = weightStall({ body: d.body, checkIns: d.checkIns, daily: d.daily, doses: d.doses, meds: d.meds, workouts: d.workouts }, now);
    if (stall) {
      out.push({ id: `stall:${Math.floor(stall.since / WEEK)}`, kind: 'stall', importance: stall.likelyWater ? 30 : 70, confidence: stall.days >= 14 ? 'high' : 'medium', tone: 'watch',
        headline: stall.likelyWater ? `Weight steady ${stall.days} days, probably water` : `Weight steady for ${stall.days} days`,
        evidence: stall.likelyWater ? `Water from ${stall.water.join(', ')}` : stall.diffs.length ? `Different now: ${stall.diffs.slice(0, 2).map((x) => `${x.label.toLowerCase()} ${x.before} → ${x.during}`).join(', ')}` : `${stall.before.toFixed(2)} kg a week before, ${stall.during.toFixed(2)} now`,
        action: { kind: 'go', label: 'What’s different', href: '#/progress/body' }, snoozeDays: 7 });
    }
  }

  // A genuine shift in the last 10 days, next to what happened just before it.
  const ids = new Set(d.meds.map((m) => m.id));
  const change = whatChanged({ meds: d.meds, doses: d.doses, checkIns: d.checkIns, daily: d.daily, events: d.events.filter((e) => ids.has(e.medicationId)) }, now)
    .find((c) => now - c.at < 10 * DAY);
  if (change) {
    out.push({ id: `change:${change.key}:${Math.floor(change.at / DAY)}`, kind: 'change', importance: change.good === false ? 50 : 40, confidence: change.z >= 3 ? 'high' : 'medium',
      tone: change.good === undefined ? 'plain' : change.good ? 'good' : 'watch',
      headline: `${change.label} ${change.after > change.before ? 'up' : 'down'}: ${fmtChangeValue(change, change.before)} → ${fmtChangeValue(change, change.after)}`,
      evidence: change.event ? `Since ${day(change.at)}, after ${change.event.text}` : `Since ${day(change.at)}`,
      action: { kind: 'go', label: 'See', href: '#/progress/trends' }, snoozeDays: 0 });
  }

  // Records that look like mistakes.
  const odd = oddRecords(d.meds, d.doses, d.body, d.checkIns, d.vitals, now, st.oddDismissed);
  if (odd.length) {
    out.push({ id: `odd:${odd.map((o) => o.id).join(',')}`, kind: 'odd', importance: 45, confidence: 'high', tone: 'watch',
      headline: `${odd.length} record${odd.length === 1 ? '' : 's'} to check`, evidence: 'They look like a mistake: a double log, a typo', action: { kind: 'odd', label: 'Check' }, snoozeDays: 3 });
  }

  // An appointment in the next two weeks.
  const visit = d.appointments.filter((a) => !a.deletedAt && a.date >= dayKey(now, s)).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (visit && Date.parse(`${visit.date}T00:00`) - now < 14 * DAY) {
    out.push({ id: `appointment:${visit.id}`, kind: 'appointment', importance: 55, confidence: 'high', tone: 'plain',
      headline: `Appointment ${format(new Date(`${visit.date}T12:00`), 'EEE d MMM')}${visit.with ? ` · ${visit.with}` : ''}`, evidence: 'A one-page summary of what’s changed is ready',
      action: { kind: 'go', label: 'Summary', href: '#/appointments' }, snoozeDays: 0 });
  }

  // Caffeine: a cut-off the records show, that isn't set yet (or is later than it).
  const intakes = intakesOf(d.checkIns, d.foodLogs);
  if (intakes.length) {
    const cut = findCutoff(caffeineDays(intakes, d.checkIns, d.daily, now, s, st.bedtime, st.caffeineHalfLifeH));
    const set = st.caffeineCutoff ? Number(st.caffeineCutoff.slice(0, 2)) : undefined;
    if (cut.status === 'found' && cut.value !== undefined && (set === undefined || set > cut.value)) {
      const hhmm = `${String(cut.value).padStart(2, '0')}:00`;
      out.push({ id: `cutoff:${cut.value}`, kind: 'cutoff', importance: 55, confidence: cut.nights >= 20 ? 'high' : 'medium', tone: 'plain',
        headline: `You sleep worse with caffeine after ${hourText(cut.value)}`, evidence: `From ${cut.nights} nights of your sleep`,
        action: { kind: 'setting', label: `Make ${hourText(cut.value)} my cut-off`, key: 'caffeineCutoff', value: hhmm, followUp: { kind: 'cutoff', value: cut.value }, done: `Cut-off set: ${hourText(cut.value)}` },
        snoozeDays: 14 });
    }
  }

  // Losing weight well: calories from what's actually burned, and protein to keep muscle.
  if (d.has.body && d.has.food) {
    const e = expenditure(d.foodLogs, d.body, now, s);
    if (e) {
      const t = calorieTarget(e, st.lossRateKgWeek);
      const current = st.energyTargetKcal;
      if (!st.energyAuto && (current === null || Math.abs(current - t.kcal) >= 150)) {
        out.push({ id: `calories:${Math.round(t.kcal / 50)}`, kind: 'calories', importance: 60, confidence: e.days >= 21 ? 'high' : 'medium', tone: 'plain',
          headline: `About ${t.kcal.toLocaleString()} Cal a day loses ${kg(st.lossRateKgWeek)} a week`,
          evidence: `You burn about ${e.kcal.toLocaleString()} (from ${e.days} days of food and ${e.weighIns} weigh-ins)${current ? `; your target is ${current.toLocaleString()}` : ''}`,
          action: { kind: 'setting', label: 'Use it, and keep it updated', key: 'energyAuto', value: true, followUp: { kind: 'calories', value: t.kcal }, done: 'Calorie target set, and updated each week' },
          snoozeDays: 14 });
      }
    }
  }
  if (d.has.body) {
    const goal = d.goals.find((g) => g.metric === 'weightKg');
    const want = proteinTarget(latestWeight(d.body), goal?.target);
    const lean = leanAlert(d.body, now);
    if (lean) {
      out.push({ id: `lean:${Math.floor(lean.to / WEEK)}`, kind: 'lean', importance: 75, confidence: 'high', tone: 'watch',
        headline: `${Math.round(lean.share * 100)}% of the weight lost has been muscle and other lean mass`,
        evidence: `${kg(lean.leanLost)} of ${kg(lean.weightLost)} since ${day(lean.from)}. More protein and strength training keep it.`,
        action: want && (st.proteinTargetG ?? 0) < want
          ? { kind: 'setting', label: `Aim for ${want} g protein a day`, key: 'proteinTargetG', value: want, followUp: { kind: 'protein', value: want }, done: `Protein target: ${want} g a day` }
          : { kind: 'go', label: 'Training', href: '#/training' }, snoozeDays: 14 });
    } else if (want && d.has.training && (st.proteinTargetG === null || st.proteinTargetG < want - 15)) {
      out.push({ id: `protein:${want}`, kind: 'protein', importance: 45, confidence: 'medium', tone: 'plain',
        headline: `About ${want} g of protein a day keeps muscle while losing`, evidence: `1.6 g for each kg of ${goal && goal.target < (latestWeight(d.body) ?? 0) ? 'your goal weight' : 'your weight'}${st.proteinTargetG ? `; your target is ${st.proteinTargetG} g` : ''}`,
        action: { kind: 'setting', label: `Aim for ${want} g`, key: 'proteinTargetG', value: want, followUp: { kind: 'protein', value: want }, done: `Protein target: ${want} g a day` }, snoozeDays: 30 });
    }
  }

  // Moving less: a drop in steps is a quiet way calories burned fall while eating less.
  const st2 = stepsChange(d.daily, now);
  if (st2 && st2.before >= 3000 && st2.now < st2.before * 0.8) {
    const diff = st2.before - st2.now;
    out.push({ id: `steps:${Math.floor(now / WEEK)}`, kind: 'steps', importance: 40, confidence: 'medium', tone: 'watch',
      headline: `Steps down to ${st2.now.toLocaleString()} a day, from ${st2.before.toLocaleString()}`,
      evidence: `About ${Math.round((diff * 0.04) / 10) * 10} Cal a day less burned. The last 2 weeks against the 4 before.`,
      action: { kind: 'go', label: 'See steps', href: '#/progress/trends' }, snoozeDays: 7 });
  }
  // Sleep that swings a lot night to night.
  const sr = sleepRegularity(d.daily, now);
  if (sr && sr.spreadH >= 1) {
    out.push({ id: `sleep:${Math.floor(now / WEEK)}`, kind: 'sleep', importance: 35, confidence: 'medium', tone: 'plain',
      headline: `Your sleep varies by about ${sr.spreadH} h night to night`, evidence: `${sr.avgH} h on average over ${sr.nights} nights. A steadier bedtime usually helps appetite and energy.`,
      action: st.bedtime ? undefined : { kind: 'go', label: 'Set a bedtime', href: '#/settings/caffeine' }, snoozeDays: 14 });
  }

  // Checking back on what was done from an insight.
  for (const f of st.followUps) {
    const r = followUpResult(f, d, now);
    if (r) out.push(r);
  }

  const hidden = st.insightsHidden;
  return out.filter((x) => !(hidden[x.id] > now)).sort((a, b) => b.importance - a.importance);
}

/** A few weeks after acting on an insight: what happened since, against the weeks before. */
export function followUpResult(f: FollowUp, d: InsightInput, now: number): Insight | null {
  const since = now - f.at;
  if (since < 14 * DAY || since > 60 * DAY) return null;
  const avgIn = (xs: { t: number; v: number }[], a: number, b: number) => { const w = xs.filter((x) => x.t >= a && x.t < b); return w.length >= 7 ? w.reduce((p, q) => p + q.v, 0) / w.length : undefined; };
  const daily = (pick: (r: DailyHealth) => number | undefined) => d.daily.filter((r) => !r.deletedAt).flatMap((r) => { const v = pick(r); return v === undefined ? [] : [{ t: new Date(`${r.date}T12:00`).getTime(), v }]; });
  const base = { id: `followup:${f.id}`, kind: 'followup' as const, importance: 50, confidence: 'medium' as const, snoozeDays: 365 };
  if (f.kind === 'cutoff') {
    const sleep = daily((r) => (r.sleepMin ? r.sleepMin / 60 : undefined));
    const before = avgIn(sleep, f.at - 28 * DAY, f.at), after = avgIn(sleep, f.at, now);
    if (before === undefined || after === undefined) return null;
    const diff = Math.round((after - before) * 60);
    return { ...base, tone: diff >= 10 ? 'good' : 'plain', headline: `Since your ${hourText(f.value)} cut-off: sleep ${before.toFixed(1)} h → ${after.toFixed(1)} h`,
      evidence: diff >= 10 ? `${diff} minutes more a night` : Math.abs(diff) < 10 ? 'About the same so far' : `${-diff} minutes less a night` };
  }
  if (f.kind === 'protein') {
    const p = daily((r) => r.proteinG);
    const before = avgIn(p, f.at - 28 * DAY, f.at), after = avgIn(p, f.at, now);
    if (after === undefined) return null;
    return { ...base, tone: after >= f.value * 0.9 ? 'good' : 'plain', headline: `Since aiming for ${f.value} g of protein: ${before !== undefined ? `${Math.round(before)} → ` : ''}${Math.round(after)} g a day`,
      evidence: after >= f.value * 0.9 ? 'On target most days' : `About ${Math.round(f.value - after)} g a day short of it` };
  }
  // Calories: the rate of loss since, against the target's aim.
  const pts = d.body.filter((b) => !b.deletedAt && typeof b.weightKg === 'number').map((b) => ({ t: new Date(`${b.date}T08:00`).getTime(), v: b.weightKg! }));
  const fitIn = (a: number, b: number) => { const w = pts.filter((p) => p.t >= a && p.t <= b); return w.length >= 5 ? robustFit(w, b) : undefined; };
  const before = fitIn(f.at - 28 * DAY, f.at), after = fitIn(f.at, now);
  if (!after) return null;
  const rate = (x: number) => `${kgTo(Math.abs(x * 7), d.units)} ${weightUnit(d.units)} a week`;
  const losing = after.slope < 0;
  return { ...base, tone: losing ? 'good' : 'plain',
    headline: `Since your ${f.value.toLocaleString()} Cal target: ${losing ? 'losing' : 'gaining'} ${rate(after.slope)}`,
    evidence: before ? `${before.slope < 0 ? 'Losing' : 'Gaining'} ${rate(before.slope)} in the 4 weeks before` : 'From your weigh-ins since' };
}
