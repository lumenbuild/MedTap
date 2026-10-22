import { describe, it, expect } from 'vitest';
import type { CheckIn, Dose, Medication } from '../src/db/schema';
import { checkInForecast, effectWindow, reminderSuggestion, riskySlots, sleepImpact, slotHabits, toHHmm, nudgeDelayMin } from '../src/logic/habits';
import { planReminders } from '../src/logic/notify';
import type { ScheduleSettings } from '../src/logic/schedule';
import { zonedToUtc } from '../src/logic/tz';

const TZ = 'Australia/Sydney';
const S: ScheduleSettings = { dayStartsAt: '04:00', tz: TZ, guardMinutes: 10 };
const DAY = 86_400_000;
const syd = (date: string, time = '12:00') => {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return zonedToUtc(y, m, d, h, mi, TZ);
};
const iso = (ms: number) => new Date(ms).toISOString();
let n = 0;
const dose = (ms: number, o: Partial<Dose> = {}): Dose => ({ id: `d${++n}`, medicationId: 'm', takenAt: iso(ms), amount: 50, source: 'tag', createdAt: iso(ms), updatedAt: '', ...o });
const ci = (ms: number, o: Partial<CheckIn> = {}): CheckIn => ({ id: `c${++n}`, at: iso(ms), chips: [], createdAt: '', updatedAt: '', ...o });
const med = (o: Partial<Medication> = {}): Medication => ({
  id: 'm', name: 'Vyvanse', strength: 50, unit: 'mg', form: 'capsule', defaultAmount: 50, color: '', icon: 'pill', archived: false,
  schedule: { type: 'fixed', slots: [{ time: '07:00' }] }, createdAt: '', updatedAt: '', ...o,
});
const NOW = syd('2026-07-31', '12:00'); // Friday
// 4 weeks of doses: weekdays about 7:40, weekends about 9:15; Sundays from 18 Jul onwards missed.
const history: Dose[] = [];
for (let i = 28; i >= 1; i--) {
  const day = new Date(NOW - i * DAY + 10 * 3_600_000).toISOString().slice(0, 10);
  const wd = new Date(`${day}T12:00:00Z`).getUTCDay();
  if (wd === 0 && i < 15) continue;
  const jitter = (i % 3) * 5;
  history.push(dose(syd(day, wd === 0 || wd === 6 ? '09:10' : '07:35') + jitter * 60_000));
}

describe('when doses are really taken', () => {
  it('learns weekday and weekend times', () => {
    const [h] = slotHabits(med(), history, NOW, S);
    expect(h.weekday!.median).toBeGreaterThanOrEqual(35);
    expect(h.weekday!.median).toBeLessThanOrEqual(45);
    expect(h.weekend!.median).toBeGreaterThan(120);
    expect(h.weekday!.spread).toBeLessThan(15);
  });
  it('suggests moving the reminder to match, then nothing once moved', () => {
    const s1 = reminderSuggestion(med(), history, NOW, S)!;
    expect(s1).toHaveLength(1);
    expect(s1[0].weekday).toMatch(/^07:(35|40|45)$/);
    expect(s1[0].weekend).toMatch(/^09:1[05]$/);
    expect(reminderSuggestion(med({ reminderTimes: s1 }), history, NOW, S)).toBeNull();
  });
  it('finds a day that is often missed', () => {
    const r = riskySlots(med(), history, NOW, S);
    expect(r[0]).toMatchObject({ weekday: 0, slot: '07:00' });
    expect(r[0].missed).toBeGreaterThanOrEqual(2);
  });
  it('reminders use the learned time, nudge after the usual spread, and doubly on risky days', () => {
    const m = med({ reminderTimes: [{ slot: '07:00', weekday: '07:40', weekend: '09:15' }] });
    const plan = planReminders([m], history, NOW, S, 7, 60, { nudges: true });
    const mon = plan.find((p) => p.kind === 'due' && p.dueAt === syd('2026-08-03', '07:00'))!;
    expect(mon.at).toBe(syd('2026-08-03', '07:40'));
    const sun = plan.filter((p) => p.dueAt === syd('2026-08-02', '07:00'));
    expect(sun.map((p) => p.kind)).toEqual(['due', 'nudge', 'nudge']);
    expect(sun[0].at).toBe(syd('2026-08-02', '09:15'));
    const monNudge = plan.find((p) => p.kind === 'nudge' && p.dueAt === syd('2026-08-03', '07:00'))!;
    expect(monNudge.at - mon.at).toBeGreaterThanOrEqual(30 * 60_000);
    // Without nudges turned on, only the risky day gets them.
    expect(planReminders([m], history, NOW, S, 7, 60).filter((p) => p.kind === 'nudge').every((p) => p.dueAt === syd('2026-08-02', '07:00'))).toBe(true);
    expect(nudgeDelayMin(undefined)).toBe(45);
    expect(toHHmm(-20)).toBe('23:40');
  });
});

describe('effect window and sleep', () => {
  it('focus rises an hour after the dose and wears off around 9 hours', () => {
    const ds: Dose[] = [], cs: CheckIn[] = [];
    for (let i = 1; i <= 10; i++) {
      const t = syd('2026-07-01', '07:30') + i * DAY;
      ds.push(dose(t));
      cs.push(ci(t - 30 * 60_000, { focus: 2 }), ci(t + 90 * 60_000, { focus: 4 }), ci(t + 5 * 3_600_000, { focus: 4 }), ci(t + 9.2 * 3_600_000, { focus: 2, chips: ['Wearing off'] }));
      cs.push(ci(t + 15 * 3_600_000, { focus: 2 }));
    }
    const w = effectWindow(med(), ds, cs, syd('2026-07-12'))!;
    expect(w.onsetH).toBe(1);
    expect(w.wearOffH).toBeCloseTo(9.5, 0);
  });
  it('late last doses go with worse sleep: finds the cut-off', () => {
    const ds: Dose[] = [], cs: CheckIn[] = [];
    for (let i = 1; i <= 12; i++) {
      const day = syd('2026-07-01', '12:00') + i * DAY;
      const late = i % 2 === 0;
      ds.push(dose(day + (late ? 4 : -2) * 3_600_000)); // 4 pm or 10 am
      cs.push(ci(day + 20 * 3_600_000, { sleepQuality: late ? 2 : 4, sleepHours: late ? 5.5 : 7.5 })); // next morning 8 am
    }
    const r = sleepImpact([med()], ds, cs, syd('2026-07-20'), S)!;
    expect(r.cutoffHour).toBeGreaterThan(10);
    expect(r.cutoffHour).toBeLessThanOrEqual(16);
    expect(r.before.quality).toBe(4);
    expect(r.after.quality).toBe(2);
  });
  it('forecasts the coming week from weekday patterns and dosed days', () => {
    const ds: Dose[] = [], cs: CheckIn[] = [];
    for (let i = 35; i >= 1; i--) {
      const t = NOW - i * DAY;
      const wd = new Date(t + 10 * 3_600_000).getUTCDay();
      const dosed = wd !== 0 && wd !== 6;
      if (dosed) ds.push(dose(t - 3 * 3_600_000));
      cs.push(ci(t, { focus: dosed ? 4 : 2, mood: 3 }));
    }
    const f = checkInForecast([med({ schedule: { type: 'fixed', slots: [{ time: '07:00' }], days: [1, 2, 3, 4, 5] } })], ds, cs, NOW, S)!;
    expect(f.days).toHaveLength(7);
    const sat = f.days[0], mon = f.days[2]; // Sat 1 Aug, Mon 3 Aug
    expect(sat.dose).toBe(false);
    expect(mon.dose).toBe(true);
    expect(mon.values.focus!).toBeGreaterThan(sat.values.focus!);
  });
});
