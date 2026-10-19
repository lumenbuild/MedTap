import type { Dose, Medication } from '../../db/schema';
import { getDailyTarget, getDosesToday, getNextDue, getStatus, type ScheduleSettings } from '../../logic/schedule';
import { fmtAmount, fmtCountdown, fmtTime } from '../../logic/format';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

const UNDO_MS = 10_000;

export function Success({ dose, loggedAt, med, doses, s, now, onUndo, onDone }: {
  dose: Dose; loggedAt: number; med: Medication; doses: Dose[]; s: ScheduleSettings; now: number;
  onUndo: () => void; onDone: () => void;
}) {
  const next = getNextDue(med, doses, now, s);
  const status = getStatus(med, doses, now, s);
  const count = getDosesToday(doses, med.id, now, s).length;
  const target = getDailyTarget(med);
  const undoLeft = Math.min(UNDO_MS / 1000, Math.ceil((UNDO_MS - (now - loggedAt)) / 1000));

  return (
    <Card className="text-center">
      <svg viewBox="0 0 96 96" width="96" height="96" className="mx-auto" aria-hidden="true">
        <circle cx="48" cy="48" r="44" fill="var(--success-soft)" />
        <path d="M30 49 l12 12 l24 -26" fill="none" stroke="var(--success)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" className="check-draw" />
      </svg>
      <h1 className="text-2xl font-semibold mt-4" role="status">
        Logged {fmtAmount(dose.amount, med.unit)} at <span className="tnum">{fmtTime(Date.parse(dose.takenAt))}</span>
      </h1>
      <p className="text-muted mt-1">{med.name}{target ? ` · Today: ${count} of ${target}` : ` · Today: ${count}`}</p>
      {status === 'done-today' ? (
        <p className="mt-4 text-lg">That's all {target} for today.</p>
      ) : next !== null ? (
        <p className="mt-4 text-lg tnum">Next due <strong>{fmtTime(next)}</strong> <span className="text-muted">(in {fmtCountdown(next - now)})</span></p>
      ) : null}
      <div className="mt-6 space-y-3">
        <Button className="w-full min-h-[56px]" onClick={onDone} autoFocus>Done</Button>
        {undoLeft > 0 && (
          <Button variant="secondary" className="w-full" onClick={onUndo}>
            Undo <span className="tnum text-muted font-normal">({undoLeft}s)</span>
          </Button>
        )}
      </div>
    </Card>
  );
}
