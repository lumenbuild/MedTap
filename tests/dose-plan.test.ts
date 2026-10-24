import { describe, it, expect } from 'vitest';
import type { CheckIn, Dose, Medication } from '../src/db/schema';
import { getNextDue, isScheduledDay, type ScheduleSettings } from '../src/logic/schedule';
import { dosesPerWeek, planLine, restartPrompt, stepAmount, stepStatus } from '../src/logic/dosePlan';
import { fmtSchedule } from '../src/logic/format';

const S: ScheduleSettings = { dayStartsAt: '04:00', tz: 'Australia/Sydney', guardMinutes: 10 };
const DAY = 86_400_000;
const NOW = new Date(2026, 9, 23, 15, 0).getTime(); // Fri 23 Oct 2026, 3 pm
const at = (daysAgo: number, h = 12) => { const d = new Date(NOW - daysAgo * DAY); d.setHours(h, 0, 0, 0); return d.getTime(); };
const iso = (t: number) => new Date(t).toISOString();
const st = { createdAt: '', updatedAt: '' };
const dose = (medicationId: string, t: number, amount: number): Dose => ({ id: `${medicationId}${t}`, medicationId, takenAt: iso(t), amount, source: 'manual', ...st });
const ci = (t: number, o: Partial<CheckIn>): CheckIn => ({ id: `c${t}${Math.random()}`, at: iso(t), chips: [], ...st, ...o });

// Retatrutide: 10 mg vial mixed with 2 mL (5 mg/mL), once a week; up 5 units every 4+ weeks once appetite is back
// to 3 of 5, to at most 12 mg a week.
const reta = (o: Partial<Medication> = {}): Medication => ({
  id: 'r', name: 'Retatrutide', strength: 10, unit: 'mg', form: 'injection', defaultAmount: 2, color: '', icon: 'syringe', archived: false, ...st,
  schedule: { type: 'fixed', slots: [{ time: '08:00' }], days: [4] },
  peptide: { waterMl: 2, syringe: 'U-100', syringeUnits: 50 },
  stepUp: { minWeeks: 4, minAppetite: 3 },
  stepPlan: { by: 5, byUnits: true, max: 12, maxPer: 'week' },
  ...o,
});
const weekly = [35, 28, 21, 14, 7, 1].map((k) => dose('r', at(k, 8), 2));
const hungry = Array.from({ length: 6 }, (_, i) => ci(at(i, 18), { appetite: 4 }));
const full = Array.from({ length: 6 }, (_, i) => ci(at(i, 18), { appetite: 2 }));

describe('step when ready', () => {
  it('works out a step given in syringe units from the vial', () => {
    expect(stepAmount(reta(), reta().stepPlan!)).toBe(0.25);
    expect(dosesPerWeek(reta(), NOW, S)).toBe(1);
  });
  it('is ready once every condition is met, and says the next dose', () => {
    const v = stepStatus(reta(), weekly, hungry, [], NOW, S)!;
    expect(v.ready).toBe(true);
    expect(v.next).toBe(2.25);
    expect(v.limit).toBe(12);
  });
  it('waits while appetite is still low', () => {
    const v = stepStatus(reta(), weekly, full, [], NOW, S)!;
    expect(v.ready).toBe(false);
    expect(v.checks.find((c) => c.key === 'minAppetite')!.ok).toBe(false);
  });
  it('waits for enough weeks on the dose, and says when', () => {
    const v = stepStatus(reta(), weekly.slice(-2), hungry, [], NOW, S)!;
    expect(v.ready).toBe(false);
    expect(v.readyFrom).toBeGreaterThan(NOW);
  });
  it('stops at the maximum, and caps the last step', () => {
    expect(stepStatus(reta({ defaultAmount: 11.9 }), weekly.map((d) => ({ ...d, amount: 11.9 })), hungry, [], NOW, S)!.next).toBe(12);
    const top = stepStatus(reta({ defaultAmount: 12 }), weekly.map((d) => ({ ...d, amount: 12 })), hungry, [], NOW, S)!;
    expect(top.atLimit).toBe(true);
    expect(top.ready).toBe(false);
  });
  it('splits a weekly maximum across doses', () => {
    const twice = reta({ schedule: { type: 'fixed', slots: [{ time: '08:00' }], days: [1, 4] } });
    expect(stepStatus(twice, weekly, hungry, [], NOW, S)!.limit).toBe(6);
  });
  it("doesn't ask again until the new dose is taken, or after Not yet", () => {
    expect(stepStatus(reta({ defaultAmount: 2.25 }), weekly, hungry, [], NOW, S)!.awaitingFirstDose).toBe(true);
    const later = stepStatus(reta({ stepPlan: { by: 5, byUnits: true, max: 12, maxPer: 'week', snoozedUntil: '2026-10-30' } }), weekly, hungry, [], NOW, S)!;
    expect(later.ready).toBe(false);
    expect(later.snoozedUntil).toBe('2026-10-30');
  });
});

// BPC-157: 10 units each night for 12 weeks, then a break until pain comes back.
const bpc = (start: string, o: Partial<Medication['schedule']['course']> = {}): Medication => ({
  id: 'b', name: 'BPC-157', strength: 5, unit: 'mg', form: 'injection', defaultAmount: 0.25, color: '', icon: 'syringe', archived: false, ...st,
  schedule: { type: 'fixed', slots: [{ time: '21:00' }], course: { start, days: 84, restartOn: ['Pain'], ...o } },
});

describe('a course, then a break', () => {
  it('is scheduled during the course', () => {
    const m = bpc('2026-10-01');
    expect(isScheduledDay(m, NOW, S)).toBe(true);
    expect(planLine(m, NOW, S)).toBe('Course, week 4 of 12 · last day Wed 23 Dec');
    expect(fmtSchedule(m.schedule, m.unit)).toContain('12-week course, then a break');
  });
  it('stops on the break: nothing due, no reminders', () => {
    const m = bpc('2026-07-01');
    expect(isScheduledDay(m, NOW, S)).toBe(false);
    expect(getNextDue(m, [], NOW, S)).toBe(null);
    expect(planLine(m, NOW, S)).toMatch(/^On a break · 4 weeks since the course ended/);
  });
  it('asks about starting again when a check-in mentions pain', () => {
    const m = bpc('2026-07-01');
    expect(restartPrompt(m, [ci(at(40), { chips: ['Pain'] })], NOW, S)).toBe(null); // before the break
    const p = restartPrompt(m, [ci(at(2), { note: 'knee pain again' })], NOW, S)!;
    expect(p.reason).toMatch(/^Pain in a check-in/);
    expect(restartPrompt(bpc('2026-07-01', { dismissedAt: iso(at(1)) }), [ci(at(2), { chips: ['Pain'] })], NOW, S)).toBe(null);
  });
  it('or once the break has lasted as long as chosen', () => {
    expect(restartPrompt(bpc('2026-07-01', { restartOn: [], remindAfterDays: 28 }), [], NOW, S)!.reason).toBe('4 weeks into the break');
    expect(restartPrompt(bpc('2026-07-01', { restartOn: [], remindAfterDays: 56 }), [], NOW, S)).toBe(null);
  });
});

describe('on and off', () => {
  it('4 weeks on, 12 off', () => {
    const m: Medication = { ...bpc('2026-01-01'), schedule: { type: 'fixed', slots: [{ time: '21:00' }], cycle: { on: 28, off: 84, start: '2026-10-01' } } };
    expect(isScheduledDay(m, NOW, S)).toBe(true);
    expect(planLine(m, NOW, S)).toBe('On, week 4 of 4 · break Thu 29 Oct');
    const off: Medication = { ...m, schedule: { ...m.schedule, cycle: { on: 28, off: 84, start: '2026-09-01' } } };
    expect(isScheduledDay(off, NOW, S)).toBe(false);
  });
});
