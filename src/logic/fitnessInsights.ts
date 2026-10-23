// Trends for training (MedTap): protein and water by day, readiness by day, and two links worth knowing — protein
// against how much of the weight lost was lean mass, and readiness against how sessions went. From the person's own
// records; links, not causes. Pure.
import type { BodyEntry, CheckIn, DailyHealth, Workout } from '../db/schema';
import type { ScheduleSettings } from './schedule';
import { e1rmSeries, leanPoints, readiness, working } from './training';
import { ymdToMs } from './stats';

const DAY = 86_400_000;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : undefined; };
const live = <T extends { deletedAt?: string }>(x: T) => !x.deletedAt;

export interface Intake {
  days: { date: string; protein?: number; water?: number }[];
  protein?: { avg: number; days: number; perKg?: number; onTarget?: number };
  water?: { avg: number; days: number; onTarget?: number };
}

/** Protein and water on logged days in the range, with the average, grams per kg of body weight and days on target. */
export function intakeTrend(daily: DailyHealth[], body: BodyEntry[], start: number, end: number, targets: { protein: number | null; water: number | null }): Intake | null {
  const days = daily.filter((d) => live(d) && ymdToMs(d.date) >= start - DAY / 2 && ymdToMs(d.date) <= end && (d.proteinG || d.waterMl))
    .sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ date: d.date, protein: d.proteinG || undefined, water: d.waterMl || undefined }));
  if (!days.length) return null;
  const p = days.map((d) => d.protein).filter((x): x is number => !!x);
  const w = days.map((d) => d.water).filter((x): x is number => !!x);
  const kg = body.filter((b) => live(b) && typeof b.weightKg === 'number' && ymdToMs(b.date) <= end).sort((a, b) => b.date.localeCompare(a.date))[0]?.weightKg;
  return {
    days,
    protein: p.length ? { avg: Math.round(avg(p)!), days: p.length, perKg: kg ? Math.round((avg(p)! / kg) * 10) / 10 : undefined, onTarget: targets.protein ? p.filter((x) => x >= targets.protein!).length : undefined } : undefined,
    water: w.length ? { avg: Math.round(avg(w)!), days: w.length, onTarget: targets.water ? w.filter((x) => x >= targets.water!).length : undefined } : undefined,
  };
}

/** Readiness each day it can be worked out (sleep, heart rate, HRV or soreness that day). */
export function readinessTrend(daily: DailyHealth[], checkIns: CheckIn[], start: number, end: number, s: ScheduleSettings): { t: number; score: number }[] {
  const out: { t: number; score: number }[] = [];
  for (const d of daily.filter(live)) {
    const t = ymdToMs(d.date);
    if (t < start - DAY / 2 || t > end) continue;
    const r = readiness(daily, checkIns, t, s);
    if (r) out.push({ t, score: r.score });
  }
  return out.sort((a, b) => a.t - b.t);
}

export interface ProteinLean { higher: { protein: number; share: number; spans: number }; lower: { protein: number; share: number; spans: number } }

/** Between body composition entries 2+ weeks apart with 1+ kg lost: the share of the loss that was lean mass, set
 *  against the protein logged in between (5+ days). Spans split at the median protein. Needs 4+ spans. */
export function proteinVsLean(daily: DailyHealth[], body: BodyEntry[]): ProteinLean | null {
  const pts = leanPoints(body);
  const spans: { protein: number; share: number }[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (b.t - a.t < 14 * DAY || a.kg - b.kg < 1) continue;
    const p = daily.filter((d) => live(d) && d.proteinG && ymdToMs(d.date) > a.t && ymdToMs(d.date) <= b.t).map((d) => d.proteinG!);
    if (p.length < 5) continue;
    spans.push({ protein: avg(p)!, share: Math.max(0, (a.lean - b.lean) / (a.kg - b.kg)) });
  }
  if (spans.length < 4) return null;
  const m = median(spans.map((x) => x.protein))!;
  const hi = spans.filter((x) => x.protein >= m), lo = spans.filter((x) => x.protein < m);
  if (!lo.length || !hi.length) return null;
  const g = (xs: typeof spans) => ({ protein: Math.round(avg(xs.map((x) => x.protein))!), share: Math.round(avg(xs.map((x) => x.share))! * 100), spans: xs.length });
  return { higher: g(hi), lower: g(lo) };
}

export interface ReadinessPerformance { higher: { score: number; pct: number; sessions: number }; lower: { score: number; pct: number; sessions: number } }

/** Each strength session's lifts against their own recent level (median of the 4 sessions before), split at the
 *  person's own median readiness on session days. Needs 6+ sessions with a readiness score. */
export function readinessVsPerformance(workouts: Workout[], daily: DailyHealth[], checkIns: CheckIn[], s: ScheduleSettings): ReadinessPerformance | null {
  const ws = workouts.filter((w) => live(w) && !w.cardio && working(w.sets).length).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const rows: { score: number; ratio: number }[] = [];
  for (const w of ws) {
    const t = Date.parse(w.startedAt);
    const r = readiness(daily, checkIns, t, s);
    if (!r) continue;
    const ratios: number[] = [];
    for (const id of new Set(working(w.sets).map((x) => x.exerciseId))) {
      const hist = e1rmSeries(id, ws).filter((p) => p.t < t).slice(-4).map((p) => p.v);
      const now = e1rmSeries(id, [w])[0]?.v;
      const m = median(hist);
      if (hist.length >= 2 && now && m) ratios.push(now / m);
    }
    if (ratios.length) rows.push({ score: r.score, ratio: avg(ratios)! });
  }
  if (rows.length < 6) return null;
  // Split at the median; ties go whichever way leaves 3+ sessions on both sides.
  const m = median(rows.map((x) => x.score))!;
  let hi = rows.filter((x) => x.score >= m), lo = rows.filter((x) => x.score < m);
  if (lo.length < 3) { hi = rows.filter((x) => x.score > m); lo = rows.filter((x) => x.score <= m); }
  if (hi.length < 3 || lo.length < 3 || hi.every((x) => x.score === lo[0].score)) return null;
  const g = (xs: typeof rows) => ({ score: Math.round(avg(xs.map((x) => x.score))!), pct: Math.round((avg(xs.map((x) => x.ratio))! - 1) * 100), sessions: xs.length });
  return { higher: g(hi), lower: g(lo) };
}
