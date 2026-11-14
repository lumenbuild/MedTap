// One day, joined up: everything logged and measured on a single timeline (doses, meals, drinks, check-ins, workouts,
// weigh-ins and blood pressure, with the watch's heart rate and the night's sleep underneath), plus the links between
// them that the separate screens can't show: how heart rate moved after a dose, how much caffeine was left at sleep,
// how long between the last meal and sleep, and the day's totals against targets. Pure.
import type { BodyEntry, CheckIn, DailyHealth, Dose, FoodLog, Medication, Vital, Workout } from '../db/schema';
import { CAFFEINE, intakesOf, isDrink, level } from './caffeine';
import { shownName } from './privacy';
import { fmtAmount, fmtTime } from './format';

const HOUR = 3_600_000, DAY = 86_400_000;
const live = <T extends { deletedAt?: string }>(x: T) => !x.deletedAt;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtHM = (min: number) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')}`;

export type Lane = 'meds' | 'food' | 'drink' | 'move' | 'feel' | 'body';
export interface DayEvent { id: string; t: number; end?: number; lane: Lane; title: string; detail?: string; href?: string }
export interface DayView {
  date: string; from: number; to: number;
  events: DayEvent[];
  /** Heart rate through the day (5-minute blocks, else hourly). */
  hr: { t: number; v: number }[];
  /** Sleep that ended this morning, and the one that began tonight (if known). */
  sleep: { from: number; to: number }[];
  /** Links between things on the day. */
  notes: string[];
  totals: { kcal?: number; protein?: number; waterMl?: number; caffeineMg?: number; steps?: number; sleepMin?: number };
}

export interface DayData { meds: Medication[]; doses: Dose[]; checkIns: CheckIn[]; foodLogs: FoodLog[]; workouts: Workout[]; daily: DailyHealth[]; body: BodyEntry[]; vitals: Vital[] }

export function dayView(d: DayData, date: string, opts: { halfLifeH?: number; proteinTarget?: number | null; waterTarget?: number | null; kg?: (v: number) => string } = {}): DayView {
  const from = new Date(`${date}T00:00`).getTime(), to = from + DAY;
  const inDay = (t: number) => t >= from && t < to;
  const events: DayEvent[] = [];
  const meds = new Map(d.meds.map((m) => [m.id, m]));
  const doses = d.doses.filter((x) => live(x) && !x.skipped && inDay(Date.parse(x.takenAt)));
  for (const x of doses) {
    const m = meds.get(x.medicationId);
    if (m) events.push({ id: `dose-${x.id}`, t: Date.parse(x.takenAt), lane: 'meds', title: shownName(m), detail: fmtAmount(x.amount, m.unit), href: `#/meds/${m.id}` });
  }
  const food = d.foodLogs.filter((l) => live(l) && inDay(Date.parse(l.at)));
  const drinkIds = new Set(food.map((l) => l.caffeineCheckInId).filter(Boolean));
  for (const l of food) {
    const parts = [l.nutrients.kcal ? `${Math.round(l.nutrients.kcal)} Cal` : null, l.nutrients.protein ? `${Math.round(l.nutrients.protein)} g protein` : null, l.nutrients.caffeine ? `${Math.round(l.nutrients.caffeine)} mg caffeine` : null, l.waterPosted ? `+${l.waterPosted} mL water` : null].filter(Boolean);
    events.push({ id: `food-${l.id}`, t: Date.parse(l.at), lane: l.waterPosted && !l.nutrients.protein ? 'drink' : 'food', title: l.name, detail: parts.join(' · '), href: '#/food' });
  }
  for (const c of d.checkIns.filter((x) => live(x) && inDay(Date.parse(x.at)) && !drinkIds.has(x.id))) {
    const t = Date.parse(c.at);
    if (isDrink(c)) { events.push({ id: `ci-${c.id}`, t, lane: 'drink', title: c.note ?? 'Caffeine', detail: [c.caffeineMg ? `${c.caffeineMg} mg` : null, c.waterMl ? `+${c.waterMl} mL water` : null].filter(Boolean).join(' · ') }); continue; }
    const alcohol = c.chips.find((x) => /alcohol/i.test(x));
    if (alcohol && c.chips.length === 1) { events.push({ id: `ci-${c.id}`, t, lane: 'drink', title: 'Alcohol' }); continue; }
    if (c.rtMs) { events.push({ id: `ci-${c.id}`, t, lane: 'feel', title: 'Brain test', detail: `${c.rtMs} ms reaction`, href: '#/brain' }); continue; }
    const rated = [c.mood !== undefined ? `mood ${c.mood}` : null, c.energy !== undefined ? `energy ${c.energy}` : null, c.focus !== undefined ? `focus ${c.focus}` : null, c.stress !== undefined ? `stress ${c.stress}` : null].filter(Boolean);
    const chips = c.chips.filter((x) => x !== CAFFEINE);
    events.push({ id: `ci-${c.id}`, t, lane: 'feel', title: c.journal ? 'Journal' : 'Check-in', detail: [rated.join(', '), chips.join(', '), c.note && !c.journal ? c.note : c.journal ? c.note : null].filter(Boolean).join(' · ') || undefined });
  }
  for (const w of d.workouts.filter((x) => live(x) && inDay(Date.parse(x.startedAt)))) {
    const t = Date.parse(w.startedAt);
    const mins = w.cardio?.durationMin ?? w.watch?.minutes ?? (w.endedAt ? Math.round((Date.parse(w.endedAt) - t) / 60_000) : undefined);
    const hr = w.cardio?.avgHr ?? w.watch?.avgHr;
    const sets = w.sets.filter((x) => x.done && !x.warmup).length;
    events.push({ id: `w-${w.id}`, t, end: mins ? t + mins * 60_000 : undefined, lane: 'move', title: w.name ?? (w.cardio ? w.cardio.title ?? w.cardio.activity.replace(/^./, (c) => c.toUpperCase()) : 'Workout'),
      detail: [mins ? `${mins} min` : null, sets ? `${sets} sets` : null, w.cardio?.distanceKm ? `${w.cardio.distanceKm} km` : null, hr ? `average ${hr} bpm` : null].filter(Boolean).join(' · ') || undefined, href: w.cardio ? undefined : `#/training/workout/${w.id}` });
  }
  for (const v of d.vitals.filter((x) => live(x) && inDay(Date.parse(x.at)))) {
    // A heart rate the watch took by itself after a dose goes on that dose's line, not a line of its own.
    if (v.heartRate && !v.systolic && /\(automatic\)/.test(v.note ?? '')) {
      const t = Date.parse(v.at);
      const dose = events.filter((e) => e.lane === 'meds' && e.t <= t && t - e.t <= 3 * 3_600_000).sort((a, b) => b.t - a.t)[0];
      if (dose) { dose.detail = [dose.detail, `${v.heartRate} bpm ${Math.round((t - dose.t) / 60_000)} min after`].filter(Boolean).join(' · '); continue; }
    }
    events.push({ id: `v-${v.id}`, t: Date.parse(v.at), lane: 'body', title: v.systolic ? 'Blood pressure' : 'Heart rate', detail: [v.systolic ? `${v.systolic}/${v.diastolic}` : null, v.heartRate ? `${v.heartRate} bpm` : null].filter(Boolean).join(' · ') });
  }
  const row = d.daily.filter((x) => live(x) && x.date === date).sort((a, b) => (b.hr5?.length ?? 0) - (a.hr5?.length ?? 0))[0];
  const tomorrow = d.daily.find((x) => live(x) && x.date === ymd(to + 12 * HOUR) && x.sleepStart);
  const weigh = d.body.find((b) => live(b) && b.date === date && typeof b.weightKg === 'number');
  if (weigh) events.push({ id: `b-${weigh.id}`, t: row?.sleepEnd && inDay(row.sleepEnd) ? row.sleepEnd + 15 * 60_000 : from + 7 * HOUR, lane: 'body', title: 'Weigh-in', detail: [opts.kg ? opts.kg(weigh.weightKg!) : `${weigh.weightKg} kg`, weigh.bodyFatPct ? `${weigh.bodyFatPct}% fat` : null].filter(Boolean).join(' · '), href: '#/progress/body' });
  events.sort((a, b) => a.t - b.t);

  // Heart rate: 5-minute blocks, else hourly averages.
  const hr: { t: number; v: number }[] = [];
  if (row?.hr5?.some((x) => x !== null)) row.hr5.forEach((v, i) => { if (v !== null) hr.push({ t: from + i * 5 * 60_000 + 150_000, v }); });
  else if (row?.hrByHour) row.hrByHour.forEach((v, i) => { if (v !== null) hr.push({ t: from + i * HOUR + HOUR / 2, v }); });
  const sleep: DayView['sleep'] = [];
  if (row?.sleepStart && row.sleepEnd) sleep.push({ from: Math.max(from - 6 * HOUR, row.sleepStart), to: row.sleepEnd });
  if (tomorrow?.sleepStart && tomorrow.sleepEnd && tomorrow.sleepStart < to + 6 * HOUR) sleep.push({ from: tomorrow.sleepStart, to: tomorrow.sleepEnd });

  // ── Links ──
  const notes: string[] = [];
  // Heart rate after each dose: the 2 hours after against the hour before.
  if (hr.length > 40) for (const x of doses) {
    const t = Date.parse(x.takenAt);
    const before = hr.filter((p) => p.t >= t - HOUR && p.t < t).map((p) => p.v);
    const after = hr.filter((p) => p.t >= t + 30 * 60_000 && p.t < t + 2 * HOUR).map((p) => p.v);
    if (before.length >= 4 && after.length >= 6) {
      const rise = Math.round(median(after) - median(before));
      const m = meds.get(x.medicationId);
      if (m && Math.abs(rise) >= 5) notes.push(`Heart rate ${rise > 0 ? 'up' : 'down'} ${Math.abs(rise)} bpm in the 2 hours after ${shownName(m)} at ${fmtTime(t)}.`);
    }
  }
  // Caffeine left at sleep tonight.
  const intakes = intakesOf(d.checkIns, d.foodLogs).filter((x) => x.t < to);
  const today = intakes.filter((x) => inDay(x.t));
  const bed = tomorrow?.sleepStart;
  if (today.length && bed && bed > today[today.length - 1].t) {
    const left = Math.round(level(intakes, bed, opts.halfLifeH ?? 5));
    if (left >= 30) notes.push(`About ${left} mg of caffeine still in you when you fell asleep at ${fmtTime(bed)} (last at ${fmtTime(today[today.length - 1].t)}).`);
  }
  // Last meal before sleep.
  const lastMeal = food.filter((l) => (l.nutrients.kcal ?? 0) >= 150).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  if (lastMeal && bed && bed > Date.parse(lastMeal.at)) {
    const gap = (bed - Date.parse(lastMeal.at)) / HOUR;
    if (gap < 3) notes.push(`Last meal ${gap < 1 ? 'under an hour' : `${Math.round(gap * 10) / 10} hours`} before sleep: late meals often mean a higher resting heart rate overnight.`);
  }
  // The night after: how it went, against what came before.
  if (tomorrow?.sleepMin && tomorrow.sleepMin > 60) notes.push(`Slept ${fmtHM(tomorrow.sleepMin)} that night${tomorrow.restingHr ? `, resting heart rate ${tomorrow.restingHr}` : ''}${tomorrow.hrvMs ? `, HRV ${Math.round(tomorrow.hrvMs)} ms` : ''}.`);

  const sum = (k: string) => food.reduce((a, l) => a + (l.nutrients[k] ?? 0), 0);
  const totals: DayView['totals'] = {
    kcal: food.length ? Math.round(sum('kcal')) : undefined,
    protein: row?.proteinG !== undefined ? Math.round(row.proteinG) : food.length ? Math.round(sum('protein')) : undefined,
    waterMl: row?.waterMl, caffeineMg: today.length ? Math.round(today.reduce((a, x) => a + x.mg, 0)) : undefined,
    steps: row?.steps, sleepMin: row?.sleepMin,
  };
  if (opts.proteinTarget && totals.protein !== undefined && totals.protein < opts.proteinTarget * 0.8 && to < Date.now()) notes.push(`Protein ${totals.protein} g of ${opts.proteinTarget} g.`);
  return { date, from, to, events, hr, sleep, notes, totals };
}
