import { format } from 'date-fns';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useVitals } from '../../app/data';
import { personOf } from '../../db/repos/people';
import { fmtWhen } from '../../logic/format';
import type { ScheduleSettings } from '../../logic/schedule';
import { useNow } from '../../app/useNow';
import { Button } from '../../components/ui/Button';
import { VitalsCharts } from '../../components/charts/Charts';
import { fmtVital, VitalsSheet, type VitalsSheetState } from '../../components/VitalsSheet';

/** Blood pressure and heart rate for one person, all in one place: the charts over the range, the latest reading, the
 *  few before it (tap to change one) and Log a reading. */
export function VitalsCard({ personId, start, end, s }: { personId: string; start: number; end: number; s: ScheduleSettings }) {
  const all = useVitals();
  const now = useNow(60_000);
  const [sheet, setSheet] = useState<VitalsSheetState>(null);
  const readings = (all ?? []).filter((v) => !v.deletedAt && personOf(v) === personId).sort((a, b) => b.at.localeCompare(a.at));
  const latest = readings[0];
  return (
    <>
      <VitalsCharts vitals={readings} start={start} end={end} s={s}
        empty={latest ? `No readings in this range. The latest was ${fmtVital(latest)}, ${fmtWhen(Date.parse(latest.at), now)}.` : 'No readings yet. Log one after measuring at home or at the pharmacy.'}
        actions={<>
          {readings.length > 0 && (
            <details className="group">
              <summary className="min-h-[44px] flex items-center gap-1.5 text-sm font-medium cursor-pointer list-none">Change a reading <ChevronDown size={16} className="text-muted transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
              <ul className="-mx-2">
                {readings.slice(0, 8).map((v) => (
                  <li key={v.id}>
                    <button onClick={() => setSheet({ editing: v })} className="w-full min-h-[48px] flex items-center gap-3 px-2 rounded-btn text-left hover:bg-surface-2">
                      <span className="flex-1 min-w-0 tnum whitespace-nowrap overflow-hidden text-ellipsis">{fmtVital(v)}</span>
                      <span className="text-sm text-muted tnum whitespace-nowrap">{format(Date.parse(v.at), 'EEE d MMM, h:mm a')}</span>
                      <ChevronRight size={18} className="text-muted" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <Button variant="secondary" className="w-full mt-2" onClick={() => setSheet({})}>Log a reading</Button>
        </>} />
      <VitalsSheet state={sheet} onClose={() => setSheet(null)} personId={personId} />
    </>
  );
}
