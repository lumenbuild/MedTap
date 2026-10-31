import { describe, it, expect } from 'vitest';
import type { CheckIn, DailyHealth, Dose, Medication } from '../src/db/schema';
import type { ScheduleSettings } from '../src/logic/schedule';
import { watchExtras, type WatchInput } from '../src/logic/watch';

const S: ScheduleSettings = { dayStartsAt: '04:00', tz: Intl.DateTimeFormat().resolvedOptions().timeZone, guardMinutes: 10 };
const NOW = new Date(2026, 9, 31, 12, 0).getTime();
const at = (h: number, m = 0) => new Date(2026, 9, 31, h, m).getTime();
const rit = { id: 'r', name: 'Ritalin', strength: 10, unit: 'mg', form: 'tablet', defaultAmount: 10, schedule: { type: 'fixed', slots: [{ time: '07:00' }, { time: '11:30' }, { time: '15:00' }] }, archived: false } as Medication;
const dose = (id: string, t: number, o: Partial<Dose> = {}): Dose => ({ id, medicationId: 'r', takenAt: new Date(t).toISOString(), amount: 10, source: 'manual', createdAt: '', updatedAt: '', ...o });
const base = (o: Partial<WatchInput> = {}): WatchInput => ({ meds: [rit], doses: [], checkIns: [], daily: [], nameOf: (m) => m.name, remindersOnWatch: true, snoozeMin: 15,
  sleepTools: false, sleepTargetH: 8, caffeineLimitMg: 400, caffeineHalfLifeH: 5, waterTarget: 2000, waterAdd: 250, peptides: false, ...o });

describe('watch extras', () => {
  it('today’s doses, each with where it stands', () => {
    const w = watchExtras(base({ doses: [dose('a', at(7, 5))] }), NOW, S);
    expect(w.doses.map((d) => [d.at, d.state])).toEqual([[at(7), 'done'], [at(11, 30), 'due'], [at(15), 'later']]);
    expect(w.doses[0].amount).toBe('10 mg');
  });
  it('the watch’s own reminders: the next day’s set times, only when turned on', () => {
    const w = watchExtras(base(), NOW, S);
    expect(w.reminders.map((r) => r.at)).toContain(at(15));
    expect(w.reminders.every((r) => r.at < NOW + 24 * 3_600_000 && r.name === 'Ritalin')).toBe(true);
    expect(watchExtras(base({ remindersOnWatch: false }), NOW, S).reminders).toEqual([]);
  });
  it('a heart-rate check after a recent stimulant dose, not a skipped one', () => {
    const w = watchExtras(base({ doses: [dose('a', at(11, 20)), dose('b', at(7), { skipped: true })] }), NOW, S);
    expect(w.hr).toEqual([{ doseId: 'a', name: 'Ritalin', at: at(11, 20) }]);
  });
  it('caffeine today and water', () => {
    const ci = { id: 'c', at: new Date(at(8)).toISOString(), chips: ['Caffeine'], caffeineMg: 95, note: 'Coffee', createdAt: '', updatedAt: '' } as CheckIn;
    const day = { id: 'd', date: '2026-10-31', waterMl: 750, createdAt: '', updatedAt: '' } as DailyHealth;
    const w = watchExtras(base({ checkIns: [ci], daily: [day] }), NOW, S);
    expect(w.drinks).toMatchObject({ caffeineMg: 95, waterMl: 750, waterTarget: 2000, waterAdd: 250 });
    expect(w.drinks.caffeineNow).toBeGreaterThan(40);
  });
  it('sleep: bedtime tonight in the evening, and asks how you slept until answered', () => {
    const daily: DailyHealth[] = Array.from({ length: 8 }, (_, i) => {
      const end = new Date(2026, 9, 30 - i, 7, 0).getTime();
      return { id: `n${i}`, date: new Date(end).toISOString().slice(0, 10), sleepMin: 480, sleepStart: end - 8 * 3_600_000, sleepEnd: end, createdAt: '', updatedAt: '' } as DailyHealth;
    });
    const w = watchExtras(base({ sleepTools: true, daily }), NOW, S);
    expect(w.sleep?.bedtime).toBe(at(22, 45));
    expect(w.sleep?.windDown).toBe(at(22));
    expect(w.sleep?.ask).toBe(true);
    const answered = watchExtras(base({ sleepTools: true, daily, checkIns: [{ id: 'q', at: new Date(at(8)).toISOString(), chips: [], sleepQuality: 4, createdAt: '', updatedAt: '' } as CheckIn] }), NOW, S);
    expect(answered.sleep?.ask).toBe(false);
  });
});
