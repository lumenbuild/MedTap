import { describe, it, expect } from 'vitest';
import type { DailyHealth, Dose, Medication } from '../src/db/schema';
import type { ScheduleSettings } from '../src/logic/schedule';
import { courseSleep, heartResponse, heartToday, restingSeries, shotWeek } from '../src/logic/watchSignals';
import { sleepImpact } from '../src/logic/habits';
import { wearOffToday } from '../src/logic/wearOff';
import { secondDose } from '../src/logic/stimulant';

const S: ScheduleSettings = { dayStartsAt: '04:00', tz: Intl.DateTimeFormat().resolvedOptions().timeZone, guardMinutes: 10 };
const DAY = 86_400_000, HOUR = 3_600_000;
const NOW = new Date(2026, 9, 23, 15, 0).getTime();
const at = (daysAgo: number, h = 12, m = 0) => { const d = new Date(NOW - daysAgo * DAY); d.setHours(h, m, 0, 0); return d.getTime(); };
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const iso = (t: number) => new Date(t).toISOString();
const st = { createdAt: '', updatedAt: '' };
let n = 0;
const dose = (medicationId: string, t: number, amount: number): Dose => ({ id: `${medicationId}${t}${n++}`, medicationId, takenAt: iso(t), amount, source: 'manual', ...st });
const ritalin: Medication = { id: 'r', name: 'Ritalin', strength: 10, unit: 'mg', form: 'tablet', defaultAmount: 10, schedule: { type: 'fixed', slots: [{ time: '08:00' }, { time: '12:00' }] }, color: '', icon: 'pill', archived: false, ...st };

/** A day of 5-minute heart rate: 62 at rest, rising from 45 minutes after an 8 am dose to +10 by 1h45, back by 4h. */
function dayWithDose(daysAgo: number, opts: { walkAt?: number; noise?: number } = {}): DailyHealth {
  const hr5: (number | null)[] = [], steps5: number[] = [];
  for (let i = 0; i < 288; i++) {
    const min = i * 5 - 8 * 60; // minutes since the dose
    let v = 62;
    if (min >= 45 && min < 105) v += ((min - 45) / 60) * 10;
    else if (min >= 105 && min < 180) v += 10;
    else if (min >= 180 && min < 240) v += 10 - ((min - 180) / 60) * 10;
    v += ((i * 7 + daysAgo) % 3) - 1 + (opts.noise ?? 0);
    const walking = opts.walkAt !== undefined && min >= opts.walkAt && min < opts.walkAt + 20;
    hr5.push(i < 6 * 12 ? null : Math.round(walking ? v + 30 : v));
    steps5.push(walking ? 500 : 10);
  }
  return { id: `d${daysAgo}`, date: ymd(at(daysAgo)), hr5, steps5, ...st };
}

describe('heart rate after a dose', () => {
  const daily = Array.from({ length: 10 }, (_, k) => dayWithDose(k + 1, { walkAt: k % 2 ? 120 : undefined }));
  const doses = Array.from({ length: 10 }, (_, k) => dose('r', at(k + 1, 8), 10));
  it('leaves out moving', () => {
    const s = restingSeries([dayWithDose(1, { walkAt: 120 })], at(1, 10), at(1, 10, 30), S);
    expect(s.filter((v) => v === null).length).toBeGreaterThanOrEqual(4);
  });
  it('learns when it starts, peaks and settles', () => {
    const r = heartResponse(ritalin, doses, [], daily, NOW, S)!;
    expect(r.signal).toBe(true);
    expect(r.doses).toBe(10);
    expect(r.baseline).toBe(62);
    expect(r.peakBpm).toBeGreaterThanOrEqual(9);
    expect(r.onsetMin!).toBeGreaterThanOrEqual(60);
    expect(r.onsetMin!).toBeLessThanOrEqual(90);
    expect(r.wearOffMin!).toBeGreaterThanOrEqual(200);
    expect(r.wearOffMin!).toBeLessThanOrEqual(240);
  });
  it('takes off the usual morning rise, from days without a dose', () => {
    // Every morning heart rate climbs 4 bpm from 8:30 whatever happens; dose days add the dose's 10 on top.
    const climb = (d: DailyHealth): DailyHealth => ({ ...d, hr5: d.hr5!.map((v, i) => (v === null ? null : i * 5 - 8 * 60 >= 30 && i * 5 - 8 * 60 < 300 ? v + 4 : v)) });
    const off = Array.from({ length: 5 }, (_, k) => { const d = climb(dayWithDose(20 + k)); return { ...d, hr5: d.hr5!.map((v, i) => (v === null ? null : (i * 5 - 8 * 60 >= 45 && i * 5 - 8 * 60 < 240 ? 62 + 4 : v))) }; });
    const without = heartResponse(ritalin, doses, [], daily.map(climb), NOW, S)!;
    const withCtl = heartResponse(ritalin, doses, [], [...daily.map(climb), ...off.map((d) => ({ ...d, hr5: d.hr5!.map((v, i) => (v === null ? null : i * 5 - 8 * 60 >= 30 && i * 5 - 8 * 60 < 300 ? 66 : 62)) }))], NOW, S)!;
    expect(without.peakBpm).toBeGreaterThanOrEqual(13);
    expect(withCtl.controlDays).toBe(5);
    expect(withCtl.peakBpm).toBeLessThan(without.peakBpm - 2);
  });
  it('no rise, no signal', () => {
    const flat = daily.map((d) => ({ ...d, hr5: d.hr5!.map((v) => (v === null ? null : 62)) }));
    expect(heartResponse(ritalin, doses, [], flat, NOW, S)!.signal).toBe(false);
  });
  it('today: risen, then settled', () => {
    const r = heartResponse(ritalin, doses, [], daily, NOW, S)!;
    const today = dayWithDose(0);
    const d = dose('r', at(0, 8), 10);
    expect(heartToday(r, d, [...daily, today], at(0, 10), S)).toMatchObject({ rising: true, settled: false });
    expect(heartToday(r, d, [...daily, today], at(0, 13), S)).toMatchObject({ settled: true });
  });
  it('the wear-off forecast and the second dose use it', () => {
    const today = dayWithDose(0);
    const d = dose('r', at(0, 8), 10);
    const w = wearOffToday(ritalin, [...doses, d], [], [...daily, today], at(0, 9), S)!;
    expect(w.reasons.join()).toMatch(/heart rate after 10 doses/);
    expect((w.at - at(0, 8)) / HOUR).toBeGreaterThan(3.2);
    expect((w.at - at(0, 8)) / HOUR).toBeLessThan(4.1);
    const sd = secondDose(ritalin, [...doses, d], [], [...daily, today], at(0, 9), S)!;
    expect(sd.leadMin).toBeGreaterThanOrEqual(55);
    // Settled early today (back to 62 from 2½ hours): wearing off now, ahead of the usual time.
    const early = { ...today, hr5: today.hr5!.map((v, i) => (v !== null && i * 5 - 8 * 60 >= 150 ? 62 : v)) };
    const w2 = wearOffToday(ritalin, [...doses, d], [], [...daily, early], at(0, 11, 15), S)!;
    expect(w2.heartBack).toBe(true);
  });
});

describe('sleep from the watch', () => {
  it('late doses against the night after', () => {
    const doses: Dose[] = [], daily: DailyHealth[] = [];
    for (let k = 1; k <= 12; k++) {
      const late = k % 2 === 0;
      doses.push(dose('r', at(k + 1, late ? 15 : 11), 10));
      daily.push({ id: `n${k}`, date: ymd(at(k)), sleepMin: late ? 380 : 450, sleepDeepMin: late ? 50 : 75, ...st });
    }
    const r = sleepImpact([ritalin], doses, [], NOW, S, daily)!;
    expect(r.watch).toBe(true);
    expect(r.cutoffHour).toBeGreaterThan(11);
    expect(r.cutoffHour).toBeLessThanOrEqual(15);
    expect(r.before.deepMin).toBe(75);
    expect(r.after.deepMin).toBe(50);
  });
  it('DSIP: nights after a dose against others', () => {
    const dsip: Medication = { ...ritalin, id: 'p', name: 'DSIP', unit: 'mg' };
    const doses: Dose[] = [], daily: DailyHealth[] = [];
    for (let k = 1; k <= 20; k++) {
      const on = k <= 10;
      if (on) doses.push(dose('p', at(k + 1, 21), 0.25));
      daily.push({ id: `s${k}`, date: ymd(at(k)), sleepMin: on ? 470 : 430, sleepDeepMin: on ? 85 : 65, sleepWakes: on ? 2 : 4, ...st });
    }
    const c = courseSleep(dsip, doses, daily, NOW, S)!;
    expect(c.on).toMatchObject({ nights: 10, deepMin: 85, wakes: 2 });
    expect(c.off).toMatchObject({ nights: 10, deepMin: 65, wakes: 4 });
    expect(c.better).toBe(true);
    expect(c.lines).toHaveLength(3);
  });
});

describe('a weekly shot through the week', () => {
  it('resting heart rate by days since the shot, and by dose', () => {
    const reta: Medication = { ...ritalin, id: 'g', name: 'Retatrutide', schedule: { type: 'fixed', slots: [{ time: '08:00' }], days: [1, 4] } };
    const doses: Dose[] = [], daily: DailyHealth[] = [];
    for (let k = 0; k < 8; k++) doses.push(dose('g', at(56 - k * 7, 8), k < 4 ? 1 : 2));
    for (let i = 0; i < 56; i++) {
      const t = at(56 - i);
      const since = i % 7;
      daily.push({ id: `w${i}`, date: ymd(t), restingHr: 60 + (since === 1 ? 4 : since === 2 ? 3 : 0) + (i >= 28 ? 2 : 0), hrvMs: 45, ...st });
    }
    const w = shotWeek(reta, doses, daily, NOW, S)!;
    expect(w.byDay).toHaveLength(7);
    expect(w.swing?.high).toBe(1);
    expect(w.swing?.bpm).toBeGreaterThanOrEqual(4);
    expect(w.byDose.map((d) => d.dose)).toEqual([1, 2]);
    expect(w.byDose[1].rhr! - w.byDose[0].rhr!).toBe(2);
  });
});
