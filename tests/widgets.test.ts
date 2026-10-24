import { describe, it, expect } from 'vitest';
import type { BodyEntry, DailyHealth, Dose, Medication } from '../src/db/schema';
import type { ScheduleSettings } from '../src/logic/schedule';
import { widgetsPayload, type WidgetsInput } from '../src/logic/widgets';

const S: ScheduleSettings = { dayStartsAt: '04:00', tz: 'Australia/Sydney', guardMinutes: 10 };
const DAY = 86_400_000;
const NOW = new Date(2026, 9, 23, 15, 0).getTime();
const at = (daysAgo: number, h = 12) => { const d = new Date(NOW - daysAgo * DAY); d.setHours(h, 0, 0, 0); return d.getTime(); };
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const st = { createdAt: '', updatedAt: '' };
const med = (o: Partial<Medication>): Medication => ({ id: 'm', name: 'Vyvanse', strength: 50, unit: 'mg', form: 'capsule', defaultAmount: 50, schedule: { type: 'fixed', times: ['07:00'] } as Medication['schedule'], color: '', icon: 'pill', archived: false, ...st, ...o });
const dose = (medicationId: string, t: number, amount: number): Dose => ({ id: `${medicationId}${t}`, medicationId, takenAt: new Date(t).toISOString(), amount, source: 'manual', ...st });

const base = (o: Partial<WidgetsInput> = {}): WidgetsInput => ({
  app: 'MedTap', meds: [], doses: [], checkIns: [], body: [], daily: [], workouts: [], events: [], own: [], goals: [], units: 'metric',
  proteinTarget: 140, waterTarget: 2500, body_: true, training: true, peptides: true, ...o,
});

describe('widgets payload', () => {
  const vy = med({});
  const morning = med({ id: 'n', name: 'Sertraline', schedule: { type: 'fixed', times: ['20:00'] } as Medication['schedule'] });
  const prn = med({ id: 'p', name: 'Paracetamol', schedule: { type: 'prn' } as Medication['schedule'] });
  it('counts today, keeps the original next-dose fields and builds the quick buttons', () => {
    const p = widgetsPayload(base({ meds: [vy, morning, prn], doses: [dose('m', at(0, 7), 50)] }), NOW, S);
    expect(p.v).toBe(2);
    expect(p.total).toBe(2);
    expect(p.done).toBe(1);
    // Vyvanse is taken and Sertraline's 8 pm has passed: next is tomorrow morning's Vyvanse (as on Today).
    expect(p.title).toBe('Vyvanse');
    expect(p.quick.map((q) => q.label)).toEqual(['Paracetamol', 'Coffee', 'Alcohol', 'Check in']);
    expect(p.quick[0]).toMatchObject({ kind: 'dose', id: 'p' });
    expect(p.glance.next).toMatch(/Vyvanse/);
  });
  it('protein and water today, weight weekly averages with a forecast', () => {
    const daily: DailyHealth[] = [{ id: 'd', date: ymd(NOW), proteinG: 60, waterMl: 1250, steps: 8421, ...st }];
    const body: BodyEntry[] = Array.from({ length: 50 }, (_, k) => ({ id: `b${k}`, date: ymd(at(k, 8)), weightKg: 90 + k * 0.05, ...st }));
    const p = widgetsPayload(base({ daily, body, goals: [{ id: 'g', metric: 'weightKg', target: 85, start: 92.5, startDate: ymd(at(50)), createdAt: '' } as WidgetsInput['goals'][number]] }), NOW, S);
    expect(p.intake).toMatchObject({ protein: 60, proteinTarget: 140, water: 1250, waterTarget: 2500 });
    expect(p.weight!.points.length).toBeGreaterThanOrEqual(7);
    expect(p.weight!.points[p.weight!.points.length - 1]).toBeLessThan(p.weight!.points[0]);
    expect(p.glance.steps).toBe('8,421 steps');
  });
  it('TapDose: no body or injection sections', () => {
    const pep = med({ id: 't', name: 'Mounjaro', peptide: { waterMl: 0, syringe: 'U-100', syringeUnits: 50 } as Medication['peptide'], schedule: { type: 'interval', everyDays: 7, time: '08:00' } as unknown as Medication['schedule'] });
    const p = widgetsPayload(base({ meds: [vy, pep], body_: false, training: false, peptides: false, daily: [{ id: 'd', date: ymd(NOW), proteinG: 60, ...st }] }), NOW, S);
    expect(p.shot).toBeUndefined();
    expect(p.intake).toBeUndefined();
    expect(p.weight).toBeUndefined();
    expect(p.training).toBeUndefined();
  });
});
