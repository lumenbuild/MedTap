import type { Dose, Medication } from '../../db/schema';
import { shownColour, shownMedName, shownName } from '../../logic/privacy';
import { getDosesToday, getLastDose, getRollingUsage, type ScheduleSettings } from '../../logic/schedule';
import { fmtAgo, fmtAmount, fmtTime, fmtWhen } from '../../logic/format';
import { guideText } from '../../logic/peptide';
import { MedBadge } from '../../components/MedBadge';
import { Button } from '../../components/ui/Button';

/** As-needed medications: last taken only, no countdown. */
export function PrnCard({ med, doses, s, now, onLog, person, limits = true }: {
  med: Medication; doses: Dose[]; s: ScheduleSettings; now: number; onLog: () => void; person?: string;
  /** Show the 24-hour limits line (off when several people's doses are mixed, e.g. a shared medicine in the Everyone view). */
  limits?: boolean;
}) {
  const last = getLastDose(doses, med.id, now);
  const count = getDosesToday(doses, med.id, now, s).length;
  const sc = med.schedule;
  const hasLimits = limits && !!(sc.maxPer24h || sc.maxAmountPer24h || sc.minHoursApart);
  const u = hasLimits ? getRollingUsage(med, doses, now) : null;
  const atLimit = !!u && ((!!sc.maxPer24h && u.count >= sc.maxPer24h) || (!!sc.maxAmountPer24h && u.amount >= sc.maxAmountPer24h));
  return (
    <article aria-label={shownName(med)} className="bg-surface rounded-card shadow-card p-4 flex items-center gap-3">
      <MedBadge color={shownColour(med)} icon={med.icon} />
      <div className="flex-1 min-w-0">
        {person && <p className="text-xs font-semibold text-primary">{person}</p>}
        <h3 className="font-semibold truncate">{shownMedName(med)}</h3>
        <p className="text-sm text-muted tnum">
          {last ? <>Last taken {fmtAgo(now - Date.parse(last.takenAt))} · {fmtWhen(Date.parse(last.takenAt), now)}</> : 'Not taken yet'}
          {count > 0 && !u && <> · Today: {count}</>}
        </p>
        {med.peptide && guideText(med, med.defaultAmount) && (
          <p className="text-sm font-medium tnum">Usual dose {fmtAmount(med.defaultAmount, med.unit)} · {guideText(med, med.defaultAmount)}</p>
        )}
        {u && (
          <p className={`text-sm tnum ${atLimit || u.gapEndsAt ? 'text-caution font-medium' : 'text-muted'}`}>
            Last 24 h: {u.count}{sc.maxPer24h ? ` of ${sc.maxPer24h}` : ''}
            {sc.maxAmountPer24h ? ` · ${fmtAmount(u.amount, med.unit)} of ${fmtAmount(sc.maxAmountPer24h, med.unit)}` : ''}
            {u.gapEndsAt ? ` · ${sc.minHoursApart}-hour gap ends ${fmtTime(u.gapEndsAt)}` : ''}
          </p>
        )}
      </div>
      <Button variant="secondary" onClick={onLog} aria-label={`Log ${shownName(med)}`}>Log</Button>
    </article>
  );
}
