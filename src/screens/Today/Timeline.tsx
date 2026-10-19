import { ChevronRight, Nfc } from 'lucide-react';
import type { Dose, Medication } from '../../db/schema';
import { getDayBounds, type ScheduleSettings } from '../../logic/schedule';
import { fmtAmount, fmtTime } from '../../logic/format';
import { Card } from '../../components/ui/Card';

/** Today's entries in time order. Each row opens an editor. */
export function Timeline({ doses, meds, s, now, onEdit }: {
  doses: Dose[]; meds: Map<string, Medication>; s: ScheduleSettings; now: number; onEdit: (d: Dose) => void;
}) {
  const { start, end } = getDayBounds(now, s.dayStartsAt, s.tz);
  const today = doses
    .filter((d) => !d.deletedAt && meds.has(d.medicationId))
    .filter((d) => { const t = Date.parse(d.takenAt); return t >= start && t < end; })
    .sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt));

  return (
    <Card>
      <h2 className="text-lg font-semibold">Today</h2>
      {today.length === 0 ? (
        <p className="text-muted mt-1">Nothing logged yet today.</p>
      ) : (
        <ol className="mt-2 -mx-2">
          {today.map((d) => {
            const med = meds.get(d.medicationId)!;
            return (
              <li key={d.id}>
                <button onClick={() => onEdit(d)} className="w-full min-h-[56px] flex items-center gap-3 px-2 rounded-btn text-left hover:bg-surface-2">
                  <span className="w-[4.5rem] tnum text-muted shrink-0">{fmtTime(Date.parse(d.takenAt))}</span>
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: med.color }} aria-hidden="true" />
                  <span className="flex-1 min-w-0">
                    <span className="font-medium">{med.name}</span> <span className="tnum">{fmtAmount(d.amount, med.unit)}</span>
                    {d.source === 'backdated' && <span className="block text-xs text-muted">Logged later</span>}
                  </span>
                  {d.source === 'tag' && <Nfc size={16} className="text-muted" aria-label="Logged with a tag" />}
                  <ChevronRight size={18} className="text-muted" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
