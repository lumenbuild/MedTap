// The week ahead, day by day: what each day is likely to feel like (side effects, appetite, resting heart rate and sleep
// on the days after each shot, from the person's own past shots), where weight is heading, what to do about it (food,
// water, fibre, training, caffeine and bed: never the dose), and the things that might cause problems this week. Each
// forecast says how much it rests on, and the side-effect forecast is checked against what happened over the last
// month. Dose questions are only ever "worth raising with your prescriber". Pure.
import type { BodyEntry, CheckIn, DailyHealth, Dose, FoodLog, Medication, Workout } from '../db/schema';
import { appetiteCurve, sideEffectForecast } from './predict';
import { plannedDoses } from './protocol';
import { weightTrend } from './bodyModel';
import { getDayBounds, type ScheduleSettings } from './schedule';
import { dayKey } from './stats';
import { shownName } from './privacy';
import { isGlpLike } from './peptideGuide';
import { isStimulant } from './stimulant';
import { currentVial, stockVials, vialStatus } from './peptide';
import { doseDecision } from './decisions';
import { stackShop } from './stackSmart';
import { fmtAmount } from './format';
import { fmtLitres } from './format';

const DAY = 86_400_000, HOUR = 3_600_000;
const live = <T extends { deletedAt?: string }>(x: T) => !x.deletedAt;
const taken = (d: Dose) => live(d) && !d.skipped;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const ymdMs = (k: string) => new Date(`${k}T12:00`).getTime();
const r1 = (v: number) => Math.round(v * 10) / 10;

export interface AheadData { meds: Medication[]; doses: Dose[]; checkIns: CheckIn[]; daily: DailyHealth[]; body: BodyEntry[]; workouts: Workout[]; foodLogs: FoodLog[] }
export interface AheadSettings { waterTargetMl: number | null; fibreTargetG: number; proteinTargetG: number | null; bedtime: string; caffeineCutoff?: string | null; orders?: { placedAt: string; arrivedAt?: string }[] }

export type AdviceKind = 'food' | 'water' | 'train' | 'sleep' | 'caffeine';
export interface Advice { key: string; kind: AdviceKind; text: string; why: string }
export interface DayAhead {
  date: string; start: number;
  shots: { med: Medication; name: string; amount: number; unit: string }[];
  /** Side effects likely that day (40%+ of past check-ins on that day after a shot), each with its peptide. */
  effects: { chip: string; pct: number; name: string }[];
  appetite?: 'low' | 'usual' | 'high';
  /** Against your usual, on that day after a shot (from your own nights). */
  hrDelta?: number; sleepDelta?: number;
  weightKg?: number;
  /** Extra water (mL) and fibre (g) for the day, from what's forecast. */
  waterBoost: number; fibreBoost: number;
  /** The easiest and hardest days for training this week. */
  trainDay?: 'best' | 'easy';
  advice: Advice[];
}
export interface Risk { key: string; title: string; detail: string; when?: number; level: 'watch' | 'info' }
export interface WeekAhead {
  days: DayAhead[];
  risks: Risk[];
  /** Points worth raising with the prescriber, with the evidence. */
  prescriber: { title: string; why: string[] }[];
  /** How the side-effect forecast did over the last 4 weeks: days it was right, of days it could be checked. */
  accuracy?: { right: number; of: number };
  basis: string[];
}

/** Resting heart rate and sleep on each day after a shot, against the person's median (4+ shots with nights after). */
function afterShot(med: Medication, doses: Dose[], daily: DailyHealth[], now: number) {
  const shots = doses.filter((d) => taken(d) && d.medicationId === med.id && Date.parse(d.takenAt) > now - 84 * DAY).map((d) => Date.parse(d.takenAt)).sort((a, b) => a - b);
  if (shots.length < 4) return null;
  const gap = Math.max(2, Math.min(7, Math.round(median(shots.slice(1).map((t, i) => (t - shots[i]) / DAY)))));
  const rows = daily.filter((d) => live(d) && ymdMs(d.date) > now - 84 * DAY);
  const hrAll = rows.map((d) => d.restingHr).filter((x): x is number => typeof x === 'number');
  const slAll = rows.map((d) => d.sleepMin).filter((x): x is number => typeof x === 'number' && x > 60);
  if (hrAll.length < 14 && slAll.length < 14) return null;
  const by = Array.from({ length: gap }, () => ({ hr: [] as number[], sl: [] as number[] }));
  for (const d of rows) {
    // The night ending this morning belongs to the day before.
    const t = ymdMs(d.date) - 12 * HOUR;
    const last = [...shots].reverse().find((x) => x <= t);
    if (last === undefined) continue;
    const idx = Math.floor((t - last) / DAY);
    if (idx >= gap) continue;
    if (typeof d.restingHr === 'number') by[idx].hr.push(d.restingHr);
    if (typeof d.sleepMin === 'number' && d.sleepMin > 60) by[idx].sl.push(d.sleepMin);
  }
  const hrMed = hrAll.length ? median(hrAll) : undefined, slMed = slAll.length ? median(slAll) : undefined;
  return { gap, shots, days: by.map((x) => ({ hr: hrMed !== undefined && x.hr.length >= 3 ? Math.round(mean(x.hr) - hrMed) : undefined, sleep: slMed !== undefined && x.sl.length >= 3 ? Math.round(mean(x.sl) - slMed) : undefined })) };
}

const ADVICE: Record<string, Omit<Advice, 'key'> & { water?: number; fibre?: number }> = {
  Nausea: { kind: 'food', text: 'Small, low-fat meals, protein first, eaten slowly', why: 'nausea likely', water: 300 },
  Reflux: { kind: 'food', text: 'Smaller dinner, nothing for 3 hours before bed', why: 'reflux likely' },
  Constipation: { kind: 'water', text: 'More fibre and water today', why: 'constipation likely', water: 500, fibre: 8 },
  Diarrhoea: { kind: 'water', text: 'Water with electrolytes through the day', why: 'diarrhoea likely', water: 750 },
  Tired: { kind: 'train', text: 'An easier session or a walk', why: 'tiredness likely' },
  Headache: { kind: 'water', text: 'Water and electrolytes early', why: 'headaches likely', water: 500 },
};

export function weekAhead(d: AheadData, st: AheadSettings, now: number, s: ScheduleSettings): WeekAhead {
  const peps = d.meds.filter((m) => !m.archived && m.peptide && m.schedule.type !== 'prn');
  const days: DayAhead[] = Array.from({ length: 7 }, (_, i) => {
    const start = getDayBounds(now + i * DAY, s.dayStartsAt, s.tz).start;
    return { date: dayKey(start + HOUR, s), start, shots: [], effects: [], waterBoost: 0, fibreBoost: 0, advice: [] };
  });
  const basis: string[] = [];
  for (const m of peps) {
    for (const p of plannedDoses(m, d.doses, now, now + 7 * DAY, s)) {
      const day = days.find((x) => p.t >= x.start && p.t < x.start + DAY);
      day?.shots.push({ med: m, name: shownName(m), amount: p.amount, unit: m.unit });
    }
    const fc = sideEffectForecast(m, d.doses, d.checkIns, now, s);
    if (fc) {
      basis.push(`${shownName(m)}: ${fc.basis.shots} shots, ${fc.basis.checkIns} check-ins`);
      for (const fd of fc.days) {
        const day = days.find((x) => Math.abs(x.start - fd.start) < 2 * HOUR);
        if (day) for (const l of fd.likely) day.effects.push({ chip: l.chip, pct: l.pct, name: shownName(m) });
      }
    }
    const ap = appetiteCurve(m, d.doses, d.checkIns, now);
    const as = afterShot(m, d.doses, d.daily, now);
    // Days since the last (or planned) shot for each day ahead.
    const shotsAll = [...d.doses.filter((x) => taken(x) && x.medicationId === m.id).map((x) => Date.parse(x.takenAt)), ...plannedDoses(m, d.doses, now, now + 7 * DAY, s).map((p) => p.t)].sort((a, b) => a - b);
    for (const day of days) {
      const mid = day.start + 12 * HOUR;
      const last = [...shotsAll].reverse().find((t) => t <= mid);
      if (last === undefined) continue;
      const idx = Math.floor((mid - last) / DAY);
      if (ap) {
        const known = ap.days.filter((x) => x.appetite !== undefined).map((x) => x.appetite!);
        const v = ap.days[idx]?.appetite;
        if (v !== undefined && known.length >= 3) {
          const lo = Math.min(...known), hi = Math.max(...known);
          if (hi - lo >= 0.6) day.appetite = v <= lo + (hi - lo) * 0.3 ? 'low' : v >= lo + (hi - lo) * 0.7 ? 'high' : 'usual';
        }
      }
      if (as && idx < as.gap) {
        const x = as.days[idx];
        if (x.hr !== undefined && Math.abs(x.hr) >= 3) day.hrDelta = (day.hrDelta ?? 0) + x.hr;
        if (x.sleep !== undefined && Math.abs(x.sleep) >= 15) day.sleepDelta = (day.sleepDelta ?? 0) + x.sleep;
      }
    }
  }
  // Weight on the trend.
  const tr = weightTrend({ body: d.body, foodLogs: d.foodLogs, workouts: d.workouts, checkIns: d.checkIns, daily: d.daily, doses: d.doses, meds: d.meds }, now);
  if (tr) for (const [i, day] of days.entries()) day.weightKg = r1(tr.trend + (tr.perWeek / 7) * (i + (now - ymdMs(tr.latestDate)) / DAY));

  // Advice for each day, from what's forecast.
  for (const day of days) {
    const seen = new Set<string>();
    for (const e of day.effects) {
      const a = ADVICE[e.chip];
      if (!a || seen.has(e.chip)) continue;
      seen.add(e.chip);
      day.advice.push({ key: `fx:${e.chip}`, kind: a.kind, text: a.text, why: `${a.why} (${e.pct}% of past ${e.name} shots)` });
      day.waterBoost += a.water ?? 0; day.fibreBoost += a.fibre ?? 0;
    }
    if (day.appetite === 'low' && st.proteinTargetG) day.advice.push({ key: 'protein-low', kind: 'food', text: `Protein first: ${st.proteinTargetG} g is easier as shakes, yoghurt or eggs`, why: 'appetite usually low' });
    if (day.appetite === 'high') day.advice.push({ key: 'appetite-high', kind: 'food', text: 'A planned protein snack mid-afternoon, and high-volume meals', why: 'appetite usually back' });
    if (day.sleepDelta !== undefined && day.sleepDelta <= -20) day.advice.push({ key: 'sleep', kind: 'sleep', text: `Bed 30 minutes earlier; caffeine done by ${st.caffeineCutoff ?? '12 pm'}`, why: `sleep usually ${Math.abs(day.sleepDelta)} min shorter` });
    day.waterBoost = Math.min(1000, day.waterBoost); day.fibreBoost = Math.min(10, day.fibreBoost);
    if (day.waterBoost && st.waterTargetMl) day.advice.push({ key: 'water', kind: 'water', text: `Water target ${fmtLitres(st.waterTargetMl + day.waterBoost)}`, why: `${day.waterBoost} mL more than usual` });
  }
  // Training: the hardest and easiest days, from heart rate, sleep and side effects.
  const strain = days.map((x) => (x.hrDelta ?? 0) / 2 + Math.max(0, -(x.sleepDelta ?? 0)) / 15 + x.effects.length * 1.5);
  if (strain.some((v) => v > 0)) {
    const max = Math.max(...strain), min = Math.min(...strain);
    if (max - min >= 2) {
      const easy = days[strain.indexOf(max)], best = days[strain.indexOf(min)];
      easy.trainDay = 'easy'; best.trainDay = 'best';
      easy.advice.push({ key: 'train-easy', kind: 'train', text: 'Light training or rest', why: [easy.hrDelta && easy.hrDelta > 0 ? `resting heart rate usually +${easy.hrDelta}` : null, easy.effects.length ? `${easy.effects[0].chip.toLowerCase()} likely` : null].filter(Boolean).join(', ') || 'your hardest day after a shot' });
      best.advice.push({ key: 'train-best', kind: 'train', text: 'Best day this week for a hard session', why: 'your body is usually most recovered' });
    }
  }

  const risks = weekRisks(d, st, days, now, s);
  // Worth raising with the prescriber: what the dose decisions find (never a change made here).
  const prescriber = peps.map((m) => ({ m, dd: doseDecision(m, { ...d, experiments: [] }, now, s) }))
    .filter((x) => x.dd && x.dd.call !== 'stay' && x.dd.call !== 'best-dose')
    .map((x) => ({ title: `${shownName(x.m)}: ${x.dd!.title}`, why: x.dd!.why }));
  return { days, risks, prescriber, accuracy: accuracy(d, now, s), basis };
}

/** Things this week that might cause problems. */
export function weekRisks(d: AheadData, st: AheadSettings, days: DayAhead[], now: number, s: ScheduleSettings): Risk[] {
  const out: Risk[] = [];
  // "today", "tomorrow", else the weekday.
  const dayName = (t: number) => {
    const k = dayKey(t, s);
    return k === dayKey(now, s) ? 'today' : k === dayKey(now + DAY, s) ? 'tomorrow' : new Date(t).toLocaleDateString('en-AU', { weekday: 'long' });
  };
  const on = (t: number) => { const n = dayName(t); return n === 'today' || n === 'tomorrow' ? n : `on ${n}`; };
  // Alcohol on the days after a GLP-1 shot: tolerance is lower, and it can bring on nausea and low blood sugar.
  const glp = d.meds.filter((m) => !m.archived && isGlpLike(m));
  if (glp.length) {
    const alcoholDays = new Set(d.checkIns.filter((c) => live(c) && c.chips.some((x) => /alcohol/i.test(x)) && Date.parse(c.at) > now - 56 * DAY).map((c) => new Date(c.at).getDay()));
    const risky = days.filter((x) => alcoholDays.has(new Date(x.start + 12 * HOUR).getDay()) && (x.effects.some((e) => /nausea|reflux/i.test(e.chip)) || x.appetite === 'low'));
    if (risky.length) out.push({ key: 'alcohol', level: 'watch', when: risky[0].start, title: (() => { const n = on(risky[0].start + 12 * HOUR); const day = n === 'today' || n === 'tomorrow' ? n : n.replace(/^on /, ''); return `Drinking ${day} could hit harder: nausea or low appetite is likely ${n === 'today' || n === 'tomorrow' ? 'then' : 'that day'}`; })(),
      detail: 'On a GLP-1, alcohol hits harder and on an empty stomach can bring on nausea and low blood sugar. Food with it, and water alongside.' });
  }
  // Dehydration: stomach side effects forecast, with water already under target lately.
  const recentWater = d.daily.filter((x) => live(x) && typeof x.waterMl === 'number' && ymdMs(x.date) > now - 7 * DAY).map((x) => x.waterMl!);
  const gi = days.filter((x) => x.effects.some((e) => /diarrh|nausea|vomit/i.test(e.chip)));
  if (gi.length && st.waterTargetMl && recentWater.length >= 3 && mean(recentWater) < st.waterTargetMl * 0.8)
    out.push({ key: 'dehydration', level: 'watch', when: gi[0].start, title: `Dehydration risk ${dayName(gi[0].start + 12 * HOUR)}`.replace(/ (Mon|Tue|Wed|Thu|Fri|Sat|Sun)/, ' on $1'),
      detail: `Water has averaged ${fmtLitres(mean(recentWater))} a day against your ${fmtLitres(st.waterTargetMl)} target, and stomach side effects are likely then${gi[0].waterBoost ? `, so that day's target is ${fmtLitres(st.waterTargetMl + gi[0].waterBoost)}` : ''}. Start the day with water and electrolytes.` });
  // Hard training on the strain day.
  const easy = days.find((x) => x.trainDay === 'easy');
  const trainsThen = easy && d.workouts.filter((w) => live(w) && Date.parse(w.startedAt) > now - 56 * DAY && new Date(w.startedAt).getDay() === new Date(easy.start + 12 * HOUR).getDay()).length >= 3;
  if (easy && trainsThen) out.push({ key: 'train-strain', level: 'info', when: easy.start, title: `You usually train ${on(easy.start + 12 * HOUR)}, your hardest day after a shot`,
    detail: `${easy.advice.find((a) => a.key === 'train-easy')?.why ?? ''}. A lighter session that day, or moving it, usually goes better.`.replace(/^\. /, '') });
  // Protein on low-appetite days while losing fast: muscle goes first.
  const tr = weightTrend({ body: d.body, foodLogs: d.foodLogs, workouts: d.workouts, checkIns: d.checkIns, daily: d.daily, doses: d.doses, meds: d.meds }, now);
  const low = days.filter((x) => x.appetite === 'low').length;
  if (tr && low >= 2 && tr.perWeek < -(tr.trend * 0.01) && st.proteinTargetG)
    out.push({ key: 'muscle', level: 'watch', title: `${low} low-appetite days while losing over 1% a week`, detail: `That's when muscle goes. Protein first on those days (${st.proteinTargetG} g), and strength training on the good ones.` });
  // Vials: not enough for this week's shots, or past their use-within date before them.
  for (const m of d.meds.filter((x) => !x.archived && x.peptide)) {
    const need = days.flatMap((x) => x.shots.filter((y) => y.med.id === m.id));
    if (!need.length) continue;
    const v = vialStatus(m, d.doses, now);
    const total = need.reduce((a, x) => a + x.amount, 0);
    const have = (v && !v.expired ? v.left : 0) + stockVials(m).reduce((a, x) => a + x.amount, 0);
    if (have + 1e-9 < total) out.push({ key: `short:${m.id}`, level: 'watch', title: `${shownName(m)}: not enough for this week's shots`,
      detail: `${fmtAmount(total, m.unit)} planned, about ${fmtAmount(have, m.unit)} on hand.` });
    else if (v?.useBy && currentVial(m) && need.some((x) => days.find((dd) => dd.shots.includes(x))!.start > v.useBy!) && v.left > 0)
      out.push({ key: `useby:${m.id}`, level: 'info', when: v.useBy, title: `${shownName(m)}: the vial in use passes its use-within date ${on(v.useBy)}`, detail: 'Shots after that come from the next vial.' });
  }
  // Ordering this week.
  const shop = stackShop(d.meds, d.doses, now, s, st.orders ?? []);
  if (shop?.orderBy !== undefined && shop.orderBy < now + 7 * DAY) out.push({ key: 'order', level: shop.orderBy < now + 2 * DAY ? 'watch' : 'info', when: shop.orderBy,
    title: shop.orderBy <= now ? 'Order today' : `Order by ${dayName(shop.orderBy)}`, detail: `${shop.items.filter((x) => x.vials > 0).map((x) => `${x.vials} × ${x.name}`).join(', ')}: delivery takes about ${shop.leadDays} days.` });
  // A stimulant plus a run of short nights: the crash lands harder.
  const stim = d.meds.some((m) => !m.archived && isStimulant(m));
  const nights = d.daily.filter((x) => live(x) && (x.sleepMin ?? 0) > 60).sort((a, b) => a.date.localeCompare(b.date)).slice(-3);
  if (stim && nights.length === 3 && nights.every((x) => x.sleepMin! < 360)) out.push({ key: 'sleep-debt', level: 'watch', title: 'Three short nights in a row on a stimulant',
    detail: 'Focus usually drops and the afternoon dip lands harder. An early night tonight does more than anything else this week.' });
  return out;
}

/** How the side-effect profile did over the last 4 weeks: on days after a shot with a check-in, did "likely" (or not)
 *  match what was noted. */
function accuracy(d: AheadData, now: number, s: ScheduleSettings): { right: number; of: number } | undefined {
  let right = 0, of = 0;
  for (const m of d.meds.filter((x) => !x.archived && x.peptide)) {
    // The forecast as it would have been 4 weeks ago, then each of its days checked.
    for (let w = 4; w >= 1; w--) {
      const then = now - w * 7 * DAY;
      const fc = sideEffectForecast(m, d.doses.filter((x) => Date.parse(x.takenAt) < then), d.checkIns.filter((c) => Date.parse(c.at) < then), then, s);
      if (!fc) continue;
      for (const fd of fc.days) {
        if (!fd.known) continue;
        const cis = d.checkIns.filter((c) => live(c) && Date.parse(c.at) >= fd.start && Date.parse(c.at) < fd.start + DAY);
        if (!cis.length) continue;
        const noted = new Set(cis.flatMap((c) => c.chips));
        const predicted = fd.likely.map((l) => l.chip);
        // Right: every chip forecast was noted, or none was forecast and none of those chips was noted.
        const ok = predicted.length ? predicted.every((c) => noted.has(c)) : !fd.likely.length && ![...noted].some((c) => /nausea|reflux|constip|diarrh|tired|headache|injection/i.test(c));
        of++; if (ok) right++;
      }
    }
  }
  return of >= 5 ? { right, of } : undefined;
}
