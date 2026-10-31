// The daily brief: the day in a few lines, at the top of Today. When the first stimulant dose fits (from when you woke)
// and the second, a shot today or tomorrow and what usually follows it, appetite coming back, water for the day, and a
// brain test if none yet. Readiness and its plan come with the biohacking tools. Pure.
import type { CheckIn, DailyHealth, Dose, Medication, Workout } from '../db/schema';
import { getDayBounds, getNextDue, type ScheduleSettings } from './schedule';
import { inGroup } from './interactions';
import { guideFor } from './peptideGuide';
import { isStimulant, secondDose } from './stimulant';
import { appetiteAhead, fluids, gutByShotDay } from './bodyhack';
import { brainTests } from './biohack';
import { shownName } from './privacy';
import { zonedParts } from './tz';

const DAY = 86_400_000, HOUR = 3_600_000;
const time = (t: number) => new Date(t).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, ' ').toLowerCase();
const weekday = (t: number) => new Date(t).toLocaleDateString('en-AU', { weekday: 'long' });

export interface BriefLine { key: string; text: string }

export function dailyBrief(d: { meds: Medication[]; doses: Dose[]; checkIns: CheckIn[]; daily: DailyHealth[]; workouts: Workout[]; waterTarget: number | null; biohack: boolean }, now: number, s: ScheduleSettings): BriefLine[] {
  const out: BriefLine[] = [];
  const start = getDayBounds(now, s.dayStartsAt, s.tz).start;
  const live = d.meds.filter((m) => !m.archived);
  const woke = d.daily.map((x) => x.sleepEnd).filter((t): t is number => !!t && t >= start && t <= now).sort((a, b) => b - a)[0];

  // Stimulants: the first dose (and when it fits after waking), then the second.
  for (const m of live.filter((x) => isStimulant(x) && !x.peptide)) {
    const today = d.doses.filter((x) => x.medicationId === m.id && !x.deletedAt && !x.skipped && Date.parse(x.takenAt) >= start);
    if (!today.length) {
      const due = getNextDue(m, d.doses, now, s);
      const wakeAt = woke !== undefined && m.followWakeMin !== undefined ? woke + m.followWakeMin * 60_000 : undefined;
      const at = wakeAt ?? due;
      if (at !== null && at !== undefined && at < start + DAY) out.push({ key: `first:${m.id}`, text: `${shownName(m)}: first dose ${at <= now ? 'now' : `about ${time(at)}`}${wakeAt ? ` (you woke ${time(woke!)})` : ''}` });
    } else {
      const sd = secondDose(m, d.doses, d.checkIns, d.daily, now, s);
      if (sd) out.push({ key: `second:${m.id}`, text: `${shownName(m)}: second dose ${sd.at <= now ? 'now' : `about ${time(sd.at)}`}, before the first wears off about ${time(sd.wearAt)}` });
    }
  }
  // Shots today or tomorrow, and what usually follows.
  for (const m of live.filter((x) => x.peptide && x.schedule.type === 'fixed' && (x.schedule.days?.length ?? 7) <= 3)) {
    const due = getNextDue(m, d.doses, now, s);
    if (due === null || due - now > 36 * HOUR) continue;
    const when = due < start + DAY ? (due <= now ? 'due now' : `today about ${time(due)}`) : `tomorrow about ${time(due)}`;
    let after = '';
    if (inGroup(m, 'glp1') || guideFor(m.name)?.id === 'retatrutide') {
      const gut = gutByShotDay(m, d.doses, d.checkIns, now);
      const worst = gut?.map((x) => ({ day: x.day, pct: x.chips[0]?.pct ?? 0, chip: x.chips[0]?.chip })).sort((a, b) => b.pct - a.pct)[0];
      if (worst && worst.pct >= 25) after = `; ${worst.chip?.toLowerCase()} is usual ${worst.day === 0 ? 'that day' : `on ${weekday(due + worst.day * DAY)}`}, so lighter meals then`;
    }
    out.push({ key: `shot:${m.id}`, text: `${shownName(m)} ${when}${after}` });
  }
  // Appetite coming back.
  for (const m of live.filter((x) => x.peptide && (inGroup(x, 'glp1') || guideFor(x.name)?.id === 'retatrutide'))) {
    const a = appetiteAhead(m, d.doses, d.checkIns, now);
    if (a && a.at - now < 2 * DAY && a.at > now) out.push({ key: `appetite:${m.id}`, text: `Appetite usually back ${a.at < start + DAY ? 'later today' : weekday(a.at)}: plan protein-rich meals` });
  }
  if (d.biohack) {
    const f = fluids(live, d.doses, d.workouts, d.checkIns, d.daily, d.waterTarget, now, s);
    if (f.reasons.length) out.push({ key: 'water', text: `About ${Math.round(f.ml / 100) / 10} L of water today (${f.reasons.join(', ')})${f.electrolytes ? ', with electrolytes' : ''}` });
    const h = zonedParts(now, s.tz).h;
    if (h >= 6 && h < 11 && !brainTests(d.checkIns).some((c) => Date.parse(c.at) >= start)) out.push({ key: 'brain', text: 'A brain test this morning makes today’s readiness sharper' });
  }
  return out;
}
