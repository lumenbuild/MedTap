// "When and how to take it", for one medicine: the label's or guide's general advice, then what the person's own records
// show (when they wake, their best dose and time, the latest dose that's kind to sleep, the usual gap to a second dose,
// the gut pattern after a shot, doses taken outside a peptide's usual window), then supplement timing and anything to
// keep apart. Facts and their own data, stated plainly. Pure.
import type { CheckIn, DailyHealth, Dose, Medication } from '../db/schema';
import { usualHours } from './durations';
import { inGroup } from './interactions';
import { guideFor } from './peptideGuide';
import { doseResponse, isStimulant } from './stimulant';
import { sleepImpact } from './habits';
import { gutByShotDay, appetiteAhead } from './bodyhack';
import { supplementRules, supplementsOf } from './supplements';
import type { ScheduleSettings } from './schedule';
import { zonedParts } from './tz';

export interface Advice { text: string; yours: boolean }

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const clockMin = (min: number) => { const h = Math.floor(min / 60) % 24, m = Math.round(min % 60); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
const AMPH = /vyvanse|elvanse|lisdex|dexam|amphetamine|adderall/i;

/** When the person usually wakes, from the watch's main sleep over the last 3 weeks (minutes after midnight). */
export function usualWake(daily: DailyHealth[], now: number, s: ScheduleSettings): number | undefined {
  const ends = daily.filter((d) => !d.deletedAt && d.sleepEnd && d.sleepEnd > now - 21 * 86_400_000).map((d) => { const p = zonedParts(d.sleepEnd!, s.tz); return p.h * 60 + p.mi; }).filter((m) => m >= 4 * 60 && m <= 13 * 60);
  return ends.length >= 5 ? Math.round(median(ends)) : undefined;
}

export function howToTake(med: Medication, d: { meds: Medication[]; doses: Dose[]; checkIns: CheckIn[]; daily: DailyHealth[] }, now: number, s: ScheduleSettings): Advice[] {
  const out: Advice[] = [];
  const general = (text: string) => out.push({ text, yours: false });
  const yours = (text: string) => out.push({ text, yours: true });
  const text = [med.name, ...(med.ingredients ?? []).map((i) => i.name)].join(' ');
  const g = guideFor(med.name);

  // General: stimulants, GLP-1s, peptides from the guide, supplements.
  if (isStimulant(med) && !med.peptide) {
    if (/ritalin|methylphenidate|concerta/i.test(text)) general('The label says 30–45 minutes before a meal; many take it with or after breakfast so the appetite drop doesn’t cost them the meal (worth it on a GLP-1).');
    if (AMPH.test(text)) general('With or without food. Vitamin C and fruit juice lower how much is absorbed, antacids raise it: keep them an hour apart.');
    const u = usualHours(med);
    if (u) general(`Usually works ${u.min}–${u.max} hours.`);
  }
  if (inGroup(med, 'glp1') || g?.id === 'retatrutide') general('Any time of day; the same day each week (or the same days, split). Smaller meals and less fatty food in the first two days ease nausea.');
  if (g && g.id !== 'retatrutide') general(`${g.when}${g.cycle ? ` ${g.cycle}` : ''}`);
  for (const sp of supplementsOf(med)) if (sp.timing) general(`${sp.name}: ${sp.timing}`);

  // Yours.
  const mine = d.doses.filter((x) => x.medicationId === med.id && !x.deletedAt && !x.skipped);
  const wake = usualWake(d.daily, now, s);
  if (isStimulant(med) && !med.peptide && wake !== undefined) {
    const firsts = new Map<string, number>();
    for (const x of mine.filter((x) => Date.parse(x.takenAt) > now - 21 * 86_400_000)) {
      const p = zonedParts(Date.parse(x.takenAt), s.tz), k = `${p.y}-${p.m}-${p.d}`, m = p.h * 60 + p.mi;
      firsts.set(k, Math.min(firsts.get(k) ?? Infinity, m));
    }
    const gap = firsts.size >= 5 ? Math.round(median([...firsts.values()]) - wake) : undefined;
    yours(`You usually wake about ${clockMin(wake)}${gap !== undefined ? ` and take the first dose ${gap >= 0 ? `${gap} min later` : 'before then'}` : ''}. The first reminder can follow when you actually wake.`);
  }
  if (isStimulant(med) && !med.peptide) {
    const br = doseResponse(med, d.doses, d.checkIns, now, s);
    if (br) yours(br.by === 'amount' ? `Your focus is best on ${br.better} (${br.focusBetter} against ${br.focusWorse}).` : `Your focus is better when it’s taken ${br.better} (${br.focusBetter} against ${br.focusWorse}).`);
    const cut = sleepImpact([med], d.doses, d.checkIns, now, s, d.daily);
    if (cut) yours(`Doses after ${cut.cutoffHour % 12 || 12} ${cut.cutoffHour < 12 ? 'am' : 'pm'} go with worse sleep for you.`);
  }
  if (med.peptide && (inGroup(med, 'glp1') || g?.id === 'retatrutide')) {
    const gut = gutByShotDay(med, d.doses, d.checkIns, now);
    const worst = gut?.map((x) => ({ day: x.day, pct: x.chips[0]?.pct ?? 0, chip: x.chips[0]?.chip })).sort((a, b) => b.pct - a.pct)[0];
    if (worst && worst.pct >= 25) yours(`${worst.chip} is most common ${worst.day === 0 ? 'on shot day' : `on day ${worst.day} after a shot`} (${worst.pct}% of check-ins): plan lighter meals then.`);
    const app = appetiteAhead(med, d.doses, d.checkIns, now);
    if (app) yours(`Appetite usually comes back about day ${app.day}: a good day for bigger, protein-rich meals.`);
  }
  if (g?.window && mine.length >= 4) {
    const [from, to] = g.window;
    const outside = mine.slice(-14).filter((x) => { const h = zonedParts(Date.parse(x.takenAt), s.tz).h; return from <= to ? h < from || h >= to : h < from && h >= to; }).length;
    const n = Math.min(14, mine.length);
    if (outside / n >= 0.4) yours(`${outside} of your last ${n} doses were outside its usual window (${clockMin(from * 60)}–${clockMin(to * 60)}).`);
  }
  for (const r of supplementRules(d.meds).filter((x) => x.meds.includes(med.id) && x.kind !== 'lab')) out.push({ text: r.text, yours: true });
  return out;
}
