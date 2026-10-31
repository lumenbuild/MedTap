// Turning the data into decisions. Dose decisions (stay, step up or ease off, from benefit against cost), what's
// working this week (what goes with better or worse sleep, HRV and how you feel, and one thing to try), today's calls
// (train, caffeine, a second dose, food) and early warnings (overtraining, under-recovering on a big deficit,
// stimulant tolerance, resting heart rate creeping up on a medicine). From the person's own data, each with its basis.
// Options to weigh (with the prescriber for medicines), not instructions. Pure.
import type { FoodLog, Medication, Workout } from '../db/schema';
import { dayKey } from './stats';
import type { ScheduleSettings } from './schedule';
import { isStimulant, doseResponse, secondDose, secondDetail, secondTitle } from './stimulant';
import { isGlpLike } from './peptideGuide';
import { robustFit } from './forecast';
import { readiness } from './training';
import { illnessWatch } from './vitals';
import { daySuggestion, trainingLoad } from './trainingLoad';
import { energyBalance, expenditure, calorieTarget } from './energy';
import { medEffects } from './medEffects';
import { costsOf, lower, MEANINGFUL, OUTCOMES, selfTestable, shortActing, type Outcome, type ProposedExperiment, type VerdictData } from './verdict';
import { bedtimeOf, caffeineDays, findCutoff, intakesOf } from './caffeine';
import { fmtTime } from './format';

const DAY = 86_400_000;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const variance = (xs: number[]) => { const m = mean(xs); return xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1); };
const live = <T extends { deletedAt?: string }>(x: T) => !x.deletedAt;
const ymdMs = (k: string) => new Date(`${k}T12:00`).getTime();
const r1 = (v: number) => Math.round(v * 10) / 10;

export interface AllData extends VerdictData { workouts: Workout[]; foodLogs: FoodLog[] }

// ── Dose decisions ───────────────────────────────────────────────────────────────────────────────────

export type DoseCall = 'stay' | 'step-up-option' | 'ease-off-option' | 'best-dose';
export interface DoseDecision { call: DoseCall; title: string; why: string[] }

/** A GLP-1-type medicine: weight over the last 4 weeks against what it costs. A stimulant: the amount and time that
 *  go with the best focus. */
export function doseDecision(med: Medication, d: AllData, now: number, s: ScheduleSettings): DoseDecision | null {
  const mine = d.doses.filter((x) => x.medicationId === med.id && live(x) && !x.skipped);
  if (!mine.length) return null;
  if (isGlpLike(med)) {
    const latest = [...mine].sort((a, b) => b.takenAt.localeCompare(a.takenAt))[0];
    const amount = `${latest.amount} ${med.unit}`;
    const pts = d.body.filter((b) => live(b) && typeof b.weightKg === 'number').map((b) => ({ t: ymdMs(b.date), v: b.weightKg! })).filter((p) => p.t > now - 28 * DAY).sort((a, b) => a.t - b.t);
    if (pts.length < 4 || pts[pts.length - 1].t - pts[0].t < 18 * DAY) return null;
    const fit = robustFit(pts, now);
    if (!fit) return null;
    const perWeek = r1(fit.slope * 7);
    const costs = costsOf(med, d, now);
    const kg = pts[pts.length - 1].v;
    const why = [`${perWeek <= 0 ? 'Losing' : 'Gaining'} ${Math.abs(perWeek)} kg a week over the last 4 weeks at ${amount}`, ...(costs.length ? costs : ['Few side effects and steady heart rate and sleep'])];
    if (perWeek < -(kg * 0.012)) return { call: 'ease-off-option', title: `Fast: staying at ${amount} or easing off are both options`, why: [...why, 'More than about 1% of body weight a week makes holding on to muscle harder.'] };
    if (perWeek <= -0.3) return { call: 'stay', title: `Stay at ${amount}: it's still working`, why };
    if (costs.length >= 2) return { call: 'ease-off-option', title: `Slowing, with costs: worth a word with your prescriber`, why };
    return { call: 'step-up-option', title: `Slowing at ${amount}: the next step is an option`, why: [...why, 'Check sleep, protein and food logging first: they often explain a slow patch.'] };
  }
  if (isStimulant(med)) {
    const r = doseResponse(med, mine, d.checkIns, now, s);
    if (!r) return null;
    return { call: 'best-dose', title: r.by === 'amount' ? `Best focus at ${r.better}` : `Best focus when taken ${r.better}`,
      why: [`Focus ${r.focusBetter.toFixed(1)} at ${r.better} against ${r.focusWorse.toFixed(1)} at ${r.worse} (${r.n} ratings)`] };
  }
  return null;
}

// ── What's working this week ─────────────────────────────────────────────────────────────────────────

export interface Factor { key: string; label: string; outcome: Outcome; withIt: number; without: number; nWith: number; nWithout: number; effect: number; p: number; helps: boolean }
export interface WhatsWorking { helps: Factor[]; hurts: Factor[]; tryNext?: ProposedExperiment & { why: string } }

/** Each day over the last 60: what was done (each medicine taken or not, caffeine after 2 pm, alcohol, a workout,
 *  a big step day, mindfulness) against that night's sleep and HRV and the day's focus, mood and energy. Shows the
 *  clearest links both ways (6+ days each side, a difference of at least a third of the usual spread). */
export function whatsWorking(d: AllData, now: number, s: ScheduleSettings): WhatsWorking {
  const from = now - 60 * DAY;
  const days: string[] = [];
  for (let t = from; t < now - DAY / 2; t += DAY) days.push(dayKey(t, s));
  const factors: { key: string; label: string; on: Set<string>; controllable: boolean; med?: Medication }[] = [];
  for (const m of d.meds.filter((x) => !x.archived)) {
    const on = new Set(d.doses.filter((x) => x.medicationId === m.id && live(x) && !x.skipped).map((x) => dayKey(Date.parse(x.takenAt), s)));
    const inWindow = days.filter((k) => on.has(k)).length;
    // A long-acting one (a weekly shot) is in the body every day: its days are shot days, not on and off.
    const short = shortActing(m);
    if (inWindow >= 6 && days.length - inWindow >= 6) factors.push({ key: `med-${m.id}`, label: short ? `Taking ${m.nickname?.trim() || m.name}` : `${m.nickname?.trim() || m.name} shot day`, on, controllable: short && selfTestable(m), med: m });
  }
  const chipDays = (re: RegExp, after?: number) => new Set(d.checkIns.filter((c) => live(c) && c.chips.some((x) => re.test(x)) && (after === undefined || new Date(c.at).getHours() >= after)).map((c) => dayKey(Date.parse(c.at), s)));
  factors.push({ key: 'late-caffeine', label: 'Caffeine after 2 pm', on: chipDays(/caffeine|coffee/i, 14), controllable: true });
  factors.push({ key: 'alcohol', label: 'Alcohol', on: chipDays(/alcohol|drink/i), controllable: true });
  factors.push({ key: 'workout', label: 'A workout', on: new Set(d.workouts.filter(live).map((w) => dayKey(Date.parse(w.startedAt), s))), controllable: true });
  const steps = d.daily.filter(live).filter((x) => typeof x.steps === 'number');
  if (steps.length >= 14) { const mid = median(steps.map((x) => x.steps!)); factors.push({ key: 'steps', label: `Over ${Math.round(mid / 1000)}k steps`, on: new Set(steps.filter((x) => x.steps! > mid).map((x) => x.date)), controllable: true }); }
  factors.push({ key: 'mindful', label: 'Mindfulness', on: new Set(d.daily.filter((x) => live(x) && (x.mindfulMin ?? 0) > 0).map((x) => x.date)), controllable: true });

  const nextDay = (k: string) => dayKey(ymdMs(k) + DAY, s);
  const outcomes: { o: Outcome; get: (k: string) => number | undefined }[] = [];
  const dailyBy = new Map(d.daily.filter(live).map((x) => [x.date, x]));
  outcomes.push({ o: 'sleep', get: (k) => dailyBy.get(nextDay(k))?.sleepMin });
  outcomes.push({ o: 'deep', get: (k) => dailyBy.get(nextDay(k))?.sleepDeepMin });
  outcomes.push({ o: 'recovery', get: (k) => dailyBy.get(nextDay(k))?.hrvMs });
  for (const o of ['focus', 'mood', 'energy'] as const) {
    const by = new Map<string, number[]>();
    for (const c of d.checkIns) if (live(c) && typeof c[o] === 'number') { const k = dayKey(Date.parse(c.at), s); by.set(k, [...(by.get(k) ?? []), c[o]!]); }
    outcomes.push({ o, get: (k) => (by.has(k) ? mean(by.get(k)!) : undefined) });
  }
  const found: (Factor & { controllable: boolean; med?: Medication })[] = [];
  for (const f of factors) for (const { o, get } of outcomes) {
    if (f.key === 'workout' && o === 'recovery') continue; // a hard day lowers HRV that night by design
    const a: number[] = [], b: number[] = [];
    for (const k of days) { const v = get(k); if (v === undefined) continue; (f.on.has(k) ? b : a).push(v); }
    if (a.length < 6 || b.length < 6) continue;
    const diff = mean(b) - mean(a), pooled = Math.sqrt((variance(a) + variance(b)) / 2);
    if (pooled <= 0 || Math.abs(diff) < MEANINGFUL[o]) continue;
    const effect = diff / pooled;
    const se = Math.sqrt(variance(a) / a.length + variance(b) / b.length);
    const z = se > 0 ? Math.abs(diff / se) : 0;
    const p = 2 * (1 - phi(z));
    const helps = OUTCOMES[o].higherBetter ? diff > 0 : diff < 0;
    found.push({ key: f.key, label: f.label, outcome: o, withIt: mean(b), without: mean(a), nWith: b.length, nWithout: a.length, effect: Math.abs(effect), p, helps, controllable: f.controllable, med: f.med });
  }
  const clear = found.filter((x) => x.effect >= 0.35 && x.p < 0.2).sort((x, y) => x.p - y.p || y.effect - x.effect);
  const seen = new Set<string>();
  const pick = (xs: typeof clear) => xs.filter((x) => { const k = `${x.key}-${x.helps}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 3);
  const helps = pick(clear.filter((x) => x.helps)), hurts = pick(clear.filter((x) => !x.helps));
  // One thing to try: the strongest link that isn't settled yet, as an on/off test.
  const open = found.filter((x) => x.effect >= 0.3 && x.p >= 0.05 && x.p < 0.4 && x.controllable && OUTCOMES[x.outcome].experiment).sort((x, y) => y.effect - x.effect)[0];
  const tryNext = open ? {
    title: `${open.label}: on or off`, a: open.label.replace(/^Taking /, ''), b: `No ${lower(open.label.replace(/^Taking /, ''))}`, metric: OUTCOMES[open.outcome].experiment!, blockDays: OUTCOMES[open.outcome].night ? 3 : 2, blocks: 6, weeks: 3,
    why: `${OUTCOMES[open.outcome].label} looks ${open.helps ? 'better' : 'worse'} with it, but it isn't clear yet (${open.nWith} and ${open.nWithout} days).`,
  } : undefined;
  return { helps, hurts, tryNext };
}
function phi(z: number) { const t = 1 / (1 + 0.2316419 * z); const d = 0.3989423 * Math.exp(-z * z / 2); return 1 - d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); }

// ── Today's calls ───────────────────────────────────────────────────────────────────────────────────

export interface Call { key: 'train' | 'caffeine' | 'second-dose' | 'food'; title: string; detail: string; tone: 'go' | 'easy' | 'stop' | 'info' }

export interface CallSettings { bedtime: string; caffeineCutoff: string | null; caffeineHalfLifeH: number; energyTargetKcal: number | null; proteinTargetG: number | null; lossRateKgWeek: number }

export function todaysCalls(d: AllData, now: number, s: ScheduleSettings, st: CallSettings): Call[] {
  const out: Call[] = [];
  const r = readiness(d.daily, d.checkIns, now, s);
  const ill = illnessWatch(d.daily, now, s);
  const load = trainingLoad(d.workouts, now);
  const sug = daySuggestion(r, load, ill);
  if (sug) out.push({ key: 'train', title: sug.title, detail: sug.why, tone: sug.kind === 'push' ? 'go' : sug.kind === 'normal' ? 'info' : sug.kind === 'easy' ? 'easy' : 'stop' });

  // Caffeine: your own cut-off (found from your nights, or set), else 8 hours before bed.
  const bed = bedtimeOf(now, st.bedtime, s);
  const found = findCutoff(caffeineDays(intakesOf(d.checkIns), d.checkIns, d.daily, now, s, st.bedtime, st.caffeineHalfLifeH));
  const own = st.caffeineCutoff ? Number(st.caffeineCutoff.slice(0, 2)) + Number(st.caffeineCutoff.slice(3)) / 60 : found.status === 'found' ? found.value : undefined;
  const cut = own !== undefined ? new Date(new Date(now).setHours(Math.floor(own), Math.round((own % 1) * 60), 0, 0)).getTime() : bed - 8 * 3_600_000;
  if (cut > now - 3 * 3_600_000) out.push({ key: 'caffeine', title: `Last caffeine by ${fmtTime(cut)}`, detail: own !== undefined ? (st.caffeineCutoff ? 'Your cut-off.' : 'Your nights sleep worse with caffeine after this.') : `8 hours before your ${fmtTime(bed)} bedtime.`, tone: 'info' });

  // A second stimulant dose: always the schedule's time (or the usual gap, with no schedule). Never moved, never skipped.
  for (const m of d.meds.filter((x) => !x.archived && isStimulant(x))) {
    const sd = secondDose(m, d.doses, d.checkIns, d.daily, now, s);
    if (!sd) continue;
    out.push({ key: 'second-dose', title: secondTitle(m.nickname?.trim() || m.name, sd, now), detail: secondDetail(sd), tone: 'info' });
    break;
  }

  // Food: your target (set, or from what you burn and your chosen rate), a little more on a hard training day.
  const e = expenditure(d.foodLogs, d.body, now, s);
  const balance = energyBalance(d.daily, d.foodLogs, now, s);
  const burn = e?.kcal ?? balance?.watchMaintenance;
  const target = st.energyTargetKcal ?? (burn ? calorieTarget({ kcal: burn }, st.lossRateKgWeek).kcal : undefined);
  if (target) {
    const todayLoad = load?.days[load.days.length - 1]?.load ?? 0;
    const extra = todayLoad >= 150 ? 200 : 0;
    out.push({ key: 'food', title: `Eat about ${Math.round((target + extra) / 50) * 50} kcal${st.proteinTargetG ? ` and ${st.proteinTargetG} g protein` : ''}`,
      detail: extra ? 'A hard session today: a little more helps recovery.' : st.energyTargetKcal ? 'Your target.' : `From what you burn (${burn} a day) and losing ${st.lossRateKgWeek} kg a week.`, tone: 'info' });
  }
  return out;
}

// ── Early warnings ──────────────────────────────────────────────────────────────────────────────────

export interface Warning { key: string; title: string; detail: string; action: string }

export function earlyWarnings(d: AllData, now: number, s: ScheduleSettings): Warning[] {
  const out: Warning[] = [];
  const rows = d.daily.filter(live).sort((a, b) => a.date.localeCompare(b.date));
  const recent = (k: 'hrvMs' | 'restingHr') => rows.filter((x) => ymdMs(x.date) > now - 7 * DAY && typeof x[k] === 'number').map((x) => x[k]!);
  const usual = (k: 'hrvMs' | 'restingHr') => rows.filter((x) => ymdMs(x.date) <= now - 7 * DAY && ymdMs(x.date) > now - 37 * DAY && typeof x[k] === 'number').map((x) => x[k]!);
  const hrv7 = recent('hrvMs'), hrvU = usual('hrvMs'), rhr7 = recent('restingHr'), rhrU = usual('restingHr');
  const hrvDrop = hrv7.length >= 4 && hrvU.length >= 10 ? 1 - mean(hrv7) / median(hrvU) : undefined;
  const rhrRise = rhr7.length >= 4 && rhrU.length >= 10 ? mean(rhr7) - median(rhrU) : undefined;

  const load = trainingLoad(d.workouts, now);
  if (load?.ratio && load.ratio > 1.4 && hrvDrop !== undefined && hrvDrop >= 0.1)
    out.push({ key: 'overtraining', title: 'Training more, recovering less', detail: `Load ${Math.round(load.ratio * 100)}% of your usual week and HRV ${Math.round(hrvDrop * 100)}% down.`, action: 'A lighter few days lets it catch up.' });

  const bal = energyBalance(d.daily, d.foodLogs, now, s);
  const wts = d.body.filter((b) => live(b) && typeof b.weightKg === 'number').map((b) => ({ t: ymdMs(b.date), v: b.weightKg! })).filter((p) => p.t > now - 21 * DAY).sort((a, b) => a.t - b.t);
  const fit = wts.length >= 4 ? robustFit(wts, now) : undefined;
  const fast = (bal?.avgBalance !== undefined && bal.avgBalance <= -750) || (fit && wts.length && fit.slope * 7 < -(wts[wts.length - 1].v * 0.012));
  if (fast && ((hrvDrop !== undefined && hrvDrop >= 0.1) || (rhrRise !== undefined && rhrRise >= 3)))
    out.push({ key: 'under-recovery', title: 'A big deficit is showing in your recovery', detail: [bal?.avgBalance !== undefined ? `${Math.abs(bal.avgBalance)} kcal a day under` : null, hrvDrop !== undefined && hrvDrop >= 0.1 ? `HRV ${Math.round(hrvDrop * 100)}% down` : null, rhrRise !== undefined && rhrRise >= 3 ? `resting heart rate +${Math.round(rhrRise)}` : null].filter(Boolean).join(', ') + '.', action: 'A few days nearer maintenance, with plenty of protein.' });

  // Stimulant tolerance: focus at the same amount, the last 3 weeks against the 6 before.
  for (const m of d.meds.filter((x) => !x.archived && isStimulant(x))) {
    const doseAt = new Map(d.doses.filter((x) => x.medicationId === m.id && live(x) && !x.skipped).map((x) => [x.id, x]));
    const rated = d.checkIns.filter((c) => live(c) && typeof c.focus === 'number' && c.relatedDoseId && doseAt.has(c.relatedDoseId));
    const amounts = new Map<number, number>();
    for (const c of rated) { const a = doseAt.get(c.relatedDoseId!)!.amount; amounts.set(a, (amounts.get(a) ?? 0) + 1); }
    const common = [...amounts].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (common === undefined) continue;
    const at = rated.filter((c) => doseAt.get(c.relatedDoseId!)!.amount === common);
    const lately = at.filter((c) => Date.parse(c.at) > now - 21 * DAY).map((c) => c.focus!);
    const before = at.filter((c) => Date.parse(c.at) <= now - 21 * DAY && Date.parse(c.at) > now - 63 * DAY).map((c) => c.focus!);
    if (lately.length >= 5 && before.length >= 5 && mean(before) - mean(lately) >= 0.5)
      out.push({ key: `tolerance-${m.id}`, title: `${m.nickname?.trim() || m.name} may be doing less`, detail: `Focus at ${common} ${m.unit}: ${r1(mean(lately))} lately against ${r1(mean(before))} before.`, action: 'Sleep, timing and caffeine change it too; a break day or a word with your prescriber are options.' });
  }

  // Resting heart rate creeping up since starting a medicine.
  for (const m of d.meds.filter((x) => !x.archived)) {
    const fx = medEffects(m, d.doses, d.daily, now);
    const rhr = fx?.effects.find((e) => e.key === 'restingHr' && e.diff >= 5);
    if (rhr) out.push({ key: `rhr-${m.id}`, title: `Resting heart rate up since ${m.nickname?.trim() || m.name}`, detail: `${rhr.before} → ${rhr.after} bpm.`, action: 'Worth mentioning at your next appointment.' });
  }
  return out;
}

