import { describe, it, expect } from 'vitest';
import type { BodyEntry, LabResult, Vital } from '../src/db/schema';
import { healthMarkers } from '../src/logic/markers';

const st = { createdAt: '', updatedAt: '' };
const NOW = Date.parse('2026-10-30T12:00:00Z');
const DAY = 86_400_000;
const lab = (date: string, name: string, value: number, unit?: string): LabResult => ({ id: `${name}${date}`, date, name, value, unit, ...st });

describe('health markers', () => {
  it('labs by name, each against the first, with which way is better', () => {
    const m = healthMarkers({ labs: [lab('2026-03-01', 'HbA1c', 6.8, '%'), lab('2026-09-01', 'HbA1c', 6.1, '%'), lab('2026-03-01', 'HDL Cholesterol', 1.0, 'mmol/L'), lab('2026-09-01', 'HDL Cholesterol', 1.2, 'mmol/L'),
      lab('2026-09-01', 'LDL Cholesterol', 3.6, 'mmol/L'), lab('2026-09-01', 'Cholesterol, total', 5.1, 'mmol/L')], vitals: [], body: [], daily: [] }, undefined, NOW);
    const by = Object.fromEntries(m.map((x) => [x.key, x]));
    expect(by.hba1c).toMatchObject({ latest: '6.1', first: '6.8', better: true, tone: 'plain' });
    expect(by.hdl).toMatchObject({ latest: '1.2', better: true });
    expect(by.ldl.tone).toBe('watch');
    expect(by.chol.latest).toBe('5.1'); // not confused with LDL or HDL
  });
  it('waist-to-height and BMI once there is a height', () => {
    const body: BodyEntry[] = [{ id: 'a', date: '2026-06-01', weightKg: 120, waistCm: 115, ...st }, { id: 'b', date: '2026-10-25', weightKg: 110, waistCm: 104, ...st }];
    expect(healthMarkers({ labs: [], vitals: [], body, daily: [] }, undefined, NOW).some((x) => x.key === 'whtr')).toBe(false);
    const m = healthMarkers({ labs: [], vitals: [], body, daily: [] }, 180, NOW);
    expect(m.find((x) => x.key === 'whtr')).toMatchObject({ latest: '0.58', first: '0.64', better: true, note: '90 cm waist is 0.5' });
    expect(m.find((x) => x.key === 'bmi')).toMatchObject({ latest: '34.0', first: '37.0', better: true });
  });
  it('blood pressure: the last two weeks against the first', () => {
    const vitals: Vital[] = Array.from({ length: 20 }, (_, i) => ({ id: `v${i}`, at: new Date(NOW - (60 - i * 3) * DAY).toISOString(), systolic: i < 5 ? 142 : 124, diastolic: i < 5 ? 92 : 80, ...st }));
    const bp = healthMarkers({ labs: [], vitals, body: [], daily: [] }, undefined, NOW)[0];
    expect(bp).toMatchObject({ key: 'bp', latest: '124/80', first: '142/92', better: true, tone: 'good' });
  });
});
