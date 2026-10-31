import { describe, it, expect } from 'vitest';
import type { BodyEntry, CheckIn, DailyHealth, Dose, Medication, Workout } from '../src/db/schema';
import type { ScheduleSettings } from '../src/logic/schedule';
import { isScheduledDay } from '../src/logic/schedule';
import { afterBreak, brainScore, doseCreep, focusByHour, illnessWarning, mindReadiness, nBackSequence, rebound, recoveryTimes, scoreNBack, scoreReaction, tolerance } from '../src/logic/biohack';
import { appetiteAhead, fluids, gutByShotDay, muscleScore, yearReview } from '../src/logic/bodyhack';

const S: ScheduleSettings = { dayStartsAt: '04:00', tz: Intl.DateTimeFormat().resolvedOptions().timeZone, guardMinutes: 10 };
const DAY = 86_400_000, HOUR = 3_600_000;
const NOW = new Date(2026, 9, 23, 15, 0).getTime();
const at = (daysAgo: number, h = 12, m = 0) => { const d = new Date(NOW - daysAgo * DAY); d.setHours(h, m, 0, 0); return d.getTime(); };
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const iso = (t: number) => new Date(t).toISOString();
const st = { createdAt: '', updatedAt: '' };
let n = 0;
const dose = (medicationId: string, t: number, amount: number): Dose => ({ id: `${medicationId}${t}${n++}`, medicationId, takenAt: iso(t), amount, source: 'manual', ...st });
const ci = (t: number, o: Partial<CheckIn>): CheckIn => ({ id: `c${n++}`, at: iso(t), chips: [], ...st, ...o });
const med = (o: Partial<Medication>): Medication => ({ id: 'r', name: 'Ritalin', strength: 10, unit: 'mg', form: 'tablet', defaultAmount: 10, schedule: { type: 'fixed', slots: [{ time: '08:00' }] }, color: '', icon: 'pill', archived: false, ...st, ...o });
const ritalin = med({});
const reta = med({ id: 'g', name: 'Retatrutide', form: 'injection', schedule: { type: 'fixed', slots: [{ time: '08:00' }], days: [1, 4] } });

describe('brain tests', () => {
  it('scores reaction and working memory', () => {
    expect(scoreReaction([300, 'early', 280, 320, 600, 310])).toEqual({ rtMs: 310, rtLapses: 1, rtEarly: 1 });
    expect(scoreReaction([300, 'early'])).toBeNull();
    expect(brainScore({ rtMs: 250 })).toBe(100);
    expect(brainScore({ rtMs: 450 })).toBe(0);
    expect(brainScore({ rtMs: 350, rtLapses: 1, nbackPct: 80 })).toBe(Math.round(0.6 * 46 + 0.4 * 80));
    const seq = nBackSequence(20, (() => { let x = 0.1; return () => (x = (x * 9301 + 0.49297) % 1); })());
    const truth = seq.map((c, i) => i >= 2 && c === seq[i - 2]);
    expect(scoreNBack(seq, truth)).toBe(100);
    expect(scoreNBack(seq, seq.map(() => false))).toBeLessThan(100);
  });
  it('focus by the hour finds the best stretch', () => {
    const cis: CheckIn[] = [];
    for (let k = 1; k <= 14; k++) for (const h of [8, 9, 10, 11, 14, 16, 19]) cis.push(ci(at(k, h), { focus: h >= 9 && h <= 11 ? 5 : 2 }));
    const f = focusByHour(cis, NOW, S)!;
    expect(f.best).toEqual({ from: 9, to: 12 });
  });
  it('the evening rebound', () => {
    const doses: Dose[] = [], cis: CheckIn[] = [];
    for (let k = 1; k <= 5; k++) { doses.push(dose('r', at(k, 8), 10)); cis.push(ci(at(k, 10), { rtMs: 280 }), ci(at(k, 19), { rtMs: 330 })); }
    const r = rebound([ritalin], doses, cis, NOW, S)!;
    expect(r).toMatchObject({ day: 280, evening: 330, dipPct: 18 });
  });
});

describe('tolerance, creep and breaks', () => {
  it('focus after a dose falling over 10 weeks', () => {
    const doses: Dose[] = [], cis: CheckIn[] = [];
    for (let k = 1; k < 70; k++) { const t = at(k, 8); doses.push(dose('r', t, 10)); cis.push(ci(t + 2 * HOUR, { focus: k > 49 ? 4.5 : k < 21 ? 3.5 : 4 })); }
    const r = tolerance(ritalin, doses, cis, [], NOW, S)!;
    expect(r.amount).toBe(10);
    expect(r.drops.map((d) => d.what)).toEqual(['Focus after a dose']);
  });
  it('dose creep', () => {
    const doses: Dose[] = [];
    for (let k = 1; k < 60; k++) { doses.push(dose('r', at(k, k < 21 ? 7 : 8), 10)); if (k < 21) doses.push(dose('r', at(k, 12), 10)); }
    const c = doseCreep(ritalin, doses, NOW, S)!;
    expect(c.lines.join()).toMatch(/10 → 20 mg a day/);
    expect(c.lines.join()).toMatch(/first dose 60 min earlier/);
  });
  it('focus after a break', () => {
    const doses: Dose[] = [], cis: CheckIn[] = [];
    for (let k = 1; k < 40; k++) {
      if ([10, 11, 12, 25, 26, 27].includes(k)) continue;
      const t = at(k, 8); doses.push(dose('r', t, 10));
      cis.push(ci(t + 2 * HOUR, { focus: k === 9 || k === 24 ? 5 : 3 }));
    }
    const b = afterBreak(ritalin, doses, cis, [], NOW, S)!;
    expect(b.breaks).toBe(2);
    expect(b.firstFocus).toBe(5);
    expect(b.usualFocus).toBe(3);
  });
  it('planned breaks are not due', () => {
    const m = med({ schedule: { type: 'fixed', slots: [{ time: '08:00' }], breaks: [{ from: ymd(at(-1)), to: ymd(at(-3)) }] } });
    expect(isScheduledDay(m, at(0), S)).toBe(true);
    expect(isScheduledDay(m, at(-2), S)).toBe(false);
  });
});

describe('readiness, illness and recovery', () => {
  const base = (i: number, o: Partial<DailyHealth> = {}): DailyHealth => ({ id: `d${i}`, date: ymd(at(i)), sleepMin: 450, restingHr: 60, hrvMs: 50, ...st, ...o });
  it('a low day and its plan', () => {
    const daily = [...Array.from({ length: 20 }, (_, i) => base(i + 1)), base(0, { sleepMin: 320, restingHr: 66, hrvMs: 38 })];
    const r = mindReadiness({ daily, checkIns: [ci(at(1, 21), { chips: ['Alcohol'] })], doses: [], meds: [ritalin] }, NOW, S, { bedtime: '10 pm' })!;
    expect(r.label).toBe('Low');
    expect(r.parts.map((p) => p.what)).toContain('Alcohol yesterday');
    expect(r.plan.join()).toMatch(/easier session/);
    expect(r.plan.join()).toMatch(/later or smaller first dose/);
  });
  it('a sharp day', () => {
    const daily = [...Array.from({ length: 20 }, (_, i) => base(i + 1)), base(0, { sleepMin: 500, restingHr: 56, hrvMs: 62 })];
    const r = mindReadiness({ daily, checkIns: [], doses: [], meds: [] }, NOW, S, { bestHours: { from: 9, to: 12 } })!;
    expect(r.label).toBe('Sharp');
    expect(r.plan.join()).toMatch(/9 am–12 pm/);
  });
  it('illness warning from heart rate and HRV', () => {
    const daily = [...Array.from({ length: 20 }, (_, i) => base(i + 3)), base(1, { restingHr: 66, hrvMs: 40 }), base(0, { restingHr: 67, hrvMs: 39 })];
    expect(illnessWarning(daily, NOW, S)).toMatchObject({ rhr: 67, baseRhr: 60, hrv: 39, baseHrv: 50 });
    expect(illnessWarning(daily.map((x) => ({ ...x, restingHr: 60, hrvMs: 50 })), NOW, S)).toBeNull();
  });
  it('days to recover after alcohol', () => {
    const daily: DailyHealth[] = [], cis: CheckIn[] = [];
    for (let i = 60; i >= 0; i--) daily.push(base(i, { hrvMs: [40, 39].includes(i) ? 35 : [20, 19].includes(i) ? 36 : 50 }));
    cis.push(ci(at(41, 20), { chips: ['Alcohol'] }), ci(at(21, 20), { chips: ['Alcohol'] }));
    const r = recoveryTimes({ daily, checkIns: cis, workouts: [], doses: [], meds: [] }, NOW, S);
    expect(r[0]).toMatchObject({ kind: 'alcohol', days: 3, events: 2 });
  });
});

describe('body', () => {
  it('fluids after a shot, training and a stimulant', () => {
    const w: Workout[] = [{ id: 'w', startedAt: iso(at(0, 7)), sets: [], source: 'manual', ...st }];
    const f = fluids([reta, ritalin], [dose('g', at(1, 8), 1), dose('r', at(0, 8), 10)], w, [], [{ id: 'x', date: ymd(at(0)), waterMl: 800, ...st }], 2500, NOW, S);
    expect(f.ml).toBe(3750);
    expect(f.electrolytes).toBe(true);
    expect(f.low).toBe(true);
  });
  it('muscle protection', () => {
    const body: BodyEntry[] = [{ id: 'a', date: ymd(at(21)), weightKg: 100, ...st }, { id: 'b', date: ymd(at(0)), weightKg: 97, ...st }];
    const daily: DailyHealth[] = [1, 2, 3, 4].map((i) => ({ id: `p${i}`, date: ymd(at(i)), proteinG: 160, ...st }));
    const w: Workout[] = [1, 4, 8, 11].map((i) => ({ id: `w${i}`, startedAt: iso(at(i, 7)), sets: [{ id: 's', exerciseId: 'squat', weightKg: 60, reps: 8, done: true }], source: 'manual', ...st }));
    const m = muscleScore(body, daily, w, 160, NOW)!;
    expect(m.score).toBe(100);
    expect(muscleScore(body, [], [], 160, NOW)!.score).toBeLessThan(60);
  });
  it('gut and appetite by days since a shot', () => {
    const doses: Dose[] = [], cis: CheckIn[] = [];
    for (let k = 0; k < 6; k++) {
      const t = at(3 + k * 7, 8); doses.push(dose('g', t, 1));
      for (let d = 0; d < 7; d++) cis.push(ci(t + d * DAY + 10 * HOUR, { chips: d === 1 ? ['Nausea'] : d === 4 ? ['Constipation'] : [], appetite: d < 3 ? 1 : 4 }));
    }
    const weekly = med({ ...reta, schedule: { type: 'fixed', slots: [{ time: '08:00' }], days: [new Date(at(3)).getDay()] } });
    const g = gutByShotDay(weekly, doses, cis, NOW)!;
    expect(g[1].chips[0]).toEqual({ chip: 'Nausea', pct: 100 });
    expect(g[4].chips[0].chip).toBe('Constipation');
    const a = appetiteAhead(weekly, doses, cis, at(1, 9));
    expect(a?.day).toBe(3);
  });
  it('year in review', () => {
    const y = yearReview({ meds: [ritalin], doses: [dose('r', at(5), 10), dose('r', at(4), 10)], body: [{ id: 'a', date: ymd(at(200)), weightKg: 110, ...st }, { id: 'b', date: ymd(at(1)), weightKg: 95, ...st }],
      daily: [], checkIns: [ci(at(2), { chips: ['Focus'] })], workouts: [], labs: [] }, NOW);
    expect(y.doses[0].taken).toBe(2);
    expect(y.weight).toMatchObject({ from: 110, to: 95 });
    expect(y.topChips[0].chip).toBe('Focus');
  });
});
