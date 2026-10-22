import { useState } from 'react';
import { format } from 'date-fns';
import type { Medication } from '../../db/schema';
import type { LotStats } from '../../logic/protocol';
import { DEFAULT_LEAD_DAYS } from '../../logic/protocol';
import { setLeadTime, setLotFlag } from '../../db/repos/meds';
import { useSettings } from '../../app/data';
import { useToast } from '../../app/toast';
import { kgTo, weightUnit } from '../../logic/units';
import { HAS_BODY } from '../../edition';
import { Sheet, SheetActions } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { TextInput } from '../../components/ui/Field';

const day = (ms: number) => format(ms, 'd MMM');

/** Each batch (lot) used: its vials and doses, and what was recorded while they were in use. Flag one with a note, and
 *  mixing another vial from it shows the note. */
export function LotSheet({ med, batches, onClose }: { med: Medication; batches: LotStats[]; onClose: () => void }) {
  const settings = useSettings();
  const toast = useToast();
  const [flagging, setFlagging] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const units = settings?.units ?? 'metric';
  return (
    <Sheet open onClose={onClose} title={`Batches: ${med.name}`}>
      <p className="text-sm text-muted mb-2">What you recorded while each batch's vials were in use, side by side. It doesn't show cause.</p>
      <ul>
        {batches.map((b) => (
          <li key={b.lot} className="border-t border-border py-4 space-y-1">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-lg font-medium">Lot {b.lot}</p>
              <p className="text-sm text-muted tnum">{day(b.from)} – {day(b.to)}</p>
            </div>
            <p className="text-sm text-muted">{[b.supplier, `${b.vials} vial${b.vials === 1 ? '' : 's'}`, `${b.doses} dose${b.doses === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</p>
            <p className="text-[15px] tnum">
              {[
                HAS_BODY && b.perWeek !== undefined ? `${b.perWeek > 0 ? '+' : ''}${kgTo(b.perWeek, units)} ${weightUnit(units)}/week` : null,
                b.appetite !== undefined ? `appetite ${b.appetite}` : null,
                b.noticed.length ? b.noticed.map((x) => `${x.chip} (${x.n})`).join(', ') : null,
              ].filter(Boolean).join(' · ') || <span className="text-muted">No weigh-ins or check-ins while it was in use</span>}
            </p>
            {b.flag && <p className="text-sm text-caution font-medium">Flagged{b.flag.note ? `: “${b.flag.note}”` : ''}</p>}
            {flagging === b.lot ? (
              <div className="space-y-2 pt-2">
                <TextInput label="Note (optional)" placeholder="e.g. Felt weaker than usual" value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
                <div className="flex gap-2">
                  <Button onClick={async () => { await setLotFlag(med.id, b.lot, note); setFlagging(null); toast(`Batch ${b.lot} flagged`); }}>Flag batch</Button>
                  <Button variant="secondary" onClick={() => setFlagging(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <button className="min-h-[44px] text-[15px] font-medium underline underline-offset-4" onClick={async () => {
                if (b.flag) { await setLotFlag(med.id, b.lot, null); toast(`Flag removed from ${b.lot}`); }
                else { setNote(''); setFlagging(b.lot); }
              }}>{b.flag ? 'Remove flag' : 'Flag this batch'}</button>
            )}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/** How long an order takes to arrive, so the "order by" date leaves time for delivery. */
export function LeadTimeSheet({ med, onClose }: { med: Medication; onClose: () => void }) {
  const toast = useToast();
  const [days, setDays] = useState(String(med.peptide?.leadTimeDays ?? DEFAULT_LEAD_DAYS));
  const n = Number(days);
  const ok = Number.isInteger(n) && n >= 0 && n <= 90;
  return (
    <Sheet open onClose={onClose} title="Delivery time">
      <div className="space-y-4">
        <TextInput label={`Days for an order of ${med.name} to arrive`} type="number" inputMode="numeric" min="0" max="90" step="1"
          value={days} onChange={(e) => setDays(e.target.value)} error={ok ? undefined : 'Enter 0 to 90 days.'}
          help="The order-by date is this many days before you'd run out." />
        <SheetActions>
          <Button className="w-full min-h-[56px]" disabled={!ok} onClick={async () => { await setLeadTime(med.id, n); toast('Saved'); onClose(); }}>Save</Button>
        </SheetActions>
      </div>
    </Sheet>
  );
}
