import { describe, it, expect } from 'vitest';
import type { Dose, Medication } from '../src/db/schema';
import { nextUp, type ScheduleSettings } from '../src/logic/schedule';

const S: ScheduleSettings = { dayStartsAt: '04:00', tz: 'Australia/Sydney', guardMinutes: 10 };
const st = { createdAt: '', updatedAt: '' };
const local = (d: string, hm: string) => new Date(`${d}T${hm}:00+11:00`).getTime(); // Sydney in daylight saving
const med = (id: string, o: Partial<Medication>): Medication => ({ id, name: id, strength: 10, unit: 'mg', form: 'tablet', defaultAmount: 10, color: '', icon: 'pill', archived: false, ...st,
  schedule: { type: 'fixed', slots: [{ time: '08:00' }] }, ...o });
const dose = (medicationId: string, t: number): Dose => ({ id: `${medicationId}${t}`, medicationId, takenAt: new Date(t).toISOString(), amount: 10, source: 'manual', ...st });

// Fri 23 Oct 2026, 3 pm. Vyvanse 7:30 am daily (taken), Dex 8 am daily (taken), Tirzepatide Thursdays 8 am, Melatonin 9 pm.
const NOW = local('2026-10-23', '15:00');
const vyv = med('Vyvanse', { schedule: { type: 'fixed', slots: [{ time: '07:30' }] } });
const dex = med('Dex', {});
const tirz = med('Tirzepatide', { form: 'injection', schedule: { type: 'fixed', slots: [{ time: '08:00' }], days: [4] }, peptide: { waterMl: 2, syringe: 'U-100', syringeUnits: 50 } });
const mel = med('Melatonin', { schedule: { type: 'fixed', slots: [{ time: '21:00' }] } });
const taken = [dose('Vyvanse', local('2026-10-23', '07:31')), dose('Dex', local('2026-10-23', '08:02'))];

describe("Today's next dose", () => {
  it('is the soonest one, not a weekly injection days away', () => {
    const r = nextUp([tirz, vyv, dex, mel], taken, NOW, S);
    expect(r.meds.map((m) => m.id)).toEqual(['Melatonin']);
    expect(r.at).toBe(local('2026-10-23', '21:00'));
    expect(r.due).toBe(false);
  });
  it('after tonight: tomorrow 7:30 am', () => {
    const r = nextUp([tirz, vyv, dex, mel], [...taken, dose('Melatonin', local('2026-10-23', '21:05'))], local('2026-10-23', '22:00'), S);
    expect(r.meds.map((m) => m.id)).toEqual(['Vyvanse']);
    expect(r.at).toBe(local('2026-10-24', '07:30'));
  });
  it('groups everything due at the same time', () => {
    const vyv8 = med('Vyvanse', {});
    const r = nextUp([vyv8, dex, mel], [], local('2026-10-24', '06:00'), S);
    expect(r.meds.map((m) => m.id)).toEqual(['Dex', 'Vyvanse']);
  });
  it('everything due now comes first, oldest first', () => {
    const r = nextUp([tirz, vyv, dex, mel], [], local('2026-10-24', '08:15'), S);
    expect(r.due).toBe(true);
    expect(r.meds.map((m) => m.id)).toEqual(['Vyvanse', 'Dex']);
  });
  it("on injection day, the shot joins the 8 am group", () => {
    const r = nextUp([tirz, vyv, dex, mel], [], local('2026-10-29', '07:45'), S);
    expect(r.meds.map((m) => m.id)).toEqual(['Vyvanse']);
    const r2 = nextUp([tirz, vyv, dex, mel], [dose('Vyvanse', local('2026-10-29', '07:40'))], local('2026-10-29', '07:50'), S);
    expect(r2.meds.map((m) => m.id)).toEqual(['Dex', 'Tirzepatide']);
  });
  it('an every-few-hours medicine not started today is due now', () => {
    const rit = med('Ritalin', { schedule: { type: 'interval', intervalHours: 4, maxPerDay: 3 } });
    const r = nextUp([rit, mel], [], local('2026-10-24', '09:00'), S);
    expect(r.due).toBe(true);
    expect(r.meds.map((m) => m.id)).toEqual(['Ritalin']);
  });
  it('nothing planned: empty', () => {
    expect(nextUp([med('Panadol', { schedule: { type: 'prn' } })], [], NOW, S).meds).toEqual([]);
  });
});
