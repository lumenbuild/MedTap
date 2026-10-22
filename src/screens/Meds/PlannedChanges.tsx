import { useState } from 'react';
import { format, addDays } from 'date-fns';
import { CalendarClock, Trash2 } from 'lucide-react';
import type { Medication, PlannedChange } from '../../db/schema';
import { addPlannedChange, removePlannedChange } from '../../db/repos/meds';
import { fmtAmount, fmtSchedule } from '../../logic/format';
import { medOn } from '../../logic/plans';
import { useToast } from '../../app/toast';
import { APP_NAME } from '../../config';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Sheet, SheetActions } from '../../components/ui/Sheet';
import { TextInput } from '../../components/ui/Field';
import { ScheduleFields, scheduleFormFromMed, scheduleFromForm, validateSchedule, type ScheduleErrors, type ScheduleForm } from './ScheduleFields';

const fmtDate = (ymd: string) => format(new Date(`${ymd}T12:00`), 'EEE d MMM yyyy');
const ymd = (d: Date) => format(d, 'yyyy-MM-dd');

/** Dose changes and tapers that take over on a date. Each is applied automatically on its day. */
export function PlannedChanges({ med }: { med: Medication }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const changes = [...(med.plannedChanges ?? [])].sort((a, b) => a.from.localeCompare(b.from));

  const remove = async (c: PlannedChange) => {
    await removePlannedChange(med.id, c.id);
    toast(`Removed the change on ${fmtDate(c.from)}`, { onAction: () => addPlannedChange(med.id, c) });
  };

  return (
    <Card>
      <h2 className="text-sm font-medium text-muted flex items-center gap-2"><CalendarClock size={20} className="text-primary" aria-hidden="true" /> Planned changes</h2>
      {changes.length === 0 ? (
        <p className="text-muted mt-1">For a dose change or a taper your prescriber has planned. On the day, {APP_NAME} switches over and records the change.</p>
      ) : (
        <ol className="mt-2 space-y-2">
          {changes.map((c) => (
            <li key={c.id} className="flex items-start gap-3 rounded-btn bg-surface-2 p-3">
              <span className="flex-1">
                <span className="block font-semibold tnum">From {fmtDate(c.from)}</span>
                <span className="block text-sm tnum">{fmtSchedule(c.schedule, med.unit)}</span>
                {c.schedule.type === 'prn' && <span className="block text-sm tnum">Usual dose {fmtAmount(c.defaultAmount, med.unit)}</span>}
                {c.note && <span className="block text-sm text-muted">{c.note}</span>}
              </span>
              <button onClick={() => remove(c)} aria-label={`Remove the change on ${fmtDate(c.from)}`}
                className="w-12 h-12 -m-1 rounded-btn flex items-center justify-center text-muted"><Trash2 size={20} aria-hidden="true" /></button>
            </li>
          ))}
        </ol>
      )}
      <Button variant="secondary" className="w-full mt-3" onClick={() => setOpen(true)}>Plan a change</Button>
      {open && <PlanChangeSheet med={med} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function PlanChangeSheet({ med, onClose }: { med: Medication; onClose: () => void }) {
  const toast = useToast();
  const last = [...(med.plannedChanges ?? [])].sort((a, b) => a.from.localeCompare(b.from)).pop();
  // Start from the schedule that will be in force just before the new change: easy to step a taper.
  const [from, setFrom] = useState(last ? ymd(addDays(new Date(`${last.from}T12:00`), 7)) : ymd(addDays(new Date(), 1)));
  const [f, setF] = useState<ScheduleForm>(() => scheduleFormFromMed(last ? medOn(med, last.from) : med));
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const set = <K extends keyof ScheduleForm>(k: K, v: ScheduleForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const tomorrow = ymd(addDays(new Date(), 1));
  const errors: ScheduleErrors & { from?: string } = tried ? validateSchedule(f) : {};
  if (tried && (!from || from < tomorrow)) errors.from = 'Choose a date from tomorrow on. To change today, edit the medication.';

  const save = async () => {
    setTried(true);
    if (Object.keys(validateSchedule(f)).length || !from || from < tomorrow) return;
    const { schedule, defaultAmount } = scheduleFromForm(f);
    await addPlannedChange(med.id, { from, schedule, defaultAmount, note: note.trim() || undefined });
    toast(`Change planned for ${fmtDate(from)}`);
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title="Plan a change">
      <div className="space-y-4">
        <TextInput label="Starting on" type="date" min={tomorrow} value={from} onChange={(e) => setFrom(e.target.value)} error={errors.from} />
        <ScheduleFields f={f} set={set} errors={errors} unit={med.unit} />
        <TextInput label="Note (optional)" placeholder="e.g. Week 2 of taper, per Dr Lee" value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="text-sm text-muted">For a taper, add one change for each step. Enter what your prescriber told you.</p>
        <SheetActions>
          <Button className="w-full min-h-[56px]" onClick={save}>Save planned change</Button>
        </SheetActions>
      </div>
    </Sheet>
  );
}
