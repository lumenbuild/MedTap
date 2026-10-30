import { describe, it, expect } from 'vitest';
import type { BodyEntry, CheckIn, DailyHealth, Dose, FoodLog, Medication } from '../src/db/schema';
import type { ScheduleSettings } from '../src/logic/schedule';
import { doseResponse, eveningCrash, focusAsk, secondDose, stimulantLoad } from '../src/logic/stimulant';
import { heartWatch, underEating } from '../src/logic/crossSmart';
import { costPerKg, missedShot, siteRotation, siteTooSoon } from '../src/logic/peptideSmart';
import { stepStatus } from '../src/logic/dosePlan';
import { lowestPlan, guideById } from '../src/logic/peptideGuide';
import { stepSummary } from '../src/components/DosePlan';

// The machine's own time zone, so local clock times in these records read the same to the code.
const S: ScheduleSettings = { dayStartsAt: '04:00', tz: Intl.DateTimeFormat().resolvedOptions().timeZone, guardMinutes: 10 };
const DAY = 86_400_000, HOUR = 3_600_000;
const NOW = new Date(2026, 9, 23, 15, 0).getTime(); // Friday, local 3 pm
const at = (daysAgo: number, h = 12, m = 0) => { const d = new Date(NOW - daysAgo * DAY); d.setHours(h, m, 0, 0); return d.getTime(); };
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const iso = (t: number) => new Date(t).toISOString();
const st = { createdAt: '', updatedAt: '' };
const med = (o: Partial<Medication>): Medication => ({ id: 'r', name: 'Ritalin', strength: 10, unit: 'mg', form: 'tablet', defaultAmount: 10, schedule: { type: 'fixed', slots: [{ time: '07:00' }, { time: '11:00' }] }, color: '', icon: 'pill', archived: false, ...st, ...o });
let n = 0;
const dose = (medicationId: string, t: number, amount: number, o: Partial<Dose> = {}): Dose => ({ id: `${medicationId}${t}${n++}`, medicationId, takenAt: iso(t), amount, source: 'manual', ...st, ...o });
const ci = (t: number, o: Partial<CheckIn>): CheckIn => ({ id: `c${t}${n++}`, at: iso(t), chips: [], ...st, ...o });
const ritalin = med({});

describe('stimulants', () => {
  it('asks about focus 45 minutes to 4 hours after a dose, once', () => {
    const d = dose('r', NOW - 90 * 60_000, 10);
    expect(focusAsk([ritalin], [d], [], NOW)?.dose.id).toBe(d.id);
    expect(focusAsk([ritalin], [d], [ci(NOW - 10 * 60_000, { focus: 4 })], NOW)).toBeNull();
    expect(focusAsk([ritalin], [dose('r', NOW - 20 * 60_000, 10)], [], NOW)).toBeNull();
    expect(focusAsk([med({ name: 'Panadol' })], [d], [], NOW)).toBeNull();
  });
  it('times the second dose to be working before the first wears off', () => {
    const first = dose('r', at(0, 7), 10);
    const sd = secondDose(ritalin, [first], [], [], at(0, 8), S)!;
    expect(sd).toBeTruthy();
    // Ritalin usually 3–5 h: wears off about 11 am, so the second about 10:30.
    expect(sd.wearAt - first.takenAt.length).toBeGreaterThan(0);
    expect((sd.wearAt - Date.parse(first.takenAt)) / HOUR).toBeCloseTo(4, 0);
    expect(sd.wearAt - sd.at).toBe(30 * 60_000);
    // Already taken the second: nothing.
    expect(secondDose(ritalin, [first, dose('r', at(0, 10, 30), 10)], [], [], at(0, 11), S)).toBeNull();
    // Once a day by schedule and habit: nothing.
    expect(secondDose(med({ schedule: { type: 'fixed', slots: [{ time: '07:00' }] } }), [first], [], [], at(0, 8), S)).toBeNull();
  });
  it('finds the dose that works best', () => {
    const doses: Dose[] = [], cis: CheckIn[] = [];
    for (let k = 1; k <= 12; k++) {
      const amt = k % 2 ? 10 : 20, t = at(k, 7);
      doses.push(dose('r', t, amt));
      cis.push(ci(t + 2 * HOUR, { focus: amt === 20 ? 4 : 3 }));
    }
    const r = doseResponse(ritalin, doses, cis, NOW, S)!;
    expect(r).toMatchObject({ by: 'amount', better: '20 mg', worse: '10 mg', focusBetter: 4, focusWorse: 3 });
  });
  it('spots evening crashes and when the last dose was', () => {
    const doses: Dose[] = [], cis: CheckIn[] = [];
    for (let k = 1; k <= 14; k++) {
      const crash = k % 3 === 0;
      doses.push(dose('r', at(k, 7), 10), dose('r', at(k, crash ? 10 : 12, 30), 10));
      cis.push(ci(at(k, 19), crash ? { mood: 2, energy: 2 } : { mood: 4 }));
    }
    const c = eveningCrash([ritalin], doses, cis, NOW, S)!;
    expect(c.crashDays).toBe(4);
    expect(c.days).toBe(14);
    expect(c.lastDoseCrash).toBe('10:30 am');
    expect(c.lastDoseOk).toBe('12:30 pm');
  });
  it('lanes for what overlaps today, with caffeine', () => {
    const semax = med({ id: 's', name: 'Semax', unit: 'mcg', peptide: { waterMl: 2, syringe: 'U-100', syringeUnits: 30 } });
    const doses = [dose('r', at(0, 7), 10), dose('s', at(0, 8), 300)];
    const l = stimulantLoad([ritalin, semax], doses, [{ id: 'k', t: at(0, 8), mg: 200 }], [], at(0, 9), S)!;
    expect(l.lanes.map((x) => x.label)).toEqual(['Ritalin', 'Semax']);
    expect(l.sources).toBe(3);
    expect(l.overlapFrom).toBe(at(0, 8));
    expect(stimulantLoad([ritalin], [dose('r', at(0, 7), 10)], [], [], at(0, 9), S)).toBeNull();
  });
});

describe('across medicines', () => {
  const reta = med({ id: 'g', name: 'Retatrutide', unit: 'mg', form: 'injection', defaultAmount: 1, schedule: { type: 'fixed', slots: [{ time: '08:00' }], days: [1, 4] } });
  it('resting heart rate drifting up', () => {
    const daily: DailyHealth[] = Array.from({ length: 42 }, (_, i) => ({ id: `d${i}`, date: ymd(at(i)), restingHr: i < 14 ? 70 : 62, ...st }));
    const doses = [dose('g', at(30, 8), 1), dose('g', at(10, 8), 2)];
    const h = heartWatch([reta], doses, daily, NOW, S)!;
    expect(h).toMatchObject({ now: 70, before: 62, change: 'Retatrutide 1 → 2 mg' });
    expect(heartWatch([reta], doses, daily.map((x) => ({ ...x, restingHr: 62 })), NOW, S)).toBeNull();
  });
  it('very little eaten with a GLP-1 and a stimulant on board', () => {
    const doses = [dose('g', at(2, 8), 1), dose('r', at(0, 7), 10)];
    const food: FoodLog[] = [{ id: 'f', at: iso(at(0, 9)), name: 'Toast', servings: 1, nutrients: { kcal: 300, protein: 10 }, ...st }];
    const u = underEating([reta, ritalin], doses, food, { kcal: 1800, protein: 120 }, NOW, S)!;
    expect(u.today).toMatchObject({ kcal: 300, protein: 10 });
    expect(underEating([reta], doses, food, { kcal: 1800, protein: 120 }, NOW, S)).toBeNull();
  });
});

describe('peptides', () => {
  const reta = med({ id: 'g', name: 'Retatrutide', unit: 'mg', form: 'injection', defaultAmount: 1, schedule: { type: 'fixed', slots: [{ time: '08:00' }], days: [1, 4] } });
  it('a missed shot: take it or skip it', () => {
    // Friday 3 pm; Thursday's shot missed, Monday's next: plenty of time, take it.
    const m = missedShot(reta, [dose('g', at(4, 8), 1)], NOW, S)!;
    expect(m.take).toBe(true);
    expect(m.text).toMatch(/Thursday/);
    // Sunday evening, Thursday's missed: Monday's is too close.
    const sun = at(-2, 20);
    expect(missedShot(reta, [dose('g', at(4, 8), 1)], sun, S)?.take).toBe(false);
    // Taken: nothing.
    expect(missedShot(reta, [dose('g', at(1, 8), 1)], NOW, S)).toBeNull();
  });
  it('rotates injection sites', () => {
    const doses = [dose('g', at(1), 1, { site: 'Belly, upper left' }), dose('g', at(4), 1, { site: 'Belly, upper right' })];
    const r = siteRotation(doses, NOW);
    expect(r.next).toBe('Belly, lower left');
    expect(siteTooSoon(r.sites.find((x) => x.site === 'Belly, upper left'), NOW)).toBe('Used 1 day ago');
    expect(siteTooSoon(r.sites.find((x) => x.site === 'Thigh, left'), NOW)).toBeUndefined();
  });
  it('cost per kg lost, by dose', () => {
    const priced = { ...reta, costPerUnit: 100, strength: 10, peptide: { waterMl: 1, syringe: 'U-100' as const, syringeUnits: 50 } };
    const doses = Array.from({ length: 8 }, (_, i) => dose('g', at(28 - i * 3.5, 8), 1));
    const body: BodyEntry[] = [{ id: 'a', date: ymd(at(29)), weightKg: 100, ...st }, { id: 'b', date: ymd(at(1)), weightKg: 97, ...st }];
    const c = costPerKg(priced, doses, body, [], NOW);
    expect(c).toHaveLength(1);
    expect(c[0].spent).toBe(80); // 8 mg at $10 a mg
    expect(c[0].perKg).toBeGreaterThan(20);
    expect(c[0].perKg).toBeLessThan(35);
  });
  it('the lowest dose that works: holds while losing, asks once loss slows', () => {
    const g = guideById('retatrutide')!;
    const lp = lowestPlan(g, 2)!;
    expect(lp.plan).toMatchObject({ by: 0.5, max: 12, maxPer: 'week', lowest: true });
    const m: Medication = { ...reta, stepPlan: lp.plan, stepUp: lp.criteria };
    const doses = Array.from({ length: 12 }, (_, i) => dose('g', at(42 - i * 3.5, 8), 1));
    const losing: BodyEntry[] = Array.from({ length: 10 }, (_, i) => ({ id: `w${i}`, date: ymd(at(20 - i * 2)), weightKg: 100 - i * 0.15, ...st }));
    const v = stepStatus(m, doses, [], losing, NOW, S)!;
    expect(v.ready).toBe(false);
    expect(stepSummary(m, v, NOW)).toMatch(/^Staying at 1 mg while it’s working: −0.5\d? kg a week/);
    const flat: BodyEntry[] = losing.map((b) => ({ ...b, weightKg: 98 }));
    const cis = [1, 4, 7, 10].map((d) => ci(at(d, 20), { mood: 4 }));
    expect(stepStatus(m, doses, cis, flat, NOW, S)!.ready).toBe(true);
  });
});
