import { describe, it, expect } from 'vitest';
import { forecast, forecastWeekAgo, isFastWeightPace, milestones, robustFit, seriesOf, smoothTrend, type Pt } from '../src/logic/forecast';
import type { BodyEntry, BodyGoal } from '../src/db/schema';

const DAY = 86_400_000;
const T0 = Date.parse('2026-06-01T12:00:00+10:00');
const day = (i: number) => T0 + i * DAY;
/** Repeatable "water weight" noise of up to ±0.5 kg (a hash of the day number, no pattern). */
const noise = (i: number) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x) - 0.5; };
/** Daily weigh-ins from `from` for `days`, losing `perDay` kg a day, with noise. */
const daily = (start: number, perDay: number, days: number, from = 0, skip = (_: number) => false): Pt[] =>
  Array.from({ length: days }, (_, k) => from + k).filter((i) => !skip(i)).map((i) => ({ t: day(i), v: start + perDay * (i - from) + noise(i) }));
const goal = (o: Partial<BodyGoal> = {}): BodyGoal => ({ metric: 'weightKg', start: 100, startDate: '2026-06-01', target: 85, ...o });

describe('robustFit', () => {
  it('finds the rate through noisy daily weigh-ins', () => {
    const f = robustFit(daily(100, -0.1, 28), day(27))!;
    expect(f.slope * 7).toBeCloseTo(-0.7, 1);
    expect(f.level).toBeCloseTo(97.3, 0);
    expect(f.slopeLow).toBeLessThanOrEqual(f.slope);
    expect(f.slopeHigh).toBeGreaterThanOrEqual(f.slope);
  });
  it('one odd weigh-in barely moves it', () => {
    const pts = daily(100, -0.1, 28);
    const clean = robustFit(pts, day(27))!.slope;
    pts[25] = { ...pts[25], v: pts[25].v + 5 }; // a big salty dinner
    expect(Math.abs(robustFit(pts, day(27))!.slope - clean) * 7).toBeLessThan(0.05);
  });
});

describe('forecast', () => {
  it('needs a week of logs first', () => {
    expect(forecast(daily(100, -0.1, 4), goal(), day(3)).status).toBe('need-data');
  });
  it('steady loss: goal date with a likely range around it', () => {
    const f = forecast(daily(100, -0.1, 42), goal(), day(41));
    expect(f.status).toBe('on-track');
    expect(f.perWeek).toBeCloseTo(-0.7, 1);
    // 95.9 kg now, 10.9 kg to go at 0.1 kg/day ≈ 109 days.
    const days = (f.eta! - day(41)) / DAY;
    expect(days).toBeGreaterThan(95);
    expect(days).toBeLessThan(125);
    expect(f.etaEarly!).toBeLessThanOrEqual(f.eta!);
    expect(f.etaLate!).toBeGreaterThanOrEqual(f.eta!);
    expect(f.done).toBeGreaterThan(0.25);
    expect(f.done).toBeLessThan(0.3);
  });
  it('the likely range is tight for steady daily logs, and wider with fewer logs', () => {
    const now = day(41);
    const width = (f: ReturnType<typeof forecast>) => (f.etaLate! - f.etaEarly!) / DAY;
    const dailyF = forecast(daily(100, -0.1, 42), goal(), now);
    const sparse = forecast(daily(100, -0.1, 42, 0, (i) => i % 4 !== 1), goal(), now);
    const days = (dailyF.eta! - now) / DAY;
    expect(width(dailyF)).toBeLessThan(days * 0.4);
    expect(width(sparse)).toBeGreaterThan(width(dailyF));
  });
  it('works with gaps (logging a few times a week)', () => {
    const f = forecast(daily(100, -0.1, 42, 0, (i) => i % 3 !== 0), goal(), day(41));
    expect(f.status).toBe('on-track');
    expect(f.perWeek).toBeCloseTo(-0.7, 0);
  });
  it('with a target date: on track, or behind with the pace needed', () => {
    const pts = daily(100, -0.1, 42);
    const soon = forecast(pts, goal({ targetDate: '2026-08-01' }), day(41));
    expect(soon.status).toBe('behind');
    expect(soon.neededPerWeek!).toBeLessThan(-3);
    expect(soon.daysPastTarget!).toBeGreaterThan(30);
    const later = forecast(pts, goal({ targetDate: '2027-03-01' }), day(41));
    expect(later.status).toBe('on-track');
    expect(later.daysPastTarget!).toBeLessThan(0);
  });
  it('a plateau has no date', () => {
    const pts = [...daily(100, -0.1, 28), ...daily(97.2, 0, 28, 28)];
    expect(forecast(pts, goal(), day(55)).status).toBe('flat');
  });
  it('going the wrong way', () => {
    expect(forecast(daily(100, 0.05, 28), goal(), day(27)).status).toBe('away');
  });
  it('notices when it slows down', () => {
    const pts = [...daily(100, -0.15, 14), ...daily(97.9, -0.03, 14, 14)];
    const f = forecast(pts, goal(), day(27));
    expect(f.slowing).toBeDefined();
    expect(f.slowing!.was).toBeLessThan(-0.8);
    expect(f.slowing!.now).toBeGreaterThan(-0.4);
  });
  it('reached: when, and how far from the goal it is now', () => {
    const pts = [...daily(90, -0.2, 25), ...daily(85, 0, 25, 25)];
    const f = forecast(pts, goal(), day(49));
    expect(f.status).toBe('reached');
    expect(f.reachedAt).toBeDefined();
    expect(Math.abs(f.drift!)).toBeLessThan(0.3);
  });
  it('gaining towards a goal works the same way', () => {
    const f = forecast(daily(60, 0.05, 28), goal({ start: 60, target: 65 }), day(27));
    expect(f.status).toBe('on-track');
    expect(f.perWeek!).toBeGreaterThan(0);
  });
  it('shows how the date has moved since a week ago', () => {
    const pts = [...daily(100, -0.1, 35), ...daily(96.5, -0.2, 14, 35)];
    const now = forecast(pts, goal(), day(48));
    const before = forecastWeekAgo(pts, goal(), day(48));
    expect(now.eta!).toBeLessThan(before.eta!);
  });
});

describe('milestones', () => {
  it('5% and 10% down, halfway, then the goal; reached ones dated', () => {
    const pts = daily(100, -0.1, 70);
    const now = day(69);
    const ms = milestones(pts, goal(), forecast(pts, goal(), now), now);
    expect(ms.map((m) => m.label)).toEqual(['5% down', 'Halfway', '10% down', 'Goal']);
    expect(ms[0].reachedAt).toBeDefined();
    expect(ms[3].reachedAt).toBeUndefined();
    expect(ms[3].eta).toBeDefined();
  });
});

describe('helpers', () => {
  it('one point per day from body entries, averaging repeats', () => {
    const e = (date: string, weightKg?: number, deletedAt?: string) => ({ id: date + weightKg, date, weightKg, deletedAt, createdAt: '', updatedAt: '' }) as BodyEntry;
    const s = seriesOf([e('2026-06-02', 80), e('2026-06-01', 81), e('2026-06-01', 83), e('2026-06-03'), e('2026-06-04', 70, 'x')], 'weightKg');
    expect(s.map((p) => p.v)).toEqual([82, 80]);
  });
  it('trend smooths noise', () => {
    const t = smoothTrend(daily(100, 0, 30));
    expect(Math.max(...t.slice(10).map((p) => Math.abs(p.v - 100)))).toBeLessThan(0.3);
  });
  it('fast pace is over 1% of body weight a week', () => {
    expect(isFastWeightPace(-1.2, 100)).toBe(true);
    expect(isFastWeightPace(-0.7, 100)).toBe(false);
  });
});
