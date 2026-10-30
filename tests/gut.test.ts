import { describe, it, expect } from 'vitest';
import type { CheckIn, FoodLog } from '../src/db/schema';
import type { ScheduleSettings } from '../src/logic/schedule';
import { gutLinks } from '../src/logic/gut';

const S: ScheduleSettings = { dayStartsAt: '04:00', tz: 'UTC', guardMinutes: 10 };
const DAY = 86_400_000;
const NOW = Date.parse('2026-10-30T20:00:00Z');
const st = { createdAt: '', updatedAt: '' };

describe('side effects against food', () => {
  it('constipation more often after low-fibre days', () => {
    const food: FoodLog[] = [], cis: CheckIn[] = [];
    for (let i = 1; i <= 24; i++) {
      const t = NOW - i * DAY - 8 * 3_600_000;
      const low = i <= 12; // two runs: the last 12 days low in fibre, the 12 before not
      food.push({ id: `f${i}`, at: new Date(t).toISOString(), name: 'Day', servings: 1, nutrients: { kcal: 1600, fibre: low ? 8 : 30 }, ...st });
      // A check-in the next morning; constipation after most low-fibre days, rarely otherwise.
      cis.push({ id: `c${i}`, at: new Date(t + DAY - 4 * 3_600_000).toISOString(), chips: low && i % 3 !== 0 ? ['Constipation'] : [], mood: 3, ...st });
    }
    const [g] = gutLinks(food, [], cis, NOW, S);
    expect(g).toMatchObject({ chip: 'Constipation', factor: 'fibre' });
    expect(g.withPct).toBeGreaterThan(g.withoutPct);
  });
  it('nothing without enough days on each side', () => {
    expect(gutLinks([], [], [], NOW, S)).toEqual([]);
  });
});
