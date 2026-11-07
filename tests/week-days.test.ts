import { describe, it, expect } from 'vitest';
import type { CheckIn, DailyHealth, Dose, Medication } from '../src/db/schema';
import { weekDays } from '../src/logic/weekDays';
import type { ScheduleSettings } from '../src/logic/schedule';

const S: ScheduleSettings = { dayStartsAt: '04:00', tz: 'Australia/Sydney', guardMinutes: 10 };
const st = { createdAt: '2026-01-01T00:00:00Z', updatedAt: '' };
const at = (d: string, hm: string) => new Date(`${d}T${hm}:00+11:00`).toISOString(); // Sydney, daylight time
const med: Medication = { id: 'v', name: 'Vyvanse', strength: 50, unit: 'mg', form: 'capsule', defaultAmount: 50, schedule: { type: 'fixed', slots: [{ time: '07:30' }, { time: '12:00' }] }, color: '', icon: 'pill', archived: false, ...st };
let n = 0;
const dose = (d: string, hm: string, o: Partial<Dose> = {}): Dose => ({ id: `d${++n}`, medicationId: 'v', takenAt: at(d, hm), amount: 50, source: 'tag', ...st, ...o });

describe('weekDays', () => {
  const from = '2026-11-02'; // Mon
  it('doses taken against planned, per day; skipped and deleted do not count; a 2 am dose belongs to the day before', () => {
    const doses = [dose('2026-11-02', '07:30'), dose('2026-11-02', '12:00'), dose('2026-11-03', '07:30'), dose('2026-11-03', '12:00', { skipped: true }),
      dose('2026-11-04', '07:30', { deletedAt: 'x' }), dose('2026-11-05', '02:00')];
    const r = weekDays({ meds: [med], doses, checkIns: [], body: [], daily: [] }, from, S);
    expect(r.days).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
    const d = r.rows.find((x) => x.key === 'doses')!;
    expect(d.counts!.slice(0, 4)).toEqual([{ taken: 2, planned: 2 }, { taken: 1, planned: 2 }, { taken: 1, planned: 2 }, { taken: 0, planned: 2 }]);
    expect(d.values.slice(0, 4)).toEqual([1, 0.5, 0.5, 0]);
  });
  it('weight, sleep (watch first, else the morning check-in), steps and mood, with the week before to compare', () => {
    const body = [{ id: 'b1', date: '2026-11-03', weightKg: 90.4, ...st }, { id: 'b0', date: '2026-10-27', weightKg: 91.0, ...st }];
    const daily: DailyHealth[] = [{ id: 'h1', date: '2026-11-02', sleepMin: 420, steps: 8000, ...st }, { id: 'h0', date: '2026-10-28', sleepMin: 360, ...st }];
    const checkIns: CheckIn[] = [{ id: 'c1', at: at('2026-11-04', '07:00'), sleepHours: 6.5, chips: [], mood: 4, ...st }, { id: 'c2', at: at('2026-11-04', '20:00'), chips: [], mood: 2, ...st }];
    const r = weekDays({ meds: [], doses: [], checkIns, body, daily }, from, S);
    const get = (k: string) => r.rows.find((x) => x.key === k)!;
    expect(get('weight').values[1]).toBe(90.4);
    expect(get('weight').prevAvg).toBe(91.0);
    expect(get('sleep').values.slice(0, 3)).toEqual([7, null, 6.5]);
    expect(get('sleep').prevAvg).toBe(6);
    expect(get('steps').values[0]).toBe(8000);
    expect(get('mood').values[2]).toBe(3);
    expect(r.rows.some((x) => x.key === 'doses')).toBe(false);
  });
  it('leaves out a measure with nothing this week', () => {
    expect(weekDays({ meds: [], doses: [], checkIns: [], body: [], daily: [] }, from, S).rows).toEqual([]);
  });
});
