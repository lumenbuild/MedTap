// Readings worth mentioning: a week of blood pressure or resting heart rate clearly above the person's own usual, or
// blood pressure averaging 140/90 or more (where Australian guidelines start calling it high). A flag to raise with a
// doctor, never advice. Pure.
import type { DailyHealth, Vital } from '../db/schema';
import { ymdToMs } from './stats';

const DAY = 86_400_000;
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export interface Mention { key: string; kind: 'bp' | 'bp-high' | 'hr'; text: string }

export function readingsWorthMentioning(vitals: Vital[], daily: DailyHealth[], now: number): Mention[] {
  const out: Mention[] = [];
  const week = Math.floor(now / (7 * DAY));
  const bp = vitals.filter((v) => !v.deletedAt && v.systolic && v.diastolic && Date.parse(v.at) <= now);
  const recent = bp.filter((v) => Date.parse(v.at) > now - 7 * DAY);
  const base = bp.filter((v) => Date.parse(v.at) <= now - 8 * DAY && Date.parse(v.at) > now - 60 * DAY);
  if (recent.length >= 3) {
    const s = Math.round(avg(recent.map((v) => v.systolic!))), d = Math.round(avg(recent.map((v) => v.diastolic!)));
    if (s >= 140 || d >= 90) {
      out.push({ key: `bp-high:${week}`, kind: 'bp-high', text: `Blood pressure ${s}/${d} this week (high is 140/90+)` });
    } else if (base.length >= 5) {
      const bs = Math.round(median(base.map((v) => v.systolic!))), bd = Math.round(median(base.map((v) => v.diastolic!)));
      if (s - bs >= 10 || d - bd >= 6) out.push({ key: `bp:${week}`, kind: 'bp', text: `Blood pressure ${s}/${d} this week, usually ${bs}/${bd}` });
    }
  }
  const hr = daily.filter((x) => !x.deletedAt && x.restingHr);
  const hrRecent = hr.filter((x) => ymdToMs(x.date) > now - 7 * DAY && ymdToMs(x.date) <= now);
  const hrBase = hr.filter((x) => ymdToMs(x.date) <= now - 8 * DAY && ymdToMs(x.date) > now - 36 * DAY);
  if (hrRecent.length >= 5 && hrBase.length >= 10) {
    const r = Math.round(avg(hrRecent.map((x) => x.restingHr!))), b = Math.round(median(hrBase.map((x) => x.restingHr!)));
    if (r - b >= 7) out.push({ key: `hr:${week}`, kind: 'hr', text: `Resting heart rate ${r} bpm this week, usually ${b}` });
  }
  return out;
}
