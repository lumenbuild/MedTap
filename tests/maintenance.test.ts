import { describe, it, expect } from 'vitest';
import type { BodyEntry, Dose, Medication } from '../src/db/schema';
import { goalReached, regainWatch } from '../src/logic/maintenance';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-30T12:00:00Z');
const st = { createdAt: '', updatedAt: '' };
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);
// Down from 100 to 90 over 60 days, then back up to 93 over 30.
const body: BodyEntry[] = Array.from({ length: 30 }, (_, i) => { const t = NOW - (90 - i * 3) * DAY; const v = i < 20 ? 100 - i * 0.5 : 90 + (i - 20) * 0.3; return { id: `b${i}`, date: ymd(t), weightKg: v, ...st }; });
const kg = (v: number) => `${v} kg`;

describe('after the loss', () => {
  it('weight creeping back from the low, and the dose that came down just before', () => {
    const med = { id: 'm', name: 'Tirz', unit: 'mg' } as Medication;
    const doses: Dose[] = Array.from({ length: 12 }, (_, i) => ({ id: `d${i}`, medicationId: 'm', takenAt: new Date(NOW - (80 - i * 7) * DAY).toISOString(), amount: i < 8 ? 7.5 : 5, source: 'manual', ...st }));
    const r = regainWatch(body, [med], doses, [], NOW, kg, (m) => m.name)!;
    expect(r.up).toBeGreaterThanOrEqual(1.5);
    expect(r.why).toBe('Since Tirz came down to 5 mg');
  });
  it('nothing while still losing', () => {
    expect(regainWatch(body.slice(0, 20), [], [], [], NOW - 30 * DAY, kg, () => '')).toBeNull();
  });
  it('goal reached once the 7-day average is at it', () => {
    const goals = [{ metric: 'weightKg' as const, target: 91, start: 100, startDate: '2026-07-01' }];
    expect(goalReached(body.slice(0, 20), goals)).toBeTruthy();
    expect(goalReached(body.slice(0, 10), goals)).toBeNull();
  });
});
