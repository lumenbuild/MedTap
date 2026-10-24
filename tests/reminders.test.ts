import { describe, it, expect } from 'vitest';
import type { CheckIn, Dose, Medication } from '../src/db/schema';
import { checkInDue, checkInPromptDose, lowStockMeds, needsBackup, planCheckInNotes } from '../src/logic/reminders';
import type { ScheduleSettings } from '../src/logic/schedule';
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

describe('check-ins asked for more often', () => {
  const S: ScheduleSettings = { dayStartsAt: '04:00', tz: 'Australia/Sydney', guardMinutes: 10 };
  // Wed 15 Jul 2026 in Sydney (UTC+10): 8 pm is 10:00Z.
  const eight = Date.parse('2026-07-15T10:00:00Z');
  const o = { delayMin: 90, times: ['20:00'], dismissed: null };
  it('asks at the daily time for up to 4 hours, unless a check-in came from an hour before', () => {
    expect(checkInDue([], [], eight - 60_000, o, S)).toBeUndefined();
    expect(checkInDue([], [], eight + H, o, S)).toMatchObject({ kind: 'daily', key: 'daily:2026-07-15 20:00', at: eight });
    expect(checkInDue([], [], eight + 5 * H, o, S)).toBeUndefined();
    expect(checkInDue([], [ci(eight - 30 * 60_000)], eight + H, o, S)).toBeUndefined();
    expect(checkInDue([], [ci(eight - 2 * H)], eight + H, o, S)?.kind).toBe('daily');
    expect(checkInDue([], [], eight + H, { ...o, dismissed: 'daily:2026-07-15 20:00' }, S)).toBeUndefined();
  });
  it('puts the after-dose check-in first, and never asks about a skipped dose', () => {
    expect(checkInDue([dose(eight - 30 * 60_000)], [], eight + H, o, S)).toMatchObject({ kind: 'dose', key: 'd1' });
    expect(checkInDue([{ ...dose(eight - 30 * 60_000), skipped: true }], [], eight + H, o, S)?.kind).toBe('daily');
  });
  it('plans notifications after the latest dose and at each daily time for a week', () => {
    const noon = Date.parse('2026-07-15T02:00:00Z');
    const plan = planCheckInNotes([dose(noon - H)], [], noon, { delayMin: 90, times: ['20:00'] }, S);
    expect(plan[0]).toMatchObject({ kind: 'dose', at: noon + 30 * 60_000 });
    expect(plan.filter((p) => p.kind === 'daily')).toHaveLength(7);
    expect(new Set(plan.map((p) => p.id)).size).toBe(plan.length);
    // Already checked in this evening: today's time is left out.
    const late = planCheckInNotes([], [ci(eight - 20 * 60_000)], eight - 10 * 60_000, { delayMin: 90, times: ['20:00'] }, S);
    expect(late.map((p) => p.at)).not.toContain(eight);
    expect(planCheckInNotes([], [], noon, { delayMin: 0, times: [] }, S)).toEqual([]);
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
