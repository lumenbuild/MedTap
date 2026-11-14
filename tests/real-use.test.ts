import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { dataCheck, startClusters, startedWith, startWatch, walkingToday, unfilledStrength } from '../src/logic/realUse';
import type { DailyHealth, Dose, Medication, Workout } from '../src/db/schema';
import { DEFAULT_SETTINGS, scheduleSettings } from '../src/db/repos/settings';

const s = { ...scheduleSettings(DEFAULT_SETTINGS), tz: 'UTC', dayStartsAt: '00:00' };
const med = (id: string, name: string, created: string, extra: Partial<Medication> = {}): Medication => ({ id, name, strength: 1, unit: 'mg', form: 'tablet', defaultAmount: 1,
  schedule: { type: 'fixed', slots: [{ time: '08:00' }] }, color: '', icon: '', archived: false, createdAt: `${created}T08:00:00Z`, updatedAt: '', ...extra });
const now = Date.parse('2026-03-20T12:00:00Z');

describe('what started together', () => {
  it('3 starts within 10 days make one stretch, with HRV before and after', () => {
    const meds = [med('a', 'A', '2026-03-01'), med('b', 'B', '2026-03-04'), med('c', 'C', '2026-03-08'), med('d', 'D', '2026-01-01')];
    const daily: DailyHealth[] = [];
    for (let i = 0; i < 40; i++) { const t = Date.parse('2026-02-10T12:00:00Z') + i * 86_400_000; const date = new Date(t).toISOString().slice(0, 10); daily.push({ id: date, date, createdAt: '', updatedAt: '', hrvMs: t < Date.parse('2026-03-01') ? 27 : 19 }); }
    const c = startClusters(meds, daily, now);
    expect(c).toHaveLength(1);
    expect(c[0].meds.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(c[0].hrv).toEqual({ before: 27, after: 19 });
    expect(startedWith(meds[0], meds).map((m) => m.id)).toEqual(['b', 'c']);
  });
  it('a real start date moves a medicine out of the stretch', () => {
    const meds = [med('a', 'A', '2026-03-01', { startedOn: '2025-12-01' }), med('b', 'B', '2026-03-04'), med('c', 'C', '2026-03-08')];
    expect(startClusters(meds, [], now)).toHaveLength(0);
  });
});

describe('first weeks on guanfacine', () => {
  it('counts the scheduled days in a row without a logged dose', () => {
    const m = med('g', 'Intuniv', '2026-03-10', { ingredients: [{ name: 'guanfacine' }] });
    const doses: Dose[] = [{ id: '1', medicationId: 'g', takenAt: '2026-03-17T08:00:00Z', amount: 1, source: 'manual', createdAt: '', updatedAt: '' }];
    const w = startWatch([m], doses, [], [], now, s);
    expect(w).toHaveLength(1);
    expect(w[0].missedRun).toBe(2); // the 18th and 19th
  });
});

describe('data check', () => {
  it('finds a medicine added twice and doses logged twice', () => {
    const a = med('a', 'BPC 157', '2026-02-01', { archived: true }), b = med('b', 'BPC-157', '2026-03-01');
    const d = (id: string, created: string, taken: string): Dose => ({ id, medicationId: 'b', takenAt: taken, amount: 1, source: 'manual', createdAt: created, updatedAt: '' });
    const issues = dataCheck({ meds: [a, b], doses: [d('1', '2026-03-13T10:07:00Z', '2026-03-13T09:00:00Z'), d('2', '2026-03-13T10:07:30Z', '2026-03-13T10:07:00Z')], body: [], daily: [], foodLogs: [], experiments: [], foodOn: false }, now, s);
    expect(issues.find((x) => x.kind === 'twice')).toMatchObject({ medId: 'b', otherId: 'a' });
    expect(issues.find((x) => x.kind === 'double')?.doseIds).toEqual(['2']);
  });
});

describe('walking and watch strength sessions', () => {
  const w = (id: string, at: string, title: string, activity: 'walk' | 'other', min: number, hrMin?: number[]): Workout => ({ id, startedAt: at, sets: [], source: 'health', createdAt: '', updatedAt: '', cardio: { activity, durationMin: min, title, hrMin } } as Workout);
  it('adds up today’s walks with time by effort', () => {
    const r = walkingToday([w('1', '2026-03-20T08:00:00Z', 'Walk', 'walk', 20, [100, 120, 140]), w('2', '2026-03-20T10:00:00Z', 'Walk', 'walk', 15)], now, s, 170);
    expect(r).toMatchObject({ minutes: 35, walks: 2, zones: { easy: 1, steady: 1, harder: 1 } });
  });
  it('lists strength sessions with no sets', () => {
    expect(unfilledStrength([w('1', '2026-03-18T08:00:00Z', 'Strength training', 'other', 23), w('2', '2026-03-18T09:00:00Z', 'Walk', 'walk', 20)], now).map((x) => x.id)).toEqual(['1']);
  });
});

import { db } from '../src/db/db';
import { createMed, mergeMeds, rescaleDoses } from '../src/db/repos/meds';
import { logDose } from '../src/db/repos/doses';
describe('merge and rescale', () => {
  it('moves doses to the kept medicine and removes the other', async () => {
    const base = { strength: 10, unit: 'mg', form: 'injection', defaultAmount: 1, schedule: { type: 'fixed' as const, slots: [{ time: '20:00' }] }, color: '', icon: '' };
    const a = await createMed({ ...base, name: 'BPC 157' }); const b = await createMed({ ...base, name: 'BPC-157' });
    await logDose({ medicationId: a.id, takenAt: '2026-01-01T09:00:00Z', amount: 1, source: 'manual' });
    await logDose({ medicationId: b.id, takenAt: '2026-02-01T09:00:00Z', amount: 0.5, source: 'manual' });
    await mergeMeds(b.id, a.id);
    expect(await db.medications.get(a.id)).toBeUndefined();
    expect(await db.doses.where('medicationId').equals(b.id).count()).toBe(2);
    expect((await db.medEvents.where('medicationId').equals(b.id).toArray()).filter((e) => e.kind === 'started')).toHaveLength(1);
  });
  it('keeps the number of tablets when the strength is corrected', async () => {
    const m = await createMed({ name: 'Magnesium', strength: 1.2, unit: 'mg', form: 'tablet', defaultAmount: 1.2, schedule: { type: 'fixed', slots: [{ time: '20:00' }] }, color: '', icon: '' });
    const d = await logDose({ medicationId: m.id, takenAt: '2026-01-01T20:00:00Z', amount: 2.4, source: 'manual' });
    await rescaleDoses(m.id, 1.2, 600);
    expect((await db.doses.get(d.id))!.amount).toBe(1200);
  });
});
