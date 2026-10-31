import { describe, it, expect } from 'vitest';
import type { DailyHealth, Experiment } from '../src/db/schema';
import { analyse, conditionOn, lastDay, randomBlocks } from '../src/logic/experiments';

const st = { createdAt: '', updatedAt: '' };
const DAY = 86_400_000;
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const seeded = () => { let x = 0.42; return () => (x = (x * 9301 + 49297) % 233280) / 233280; };

describe('self-experiments', () => {
  it('balanced random blocks, never 3 in a row', () => {
    const b = randomBlocks(8, seeded());
    expect(b.filter((x) => x === 'a')).toHaveLength(4);
    expect(b.some((x, i) => i >= 2 && x === b[i - 1] && x === b[i - 2])).toBe(false);
  });
  const start = new Date(2026, 8, 1, 12).getTime();
  const e: Experiment = { id: 'e', title: 'Magnesium', a: 'Magnesium', b: 'None', metric: 'deepMin', blockDays: 3, blocks: ['a', 'b', 'b', 'a', 'a', 'b', 'b', 'a'], start: ymd(start), ...st };
  it('today’s condition', () => {
    expect(conditionOn(e, ymd(start))).toEqual({ arm: 'a', block: 0, dayInBlock: 1 });
    expect(conditionOn(e, ymd(start + 4 * DAY))).toEqual({ arm: 'b', block: 1, dayInBlock: 2 });
    expect(conditionOn(e, ymd(start + 30 * DAY))).toBeNull();
    expect(lastDay(e)).toBe(ymd(start + 23 * DAY));
  });
  it('a clear difference, and none', () => {
    const daily = (aVal: number, bVal: number): DailyHealth[] => Array.from({ length: 24 }, (_, i) => {
      const arm = conditionOn(e, ymd(start + i * DAY))!.arm;
      return { id: `d${i}`, date: ymd(start + (i + 1) * DAY), sleepDeepMin: (arm === 'a' ? aVal : bVal) + ((i * 7) % 5) - 2, ...st };
    });
    const r = analyse(e, { checkIns: [], daily: daily(80, 62), body: [] }, start + 25 * DAY, seeded());
    expect(r.progress.blocksDone).toBe(8);
    expect(r.a.mean! - r.b.mean!).toBeGreaterThan(15);
    expect(r.verdict).toBe('a-better');
    expect(r.p!).toBeLessThan(0.05);
    const n = analyse(e, { checkIns: [], daily: daily(70, 70), body: [] }, start + 25 * DAY, seeded());
    expect(n.verdict).toBe('no-difference');
    const early = analyse(e, { checkIns: [], daily: daily(80, 62), body: [] }, start + 5 * DAY, seeded());
    expect(early.verdict).toBe('running');
  });
});
