import { describe, it, expect } from 'vitest';
import { cleanOcr, parseLabel, parseSchedule } from '../src/logic/label';

describe('parseLabel', () => {
  it('reads a typical Australian dispensing label', () => {
    const d = parseLabel(`RITALIN 10MG TABLETS
TAKE TWO TABLETS IN THE MORNING, TWO TABLETS AT
MIDDAY AND ONE TABLET AT 4PM
Mr John CITIZEN 15/10/26
Dr A Smith Qty: 100 Rpt 1 of 5
Keep out of reach of children
Example Pharmacy Ph: 02 9999 9999`);
    expect(d.name).toBe('Ritalin');
    expect(d.strength).toBe(10);
    expect(d.unit).toBe('mg');
    expect(d.form).toBe('tablet');
    expect(d.directions).toBe('Take two tablets in the morning, two tablets at midday and one tablet at 4pm.');
    expect(d.schedule).toEqual({ type: 'fixed', slots: [{ time: '08:00', count: 2 }, { time: '12:00', count: 2 }, { time: '16:00', count: 1 }] });
    expect(d.quantity).toBe(100);
    expect(d.repeats).toBe(4);
    expect(d.prescriber).toBe('Dr A Smith');
  });

  it('copes with OCR slips and a name on the line above the strength', () => {
    const d = parseLabel(`Methylphenidate
1O mg tablet
Take ONE tablet twice a day with food
Qty 6O`);
    expect(d.name).toBe('Methylphenidate');
    expect(d.strength).toBe(10);
    expect(d.count).toBe(1);
    expect(d.schedule).toEqual({ type: 'fixed', slots: [{ time: '08:00' }, { time: '20:00' }] });
    expect(d.quantity).toBe(60);
  });

  it('copes with lost spaces and 1 read as l', () => {
    const d = parseLabel('RITALIN 10MG TABLETS\nTAKE ONE TABLET DAILY\nDrASmith Qty: 100 Rptl of 5');
    expect(d.prescriber).toBe('Dr A Smith');
    expect(d.repeats).toBe(4);
  });

  it('as needed with limits', () => {
    const d = parseLabel(`PARACETAMOL 500MG TABLETS
Take 1 to 2 tablets every 4 to 6 hours when required.
Max 8 tablets in 24 hours.`);
    expect(d.name).toBe('Paracetamol');
    expect(d.count).toBe(1);
    expect(d.schedule).toEqual({ type: 'prn', minHoursApart: 4, maxCount: 8 });
  });

  it('weekly injection on a named day, with an expiry', () => {
    const d = parseLabel(`Mounjaro 2.5mg/0.5mL injection pen
Inject 2.5mg once a week on Sunday morning
Dr Jane Lee
EXP 03/2027`);
    expect(d.form).toBe('injection');
    expect(d.schedule).toEqual({ type: 'fixed', slots: [{ time: '08:00' }], days: [0], everyNDays: undefined });
    expect(d.expiry).toBe('2027-03-31');
    expect(d.prescriber).toBe('Dr Jane Lee');
  });

  it('liquids keep the per-mL strength in the name', () => {
    const d = parseLabel(`AMOXICILLIN 250mg/5mL SUSPENSION
Give 5mL three times a day
Discard after 12/11/26`);
    expect(d.name).toBe('Amoxicillin 250 mg/5 mL');
    expect(d.unit).toBe('mL');
    expect(d.form).toBe('liquid');
    expect(d.count).toBe(5);
    expect(d.schedule).toEqual({ type: 'fixed', slots: [{ time: '08:00' }, { time: '14:00' }, { time: '20:00' }] });
    expect(d.expiry).toBe('2026-11-12');
  });

  it('returns what it can from a partial read', () => {
    expect(parseLabel('blurry nonsense')).toEqual({});
    expect(parseLabel('Atorvastatin 40 mg\nTake one tablet at night').schedule).toEqual({ type: 'fixed', slots: [{ time: '21:00' }] });
  });
});

describe('parseSchedule', () => {
  it('every few hours', () => {
    expect(parseSchedule('Take one capsule every 8 hours').schedule).toEqual({ type: 'interval', hours: 8 });
  });
  it('every second day', () => {
    expect(parseSchedule('Take one tablet every second day in the morning').schedule).toEqual({ type: 'fixed', slots: [{ time: '08:00' }], days: undefined, everyNDays: 2 });
  });
  it('half a tablet', () => {
    expect(parseSchedule('Take half a tablet daily').count).toBe(0.5);
  });
  it('max doses per day for as needed', () => {
    expect(parseSchedule('Use 2 puffs when required, no more than 4 times a day').schedule).toEqual({ type: 'prn', maxDoses: 4 });
  });
});

describe('cleanOcr', () => {
  it('fixes O for 0 inside amounts', () => {
    expect(cleanOcr('2O mg  and 1O0mcg')).toBe('20 mg and 100mcg');
  });
});
