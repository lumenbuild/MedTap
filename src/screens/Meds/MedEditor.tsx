import { useEffect, useState } from 'react';
import { ingredientsOf, ingredientsText, parseIngredients } from '../../logic/ingredients';
import { shownName } from '../../logic/privacy';
import { interactions, unstudied } from '../../logic/interactions';
import { Check, ClipboardList, EyeOff, Plus, X } from 'lucide-react';
import { format } from 'date-fns';
import type { Medication, SyringeType } from '../../db/schema';
import { db } from '../../db/db';
import { useLive } from '../../db/live';
import { useFamily, useMeds, useSettings } from '../../app/data';
import { personOf, storedPerson } from '../../db/repos/people';
import { DEFAULT_PERSON } from '../../db/schema';
import { addBottle, createMed, deleteMedForever, setArchived, updateMed, type MedInput } from '../../db/repos/meds';
import { linkTag } from '../../db/repos/tags';
import { go, replace } from '../../app/router';
import { useToast } from '../../app/toast';
import { MED_COLOURS, MED_ICONS, medColour, medInk } from '../../logic/palette';
import { stockUnitsFor } from '../../logic/stock';
import { fmtAmount } from '../../logic/format';
import { APP_NAME } from '../../config';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Sheet, SheetActions } from '../../components/ui/Sheet';
import { Segmented, Select, TextArea, TextInput } from '../../components/ui/Field';
import { MedBadge, MED_ICON_COMPONENTS } from '../../components/MedBadge';
import { describeChange } from '../../logic/plans';
import {
  blankSchedule, ScheduleFields, scheduleFormFromMed, scheduleFromForm, validateSchedule, type ScheduleErrors, type ScheduleForm, type ScheduleSetter,
} from './ScheduleFields';
import { TagsSection } from './TagsSection';
import { PlannedChanges } from './PlannedChanges';
import { BottlesSection } from './BottlesSection';
import { ScanLabelCard } from './ScanLabel';
import { TitrationCard } from './PeptideSections';
import { VialCard } from './VialCard';
import { MedPatterns } from '../../components/Smart';
import { CountButton } from '../../components/CountSheet';
import { DrawGuide, syringeSizes } from '../../components/Syringe';
import { SYRINGES } from '../../logic/peptide';
import type { LabelDetails } from '../../logic/label';
import { HAS_PEPTIDES } from '../../edition';

const UNITS = ['mg', 'mcg', 'mL', 'units', 'tablet'];
const FORMS = ['tablet', 'capsule', 'liquid', 'patch', 'injection', 'other'];

interface Form extends ScheduleForm {
  name: string; strength: string; unit: string; form: string;
  color: string; icon: string; stockCount: string; lowStockAt: string; scriptNotes: string;
  repeatsLeft: string; scriptExpiry: string;
  instructions: string; instructionsBy: string; nickname: string;
  /** Mixed from a powder vial (peptide tools). */
  mixed: boolean; kind: 'vial' | 'pen'; waterMl: string; syringe: SyringeType; syringeUnits: string; useWithinDays: string;
  amountPerClick: string; blend: { name: string; amount: string; unit: string }[]; halfLife: string; halfLifeUnit: 'hours' | 'days';
  /** Who takes it ('' until the family list loads). */
  personId: string;
  /** Active ingredients as typed (blank = worked out from the name), and the price paid per pack / vial / pen. */
  ingredients: string; cost: string;
}

const blank: Form = {
  ...blankSchedule(),
  name: '', strength: '', unit: 'mg', form: 'tablet',
  color: MED_COLOURS[0].value, icon: 'pill', stockCount: '', lowStockAt: '', scriptNotes: '',
  repeatsLeft: '', scriptExpiry: '', instructions: '', instructionsBy: '', nickname: '', personId: '',
  mixed: false, kind: 'vial', waterMl: '', syringe: 'U-100', syringeUnits: '30', useWithinDays: '',
  amountPerClick: '', blend: [], halfLife: '', halfLifeUnit: 'days', ingredients: '', cost: '',
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
    personId: m.shared ? 'shared' : personOf(m),
    mixed: !!m.peptide, kind: m.peptide?.kind ?? 'vial', waterMl: str(m.peptide?.waterMl), syringe: m.peptide?.syringe ?? 'U-100',
    syringeUnits: str(m.peptide?.syringeUnits) || '30', useWithinDays: str(m.peptide?.useWithinDays),
    amountPerClick: str(m.peptide?.amountPerClick), blend: (m.peptide?.blend ?? []).map((b) => ({ ...b, amount: String(b.amount) })),
    // Half-lives of a day or more read better in days.
    halfLife: !m.peptide?.halfLifeHours ? '' : m.peptide.halfLifeHours >= 24 ? str(Math.round((m.peptide.halfLifeHours / 24) * 100) / 100) : str(m.peptide.halfLifeHours),
    halfLifeUnit: (m.peptide?.halfLifeHours ?? 24) >= 24 ? 'days' : 'hours',
    ingredients: m.ingredients?.length ? ingredientsText(m.ingredients) : '', cost: str(m.costPerUnit),
  };
}

function toInput(f: Form, before?: Medication): MedInput {
  const { schedule, defaultAmount } = scheduleFromForm(f);
  const instructions = f.instructions.trim() || undefined;
  return {
    shared: f.personId === 'shared' || undefined,
    personId: f.personId === 'shared' ? undefined : storedPerson(f.personId || DEFAULT_PERSON),
    name: f.name.trim(), nickname: f.nickname.trim() || undefined, strength: Number(f.strength) || 0, unit: f.unit, form: f.form,
    defaultAmount, schedule, color: f.color, icon: f.icon,
    stockCount: num(f.stockCount), lowStockAt: num(f.lowStockAt), scriptNotes: f.scriptNotes.trim() || undefined,
    repeatsLeft: num(f.repeatsLeft), scriptExpiry: f.scriptExpiry || undefined,
    instructions, instructionsBy: instructions ? f.instructionsBy.trim() || undefined : undefined,
    peptide: f.mixed ? {
      kind: f.kind,
      waterMl: f.kind === 'vial' ? Number(f.waterMl) : 0, syringe: f.syringe, syringeUnits: Number(f.syringeUnits) || 30,
      useWithinDays: num(f.useWithinDays), mixedAt: before?.peptide?.mixedAt,
      amountPerClick: f.kind === 'pen' ? num(f.amountPerClick) : undefined,
      blend: f.kind === 'vial' ? f.blend.filter((b) => b.name.trim() && Number(b.amount) > 0).map((b) => ({ name: b.name.trim(), amount: Number(b.amount), unit: b.unit })) : undefined,
      halfLifeHours: Number(f.halfLife) > 0 ? Number(f.halfLife) * (f.halfLifeUnit === 'days' ? 24 : 1) : undefined,
    } : undefined,
    ingredients: f.ingredients.trim() ? parseIngredients(f.ingredients) : undefined,
    costPerUnit: Number(f.cost) > 0 ? Number(f.cost) : undefined,
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
  if (f.mixed) {
    if (!(Number(f.strength) > 0)) e.strength = 'Enter the amount in each vial.';
    if (f.kind === 'vial' && !(Number(f.waterMl) > 0)) e.waterMl = 'Enter the water you add, in mL.';
    if (f.amountPerClick.trim() && !(Number(f.amountPerClick) > 0)) e.amountPerClick = 'Enter a number above 0, or leave it blank.';
    if (f.halfLife.trim() && !(Number(f.halfLife) > 0)) e.halfLife = 'Enter a number above 0, or leave it blank.';
    if (f.useWithinDays.trim() && !(Number(f.useWithinDays) >= 1)) e.useWithinDays = 'Enter a number of days, or leave it blank.';
  }
  if (f.stockCount.trim() && !(Number(f.stockCount) >= 0)) e.stockCount = 'Enter a number, or leave it blank.';
  if (f.lowStockAt.trim() && !(Number(f.lowStockAt) >= 0)) e.lowStockAt = 'Enter a number, or leave it blank.';
  if (f.repeatsLeft.trim() && !(Number.isInteger(Number(f.repeatsLeft)) && Number(f.repeatsLeft) >= 0)) e.repeatsLeft = 'Enter a whole number, or leave it blank.';
  return e;
}

/** Fill the form from a scanned pharmacy label. Only what was found is changed. */
function fromLabel(p: Form, d: LabelDetails): Form {
  const f: Form = { ...p };
  const strength = d.strength;
  if (d.name) f.name = d.name;
  if (d.form) f.form = d.form;
  if (d.unit) f.unit = d.unit;
  if (strength !== undefined) f.strength = String(strength);
  else if (d.unit === 'mL') f.strength = '';
  // The label counts tablets (or mL, units); the app's amounts are in the medication's unit.
  const perUnit = strength && d.unit !== 'mL' && (d.form === 'tablet' || d.form === 'capsule' || !d.form) ? strength : 1;
  if (!strength && d.count !== undefined && d.unit !== 'mL' && (d.form === 'tablet' || d.form === 'capsule')) f.unit = 'tablet';
  const amount = (n?: number) => (n === undefined ? '' : String(Math.round(n * perUnit * 1000) / 1000));
  if (d.count !== undefined) f.defaultAmount = amount(d.count);
  const s = d.schedule;
  if (s?.type === 'fixed') {
    f.type = 'fixed';
    f.slots = s.slots.map((x) => ({ time: x.time, amount: x.count !== undefined && x.count !== d.count ? amount(x.count) : '' }));
    if (s.days?.length) { f.dayMode = 'days'; f.days = s.days; }
    else if (s.everyNDays && s.everyNDays > 1) { f.dayMode = 'everyN'; f.everyNDays = String(s.everyNDays); }
    else f.dayMode = 'every';
  } else if (s?.type === 'interval') {
    f.type = 'interval';
    f.intervalHours = String(s.hours);
  } else if (s?.type === 'prn') {
    f.type = 'prn';
    if (s.maxDoses) f.maxPer24h = String(s.maxDoses);
    if (s.maxCount) f.maxAmountPer24h = amount(s.maxCount);
    if (s.minHoursApart) f.minHoursApart = String(s.minHoursApart);
  }
  if (d.quantity !== undefined) f.stockCount = String(d.quantity);
  if (d.repeats !== undefined) f.repeatsLeft = String(d.repeats);
  if (d.directions) {
    f.instructions = d.directions;
    f.instructionsBy = d.prescriber ? `Pharmacy label (${d.prescriber})` : 'Pharmacy label';
  }
  return f;
}

export function MedEditor({ id, tagId }: { id?: string; tagId?: string }) {
  const existing = useLive(() => (id ? db.medications.get(id).then((m) => m ?? null) : null), [id]);
  const toast = useToast();
  const [f, setF] = useState<Form>(blank);
  const [tried, setTried] = useState(false);
  const [change, setChange] = useState<{ lines: string[]; date: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typed, setTyped] = useState('');
  /** Bottle expiry from a scanned label, added once the new medication is saved. */
  const [labelExpiry, setLabelExpiry] = useState<string | undefined>();
  const loadedId = existing?.id;

  useEffect(() => { if (existing) setF(fromMed(existing)); }, [loadedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const settings = useSettings();
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
      if (labelExpiry) await addBottle(med.id, { expiry: labelExpiry });
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
      {!existing && (
        <ScanLabelCard onApply={(d) => {
          setF((p) => fromLabel(p, d));
          setLabelExpiry(d.expiry);
          toast('Filled in from the label. Check each detail before saving.');
        }} />
      )}
      {existing && <TagsSection med={existing} />}
      {HAS_PEPTIDES && existing?.peptide && !existing.archived && <VialCard med={existing} />}
      {existing && !existing.archived && <PlannedChanges med={existing} />}
      {existing && !existing.archived && settings?.peptideTools && <TitrationCard med={existing} />}
      {existing && !existing.archived && <BottlesSection med={existing} />}
      {existing && !existing.archived && <MedPatterns med={existing} />}

      <Card className="space-y-4">
        <h2 className="text-sm font-medium text-muted">Medication</h2>
        <TextInput label="Name" value={f.name} onChange={(e) => set('name', e.target.value)} error={errors.name} autoComplete="off" autoFocus={!id} />
        <div className="grid grid-cols-[1fr_auto] gap-3 items-start">
          <TextInput label={f.mixed ? (f.kind === 'pen' ? 'Amount in each pen' : 'Amount in each vial') : 'Strength'} type="number" inputMode="decimal" min="0" step="any" value={f.strength} onChange={(e) => set('strength', e.target.value)} error={errors.strength} />
          <Select label="Unit" value={f.unit} onChange={(e) => set('unit', e.target.value)}>
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </Select>
        </div>
        <Select label="Form" value={f.form} onChange={(e) => set('form', e.target.value)}>
          {FORMS.map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
        </Select>
        {HAS_PEPTIDES && (f.mixed || (settings?.peptideTools && f.form === 'injection')) && <MixedVialFields f={f} set={set} errors={errors} vials={existing?.vials} />}
        {fam?.many && (
          <Select label="Who is this for?" value={f.personId || fam.personId} onChange={(e) => set('personId', e.target.value)}
            help={f.personId === 'shared' ? "One stock count for everyone. When it's logged, you choose who took it, and each person's count and history are their own." : undefined}>
            {fam.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="shared">Shared (anyone in the family)</option>
          </Select>
        )}
      </Card>

      <Card className="space-y-2">
        <h2 className="text-sm font-medium text-muted">Active ingredients</h2>
        {(() => {
          const detected = ingredientsOf({ name: f.name, strength: Number(f.strength) || 0, unit: f.unit });
          return (
            <TextInput label="Active ingredients (optional)" value={f.ingredients} onChange={(e) => set('ingredients', e.target.value)} autoComplete="off"
              placeholder={detected.length ? ingredientsText(detected) : 'e.g. paracetamol 500, codeine 8'}
              help={`${detected.length && !f.ingredients.trim() ? `From the name: ${ingredientsText(detected)}. ` : ''}mg in each ${f.form === 'injection' ? 'dose unit' : f.form}. Used to spot the same ingredient in two medicines, and to add them up against your limits.`} />
          );
        })()}
        {(() => {
          // Pairs with this person's other medicines that are worth raising with a pharmacist (as typed, before saving).
          const draft: Medication = { ...(existing ?? { id: '__new', color: '', icon: 'pill', schedule: { type: 'prn' }, defaultAmount: 0, createdAt: '', updatedAt: '' }),
            name: f.name, strength: Number(f.strength) || 0, unit: f.unit, form: f.form, archived: false,
            ingredients: f.ingredients.trim() ? parseIngredients(f.ingredients) : undefined,
            shared: f.personId === 'shared', personId: f.personId === 'shared' ? undefined : storedPerson(f.personId) } as Medication;
          const others = (meds ?? []).filter((m) => m.id !== draft.id);
          const pairs = f.name.trim() ? interactions([draft, ...others], (m) => personOf(m)).filter((x) => x.a.id === draft.id || x.b.id === draft.id) : [];
          const note = HAS_PEPTIDES && f.name.trim() && unstudied(draft);
          if (!pairs.length && !note) return null;
          return (
            <div className="space-y-2 pt-1" role="note">
              {pairs.map((x) => (
                <p key={x.key} className="text-sm rounded-btn bg-caution-soft p-3"><span className="font-semibold">With {shownName(x.a.id === draft.id ? x.b : x.a)}:</span> {x.why} Worth asking your pharmacist or doctor.</p>
              ))}
              {note && <p className="text-sm rounded-btn bg-surface-2 p-3">How {f.name.trim()} mixes with other medicines hasn’t been studied. Tell your doctor and pharmacist you use it, and bring it up before starting anything new.</p>}
            </div>
          );
        })()}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-medium text-muted flex items-center gap-2"><EyeOff size={20} className="text-primary" aria-hidden="true" /> Privacy</h2>
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
          <h2 className="text-sm font-medium text-muted">From your prescription</h2>
          <p className="text-sm text-muted mt-1">Enter what your prescriber told you. {APP_NAME} only reminds you of your own settings.</p>
        </div>
        <ScheduleFields f={f} set={set as ScheduleSetter} errors={errors} unit={f.unit} cycles={!!settings?.peptideTools} />
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="text-sm font-medium text-muted flex items-center gap-2"><ClipboardList size={20} className="text-primary" aria-hidden="true" /> Instructions</h2>
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
        <h2 className="text-sm font-medium text-muted">Look</h2>
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
        <h2 className="text-sm font-medium text-muted">Stock and refills</h2>
        <TextInput label={f.mixed ? `How many ${f.kind === 'pen' ? 'pens' : 'vials'} you have (optional)` : `How many ${f.unit === 'tablet' || !Number(f.strength) ? `${f.form}s` : `${f.form}s (${f.strength} ${f.unit} each)`} you have (optional)`}
          type="number" inputMode="decimal" min="0" step="any" value={f.stockCount} onChange={(e) => set('stockCount', e.target.value)} error={errors.stockCount}
          help={perDose !== undefined ? `Goes down by ${perDose} each time you log ${fmtAmount(draftAmount, f.unit)}. Undo puts it back.` : undefined} />
        {existing && !existing.peptide && existing.stockCount !== undefined && <CountButton med={existing} onCounted={(n) => set('stockCount', String(n))} />}
        <TextInput label="Let me know when it's down to (optional)" type="number" inputMode="decimal" min="0" step="any" value={f.lowStockAt}
          onChange={(e) => set('lowStockAt', e.target.value)} error={errors.lowStockAt} />
        <div className="grid grid-cols-2 gap-3 items-start">
          <TextInput label="Repeats left (optional)" type="number" inputMode="numeric" min="0" step="1" value={f.repeatsLeft}
            onChange={(e) => set('repeatsLeft', e.target.value)} error={errors.repeatsLeft} />
          <TextInput label="Script expires (optional)" type="date" value={f.scriptExpiry} onChange={(e) => set('scriptExpiry', e.target.value)} />
        </div>
        <TextInput label={f.mixed ? `Price per ${f.kind === 'pen' ? 'pen' : 'vial'} ($, optional)` : 'Price per pack or script ($, optional)'} type="number" inputMode="decimal" min="0" step="any"
          value={f.cost} onChange={(e) => set('cost', e.target.value)} help={f.mixed ? 'For cost per mg, per week and per month on Protocol. A vial’s own price (on its stock entry) overrides this.' : 'For the monthly cost on Meds.'} />
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
            <SheetActions>
              <Button className="w-full min-h-[56px]" disabled={!change.date} onClick={() => { const c = change; setChange(null); save(c); }}>Save and record change</Button>
              <Button variant="secondary" className="w-full" onClick={() => { setChange(null); save(); }}>Just save</Button>
            </SheetActions>
          </div>
        )}
      </Sheet>

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title={`Delete ${existing?.name ?? ''}?`}>
        {existing && (
          <div className="space-y-4">
            <p>This deletes {existing.name}, every dose logged for it, and its tag links. It can't be undone. To keep its history, archive it instead.</p>
            <TextInput label={`Type ${existing.name} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            <SheetActions>
              <Button variant="danger" className="w-full min-h-[56px]" disabled={typed.trim() !== existing.name}
                onClick={async () => { await deleteMedForever(existing.id); setConfirmDelete(false); toast(`Deleted ${existing.name}`); replace('/meds'); }}>
                Delete permanently
              </Button>
            </SheetActions>
          </div>
        )}
      </Sheet>
    </div>
  );
}

/** Injections (peptide tools): a vial mixed with water, or a pre-filled pen. */
function MixedVialFields({ f, set, errors, vials }: { f: Form; set: <K extends keyof Form>(k: K, v: Form[K]) => void; errors: Errors; vials?: Medication['vials'] }) {
  const sizes = syringeSizes(f.syringe);
  const preview = {
    id: '', name: f.name, defaultAmount: Number(f.defaultAmount) || 0, strength: Number(f.strength), unit: f.unit, vials,
    peptide: { kind: f.kind, waterMl: Number(f.waterMl), syringe: f.syringe, syringeUnits: Number(f.syringeUnits) || 30, amountPerClick: num(f.amountPerClick),
      blend: f.blend.filter((b) => b.name.trim() && Number(b.amount) > 0).map((b) => ({ name: b.name, amount: Number(b.amount), unit: b.unit })) },
  };
  return (
    <div className="rounded-btn bg-surface-2 p-3 space-y-3">
      <Select label="How is it injected?" value={f.mixed ? f.kind : 'neither'} onChange={(e) => {
        const v = e.target.value;
        set('mixed', v !== 'neither');
        if (v !== 'neither') set('kind', v as 'vial' | 'pen');
      }}>
        <option value="neither">Something else</option>
        <option value="vial">A vial I mix with water</option>
        <option value="pen">A pre-filled pen</option>
      </Select>
      {f.mixed && f.kind === 'vial' && (
        <>
          <TextInput label="Water usually added to a vial (mL)" help="You can change it for each vial when you mix it." type="number" inputMode="decimal" min="0" step="any" value={f.waterMl}
            onChange={(e) => set('waterMl', e.target.value)} error={errors.waterMl} />
          <div className="grid grid-cols-2 gap-3 items-start">
            <Select label="Syringe" value={f.syringe} onChange={(e) => { set('syringe', e.target.value as SyringeType); set('syringeUnits', String(syringeSizes(e.target.value as SyringeType)[0].units)); }}>
              {SYRINGES.map((x) => <option key={x.value} value={x.value}>{x.value}</option>)}
            </Select>
            <Select label="Size" value={f.syringeUnits} onChange={(e) => set('syringeUnits', e.target.value)}>
              {sizes.map((x) => <option key={x.ml} value={String(x.units)}>{x.ml} mL ({x.units} units)</option>)}
            </Select>
          </div>
          <BlendFields f={f} set={set} />
        </>
      )}
      {f.mixed && f.kind === 'pen' && (
        <TextInput label={`Amount per click of the dial (${f.unit}, optional)`} help="From the pen's instructions. Then Log dose shows the clicks for each dose."
          type="number" inputMode="decimal" min="0" step="any" value={f.amountPerClick} onChange={(e) => set('amountPerClick', e.target.value)} error={errors.amountPerClick} />
      )}
      {f.mixed && (
        <>
          <TextInput label={f.kind === 'pen' ? 'Use a pen within (days of first use, optional)' : 'Use a mixed vial within (days, optional)'}
            help="From the label or your pharmacist. Today warns you when it's past it."
            type="number" inputMode="numeric" min="1" step="1" value={f.useWithinDays} onChange={(e) => set('useWithinDays', e.target.value)} error={errors.useWithinDays} />
          <div className="grid grid-cols-[1fr_auto] gap-3 items-start">
            <TextInput label="Half-life (optional)" help="For the estimated level chart in Trends. Use the figure from the product information."
              type="number" inputMode="decimal" min="0" step="any" value={f.halfLife} onChange={(e) => set('halfLife', e.target.value)} error={errors.halfLife} />
            <Select label="Unit" value={f.halfLifeUnit} onChange={(e) => set('halfLifeUnit', e.target.value as 'hours' | 'days')}>
              <option value="hours">hours</option><option value="days">days</option>
            </Select>
          </div>
          <DrawGuide med={preview} amount={Number(f.defaultAmount) || Number(f.slots[0]?.amount) || 0} />
        </>
      )}
    </div>
  );
}

/** A blend: the other peptides in each vial. */
function BlendFields({ f, set }: { f: Form; set: <K extends keyof Form>(k: K, v: Form[K]) => void }) {
  const update = (i: number, patch: Partial<Form['blend'][number]>) => set('blend', f.blend.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Blend (optional)</p>
      <p className="text-sm text-muted">If each vial holds more than one peptide, add the others here with their amount per vial. The name and amount above are the first.</p>
      {f.blend.map((b, i) => (
        <div key={i} className="grid grid-cols-[1fr_5rem_4.5rem_auto] gap-2 items-end">
          <TextInput label="Also contains" value={b.name} onChange={(e) => update(i, { name: e.target.value })} />
          <TextInput label="Amount" type="number" inputMode="decimal" min="0" step="any" value={b.amount} onChange={(e) => update(i, { amount: e.target.value })} />
          <Select label="Unit" value={b.unit} onChange={(e) => update(i, { unit: e.target.value })}>{['mg', 'mcg', 'units'].map((u) => <option key={u}>{u}</option>)}</Select>
          <button type="button" aria-label={`Remove ${b.name || 'this peptide'}`} onClick={() => set('blend', f.blend.filter((_, j) => j !== i))}
            className="w-12 h-12 flex items-center justify-center text-muted"><X size={20} aria-hidden="true" /></button>
        </div>
      ))}
      <Button variant="secondary" className="flex items-center gap-2" onClick={() => set('blend', [...f.blend, { name: '', amount: '', unit: f.unit === 'mcg' ? 'mcg' : 'mg' }])}>
        <Plus size={18} aria-hidden="true" /> Add a peptide
      </Button>
    </div>
  );
}
