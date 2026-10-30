// Ask your data: a plain question ("How's my sleep since 7.5 mg?", "Which batch had the most nausea?", "Focus by
// weekday", "Mood on alcohol days") turned into a measure, a time span and an optional grouping, answered from the
// person's own records on the phone. Nothing is sent anywhere. Pure.
import type { BodyEntry, CheckIn, DailyHealth, Dose, MedEvent, Medication, Vital } from '../db/schema';
import { ALCOHOL, CAFFEINE } from './lifestyle';
import { EFFECT_CHIPS } from './predict';
import { vialsOf } from './peptide';
import { shownName } from './privacy';

const DAY = 86_400_000;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export interface AskData { meds: Medication[]; doses: Dose[]; checkIns: CheckIn[]; body: BodyEntry[]; daily: DailyHealth[]; vitals: Vital[]; events: MedEvent[] }
export interface AskPoint { t: number; v: number }
export interface AskResult {
  title: string; answer: string; unit: string;
  /** Over time: the span asked about (and the span before it, for comparison). */
  trend?: { start: number; end: number; points: AskPoint[]; split?: number };
  /** Grouped: one bar per group. */
  bars?: { label: string; value: number; n: number }[];
  /** For bars: is higher better (to mark the best group)? */
  higherBetter?: boolean;
}
export type AskAnswer = AskResult | { error: string };

interface Measure {
  key: string; label: string; unit: string; dp: number; higherBetter?: boolean;
  /** Each record's value with its time. */
  values: (d: AskData) => AskPoint[];
}
const ci = (f: 'mood' | 'focus' | 'energy' | 'appetite' | 'sleepHours' | 'stress') => (d: AskData) =>
  d.checkIns.filter((c) => !c.deletedAt && typeof c[f] === 'number').map((c) => ({ t: Date.parse(c.at), v: c[f]! }));
const chipShare = (chips: string[]) => (d: AskData) => d.checkIns.filter((c) => !c.deletedAt).map((c) => ({ t: Date.parse(c.at), v: c.chips.some((x) => chips.includes(x)) ? 100 : 0 }));
const dly = (f: (r: DailyHealth) => number | undefined) => (d: AskData) =>
  d.daily.filter((r) => !r.deletedAt).map((r) => ({ t: new Date(`${r.date}T12:00`).getTime(), v: f(r) })).filter((p): p is AskPoint => typeof p.v === 'number' && p.v > 0);

function measures(d: AskData): (Measure & { words: RegExp })[] {
  const chips = [...new Set(d.checkIns.flatMap((c) => c.chips))].filter((c) => ![ALCOHOL, CAFFEINE, 'Period started'].includes(c));
  return [
    { key: 'sleep', words: /\bsleep|slept\b/, label: 'Sleep', unit: 'h', dp: 1, higherBetter: true,
      values: (x) => { const imp = dly((r) => (r.sleepMin ? r.sleepMin / 60 : undefined))(x); return imp.length ? imp : ci('sleepHours')(x); } },
    { key: 'weight', words: /\bweigh/, label: 'Weight', unit: 'kg', dp: 1,
      values: (x) => x.body.filter((b) => !b.deletedAt && typeof b.weightKg === 'number').map((b) => ({ t: new Date(`${b.date}T08:00`).getTime(), v: b.weightKg! })) },
    { key: 'restingHr', words: /resting|heart ?rate|\bhr\b|pulse/, label: 'Resting heart rate', unit: 'bpm', dp: 0, higherBetter: false, values: dly((r) => r.restingHr) },
    { key: 'hrv', words: /\bhrv\b|variability/, label: 'HRV', unit: 'ms', dp: 0, higherBetter: true, values: dly((r) => r.hrvMs) },
    { key: 'steps', words: /\bsteps?\b|walk/, label: 'Steps', unit: 'steps', dp: 0, higherBetter: true, values: dly((r) => r.steps) },
    { key: 'protein', words: /protein/, label: 'Protein', unit: 'g', dp: 0, higherBetter: true, values: dly((r) => r.proteinG) },
    { key: 'water', words: /\bwater\b|hydrat/, label: 'Water', unit: 'mL', dp: 0, higherBetter: true, values: dly((r) => r.waterMl) },
    { key: 'bp', words: /blood pressure|\bbp\b|systolic/, label: 'Blood pressure (top)', unit: 'mmHg', dp: 0, higherBetter: false,
      values: (x) => x.vitals.filter((v) => !v.deletedAt && v.systolic).map((v) => ({ t: Date.parse(v.at), v: v.systolic! })) },
    { key: 'mood', words: /\bmood|happy|feel/, label: 'Mood', unit: 'of 5', dp: 1, higherBetter: true, values: ci('mood') },
    { key: 'focus', words: /focus|concentrat/, label: 'Focus', unit: 'of 5', dp: 1, higherBetter: true, values: ci('focus') },
    { key: 'energy', words: /energy|tired/, label: 'Energy', unit: 'of 5', dp: 1, higherBetter: true, values: ci('energy') },
    { key: 'appetite', words: /appetite|hunger|hungry/, label: 'Appetite', unit: 'of 5', dp: 1, values: ci('appetite') },
    { key: 'stress', words: /stress/, label: 'Stress', unit: 'of 5', dp: 1, values: ci('stress') },
    ...chips.map((c) => ({ key: `chip:${c}`, words: new RegExp(`\\b${c.toLowerCase().replace(/[^a-z ]/g, '').split(' ')[0]}`), label: c, unit: '% of check-ins', dp: 0, higherBetter: false, values: chipShare([c]) })),
    { key: 'effects', words: /side.?effects?|symptoms?/, label: 'Side effects', unit: '% of check-ins', dp: 0, higherBetter: false, values: chipShare(EFFECT_CHIPS) },
  ];
}

const findMed = (q: string, meds: Medication[]) => meds.find((m) => q.includes(m.name.toLowerCase()) || (m.nickname && q.includes(m.nickname.toLowerCase())));

/** "since 7.5 mg", "since starting X", "since 3 Oct", "last week", "this month", "last 14 days". Returns [start, end, label]. */
function span(q: string, d: AskData, now: number): { start: number; end: number; label: string } | null {
  const amt = q.match(/since (?:i (?:went|moved) (?:to|up to) )?(\d+(?:\.\d+)?)\s*(mg|mcg|units?|iu|ml)/);
  if (amt) {
    const a = Number(amt[1]);
    const med = findMed(q, d.meds);
    const taken = d.doses.filter((x) => !x.deletedAt && !x.skipped && x.amount === a && (!med || x.medicationId === med.id)).sort((x, y) => x.takenAt.localeCompare(y.takenAt));
    if (taken.length) return { start: Date.parse(taken[0].takenAt), end: now, label: `since ${a} ${amt[2]}` };
  }
  const start = q.match(/since (?:i )?(?:start(?:ed|ing)?|began) (.+)/);
  if (start) {
    const med = findMed(start[1], d.meds) ?? findMed(q, d.meds);
    const first = med && d.doses.filter((x) => x.medicationId === med.id && !x.deletedAt).sort((x, y) => x.takenAt.localeCompare(y.takenAt))[0];
    if (med && first) return { start: Date.parse(first.takenAt), end: now, label: `since starting ${shownName(med)}` };
  }
  const date = q.match(/since (\d{1,2}) ([a-z]{3})/);
  if (date && MONTHS.includes(date[2])) {
    const y = new Date(now).getFullYear();
    let t = new Date(y, MONTHS.indexOf(date[2]), Number(date[1])).getTime();
    if (t > now) t = new Date(y - 1, MONTHS.indexOf(date[2]), Number(date[1])).getTime();
    return { start: t, end: now, label: `since ${date[1]} ${date[2][0].toUpperCase()}${date[2].slice(1)}` };
  }
  const n = q.match(/(?:last|past) (\d+) (day|week|month)s?/);
  if (n) { const k = n[2] === 'day' ? 1 : n[2] === 'week' ? 7 : 30; return { start: now - Number(n[1]) * k * DAY, end: now, label: `in the last ${n[1]} ${n[2]}s` }; }
  if (/(last|past|this) week/.test(q)) return { start: now - 7 * DAY, end: now, label: 'this week' };
  if (/(last|past|this) month/.test(q)) return { start: now - 30 * DAY, end: now, label: 'in the last month' };
  if (/(last|past) (3|three) months|quarter/.test(q)) return { start: now - 90 * DAY, end: now, label: 'in the last 3 months' };
  return null;
}

const fmt = (m: Measure, v: number) => `${m.unit === 'steps' ? Math.round(v).toLocaleString('en-AU') : (Math.round(v * 10 ** m.dp) / 10 ** m.dp).toString()}${m.unit === 'steps' ? ' steps' : m.unit.startsWith('%') ? '%' : m.unit === 'of 5' ? '' : ` ${m.unit}`}`;

/** Group values by a key; at least 2 groups with 2+ values each. */
function grouped(pts: AskPoint[], key: (t: number) => string | undefined, order?: string[]) {
  const g = new Map<string, number[]>();
  for (const p of pts) { const k = key(p.t); if (k !== undefined) g.set(k, [...(g.get(k) ?? []), p.v]); }
  const bars = [...g].filter(([, xs]) => xs.length >= 2).map(([label, xs]) => ({ label, value: mean(xs)!, n: xs.length }));
  if (order) bars.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
  return bars.length >= 2 ? bars : null;
}

export function ask(question: string, d: AskData, now: number): AskAnswer {
  const q = ` ${question.toLowerCase().replace(/[?!,]/g, ' ').replace(/\.(?!\d)/g, ' ').replace(/\s+/g, ' ')} `;
  const ms = measures(d);
  const m = ms.find((x) => x.key.startsWith('chip:') && x.words.test(q)) ?? ms.find((x) => !x.key.startsWith('chip:') && x.words.test(q));
  if (!m) return { error: 'Try asking about sleep, weight, mood, focus, appetite, side effects, a symptom, steps, heart rate or blood pressure.' };
  const all = m.values(d).filter((p) => p.t <= now).sort((a, b) => a.t - b.t);
  if (all.length < 2) return { error: `Not enough ${m.label.toLowerCase()} logged yet.` };
  const sp = span(q, d, now);
  const within = sp ? all.filter((p) => p.t >= sp.start && p.t <= sp.end) : all.filter((p) => p.t > now - 90 * DAY);
  const best = (bars: { label: string; value: number }[]) => [...bars].sort((a, b) => (m.higherBetter === false ? a.value - b.value : b.value - a.value))[0];
  const most = /\bmost\b|\bhighest\b|\bworst\b/.test(q) ? 'max' : /\bleast\b|\blowest\b|\bbest\b/.test(q) ? 'min' : undefined;
  const pick = (bars: { label: string; value: number }[]) => (most === 'max' ? [...bars].sort((a, b) => b.value - a.value)[0] : most === 'min' ? [...bars].sort((a, b) => a.value - b.value)[0] : best(bars));

  // Grouped questions.
  const groupBy = (title: string, bars: ReturnType<typeof grouped>, what: string): AskAnswer => {
    if (!bars) return { error: `Not enough ${m.label.toLowerCase()} logged to compare by ${what}.` };
    const top = pick(bars);
    return { title, unit: m.unit, bars, higherBetter: m.higherBetter, answer: `${top.label}: ${fmt(m, top.value)}${bars.length > 1 ? ` (${bars.filter((b) => b !== top).map((b) => `${b.label} ${fmt(m, b.value)}`).slice(0, 2).join(', ')})` : ''}` };
  };
  if (/batch|\blot\b|vial/.test(q)) {
    const med = findMed(q, d.meds) ?? d.meds.find((x) => x.peptide && vialsOf(x).some((v) => v.lot));
    if (!med) return { error: 'No batches recorded yet.' };
    const vs = vialsOf(med).filter((v) => v.startedAt && v.lot).sort((a, b) => a.startedAt!.localeCompare(b.startedAt!));
    const lotAt = (t: number) => vs.filter((v) => Date.parse(v.startedAt!) <= t && (!v.finishedAt || Date.parse(v.finishedAt) >= t)).pop()?.lot;
    return groupBy(`${m.label} by batch`, grouped(within.length ? within : all, lotAt), 'batch');
  }
  if (/weekday|day of the week|which day|by day/.test(q)) return groupBy(`${m.label} by weekday`, grouped(within, (t) => WEEKDAYS[new Date(t).getDay()], WEEKDAYS), 'weekday');
  if (/by dose|which dose|each dose|dose level/.test(q)) {
    const med = findMed(q, d.meds) ?? d.meds.find((x) => x.peptide) ?? d.meds[0];
    const taken = d.doses.filter((x) => x.medicationId === med?.id && !x.deletedAt && !x.skipped).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
    const at = (t: number) => { const x = taken.filter((y) => Date.parse(y.takenAt) <= t).pop(); return x ? `${x.amount} ${med!.unit}` : undefined; };
    return groupBy(`${m.label} by dose`, grouped(all, at, [...new Set(taken.map((x) => `${x.amount} ${med!.unit}`))]), 'dose');
  }
  const chipSplit = /alcohol|drink/.test(q) ? ALCOHOL : /coffee|caffeine/.test(q) ? CAFFEINE : undefined;
  if (chipSplit) {
    const days = new Set(d.checkIns.filter((c) => !c.deletedAt && c.chips.includes(chipSplit)).map((c) => new Date(c.at).toDateString()));
    const word = chipSplit === ALCOHOL ? 'alcohol' : 'caffeine';
    return groupBy(`${m.label} with and without ${word}`, grouped(within, (t) => (days.has(new Date(t).toDateString()) || days.has(new Date(t - DAY).toDateString()) ? `With ${word}` : `Without`)), word);
  }


  // Over time: the span against the same length before it.
  const start = sp?.start ?? now - 30 * DAY;
  const len = now - start;
  const cur = all.filter((p) => p.t >= start), prev = all.filter((p) => p.t >= start - len && p.t < start);
  const a = mean(cur.map((p) => p.v)), b = mean(prev.map((p) => p.v));
  if (a === undefined) return { error: `No ${m.label.toLowerCase()} logged ${sp?.label ?? 'in the last 30 days'}.` };
  const label = sp?.label ?? 'in the last 30 days';
  const diff = b !== undefined ? a - b : undefined;
  const same = diff !== undefined && Math.abs(diff) < (m.unit === 'of 5' ? 0.2 : Math.abs(b!) * 0.03);
  const answer = `${m.label} ${m.key === 'weight' ? 'averaged' : 'averaged'} ${fmt(m, a)} ${label}${b !== undefined ? `, ${same ? 'about the same as' : diff! > 0 ? 'up from' : 'down from'} ${fmt(m, b)} before` : ''}.`;
  return { title: `${m.label} ${label}`, unit: m.unit, answer, trend: { start: start - len, end: now, points: [...prev, ...cur], split: start } };
}

/** Questions that the person's own data can answer, to tap. */
export function askSuggestions(d: AskData): string[] {
  const out: string[] = [];
  const pep = d.meds.find((m) => m.peptide && !m.archived);
  // The dose amounts in the order they were reached, so the last is the current step.
  const amounts = pep ? [...new Set(d.doses.filter((x) => x.medicationId === pep.id && !x.skipped && !x.deletedAt).sort((a, b) => a.takenAt.localeCompare(b.takenAt)).map((x) => x.amount).reverse())].reverse() : [];
  const sleepy = d.daily.some((r) => r.sleepMin) || d.checkIns.some((c) => c.sleepHours);
  if (pep && amounts.length > 1 && sleepy) out.push(`How's my sleep since ${amounts[amounts.length - 1]} ${pep.unit}?`);
  if (pep && vialsOf(pep).filter((v) => v.lot).length > 1 && d.checkIns.some((c) => c.chips.includes('Nausea'))) out.push('Which batch had the most nausea?');
  if (d.checkIns.some((c) => c.focus)) out.push('Focus by weekday');
  if (d.checkIns.some((c) => c.chips.includes(ALCOHOL)) && sleepy) out.push('Sleep on alcohol days');
  if (pep && amounts.length > 1) out.push('Appetite by dose');
  if (d.body.some((b) => b.weightKg)) out.push('Weight in the last 3 months');
  if (d.daily.some((r) => r.restingHr)) out.push('Resting heart rate this month');
  return out.slice(0, 6);
}
