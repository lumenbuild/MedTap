import { describe, it, expect } from 'vitest';
import type { DailyHealth } from '../src/db/schema';
import { sleepRegularity, stepsChange, stepsTarget } from '../src/logic/movement';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-30T12:00:00Z');
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);
const days = (n: number, f: (i: number) => Partial<DailyHealth>): DailyHealth[] => Array.from({ length: n }, (_, i) => ({ id: `d${i}`, date: ymd(NOW - (i + 1) * DAY), createdAt: '', updatedAt: '', ...f(i) }));

describe('movement and rest', () => {
  it('steps target: a little above the usual, to the next 500, needs 10 days', () => {
    expect(stepsTarget(days(20, () => ({ steps: 7000 })), NOW)).toBe(8000); // 7,700 → 8,000
    expect(stepsTarget(days(20, () => ({ steps: 2000 })), NOW)).toBe(4000);
    expect(stepsTarget(days(5, () => ({ steps: 7000 })), NOW)).toBeNull();
  });
  it('steps: the last two weeks against the four before', () => {
    expect(stepsChange(days(42, (i) => ({ steps: i < 14 ? 5000 : 8000 })), NOW)).toEqual({ now: 5000, before: 8000 });
  });
  it('sleep: how much it varies night to night', () => {
    const r = sleepRegularity(days(14, (i) => ({ sleepMin: i % 2 ? 360 : 480 })), NOW)!;
    expect(r).toMatchObject({ avgH: 7, spreadH: 1, nights: 14 });
  });
});
