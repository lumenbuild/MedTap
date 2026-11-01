// Dose safety: the app never offers a dose time earlier than the schedule, never says to skip or pause a prescribed
// medicine, never says to take a "missed" shot on top of one already taken, and never offers an on/off test of a
// prescribed medicine.
import { describe, it, expect } from 'vitest';
import type { CheckIn, DailyHealth, Dose, Medication } from '../src/db/schema';
import { getNextDue, type ScheduleSettings } from '../src/logic/schedule';
import { secondDose, secondDetail, secondTitle } from '../src/logic/stimulant';
import { missedShot } from '../src/logic/peptideSmart';
import { selfTestable } from '../src/logic/verdict';
import { todaysCalls } from '../src/logic/decisions';

const S: ScheduleSettings = { dayStartsAt: '04:00', tz: Intl.DateTimeFormat().resolvedOptions().timeZone, guardMinutes: 10 };
const DAY = 86_400_000, MIN = 60_000;
const BASE = new Date(2026, 10, 2, 0, 0).getTime(); // a Monday
const at = (h: number, m = 0, dayOff = 0) => { const d = new Date(BASE + dayOff * DAY); d.setHours(h, m, 0, 0); return d.getTime(); };
const st = { createdAt: '', updatedAt: '' };
let n = 0;
const dose = (medicationId: string, t: number, o: Partial<Dose> = {}): Dose => ({ id: `d${n++}`, medicationId, takenAt: new Date(t).toISOString(), amount: 10, source: 'manual', ...st, ...o });
const med = (o: Partial<Medication>): Medication => ({ id: 'r', name: 'Ritalin', strength: 10, unit: 'mg', form: 'tablet', defaultAmount: 10, schedule: { type: 'fixed', slots: [{ time: '07:30' }, { time: '11:30' }] }, color: '', icon: 'pill', archived: false, ...st, ...o });

// A watch history that says the first dose wears off quickly (heart rate back to resting 90 minutes after each dose),
// the case that used to pull the second dose forward.
const fastWearOff: DailyHealth[] = Array.from({ length: 14 }, (_, k) => ({
  id: `h${k}`, date: new Date(at(12, 0, -k - 1)).toISOString().slice(0, 10), ...st,
  hr5: Array.from({ length: 288 }, (_, i) => (i * 5 >= 7.5 * 60 && i * 5 < 9 * 60 ? 80 : 62)),
}));
const pastDoses = Array.from({ length: 14 }, (_, k) => [dose('r', at(7, 30, -k - 1)), dose('r', at(11, 30, -k - 1))]).flat();
const focusDrops: CheckIn[] = Array.from({ length: 14 }, (_, k) => ({ id: `c${k}`, at: new Date(at(9, 15, -k - 1)).toISOString(), chips: [], focus: 2, ...st }));

describe('dose safety', () => {
  it('a twice-daily stimulant: the second dose is never earlier than its scheduled time, whatever the data says', () => {
    for (const sched of [['07:30', '11:30'], ['06:00', '10:00', '14:00'], ['08:00', '12:30']]) {
      const m = med({ schedule: { type: 'fixed', slots: sched.map((time) => ({ time })) } });
      const [h0, m0] = sched[0].split(':').map(Number);
      for (let late = -60; late <= 120; late += 30) {
        const first = dose('r', at(h0, m0) + late * MIN);
        for (let after = 10; after <= 300; after += 35) {
          const now = Date.parse(first.takenAt) + after * MIN;
          const all = [...pastDoses, first];
          const sd = secondDose(m, all, focusDrops, fastWearOff, now, S);
          if (!sd) continue;
          expect(sd.source).toBe('schedule');
          expect(sd.at).toBe(getNextDue(m, all, now, S));
          const slotTimes = sched.map((t) => { const [h, mm] = t.split(':').map(Number); return at(h, mm); });
          expect(slotTimes).toContain(sd.at);
          const text = `${secondTitle('Ritalin', sd, now)} ${secondDetail(sd)}`;
          expect(text).not.toMatch(/skip|earlier|take it now|before the first wears off/i);
        }
      }
    }
  });

  it("today's calls never tell you to skip or move a dose", () => {
    const m = med({});
    const now = at(9, 45);
    const calls = todaysCalls({ meds: [m], doses: [...pastDoses, dose('r', at(7, 36))], checkIns: focusDrops, daily: fastWearOff, body: [], experiments: [], workouts: [], foodLogs: [] } as never, now, S,
      { bedtime: '21:30', caffeineCutoff: null, caffeineHalfLifeH: 5, energyTargetKcal: null, proteinTargetG: null, lossRateKgWeek: 0.5 });
    const second = calls.find((c) => c.key === 'second-dose');
    expect(second?.title).toMatch(/11:30/);
    for (const c of calls) expect(`${c.title} ${c.detail}`).not.toMatch(/skip|take it earlier|before the first wears off/i);
  });

  it('a weekly shot taken early is never "missed"', () => {
    const weekly = med({ id: 'g', name: 'Retatrutide', schedule: { type: 'fixed', slots: [{ time: '08:00' }], days: [4] } });
    const thursday = at(8, 0, 3);
    for (let early = 0; early <= 3; early++) {
      const shot = dose('g', thursday - early * DAY);
      for (let k = 1; k <= 5; k++) expect(missedShot(weekly, [dose('g', thursday - 7 * DAY), shot], thursday + k * DAY, S)).toBeNull();
    }
  });

  it('on/off tests are only for supplements and as-needed items', () => {
    expect(selfTestable(med({}))).toBe(false); // a stimulant
    expect(selfTestable(med({ name: 'Retatrutide' }))).toBe(false);
    expect(selfTestable(med({ name: 'Sertraline', schedule: { type: 'fixed', slots: [{ time: '08:00' }] } }))).toBe(false);
    expect(selfTestable(med({ name: 'Magnesium glycinate', schedule: { type: 'fixed', slots: [{ time: '21:00' }] } }))).toBe(true);
    expect(selfTestable(med({ name: 'Paracetamol', schedule: { type: 'prn' } as Medication['schedule'] }))).toBe(true);
  });
});
