import { describe, it, expect } from 'vitest';
import type { BodyEntry, CheckIn, DailyHealth, Dose, FoodLog, Medication } from '../src/db/schema';
import type { ScheduleSettings } from '../src/logic/schedule';
import { todayPlan } from '../src/logic/plan';
import { goalRings } from '../src/logic/rings';
import { driversFor } from '../src/logic/drivers';
import { weekCauses, nextLevers } from '../src/logic/weekPlan';
import { dayView } from '../src/logic/day';
import { microTotals, microWeek, microsOf, microTarget, profilesFor } from '../src/logic/micros';
import type { Insight } from '../src/logic/insights';

const S: ScheduleSettings = { dayStartsAt: '00:00', tz: Intl.DateTimeFormat().resolvedOptions().timeZone, guardMinutes: 10 };
const DAY = 86_400_000;
const NOW = new Date(2026, 10, 6, 18, 0).getTime();
const st = { createdAt: '', updatedAt: '' };
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const at = (k: number, h = 12, m = 0) => { const d = new Date(NOW - k * DAY); d.setHours(h, m, 0, 0); return d.getTime(); };
const iso = (t: number) => new Date(t).toISOString();

describe("today's plan", () => {
  it('says each thing once, most useful first, with what it rests on', () => {
    const ins: Insight[] = [
      { id: 'a', kind: 'second', importance: 90, confidence: 'high', headline: 'Second dose soon', tone: 'plain', snoozeDays: 1 },
      { id: 'b', kind: 'steps', importance: 40, confidence: 'medium', headline: 'Steps down this week', tone: 'watch', snoozeDays: 3, n: 14, nOf: 'days' },
    ];
    const p = todayPlan({
      calls: [{ key: 'second-dose', title: 'Second dose at 1 pm', detail: 'Your usual gap.', tone: 'info' }, { key: 'caffeine', title: 'Last caffeine by 2 pm', detail: '', tone: 'info' }],
      warnings: [{ key: 'overtraining', title: 'Training more, recovering less', detail: 'Load up.', action: 'Lighter days.' }],
      brief: [{ key: 'second:m1', text: 'Second dose at 1 pm' }, { key: 'water:x', text: 'About 3 L of water' }],
      insights: ins,
    });
    expect(p.filter((x) => /second/i.test(x.title))).toHaveLength(1);
    expect(p[0].key).toBe('call:second-dose:0');
    expect(p[1].key).toBe('warn:overtraining');
    expect(p.find((x) => x.key === 'ins:b')?.because[0]).toEqual({ label: '14 days', href: '#/health' });
    expect(p.every((x) => x.thread)).toBe(true);
  });
});

describe('goal rings', () => {
  it('fat toward the goal, lean kept, protein days, steps and sleep', () => {
    const body: BodyEntry[] = Array.from({ length: 40 }, (_, i) => { const k = 80 - i * 2; const lost = (80 - k) * 0.12; return { id: `b${k}`, date: ymd(at(k)), weightKg: 110 - lost, bodyFatPct: Math.round(((44 - lost * 0.8) / (110 - lost)) * 1000) / 10, ...st }; });
    const daily: DailyHealth[] = [0, 1, 2, 3].map((k) => ({ id: `d${k}`, date: ymd(at(k)), proteinG: k === 1 ? 90 : 150, steps: 8000, sleepMin: 420, ...st }));
    const r = goalRings({ body, daily, goalKg: 90, proteinTarget: 150, stepsTarget: 10000, sleepTargetMin: 480 }, NOW, S);
    expect(r.map((x) => x.key)).toEqual(['fat', 'lean', 'protein', 'steps', 'sleep']);
    const fat = r.find((x) => x.key === 'fat')!;
    expect(fat.frac).toBeGreaterThan(0.2);
    expect(fat.frac).toBeLessThan(1);
    expect(r.find((x) => x.key === 'steps')!.frac).toBeCloseTo(0.8);
  });
});

describe('what moves it for you', () => {
  // Caffeine after 2 pm on every third day costs about 50 minutes of sleep.
  const checkIns: CheckIn[] = [];
  const daily: DailyHealth[] = [];
  for (let k = 60; k >= 0; k--) {
    const late = k % 3 === 0;
    if (late) checkIns.push({ id: `c${k}`, at: iso(at(k, 15)), chips: ['Caffeine'], caffeineMg: 120, ...st });
    daily.push({ id: `d${k}`, date: ymd(at(k - 1)), sleepMin: (late ? 380 : 430) + ((k * 7) % 5) * 4, ...st });
  }
  const d = { meds: [] as Medication[], doses: [] as Dose[], checkIns, daily, workouts: [], foodLogs: [] as FoodLog[], body: [] as BodyEntry[] };
  it('finds late caffeine costing sleep', () => {
    const r = driversFor('sleep', d, NOW, S);
    const c = r.drivers.find((x) => x.key === 'late-caffeine')!;
    expect(c.helps).toBe(false);
    expect(c.diff).toBeLessThan(-40);
    expect(c.sure).toBe('clear');
  });
  it('turns drivers into last week\'s causes and next week\'s levers', () => {
    const r = driversFor('sleep', d, NOW, S);
    // Make last week heavy on late caffeine.
    const wk = { ...r, drivers: r.drivers.map((x) => ({ ...x, on: [...x.on, ymd(at(4)), ymd(at(5)), ymd(at(7))] })) };
    const causes = weekCauses([wk], ymd(at(8)), ymd(at(2)));
    expect(causes[0].text).toMatch(/Caffeine after 2 pm: \d days/);
    const lev = nextLevers([wk], ymd(at(8)), ymd(at(2)));
    expect(lev[0].title).toBe('Fewer days with caffeine after 2 pm');
  });
});

describe('levers stay safe', () => {
  it('never a medicine, never less of a healthy habit', () => {
    const drv = (key: string, label: string, helps: boolean) => ({ key, label, helps, withIt: 1, without: 2, diff: -1, text: '−1', nWith: 9, nWithout: 30, sure: 'clear' as const, on: ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'] });
    const all = [{ topic: 'focus' as const, label: 'Focus', days: 60, drivers: [drv('med-x', 'Taking Vyvanse', false), drv('steps', 'Over 9k steps', false), drv('alcohol', 'Alcohol', false)] }];
    const lev = nextLevers(all, '2026-11-02', '2026-11-08');
    expect(lev.map((l) => l.title)).toEqual(['Fewer days with alcohol']);
    expect(weekCauses(all, '2026-11-02', '2026-11-08').some((c) => /Vyvanse/.test(c.text))).toBe(false);
  });
});

describe('the day on one timeline', () => {
  it('lays out the day and links heart rate after a dose, caffeine at sleep and a late meal', () => {
    const med: Medication = { id: 'm', name: 'Ritalin', strength: 10, unit: 'mg', form: 'tablet', defaultAmount: 10, schedule: { type: 'prn' }, color: '', icon: 'pill', archived: false, ...st };
    const day = ymd(at(1));
    const hr5 = Array.from({ length: 288 }, (_, i) => (i >= 96 && i < 120 ? 82 : 64));
    const tomorrow = new Date(at(0, 0)); tomorrow.setHours(0, 0, 0, 0);
    const v = dayView({
      meds: [med], doses: [{ id: 'x', medicationId: 'm', takenAt: iso(at(1, 7, 30)), amount: 10, source: 'manual', ...st }],
      checkIns: [{ id: 'c', at: iso(at(1, 16)), chips: ['Caffeine'], note: 'Cold brew', caffeineMg: 150, waterMl: 250, ...st }],
      foodLogs: [{ id: 'f', at: iso(at(1, 22)), name: 'Pasta', servings: 1, nutrients: { kcal: 650, protein: 25 }, ...st }],
      workouts: [], body: [], vitals: [],
      daily: [{ id: 'd1', date: day, hr5, steps: 9000, ...st }, { id: 'd0', date: ymd(at(0)), sleepStart: at(1, 23, 0), sleepEnd: at(0, 7), sleepMin: 450, restingHr: 58, ...st }],
    }, day, { halfLifeH: 5 });
    expect(v.events.map((e) => e.lane)).toEqual(['meds', 'drink', 'food']);
    expect(v.notes.join(' ')).toMatch(/Heart rate up 18 bpm in the 2 hours after Ritalin/);
    expect(v.notes.join(' ')).toMatch(/mg of caffeine still in you/);
    expect(v.notes.join(' ')).toMatch(/Last meal 1 hours before sleep|Last meal under an hour|Last meal 1 hours/);
    expect(v.totals.caffeineMg).toBe(150);
  });
});

describe('vitamins and minerals', () => {
  it('reads names into food profiles, longest first', () => {
    expect(profilesFor('Chicken thigh and broccoli').map((p) => p[0])).toEqual(['Chicken thigh', 'Broccoli']);
    expect(profilesFor('Sweet potato mash').map((p) => p[0])).toEqual(['Sweet potato', 'Potato']);
  });
  it('label values win; the rest is estimated from what it is, by calories', () => {
    const m = microsOf({ name: 'Salmon', nutrients: { kcal: 206, vitD: 5 } });
    expect(m.n.vitD).toBe(5);
    expect(m.n.b12).toBeCloseTo(3.0);
    expect(m.est).toBe(true);
    expect(microsOf({ name: 'Mystery bar', nutrients: { kcal: 200 } }).covered).toBe(false);
  });
  it('targets by sex and age', () => {
    expect(microTarget('iron', 'f')).toBe(18);
    expect(microTarget('iron', 'm')).toBe(8);
    expect(microTarget('vitD', 'm', 60)).toBe(10);
  });
  it('the week: averages, lows and foods for them, with coverage', () => {
    const logs: FoodLog[] = [];
    for (let k = 1; k <= 5; k++) {
      logs.push({ id: `a${k}`, at: iso(at(k, 8)), name: 'Oats with milk', servings: 1, nutrients: { kcal: 400 }, ...st });
      logs.push({ id: `b${k}`, at: iso(at(k, 13)), name: 'Chicken and rice', servings: 1, nutrients: { kcal: 700 }, ...st });
    }
    const w = microWeek(logs, NOW, { sex: 'm', age: 40 })!;
    expect(w.days).toBe(5);
    expect(w.avg.coverage).toBe(1);
    expect(w.lows.map((l) => l.key)).toContain('vitC');
    expect(w.lows.find((l) => l.key === 'vitC')!.foods[0]).toBe('Capsicum');
    const day = microTotals(logs, at(1, 0), at(0, 0), { sex: 'm' });
    expect(day.rows.find((r) => r.key === 'b3')!.pct).toBeGreaterThan(50);
  });
});
