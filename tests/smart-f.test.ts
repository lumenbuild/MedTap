import { describe, it, expect } from 'vitest';
import type { BodyEntry, CheckIn, DailyHealth, Dose, MedEvent, Medication } from '../src/db/schema';
import type { ScheduleSettings } from '../src/logic/schedule';
import { wearOffToday } from '../src/logic/wearOff';
import { weightStall } from '../src/logic/stall';
import { stepUpChecklist } from '../src/logic/stepUp';
import { whatChanged } from '../src/logic/changes';
import { ask, askSuggestions } from '../src/logic/ask';

const S: ScheduleSettings = { dayStartsAt: '04:00', tz: 'Australia/Sydney', guardMinutes: 10 };
const DAY = 86_400_000, HOUR = 3_600_000;
const NOW = new Date(2026, 9, 23, 15, 0).getTime(); // local 3 pm
const at = (daysAgo: number, h = 12) => { const d = new Date(NOW - daysAgo * DAY); d.setHours(h, 0, 0, 0); return d.getTime(); };
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const iso = (t: number) => new Date(t).toISOString();
const st = { createdAt: '', updatedAt: '' };
const med = (o: Partial<Medication>): Medication => ({ id: 'm', name: 'Vyvanse', strength: 50, unit: 'mg', form: 'capsule', defaultAmount: 50, schedule: { type: 'fixed', times: ['07:00'] } as Medication['schedule'], color: '', icon: 'pill', archived: false, ...st, ...o });
const dose = (medicationId: string, t: number, amount: number, o: Partial<Dose> = {}): Dose => ({ id: `${medicationId}${t}`, medicationId, takenAt: iso(t), amount, source: 'manual', ...st, ...o });
const ci = (t: number, o: Partial<CheckIn>): CheckIn => ({ id: `c${t}${Math.random()}`, at: iso(t), chips: [], ...st, ...o });

describe('wear-off forecast', () => {
  const vy = med({});
  const doses: Dose[] = [], cis: CheckIn[] = [], daily: DailyHealth[] = [];
  for (let k = 1; k <= 20; k++) {
    const t = at(k, 7);
    doses.push(dose('m', t, 50));
    const short = k % 2 === 0;
    daily.push({ id: `d${k}`, date: ymd(t), sleepMin: short ? 330 : 450, ...st });
    cis.push(ci(t + 2 * HOUR, { focus: 4 }), ci(t + 4 * HOUR, { focus: 4 }), ci(t - HOUR, { focus: 2 }));
    cis.push(ci(t + (short ? 5 : 7) * HOUR, { focus: 2, chips: ['Wearing off'] }));
  }
  it('learns that short nights bring it earlier', () => {
    const today = dose('m', at(0, 7), 50);
    const longNight = wearOffToday(vy, [...doses, today], cis, [...daily, { id: 'dt', date: ymd(NOW), sleepMin: 470, ...st }], NOW, S)!;
    const shortNight = wearOffToday(vy, [...doses, today], cis, [...daily, { id: 'dt', date: ymd(NOW), sleepMin: 300, ...st }], NOW, S)!;
    expect(longNight).toBeTruthy();
    expect(shortNight.at).toBeLessThan(longNight.at);
    expect(shortNight.reasons.join()).toMatch(/Short night/);
    expect(wearOffToday(vy, doses, cis, daily, NOW, S)).toBeNull(); // no dose today
  });
});

describe('stall detector', () => {
  const body: BodyEntry[] = [], daily: DailyHealth[] = [];
  for (let k = 70; k >= 0; k -= 2) {
    const losing = k > 21;
    const kg = losing ? 100 - (70 - k) * 0.1 : 100 - (70 - 22) * 0.1 + ((k % 4) - 1) * 0.1;
    body.push({ id: `b${k}`, date: ymd(at(k)), weightKg: Math.round(kg * 10) / 10, ...st });
    daily.push({ id: `p${k}`, date: ymd(at(k)), proteinG: losing ? 140 : 95, steps: 9000, ...st });
  }
  it('finds the plateau and what changed during it', () => {
    const s = weightStall({ body, checkIns: [], daily, doses: [], meds: [], workouts: [] }, NOW)!;
    expect(s).toBeTruthy();
    expect(s.days).toBeGreaterThanOrEqual(14);
    expect(s.before).toBeLessThan(-0.3);
    expect(s.likelyWater).toBe(false);
    expect(s.diffs.map((x) => x.key)).toContain('protein');
    expect(s.diffs.map((x) => x.key)).not.toContain('steps');
  });
  it('none while still losing', () => {
    const steady = body.map((b, i) => ({ ...b, weightKg: 100 - i * 0.2 }));
    expect(weightStall({ body: steady, checkIns: [], daily, doses: [], meds: [], workouts: [] }, NOW)).toBeNull();
  });
});

describe('step-up checklist', () => {
  const tz = med({ id: 't', name: 'Mounjaro', unit: 'mg', strength: 5, peptide: { waterMl: 0, syringe: 'U-100', syringeUnits: 50 } as Medication['peptide'],
    stepUp: { minWeeks: 4, maxEffectPct: 30, maxLossKgWeek: 0.5, minAppetite: 2, noMissedWeeks: 4 } });
  const doses = [42, 35, 28, 21, 14, 7, 0].map((k) => dose('t', at(k, 8), k > 35 ? 2.5 : 5));
  const cis = Array.from({ length: 10 }, (_, i) => ci(at(i, 18), { appetite: 3, chips: i === 0 ? ['Nausea'] : [] }));
  const body = Array.from({ length: 8 }, (_, i) => ({ id: `w${i}`, date: ymd(at(i * 3)), weightKg: 90 + i * 0.03, ...st }));
  it('ticks each criterion from the records', () => {
    const v = stepUpChecklist(tz, doses, cis, body, NOW, S)!;
    expect(v.amount).toBe(5);
    const by = Object.fromEntries(v.checks.map((c) => [c.key, c.ok]));
    expect(by).toEqual({ minWeeks: true, maxEffectPct: true, maxLossKgWeek: true, minAppetite: true, noMissedWeeks: true });
    const skipped = stepUpChecklist(tz, [...doses, dose('t', at(3, 8), 5, { skipped: true })], cis, body, NOW, S)!;
    expect(skipped.checks.find((c) => c.key === 'noMissedWeeks')!.ok).toBe(false);
  });
});

describe('what changed', () => {
  const daily: DailyHealth[] = [];
  for (let k = 90; k >= 0; k--) daily.push({ id: `d${k}`, date: ymd(at(k)), restingHr: (k > 30 ? 58 : 66) + (k % 3) - 1, sleepMin: 420 + (k % 5) * 6, ...st });
  const events: MedEvent[] = [{ id: 'e', medicationId: 't', at: iso(at(32)), kind: 'changed', summary: '5 → 7.5 mg' }];
  const meds = [med({ id: 't', name: 'Mounjaro' })];
  it('finds the shift and what came just before it', () => {
    const cs = whatChanged({ meds, doses: [], checkIns: [], daily, events }, NOW);
    const hr = cs.find((c) => c.key === 'restingHr')!;
    expect(hr).toBeTruthy();
    expect(Math.abs(hr.at - at(30))).toBeLessThanOrEqual(2 * DAY);
    expect(hr.after - hr.before).toBeGreaterThanOrEqual(6);
    expect(hr.good).toBe(false);
    expect(hr.event?.text).toMatch(/Mounjaro: 5 → 7.5 mg/);
    expect(cs.find((c) => c.key === 'sleep')).toBeUndefined(); // noise only
  });
});

describe('ask your data', () => {
  const pep = med({ id: 'p', name: 'Tirzepatide', unit: 'mg', peptide: { waterMl: 2, syringe: 'U-100', syringeUnits: 50 } as Medication['peptide'],
    vials: [
      { id: 'v1', status: 'finished', amount: 10, lot: 'A1', addedAt: iso(at(60)), startedAt: iso(at(56)), finishedAt: iso(at(29)) },
      { id: 'v2', status: 'in-use', amount: 10, lot: 'B2', addedAt: iso(at(30)), startedAt: iso(at(28)) },
    ] } as Partial<Medication>);
  const doses = [56, 49, 42, 35, 28, 21, 14, 7, 0].map((k) => dose('p', at(k, 8), k > 20 ? 5 : 7.5));
  const daily = Array.from({ length: 56 }, (_, k) => ({ id: `s${k}`, date: ymd(at(k)), sleepMin: k < 20 ? 360 : 450, ...st }));
  const cis = Array.from({ length: 56 }, (_, k) => ci(at(k, 18), { focus: new Date(at(k)).getDay() === 1 ? 2 : 4, chips: k >= 28 && k % 2 ? ['Nausea'] : [] }));
  const d = { meds: [pep], doses, checkIns: cis, body: [], daily, vitals: [], events: [] };
  it('since a dose step', () => {
    const r = ask("How's my sleep since 7.5 mg?", d, NOW);
    expect('answer' in r && r.answer).toMatch(/Sleep averaged 6 h since 7\.5 mg, down from 7 h before/);
  });
  it('by batch and by weekday', () => {
    const b = ask('Which batch had the most nausea?', d, NOW);
    expect('answer' in b && b.answer).toMatch(/^A1: 5\d%/);
    const w = ask('Focus by weekday', d, NOW);
    expect('bars' in w && w.bars?.find((x) => x.label === 'Monday')?.value).toBe(2);
    expect('error' in ask('what about my cat', d, NOW)).toBe(true);
    expect(askSuggestions(d)).toContain('Which batch had the most nausea?');
  });
});
