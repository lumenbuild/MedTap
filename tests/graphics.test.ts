import { describe, it, expect } from 'vitest';
import { doseStrips, monthRecap, todayAgainstUsual } from '../src/logic/graphics';
import { dayLabels } from '../src/logic/dayLabels';
import type { DailyHealth, Dose, Medication } from '../src/db/schema';
import { DEFAULT_SETTINGS, scheduleSettings } from '../src/db/repos/settings';

const s = { ...scheduleSettings(DEFAULT_SETTINGS), tz: 'UTC', dayStartsAt: '00:00' };
const med = (id: string, extra: Partial<Medication> = {}): Medication => ({ id, name: id, strength: 1, unit: 'mg', form: 'tablet', defaultAmount: 1,
  schedule: { type: 'fixed', slots: [{ time: '08:00' }] }, color: '#2a78d6', icon: '', archived: false, createdAt: '2026-03-01T00:00:00Z', updatedAt: '', ...extra });
const dose = (m: string, at: string): Dose => ({ id: `${m}${at}`, medicationId: m, takenAt: at, amount: 1, source: 'manual', createdAt: at, updatedAt: '' });
const now = Date.parse('2026-03-20T12:00:00Z');

describe('dose strips', () => {
  it('marks logged, planned-not-logged and days before it was added', () => {
    const [st] = doseStrips([med('a', { createdAt: '2026-03-15T00:00:00Z' })], [dose('a', '2026-03-16T08:00:00Z'), dose('a', '2026-03-18T08:00:00Z')], [], now, s, 7);
    // 14th to 20th: added on the 15th, logged on the 16th and 18th, today not yet.
    expect(st.cells.map((c) => c.state)).toEqual(['pre', 'missed', 'taken', 'missed', 'taken', 'missed', 'future']);
  });
});

describe('day marks', () => {
  it('marks GLP-1 shot days and short nights (on the day before the morning they show)', () => {
    const reta = med('r', { name: 'Retatrutide', form: 'injection' });
    const daily: DailyHealth[] = [{ id: 'x', date: '2026-03-12', createdAt: '', updatedAt: '', sleepMin: 300 }];
    const m = dayLabels({ meds: [reta], doses: [dose('r', '2026-03-10T08:00:00Z')], experiments: [], daily, foodLogs: [] }, s);
    expect(m.get('2026-03-10')).toContain('shot');
    expect(m.get('2026-03-11')).toContain('short');
  });
});

describe('today against usual and the month', () => {
  it('needs a week of usual days', () => {
    const rows: DailyHealth[] = Array.from({ length: 3 }, (_, i) => ({ id: `${i}`, date: `2026-03-1${i}`, createdAt: '', updatedAt: '', hrByHour: Array(24).fill(70) }));
    expect(todayAgainstUsual(rows, now, s)).toBeNull();
  });
  it('counts doses and the longest run of logged days', () => {
    const doses = [1, 2, 3, 5].map((d) => dose('a', `2026-02-0${d}T08:00:00Z`));
    const r = monthRecap({ meds: [med('a')], doses, body: [], daily: [], workouts: [] }, 2026, 1, s);
    expect(r.doses).toBe(4);
    expect(r.streak).toBe(3);
  });
});
