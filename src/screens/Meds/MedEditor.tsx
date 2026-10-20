import { useEffect, useState } from 'react';
import { shownName } from '../../logic/privacy';
import { Check, ClipboardList, EyeOff, Plus, X } from 'lucide-react';
import { format } from 'date-fns';
import type { Medication } from '../../db/schema';
import { db } from '../../db/db';
import { useLive } from '../../db/live';
import { useFamily, useMeds } from '../../app/data';
import { personOf, storedPerson } from '../../db/repos/people';
import { DEFAULT_PERSON } from '../../db/schema';
import { createMed, deleteMedForever, setArchived, updateMed, type MedInput } from '../../db/repos/meds';
import { linkTag } from '../../db/repos/tags';
import { go, replace } from '../../app/router';
import { useToast } from '../../app/toast';
import { MED_COLOURS, MED_ICONS, medColour, medInk } from '../../logic/palette';
import { stockUnitsFor } from '../../logic/stock';
import { fmtAmount } from '../../logic/format';
import { APP_NAME } from '../../config';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { Segmented, Select, TextArea, TextInput } from '../../components/ui/Field';
import { MedBadge, MED_ICON_COMPONENTS } from '../../components/MedBadge';
import { describeChange } from '../../logic/plans';
import {
  blankSchedule, ScheduleFields, scheduleFormFromMed, scheduleFromForm, validateSchedule, type ScheduleErrors, type ScheduleForm, type ScheduleSetter,
} from './ScheduleFields';
import { TagsSection } from './TagsSection';
import { PlannedChanges } from './PlannedChanges';

const UNITS = ['mg', 'mcg', 'mL', 'units', 'tablet'];
const FORMS = ['tablet', 'capsule', 'liquid', 'patch', 'injection', 'other'];

interface Form extends ScheduleForm {
  name: string; strength: string; unit: string; form: string;
  color: string; icon: string; stockCount: string; lowStockAt: string; scriptNotes: string;
  repeatsLeft: string; scriptExpiry: string;
  instructions: string; instructionsBy: string; nickname: string;
  /** Who takes it ('' until the family list loads). */
  personId: string;
}

const blank: Form = {
  ...blankSchedule(),
  name: '', strength: '', unit: 'mg', form: 'tablet',
  color: MED_COLOURS[0].value, icon: 'pill', stockCount: '', lowStockAt: '', scriptNotes: '',
  repeatsLeft: '', scriptExpiry: '', instructions: '', instructionsBy: '', nickname: '', personId: '',
};

const str = (n?: number) => (n === undefined || n === null ? '' : String(n));
const num = (s: string) => (s.trim() === '' ? undefined : Number(s));

function fromMed(m: Medication): Form {
  return {
    ...scheduleFormFromMed(m),
    name: m.name, strength: str(m.strength), unit: m.unit, form: m.form,
    color: m.color, icon: m.icon, stockCount: str(m.stockCount), lowStockAt: str(m.lowStockAt), scriptNotes: m.scriptNotes ?? '',
    repeatsLeft: str(m.repeatsLeft), scriptExpiry: m.scriptExpiry ?? '',
    instructions: m.instructions ?? '', instructionsBy: m.instructionsBy ?? '', nickname: m.nickname ?? '',
    personId: personOf(m),
  };
}

function toInput(f: Form, before?: Medication): MedInput {
  const { schedule, defaultAmount } = scheduleFromForm(f);
  const instructions = f.instructions.trim() || undefined;
  return {
    personId: storedPerson(f.personId || DEFAULT_PERSON),
    name: f.name.trim(), nickname: f.nickname.trim() || undefined, strength: Number(f.strength) || 0, unit: f.unit, form: f.form,
    defaultAmount, schedule, color: f.color, icon: f.icon,
    stockCount: num(f.stockCount), lowStockAt: num(f.lowStockAt), scriptNotes: f.scriptNotes.trim() || undefined,
    repeatsLeft: num(f.repeatsLeft), scriptExpiry: f.scriptExpiry || undefined,
    instructions, instructionsBy: instructions ? f.instructionsBy.trim() || undefined : undefined,
    instructionsUpdatedAt: !instructions ? undefined
      : instructions === before?.instructions?.trim() ? before?.instructionsUpdatedAt : new Date().toISOString(),
  };
}

type Errors = ScheduleErrors & Partial<Record<keyof Form, string>>;

function validate(f: Form): Errors {
  const e: Errors = validateSchedule(f);
  const posOrBlank = (s: string) => s.trim() === '' || Number(s) > 0;
  if (!f.name.trim()) e.name = 'Enter a name.';
  if (!posOrBlank(f.strength)) e.strength = 'Enter a number above 0, or leave it blank.';
  if (f.stockCount.trim() && !(Number(f.stockCount) >= 0)) e.stockCount = 'Enter a number, or leave it blank.';
  if (f.lowStockAt.trim() && !(Number(f.lowStockAt) >= 0)) e.lowStockAt = 'Enter a number, or leave it blank.';
  if (f.repeatsLeft.trim() && !(Number.isInteger(Number(f.repeatsLeft)) && Number(f.repeatsLeft) >= 0)) e.repeatsLeft = 'Enter a whole number, or leave it blank.';
  return e;
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

  // New medications are for whoever is selected.
  const fam = useFamily();
  const famLoaded = !!fam;
  useEffect(() => {
    if (!id && fam) setF((p) => (p.personId ? p : { ...p, personId: fam.personId }));
  }, [id, famLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const errors: Errors = tried ? validate(f) : {};
  const amountLabel = f.unit === 'tablet' ? 'tablets' : f.unit;

  const save = async (record?: { date: string; lines: string[] }) => {
    const input = toInput(f, existing ?? undefined);
    if (existing) {
      const at = record ? new Date(`${record.date}T${format(Date.now(), 'HH:mm')}`).toISOString() : undefined;
      await updateMed(existing.id, input, record && at ? {
        at, summary: record.lines.join('; '),
        before: { strength: existing.strength, unit: existing.unit, defaultAmount: existing.defaultAmount, schedule: existing.schedule },
        after: { strength: input.strength, unit: input.unit, defaultAmount: input.defaultAmount, schedule: input.schedule },
      } : undefined);
      toast(`Saved ${shownName(input)}`);
      go('/meds');
    } else {
      const med = await createMed(input);
      if (tagId) {
        await linkTag(tagId, med.id);
        toast(`Saved ${shownName(med)} and linked the tag`);
        replace(`/tag/${tagId}`);
      } else {
        toast(`Saved ${shownName(med)}. Next, link a tag.`);
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
      const lines = describeChange(existing, toInput(f, existing));
      if (lines.length) { setChange({ lines, date: format(Date.now(), 'yyyy-MM-dd') }); return; }
    }
    save();
  };

  const archive = async () => {
    if (!existing) return;
    await setArchived(existing.id, !existing.archived);
    toast(existing.archived ? `Restored ${shownName(existing)}` : `Archived ${shownName(existing)}`, {
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
      {existing && !existing.archived && <PlannedChanges med={existing} />}

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
        {fam?.many && (
          <Select label="Who is this for?" value={f.personId || fam.personId} onChange={(e) => set('personId', e.target.value)}>
            {fam.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2"><EyeOff size={20} className="text-primary" aria-hidden="true" /> Privacy</h2>
        <TextInput label="Nickname (optional)" value={f.nickname} onChange={(e) => set('nickname', e.target.value)} autoComplete="off"
          placeholder="e.g. Morning tablet"
          help={`Shown instead of the real name on Today, when the tag is tapped, in calendar reminders and on Trends, with a plain grey icon. The real name only shows on this page, in the doctor report and in exports.`} />
        {f.nickname.trim() && (
          <div className="flex items-center gap-3 rounded-btn bg-surface-2 p-3" aria-label="Preview">
            <MedBadge color="private" icon={f.icon} />
            <span className="font-semibold">{f.nickname.trim()}</span>
            <span className="text-sm text-muted ml-auto">How it looks</span>
          </div>
        )}
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">From your prescription</h2>
          <p className="text-sm text-muted mt-1">Enter what your prescriber told you. {APP_NAME} only reminds you of your own settings.</p>
        </div>
        <ScheduleFields f={f} set={set as ScheduleSetter} errors={errors} unit={f.unit} />
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><ClipboardList size={20} className="text-primary" aria-hidden="true" /> Instructions</h2>
          <p className="text-sm text-muted mt-1">Shown every time this medication is tapped or logged. You, a carer, pharmacist or doctor can write them.</p>
        </div>
        <TextArea label="Instructions (optional)" value={f.instructions} onChange={(e) => set('instructions', e.target.value)} rows={4}
          placeholder="For example: Take with food. Swallow whole, don't crush." />
        {f.instructions.trim() && (
          <TextInput label="Written by (optional)" value={f.instructionsBy} onChange={(e) => set('instructionsBy', e.target.value)}
            placeholder="e.g. Pharmacist, Dr Lee, Mum" autoComplete="off" />
        )}
      </Card>

      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">Look</h2>
        <div role="radiogroup" aria-label="Colour" className="grid grid-cols-8 gap-1">
          {MED_COLOURS.map((c) => (
            <button key={c.value} type="button" role="radio" aria-checked={f.color === c.value} aria-label={c.name} onClick={() => set('color', c.value)}
              className="aspect-square min-w-[36px] rounded-full flex items-center justify-center"
              style={{ background: medColour(c.value), color: medInk(c.value), outline: f.color === c.value ? '3px solid var(--text)' : undefined, outlineOffset: 2 }}>
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
                className={`h-12 rounded-btn flex items-center justify-center ${on ? '' : 'bg-surface-2'}`} style={on ? { background: medColour(f.color), color: medInk(f.color) } : undefined}>
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
        <div className="grid grid-cols-2 gap-3 items-start">
          <TextInput label="Repeats left (optional)" type="number" inputMode="numeric" min="0" step="1" value={f.repeatsLeft}
            onChange={(e) => set('repeatsLeft', e.target.value)} error={errors.repeatsLeft} />
          <TextInput label="Script expires (optional)" type="date" value={f.scriptExpiry} onChange={(e) => set('scriptExpiry', e.target.value)} />
        </div>
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
