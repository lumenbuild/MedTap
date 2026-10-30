import { describe, it, expect } from 'vitest';
import type { Workout, WorkoutSet } from '../src/db/schema';
import { BUILT_IN, swapsFor } from '../src/logic/exercises';
import { fmtLoad, fromLoad, roundLoad, showLoad, stepIn } from '../src/logic/load';
import { newPBs, nextTarget, platesFor, PLATES, restFor } from '../src/logic/training';
import { PLATES_LB } from '../src/logic/load';
import { habitText, planTrainingReminders, trainingHabit } from '../src/logic/trainingPlan';
import type { ScheduleSettings } from '../src/logic/schedule';
import { zonedToUtc } from '../src/logic/tz';

const TZ = 'Australia/Sydney';
const S: ScheduleSettings = { dayStartsAt: '04:00', tz: TZ, guardMinutes: 10 };
const syd = (date: string, time = '18:00') => { const [y, m, d] = date.split('-').map(Number); const [h, mi] = time.split(':').map(Number); return zonedToUtc(y, m, d, h, mi, TZ); };
let n = 0;
const set = (exerciseId: string, weightKg: number, reps: number, o: Partial<WorkoutSet> = {}): WorkoutSet => ({ id: `s${++n}`, exerciseId, weightKg, reps, done: true, ...o });
const wk = (t: number, sets: WorkoutSet[], o: Partial<Workout> = {}): Workout => ({ id: `w${++n}`, startedAt: new Date(t).toISOString(), endedAt: new Date(t + 3_600_000).toISOString(), sets, source: 'manual', createdAt: '', updatedAt: '', ...o });
const ex = (id: string) => BUILT_IN.find((e) => e.id === id)!;

describe('weights in lb', () => {
  it('shows, rounds and steps up in lb', () => {
    expect(showLoad(fromLoad(135, 'imperial'), 'imperial')).toBe(135);
    expect(fmtLoad(fromLoad(135, 'imperial'), 'imperial')).toBe('135 lb');
    expect(stepIn(ex('bench'), 'imperial')).toBe(5);
    expect(stepIn(ex('deadlift'), 'imperial')).toBe(10);
    expect(showLoad(roundLoad(fromLoad(137.3, 'imperial'), ex('bench'), 'imperial'), 'imperial')).toBe(135);
    const done = [wk(syd('2026-08-01'), [0, 1, 2].map(() => set('bench', fromLoad(135, 'imperial'), 8)))];
    const t = nextTarget(ex('bench'), done, undefined, 'imperial');
    expect(t.why).toBe('up');
    expect(showLoad(t.weightKg, 'imperial')).toBe(140); // not 140.5
    expect(nextTarget(ex('bench'), done, undefined, 'metric').weightKg).toBe(62.5); // 61.2 kg + 2.5, onto a loadable 2.5 kg step
    expect(newPBs(wk(syd('2026-08-04'), [set('bench', fromLoad(140, 'imperial'), 8)]), done, BUILT_IN, 'imperial')[0].text).toBe('Heaviest: 140 lb × 8');
  });
  it('plates in lb', () => {
    expect(platesFor(225, 45, PLATES_LB)).toEqual({ perSide: [45, 45], leftover: 0 });
    expect(platesFor(100, 20, PLATES)).toEqual({ perSide: [25, 15], leftover: 0 });
  });
});

describe('timed holds and bodyweight', () => {
  it('a plank goes up 5 seconds; push-ups a rep', () => {
    const plank = [wk(syd('2026-08-01'), [set('plank', 0, 45), set('plank', 0, 45)])];
    expect(nextTarget(ex('plank'), plank)).toMatchObject({ reps: 50, weightKg: 0, why: 'reps' });
    const pu = [wk(syd('2026-08-01'), [set('push-up', 0, 12), set('push-up', 0, 12), set('push-up', 0, 12)])];
    expect(nextTarget(ex('push-up'), pu)).toMatchObject({ reps: 13, why: 'reps' });
  });
});

describe('rest', () => {
  it('longer after heavy compound sets and very hard ones, shorter for small muscles, 15 s within a superset', () => {
    expect(restFor(ex('squat'), { reps: 3, weightKg: 140 }, 120)).toEqual({ seconds: 180, why: 'heavy set' });
    expect(restFor(ex('squat'), { reps: 8, weightKg: 100, rpe: 9.5 }, 120).seconds).toBe(150);
    expect(restFor(ex('curl'), { reps: 12, weightKg: 12 }, 120)).toEqual({ seconds: 90, why: 'smaller muscle' });
    expect(restFor(ex('curl'), { reps: 12, weightKg: 12 }, 120, true).seconds).toBe(15);
    expect(restFor(ex('curl'), { reps: 12, weightKg: 12 }, 0).seconds).toBe(0);
  });
});

describe('swaps', () => {
  it('same main muscle, ones done before first', () => {
    const list = swapsFor(ex('leg-press'), BUILT_IN, new Map([['split-squat', 5], ['hack-squat', 9]]));
    expect(list[0].id).toBe('hack-squat');
    expect(list[1].id).toBe('split-squat');
    expect(list.every((d) => d.muscles[0] === 'quads')).toBe(true);
    expect(swapsFor(ex('plank'), BUILT_IN).every((d) => d.timed)).toBe(true);
  });
});

describe('training reminders', () => {
  // Mon, Wed, Fri at about 6 pm for 6 weeks.
  const ws: Workout[] = [];
  for (let w = 0; w < 6; w++) for (const d of [0, 2, 4]) ws.push(wk(syd('2026-07-06', '18:00') + (w * 7 + d) * 86_400_000 + (d === 2 ? 10 * 60_000 : 0), [set('bench', 60, 8)]));
  const now = syd('2026-08-17', '07:00'); // a Monday morning
  it('learns the usual days and time', () => {
    const h = trainingHabit(ws, now, S)!;
    expect(h.days.map((d) => d.weekday)).toEqual([1, 3, 5]);
    expect(habitText(h)).toBe('Mon, Wed, Fri, around 6 pm');
  });
  it('reminds 30 minutes before on usual days, not on a day already trained', () => {
    const r = planTrainingReminders(ws, now, S);
    expect(r.map((x) => new Date(x.at).toISOString())).toEqual([syd('2026-08-17', '17:30'), syd('2026-08-19', '17:40'), syd('2026-08-21', '17:30')].map((t) => new Date(t).toISOString()));
    const trained = [...ws, wk(syd('2026-08-17', '06:30'), [set('bench', 60, 8)])];
    expect(planTrainingReminders(trained, now, S).some((x) => x.at === syd('2026-08-17', '17:30'))).toBe(false);
  });
  it('a note on the morning the week goal needs a session every day left', () => {
    const fri = syd('2026-08-21', '07:00');
    const thisWeek = ws.filter((w) => Date.parse(w.startedAt) < syd('2026-08-17', '00:00')); // nothing yet this week
    const r = planTrainingReminders(thisWeek, syd('2026-08-20', '07:00'), S, { perWeek: 3 });
    const note = r.find((x) => x.title.includes('to go this week'));
    expect(note && new Date(note.at).toISOString()).toBe(new Date(syd('2026-08-21', '08:30')).toISOString());
    expect(fri).toBeGreaterThan(0);
  });
  it('with a coach plan on set days: those days, at the usual time, naming the session', () => {
    const r = planTrainingReminders(ws, now, S, { plan: { weekdays: [2, 4], next: 'Strength A/B · B' } }); // Tue, Thu
    expect(r.map((x) => new Date(x.at).getUTCDay())).toEqual([2, 4]);
    expect(r[0].body).toBe('Strength A/B · B today.');
    expect(r[0].title).toBe('Tuesday training');
  });
  it('mentions a stronger day after the shot', () => {
    const r = planTrainingReminders(ws, now, S, { strongDays: [2], lastShot: syd('2026-08-15', '08:00'), shotEveryDays: 7 });
    expect(r[0].body).toContain('Day 2 after your shot');
  });
});
