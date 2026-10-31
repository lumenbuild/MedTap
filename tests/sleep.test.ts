import { describe, it, expect } from 'vitest';
import type { CheckIn, DailyHealth, Dose, Medication } from '../src/db/schema';
import type { ScheduleSettings } from '../src/logic/schedule';
import { bedtimeTonight, consistency, fmtHM, nightsOf, sleepDebt, sleepFactors, sleepScore, usualNight } from '../src/logic/sleep';

const S: ScheduleSettings = { dayStartsAt: '04:00', tz: Intl.DateTimeFormat().resolvedOptions().timeZone, guardMinutes: 10 };
const DAY = 86_400_000;
const NOW = new Date(2026, 9, 31, 12, 0).getTime();
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** The night ending the morning `k` days ago: asleep at bedH (previous evening), awake at wakeH. */
const night = (k: number, o: Partial<DailyHealth> & { bedH?: number; wakeH?: number } = {}): DailyHealth => {
  const morning = new Date(NOW - k * DAY); morning.setHours(o.wakeH ?? 7, 0, 0, 0);
  const bed = new Date(morning.getTime()); bed.setDate(bed.getDate() - 1); bed.setHours(o.bedH ?? 23, 0, 0, 0);
  const { bedH, wakeH, ...rest } = o; void bedH; void wakeH;
  return { id: `n${k}`, date: ymd(morning.getTime()), sleepMin: 450, sleepDeepMin: 70, sleepRemMin: 95, sleepAwakeMin: 30, sleepWakes: 2, sleepStart: bed.getTime(), sleepEnd: morning.getTime(), hrvMs: 50, restingHr: 58, createdAt: '', updatedAt: '', ...rest };
};

describe('sleep', () => {
  it('reads the nights with stages and how unbroken they were', () => {
    const [n] = nightsOf([night(1)], NOW);
    expect(n).toMatchObject({ asleep: 450, deep: 70, rem: 95, light: 285, awake: 30 });
    expect(n.efficiency).toBeCloseTo(450 / 480);
  });
  it('one night a date: the watch’s record wins over a hand entry', () => {
    const watch = night(1), hand = { ...night(1, { sleepMin: 300 }), id: 'h', sleepStart: undefined, sleepEnd: undefined };
    expect(nightsOf([hand, watch], NOW)).toHaveLength(1);
    expect(nightsOf([hand, watch], NOW)[0].asleep).toBe(450);
    // Debt counts 7 nights at most.
    const d = sleepDebt(nightsOf(Array.from({ length: 10 }, (_, i) => night(i, { sleepMin: 420 })), NOW), 480, NOW)!;
    expect(d.nights).toBe(7);
  });
  it('a sleep score from its parts, against your usual', () => {
    const ns = nightsOf(Array.from({ length: 20 }, (_, i) => night(i + 2)).concat(night(1, { sleepMin: 300, sleepDeepMin: 30, sleepRemMin: 40, sleepAwakeMin: 90, hrvMs: 35, restingHr: 66, bedH: 1 })), NOW);
    const usual = usualNight(ns, S, ns[ns.length - 1].date)!;
    expect(usual).toMatchObject({ asleep: 450, hrv: 50, rhr: 58 });
    const good = sleepScore(ns[ns.length - 2], 480, usual, S);
    const bad = sleepScore(ns[ns.length - 1], 480, usual, S);
    expect(good.score).toBeGreaterThan(85);
    expect(bad.score).toBeLessThan(50);
    expect(bad.word).toBe('Poor');
    expect(bad.parts.map((p) => p.key)).toEqual(['duration', 'stages', 'continuity', 'timing', 'recovery']);
    expect(bad.parts.find((p) => p.key === 'timing')!.note).toMatch(/120 min later/);
    // No stages or awake time: those parts are left out and the rest scaled to 100.
    const plain = sleepScore({ date: '2026-10-30', asleep: 480 }, 480, undefined, S);
    expect(plain.parts.map((p) => p.key)).toEqual(['duration']);
    expect(plain.score).toBe(100);
  });
  it('consistency, social jet lag and sleep debt', () => {
    const rows = Array.from({ length: 14 }, (_, i) => {
      const k = i + 1, wd = new Date(NOW - k * DAY).getDay();
      return [0, 6].includes(wd) ? night(k, { bedH: 1, wakeH: 9, sleepMin: 480 }) : night(k, { sleepMin: 400 });
    });
    const ns = nightsOf(rows, NOW);
    const c = consistency(ns, S)!;
    expect(c.socialJetLag).toBe(120); // the middle of sleep moves 2 hours on weekends
    expect(c.word).not.toBe('Steady');
    const steady = consistency(nightsOf(Array.from({ length: 10 }, (_, i) => night(i + 1)), NOW), S)!;
    expect(steady).toMatchObject({ word: 'Steady', bedSd: 0, socialJetLag: 0 });
    const d = sleepDebt(nightsOf(Array.from({ length: 7 }, (_, i) => night(i + 1, { sleepMin: 420 })), NOW), 480, NOW)!;
    expect(d.minutes).toBe(60 * 7); // 7 nights, each an hour short
  });
  it('finds what goes with worse sleep: a late stimulant dose', () => {
    const daily: DailyHealth[] = [], doses: Dose[] = [];
    const rit = { id: 'r', name: 'Ritalin', strength: 10, unit: 'mg', form: 'tablet', defaultAmount: 10, schedule: { type: 'fixed', slots: [{ time: '07:00' }] }, archived: false } as Medication;
    for (let k = 1; k <= 24; k++) {
      const late = k % 2 === 0;
      const day = new Date(NOW - (k + 1) * DAY); day.setHours(late ? 16 : 8, 0, 0, 0);
      doses.push({ id: `d${k}`, medicationId: 'r', takenAt: day.toISOString(), amount: 10, source: 'manual', createdAt: '', updatedAt: '' });
      daily.push(night(k, late ? { sleepMin: 380, sleepDeepMin: 45 } : {}));
    }
    const f = sleepFactors(nightsOf(daily, NOW), { doses, meds: [rit], checkIns: [] as CheckIn[], workouts: [], daily }, 480, S);
    expect(f[0]).toMatchObject({ key: 'late-stimulant', on: 12, off: 12, asleepDiff: -70, deepDiff: -25, certainty: 'Likely' });
    expect(f[0].scoreDiff).toBeLessThan(-4);
  });
  it('a bedtime for tonight', () => {
    const b = bedtimeTonight({ usualWake: 7 * 60, targetMin: 480 });
    expect(b.bedtime).toBe(22 * 60 + 45); // 10:45 pm: 8 h + 15 min before 7 am
    expect(b.windDown).toBe(22 * 60);
    const behind = bedtimeTonight({ usualWake: 7 * 60, targetMin: 480, debtMin: 180, lateStimulant: 'Late dose' });
    expect(behind.bedtime).toBe(22 * 60 + 15);
    expect(behind.notes).toEqual([`Half an hour earlier than usual: you’re ${fmtHM(180)} behind this week.`, 'Late dose']);
  });
});
