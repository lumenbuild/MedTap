import { describe, it, expect } from 'vitest';
import type { CheckIn, Dose, Medication } from '../src/db/schema';
import {
  adherenceByDay, averageSummary, changeSummary, chipCounts, dailyAverages, dayKey, daysBetween, doseIntervals, doseTimes, histogram, median, rollingAverage,
} from '../src/logic/stats';
import { zonedToUtc } from '../src/logic/tz';

const TZ = 'Australia/Sydney';
const S = { dayStartsAt: '04:00', tz: TZ, guardMinutes: 10 };
const DAY = 86_400_000;
const syd = (d: string, t: string) => { const [y, m, dd] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number); return zonedToUtc(y, m, dd, h, mi, TZ); };
let n = 0;
const dose = (ms: number, medicationId = 'm'): Dose => ({ id: `d${++n}`, medicationId, takenAt: new Date(ms).toISOString(), amount: 10, source: 'tag', createdAt: '', updatedAt: '' });
const ci = (ms: number, o: Partial<CheckIn> = {}): CheckIn => ({ id: `c${++n}`, at: new Date(ms).toISOString(), chips: [], createdAt: '', updatedAt: '', ...o });
const med: Medication = { id: 'm', name: 'X', strength: 10, unit: 'mg', form: 'tablet', defaultAmount: 10,
  schedule: { type: 'interval', intervalHours: 4, maxPerDay: 3 }, color: '', icon: '', archived: false, createdAt: '', updatedAt: '' };

describe('days', () => {
  it('uses the user day, not midnight', () => {
    expect(dayKey(syd('2026-07-16', '01:30'), S)).toBe('2026-07-15');
    expect(daysBetween(syd('2026-07-14', '12:00'), syd('2026-07-16', '12:00'), S)).toEqual(['2026-07-14', '2026-07-15', '2026-07-16']);
  });
});

describe('weight', () => {
  it('rolling average and plain-English change', () => {
    const pts = [80, 79.5, 79, 78.5].map((v, i) => ({ t: i * DAY, v }));
    const avg = rollingAverage(pts, 7);
    expect(avg[3].v).toBeCloseTo(79.25);
    expect(changeSummary(avg, (v) => `${v.toFixed(1)} kg`)).toBe('Down 0.8 kg over 3 days (7-day average)');
    expect(changeSummary(avg.slice(0, 1), String)).toBeNull();
  });
});

describe('adherence and timing', () => {
  it('counts per user day against the target', () => {
    const doses = [dose(syd('2026-07-15', '07:00')), dose(syd('2026-07-15', '11:00')), dose(syd('2026-07-16', '01:00'))];
    expect(adherenceByDay(doses, med, ['2026-07-15', '2026-07-16'], S)).toEqual([
      { day: '2026-07-15', count: 3, target: 3 }, { day: '2026-07-16', count: 0, target: 3 },
    ]);
  });
  it('gives time of day in local hours', () => {
    const t = doseTimes([dose(syd('2026-07-15', '13:30'))], 'm', 0, Infinity, S);
    expect(t[0].hour).toBe(13.5);
  });
  it('intervals only within a day', () => {
    const doses = ['07:00', '11:05', '15:10'].map((x) => dose(syd('2026-07-15', x))).concat(dose(syd('2026-07-16', '07:00')));
    expect(doseIntervals(doses, 'm', 0, Infinity, S).map((h) => h.toFixed(2))).toEqual(['4.08', '4.08']);
    expect(median([4, 3, 5])).toBe(4);
  });
  it('histogram bins', () => {
    expect(histogram([3.6, 4.1, 4.2], 0.5)).toEqual([{ from: 3.5, to: 4, count: 1 }, { from: 4, to: 4.5, count: 2 }]);
  });
});

describe('check-ins', () => {
  it('daily averages, chip counts and summaries', () => {
    const cs = [ci(syd('2026-07-15', '09:00'), { mood: 3, chips: ['Calm'] }), ci(syd('2026-07-15', '15:00'), { mood: 4, chips: ['Calm', 'Focused'] })];
    expect(dailyAverages(cs, 'mood', 0, Infinity, S)).toHaveLength(1);
    expect(dailyAverages(cs, 'mood', 0, Infinity, S)[0].v).toBe(3.5);
    expect(chipCounts(cs, 0, Infinity)).toEqual([{ chip: 'Calm', count: 2 }, { chip: 'Focused', count: 1 }]);
    expect(averageSummary('Mood', 3.8, 3.2, 30)).toBe('Mood averaged 3.8, up from 3.2 in the 30 days before');
    expect(averageSummary('Mood', 3.8, null, 30)).toBe('Mood averaged 3.8');
  });
});
