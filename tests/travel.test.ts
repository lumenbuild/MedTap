import { describe, it, expect } from 'vitest';
import { scheduleSettings, scheduleTimeZone, DEFAULT_SETTINGS } from '../src/db/repos/settings';
import { getNextDue } from '../src/logic/schedule';
import { zonedToUtc } from '../src/logic/tz';
import { zoneDiff } from '../src/components/TravelBanner';
import type { Medication } from '../src/db/schema';

const med: Medication = { id: 'm', name: 'X', strength: 10, unit: 'mg', form: 'tablet', defaultAmount: 10,
  schedule: { type: 'fixed', slots: [{ time: '08:00' }] }, color: '', icon: '', archived: false, createdAt: '', updatedAt: '' };

describe('travel mode', () => {
  const home = { ...DEFAULT_SETTINGS, homeTimeZone: 'Australia/Sydney' };
  it('follows the phone by default, or keeps home time when chosen', () => {
    expect(scheduleTimeZone(home, 'Asia/Tokyo')).toBe('Asia/Tokyo');
    expect(scheduleTimeZone({ ...home, timeMode: 'home' }, 'Asia/Tokyo')).toBe('Australia/Sydney');
    expect(scheduleTimeZone({ ...home, timeMode: 'home', homeTimeZone: null }, 'Asia/Tokyo')).toBe('Asia/Tokyo');
  });

  it('an 8 am set time is 8 am local, or 8 am Sydney (6 am Tokyo) when keeping home time', () => {
    const now = zonedToUtc(2026, 7, 15, 5, 0, 'Asia/Tokyo'); // 5 am in Tokyo
    const local = getNextDue(med, [], now, scheduleSettings(home, 'Asia/Tokyo'));
    const homeTime = getNextDue(med, [], now, scheduleSettings({ ...home, timeMode: 'home' }, scheduleTimeZone({ ...home, timeMode: 'home' }, 'Asia/Tokyo')));
    expect(local).toBe(zonedToUtc(2026, 7, 15, 8, 0, 'Asia/Tokyo'));
    expect(homeTime).toBe(zonedToUtc(2026, 7, 15, 8, 0, 'Australia/Sydney')); // = 7 am Tokyo in July (AEST +10, JST +9)
  });

  it('describes the difference', () => {
    expect(zoneDiff('Australia/Sydney', 'Asia/Tokyo', Date.UTC(2026, 6, 15))).toBe('−1 h');
    expect(zoneDiff('Australia/Sydney', 'Australia/Sydney')).toBe('same time');
  });
});
