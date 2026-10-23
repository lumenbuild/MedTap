import type { Dose, Medication } from '../../db/schema';
import { shownColour, shownMedName, shownName } from '../../logic/privacy';
import { getDosesToday, getNextDue, getStatus, type ScheduleSettings } from '../../logic/schedule';
import { fmtTime, fmtWhen } from '../../logic/format';
import { medColour } from '../../logic/palette';
import { planShort } from '../../logic/dosePlan';

/** One scheduled medicine on Today (B2): a dot (filled when today's doses are done), its name, and where it's at. */
export function TodayRow({ med, doses, s, now, onLog, person }: {
  med: Medication; doses: Dose[]; s: ScheduleSettings; now: number; onLog: () => void; person?: string;
}) {
  const status = getStatus(med, doses, now, s);
  const next = getNextDue(med, doses, now, s);
  const today = getDosesToday(doses, med.id, now, s).filter((d) => !d.skipped);
  const done = status === 'done-today';
  const colour = medColour(shownColour(med));
  const right = done ? (today.length ? fmtTime(Date.parse(today[today.length - 1].takenAt)) : 'Done')
    : status === 'due' ? 'Due now'
      : status === 'not-today' ? planShort(med, now, s) ?? 'Not today'
        : status === 'past-latest-time' ? 'Past latest time'
          : next !== null ? fmtWhen(next, now) : '';
  return (
    <li>
      <button onClick={onLog} aria-label={`Log ${shownName(med)}: ${right}`} className="w-full min-h-[52px] flex items-center gap-3 text-left">
        <span aria-hidden="true" className="w-4 h-4 rounded-full shrink-0" style={done ? { background: colour } : { border: `1.5px solid ${colour}` }} />
        <span className="flex-1 min-w-0">
          <span className="block truncate">{shownMedName(med)}</span>
          {person && <span className="block text-xs text-muted">{person}</span>}
        </span>
        <span className={`text-[15px] tnum ${status === 'due' ? 'font-semibold' : 'text-muted'}`}>{right}</span>
      </button>
    </li>
  );
}
