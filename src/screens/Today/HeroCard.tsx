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
  const nextAmount = status !== 'done-today' && status !== 'not-today' ? getExpectedAmount(med, doses, next ?? now, s) : med.defaultAmount;
  const latest = med.schedule.latestDoseTime;

  // The headline: a time, "Now", "Done" or "Not today".
  let big: React.ReactNode;
  let label = 'Next';
  let sub: string;
  if (status === 'due' && next !== null) {
    big = 'Now'; sub = `Due since ${fmtTime(next)}`;
  } else if (status === 'done-today') {
    big = 'Done'; label = 'Today';
    sub = next !== null && next > now ? `Next ${fmtWhen(next, now)}` : 'All taken';
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
