import { describe, it, expect } from 'vitest';
import type { Dose, Medication } from '../src/db/schema';
import {
  getContextNotes, getDayBounds, getDosesToday, getFixedSlots, getLastDose, getNextDue, getRecentDose, getStatus,
  byUrgency, type ScheduleSettings,
} from '../src/logic/schedule';
import { zonedToUtc } from '../src/logic/tz';

const TZ = 'Australia/Sydney';
const S: ScheduleSettings = { dayStartsAt: '04:00', tz: TZ, guardMinutes: 10 };
const H = 3_600_000;

/** Sydney wall-clock time → UTC ms */
const syd = (date: string, time: string) => {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return zonedToUtc(y, m, d, h, mi, TZ);
};

const med = (over: Partial<Medication> = {}): Medication => ({
  id: 'm1', name: 'Stim', strength: 10, unit: 'mg', form: 'tablet', defaultAmount: 10,
  schedule: { type: 'interval', intervalHours: 4, maxPerDay: 3 }, color: '#0B7A75', icon: 'pill', archived: false,
  createdAt: '', updatedAt: '', ...over,
});

let n = 0;
const dose = (ms: number, over: Partial<Dose> = {}): Dose => ({
  id: `d${++n}`, medicationId: 'm1', takenAt: new Date(ms).toISOString(), amount: 10, source: 'tag',
  createdAt: '', updatedAt: '', ...over,
});

describe('tz helpers', () => {
  it('converts Sydney wall-clock to UTC in both standard and daylight time', () => {
    expect(new Date(syd('2026-07-01', '09:00')).toISOString()).toBe('2026-06-30T23:00:00.000Z'); // AEST +10
    expect(new Date(syd('2026-12-01', '09:00')).toISOString()).toBe('2026-11-30T22:00:00.000Z'); // AEDT +11
  });
});

describe('4-hour interval schedule', () => {
  const day = '2026-07-15';
  const doses = [dose(syd(day, '07:00')), dose(syd(day, '11:05')), dose(syd(day, '15:10'))];

  it('counts today and finds next due after two doses', () => {
    const now = syd(day, '12:00');
    expect(getDosesToday(doses, 'm1', now, S)).toHaveLength(2);
    expect(getNextDue(med(), doses, now, S)).toBe(syd(day, '15:05'));
    expect(getStatus(med(), doses, now, S)).toBe('not-due');
    expect(getStatus(med(), doses, syd(day, '15:06'), S)).toBe('due');
  });

  it('is done for the day after the third dose', () => {
    const now = syd(day, '15:30');
    expect(getDosesToday(doses, 'm1', now, S)).toHaveLength(3);
    expect(getNextDue(med(), doses, now, S)).toBeNull(); // nothing more planned today
    expect(getStatus(med(), doses, now, S)).toBe('done-today');
  });

  it('reports no doses yet today before the first one', () => {
    const now = syd(day, '06:00');
    expect(getNextDue(med(), doses, now, S)).toBeNull();
    expect(getStatus(med(), doses, now, S)).toBe('none-today');
  });

  it('notes when past the latest dose time', () => {
    const m = med({ schedule: { type: 'interval', intervalHours: 4, latestDoseTime: '16:00' } });
    const two = doses.slice(0, 2);
    expect(getStatus(m, two, syd(day, '15:59'), S)).toBe('due');
    expect(getStatus(m, two, syd(day, '16:01'), S)).toBe('past-latest-time');
    expect(getContextNotes(m, two, syd(day, '16:30'), S)).toContainEqual({ kind: 'past-latest', latestDoseTime: '16:00' });
  });
});

describe('day boundary', () => {
  it('counts a 01:30 dose towards the previous day when the day starts at 04:00', () => {
    const late = dose(syd('2026-07-16', '01:30'));
    expect(getDosesToday([late], 'm1', syd('2026-07-16', '02:00'), S)).toHaveLength(1);
    expect(getDosesToday([late], 'm1', syd('2026-07-16', '09:00'), S)).toHaveLength(0);
    const b = getDayBounds(syd('2026-07-16', '01:30'), '04:00', TZ);
    expect(b.start).toBe(syd('2026-07-15', '04:00'));
    expect(b.end).toBe(syd('2026-07-16', '04:00'));
  });

  it('uses midnight when the day starts at 00:00', () => {
    const late = dose(syd('2026-07-16', '01:30'));
    expect(getDosesToday([late], 'm1', syd('2026-07-16', '09:00'), { ...S, dayStartsAt: '00:00' })).toHaveLength(1);
  });
});

describe('Sydney daylight saving', () => {
  // 2026: clocks go back Sun 5 April 03:00 → 02:00, forward Sun 4 October 02:00 → 03:00.
  it('computes intervals in real elapsed hours across the October change (clocks forward)', () => {
    const d = dose(syd('2026-10-04', '00:30'));
    const next = getNextDue(med(), [d], syd('2026-10-04', '01:00'), { ...S, dayStartsAt: '00:00' })!;
    expect(next - Date.parse(d.takenAt)).toBe(4 * H);
    expect(next).toBe(syd('2026-10-04', '05:30')); // wall clock shows 5 hours later
  });

  it('computes intervals in real elapsed hours across the April change (clocks back)', () => {
    const d = dose(syd('2026-04-05', '00:30'));
    const next = getNextDue(med(), [d], syd('2026-04-05', '01:00'), { ...S, dayStartsAt: '00:00' })!;
    expect(next - Date.parse(d.takenAt)).toBe(4 * H);
    expect(next).toBe(syd('2026-04-05', '03:30')); // wall clock shows 3 hours later
  });

  it('gives a 23-hour day before the forward change and a 25-hour day before the back change', () => {
    const fwd = getDayBounds(syd('2026-10-03', '12:00'), '04:00', TZ);
    expect(fwd.end - fwd.start).toBe(23 * H);
    expect(fwd.end).toBe(syd('2026-10-04', '04:00'));
    const back = getDayBounds(syd('2026-04-04', '12:00'), '04:00', TZ);
    expect(back.end - back.start).toBe(25 * H);
  });

  it('elapsed-time notes use real hours across the change', () => {
    const d = dose(syd('2026-10-04', '01:30'));
    const notes = getContextNotes(med(), [d], syd('2026-10-04', '04:30'), { ...S, dayStartsAt: '00:00' });
    expect(notes).toContainEqual({ kind: 'interval', elapsedMs: 2 * H, intervalHours: 4 });
  });
});

describe('double-tap guard', () => {
  const t = syd('2026-07-15', '14:14');
  const d = dose(t);
  it('catches a second log inside the window', () => {
    expect(getRecentDose([d], 'm1', t + 9 * 60_000, 10)?.id).toBe(d.id);
  });
  it('lets a log through after the window', () => {
    expect(getRecentDose([d], 'm1', t + 10 * 60_000, 10)).toBeUndefined();
  });
  it('ignores deleted doses and other medications', () => {
    expect(getRecentDose([{ ...d, deletedAt: 'x' }], 'm1', t + 60_000, 10)).toBeUndefined();
    expect(getRecentDose([{ ...d, medicationId: 'm2' }], 'm1', t + 60_000, 10)).toBeUndefined();
  });
});

describe('backdated doses', () => {
  it('reorder correctly and update the last dose', () => {
    const day = '2026-07-15';
    const a = dose(syd(day, '07:00'));
    const b = dose(syd(day, '15:00'));
    const backdated = dose(syd(day, '11:00'), { source: 'backdated' });
    const all = [a, b, backdated];
    expect(getDosesToday(all, 'm1', syd(day, '16:00'), S).map((x) => x.id)).toEqual([a.id, backdated.id, b.id]);
    expect(getLastDose(all, 'm1')?.id).toBe(b.id);
    // A dose logged "earlier" that is actually the latest becomes the last dose.
    const later = dose(syd(day, '15:30'), { source: 'backdated' });
    expect(getLastDose([...all, later], 'm1')?.id).toBe(later.id);
    const uncapped = med({ schedule: { type: 'interval', intervalHours: 4 } });
    expect(getNextDue(uncapped, [...all, later], syd(day, '16:00'), S)).toBe(syd(day, '19:30'));
  });

  it('context notes look back from the chosen time, not now', () => {
    const day = '2026-07-15';
    const a = dose(syd(day, '07:00'));
    expect(getContextNotes(med(), [a], syd(day, '09:00'), S)).toEqual([{ kind: 'interval', elapsedMs: 2 * H, intervalHours: 4 }]);
    expect(getContextNotes(med(), [a], syd(day, '11:00'), S)).toEqual([]);
  });
});

describe('daily count note', () => {
  it('says which dose this would be when the daily target is reached', () => {
    const day = '2026-07-15';
    const doses = ['07:00', '11:00', '15:00'].map((t) => dose(syd(day, t)));
    expect(getContextNotes(med(), doses, syd(day, '19:30'), S)).toEqual([{ kind: 'count', doseNumber: 4, target: 3 }]);
  });
});

describe('set-times schedule', () => {
  const m = med({ schedule: { type: 'fixed', times: ['08:00', '12:00', '16:00'] } });
  const day = '2026-07-15';

  it('counts down to the first set time with no doses', () => {
    expect(getNextDue(m, [], syd(day, '06:00'), S)).toBe(syd(day, '08:00'));
    expect(getStatus(m, [], syd(day, '06:00'), S)).toBe('none-today');
    expect(getStatus(m, [], syd(day, '08:10'), S)).toBe('due');
  });

  it('matches doses within an hour of a set time and moves on', () => {
    const doses = [dose(syd(day, '08:40'))];
    expect(getFixedSlots(m, doses, syd(day, '09:00'), S).map((s) => !!s.dose)).toEqual([true, false, false]);
    expect(getNextDue(m, doses, syd(day, '09:00'), S)).toBe(syd(day, '12:00'));
    expect(getStatus(m, doses, syd(day, '09:00'), S)).toBe('not-due');
  });

  it('is done after all set times are covered', () => {
    const doses = ['08:00', '12:05', '15:50'].map((t) => dose(syd(day, t)));
    expect(getStatus(m, doses, syd(day, '17:00'), S)).toBe('done-today');
  });

  it('is past the latest time when a set time was missed and none remain', () => {
    const doses = ['08:00', '12:05'].map((t) => dose(syd(day, t)));
    expect(getStatus(m, doses, syd(day, '17:30'), S)).toBe('past-latest-time');
  });
});

describe('as-needed', () => {
  it('has no countdown', () => {
    const m = med({ schedule: { type: 'prn' } });
    expect(getNextDue(m, [dose(syd('2026-07-15', '09:00'))], syd('2026-07-15', '10:00'), S)).toBeNull();
  });
});

describe('urgency order', () => {
  it('puts due first and done last', () => {
    const day = '2026-07-15';
    const done = med({ id: 'a', name: 'A', schedule: { type: 'interval', intervalHours: 4, maxPerDay: 1 } });
    const due = med({ id: 'b', name: 'B' });
    const doses = [dose(syd(day, '07:00'), { medicationId: 'a' }), dose(syd(day, '07:00'), { medicationId: 'b' })];
    expect(byUrgency([done, due], doses, syd(day, '12:00'), S).map((x) => x.id)).toEqual(['b', 'a']);
  });
});
