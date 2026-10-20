import { useState } from 'react';
import { shownName } from '../../logic/privacy';
import { CalendarPlus } from 'lucide-react';
import type { Dose, Medication } from '../../db/schema';
import { addCheckIn } from '../../db/repos/checkIns';
import { addToCalendar } from '../../app/calendar';
import { MoodPicker, MOOD_LABELS } from '../../components/ui/Rating';
import { getDailyTarget, getDosesToday, getNextDue, getStatus, type ScheduleSettings } from '../../logic/schedule';
import { fmtAmount, fmtCountdown, fmtTime, fmtWhen } from '../../logic/format';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

const UNDO_MS = 10_000;

export function Success({ dose, loggedAt, med, doses, s, now, onUndo, onDone, person }: {
  dose: Dose; loggedAt: number; med: Medication; doses: Dose[]; s: ScheduleSettings; now: number;
  onUndo: () => void; onDone: () => void; person?: string;
}) {
  const next = getNextDue(med, doses, now, s);
  const status = getStatus(med, doses, now, s);
  const count = getDosesToday(doses, med.id, now, s).length;
  const target = getDailyTarget(med, now, s);
  const [mood, setMood] = useState<number>();
  const saveMood = async (v?: number) => {
    if (!v || mood) return;
    setMood(v);
    await addCheckIn({ at: new Date().toISOString(), mood: v, chips: [], relatedDoseId: dose.id });
  };
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
      <p className="text-muted mt-1">{person ? `${person} · ` : ''}{shownName(med)}{target ? ` · Today: ${count} of ${target}` : ` · Today: ${count}`}</p>
      {status === 'done-today' && <p className="mt-4 text-lg">That's all {target} for today.</p>}
      {next !== null && next > now && (
        <p className={`${status === 'done-today' ? 'mt-1' : 'mt-4 text-lg'} tnum`}>Next due <strong>{fmtWhen(next, now)}</strong> <span className="text-muted">(in {fmtCountdown(next - now)})</span></p>
      )}
      {next !== null && next > now && (
        <button onClick={() => addToCalendar(med, next, person)} className="mt-2 min-h-[48px] px-3 inline-flex items-center gap-2 text-primary font-semibold">
          <CalendarPlus size={18} aria-hidden="true" /> Add to calendar
        </button>
      )}
      <div className="mt-5 text-left">
        <p className="text-sm font-medium mb-2" aria-live="polite">{mood ? `Saved: feeling ${MOOD_LABELS[mood - 1].toLowerCase()}` : 'How are you feeling? (optional)'}</p>
        <MoodPicker value={mood} onChange={saveMood} compact />
      </div>
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
