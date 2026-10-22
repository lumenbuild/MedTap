// Turning what Health Connect / Apple Health returns into records: one daily row per day (updated by later imports),
// weigh-ins only on days with none logged by hand, and blood pressure readings not already logged within 5 minutes.
// Pure, so it can be tested; src/app/health.ts writes the result.
import type { BodyEntry, DailyHealth, Vital } from '../db/schema';
import type { HealthData } from '../nfc/native';

export interface HealthPlan { daily: DailyHealth[]; body: { date: string; kg: number }[]; vitals: { at: string; systolic: number; diastolic: number }[] }

const ymdIn = (t: number, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);

export function planHealthImport(data: HealthData, existing: { daily: DailyHealth[]; body: BodyEntry[]; vitals: Vital[] }, personId: string | undefined, tz: string, nowIso: string): HealthPlan {
  const mine = <T extends { personId?: string; deletedAt?: string }>(r: T) => (r.personId ?? undefined) === personId && !r.deletedAt;
  const daily: DailyHealth[] = [];
  for (const d of data.days) {
    const old = existing.daily.find((x) => mine(x) && x.date === d.date);
    const row: DailyHealth = {
      ...(old ?? { id: crypto.randomUUID(), date: d.date, createdAt: nowIso, personId }),
      steps: d.steps ?? old?.steps, sleepMin: d.sleepMin ?? old?.sleepMin, restingHr: d.restingHr ?? old?.restingHr,
      exerciseMin: d.exerciseMin ?? old?.exerciseMin, hrByHour: d.hrByHour ?? old?.hrByHour, updatedAt: nowIso,
    };
    daily.push(row);
  }
  // One weigh-in per day (the latest), only where nothing's been logged for that day.
  const byDay = new Map<string, { t: number; kg: number }>();
  for (const w of data.weights) { const k = ymdIn(w.t, tz); if (!byDay.has(k) || byDay.get(k)!.t < w.t) byDay.set(k, w); }
  const body = [...byDay].filter(([date]) => !existing.body.some((b) => mine(b) && b.date === date && typeof b.weightKg === 'number'))
    .map(([date, w]) => ({ date, kg: Math.round(w.kg * 10) / 10 }));
  const vitals = data.bp.filter((r) => !existing.vitals.some((v) => mine(v) && Math.abs(Date.parse(v.at) - r.t) < 5 * 60_000))
    .map((r) => ({ at: new Date(r.t).toISOString(), systolic: r.sys, diastolic: r.dia }));
  return { daily, body, vitals };
}
