import { describe, it, expect } from 'vitest';
import type { BodyEntry, CheckIn, DailyHealth, Workout, WorkoutSet } from '../src/db/schema';
import { intakeTrend, proteinVsLean, readinessTrend, readinessVsPerformance } from '../src/logic/fitnessInsights';
import type { ScheduleSettings } from '../src/logic/schedule';
import { zonedToUtc } from '../src/logic/tz';

const TZ = 'Australia/Sydney';
const S: ScheduleSettings = { dayStartsAt: '04:00', tz: TZ, guardMinutes: 10 };
const DAY = 86_400_000;
const base = zonedToUtc(2026, 5, 4, 12, 0, TZ);
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const stamp = { createdAt: '', updatedAt: '' };

describe('fitness insights', () => {
  it('protein and water averages, per kg and days on target', () => {
    const daily: DailyHealth[] = [100, 140, 0, 160].map((p, i) => ({ id: `d${i}`, date: ymd(base + i * DAY), proteinG: p || undefined, waterMl: 2000, ...stamp }));
    const body: BodyEntry[] = [{ id: 'b', date: ymd(base), weightKg: 100, ...stamp }];
    const r = intakeTrend(daily, body, base - DAY, base + 5 * DAY, { protein: 140, water: 2500 })!;
    expect(r.protein).toEqual({ avg: 133, days: 3, perKg: 1.3, onTarget: 2 });
    expect(r.water).toEqual({ avg: 2000, days: 4, onTarget: 0 });
  });

  it('protein against lean mass kept', () => {
    // 5 spans of 3 weeks, 2 kg lost each; high-protein spans keep more lean mass.
    const body: BodyEntry[] = []; const daily: DailyHealth[] = [];
    let kg = 100, lean = 65;
    for (let i = 0; i <= 5; i++) {
      body.push({ id: `b${i}`, date: ymd(base + i * 21 * DAY), weightKg: kg, leanKg: lean, ...stamp });
      if (i === 5) break;
      const hi = i % 2 === 0;
      for (let d = 1; d <= 20; d++) daily.push({ id: `p${i}-${d}`, date: ymd(base + (i * 21 + d) * DAY), proteinG: hi ? 150 : 80, ...stamp });
      kg -= 2; lean -= hi ? 0.4 : 0.9;
    }
    const r = proteinVsLean(daily, body)!;
    expect(r.higher).toEqual({ protein: 150, share: 20, spans: 3 });
    expect(r.lower).toEqual({ protein: 80, share: 45, spans: 2 });
  });

  it('readiness by day, and against how sessions went', () => {
    const daily: DailyHealth[] = []; const ws: Workout[] = []; const checkIns: CheckIn[] = [];
    let n = 0;
    const set = (w: number): WorkoutSet => ({ id: `s${++n}`, exerciseId: 'squat', weightKg: w, reps: 5, done: true });
    for (let i = 0; i < 40; i++) {
      const t = base + i * DAY;
      const good = i % 3 !== 0;
      daily.push({ id: `d${i}`, date: ymd(t), sleepMin: good ? 480 : 300, restingHr: good ? 58 : 68, hrvMs: good ? 60 : 35, ...stamp });
      if (i % 2 === 0 && i >= 10) ws.push({ id: `w${i}`, startedAt: new Date(t + 6 * 3_600_000).toISOString(), sets: [set(good ? 102 : 94)], source: 'manual', ...stamp });
      else if (i % 2 === 0) ws.push({ id: `w${i}`, startedAt: new Date(t + 6 * 3_600_000).toISOString(), sets: [set(100)], source: 'manual', ...stamp });
    }
    expect(readinessTrend(daily, checkIns, base + 20 * DAY, base + 30 * DAY, S).length).toBeGreaterThan(5);
    const r = readinessVsPerformance(ws, daily, checkIns, S)!;
    expect(r.higher.pct).toBeGreaterThan(r.lower.pct);
    expect(r.lower.pct).toBeLessThan(0);
    expect(r.higher.score).toBeGreaterThan(r.lower.score);
  });
});
