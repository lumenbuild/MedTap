import { describe, it, expect } from 'vitest';
import type { DailyHealth, FoodLog } from '../src/db/schema';
import type { ScheduleSettings } from '../src/logic/schedule';
import { eatingPatterns } from '../src/logic/eating';

const S: ScheduleSettings = { dayStartsAt: '04:00', tz: 'UTC', guardMinutes: 10 };
const DAY = 86_400_000;
const NOW = Date.parse('2026-10-30T23:00:00Z');
const st = { createdAt: '', updatedAt: '' };
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);

describe('hunger and cravings', () => {
  it('eating without hunger, the usual reason, and short nights going with more of it', () => {
    const logs: FoodLog[] = [], daily: DailyHealth[] = [];
    for (let i = 1; i <= 16; i++) {
      const day = NOW - i * DAY;
      const short = i <= 8;
      daily.push({ id: `d${i}`, date: ymd(day), sleepMin: short ? 330 : 470, ...st });
      logs.push({ id: `l${i}`, at: new Date(day - 10 * 3_600_000).toISOString(), name: 'Lunch', servings: 1, nutrients: { kcal: 600 }, hunger: 4, why: 'hungry', ...st });
      if (short || i === 12) logs.push({ id: `s${i}`, at: new Date(day - 2 * 3_600_000).toISOString(), name: 'Chocolate', servings: 1, nutrients: { kcal: 250 }, hunger: 1, why: 'craving', ...st });
    }
    const e = eatingPatterns(logs, daily, NOW, S, null)!;
    expect(e.answered).toBe(25);
    expect(e.notHungryPct).toBe(36);
    expect(e.topWhy).toEqual({ why: 'craving', n: 9 });
    expect(e.shortSleep!.withPct).toBe(100);
    expect(e.shortSleep!.withoutPct).toBe(13);
  });
  it('needs 10 answered logs', () => {
    expect(eatingPatterns([], [], NOW, S, null)).toBeNull();
  });
});
