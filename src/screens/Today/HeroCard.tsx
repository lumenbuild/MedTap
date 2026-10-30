import { format } from 'date-fns';
import { planShort } from '../../logic/dosePlan';
import { shownColour, shownMedName, shownName } from '../../logic/privacy';
import type { Dose, Medication } from '../../db/schema';
import {
  cycleInfo, getDayBounds, getExpectedAmount, getLastDose, getNextDue, getStatus, nextScheduledDayStart, timeInDay, type ScheduleSettings,
} from '../../logic/schedule';
import { fmtAmount, fmtCountdownLong, fmtHHmm, fmtSchedule, fmtTime, fmtWhen } from '../../logic/format';
import { nextPlannedChange } from '../../logic/plans';
import { dayKey } from '../../logic/stats';
import { stockUnitsFor } from '../../logic/stock';
import { doseGuide, fmtUnits, isPen, vialStatus } from '../../logic/peptide';
import { Button } from '../../components/ui/Button';
import { MedBadge } from '../../components/MedBadge';

const dayName = new Intl.DateTimeFormat('en-AU', { weekday: 'long' });
const fmtDay = (ms: number) => format(ms, 'EEE d MMM');

/** The headline on Today (B2): the next dose's time, large and light, what to take, and one Log button.
 *  For injections it also says exactly what to draw (or dial) and how the vial in use is doing. */
export function HeroCard({ med, doses, s, now, onLog, className = '', footer, person }: {
  med: Medication; doses: Dose[]; s: ScheduleSettings; now: number; onLog: () => void; className?: string; footer?: React.ReactNode;
  /** Whose medication this is (shown in the Everyone view). */
  person?: string;
}) {
  const status = getStatus(med, doses, now, s);
  const next = getNextDue(med, doses, now, s);
  const last = getLastDose(doses, med.id, now);
  const dayStart = getDayBounds(now, s.dayStartsAt, s.tz).start;
  const nextAmount = status !== 'not-today' && next !== null ? getExpectedAmount(med, doses, next, s) : med.defaultAmount;
  const latest = med.schedule.latestDoseTime;

  // The headline: a time, "Now", "Done" or "Not today".
  let big: React.ReactNode;
  let label = 'Next';
  let sub: string;
  if (status === 'due' && next !== null) {
    big = 'Now'; sub = `Due since ${fmtTime(next)}`;
  } else if (status === 'done-today' && next !== null && next > now) {
    // Taken for today: the headline is when it's next due.
    const [hm, ap] = format(next, 'h:mm a').split(' ');
    const sameDay = next < getDayBounds(now, s.dayStartsAt, s.tz).end;
    label = sameDay ? 'Next' : `Next · ${fmtDay(next)}`;
    big = <>{hm}<span className="text-[28px] tracking-normal ml-1.5">{ap.toLowerCase()}</span></>;
    sub = `Done for today · next in ${fmtCountdownLong(next - now)}`;
  } else if (status === 'done-today') {
    big = 'Done'; label = 'Today'; sub = 'All taken';
  } else if (status === 'past-latest-time') {
    // Every-few-hours: past the latest dose time set. Set times: today's times have passed without a dose.
    big = 'Missed'; label = 'Today'; sub = latest ? `Past your latest time of ${fmtHHmm(latest)}` : "Today's dose time has passed";
  } else if (next !== null && next > now) {
    const [hm, ap] = format(next, 'h:mm a').split(' ');
    const sameDay = next < getDayBounds(now, s.dayStartsAt, s.tz).end;
    if (!sameDay) label = `Next · ${fmtDay(next)}`;
    big = <>{hm}<span className="text-[28px] tracking-normal ml-1.5">{ap.toLowerCase()}</span></>;
    sub = `in ${fmtCountdownLong(next - now)}`;
  } else if (status === 'not-today') {
    const nd = nextScheduledDayStart(med, now, s);
    const plan = planShort(med, now, s);
    big = plan === 'On a break' ? 'On a break' : 'Not today';
    sub = plan === 'On a break' ? 'Until you start another course' : nd !== null ? `Next: ${dayName.format(nd)}` : 'Nothing planned';
  } else {
    big = 'Any time'; sub = last ? `Last ${fmtWhen(Date.parse(last.takenAt), now)}` : 'No doses yet';
  }

  // How much: tablets, or for injections the syringe draw / pen clicks from the vial or pen in use.
  const guide = med.peptide && nextAmount > 0 ? doseGuide(med, nextAmount) : undefined;
  const units = !med.peptide && nextAmount > 0 && med.strength > 0 && med.unit !== 'tablet' ? stockUnitsFor(med, nextAmount) : null;
  const how = units !== null ? `${units} ${med.form === 'other' ? 'units' : `${med.form}${units === 1 ? '' : 's'}`}` : null;
  const vial = med.peptide ? vialStatus(med, doses, now) : undefined;
  const pen = isPen(med);

  const cyc = med.schedule.cycle ? cycleInfo(med.schedule.cycle, dayStart, s) : undefined;
  const ymd = (x: string) => format(new Date(`${x}T12:00`), 'EEE d MMM');
  const cycle = !cyc ? null : cyc.phase === 'before' ? `Cycle starts ${ymd(cyc.nextChange)}`
    : cyc.phase === 'off' ? `Off until ${ymd(cyc.nextChange)}`
      : cyc.length % 7 === 0 && cyc.length >= 14 ? `Week ${Math.ceil(cyc.day / 7)} of ${cyc.length / 7} on` : `Day ${cyc.day} of ${cyc.length} on`;
  const change = nextPlannedChange(med, dayKey(now, s));
  const changeSoon = change && Date.parse(`${change.from}T12:00`) - now < 8 * 86_400_000 ? change : undefined;
  const latestMs = latest ? timeInDay(dayStart, latest, s) : undefined;

  return (
    <article aria-label={person ? `${person}: ${shownName(med)}` : shownName(med)} className={`pt-6 ${footer ? 'pb-2' : 'pb-6'} ${className}`}>
      <p className="text-sm font-medium text-muted">{person ? `${label} · ${person}` : label}</p>
      <p className="mt-1.5 font-light text-[84px] leading-[84px] tracking-[-0.04em] tnum" aria-hidden="true">{big}</p>
      <p className="mt-4 text-xl font-medium flex items-center gap-2.5">
        <MedBadge color={shownColour(med)} icon={med.icon} size={34} /> <span className="min-w-0">{shownMedName(med)}</span>
      </p>
      <p className="ml-5 mt-0.5 text-[15px] text-muted tnum">
        {[sub, nextAmount > 0 && !guide ? fmtAmount(nextAmount, med.unit) : null, how].filter(Boolean).join(' · ')}
      </p>
      {(cycle || changeSoon) && (
        <p className="ml-5 text-[15px] tnum">{[cycle, changeSoon && `Changes ${ymd(changeSoon.from)}: ${fmtSchedule(changeSoon.schedule, med.unit)}`].filter(Boolean).join(' · ')}</p>
      )}

      {guide && (
        <div className="ml-5 mt-4 border-l-2 pl-4 py-1" style={{ borderColor: 'var(--text)' }}>
          {guide.kind === 'draw' ? (
            <>
              <p className="text-2xl font-medium tnum">Draw to {fmtUnits(guide.draw.units)}</p>
              <p className="text-[15px] text-muted tnum">{fmtAmount(nextAmount, med.unit)} · {guide.syringe} syringe · {guide.waterMl} mL in the vial</p>
            </>
          ) : (
            <>
              <p className="text-2xl font-medium tnum">{guide.clicks !== undefined ? `Dial ${guide.clicks} click${guide.clicks === 1 ? '' : 's'}` : `Dial ${fmtAmount(nextAmount, med.unit)}`}</p>
              <p className="text-[15px] text-muted tnum">{fmtAmount(nextAmount, med.unit)} from the pen</p>
            </>
          )}
          {vial && (
            <p className={`text-[15px] tnum ${vial.expired || vial.dosesLeft <= 1 ? 'text-caution font-medium' : 'text-muted'}`}>
              {pen ? 'Pen' : 'Vial'} {pen ? 'started' : 'mixed'} {fmtDay(vial.startedAt)} · {vial.dosesLeft} dose{vial.dosesLeft === 1 ? '' : 's'} left
              {vial.useBy ? ` · ${vial.expired ? 'past use-by' : 'use by'} ${fmtDay(vial.useBy)}` : ''}
            </p>
          )}
        </div>
      )}
      {med.schedule.type === 'interval' && next !== null && latestMs !== undefined && next > latestMs && status === 'not-due' && (
        <p className="ml-5 mt-2 text-sm text-muted">That's after your latest dose time of {fmtHHmm(latest!)}.</p>
      )}
      <p className="sr-only" aria-live="polite">{person ? `${person}, ` : ''}{shownName(med)}: {typeof big === 'string' ? big : `next at ${next ? fmtTime(next) : ''}`}. {sub}.</p>

      <Button className="w-full min-h-[56px] mt-7 text-[17px]" onClick={onLog}>Log dose</Button>
      {footer}
    </article>
  );
}

/** "10 mg · 1 tablet" or "Draw to 25 units" for one dose. */
function doseText(med: Medication, amount: number): string {
  const guide = med.peptide && amount > 0 ? doseGuide(med, amount) : undefined;
  if (guide) return guide.kind === 'draw' ? `Draw to ${fmtUnits(guide.draw.units)} · ${fmtAmount(amount, med.unit)}` : guide.clicks !== undefined ? `Dial ${guide.clicks} clicks · ${fmtAmount(amount, med.unit)}` : fmtAmount(amount, med.unit);
  const units = amount > 0 && med.strength > 0 && med.unit !== 'tablet' ? stockUnitsFor(med, amount) : null;
  const how = units !== null ? `${units} ${med.form === 'other' ? 'units' : `${med.form}${units === 1 ? '' : 's'}`}` : null;
  return [amount > 0 ? fmtAmount(amount, med.unit) : null, how].filter(Boolean).join(' · ');
}

/** The headline when several medicines are due at the same time: the time once, each medicine with what to take and
 *  its own Log, and Log all (each at its planned amount, now). */
export function HeroGroup({ meds, doses, s, now, at, due, onLog, onLogAll, whose }: {
  meds: Medication[]; doses: Dose[]; s: ScheduleSettings; now: number; at: number; due: boolean;
  onLog: (m: Medication) => void; onLogAll: (items: { med: Medication; amount: number }[]) => void;
  whose?: (m: Medication) => string | undefined;
}) {
  const items = meds.map((m) => ({ med: m, amount: getExpectedAmount(m, doses, due ? now : at, s) }));
  const [hm, ap] = format(at, 'h:mm a').split(' ');
  const sameDay = at < getDayBounds(now, s.dayStartsAt, s.tz).end;
  const label = due ? 'Due now' : sameDay ? 'Next' : `Next · ${fmtDay(at)}`;
  const all = items.filter((x) => !x.med.shared);
  return (
    <article aria-label={`${label}: ${meds.map((m) => shownName(m)).join(', ')}`} className="pt-6 pb-6">
      <p className="text-sm font-medium text-muted">{label}</p>
      <p className="mt-1.5 font-light text-[84px] leading-[84px] tracking-[-0.04em] tnum" aria-hidden="true">
        {due ? 'Now' : <>{hm}<span className="text-[28px] tracking-normal ml-1.5">{ap.toLowerCase()}</span></>}
      </p>
      <p className="mt-2 text-[15px] text-muted tnum">{due ? `Due since ${fmtTime(at)}` : `in ${fmtCountdownLong(at - now)}`} · {meds.length} medicines</p>
      <ul className="mt-3 divide-y divide-border">
        {items.map(({ med, amount }) => (
          <li key={med.id} className="flex items-center gap-3 py-2.5">
            <MedBadge color={shownColour(med)} icon={med.icon} size={34} />
            <span className="flex-1 min-w-0">
              <span className="block text-[17px] font-medium truncate">{shownMedName(med)}</span>
              <span className="block text-[15px] text-muted tnum">{[doseText(med, amount), whose?.(med)].filter(Boolean).join(' · ')}</span>
            </span>
            <Button variant="secondary" onClick={() => onLog(med)} aria-label={`Log ${shownName(med)}`}>Log</Button>
          </li>
        ))}
      </ul>
      <p className="sr-only" aria-live="polite">{label}{due ? '' : ` at ${fmtTime(at)}`}: {meds.map((m) => shownName(m)).join(', ')}.</p>
      {all.length > 1 && (due || at - now <= 60 * 60_000) && <Button className="w-full min-h-[56px] mt-4 text-[17px]" onClick={() => onLogAll(all)}>Log all {all.length} now</Button>}
    </article>
  );
}
