import { describe, it, expect } from 'vitest';
import type { CheckIn, FoodLog } from '../src/db/schema';
import type { ScheduleSettings } from '../src/logic/schedule';
import { CAFFEINE, UNKNOWN_MG, bedtimeOf, dayTotal, intakesOf, isDrink, level, lowBy, nights, usualDrinks, type Intake } from '../src/logic/caffeine';
import { dailyHabits } from '../src/logic/dailyHabits';

const S: ScheduleSettings = { dayStartsAt: '04:00', tz: 'Australia/Sydney', guardMinutes: 10 };
const HOUR = 3_600_000;
const at = (d: string, hm: string) => new Date(`${d}T${hm}:00+11:00`).getTime();
const st = { createdAt: '', updatedAt: '' };
const drink = (t: number, mg?: number, note?: string, id = String(t)): CheckIn => ({ id, at: new Date(t).toISOString(), chips: [CAFFEINE], note, caffeineMg: mg, ...st });
const x = (t: number, mg: number, name?: string): Intake => ({ id: String(t), t, mg, name });

describe('caffeine in the body', () => {
  const t0 = at('2026-10-20', '08:00');
  it('peaks within the first hour, then halves every half-life', () => {
    const xs = [x(t0, 100)];
    expect(level(xs, t0)).toBe(0);
    const peakAt = [15, 30, 45, 60, 75, 90].map((m) => level(xs, t0 + m * 60_000));
    expect(Math.max(...peakAt)).toBeGreaterThan(80);
    expect(peakAt.indexOf(Math.max(...peakAt))).toBeLessThanOrEqual(3);
    const a = level(xs, t0 + 6 * HOUR), b = level(xs, t0 + 11 * HOUR);
    expect(b / a).toBeCloseTo(0.5, 1);
    expect(level(xs, t0 + 6 * HOUR, 8)).toBeGreaterThan(a); // a slower half-life keeps more
  });

  it('when it drops under 50 mg, and the level at bedtime', () => {
    const xs = [x(t0, 80), x(at('2026-10-20', '15:00'), 160)];
    const now = at('2026-10-20', '16:00');
    const low = lowBy(xs, now)!;
    expect(level(xs, low)).toBeLessThan(50);
    expect(level(xs, low - 10 * 60_000)).toBeGreaterThanOrEqual(50);
    expect(bedtimeOf(now, '22:30', S)).toBe(at('2026-10-20', '22:30'));
    expect(bedtimeOf(now, '00:30', S)).toBe(at('2026-10-21', '00:30')); // after midnight: the next date
    expect(lowBy([x(t0, 30)], now)).toBeNull(); // a small cup long ago: already low
  });

  it('adds up the day, from the day’s start', () => {
    const xs = [x(at('2026-10-20', '03:00'), 80), x(at('2026-10-20', '07:00'), 80), x(at('2026-10-20', '14:00'), 45)];
    expect(dayTotal(xs, at('2026-10-20', '18:00'), S)).toBe(125); // 3 am belongs to the day before
  });
});

describe('caffeine drinks', () => {
  it('takes the amount from the drink, from Food for older ones, else a usual cup', () => {
    const t = at('2026-10-20', '09:00');
    const food: FoodLog = { id: 'f', at: new Date(t).toISOString(), name: 'Energy drink', servings: 1, nutrients: { caffeine: 160 }, caffeineCheckInId: 'fromFood', ...st };
    const xs = intakesOf([drink(t, 80, 'Flat white', 'a'), drink(t + HOUR, undefined, 'Energy drink', 'fromFood'), drink(t + 2 * HOUR, undefined, undefined, 'b')], [food]);
    expect(xs.map((i) => i.mg)).toEqual([80, 160, UNKNOWN_MG]);
  });

  it('a drink is one on its own, not a fuller check-in that ticked Caffeine', () => {
    expect(isDrink(drink(0, 80, 'Latte'))).toBe(true);
    expect(isDrink({ ...drink(0), mood: 4 })).toBe(false);
    expect(isDrink({ ...drink(0), chips: [CAFFEINE, 'Jittery'] })).toBe(false);
  });

  it('usual drinks: most often first, then most recent', () => {
    const t = at('2026-10-20', '09:00');
    const xs = [x(t - 3 * 24 * HOUR, 80, 'Flat white'), x(t - 2 * 24 * HOUR, 80, 'Flat white'), x(t - 24 * HOUR, 45, 'Black tea'), x(t, 160, 'Cold brew'), x(t - 200 * 24 * HOUR, 70, 'Instant coffee')];
    expect(usualDrinks(xs, t)).toEqual([{ name: 'Flat white', mg: 80 }, { name: 'Cold brew', mg: 160 }, { name: 'Black tea', mg: 45 }]);
  });

  it('each night: the day’s total and the level at bedtime', () => {
    const xs = [x(at('2026-10-20', '08:00'), 80), x(at('2026-10-20', '17:00'), 160)];
    const [n] = nights(xs, ['2026-10-20'], '22:30', S);
    expect(n.total).toBe(240);
    expect(n.atBed).toBeGreaterThan(60);
    expect(n.atBed).toBeLessThan(110);
  });

  it('Trends: mg a day, against the limit', () => {
    const cis = ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'].flatMap((d, i) => [drink(at(d, '08:00'), 160, 'Double', `${d}a`), drink(at(d, '14:00'), 100 * i, 'More', `${d}b`)]);
    const [c] = dailyHabits({ daily: [], foodLogs: [], checkIns: cis }, at('2026-10-10', '00:00'), at('2026-10-14', '00:00'), null, S,
      { food: false, intake: false, readiness: false, targets: { caffeineLimit: 300 } });
    expect(c.key).toBe('caffeine');
    expect(c.days.map((d) => d.v)).toEqual([160, 260, 360, 460]);
    expect(c.underLimit).toBe(2);
  });
});
