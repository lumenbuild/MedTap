import { describe, it, expect } from 'vitest';
import type { Dose, Medication, PeptideVial } from '../src/db/schema';
import type { ScheduleSettings } from '../src/logic/schedule';
import { batchCompare, courseCalendar, learnedLeadDays, stackPlanItems, stackShop, strengthChange, vialYield } from '../src/logic/stackSmart';

const S: ScheduleSettings = { dayStartsAt: '00:00', tz: Intl.DateTimeFormat().resolvedOptions().timeZone, guardMinutes: 10 };
const DAY = 86_400_000;
const NOW = new Date(2026, 10, 7, 9, 0).getTime();
const st = { createdAt: '', updatedAt: '' };
const iso = (t: number) => new Date(t).toISOString();
const vial = (id: string, o: Partial<PeptideVial>): PeptideVial => ({ id, status: 'finished', amount: 10, addedAt: iso(NOW - 90 * DAY), ...o });
const med = (vials: PeptideVial[], o: Partial<Medication> = {}): Medication => ({ id: 'm', name: 'Tirzepatide', strength: 10, unit: 'mg', form: 'injection', defaultAmount: 2.5,
  schedule: { type: 'fixed', slots: [{ time: '08:00' }], days: [4] }, color: '', icon: 'syringe', archived: false,
  peptide: { kind: 'vial', waterMl: 2, syringe: 'U-100', syringeUnits: 100, useWithinDays: 28 }, vials, ...st, ...o });
const dose = (k: number, amount: number, vialId?: string, h = 8): Dose => { const d = new Date(NOW - k * DAY); d.setHours(h, 0, 0, 0); return { id: `d${k}-${h}`, medicationId: 'm', takenAt: iso(d.getTime()), amount, source: 'manual', vialId, ...st }; };

describe('a new vial at a different strength', () => {
  it('warns until confirmed: same dose, different units', () => {
    const m = med([vial('a', { waterMl: 2, startedAt: iso(NOW - 40 * DAY), finishedAt: iso(NOW - 3 * DAY) }), vial('b', { status: 'in-use', waterMl: 1, startedAt: iso(NOW - 3 * DAY) })]);
    const c = strengthChange(m)!;
    expect(c.unitsWas).toBe(50);
    expect(c.unitsNow).toBe(25);
    expect(c.checked).toBe(false);
    expect(strengthChange({ ...m, vials: m.vials!.map((v) => (v.id === 'b' ? { ...v, checkedAt: iso(NOW) } : v)) })!.checked).toBe(true);
  });
  it('the same strength: nothing to say', () => {
    expect(strengthChange(med([vial('a', { waterMl: 2, startedAt: iso(NOW - 40 * DAY), finishedAt: iso(NOW - 3 * DAY) }), vial('b', { status: 'in-use', waterMl: 2, startedAt: iso(NOW - 3 * DAY) })]))).toBeNull();
  });
});

describe('what vials actually give', () => {
  it('learns the loss per vial', () => {
    const vs = [0, 1].map((i) => vial(`v${i}`, { waterMl: 2, startedAt: iso(NOW - (60 - i * 30) * DAY), finishedAt: iso(NOW - (31 - i * 30) * DAY) }));
    const ds = [...[0, 1, 2].map((j) => dose(58 - j * 7, 2.5, 'v0')), ...[0, 1, 2].map((j) => dose(28 - j * 7, 2.5, 'v1'))];
    const y = vialYield(med(vs), ds)!;
    expect(y.expected).toBe(4);
    expect(y.actual).toBe(3);
    expect(y.lossPerVial).toBe(2.5);
  });
});

describe('batches on the goal', () => {
  it('notes a batch well off the others, neutrally', () => {
    const vs = [vial('a', { lot: 'A1', startedAt: iso(NOW - 60 * DAY), finishedAt: iso(NOW - 30 * DAY), cost: 200 }), vial('b', { lot: 'B2', status: 'in-use', startedAt: iso(NOW - 30 * DAY), cost: 150 })];
    const body = Array.from({ length: 30 }, (_, i) => { const k = 60 - i * 2; const t = NOW - k * DAY; const kg = k > 30 ? 110 - (60 - k) * 0.12 : 106.4 - (30 - k) * 0.01; const dd = new Date(t); return { id: `b${k}`, date: `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`, weightKg: kg, ...st }; });
    const b = batchCompare(med(vs), { doses: [], checkIns: [], daily: [], body }, NOW, S)!;
    expect(b.outcome).toBe('weight');
    expect(b.rows.find((x) => x.lot === 'A1')!.perMg).toBe(20);
    expect(b.note).toMatch(/batch B2/);
    expect(b.note).not.toMatch(/weak|bad|fake|purity/i);
  });
});

describe('the stack together', () => {
  const a = med([vial('x', { status: 'in-use', waterMl: 2, startedAt: iso(NOW - 26 * DAY) })]);
  it('learns delivery times from orders', () => {
    expect(learnedLeadDays([{ placedAt: iso(NOW - 20 * DAY), arrivedAt: iso(NOW - 15 * DAY) }, { placedAt: iso(NOW - 10 * DAY), arrivedAt: iso(NOW - 6 * DAY) }])).toEqual({ days: 5, learned: true });
    expect(learnedLeadDays([])).toEqual({ days: 7, learned: false });
  });
  it('one shopping list, and an order-by when stock runs short', () => {
    const shop = stackShop([a], [], NOW, S)!;
    expect(shop.items[0].vials).toBeGreaterThanOrEqual(1);
    expect(shop.orderBy).toBeDefined();
    const items = stackPlanItems([a], { doses: [], checkIns: [], daily: [], body: [] }, NOW, S);
    expect(items.map((i) => i.key.split(':')[0])).toEqual(expect.arrayContaining(['useby', 'order']));
  });
  it('courses on one calendar, with a note when two start together', () => {
    const today = new Date(NOW); const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate() + 2).padStart(2, '0')}`;
    const b = med([], { id: 'b', name: 'BPC-157', schedule: { type: 'fixed', slots: [{ time: '08:00' }], course: { start: ymd, days: 28, remindAfterDays: 28 } } });
    const c = med([], { id: 'c', name: 'TB-500', schedule: { type: 'fixed', slots: [{ time: '08:00' }], course: { start: ymd, days: 28 } } });
    const cal = courseCalendar([a, b, c], NOW, S);
    expect(cal.bars).toHaveLength(3);
    expect(cal.bars.find((x) => x.name === 'BPC-157')!.spans.map((x) => x.kind)).toContain('break');
    expect(cal.bars.find((x) => x.name === 'BPC-157')!.overlapNote).toMatch(/TB-500/);
  });
});
