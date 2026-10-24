import { describe, it, expect } from 'vitest';
import type { CheckIn, DailyHealth, FoodLog } from '../src/db/schema';
import type { ScheduleSettings } from '../src/logic/schedule';
import { dailyHabits } from '../src/logic/dailyHabits';

const S: ScheduleSettings = { dayStartsAt: '04:00', tz: 'Australia/Sydney', guardMinutes: 10 };
const st = { createdAt: '', updatedAt: '' };
const at = (d: string, hm = '12:00') => new Date(`${d}T${hm}:00+11:00`).getTime();
const day = (date: string, o: Partial<DailyHealth>): DailyHealth => ({ id: date, date, ...st, ...o });
const food = (d: string, hm: string, kcal: number): FoodLog => ({ id: d + hm, at: new Date(at(d, hm)).toISOString(), name: 'x', servings: 1, nutrients: { kcal, protein: 20 }, ...st });
const ci = (d: string, sleepHours: number): CheckIn => ({ id: 'c' + d, at: new Date(at(d, '08:00')).toISOString(), chips: [], sleepHours, ...st } as CheckIn);
const opts = { food: true, intake: true, readiness: false, targets: { energy: 2000, protein: 120, water: null } };
const dates = ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'];
const START = at('2026-10-10', '00:00'), END = at('2026-10-14', '00:00'), PREV = at('2026-10-06', '00:00');

describe('Daily habits', () => {
  it('adds up the day’s food and counts days at the target', () => {
    const logs = dates.flatMap((d, i) => [food(d, '08:00', 600), food(d, '19:00', 1200 + i * 200)]);
    const [e] = dailyHabits({ daily: [], foodLogs: logs, checkIns: [] }, START, END, null, S, opts);
    expect(e.key).toBe('energy');
    expect(e.days.map((d) => d.v)).toEqual([1800, 2000, 2200, 2400]);
    expect(e.avg).toBe(2100);
    expect(e.onTarget).toBe(3);
  });

  it('leaves out habits with fewer than 3 days, and ones that are switched off', () => {
    const daily = dates.map((d, i) => day(d, { steps: 8000 + i * 1000, proteinG: i < 2 ? 100 : undefined, sleepMin: 420 }));
    const keys = dailyHabits({ daily, foodLogs: [], checkIns: [] }, START, END, null, S, { ...opts, intake: false }).map((h) => h.key);
    expect(keys).toEqual(['steps', 'sleep']);
  });

  it('fills sleep from check-ins on nights with no imported sleep, and compares with the time before', () => {
    const daily = [day('2026-10-10', { sleepMin: 480 }), day('2026-10-07', { sleepMin: 360 }), day('2026-10-08', { sleepMin: 360 }), day('2026-10-09', { sleepMin: 360 })];
    const checkIns = [ci('2026-10-11', 6), ci('2026-10-12', 7), ci('2026-10-10', 5)];
    const [sl] = dailyHabits({ daily, foodLogs: [], checkIns }, START, END, PREV, S, opts);
    expect(sl.key).toBe('sleep');
    expect(sl.days.map((d) => d.v)).toEqual([8, 6, 7]); // imported 8 h wins over the 5 h check-in that day
    expect(sl.prevAvg).toBe(6);
  });
});
