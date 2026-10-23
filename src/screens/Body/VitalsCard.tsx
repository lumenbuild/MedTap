import { format } from 'date-fns';
import { useState } from 'react';
import { ChevronRight, HeartPulse } from 'lucide-react';
import { useVitals } from '../../app/data';
import { personOf } from '../../db/repos/people';
import { fmtWhen } from '../../logic/format';
import { useNow } from '../../app/useNow';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { fmtVital, VitalsSheet, type VitalsSheetState } from '../../components/VitalsSheet';

/** Latest blood pressure / heart rate and recent readings for one person. */
export function VitalsCard({ personId }: { personId: string }) {
  const all = useVitals();
  const now = useNow(60_000);
  const [sheet, setSheet] = useState<VitalsSheetState>(null);
  const readings = (all ?? []).filter((v) => !v.deletedAt && personOf(v) === personId).sort((a, b) => b.at.localeCompare(a.at));
  const latest = readings[0];
  return (
    <Card>
      <div className="flex items-center gap-2 text-muted"><HeartPulse size={18} aria-hidden="true" /><h2 className="text-sm font-medium text-muted">Blood pressure and heart rate</h2></div>
      {latest ? (
        <p className="mt-2"><span className="text-[28px] leading-[36px] font-semibold tnum">{fmtVital(latest)}</span>
          <span className="block text-muted tnum">{fmtWhen(Date.parse(latest.at), now)}</span></p>
      ) : <p className="mt-1">No readings yet. Log one after measuring at home or at the pharmacy.</p>}
      <Button variant="secondary" className="w-full mt-4" onClick={() => setSheet({})}>Log a reading</Button>
      {readings.length > 1 && (
        <ul className="mt-3 -mx-2">
          {readings.slice(1, 8).map((v) => (
            <li key={v.id}>
              <button onClick={() => setSheet({ editing: v })} className="w-full min-h-[48px] flex items-center gap-3 px-2 rounded-btn text-left hover:bg-surface-2">
                <span className="flex-1 min-w-0 tnum whitespace-nowrap overflow-hidden text-ellipsis">{fmtVital(v)}</span>
                <span className="text-sm text-muted tnum whitespace-nowrap">{format(Date.parse(v.at), 'EEE d MMM')}</span>
                <ChevronRight size={18} className="text-muted" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {latest && <button onClick={() => setSheet({ editing: latest })} className="sr-only">Edit latest reading</button>}
      <VitalsSheet state={sheet} onClose={() => setSheet(null)} personId={personId} />
    </Card>
  );
}
