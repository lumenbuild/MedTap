import { describe, it, expect } from 'vitest';
import type { BodyEntry, DailyHealth, Workout } from '../src/db/schema';
import { atGoalWeight, bodyFatBand, fatForecast, lossMix, muscleEvidence, recomp, todayWater, waterBand } from '../src/logic/scaleInsights';
import { mergeBlocks, mergeHrSamples } from '../src/logic/watchHr';

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 5, 18, 0).getTime();
const st = { createdAt: '', updatedAt: '' };
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const ago = (k: number) => ymd(NOW - k * DAY);
/** Losing 0.9 kg a week, three-quarters of it fat, from 125 kg at 42% body fat; a reading every 3 days. */
const scale = (days = 120, leanShare = 0.25): BodyEntry[] => Array.from({ length: Math.floor(days / 3) }, (_, i) => {
  const k = days - i * 3, lost = (0.9 / 7) * (days - k);
  const kg = 125 - lost, fat = 125 * 0.42 - lost * (1 - leanShare);
  return { id: `b${k}`, date: ago(k), weightKg: Math.round(kg * 10) / 10, bodyFatPct: Math.round((fat / kg) * 1000) / 10, leanKg: Math.round((kg - fat) * 10) / 10, ...st };
});

describe('scale insights', () => {
  it('what the loss is made of', () => {
    const m = lossMix(scale(), NOW)!;
    expect(m.kgLost).toBeGreaterThan(13);
    expect(m.fatLost / m.kgLost).toBeGreaterThan(0.7);
    expect(m.fatLost / m.kgLost).toBeLessThan(0.8);
    expect(m.weeks.length).toBeGreaterThanOrEqual(7);
    expect(m.weeks.every((w) => w.fat < 0)).toBe(true);
  });
  it('fat pace, the healthy weight, and a goal too lean to keep', () => {
    const f = fatForecast(scale(), 'm', 70, NOW)!;
    expect(f.fatPerWeek).toBeCloseTo(-0.68, 1);
    expect(f.healthyBf).toBe(25);
    expect(f.healthyKg).toBeGreaterThan(85); // lean ~67 kg at 25% fat
    expect(f.healthyBy).toBeGreaterThan(NOW);
    // At the loss's usual mix (25% lean) 70 kg is about 18% fat: fine, but it means losing lean mass.
    expect(f.atGoal!.tooLean).toBe(false);
    expect(f.atGoal!.leanMustGo).toBeGreaterThan(3);
    expect(f.atGoal!.sensibleKg).toBeGreaterThan(72);
    // Losing almost no lean, 70 kg would be too lean to keep.
    expect(fatForecast(scale(120, 0.02), 'm', 70, NOW)!.atGoal!.tooLean).toBe(true);
    expect(f.atGoal!.atShare).toBeGreaterThan(f.atGoal!.keepAll);
  });
  it('recomposition: weight steady, fat down, lean up', () => {
    const body: BodyEntry[] = Array.from({ length: 9 }, (_, i) => { const k = 27 - i * 3; const fat = 40 - (27 - k) * 0.05, lean = 70 + (27 - k) * 0.04; return { id: `r${i}`, date: ago(k), weightKg: Math.round((fat + lean) * 10) / 10, bodyFatPct: Math.round((fat / (fat + lean)) * 1000) / 10, leanKg: Math.round(lean * 10) / 10, ...st }; });
    const r = recomp(body, NOW)!;
    expect(r.fat).toBeLessThan(-0.5);
    expect(r.lean).toBeGreaterThan(0.3);
    expect(recomp(scale(), NOW)).toBeNull(); // losing weight: not a recomp
  });
  it('what protects muscle, in your own weeks', () => {
    // Lean held in weeks with 2+ strength sessions and protein, fell in weeks without.
    const body: BodyEntry[] = [], daily: DailyHealth[] = [], workouts: Workout[] = [];
    // Weeks from Monday, so each week is all one kind.
    const mon = new Date(NOW); mon.setHours(12, 0, 0, 0); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
    let lean = 70;
    for (let w = 14; w >= 1; w--) {
      const start = mon.getTime() - w * 7 * DAY;
      const good = w % 2 === 0;
      lean += good ? 0 : -0.4;
      // Readings consistent with themselves: lean is the weight minus the fat the scale reports.
      for (const d of [1, 4]) { const kg = 110 - (14 - w) * 0.8; body.push({ id: `m${w}${d}`, date: ymd(start + d * DAY), weightKg: kg, bodyFatPct: Math.round(((kg - lean) / kg) * 1000) / 10, ...st }); }
      for (let d = 0; d < 7; d++) daily.push({ id: `p${w}${d}`, date: ymd(start + d * DAY), proteinG: good ? 150 : 90, ...st });
      if (good) for (const d of [1, 3]) workouts.push({ id: `s${w}${d}`, startedAt: new Date(start + d * DAY).toISOString(), sets: [{ id: 'x', exerciseId: 'squat', weightKg: 60, reps: 8, done: true }], source: 'manual', ...st });
    }
    const e = muscleEvidence({ body, daily, workouts, proteinTarget: 140 }, NOW)!;
    const prot = e.rows.find((r) => /Protein/.test(r.what))!;
    expect(prot.with).toBeGreaterThan(prot.without);
    expect(e.rows.find((r) => /strength/.test(r.what))).toBeTruthy();
  });
  it("today's jump is water; body fat reads high when you're dry", () => {
    const week: BodyEntry[] = Array.from({ length: 6 }, (_, k) => ({ id: `w${k}`, date: ago(k + 1), weightKg: 116, bodyFatPct: 40, waterPct: 43.5, ...st }));
    const up = todayWater([...week, { id: 't', date: ago(0), weightKg: 117, bodyFatPct: 39.6, waterPct: 44.3, ...st }], ago(0))!;
    expect(up.text).toMatch(/of today's \+1 kg is body water/);
    const dry = todayWater([...week, { id: 't', date: ago(0), weightKg: 116.1, bodyFatPct: 41.6, waterPct: 42.6, ...st }], ago(0))!;
    expect(dry.text).toMatch(/reads 1.6 points higher/);
  });
  it('metabolic age and visceral fat at the goal, from your own readings', () => {
    const body: BodyEntry[] = Array.from({ length: 10 }, (_, i) => ({ id: `g${i}`, date: ago(100 - i * 10), weightKg: 125 - i, metabolicAge: 60 - i, visceralFat: 18 - Math.floor(i / 2), ...st }));
    const g = atGoalWeight(body, 90, NOW)!;
    expect(g.metabolicAge!.atGoal).toBeLessThan(g.metabolicAge!.now);
    expect(g.visceral!.atGoal).toBeLessThanOrEqual(5);
  });
  it('healthy ranges', () => {
    expect(bodyFatBand(39.8, 'm')).toBe('very high');
    expect(bodyFatBand(22, 'm')).toBe('healthy');
    expect(bodyFatBand(30, 'f')).toBe('healthy');
    expect(waterBand(43.6, 'm')).toBe('low');
  });
});

describe('heart rate straight from the watch', () => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  it('fills the day’s 5-minute blocks and hours, averaged with what’s there', () => {
    const t0 = new Date(2026, 10, 5, 9, 0, 0).getTime();
    const samples = Array.from({ length: 12 }, (_, i) => ({ t: t0 + i * 60_000, bpm: 70 + (i < 5 ? 0 : 10) }));
    const [row] = mergeHrSamples([], samples, undefined, tz, 'now');
    expect(row.date).toBe('2026-11-05');
    expect(row.hr5![108]).toBe(70); // 9:00–9:04
    expect(row.hr5![109]).toBe(80);
    expect(row.hrByHour![9]).toBe(77); // blocks 70, 80, 80
    // A second batch into a block that has a value: averaged.
    const [again] = mergeHrSamples([row], [{ t: t0 + 60_000, bpm: 90 }], undefined, tz, 'now');
    expect(again.hr5![108]).toBe(80);
    expect(again.id).toBe(row.id);
  });
  it('Health Connect fills in without wiping what the watch sent', () => {
    expect(mergeBlocks([60, null, 62], [70, 71, 72])).toEqual([60, 71, 62]);
    expect(mergeBlocks(undefined, [1])).toEqual([1]);
  });
});
