import { describe, it, expect } from 'vitest';
import { reminderDrift } from '../src/logic/drift';
import type { Dose, Medication } from '../src/db/schema';

const med = { id: 'm', name: 'X', strength: 1, unit: 'mg', form: 'tablet', defaultAmount: 1, color: '', icon: '', archived: false, createdAt: '', updatedAt: '',
  schedule: { type: 'fixed', slots: [{ time: '06:00' }] } } as Medication;
const dose = (day: number, hhmm: string, source: Dose['source'] = 'manual'): Dose =>
  ({ id: `${day}`, medicationId: 'm', takenAt: `2026-03-${String(day).padStart(2, '0')}T${hhmm}:00Z`, amount: 1, source, createdAt: '', updatedAt: '' });

describe('reminder drift', () => {
  it('finds a 6:00 reminder logged around 10:30', () => {
    const d = reminderDrift(med, [dose(1, '10:20'), dose(2, '10:40'), dose(3, '10:30'), dose(4, '11:00'), dose(5, '10:15')], 'UTC');
    expect(d?.usual).toBe('10:30');
  });
  it('nothing when the times are all over the place, or close to the reminder', () => {
    expect(reminderDrift(med, [dose(1, '06:20'), dose(2, '16:56'), dose(3, '10:30'), dose(4, '17:31'), dose(5, '06:10')], 'UTC')).toBeNull();
    expect(reminderDrift(med, [1, 2, 3, 4, 5].map((i) => dose(i, '06:30')), 'UTC')).toBeNull();
  });
  it('backdated logs do not count', () => {
    expect(reminderDrift(med, [1, 2, 3, 4, 5].map((i) => dose(i, '10:30', 'backdated')), 'UTC')).toBeNull();
  });
});
