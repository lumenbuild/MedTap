import { describe, it, expect } from 'vitest';
import type { BodyEntry, CheckIn, Dose, Medication } from '../src/db/schema';
import { chipsFromNote, oddRecords, parseExpiry, parseLabResults, parseVialLabel, scriptPlan } from '../src/logic/records';
import { travelPlan } from '../src/logic/travel';
import { appointmentsAround, summarySince } from '../src/logic/appointments';
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
const med = (o: Partial<Medication> = {}): Medication => ({
  id: 'm', name: 'Vyvanse', strength: 50, unit: 'mg', form: 'capsule', defaultAmount: 50, color: '', icon: 'pill', archived: false,
  schedule: { type: 'fixed', slots: [{ time: '07:30' }] }, createdAt: '', updatedAt: '', ...o,
});
const NOW = syd('2026-08-03', '12:00');

describe('scripts', () => {
  it('new script needed when stock plus repeats runs out; book two weeks before', () => {
    // 10 left + 2 repeats of 30 = 70 days of one a day.
    const p = scriptPlan(med({ stockCount: 10, repeatsLeft: 2, packSize: 30 }), [], NOW, S)!;
    expect(p.reason).toBe('repeats');
    const days = Math.round((p.needBy! - NOW) / DAY);
    expect(days).toBeGreaterThanOrEqual(69);
    expect(days).toBeLessThanOrEqual(71);
    expect(p.bookBy).toBe(p.needBy! - 14 * DAY);
    expect(p.lastRepeat).toBe(false);
  });
  it('or when the script expires, if that comes first', () => {
    const p = scriptPlan(med({ stockCount: 10, repeatsLeft: 1, packSize: 30, scriptExpiry: '2026-08-20' }), [], NOW, S)!;
    expect(p.reason).toBe('expiry');
    expect(p.lastRepeat).toBe(true);
    expect(scriptPlan(med({ stockCount: 10 }), [], NOW, S)).toBeNull();
  });
});

describe('notes into chips', () => {
  const chips = ['Headache', 'Nausea', 'Trouble sleeping', 'Irritable', 'Low appetite', 'Focused'];
  it('finds what a note mentions', () => {
    expect(chipsFromNote('bit queasy this arvo, slept badly', chips, [])).toEqual(['Nausea', 'Trouble sleeping']);
    expect(chipsFromNote('Got heaps done, really focused', chips, [])).toEqual(['Focused']);
  });
  it('skips ticked chips, chips not in use, and negations', () => {
    expect(chipsFromNote('headache', chips, ['Headache'])).toEqual([]);
    expect(chipsFromNote('felt jittery', chips, [])).toEqual([]);
    expect(chipsFromNote('not queasy at all today', chips, [])).toEqual([]);
  });
});

describe('odd records', () => {
  it('a dose logged twice, a weight far off, and a dose in the future', () => {
    const doses = [dose(NOW - 60 * 60_000, { source: 'tag' }), dose(NOW - 57 * 60_000, { source: 'manual' }), dose(NOW + DAY)];
    const body: BodyEntry[] = Array.from({ length: 8 }, (_, i) => ({ id: `b${i}`, date: `2026-07-${String(20 + i).padStart(2, '0')}`, weightKg: i === 4 ? 9.1 : 91 - i * 0.1, createdAt: '', updatedAt: '' }));
    const odd = oddRecords([med()], doses, body, [], [], NOW);
    expect(odd.map((o) => o.kind).sort()).toEqual(['double-dose', 'future', 'weight-off-trend']);
    expect(oddRecords([med()], doses, body, [], [], NOW, odd.map((o) => o.id))).toEqual([]);
  });
});

describe('reading labels', () => {
  it('a vial label: lot, expiry and amount', () => {
    const v = parseVialLabel('TIRZEPATIDE\n10 mg\nLyophilised powder\nLot: TZ-2402\nEXP 07/2027\nStore 2-8°C');
    expect(v).toEqual({ lot: 'TZ-2402', expiry: '2027-07-31', amount: 10, unit: 'mg' });
    expect(parseVialLabel('Batch no. AB1234\nUse by 12 Mar 2027\n500 mcg').expiry).toBe('2027-03-12');
  });
  it('expiry forms', () => {
    expect(parseExpiry('2027-03-01')).toBe('2027-03-01');
    expect(parseExpiry('01/03/27')).toBe('2027-03-01');
    expect(parseExpiry('Mar 2027')).toBe('2027-03-31');
  });
  it('a pathology printout: results with units and ranges, not the header', () => {
    const text = [
      'Patient: J Smith   DOB 01/01/1980',
      'Collected: 14/07/2026',
      'HbA1c 5.6 % (4.0-6.0)',
      'Glucose (fasting) 6.4 H mmol/L (3.0-5.4)',
      'Total cholesterol 4.8 mmol/L (<5.5)',
      'eGFR >90 mL/min/1.73m2',
    ].join('\n');
    const r = parseLabResults(text);
    expect(r.date).toBe('2026-07-14');
    expect(r.results.map((x) => x.name)).toEqual(['HbA1c', 'Glucose (fasting)', 'Total cholesterol', 'eGFR']);
    expect(r.results[0]).toMatchObject({ value: 5.6, unit: '%', range: '4.0–6.0' });
    expect(r.results[1]).toMatchObject({ value: 6.4, flag: 'H', unit: 'mmol/L' });
    expect(parseLabResults('HbAlc 5.6 % (4.0-6.0)').results[0].name).toBe('HbA1c'); // OCR read 1 as l
  });
});

describe('travel', () => {
  it('Sydney to London: switching straight away makes a long gap; moving gradually keeps gaps near a day', () => {
    const p = travelPlan(med(), 'Australia/Sydney', 'Europe/London', '2026-08-10')!;
    expect(p.shiftH).toBe(-9);
    expect(p.switchNow.longest).toBe(33);
    expect(p.switchNow.flags.join()).toMatch(/33 h/);
    expect(p.gradual.longest).toBeLessThanOrEqual(26);
    expect(p.gradual.flags).toEqual([]);
  });
  it("flags a gap under the person's own minimum", () => {
    // 7 am and 7 pm, at least 10 h apart. Flying east 9 h and switching at once: 7 pm London to 7 am Sydney is 3 h.
    const twice = med({ schedule: { type: 'fixed', slots: [{ time: '07:00' }, { time: '19:00' }], minHoursApart: 10 } });
    const p = travelPlan(twice, 'Europe/London', 'Australia/Sydney', '2026-08-10')!;
    expect(p.shiftH).toBe(9);
    expect(p.switchNow.shortest).toBe(3);
    expect(p.switchNow.flags.join()).toMatch(/under your minimum of 10 h/);
    // Twice a day normally: no flags at all when nothing changes.
    expect(travelPlan(twice, 'Europe/London', 'Europe/London', '2026-08-10')!.switchNow.flags).toEqual([]);
  });
  it('a weekly injection keeps about a week between shots', () => {
    const weekly = med({ schedule: { type: 'fixed', slots: [{ time: '08:00' }], days: [3] } });
    const p = travelPlan(weekly, 'Australia/Sydney', 'Europe/London', '2026-08-10')!;
    expect(p.usualGapH).toBe(168);
    expect(p.switchNow.flags).toEqual([]); // 177 h instead of 168: within a quarter
    expect(p.switchNow.longest).toBe(177);
  });
});

describe('since the last appointment', () => {
  it('compares adherence, check-ins and side effects with the same time before', () => {
    const appts = [{ id: 'a', date: '2026-07-20', createdAt: '', updatedAt: '' }, { id: 'b', date: '2026-08-20', createdAt: '', updatedAt: '' }];
    const { last, next } = appointmentsAround(appts, '2026-08-03');
    expect(last!.id).toBe('a');
    expect(next!.id).toBe('b');
    const doses: Dose[] = [];
    for (let i = 1; i <= 28; i++) { const t = syd('2026-07-06', '07:30') + i * DAY; if (t < NOW && (t > syd('2026-07-20') || i % 2)) doses.push(dose(t)); }
    const cis: CheckIn[] = [
      ...Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, at: iso(syd('2026-07-10') + i * DAY), focus: 2, chips: ['Headache'], createdAt: '', updatedAt: '' })),
      ...Array.from({ length: 5 }, (_, i) => ({ id: `q${i}`, at: iso(syd('2026-07-25') + i * DAY), focus: 4, chips: [], createdAt: '', updatedAt: '' })),
    ];
    const sum = summarySince('2026-07-20', NOW, S, { meds: [med()], doses, checkIns: cis, body: [], vitals: [], events: [], labs: [], questions: [{ id: 'q', text: 'Can I take it later?', createdAt: '', updatedAt: '' }] });
    expect(sum.meds[0].pct).toBeGreaterThan(sum.meds[0].pctBefore!);
    expect(sum.checkIns.focus).toEqual({ since: 4, before: 2 });
    expect(sum.chips[0]).toMatchObject({ chip: 'Headache', since: 0, before: 5 });
    expect(sum.questions).toHaveLength(1);
  });
});
