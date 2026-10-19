import type { Dose, Medication } from '../../db/schema';
import { getDosesToday, getLastDose, type ScheduleSettings } from '../../logic/schedule';
import { fmtAgo, fmtMedName, fmtWhen } from '../../logic/format';
import { MedBadge } from '../../components/MedBadge';
import { Button } from '../../components/ui/Button';

/** As-needed medications: last taken only, no countdown. */
export function PrnCard({ med, doses, s, now, onLog }: { med: Medication; doses: Dose[]; s: ScheduleSettings; now: number; onLog: () => void }) {
  const last = getLastDose(doses, med.id, now);
  const count = getDosesToday(doses, med.id, now, s).length;
  return (
    <article aria-label={med.name} className="bg-surface rounded-card shadow-card p-4 flex items-center gap-3">
      <MedBadge color={med.color} icon={med.icon} />
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold truncate">{fmtMedName(med)}</h3>
        <p className="text-sm text-muted tnum">
          {last ? <>Last taken {fmtAgo(now - Date.parse(last.takenAt))} · {fmtWhen(Date.parse(last.takenAt), now)}</> : 'Not taken yet'}
          {count > 0 && <> · Today: {count}</>}
        </p>
      </div>
      <Button variant="secondary" onClick={onLog} aria-label={`Log ${med.name}`}>Log</Button>
    </article>
  );
}
