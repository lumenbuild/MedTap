import { describe, it, expect } from 'vitest';
import type { CheckIn, DailyHealth, Dose, Medication, Workout, BodyEntry } from '../src/db/schema';
import type { ScheduleSettings } from '../src/logic/schedule';
import { milestones, runOf, streaks, todayRing, type Mark } from '../src/logic/motivation';
import { usualAnswers } from '../src/logic/reminders';
import { CAFFEINE, intakesOf, usualHabits, usualKey, usualToAsk } from '../src/logic/caffeine';
import { getDayBounds } from '../src/logic/schedule';

const S: ScheduleSettings = { dayStartsAt: '04:00', tz: 'Australia/Sydney', guardMinutes: 10 };
const DAY = 86_400_000, HOUR = 3_600_000;
const st = { createdAt: '2026-01-01T00:00:00Z', updatedAt: '' };
const at = (d: string, hm: string) => new Date(`${d}T${hm}:00+11:00`).getTime();
const NOW = at('2026-10-30', '21:00');
const daysBack = (n: number) => new Date(NOW - n * DAY).toISOString().slice(0, 10);
const med: Medication = { id: 'm', name: 'Med', strength: 10, unit: 'mg', form: 'tablet', defaultAmount: 10, schedule: { type: 'fixed', times: ['08:00'] } as Medication['schedule'],
  color: '', icon: '', archived: false, ...st };
const dose = (t: number, extra: Partial<Dose> = {}): Dose => ({ id: `d${t}`, medicationId: 'm', takenAt: new Date(t).toISOString(), amount: 10, source: 'manual', ...st, ...extra });
const none = { meds: [] as Medication[], doses: [] as Dose[], checkIns: [] as CheckIn[], workouts: [] as Workout[], daily: [] as DailyHealth[], body: [] as BodyEntry[], goals: [], defs: [] };

describe('forgiving runs', () => {
  const run = (s: string, w = 7) => runOf([...s].map((c) => ({ d: 'done', x: 'miss', n: 'none', o: 'open', b: 'before' }[c] as Mark)), w, (i) => i);
  it('one off day in a week is forgiven; a second inside the week ends the run', () => {
    expect(run('ddddxdddd').length).toBe(9);
    expect(run('ddddxdddd').forgiven).toBe(1);
    expect(run('ddxddxddd').length).toBe(3);
    expect(run('dxdddddddxdd').length).toBe(12); // two misses 8 apart: both forgiven
  });
  it('an open today neither adds nor breaks; before the records starts over', () => {
    expect(run('dddo').length).toBe(3);
    expect(run('dddbdd').length).toBe(2);
    expect(run('ddddddddxxdd').best).toBe(9);
  });
});

describe('streaks', () => {
  it('doses: days with every set dose (a skip on purpose counts), one miss a week forgiven', () => {
    const doses: Dose[] = [];
    for (let n = 30; n >= 1; n--) if (n !== 10) doses.push(dose(at(daysBack(n), '08:00'), n === 5 ? { skipped: true } : {}));
    const [x] = streaks({ ...none, meds: [med], doses }, NOW, S, { training: false, checkIns: false });
    expect(x.key).toBe('doses');
    expect(x.length).toBe(30); // today still to do: neither adds nor breaks
    expect(x.todayDone).toBe(false);
    expect(x.hits.map((h) => h.length)).toEqual([7, 14, 30]);
  });
  it('doses: only days with a dose due count; a weekly injection’s other days neither add nor break', () => {
    const weekly: Medication = { ...med, id: 'w', schedule: { type: 'fixed', times: ['09:00'], days: [5] } as Medication['schedule'] }; // Fridays
    const doses: Dose[] = [];
    for (let n = 28; n >= 1; n--) { const t = at(daysBack(n), '09:00'); if (new Date(daysBack(n) + 'T12:00:00+11:00').getUTCDay() === 5) doses.push(dose(t, { medicationId: 'w' })); }
    const [x] = streaks({ ...none, meds: [weekly], doses }, NOW, S, { training: false, checkIns: false });
    expect(x.length).toBe(4); // four Fridays, not 28 days
    expect(x.todayDone).toBe(false); // today (a Friday) still to do
    // And the ring leaves it out on a day it isn't due.
    const thu = at('2026-10-29', '21:00');
    expect(todayRing({ meds: [weekly], doses, checkIns: [], daily: [] }, thu, S, { checkInTimes: [], water: null, protein: null, intake: false })).toBeNull();
    expect(todayRing({ meds: [weekly, med], doses: [dose(at('2026-10-29', '08:00'))], checkIns: [], daily: [] }, thu, S, { checkInTimes: [], water: null, protein: null, intake: false })!.parts[0].text).toBe('1 of 1');
  });
  it('check-ins: only ones that say how you are', () => {
    const cis: CheckIn[] = [];
    for (let n = 9; n >= 0; n--) cis.push({ id: `c${n}`, at: new Date(at(daysBack(n), '20:00')).toISOString(), chips: [], mood: 4, ...st });
    cis.push({ id: 'coffee', at: new Date(at(daysBack(11), '08:00')).toISOString(), chips: [CAFFEINE], caffeineMg: 80, ...st });
    const [x] = streaks({ ...none, checkIns: cis }, NOW, S, { training: false, checkIns: true });
    expect(x.length).toBe(10);
    expect(x.todayDone).toBe(true);
  });
});

describe('milestones and the ring', () => {
  it('every 5 kg towards a weight goal, halfway, and workout counts', () => {
    const body: BodyEntry[] = Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, date: daysBack(40 - i * 2), weightKg: 100 - i * 0.7, ...st }));
    const ws: Workout[] = Array.from({ length: 10 }, (_, i) => ({ id: `w${i}`, startedAt: new Date(NOW - (20 - i) * DAY).toISOString(), source: 'manual', sets: [], cardio: { activity: 'run', durationMin: 30 }, ...st } as Workout));
    const ms = milestones({ ...none, body, workouts: ws, goals: [{ metric: 'weightKg', target: 80, start: 100, startDate: daysBack(45) }] }, [], NOW, 'metric', { training: true, body: true });
    const titles = ms.map((m) => m.title);
    expect(titles).toContain('5 kg down');
    expect(titles).toContain('10 kg down');
    expect(titles).toContain('Halfway to your goal');
    expect(titles).not.toContain('Goal reached');
    expect(titles).toContain('10 workouts');
    expect(titles).toContain('Your first workout');
  });
  it('today’s ring: doses, check-in, water and protein, each counting the same', () => {
    const daily: DailyHealth[] = [{ id: 'x', date: '2026-10-30', waterMl: 2500, proteinG: 70, ...st }];
    const r = todayRing({ meds: [med], doses: [dose(at('2026-10-30', '08:00'))], checkIns: [], daily }, NOW, S, { checkInTimes: ['20:00'], water: 2500, protein: 140, intake: true })!;
    expect(r.parts.map((p) => p.key)).toEqual(['doses', 'checkin', 'water', 'protein']);
    expect(r.done).toBe(2);
    expect(r.value).toBeCloseTo((1 + 0 + 1 + 0.5) / 4);
    expect(todayRing({ meds: [], doses: [], checkIns: [], daily: [] }, NOW, S, { checkInTimes: [], water: null, protein: null, intake: false })).toBeNull();
  });
});

describe('same as usual', () => {
  it('finds a drink had most days at about the same time, and asks once it’s past', () => {
    const cis: CheckIn[] = [];
    for (let n = 12; n >= 1; n--) if (n % 5) cis.push({ id: `f${n}`, at: new Date(at(daysBack(n), n % 2 ? '08:00' : '08:20')).toISOString(), chips: [CAFFEINE], note: 'Flat white', caffeineMg: 160, ...st });
    cis.push({ id: 'tea', at: new Date(at(daysBack(3), '15:00')).toISOString(), chips: [CAFFEINE], note: 'Tea', caffeineMg: 45, ...st });
    const xs = intakesOf(cis);
    const morning = at('2026-10-30', '09:30');
    const [h, ...rest] = usualHabits(xs, morning, S);
    expect(rest).toHaveLength(0);
    expect(h).toMatchObject({ name: 'Flat white', mg: 160 });
    expect(usualToAsk([h], xs, at('2026-10-30', '08:30'), [], S)).toHaveLength(0); // not yet
    expect(usualToAsk([h], xs, morning, [], S)).toHaveLength(1);
    const logged = intakesOf([...cis, { id: 'now', at: new Date(at('2026-10-30', '08:10')).toISOString(), chips: [CAFFEINE], note: 'Flat white', caffeineMg: 160, ...st }]);
    expect(usualToAsk([h], logged, morning, [], S)).toHaveLength(0);
    const start = getDayBounds(morning, S.dayStartsAt, S.tz).start;
    expect(usualToAsk([h], xs, morning, [usualKey(h, start)], S)).toHaveLength(0);
  });
  it('usual check-in answers: the most common of each, from 5+ recent check-ins', () => {
    const cis: CheckIn[] = [4, 4, 3, 4, 5, 4].map((m, i) => ({ id: `c${i}`, at: new Date(NOW - (i + 1) * DAY).toISOString(), chips: [], mood: m, energy: 3, ...st }));
    expect(usualAnswers(cis, NOW)).toEqual({ mood: 4, energy: 3 });
    expect(usualAnswers(cis.slice(0, 4), NOW)).toBeNull();
    expect(usualAnswers([...cis.slice(0, 4), { id: 'w', at: new Date(NOW - HOUR).toISOString(), chips: ['Alcohol'], ...st }], NOW)).toBeNull();
  });
});
