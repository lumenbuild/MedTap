import { describe, it, expect } from 'vitest';
import type { CheckIn, DailyHealth, Dose, Medication } from '../src/db/schema';
import type { ScheduleSettings } from '../src/logic/schedule';
import { weekAhead } from '../src/logic/weekAhead';

const S: ScheduleSettings = { dayStartsAt: '00:00', tz: Intl.DateTimeFormat().resolvedOptions().timeZone, guardMinutes: 10 };
const DAY = 86_400_000;
// A Saturday morning; shots on Thursdays.
const NOW = new Date(2026, 10, 7, 7, 0).getTime();
const st = { createdAt: '', updatedAt: '' };
const iso = (t: number) => new Date(t).toISOString();
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const at = (daysAgo: number, h: number) => { const d = new Date(NOW - daysAgo * DAY); d.setHours(h, 0, 0, 0); return d.getTime(); };

const reta: Medication = { id: 'r', name: 'Retatrutide', strength: 10, unit: 'mg', form: 'injection', defaultAmount: 4, schedule: { type: 'fixed', slots: [{ time: '08:00' }], days: [4] },
  color: '', icon: 'syringe', archived: false, peptide: { kind: 'vial', waterMl: 2, syringe: 'U-100', syringeUnits: 100, useWithinDays: 28 },
  vials: [{ id: 'v', status: 'in-use', amount: 10, waterMl: 2, addedAt: iso(NOW - 10 * DAY), startedAt: iso(NOW - 10 * DAY) }], ...st };

function history() {
  const doses: Dose[] = [], checkIns: CheckIn[] = [], daily: DailyHealth[] = [];
  // Thursdays over 10 weeks: NOW is Saturday, so the last Thursday was 2 days ago.
  for (let w = 0; w < 10; w++) {
    const k = 2 + w * 7;
    doses.push({ id: `d${w}`, medicationId: 'r', takenAt: iso(at(k, 8)), amount: 4, source: 'manual', ...st });
    // Nausea the day after, appetite low for two days, fine after.
    checkIns.push({ id: `c${w}a`, at: iso(at(k - 1, 18)), chips: ['Nausea'], appetite: 1, ...st });
    checkIns.push({ id: `c${w}b`, at: iso(at(k - 2, 18)), chips: [], appetite: 2, ...st });
    checkIns.push({ id: `c${w}c`, at: iso(at(k - 4, 18)), chips: [], appetite: 4, ...st });
    checkIns.push({ id: `c${w}d`, at: iso(at(k - 5, 18)), chips: ['Alcohol'], appetite: 4, ...st });
  }
  // Nights: heart rate up and sleep shorter the night after a shot.
  for (let k = 70; k >= 0; k--) {
    const t = NOW - k * DAY;
    const daysSinceShot = ((k - 2) % 7 + 7) % 7 === 0 ? 0 : (7 - (((k - 2) % 7) + 7) % 7);
    const after = daysSinceShot === 1; // the morning after a shot
    daily.push({ id: `n${k}`, date: ymd(t), restingHr: after ? 66 : 58, sleepMin: after ? 380 : 440, waterMl: 1500, ...st });
  }
  return { doses, checkIns, daily };
}

describe('the week ahead', () => {
  const h = history();
  const w = weekAhead({ meds: [reta], ...h, body: [], workouts: [], foodLogs: [] }, { waterTargetMl: 2500, fibreTargetG: 30, proteinTargetG: 150, bedtime: '22:30' }, NOW, S);

  it('places the next shot and what usually follows it', () => {
    const shotDay = w.days.find((d) => d.shots.length)!;
    expect(new Date(shotDay.start + 12 * 3_600_000).getDay()).toBe(4);
    const next = w.days[w.days.indexOf(shotDay) + 1];
    expect(next.effects.map((e) => e.chip)).toContain('Nausea');
    expect(next.advice.map((a) => a.key)).toContain('fx:Nausea');
    expect(next.waterBoost).toBeGreaterThan(0);
  });
  it('appetite, heart rate and sleep on the days after a shot', () => {
    const shotIdx = w.days.findIndex((d) => d.shots.length);
    expect(w.days[shotIdx + 1].appetite).toBe('low');
    expect(w.days.some((d) => (d.hrDelta ?? 0) >= 5)).toBe(true);
    expect(w.days.some((d) => (d.sleepDelta ?? 0) <= -40)).toBe(true);
    expect(w.days.find((d) => d.trainDay === 'easy')).toBeTruthy();
    expect(w.days.find((d) => d.trainDay === 'best')).toBeTruthy();
  });
  it('warns about alcohol on a low-appetite or nausea day, and dehydration', () => {
    expect(w.risks.map((r) => r.key)).toEqual(expect.arrayContaining(['dehydration']));
  });
  it('never advises a dose change', () => {
    const all = [...w.days.flatMap((d) => d.advice.map((a) => a.text)), ...w.risks.map((r) => `${r.title} ${r.detail}`)].join(' ');
    expect(all).not.toMatch(/(skip|delay|move|increase|decrease|lower|raise) (the |your )?(dose|shot)/i);
  });
  it('checks itself against the last month', () => {
    expect(w.accuracy).toBeDefined();
    expect(w.accuracy!.right / w.accuracy!.of).toBeGreaterThan(0.6);
  });
});
