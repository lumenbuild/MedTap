import { useEffect, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { format } from 'date-fns';
import type { Medication, Schedule, ScheduleType } from '../../db/schema';
import { db } from '../../db/db';
import { useLive } from '../../db/live';
import { useMeds } from '../../app/data';
import { createMed, deleteMedForever, setArchived, updateMed, type MedInput } from '../../db/repos/meds';
import { linkTag } from '../../db/repos/tags';
import { go, replace } from '../../app/router';
import { useToast } from '../../app/toast';
import { MED_COLOURS, MED_ICONS } from '../../logic/palette';
import { stockUnitsFor } from '../../logic/stock';
import { fmtAmount, fmtSchedule } from '../../logic/format';
import { APP_NAME } from '../../config';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { Segmented, Select, TextArea, TextInput } from '../../components/ui/Field';
import { MED_ICON_COMPONENTS } from '../../components/MedBadge';
import { TagsSection } from './TagsSection';

const UNITS = ['mg', 'mcg', 'mL', 'units', 'tablet'];
const FORMS = ['tablet', 'capsule', 'liquid', 'patch', 'injection', 'other'];

interface Form {
  name: string; strength: string; unit: string; form: string; defaultAmount: string;
  type: ScheduleType; intervalHours: string; maxPerDay: string; latestDoseTime: string; times: string[];
  color: string; icon: string; stockCount: string; lowStockAt: string; scriptNotes: string;
}

const blank: Form = {
  name: '', strength: '', unit: 'mg', form: 'tablet', defaultAmount: '',
  type: 'interval', intervalHours: '4', maxPerDay: '', latestDoseTime: '', times: ['08:00'],
  color: MED_COLOURS[0].value, icon: 'pill', stockCount: '', lowStockAt: '', scriptNotes: '',
};

const str = (n?: number) => (n === undefined || n === null ? '' : String(n));
const num = (s: string) => (s.trim() === '' ? undefined : Number(s));

function fromMed(m: Medication): Form {
  return {
    name: m.name, strength: str(m.strength), unit: m.unit, form: m.form, defaultAmount: str(m.defaultAmount),
    type: m.schedule.type, intervalHours: str(m.schedule.intervalHours) || '4', maxPerDay: str(m.schedule.maxPerDay),
    latestDoseTime: m.schedule.latestDoseTime ?? '', times: m.schedule.times?.length ? m.schedule.times : ['08:00'],
    color: m.color, icon: m.icon, stockCount: str(m.stockCount), lowStockAt: str(m.lowStockAt), scriptNotes: m.scriptNotes ?? '',
  };
}

function toInput(f: Form): MedInput {
  let schedule: Schedule;
  if (f.type === 'interval') {
    schedule = { type: 'interval', intervalHours: Number(f.intervalHours), maxPerDay: num(f.maxPerDay), latestDoseTime: f.latestDoseTime || undefined };
  } else if (f.type === 'fixed') {
    const times = [...new Set(f.times.filter(Boolean))].sort();
    schedule = { type: 'fixed', times, maxPerDay: num(f.maxPerDay) };
  } else {
    schedule = { type: 'prn' };
  }
  return {
    name: f.name.trim(), strength: Number(f.strength) || 0, unit: f.unit, form: f.form,
    defaultAmount: Number(f.defaultAmount), schedule, color: f.color, icon: f.icon,
    stockCount: num(f.stockCount), lowStockAt: num(f.lowStockAt), scriptNotes: f.scriptNotes.trim() || undefined,
  };
}

function validate(f: Form): Partial<Record<keyof Form, string>> {
  const e: Partial<Record<keyof Form, string>> = {};
  const pos = (s: string) => s.trim() !== '' && Number(s) > 0;
  const posOrBlank = (s: string) => s.trim() === '' || Number(s) > 0;
  if (!f.name.trim()) e.name = 'Enter a name.';
  if (!posOrBlank(f.strength)) e.strength = 'Enter a number above 0, or leave it blank.';
  if (!pos(f.defaultAmount)) e.defaultAmount = 'Enter how much you usually take.';
  if (f.type === 'interval' && !pos(f.intervalHours)) e.intervalHours = 'Enter how many hours apart.';
  if (f.type !== 'prn' && f.maxPerDay.trim() && !(Number.isInteger(Number(f.maxPerDay)) && Number(f.maxPerDay) > 0)) e.maxPerDay = 'Enter a whole number, or leave it blank.';
  if (f.type === 'fixed' && !f.times.some(Boolean)) e.times = 'Add at least one time.';
  if (f.stockCount.trim() && !(Number(f.stockCount) >= 0)) e.stockCount = 'Enter a number, or leave it blank.';
  if (f.lowStockAt.trim() && !(Number(f.lowStockAt) >= 0)) e.lowStockAt = 'Enter a number, or leave it blank.';
  return e;
}

/** What changed in strength, dose or schedule, in words. Empty when nothing did. */
function describeChange(before: Medication, after: MedInput): string[] {
  const out: string[] = [];
  if (before.strength !== after.strength || before.unit !== after.unit)
    out.push(`Strength ${fmtAmount(before.strength, before.unit)} → ${fmtAmount(after.strength, after.unit)}`);
  if (before.defaultAmount !== after.defaultAmount)
    out.push(`Dose ${fmtAmount(before.defaultAmount, before.unit)} → ${fmtAmount(after.defaultAmount, after.unit)}`);
  if (fmtSchedule(before.schedule) !== fmtSchedule(after.schedule))
    out.push(`Schedule ${fmtSchedule(before.schedule)} → ${fmtSchedule(after.schedule)}`);
  return out;
}

export function MedEditor({ id, tagId }: { id?: string; tagId?: string }) {
  const existing = useLive(() => (id ? db.medications.get(id).then((m) => m ?? null) : null), [id]);
  const toast = useToast();
  const [f, setF] = useState<Form>(blank);
  const [tried, setTried] = useState(false);
  const [change, setChange] = useState<{ lines: string[]; date: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typed, setTyped] = useState('');
  const loadedId = existing?.id;

  useEffect(() => { if (existing) setF(fromMed(existing)); }, [loadedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // New medications start with a colour no active medication is using, so cards are easy to tell apart.
  const meds = useMeds();
  const medsLoaded = !!meds;
  useEffect(() => {
    if (id || !meds) return;
    const used = new Set(meds.filter((m) => !m.archived).map((m) => m.color));
    const free = MED_COLOURS.find((c) => !used.has(c.value));
    if (free) setF((p) => ({ ...p, color: free.value }));
  }, [id, medsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  if (id && existing === undefined) return <div className="h-96 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  if (id && existing === null) {
    return <Card><p>This medication doesn't exist any more.</p><Button className="mt-4" onClick={() => replace('/meds')}>Back to Meds</Button></Card>;
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));
  const errors = tried ? validate(f) : {};
  const amountLabel = f.unit === 'tablet' ? 'tablets' : f.unit;

  const save = async (record?: { date: string; lines: string[] }) => {
    const input = toInput(f);
    if (existing) {
      const at = record ? new Date(`${record.date}T${format(Date.now(), 'HH:mm')}`).toISOString() : undefined;
      await updateMed(existing.id, input, record && at ? {
        at, summary: record.lines.join('; '),
        before: { strength: existing.strength, unit: existing.unit, defaultAmount: existing.defaultAmount, schedule: existing.schedule },
        after: { strength: input.strength, unit: input.unit, defaultAmount: input.defaultAmount, schedule: input.schedule },
      } : undefined);
      toast(`Saved ${input.name}`);
      go('/meds');
    } else {
      const med = await createMed(input);
      if (tagId) {
        await linkTag(tagId, med.id);
        toast(`Saved ${med.name} and linked the tag`);
        replace(`/tag/${tagId}`);
      } else {
        toast(`Saved ${med.name}. Next, link a tag.`);
        replace(`/meds/${med.id}`);
      }
    }
  };

  const onSave = () => {
    setTried(true);
    if (Object.keys(validate(f)).length) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]')?.scrollIntoView({ block: 'center' }));
      return;
    }
    if (existing) {
      const lines = describeChange(existing, toInput(f));
      if (lines.length) { setChange({ lines, date: format(Date.now(), 'yyyy-MM-dd') }); return; }
    }
    save();
  };

  const archive = async () => {
    if (!existing) return;
    await setArchived(existing.id, !existing.archived);
    toast(existing.archived ? `Restored ${existing.name}` : `Archived ${existing.name}`, {
      onAction: () => setArchived(existing.id, existing.archived),
    });
    go('/meds');
  };

  const draftAmount = Number(f.defaultAmount);
  const perDose = draftAmount > 0 ? stockUnitsFor({ strength: Number(f.strength) || 0 }, draftAmount) : undefined;

  return (
    <div className="space-y-4 pb-24">
      {tagId && (
        <Card className="bg-primary-soft shadow-none"><p>After you save, the tag you tapped will be linked to this medication.</p></Card>
      )}
      {existing && <TagsSection med={existing} />}

      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">Medication</h2>
        <TextInput label="Name" value={f.name} onChange={(e) => set('name', e.target.value)} error={errors.name} autoComplete="off" autoFocus={!id} />
        <div className="grid grid-cols-[1fr_auto] gap-3 items-start">
          <TextInput label="Strength" type="number" inputMode="decimal" min="0" step="any" value={f.strength} onChange={(e) => set('strength', e.target.value)} error={errors.strength} />
          <Select label="Unit" value={f.unit} onChange={(e) => set('unit', e.target.value)}>
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </Select>
        </div>
        <Select label="Form" value={f.form} onChange={(e) => set('form', e.target.value)}>
          {FORMS.map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
        </Select>
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">From your prescription</h2>
          <p className="text-sm text-muted mt-1">Enter what your prescriber told you. {APP_NAME} only reminds you of your own settings.</p>
        </div>
        <TextInput label={`Usual dose (${amountLabel})`} type="number" inputMode="decimal" min="0" step="any" value={f.defaultAmount}
          onChange={(e) => set('defaultAmount', e.target.value)} error={errors.defaultAmount} help="Filled in each time you log. You can change it when logging." />
        <div className="space-y-1.5">
          <span className="block text-sm font-medium">Schedule</span>
          <Segmented<ScheduleType> label="Schedule" value={f.type} onChange={(v) => set('type', v)}
            options={[{ value: 'interval', label: 'Every few hours' }, { value: 'fixed', label: 'Set times' }, { value: 'prn', label: 'As needed' }]} />
        </div>

        {f.type === 'interval' && (
          <>
            <TextInput label="Hours between doses" type="number" inputMode="decimal" min="0" step="0.5" value={f.intervalHours}
              onChange={(e) => set('intervalHours', e.target.value)} error={errors.intervalHours} />
            <TextInput label="Most doses in a day (optional)" type="number" inputMode="numeric" min="1" step="1" value={f.maxPerDay}
              onChange={(e) => set('maxPerDay', e.target.value)} error={errors.maxPerDay} help="Shown as “Today: 2 of 3”." />
            <div className="space-y-1.5">
              <label htmlFor="latest" className="block text-sm font-medium">Latest dose time (optional)</label>
              <div className="flex gap-2">
                <input id="latest" type="time" value={f.latestDoseTime} onChange={(e) => set('latestDoseTime', e.target.value)}
                  className="flex-1 min-h-[48px] rounded-btn bg-surface-2 border border-border px-3 tnum" />
                {f.latestDoseTime && <Button variant="secondary" onClick={() => set('latestDoseTime', '')}>Clear</Button>}
              </div>
              <p className="text-sm text-muted">For example, if you were told not to take it after 4 pm.</p>
            </div>
          </>
        )}

        {f.type === 'fixed' && (
          <div className="space-y-2">
            <span className="block text-sm font-medium">Times</span>
            {f.times.map((t, i) => (
              <div key={i} className="flex gap-2">
                <input type="time" aria-label={`Time ${i + 1}`} value={t}
                  onChange={(e) => set('times', f.times.map((x, j) => (j === i ? e.target.value : x)))}
                  className="flex-1 min-h-[48px] rounded-btn bg-surface-2 border border-border px-3 tnum" />
                {f.times.length > 1 && (
                  <button type="button" onClick={() => set('times', f.times.filter((_, j) => j !== i))} aria-label={`Remove time ${i + 1}`}
                    className="w-12 h-12 rounded-btn bg-surface-2 flex items-center justify-center"><X size={20} aria-hidden="true" /></button>
                )}
              </div>
            ))}
            {errors.times && <p className="text-sm text-danger" role="alert">{errors.times}</p>}
            <Button variant="secondary" className="flex items-center gap-2" onClick={() => set('times', [...f.times, ''])}>
              <Plus size={18} aria-hidden="true" /> Add a time
            </Button>
          </div>
        )}

        {f.type === 'prn' && <p className="text-sm text-muted">No countdown. Today shows when you last took it.</p>}
      </Card>

      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">Look</h2>
        <div role="radiogroup" aria-label="Colour" className="grid grid-cols-8 gap-1">
          {MED_COLOURS.map((c) => (
            <button key={c.value} type="button" role="radio" aria-checked={f.color === c.value} aria-label={c.name} onClick={() => set('color', c.value)}
              className="aspect-square min-w-[36px] rounded-full flex items-center justify-center text-white"
              style={{ background: c.value, outline: f.color === c.value ? '3px solid var(--text)' : undefined, outlineOffset: 2 }}>
              {f.color === c.value && <Check size={18} aria-hidden="true" />}
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label="Icon" className="grid grid-cols-6 gap-2">
          {MED_ICONS.map((name) => {
            const Icon = MED_ICON_COMPONENTS[name];
            const on = f.icon === name;
            return (
              <button key={name} type="button" role="radio" aria-checked={on} aria-label={name} onClick={() => set('icon', name)}
                className={`h-12 rounded-btn flex items-center justify-center ${on ? 'text-white' : 'bg-surface-2'}`} style={on ? { background: f.color } : undefined}>
                <Icon size={22} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">Stock and refills</h2>
        <TextInput label={`How many ${f.unit === 'tablet' || !Number(f.strength) ? `${f.form}s` : `${f.form}s (${f.strength} ${f.unit} each)`} you have (optional)`}
          type="number" inputMode="decimal" min="0" step="any" value={f.stockCount} onChange={(e) => set('stockCount', e.target.value)} error={errors.stockCount}
          help={perDose !== undefined ? `Goes down by ${perDose} each time you log ${fmtAmount(draftAmount, f.unit)}. Undo puts it back.` : undefined} />
        <TextInput label="Let me know when it's down to (optional)" type="number" inputMode="decimal" min="0" step="any" value={f.lowStockAt}
          onChange={(e) => set('lowStockAt', e.target.value)} error={errors.lowStockAt} />
        <TextArea label="Script and refill notes (optional)" value={f.scriptNotes} onChange={(e) => set('scriptNotes', e.target.value)}
          help="For example: 2 repeats left, next refill around 14 Nov." />
      </Card>

      {existing && (
        <Card className="space-y-3">
          <Button variant="secondary" className="w-full" onClick={archive}>{existing.archived ? 'Restore medication' : 'Archive medication'}</Button>
          <p className="text-sm text-muted">Archiving hides it from Today but keeps its history.</p>
          <Button variant="danger" className="w-full" onClick={() => { setTyped(''); setConfirmDelete(true); }}>Delete permanently</Button>
        </Card>
      )}

      <div className="fixed bottom-0 inset-x-0 z-30 bg-surface border-t border-border" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="mx-auto max-w-[560px] px-4 py-3">
          <Button className="w-full min-h-[56px]" onClick={onSave}>{existing ? 'Save changes' : 'Save medication'}</Button>
        </div>
      </div>

      <Sheet open={!!change} onClose={() => setChange(null)} title="Record this as a change?">
        {change && (
          <div className="space-y-4">
            <ul className="space-y-1">{change.lines.map((l) => <li key={l} className="tnum">{l}</li>)}</ul>
            <p className="text-sm text-muted">Recording it marks the date on your charts, so you can see what changed and when.</p>
            <label className="block space-y-1.5">
              <span className="block text-sm font-medium">Date of the change</span>
              <input type="date" value={change.date} max={format(Date.now(), 'yyyy-MM-dd')} onChange={(e) => setChange({ ...change, date: e.target.value })}
                className="w-full min-h-[48px] rounded-btn bg-surface-2 border border-border px-3 tnum" />
            </label>
            <Button className="w-full min-h-[56px]" disabled={!change.date} onClick={() => { const c = change; setChange(null); save(c); }}>Save and record change</Button>
            <Button variant="secondary" className="w-full" onClick={() => { setChange(null); save(); }}>Just save</Button>
          </div>
        )}
      </Sheet>

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title={`Delete ${existing?.name ?? ''}?`}>
        {existing && (
          <div className="space-y-4">
            <p>This deletes {existing.name}, every dose logged for it, and its tag links. It can't be undone. To keep its history, archive it instead.</p>
            <TextInput label={`Type ${existing.name} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            <Button variant="danger" className="w-full min-h-[56px]" disabled={typed.trim() !== existing.name}
              onClick={async () => { await deleteMedForever(existing.id); setConfirmDelete(false); toast(`Deleted ${existing.name}`); replace('/meds'); }}>
              Delete permanently
            </Button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
