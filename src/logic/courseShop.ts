// What to buy for a peptide: for the rest of its course (or the next course, on a break), or the next 4 weeks when it
// has no course. The shots and total amount the plan has, what's in hand (the vial in use and unopened ones), and the
// vials, water, syringes and swabs to buy. Vials are counted day by day, so a vial past its use-within days is replaced
// even if it isn't empty. Pure.
import type { Dose, Medication } from '../db/schema';
import type { GuideEntry } from './peptideGuide';
import { currentVial, stockVials, vialStatus } from './peptide';
import { plannedInjections } from './protocol';
import { courseInfo, getDayBounds, type ScheduleSettings } from './schedule';

const DAY = 86_400_000;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export interface CourseShop {
  /** What it covers: the rest of the course, the next course, or the next 4 weeks. */
  span: 'rest' | 'next' | 'weeks'; days: number;
  shots: number; total: number;
  /** In hand: left in the vial in use, and the unopened vials (count and amount). */
  inVial: number; unopened: number; unopenedAmount: number;
  /** To buy: vials of `vialSize`, water for them (vials only), syringes and swabs (one for the vial, one for the skin). */
  vials: number; vialSize: number; waterMl?: number; syringes: number; swabs: number;
  /** The day the vials in hand run out, if before the end. */
  runsOutAt?: number;
}

/** Shot amounts per day, from today, for `days` days. On a course break, the next course as if it started tomorrow. */
function plan(med: Medication, doses: Dose[], now: number, s: ScheduleSettings): { span: CourseShop['span']; days: number; perDay: number[] } {
  const c = med.schedule.course;
  if (c) {
    const info = courseInfo(c, getDayBounds(now, s.dayStartsAt, s.tz).start, s);
    if (info.phase === 'break') {
      const t = new Date(now + DAY); const ymd = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
      const next = { ...med, schedule: { ...med.schedule, course: { ...c, start: ymd } } };
      const days = info.length + 1;
      return { span: 'next', days, perDay: plannedInjections([next], doses, now, s, days).map((d) => d.byMed[0]?.amounts.reduce((a, x) => a + x, 0) ?? 0) };
    }
    const days = info.phase === 'on' ? info.length - info.day + 1 : info.length + Math.round((Date.parse(`${c.start}T12:00`) - now) / DAY) + 1;
    return { span: 'rest', days, perDay: plannedInjections([med], doses, now, s, days).map((d) => d.byMed[0]?.amounts.reduce((a, x) => a + x, 0) ?? 0) };
  }
  return { span: 'weeks', days: 28, perDay: plannedInjections([med], doses, now, s, 28).map((d) => d.byMed[0]?.amounts.reduce((a, x) => a + x, 0) ?? 0) };
}

export function courseShop(med: Medication, doses: Dose[], now: number, s: ScheduleSettings): CourseShop | null {
  if (!med.peptide || med.archived || med.schedule.type === 'prn') return null;
  const p = plan(med, doses, now, s);
  const shotsN = p.perDay.filter((x) => x > 0).length;
  const total = r3(p.perDay.reduce((a, x) => a + x, 0));
  if (!(total > 0)) return null;
  const within = (med.peptide.useWithinDays ?? 0) * DAY || Infinity;
  const v = vialStatus(med, doses, now);
  const stock = stockVials(med);
  const vialSize = stock[0]?.amount ?? currentVial(med)?.amount ?? med.strength;

  // Day by day: use the vial in hand (until empty or past use-within), then unopened ones, then bought ones.
  let left = v && !v.expired ? v.left : 0, mixedAt = v?.startedAt ?? now;
  const queue = stock.map((x) => x.amount);
  let bought = 0, runsOutAt: number | undefined;
  p.perDay.forEach((need, i) => {
    const t = now + i * DAY;
    let rest = need;
    while (rest > 1e-9) {
      if (left <= 1e-9 || t - mixedAt >= within) {
        if (queue.length) left = queue.shift()!;
        else { if (runsOutAt === undefined) runsOutAt = t; bought++; left = vialSize; }
        mixedAt = t;
      }
      const take = Math.min(left, rest); left -= take; rest -= take;
    }
  });
  const isVial = med.peptide.kind !== 'pen';
  return {
    span: p.span, days: p.days, shots: shotsN, total,
    inVial: r3(v && !v.expired ? v.left : 0), unopened: stock.length, unopenedAmount: r3(stock.reduce((a, x) => a + x.amount, 0)),
    vials: bought, vialSize, waterMl: isVial && bought ? r3(bought * med.peptide.waterMl) : undefined,
    syringes: isVial ? shotsN : 0, swabs: shotsN * (isVial ? 2 : 1), runsOutAt,
  };
}

/** For a guide entry, before it's set up: a course (or 4 weeks) at the starting dose, in vials of its first size. */
/** `vialAmount`: the person's vial size (in the guide's unit); the first common size when not given. */
export function guideCourse(g: GuideEntry, vialAmount = g.vials[0].amount): { shots: number; total: number; vials: number; days: number; course: boolean } {
  const sc = g.setup.schedule('2026-01-05', 1); // a Monday
  if (sc.type !== 'fixed') return { shots: 0, total: 0, vials: 0, days: 0, course: false };
  const days = sc.course?.days ?? 28;
  const perWeek = sc.days?.length ?? 7;
  const shots = Math.round((days / 7) * perWeek * (sc.slots?.length ?? 1));
  const total = r3(shots * g.setup.defaultAmount);
  // One vial lasts until it's empty or past its use-within days, whichever comes first.
  const perVialShots = Math.max(1, Math.min(Math.floor(vialAmount / g.setup.defaultAmount + 1e-9), Math.floor((g.storage.useWithinDays / 7) * perWeek * (sc.slots?.length ?? 1))));
  return { shots, total, vials: Math.ceil(shots / perVialShots), days, course: !!sc.course };
}
