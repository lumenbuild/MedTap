// The weekly digest: last week (Monday to Sunday) in a few lines, each against the week before — doses on schedule,
// weight, training, sleep, mood, protein — with a headline for the most notable. From the person's own records. Pure.
import type { BodyEntry, CheckIn, DailyHealth, Dose, Medication, Workout } from '../db/schema';
import type { Units } from '../db/repos/settings';
import type { ScheduleSettings } from './schedule';
import { getDayBounds, weekdayOf } from './schedule';
import { adherenceByDay, daysBetween, ymdToMs } from './stats';
import { dayStartOffset } from './protocol';
import { newPBs, working } from './training';
import type { ExerciseDef } from './exercises';
import { kgTo, weightUnit } from './units';

const DAY = 86_400_000;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r1 = (n: number) => Math.round(n * 10) / 10;

export interface DigestLine { key: string; label: string; text: string; tone: 'good' | 'watch' | 'plain' }
/** wins: what went well, first (personal bests, doses on track, steps towards a goal, better sleep or mood, more
 *  sessions, milestones), each a short line. */
export interface Digest { weekStart: number; weekEnd: number; headline: string; lines: DigestLine[]; wins: string[] }

export interface DigestData {
  meds: Medication[]; doses: Dose[]; checkIns: CheckIn[]; body: BodyEntry[]; workouts: Workout[]; daily: DailyHealth[]; defs: ExerciseDef[];
}

/** Monday to Sunday ending before this week. */
export function lastWeek(now: number, s: ScheduleSettings): { start: number; end: number } {
  const today = getDayBounds(now, s.dayStartsAt, s.tz).start;
  const back = (weekdayOf(today, s) + 6) % 7; // days since Monday
  const end = dayStartOffset(now, -back, s);
  return { start: dayStartOffset(now, -back - 7, s), end };
}

export function weeklyDigest(d: DigestData, now: number, s: ScheduleSettings, opts: { units: Units; body: boolean; training: boolean;
  /** Which way the weight goal points (−1 down, 1 up), and milestones to count among the week's wins. */
  goalDir?: number; milestones?: { at: number; title: string }[]; }): Digest | null {
  const { start, end } = lastWeek(now, s);
  const prevStart = start - 7 * DAY;
  const lines: DigestLine[] = [];
  const wins: string[] = [];
  const inR = (t: number, a: number, b: number) => t >= a && t < b;

  // Doses on schedule (set-time medications).
  const sched = d.meds.filter((m) => !m.archived && m.schedule.type !== 'prn');
  const rate = (a: number, b: number) => {
    const days = daysBetween(a, b, s);
    let got = 0, want = 0;
    for (const m of sched) for (const x of adherenceByDay(d.doses, m, days, s)) { if (x.target) { want += x.target; got += Math.min(x.count, x.target); } }
    return want ? { got, want, pct: Math.round((got / want) * 100) } : null;
  };
  const dn = rate(start, end), dp = rate(prevStart, start);
  if (dn && (dn.pct >= 90 || (dp && dn.pct - dp.pct >= 10))) wins.push(dn.pct === 100 ? `Every dose logged (${dn.want})` : dn.pct >= 90 ? `${dn.pct}% of doses logged` : `Doses up to ${dn.pct}% from ${dp!.pct}%`);
  if (dn) lines.push({ key: 'doses', label: 'Doses', text: `${dn.got} of ${dn.want} logged (${dn.pct}%)${dp ? `, ${dn.pct === dp.pct ? 'same as' : dn.pct > dp.pct ? `up from ${dp.pct}%` : `down from ${dp.pct}%`}${dn.pct === dp.pct ? ' the week before' : ''}` : ''}`, tone: dn.pct >= 90 ? 'good' : dn.pct < 70 ? 'watch' : 'plain' });

  // Weight: the week's average against the week before.
  if (opts.body) {
    const w = (a: number, b: number) => avg(d.body.filter((x) => !x.deletedAt && typeof x.weightKg === 'number' && inR(ymdToMs(x.date), a, b)).map((x) => x.weightKg!));
    const wn = w(start, end), wp = w(prevStart, start);
    if (wn !== null && wp !== null) {
      const diff = wn - wp;
      if (opts.goalDir && diff * opts.goalDir >= 0.2) wins.push(`${diff < 0 ? 'Down' : 'Up'} ${kgTo(Math.abs(diff), opts.units)} ${weightUnit(opts.units)} towards your goal`);
      lines.push({ key: 'weight', label: 'Weight', text: `${Math.abs(diff) < 0.05 ? 'about the same' : `${diff < 0 ? 'down' : 'up'} ${kgTo(Math.abs(diff), opts.units)} ${weightUnit(opts.units)}`} (week average ${kgTo(wn, opts.units)} ${weightUnit(opts.units)})`, tone: 'plain' });
    }
  }

  // Training: sessions and personal bests.
  if (opts.training) {
    const ws = d.workouts.filter((w) => !w.deletedAt && inR(Date.parse(w.startedAt), start, end));
    const prevN = d.workouts.filter((w) => !w.deletedAt && inR(Date.parse(w.startedAt), prevStart, start)).length;
    // One best per lift (its headline one), so a single big session doesn't read as five records.
    const byLift = new Map<string, string>();
    for (const w of ws.filter((x) => working(x.sets).length)) for (const p of newPBs(w, d.workouts, d.defs, opts.units)) if (!byLift.has(p.exerciseId)) byLift.set(p.exerciseId, `${d.defs.find((x) => x.id === p.exerciseId)?.name}: ${p.text}`);
    const pbs = [...byLift.values()];
    if (pbs.length) wins.unshift(`${pbs.length === 1 ? 'A personal best' : `${pbs.length} personal bests`}: ${pbs[0]}`);
    if (ws.length && ws.length > prevN) wins.push(`${ws.length} session${ws.length === 1 ? '' : 's'}, ${prevN ? `${ws.length - prevN} more than the week before` : 'after none the week before'}`);
    if (ws.length || prevN) lines.push({ key: 'training', label: 'Training', text: `${ws.length} session${ws.length === 1 ? '' : 's'}${prevN !== ws.length ? ` (${prevN} the week before)` : ''}${pbs.length ? `, ${pbs.length} personal best${pbs.length === 1 ? '' : 's'}: ${pbs.slice(0, 2).join('; ')}` : ''}`, tone: pbs.length ? 'good' : ws.length < prevN ? 'watch' : 'plain' });
    const pr = (a: number, b: number) => avg(d.daily.filter((x) => !x.deletedAt && x.proteinG && inR(ymdToMs(x.date), a, b)).map((x) => x.proteinG!));
    const pn = pr(start, end);
    if (pn !== null) { const pp = pr(prevStart, start); lines.push({ key: 'protein', label: 'Protein', text: `${Math.round(pn)} g a day on logged days${pp !== null ? ` (${Math.round(pp)} g the week before)` : ''}`, tone: 'plain' }); }
  }

  // Sleep: imported nights, else check-ins.
  const sleep = (a: number, b: number) => {
    const imp = d.daily.filter((x) => !x.deletedAt && x.sleepMin && inR(ymdToMs(x.date), a, b)).map((x) => x.sleepMin! / 60);
    return avg(imp.length ? imp : d.checkIns.filter((c) => !c.deletedAt && c.sleepHours && inR(Date.parse(c.at), a, b)).map((c) => c.sleepHours!));
  };
  const sn = sleep(start, end), sp = sleep(prevStart, start);
  if (sn !== null && sp !== null && sn - sp >= 0.3) wins.push(`Sleep up to ${r1(sn)} h a night`);
  if (sn !== null) lines.push({ key: 'sleep', label: 'Sleep', text: `${r1(sn)} h a night${sp !== null && Math.abs(sn - sp) >= 0.2 ? `, ${sn > sp ? 'up' : 'down'} from ${r1(sp)} h` : ''}`, tone: sp !== null && sn < sp - 0.5 ? 'watch' : 'plain' });

  // Mood from check-ins.
  const mood = (a: number, b: number) => avg(d.checkIns.filter((c) => !c.deletedAt && c.mood && inR(Date.parse(c.at), a, b)).map((c) => c.mood!));
  const mn = mood(start, end), mp = mood(prevStart, start);
  if (mn !== null && mp !== null && mn - mp >= 0.3) wins.push(`Mood up to ${r1(mn)} of 5`);
  if (mn !== null) lines.push({ key: 'mood', label: 'Mood', text: `${r1(mn)} of 5${mp !== null && Math.abs(mn - mp) >= 0.2 ? `, ${mn > mp ? 'up' : 'down'} from ${r1(mp)}` : ''}`, tone: mp !== null && mn < mp - 0.4 ? 'watch' : 'plain' });

  for (const m of opts.milestones ?? []) if (inR(m.at, start, end)) wins.push(m.title.replace(/^./, (c) => c.toUpperCase()));
  if (!lines.length && !wins.length) return null;
  const good = lines.find((l) => l.tone === 'good'), watch = lines.find((l) => l.tone === 'watch');
  const headline = wins.length ? wins[0] : good ? `${good.label}: ${good.text}` : watch ? `Worth a look: ${watch.label.toLowerCase()} ${watch.text}` : `${lines[0].label}: ${lines[0].text}`;
  return { weekStart: start, weekEnd: end, headline, lines, wins: [...new Set(wins)].slice(0, 5) };
}
