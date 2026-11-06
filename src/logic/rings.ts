// Goal rings: the five things that add up to the goal, at a glance. Fat lost toward the goal weight, lean mass kept,
// protein days this week, steps today and last night's sleep. Each only when there is data for it. Pure.
import type { BodyEntry, DailyHealth } from '../db/schema';
import { comps, lossMix } from './scaleInsights';
import { nightsOf, fmtHM } from './sleep';
import { dayKey } from './stats';
import type { ScheduleSettings } from './schedule';

const DAY = 86_400_000;
const r1 = (v: number) => Math.round(v * 10) / 10;
const clamp = (v: number) => Math.min(1, Math.max(0, v));

export type RingKey = 'fat' | 'weight' | 'lean' | 'protein' | 'steps' | 'sleep';
export interface Ring { key: RingKey; label: string; value: string; sub: string; frac: number; tone: 'good' | 'primary' | 'watch'; href: string }

export interface RingInput {
  body: BodyEntry[]; daily: DailyHealth[]; goalKg?: number;
  proteinTarget: number | null; stepsTarget?: number; sleepTargetMin: number;
}

export function goalRings(d: RingInput, now: number, s: ScheduleSettings): Ring[] {
  const out: Ring[] = [];
  const weights = d.body.filter((b) => !b.deletedAt && typeof b.weightKg === 'number' && new Date(`${b.date}T12:00`).getTime() > now - 180 * DAY).sort((a, b) => a.date.localeCompare(b.date));
  const latest = weights.at(-1)?.weightKg;
  const mix = lossMix(d.body, now);
  // Fat toward the goal (with body composition), otherwise weight.
  if (mix && mix.fatLost > 0) {
    const share = mix.kgLost > 0 ? Math.min(1, Math.max(0.5, mix.fatLost / mix.kgLost)) : 0.75;
    const toGo = d.goalKg !== undefined && latest !== undefined ? r1(Math.max(0, latest - d.goalKg) * share) : undefined;
    out.push({ key: 'fat', label: 'Fat lost', value: `${mix.fatLost} kg`, sub: toGo !== undefined ? (toGo > 0 ? `${toGo} kg to go` : 'goal reached') : 'since ' + mix.since.slice(5).split('-').reverse().join('/'),
      frac: toGo !== undefined ? clamp(mix.fatLost / (mix.fatLost + toGo)) : clamp(mix.fatLost / 10), tone: 'good', href: '#/progress/body' });
  } else if (weights.length >= 2 && latest !== undefined) {
    const start = Math.max(...weights.slice(0, Math.max(1, Math.ceil(weights.length / 4))).map((b) => b.weightKg!));
    const lost = r1(start - latest);
    if (lost > 0) {
      const toGo = d.goalKg !== undefined ? r1(Math.max(0, latest - d.goalKg)) : undefined;
      out.push({ key: 'weight', label: 'Weight lost', value: `${lost} kg`, sub: toGo !== undefined ? (toGo > 0 ? `${toGo} kg to go` : 'goal reached') : 'in 6 months',
        frac: toGo !== undefined ? clamp(lost / (lost + toGo)) : clamp(lost / 10), tone: 'good', href: '#/progress/body' });
    }
  }
  // Lean mass kept since the loss began.
  if (mix) {
    const c = comps(d.body).filter((x) => x.date >= mix.since);
    const leanStart = c.length ? c.slice(0, 3).reduce((a, x) => a + x.lean, 0) / Math.min(3, c.length) : 0;
    if (leanStart > 0) {
      const kept = clamp(1 - mix.leanLost / leanStart);
      const ok = mix.kgLost <= 0 || mix.leanLost <= mix.kgLost * 0.3;
      out.push({ key: 'lean', label: 'Lean kept', value: `${Math.round(kept * 1000) / 10}%`, sub: mix.leanLost > 0 ? `−${mix.leanLost} kg lean` : `+${Math.abs(mix.leanLost)} kg lean`,
        frac: kept, tone: ok ? 'good' : 'watch', href: '#/progress/body' });
    }
  }
  const today = dayKey(now, s);
  const rows = d.daily.filter((x) => !x.deletedAt);
  // Protein days this week (Monday on).
  if (d.proteinTarget) {
    const mon = new Date(now); mon.setHours(12, 0, 0, 0); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
    const from = dayKey(mon.getTime(), s);
    const byDate = new Map<string, number>();
    for (const r of rows) if (r.date >= from && r.date <= today) byDate.set(r.date, Math.max(byDate.get(r.date) ?? 0, (r.proteinG ?? 0) + (r.foodOtherProteinG ?? 0)));
    const hit = [...byDate.values()].filter((g) => g >= d.proteinTarget! * 0.9).length;
    const elapsed = Math.round((new Date(`${today}T12:00`).getTime() - mon.getTime()) / DAY) + 1;
    if (byDate.size) out.push({ key: 'protein', label: 'Protein', value: `${hit} of ${elapsed}`, sub: `days at ${d.proteinTarget} g`, frac: hit / 7, tone: hit >= elapsed - 1 ? 'good' : 'primary', href: '#/food' });
  }
  const t = rows.find((r) => r.date === today);
  if (t?.steps && d.stepsTarget) out.push({ key: 'steps', label: 'Steps', value: t.steps.toLocaleString('en-AU'), sub: `of ${d.stepsTarget.toLocaleString('en-AU')}`, frac: clamp(t.steps / d.stepsTarget), tone: t.steps >= d.stepsTarget ? 'good' : 'primary', href: '#/health' });
  const n = nightsOf(rows, now).at(-1);
  if (n && now - new Date(`${n.date}T12:00`).getTime() < 1.5 * DAY) out.push({ key: 'sleep', label: 'Sleep', value: fmtHM(n.asleep), sub: `of ${fmtHM(d.sleepTargetMin)}`, frac: clamp(n.asleep / d.sleepTargetMin), tone: n.asleep >= d.sleepTargetMin * 0.9 ? 'good' : n.asleep < d.sleepTargetMin * 0.75 ? 'watch' : 'primary', href: '#/sleep' });
  return out;
}
