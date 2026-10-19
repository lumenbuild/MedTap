import { CircleCheck, Info } from 'lucide-react';
import type { Dose, Medication } from '../../db/schema';
import {
  getDailyTarget, getDosesToday, getLastDose, getNextDue, getProgress, getStatus, timeInDay, getDayBounds, type ScheduleSettings,
} from '../../logic/schedule';
import { fmtAgo, fmtCountdown, fmtCountdownLong, fmtHHmm, fmtMedName, fmtTime, fmtWhen } from '../../logic/format';
import { Ring } from '../../components/ui/Ring';
import { Button } from '../../components/ui/Button';
import { MedBadge } from '../../components/MedBadge';

export function HeroCard({ med, doses, s, now, onLog, className = '' }: {
  med: Medication; doses: Dose[]; s: ScheduleSettings; now: number; onLog: () => void; className?: string;
}) {
  const status = getStatus(med, doses, now, s);
  const next = getNextDue(med, doses, now, s);
  const last = getLastDose(doses, med.id, now);
  const count = getDosesToday(doses, med.id, now, s).length;
  const target = getDailyTarget(med);
  const progress = status === 'done-today' ? 1 : getProgress(med, doses, now, s);
  const latest = med.schedule.latestDoseTime;
  const latestMs = latest ? timeInDay(getDayBounds(now, s.dayStartsAt, s.tz).start, latest, s) : undefined;

  let center;
  let spoken: string;
  if (status === 'done-today') {
    center = (<><CircleCheck size={40} className="text-success" aria-hidden="true" /><span className="text-lg font-semibold mt-2">Done for today</span></>);
    spoken = 'Done for today.';
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
      <span className="text-sm text-muted">until next dose</span><span className="text-sm font-medium tnum mt-1">Due {fmtTime(next)}</span></>);
    spoken = `Next dose in ${fmtCountdownLong(next - now)}, at ${fmtTime(next)}.`;
  } else {
    center = (<span className="text-lg font-semibold">No doses yet today</span>);
    spoken = 'No doses yet today.';
  }

  const due = status === 'due';
  return (
    <article
      aria-label={med.name}
      className={`bg-surface rounded-card shadow-card p-5 ${className}`}
      style={due ? { outline: '2px solid var(--primary)', outlineOffset: '-2px' } : undefined}
    >
      <div className="flex items-center gap-3">
        <MedBadge color={med.color} icon={med.icon} />
        <h2 className="text-lg font-semibold leading-6">{fmtMedName(med)}</h2>
      </div>
      <div className="my-5">
        <Ring progress={progress} color={med.color}>{center}</Ring>
        <p className="sr-only" aria-live="polite">{med.name}: {spoken}</p>
      </div>
      <dl className="text-center space-y-0.5 tnum">
        <div>
          <dt className="sr-only">Last dose</dt>
          <dd>{last ? <>Last dose {fmtAgo(now - Date.parse(last.takenAt))} · {fmtWhen(Date.parse(last.takenAt), now)}</> : 'No doses logged yet'}</dd>
        </div>
        <div>
          <dt className="sr-only">Today</dt>
          <dd className="text-muted">Today: {count}{target ? ` of ${target}` : ''}</dd>
        </div>
      </dl>
      {med.schedule.type === 'interval' && next !== null && latestMs !== undefined && next > latestMs && status === 'not-due' && (
        <p className="mt-3 text-sm text-muted text-center">That's after your latest dose time of {fmtHHmm(latest!)}.</p>
      )}
      <Button className="w-full min-h-[56px] mt-5" variant={due || status === 'none-today' ? 'primary' : 'secondary'} onClick={onLog}>
        Log dose
      </Button>
    </article>
  );
}
