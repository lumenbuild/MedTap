// "Yours" on a peptide guide page: the person's own setup and record for that peptide, next to the reference text. The
// dose now and its draw on their vial, how long they've been on it (or where the course is), shots taken against
// planned over 4 weeks, weight since starting (for weight peptides), the side effects they log most, watch sleep on and
// off, and the "from your records" timing notes. Pure.
import type { BodyEntry, CheckIn, DailyHealth, Dose, Medication } from '../db/schema';
import type { GuideEntry } from './peptideGuide';
import { fmtDose } from './peptideGuide';
import { guideText } from './peptide';
import { medOn } from './plans';
import { dayKey } from './stats';
import { courseInfo, getDailyTarget, getDayBounds, type ScheduleSettings } from './schedule';
import { courseSleep } from './watchSignals';
import { howToTake } from './howToTake';

const DAY = 86_400_000;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtDay = (ymd: string) => new Date(`${ymd}T12:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
const r1 = (n: number) => Math.round(n * 10) / 10;

export interface YoursData { meds: Medication[]; doses: Dose[]; checkIns: CheckIn[]; daily: DailyHealth[]; body: BodyEntry[] }

export function guideYours(g: GuideEntry, med: Medication, d: YoursData, now: number, s: ScheduleSettings): string[] {
  const out: string[] = [];
  const today = dayKey(now, s);
  const cur = medOn(med, today);
  const sc = cur.schedule;

  // The dose now, its draw, and when.
  const draw = guideText(cur, cur.defaultAmount);
  const when = sc.type === 'prn' ? 'as needed' : sc.days?.length && sc.days.length < 7 ? `on ${[...sc.days].sort((a, b) => a - b).map((x) => DOW[x]).join(' and ')}` : sc.everyNDays ? `every ${sc.everyNDays} days` : 'daily';
  out.push(`${fmtDose(cur.defaultAmount, cur.unit)}${draw ? ` (${draw} on your vial)` : ''}, ${when}.`);

  // How long, or where the course is.
  const mine = d.doses.filter((x) => x.medicationId === med.id && !x.deletedAt && !x.skipped).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  const first = mine[0] ? Date.parse(mine[0].takenAt) : undefined;
  if (sc.course) {
    const c = courseInfo(sc.course, getDayBounds(now, s.dayStartsAt, s.tz).start, s);
    out.push(c.phase === 'on' ? `Course day ${c.day} of ${c.length}, to ${fmtDay(c.lastDay)}.` : c.phase === 'break' ? `Course finished ${fmtDay(c.lastDay)}: ${c.breakDays} day${c.breakDays === 1 ? '' : 's'} off.` : `Course starts ${fmtDay(sc.course.start)}.`);
  } else if (first !== undefined) {
    const wk = Math.floor((now - first) / (7 * DAY));
    out.push(`Started ${fmtDay(dayKey(first, s))}${wk >= 1 ? `: ${wk} week${wk === 1 ? '' : 's'} in` : ''}.`);
  }

  // Taken against planned, the last 4 weeks (from the first dose if sooner).
  if (sc.type !== 'prn' && first !== undefined) {
    let planned = 0, taken = 0;
    for (let i = 1; i <= 28; i++) {
      const b = getDayBounds(now - i * DAY, s.dayStartsAt, s.tz);
      if (b.end <= first) break;
      planned += getDailyTarget(medOn(med, dayKey(b.start, s)), b.start, s) ?? 0;
      taken += mine.filter((x) => { const t = Date.parse(x.takenAt); return t >= b.start && t < b.end; }).length;
    }
    if (planned >= 2) out.push(`Last 4 weeks: ${Math.min(taken, planned)} of ${planned} planned ${planned === 1 ? 'dose' : 'doses'} taken.`);
  }

  // Weight since starting, for weight peptides.
  if (g.goals?.includes('weight') && first !== undefined) {
    const w = d.body.filter((b) => !b.deletedAt && b.weightKg).sort((a, b) => a.date.localeCompare(b.date));
    const startYmd = dayKey(first, s);
    const before = [...w].reverse().find((b) => b.date <= startYmd && b.date >= dayKey(first - 14 * DAY, s)) ?? w.find((b) => b.date >= startYmd);
    const last = w[w.length - 1];
    if (before && last && last.date > before.date) {
      const diff = last.weightKg! - before.weightKg!;
      out.push(`${diff <= 0 ? 'Down' : 'Up'} ${r1(Math.abs(diff))} kg since starting (${diff <= 0 ? '−' : '+'}${r1((Math.abs(diff) / before.weightKg!) * 100)}%).`);
    }
  }

  // The side effects logged most since starting.
  if (first !== undefined && g.chips.length) {
    const cis = d.checkIns.filter((c) => !c.deletedAt && Date.parse(c.at) >= first);
    if (cis.length >= 5) {
      const counts = new Map<string, number>();
      for (const c of cis) for (const chip of new Set(c.chips)) counts.set(chip, (counts.get(chip) ?? 0) + 1);
      const watch = new Set(g.chips); // its own words only: other medicines' side effects aren't this one's
      const top = [...counts].filter(([chip, n]) => watch.has(chip) && n / cis.length >= 0.1).sort((a, b) => b[1] - a[1]).slice(0, 3);
      if (top.length) out.push(`Logged most since starting: ${top.map(([chip, n]) => `${chip} (${Math.round((n / cis.length) * 100)}% of check-ins)`).join(', ')}.`);
    }
  }

  // Watch sleep after a dose against nights without.
  const cs = courseSleep(med, d.doses, d.daily, now, s);
  if (cs?.lines.length) out.push(`Watch nights after a dose: ${cs.lines.join('; ')}.`);

  for (const a of howToTake(med, d, now, s)) if (a.yours) out.push(a.text);
  return out;
}
