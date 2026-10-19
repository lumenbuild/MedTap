import { describe, it, expect } from 'vitest';
import type { CheckIn, Dose, Medication } from '../src/db/schema';
import { checkInPromptDose, lowStockMeds, needsBackup } from '../src/logic/reminders';
import { buildIcs } from '../src/logic/ics';

const H = 3_600_000, DAY = 24 * H;
const now = Date.parse('2026-07-15T06:00:00Z');
const dose = (ms: number, id = 'd1'): Dose => ({ id, medicationId: 'm', takenAt: new Date(ms).toISOString(), amount: 10, source: 'tag', createdAt: '', updatedAt: '' });
const ci = (ms: number): CheckIn => ({ id: 'c', at: new Date(ms).toISOString(), chips: [], createdAt: '', updatedAt: '' });

describe('backup reminder', () => {
  it('stays quiet with no data or a recent backup', () => {
    expect(needsBackup(null, null, now)).toBe(false);
    expect(needsBackup(new Date(now - 6 * DAY).toISOString(), now - 30 * DAY, now)).toBe(false);
  });
  it('asks after 7 days', () => {
    expect(needsBackup(new Date(now - 8 * DAY).toISOString(), now - 30 * DAY, now)).toBe(true);
    expect(needsBackup(null, now - 8 * DAY, now)).toBe(true);
  });
});

describe('check-in prompt', () => {
  it('appears after the delay and goes away after a check-in', () => {
    expect(checkInPromptDose([dose(now - 60 * 60_000)], [], now, 90, null)).toBeUndefined();
    expect(checkInPromptDose([dose(now - 95 * 60_000)], [], now, 90, null)?.id).toBe('d1');
    expect(checkInPromptDose([dose(now - 95 * 60_000)], [ci(now - 10 * 60_000)], now, 90, null)).toBeUndefined();
  });
  it('respects dismiss, off, and the 6-hour limit', () => {
    expect(checkInPromptDose([dose(now - 2 * H)], [], now, 90, 'd1')).toBeUndefined();
    expect(checkInPromptDose([dose(now - 2 * H)], [], now, 0, null)).toBeUndefined();
    expect(checkInPromptDose([dose(now - 7 * H)], [], now, 90, null)).toBeUndefined();
  });
});

describe('low stock', () => {
  const med = (stockCount: number): Medication => ({ id: 'm', name: 'X', strength: 10, unit: 'mg', form: 'tablet', defaultAmount: 10,
    schedule: { type: 'prn' }, color: '', icon: '', archived: false, createdAt: '', updatedAt: '', stockCount, lowStockAt: 5 });
  it('shows at the threshold until dismissed at that count', () => {
    expect(lowStockMeds([med(6)], {})).toHaveLength(0);
    expect(lowStockMeds([med(5)], {})).toHaveLength(1);
    expect(lowStockMeds([med(5)], { m: 5 })).toHaveLength(0);
    expect(lowStockMeds([med(4)], { m: 5 })).toHaveLength(1);
  });
});

describe('ics', () => {
  it('builds an event with an alert at the start', () => {
    const ics = buildIcs({ uid: 'u1', start: Date.parse('2026-07-15T09:02:00Z'), title: 'Stim, due', description: 'a;b', now });
    expect(ics).toContain('DTSTART:20260715T090200Z');
    expect(ics).toContain('DTEND:20260715T091700Z');
    expect(ics).toContain('SUMMARY:Stim\\, due');
    expect(ics).toContain('TRIGGER:PT0M');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
});
