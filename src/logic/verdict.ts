// Is it working? For each medicine, peptide and supplement: what it's for (its goal, or what the person picked), how
// that's measured here, and the strongest evidence there is — a finished on/off experiment, then days taken against
// days not, then before against since starting (for weight: the trend since starting). A verdict with how sure it is,
// what it costs (heart rate, HRV, sleep, side effects), when it'll be clearer, and the shortest experiment that would
// settle it. Pure.
import type { BodyEntry, CheckIn, DailyHealth, Dose, Experiment, Medication } from '../db/schema';
import { dayKey } from './stats';
import type { ScheduleSettings } from './schedule';
import { isStimulant } from './stimulant';
import { guideFor, isGlpLike } from './peptideGuide';
import { supplementsOf } from './supplements';
import { analyse, METRICS } from './experiments';
import { medEffects, startedAt } from './medEffects';
import { robustFit } from './forecast';
import { fmtHM } from './sleep';

const DAY = 86_400_000;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const variance = (xs: number[]) => { const m = mean(xs); return xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1); };
/** Two-sided p for a difference in means (Welch), from the normal curve: fine for the 8+ days a side it's used with. */
function welch(a: number[], b: number[]): { diff: number; d: number; p: number } {
  const diff = mean(b) - mean(a);
  const se = Math.sqrt(variance(a) / a.length + variance(b) / b.length);
  const pooled = Math.sqrt((variance(a) + variance(b)) / 2);
  const z = se > 0 ? Math.abs(diff / se) : 0;
  const p = 2 * (1 - normCdf(z));
  return { diff, d: pooled > 0 ? diff / pooled : 0, p };
}
function normCdf(z: number) { const t = 1 / (1 + 0.2316419 * z); const d = 0.3989423 * Math.exp(-z * z / 2); return 1 - d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); }

export type Outcome = 'weight' | 'focus' | 'sleep' | 'deep' | 'recovery' | 'mood' | 'energy' | 'soreness' | 'glucose';
/** The smallest difference that matters in daily life, for each measure: smaller ones aren't called working. */
export const MEANINGFUL: Record<Outcome, number> = { weight: 0.5, focus: 0.3, sleep: 15, deep: 8, recovery: 3, mood: 0.3, energy: 0.3, soreness: 0.3, glucose: 0.3 };
/** "recovery (HRV)": a label mid-sentence, acronyms kept. */
export const lower = (label: string) => label.replace(/^[A-Z](?![A-Z-])/, (c) => c.toLowerCase());
export const OUTCOMES: Record<Outcome, { label: string; measure: string; higherBetter: boolean; night?: boolean; unit: string; experiment?: Experiment['metric'] }> = {
  weight: { label: 'Weight', measure: 'weigh-ins', higherBetter: false, unit: 'kg', experiment: 'weight' },
  focus: { label: 'Focus', measure: 'focus ratings', higherBetter: true, unit: 'of 5', experiment: 'focus' },
  sleep: { label: 'Sleep', measure: 'nights from the watch', higherBetter: true, night: true, unit: 'min', experiment: 'sleepH' },
  deep: { label: 'Deep sleep', measure: 'nights from the watch', higherBetter: true, night: true, unit: 'min', experiment: 'deepMin' },
  recovery: { label: 'Recovery (HRV)', measure: 'nights from the watch', higherBetter: true, night: true, unit: 'ms', experiment: 'hrv' },
  mood: { label: 'Mood', measure: 'mood ratings', higherBetter: true, unit: 'of 5', experiment: 'mood' },
  energy: { label: 'Energy', measure: 'energy ratings', higherBetter: true, unit: 'of 5', experiment: 'energy' },
  soreness: { label: 'Soreness', measure: 'soreness ratings', higherBetter: false, unit: 'of 5' },
  glucose: { label: 'Glucose', measure: 'days of glucose readings', higherBetter: false, unit: 'mmol/L' },
};

/** What each supplement is usually taken for, as something measured here. */
const SUPPLEMENT_GOAL: Record<string, Outcome> = {
  magnesium: 'deep', melatonin: 'sleep', ashwagandha: 'mood', theanine: 'focus', tyrosine: 'focus', ginkgo: 'focus', '5-htp': 'mood',
  'fish-oil': 'recovery', 'nr-nmn': 'energy', iron: 'energy', 'vitamin-b12': 'energy', 'b-complex': 'energy', 'vitamin-d': 'mood',
  turmeric: 'soreness', berberine: 'glucose', electrolytes: 'energy',
};
const GUIDE_GOAL: Record<string, Outcome> = { weight: 'weight', sleep: 'deep', focus: 'focus', healing: 'soreness', longevity: 'recovery', gh: 'deep' };

/** What a medicine is judged by: the person's choice, else its goal (a stimulant: focus; a GLP-1: weight; a peptide:
 *  its guide's first goal; a supplement: what it's usually for). Undefined when nothing here measures it. */
export function goalOf(med: Medication): Outcome | undefined {
  if (med.judgeBy) return med.judgeBy as Outcome;
  if (isStimulant(med)) return 'focus';
  if (isGlpLike(med)) return 'weight';
  const g = guideFor(med.name);
  for (const x of g?.goals ?? []) if (GUIDE_GOAL[x]) return GUIDE_GOAL[x];
  for (const s of supplementsOf(med)) if (SUPPLEMENT_GOAL[s.key]) return SUPPLEMENT_GOAL[s.key];
  return undefined;
}

export interface VerdictData { meds: Medication[]; doses: Dose[]; checkIns: CheckIn[]; daily: DailyHealth[]; body: BodyEntry[]; experiments: Experiment[] }

/** The outcome for each day ('YYYY-MM-DD'): ratings averaged, nights by the morning they end. */
export function outcomeByDay(o: Outcome, d: VerdictData, s: ScheduleSettings): Map<string, number> {
  const out = new Map<string, number>();
  const avg = (key: 'focus' | 'mood' | 'energy' | 'soreness') => {
    const acc = new Map<string, number[]>();
    for (const c of d.checkIns) { if (c.deletedAt || typeof c[key] !== 'number') continue; const k = dayKey(Date.parse(c.at), s); acc.set(k, [...(acc.get(k) ?? []), c[key]!]); }
    for (const [k, v] of acc) out.set(k, mean(v));
  };
  const daily = (f: (x: DailyHealth) => number | undefined) => { for (const x of d.daily) { if (x.deletedAt) continue; const v = f(x); if (typeof v === 'number') out.set(x.date, v); } };
  if (o === 'weight') for (const b of d.body) { if (!b.deletedAt && typeof b.weightKg === 'number') out.set(b.date, b.weightKg); }
  else if (o === 'focus' || o === 'mood' || o === 'energy' || o === 'soreness') avg(o);
  else if (o === 'sleep') daily((x) => x.sleepMin);
  else if (o === 'deep') daily((x) => x.sleepDeepMin);
  else if (o === 'recovery') daily((x) => x.hrvMs);
  else if (o === 'glucose') daily((x) => x.glucoseAvg);
  return out;
}

const nextDay = (k: string) => { const t = new Date(`${k}T12:00`); t.setDate(t.getDate() + 1); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };

/** Taken some days and not others (as-needed, a stimulant, a supplement, anything short-acting): an on/off comparison
 *  tells something. A long-acting one (a weekly shot) stays in the body, so only before/after can. */
export function shortActing(med: Medication): boolean {
  if (med.schedule.type === 'prn' || isStimulant(med)) return true;
  if (isGlpLike(med)) return false;
  const half = guideFor(med.name)?.halfLifeHours;
  if (half !== undefined) return half < 24;
  return supplementsOf(med).length > 0;
}

export interface ProposedExperiment { title: string; a: string; b: string; metric: Experiment['metric']; blockDays: number; blocks: number; weeks: number }
export type VerdictStatus = 'working' | 'worse' | 'not-working' | 'unclear' | 'too-early' | 'cant-measure';
export interface Verdict {
  med: Medication; outcome?: Outcome; status: VerdictStatus;
  headline: string; evidence: string[]; method?: 'experiment' | 'on-off' | 'before-after' | 'trend';
  confidence?: 'Solid' | 'Likely' | 'Early';
  /** What it costs, from the watch and side-effect check-ins. */
  costs: string[];
  /** When or with what it'll be clearer. */
  next?: string;
  experiment?: ProposedExperiment;
}

const fmtVal = (o: Outcome, v: number) => (o === 'sleep' || o === 'deep' ? fmtHM(v) : o === 'weight' || o === 'glucose' ? v.toFixed(1) : o === 'recovery' ? String(Math.round(v)) : v.toFixed(1));
const SIDE = /nausea|headache|tired|fatigue|anxious|dizzy|constipat|diarrh|heart racing|insomnia|reflux|vomit|wearing off|crash|irritab/i;

export function verdictFor(med: Medication, d: VerdictData, now: number, s: ScheduleSettings): Verdict {
  const outcome = goalOf(med);
  const name = med.nickname?.trim() || med.name;
  const mine = d.doses.filter((x) => x.medicationId === med.id && !x.deletedAt);
  const since = startedAt(med, mine);
  const costs = costsOf(med, d, now);
  const base = { med, outcome, costs };
  if (!outcome) return { ...base, status: 'cant-measure', headline: 'Pick what to judge it by', evidence: [], next: 'Nothing here measures what it\'s for yet. Pick a measure, or rate it in check-ins.' };
  const O = OUTCOMES[outcome];
  if (since === undefined) return { ...base, status: 'too-early', headline: 'No doses logged yet', evidence: [] };
  const daysOn = Math.floor((now - since) / DAY);
  const series = outcomeByDay(outcome, d, s);
  const proposal = (): ProposedExperiment | undefined => {
    if (!shortActing(med) || !O.experiment || outcome === 'weight') return undefined;
    const blockDays = O.night ? 3 : isStimulant(med) ? 2 : 7;
    const blocks = blockDays >= 7 ? 4 : 6;
    if (d.experiments.some((e) => !e.deletedAt && !e.ended && e.a.toLowerCase().includes(med.name.toLowerCase()))) return undefined;
    return { title: `${name}: on or off`, a: name, b: `No ${name}`, metric: O.experiment, blockDays, blocks, weeks: Math.ceil((blockDays * blocks) / 7) };
  };

  // 1. A finished experiment on it.
  const exp = d.experiments.filter((e) => !e.deletedAt && (e.a.toLowerCase().includes(med.name.toLowerCase()) || e.title.toLowerCase().includes(med.name.toLowerCase())))
    .map((e) => ({ e, r: analyse(e, { checkIns: d.checkIns, daily: d.daily, body: d.body }, now, mulberry(7)) })).find((x) => !['running', 'too-few'].includes(x.r.verdict));
  if (exp) {
    const { e, r } = exp;
    const label = METRICS[e.metric].label;
    const ev = [`Experiment: ${label} ${r.a.mean} ${e.a.toLowerCase()} against ${r.b.mean} ${e.b.toLowerCase()} (${r.a.days} and ${r.b.days} days)`];
    const takingIsA = e.a.toLowerCase().includes(med.name.toLowerCase());
    const helps = takingIsA ? ['a-better', 'leaning-a'].includes(r.verdict) : ['b-better', 'leaning-b'].includes(r.verdict);
    const hurts = takingIsA ? ['b-better', 'leaning-b'].includes(r.verdict) : ['a-better', 'leaning-a'].includes(r.verdict);
    const conf = r.p !== undefined && r.p < 0.05 ? 'Solid' : 'Likely';
    if (helps) return { ...base, status: 'working', method: 'experiment', confidence: conf, headline: `Working for ${lower(O.label)}`, evidence: ev };
    if (hurts) return { ...base, status: 'worse', method: 'experiment', confidence: conf, headline: `${O.label} was worse on it`, evidence: ev };
    return { ...base, status: 'not-working', method: 'experiment', confidence: 'Likely', headline: `No difference in ${lower(O.label)}`, evidence: ev };
  }

  if (daysOn < 14) return { ...base, status: 'too-early', headline: `Too early to tell: ${daysOn} day${daysOn === 1 ? '' : 's'} in`, evidence: [], next: `Clearer from ${fmtDate(since + 14 * DAY)}.`, experiment: proposal() };

  // 2. Weight: the trend since starting.
  if (outcome === 'weight') {
    const pts = [...series].map(([k, v]) => ({ t: new Date(`${k}T08:00`).getTime(), v })).filter((p) => p.t >= since - 3 * DAY).sort((a, b) => a.t - b.t);
    const fit = pts.length >= 4 && pts[pts.length - 1].t - pts[0].t >= 21 * DAY ? robustFit(pts, now) : null;
    if (!fit) return { ...base, status: 'unclear', headline: 'Not enough weigh-ins yet', evidence: [`${pts.length} weigh-in${pts.length === 1 ? '' : 's'} since starting`], next: 'Weigh in at least weekly; 4 over 3 weeks gives a trend.' };
    const perWeek = Math.round(fit.slope * 7 * 100) / 100;
    const total = Math.round((pts[pts.length - 1].v - pts[0].v) * 10) / 10;
    const ev = [`${perWeek <= 0 ? 'Losing' : 'Gaining'} ${Math.abs(perWeek)} kg a week since starting (${total > 0 ? '+' : ''}${total} kg, ${pts.length} weigh-ins)`];
    const conf = pts.length >= 10 ? 'Solid' : pts.length >= 6 ? 'Likely' : 'Early';
    if (perWeek <= -0.25) return { ...base, status: 'working', method: 'trend', confidence: conf, headline: 'Working: weight coming down', evidence: ev };
    if (daysOn >= 56 && perWeek > -0.1) return { ...base, status: 'not-working', method: 'trend', confidence: conf, headline: 'Weight isn\'t coming down', evidence: ev };
    return { ...base, status: 'unclear', method: 'trend', confidence: 'Early', headline: 'Slow so far', evidence: ev, next: daysOn < 56 ? `Clearer from ${fmtDate(since + 56 * DAY)} (8 weeks in).` : undefined };
  }

  // 3. Days taken against days not (short-acting), else 4. before against since starting.
  let a: number[] = [], b: number[] = [], method: Verdict['method'];
  let labels: [string, string] = ['', ''];
  if (shortActing(med)) {
    const taken = new Set(mine.filter((x) => !x.skipped).map((x) => dayKey(Date.parse(x.takenAt), s)));
    const from = Math.max(since, now - 90 * DAY);
    const off: number[] = [], on: number[] = [];
    for (let t = from; t < now - DAY / 2; t += DAY) {
      const k = dayKey(t, s);
      const v = series.get(O.night ? nextDay(k) : k);
      if (v === undefined) continue;
      (taken.has(k) ? on : off).push(v);
    }
    if (on.length >= 8 && off.length >= 8) { a = off; b = on; method = 'on-off'; labels = ['days you don\'t take it', 'days you do']; }
    else if (off.length < 8 && on.length >= 8) { /* taken nearly every day: before/after below */ }
  }
  if (!method) {
    const before = [...series].filter(([k]) => { const t = new Date(`${k}T12:00`).getTime(); return t < since && t >= since - 28 * DAY; }).map(([, v]) => v);
    const afterFrom = Math.max(since + (daysOn > 35 ? 7 * DAY : 0), now - 28 * DAY);
    const after = [...series].filter(([k]) => { const t = new Date(`${k}T12:00`).getTime(); return t >= afterFrom && t <= now; }).map(([, v]) => v);
    if (before.length >= 8 && after.length >= 8) { a = before; b = after; method = 'before-after'; labels = ['before starting', 'lately']; }
    else {
      const need = O.night ? 'nights from the watch' : O.measure;
      return { ...base, status: 'unclear', headline: 'Not enough to tell yet', evidence: [`${after.length} ${O.measure} on it${before.length ? `, ${before.length} before` : ''}`],
        next: before.length < 8 && !shortActing(med) ? `There's too little from before you started to compare. A ${O.measure.replace(/s$/, '')} most days from now on builds the picture.` : `About ${Math.max(0, 8 - after.length)} more ${need} to tell.`, experiment: proposal() };
    }
  }
  const w = welch(a, b);
  const benefit = O.higherBetter ? w.d : -w.d;
  const big = Math.abs(w.diff) >= MEANINGFUL[outcome];
  const ev = [`${O.label} ${fmtVal(outcome, mean(b))} on ${labels[1]} against ${fmtVal(outcome, mean(a))} on ${labels[0]} (${b.length} and ${a.length} days)`];
  const n = Math.min(a.length, b.length);
  const conf = w.p < 0.02 && n >= 15 ? 'Solid' : w.p < 0.05 ? 'Likely' : 'Early';
  if (w.p < 0.1 && benefit >= 0.3 && big) return { ...base, status: 'working', method, confidence: conf, headline: `Working for ${lower(O.label)}`, evidence: ev };
  if (w.p < 0.1 && benefit <= -0.3 && big) return { ...base, status: 'worse', method, confidence: conf, headline: `${O.label} is worse ${method === 'on-off' ? 'on days you take it' : 'since starting'}`, evidence: ev, experiment: proposal() };
  if (n >= 14 && (Math.abs(benefit) < 0.2 || !big)) return { ...base, status: 'not-working', method, confidence: n >= 25 ? 'Likely' : 'Early', headline: `No measurable effect on ${lower(O.label)}`, evidence: ev, experiment: proposal() };
  return { ...base, status: 'unclear', method, confidence: 'Early', headline: benefit > 0 ? `Maybe helping ${lower(O.label)}` : `Not clear yet`, evidence: ev,
    next: method === 'before-after' ? 'Other things change over the same weeks; an on/off test would settle it.' : `More days each way will tell: ${n} so far, 14+ is better.`, experiment: proposal() };
}

/** What it costs: resting heart rate, HRV or sleep worse since starting, and side effects noted on 30%+ of check-ins
 *  tied to its doses (with 5+ of them). */
export function costsOf(med: Medication, d: VerdictData, now: number): string[] {
  const out: string[] = [];
  const fx = medEffects(med, d.doses, d.daily, now);
  for (const e of fx?.effects ?? []) {
    if (e.better === false && ['restingHr', 'hrvMs', 'sleepMin', 'sleepDeepMin', 'spo2Avg', 'respRate'].includes(e.key)) out.push(`${e.label} ${e.diff > 0 ? '+' : ''}${e.key === 'sleepMin' || e.key === 'sleepDeepMin' ? `${Math.round(e.diff)} min` : `${e.diff} ${e.unit}`} since starting`);
  }
  const doseIds = new Set(d.doses.filter((x) => x.medicationId === med.id && !x.deletedAt && Date.parse(x.takenAt) > now - 42 * DAY).map((x) => x.id));
  const cis = d.checkIns.filter((c) => !c.deletedAt && c.relatedDoseId && doseIds.has(c.relatedDoseId));
  if (cis.length >= 5) {
    const counts = new Map<string, number>();
    for (const c of cis) for (const chip of new Set(c.chips.filter((x) => SIDE.test(x)))) counts.set(chip, (counts.get(chip) ?? 0) + 1);
    for (const [chip, k] of [...counts].sort((x, y) => y[1] - x[1]).slice(0, 2)) if (k / cis.length >= 0.3) out.push(`${chip} after ${Math.round((k / cis.length) * 100)}% of doses`);
  }
  return out;
}

/** Every active item's verdict, the clearest calls first. */
export function verdicts(d: VerdictData, now: number, s: ScheduleSettings): Verdict[] {
  const rank: Record<VerdictStatus, number> = { worse: 0, working: 1, 'not-working': 2, unclear: 3, 'too-early': 4, 'cant-measure': 5 };
  return d.meds.filter((m) => !m.archived).map((m) => verdictFor(m, d, now, s)).sort((x, y) => rank[x.status] - rank[y.status] || y.costs.length - x.costs.length);
}

/** Supplements worth a second look: 4+ weeks in with no measurable effect (or no way to measure one), or worse. */
export function supplementAudit(vs: Verdict[], doses: Dose[], now: number): Verdict[] {
  return vs.filter((v) => supplementsOf(v.med).length > 0 && !isStimulant(v.med)).filter((v) => {
    const since = startedAt(v.med, doses);
    return since !== undefined && now - since >= 28 * DAY && ['not-working', 'worse', 'cant-measure', 'unclear'].includes(v.status);
  });
}

const fmtDate = (t: number) => new Date(t).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
/** A small seeded random number source, so a verdict doesn't flicker between renders. */
export function mulberry(seed: number) { let a = seed; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
