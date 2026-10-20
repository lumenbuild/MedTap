import { CalendarDays, CircleCheck, Info } from 'lucide-react';
import { shownColour, shownMedName, shownName } from '../../logic/privacy';
import type { Dose, Medication } from '../../db/schema';
import {
  getDailyAmountTarget, getDailyTarget, getDayBounds, getDosesToday, getExpectedAmount, getLastDose, getNextDue, getProgress, getStatus,
  nextScheduledDayStart, timeInDay, type ScheduleSettings,
} from '../../logic/schedule';
import { fmtAgo, fmtAmount, fmtCountdown, fmtCountdownLong, fmtDays, fmtHHmm, fmtSchedule, fmtTime, fmtWhen } from '../../logic/format';
import { format } from 'date-fns';
import { nextPlannedChange } from '../../logic/plans';
import { dayKey } from '../../logic/stats';
import { stockUnitsFor } from '../../logic/stock';
import { medColour } from '../../logic/palette';
import { Ring } from '../../components/ui/Ring';
import { Button } from '../../components/ui/Button';
import { MedBadge } from '../../components/MedBadge';
import { PersonBadge } from '../../components/PersonSwitcher';

const dayName = new Intl.DateTimeFormat('en-AU', { weekday: 'long' });

export function HeroCard({ med, doses, s, now, onLog, className = '', footer, person }: {
  med: Medication; doses: Dose[]; s: ScheduleSettings; now: number; onLog: () => void; className?: string; footer?: React.ReactNode;
  /** Whose medication this is (shown in the Everyone view). */
  person?: string;
}) {
  const status = getStatus(med, doses, now, s);
  const next = getNextDue(med, doses, now, s);
  const last = getLastDose(doses, med.id, now);
  const today = getDosesToday(doses, med.id, now, s);
  const count = today.length;
  const target = getDailyTarget(med, now, s);
  const amountTarget = getDailyAmountTarget(med, now, s);
  const amountToday = today.filter((d) => !d.skipped).reduce((a, d) => a + d.amount, 0);
  const skippedToday = today.filter((d) => d.skipped).length;
  const progress = status === 'done-today' ? 1 : getProgress(med, doses, now, s);
  const latest = med.schedule.latestDoseTime;
  const latestMs = latest ? timeInDay(getDayBounds(now, s.dayStartsAt, s.tz).start, latest, s) : undefined;
  // What the plan says for the next dose (shown when it differs from dose to dose, or always for set amounts).
  const nextAmount = status !== 'done-today' && status !== 'not-today' ? getExpectedAmount(med, doses, next ?? now, s) : null;
  const nextUnits = nextAmount && med.strength > 0 && med.unit !== 'tablet' ? stockUnitsFor(med, nextAmount) : null;

  let center;
  let spoken: string;
  if (status === 'done-today') {
    center = (<><CircleCheck size={40} className="text-success" aria-hidden="true" /><span className="text-lg font-semibold mt-2">Done for today</span>
      {next !== null && next > now && <span className="text-sm text-muted tnum mt-1">Next {fmtWhen(next, now)}</span>}</>);
    spoken = `Done for today.${next !== null && next > now ? ` Next ${fmtWhen(next, now)}.` : ''}`;
  } else if (status === 'not-today' && next !== null) {
    center = (<><span className="text-[40px] leading-[44px] font-semibold tnum">{fmtCountdown(next - now)}</span>
      <span className="text-sm text-muted">Not scheduled today</span><span className="text-sm font-medium tnum mt-1">Next {fmtWhen(next, now)}</span></>);
    spoken = `Not scheduled today. Next dose ${fmtWhen(next, now)}, in ${fmtCountdownLong(next - now)}.`;
  } else if (status === 'not-today') {
    const nd = nextScheduledDayStart(med, now, s);
    center = (<><CalendarDays size={36} className="text-muted" aria-hidden="true" /><span className="font-semibold mt-2">Not scheduled today</span>
      {nd !== null && <span className="text-sm text-muted">Next: {dayName.format(nd)}</span>}</>);
    spoken = `Not scheduled today.${nd !== null ? ` Next: ${dayName.format(nd)}.` : ''}`;
  } else if (status === 'past-latest-time') {
    center = (<><Info size={36} className="text-muted" aria-hidden="true" /><span className="font-semibold mt-2">Past your latest dose time</span>
      {latest && <span className="text-sm text-muted tnum">{fmtHHmm(latest)}</span>}</>);
    spoken = 'Past your latest dose time.';
  } else if (status === 'due' && next !== null) {
    center = (<><span className="text-sm text-muted">Next dose</span><span className="text-[40px] leading-[44px] font-semibold text-primary">Due now</span>
      <span className="text-sm text-muted tnum">since {fmtTime(next)}</span></>);
    spoken = `Due now, since ${fmtTime(next)}.`;
  } else if (next !== null) {
    center = (<><span className="text-[40px] leading-[44px] font-semibold tnum">{fmtCountdown(next - now)}</span>
      <span className="text-sm text-muted">until next dose</span><span className="text-sm font-medium tnum mt-1">Due {fmtWhen(next, now)}</span></>);
    spoken = `Next dose in ${fmtCountdownLong(next - now)}, at ${fmtWhen(next, now)}.`;
  } else {
    center = (<span className="text-lg font-semibold">No doses yet today</span>);
    spoken = 'No doses yet today.';
  }
  if (nextAmount) spoken += ` Next dose: ${fmtAmount(nextAmount, med.unit)}.`;

  const due = status === 'due';
  const days = fmtDays(med.schedule);
  const change = nextPlannedChange(med, dayKey(now, s));
  const changeSoon = change && Date.parse(`${change.from}T12:00`) - now < 8 * 86_400_000 ? change : undefined;
  return (
    <article
      aria-label={person ? `${person}: ${shownName(med)}` : shownName(med)}
      className={`bg-surface rounded-card shadow-card p-5 h-full ${className}`}
      style={due ? { outline: '2px solid var(--primary)', outlineOffset: '-2px' } : undefined}
    >
      {person && <p className="flex items-center gap-2 text-sm font-semibold text-primary mb-3"><PersonBadge name={person} size={24} /> {person}</p>}
      <div className="flex items-center gap-3">
        <MedBadge color={shownColour(med)} icon={med.icon} />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-6">{shownMedName(med)}</h2>
          {days && <p className="text-sm text-muted">{days}</p>}
          {changeSoon && <p className="text-sm text-primary font-medium tnum">Changes {format(new Date(`${changeSoon.from}T12:00`), 'EEE d MMM')}: {fmtSchedule(changeSoon.schedule, med.unit)}</p>}
        </div>
      </div>
      <div className="my-5">
        <Ring progress={status === 'not-today' && next === null ? 0 : progress} color={medColour(shownColour(med))}>{center}</Ring>
        <p className="sr-only" aria-live="polite">{person ? `${person}, ` : ''}{shownName(med)}: {spoken}</p>
      </div>
      <dl className="text-center space-y-0.5 tnum">
        {nextAmount !== null && nextAmount > 0 && (
          <div>
            <dt className="sr-only">Next dose amount</dt>
            <dd className="font-semibold">Next: {fmtAmount(nextAmount, med.unit)}{nextUnits !== null ? ` · ${nextUnits} ${med.form === 'other' ? 'units' : `${med.form}${nextUnits === 1 ? '' : 's'}`}` : ''}</dd>
          </div>
        )}
        <div>
          <dt className="sr-only">Last dose</dt>
          <dd>{last ? <>Last dose {fmtAgo(now - Date.parse(last.takenAt))} · {fmtWhen(Date.parse(last.takenAt), now)}</> : 'No doses logged yet'}</dd>
        </div>
        {status !== 'not-today' && (
          <div>
            <dt className="sr-only">Today</dt>
            <dd className="text-muted">
              Today: {count}{target ? ` of ${target}` : ''}
              {amountTarget !== undefined ? ` · ${fmtAmount(amountToday, med.unit)} of ${fmtAmount(amountTarget, med.unit)}` : ''}
              {skippedToday ? ` · ${skippedToday} skipped` : ''}
            </dd>
          </div>
        )}
      </dl>
      {med.schedule.type === 'interval' && next !== null && latestMs !== undefined && next > latestMs && status === 'not-due' && (
        <p className="mt-3 text-sm text-muted text-center">That's after your latest dose time of {fmtHHmm(latest!)}.</p>
      )}
      <Button className="w-full min-h-[56px] mt-5" variant={due || status === 'none-today' ? 'primary' : 'secondary'} onClick={onLog}>
        Log dose
      </Button>
      {footer}
    </article>
  );
}
