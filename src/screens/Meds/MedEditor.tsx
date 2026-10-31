import { useEffect, useState } from 'react';
import { ingredientsOf, ingredientsText, parseIngredients } from '../../logic/ingredients';
import { shownName } from '../../logic/privacy';
import { interactions, unstudied } from '../../logic/interactions';
import { Check, ChevronDown, ChevronRight, ClipboardList, EyeOff, Link2, Pencil, Plus, TrendingUp, X } from 'lucide-react';
import { format } from 'date-fns';
import type { Medication, SyringeType } from '../../db/schema';
import { db } from '../../db/db';
import { useLive } from '../../db/live';
import { useDoses, useFamily, useMeds, useScheduleSettings, useSettings } from '../../app/data';
import { useNow } from '../../app/useNow';
import { forecastRunOut } from '../../logic/plans';
import { PeptidePart } from '../Protocol/Protocol';
import { useViewMode } from '../../app/viewMode';
import { disguise, privateRule } from '../../logic/privateView';
import { getSettings, setSetting } from '../../db/repos/settings';
import { personOf, storedPerson } from '../../db/repos/people';
import { DEFAULT_PERSON } from '../../db/schema';
import { addBottle, createMed, deleteMedForever, setArchived, updateMed, type MedInput } from '../../db/repos/meds';
import { linkTag } from '../../db/repos/tags';
import { go, replace } from '../../app/router';
import { useToast } from '../../app/toast';
import { MED_COLOURS, MED_ICONS, medColour, medInk } from '../../logic/palette';
import { stockUnitsFor } from '../../logic/stock';
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
import { BottlesSection } from './BottlesSection';
import { ScanLabelCard } from './ScanLabel';
import { DosePlanCard } from '../../components/DosePlan';
import { planShort } from '../../logic/dosePlan';
import { scheduleSettings } from '../../db/repos/settings';
import { VialCard } from './VialCard';
import { MedPatterns } from '../../components/Smart';
import { HowToTakeCard } from '../../components/HowToTake';
import { CountButton, countsFromPhoto } from '../../components/CountSheet';
import { DrawGuide, syringeSizes } from '../../components/Syringe';
import { SYRINGES } from '../../logic/peptide';
import type { LabelDetails } from '../../logic/label';
import { HAS_PEPTIDES } from '../../edition';
import { canSplit, guideById, guideFor, guideMed, lowestPlan, savedVial, stepChanges, fmtDose, type GuideEntry } from '../../logic/peptideGuide';
import { Switch } from '../../components/ui/Switch';
import { fmtAmount, fmtSchedule } from '../../logic/format';

const UNITS = ['mg', 'mcg', 'mL', 'units', 'tablet'];
const FORMS = ['tablet', 'capsule', 'liquid', 'patch', 'injection', 'other'];

interface Form extends ScheduleForm {
  name: string; strength: string; unit: string; form: string;
  color: string; icon: string; stockCount: string; lowStockAt: string; scriptNotes: string;
  repeatsLeft: string; scriptExpiry: string;
  instructions: string; instructionsBy: string; nickname: string; privateView: '' | 'show' | 'cover' | 'hide'; coverName: string;
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
  repeatsLeft: '', scriptExpiry: '', instructions: '', instructionsBy: '', nickname: '', privateView: '', coverName: '', personId: '',
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
    instructions: m.instructions ?? '', instructionsBy: m.instructionsBy ?? '', nickname: m.nickname ?? '', privateView: m.privateView ?? '', coverName: m.coverName ?? '',
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
    name: f.name.trim(), nickname: f.nickname.trim() || undefined, privateView: f.privateView || undefined, coverName: f.privateView === 'cover' ? f.coverName.trim() || undefined : undefined, strength: Number(f.strength) || 0, unit: f.unit, form: f.form,
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

/** The form filled in from a guide entry, keeping the colour and who it's for. */
function fromGuide(p: Form, g: GuideEntry, keepName?: string, split = false): Form {
  // The vial the person entered on the guide, if any (sizes vary by supplier).
  const m = guideMed(g, Date.now(), split, savedVial(g.id));
  const filled = fromMed({ ...m, id: '', createdAt: '', updatedAt: '', archived: false, color: p.color, icon: 'syringe' });
  return { ...filled, name: keepName ?? filled.name, personId: p.personId };
}

export type MedView = 'overview' | 'plan' | 'stock' | 'patterns' | 'details';

export function MedEditor({ id, tagId, guideId, section }: { id?: string; tagId?: string; guideId?: string; section?: MedView }) {
  // In the private view a left-out medicine doesn't exist here, and a covered one is edited under its cover name.
  const view = useViewMode();
  const priv = view === 'private';
  const existing = useLive(async () => {
    if (!id) return null;
    const m = await db.medications.get(id);
    if (!m || !priv) return m ?? null;
    const rule = privateRule(m, (await getSettings()).privacyHidePeptides);
    return rule === 'hide' ? null : rule === 'cover' ? disguise(m) : m;
  }, [id, view]);
  const toast = useToast();
  const [f, setF] = useState<Form>(blank);
  const [tried, setTried] = useState(false);
  const [change, setChange] = useState<{ lines: string[]; date: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typed, setTyped] = useState('');
  /** Bottle expiry from a scanned label, added once the new medication is saved. */
  const [labelExpiry, setLabelExpiry] = useState<string | undefined>();
  /** Filled in from the peptide guide: which entry, and whether to add its step-up as planned changes. */
  const [fromGuideId, setFromGuideId] = useState<string | undefined>(guideId && guideById(guideId) ? guideId : undefined);
  const [stepMode, setStepMode] = useState<'lowest' | 'ladder' | 'none'>('lowest');
  const [split, setSplit] = useState(false);
  useEffect(() => { const g = guideId ? guideById(guideId) : undefined; if (g) setF((p) => fromGuide(p, g)); }, [guideId]);
  const loadedId = existing?.id;

  useEffect(() => { if (existing) setF(fromMed(existing)); }, [loadedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const settings = useSettings();
  // A peptide (with the peptide tools on) shows its shots, plan and vials here.
  const onProtocol = HAS_PEPTIDES && !!settings?.peptideTools && !!existing?.peptide;
  // A medicine's page in sections, so no one view is a long scroll: what matters now, the plan, stock, patterns, details.
  const views: { value: MedView; label: string }[] = onProtocol
    ? [{ value: 'overview', label: 'Overview' }, { value: 'plan', label: 'Plan' }, { value: 'stock', label: 'Stock' }, { value: 'details', label: 'Details' }]
    : [{ value: 'overview', label: 'Overview' }, { value: 'stock', label: 'Stock' }, { value: 'patterns', label: 'Patterns' }, { value: 'details', label: 'Details' }];
  const tab: MedView = existing?.archived ? 'details' : views.some((v) => v.value === section) ? section! : 'overview';
  const pickTab = (v: MedView) => { if (existing) replace(`/meds/${existing.id}${v === 'overview' ? '' : `/${v}`}`); };
  const editing = !!existing && tab === 'details';
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

  const save = async (record?: { date: string; lines: string[] }) => {
    let input = toInput(f, existing ?? undefined);
    if (priv && existing) {
      // Covered: the name typed is the cover name; everything that would identify it stays as it was.
      const real = await db.medications.get(existing.id);
      if (real && privateRule(real, (await getSettings()).privacyHidePeptides) === 'cover') {
        input = { ...input, name: real.name, coverName: f.name.trim() || real.coverName, nickname: real.nickname, privateView: real.privateView, form: real.form,
          ingredients: real.ingredients, instructions: real.instructions, instructionsBy: real.instructionsBy, instructionsUpdatedAt: real.instructionsUpdatedAt,
          scriptNotes: real.scriptNotes, peptide: real.peptide };
      } else if (real) input = { ...input, privateView: real.privateView, coverName: real.coverName };
    }
    // A course's restart words become check-in chips (so they're one tap), and "Not now" carries over.
    const course = input.schedule.course;
    if (course) {
      const was = existing?.schedule.course;
      if (was?.dismissedAt && was.start === course.start) input = { ...input, schedule: { ...input.schedule, course: { ...course, dismissedAt: was.dismissedAt } } };
      const st = await getSettings();
      const add = (course.restartOn ?? []).filter((w) => !st.chips.some((c) => c.toLowerCase() === w.toLowerCase()));
      if (add.length) await setSetting('chips', [...st.chips, ...add]);
    }
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
      const g = fromGuideId ? guideById(fromGuideId) : undefined;
      if (g) {
        // The step-up, as planned changes from today; and the guide's check-in words, one tap each.
        const lp = stepMode === 'lowest' ? lowestPlan(g, split && canSplit(g) ? 2 : 1) : null;
        if (lp) input = { ...input, stepPlan: lp.plan, stepUp: lp.criteria };
        if (stepMode === 'ladder' && g.steps) input = { ...input, plannedChanges: stepChanges(g, format(Date.now(), 'yyyy-MM-dd'), split && canSplit(g)).map((c) => ({ id: crypto.randomUUID(), from: c.from, defaultAmount: c.amount, schedule: input.schedule, note: 'Step-up' })) };
        const st = await getSettings();
        const add = g.chips.filter((w) => !st.chips.some((c) => c.toLowerCase() === w.toLowerCase()));
        if (add.length) await setSetting('chips', [...st.chips, ...add]);
      }
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
      {!existing && HAS_PEPTIDES && settings?.peptideTools && (() => {
        const g = fromGuideId ? guideById(fromGuideId) : guideFor(f.name);
        if (!g) return null;
        if (!fromGuideId) return (
          <button type="button" onClick={() => { setF((p) => fromGuide(p, g, p.name.trim() || undefined)); setFromGuideId(g.id); }}
            className="w-full text-left rounded-card border border-border p-4 min-h-[56px] flex items-center gap-3">
            <ClipboardList size={20} className="text-primary shrink-0" aria-hidden="true" />
            <span className="flex-1"><span className="block font-medium">Fill in from the {g.name} guide</span><span className="block text-sm text-muted">Vial, water, syringe, schedule and storage</span></span>
          </button>
        );
                return (
          <Card className="bg-primary-soft shadow-none space-y-2">
            <p>Filled in from the <a href={`#/guide/${g.id}`} className="underline underline-offset-4 font-medium">{g.name} guide</a>: {savedVial(g.id) ? 'your' : 'a'} {fmtDose(Number(f.strength) || g.vials[0].amount, g.unit)} vial with {f.waterMl || g.vials[0].waterMl} mL of water, U-100 syringes and its usual schedule.{savedVial(g.id) ? '' : ' Check the vial size against your label.'}</p>
            <p className="text-sm">The dose is set to {fmtDose(split ? g.setup.defaultAmount / 2 : g.setup.defaultAmount, g.unit)}{split ? ' a shot' : ''}, {split ? 'half the usual weekly starting dose' : 'the usual starting dose'}. Change anything to match your vial and your plan.</p>
            {canSplit(g) && <Switch label="Two shots a week" checked={split} onChange={(v) => { setSplit(v); setF((p) => fromGuide(p, g, p.name, v)); }}>Half the weekly amount, 3 and 4 days apart, for a steadier level.</Switch>}
            {(g.steps || g.lowest) && (
              <div className="space-y-1.5 pt-1">
                <Segmented label="Stepping up" value={stepMode} onChange={setStepMode}
                  options={[...(g.lowest ? [{ value: 'lowest' as const, label: 'When loss slows' }] : []), ...(g.steps ? [{ value: 'ladder' as const, label: `Every ${g.steps[0].weeks} weeks` }] : []), { value: 'none' as const, label: 'I’ll decide' }]} />
                <p className="text-sm">{stepMode === 'lowest' && g.lowest
                  ? `Stays on the lowest dose that works. While you’re losing more than 0.25 kg a week it holds the dose; once loss slows for 3 weeks (and side effects are settled) it asks about going up by ${fmtDose(split ? g.lowest.by / 2 : g.lowest.by, g.unit)}${split ? ' a shot' : ''}.`
                  : stepMode === 'ladder' && g.steps ? `${g.steps.map((x) => (split ? x.amount / 2 : x.amount)).join(' → ')} ${g.unit}${split ? ' a shot' : ''}, every ${g.steps[0].weeks} weeks, as dated changes.`
                  : 'No plan: change the dose yourself whenever you like.'} You can change this later in its dose plan.</p>
              </div>
            )}
          </Card>
        );
      })()}
      {!existing && (
        <ScanLabelCard onApply={(d) => {
          setF((p) => fromLabel(p, d));
          setLabelExpiry(d.expiry);
          toast('Filled in from the label. Check each detail before saving.');
        }} />
      )}
      {/* The dose plan: for an injection its home is Protocol (with the shots, vials and level); for the rest, here. */}
      {existing && !existing.archived && (
        <div className="sticky top-0 z-20 -mx-6 px-6 py-2 bg-bg">
          <Segmented<MedView> label="Show" value={tab} onChange={pickTab} options={views} />
        </div>
      )}
      {existing && !existing.archived && tab === 'overview' && (onProtocol && !priv
        ? <><PeptidePart med={existing} part="overview" /><HowToTakeCard med={existing} onPeptidePage /></>
        : <><HowToTakeCard med={existing} />{!priv && <DosePlanCard med={existing} />}</>)}
      {existing && !existing.archived && tab === 'plan' && !priv && <PeptidePart med={existing} part="plan" />}
      {existing && !existing.archived && tab === 'stock' && (onProtocol
        ? <><VialCard med={existing} />{!priv && <PeptidePart med={existing} part="stock" />}</>
        : <>{existing.peptide && HAS_PEPTIDES && <VialCard med={existing} />}{!existing.peptide && <BottlesSection med={existing} />}<StockLine med={existing} onEdit={() => pickTab('details')} /></>)}
      {existing && !existing.archived && tab === 'patterns' && <MedPatterns med={existing} />}
      {existing && tab === 'details' && <TagsSection med={existing} />}
      {(!existing || editing) && (<>
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
            help={f.personId === 'shared' ? 'One stock for everyone' : undefined}>
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
              help={detected.length && !f.ingredients.trim() ? `Found: ${ingredientsText(detected)}` : undefined} />
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
                <p key={x.key} className="text-sm flex items-center gap-2"><Link2 size={16} aria-hidden="true" className="shrink-0" /><span><span className="font-semibold">With {shownName(x.a.id === draft.id ? x.b : x.a)}:</span> {x.why}</span></p>
              ))}
              {note && <p className="text-sm flex items-center gap-2"><Link2 size={16} aria-hidden="true" className="shrink-0" />Interactions not studied</p>}
            </div>
          );
        })()}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-medium text-muted flex items-center gap-2"><EyeOff size={20} className="text-primary" aria-hidden="true" /> Privacy</h2>
        <TextInput label="Nickname (optional)" value={f.nickname} onChange={(e) => set('nickname', e.target.value)} autoComplete="off"
          placeholder="e.g. Morning tablet"
          help="Shown instead of the name" />
        {!priv && settings?.privacyPinHash && (
          <>
            <Select label="In the private view" value={f.privateView || (f.mixed && settings.privacyHidePeptides ? 'hide' : 'show')}
              onChange={(e) => set('privateView', e.target.value as Form['privateView'])}>
              <option value="show">Shown as it is</option>
              <option value="cover">Under a cover name</option>
              <option value="hide">Left out, with its doses and history</option>
            </Select>
            {f.privateView === 'cover' && <TextInput label="Cover name" value={f.coverName} onChange={(e) => set('coverName', e.target.value)} autoComplete="off" placeholder="e.g. Vitamin D" />}
          </>
        )}
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
        </div>
        <ScheduleFields f={f} set={set as ScheduleSetter} errors={errors} unit={f.unit} />
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="text-sm font-medium text-muted flex items-center gap-2"><ClipboardList size={20} className="text-primary" aria-hidden="true" /> Instructions</h2>
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
          help={perDose !== undefined ? `−${perDose} per dose` : undefined} />
        {existing && !existing.peptide && <CountButton med={existing} label={countsFromPhoto(existing) ? "Count what's left (photo or typed)" : "Count what's left"} onCounted={(n) => set('stockCount', String(n))} />}
        <TextInput label="Let me know when it's down to (optional)" type="number" inputMode="decimal" min="0" step="any" value={f.lowStockAt}
          onChange={(e) => set('lowStockAt', e.target.value)} error={errors.lowStockAt} />
        <div className="grid grid-cols-2 gap-3 items-start">
          <TextInput label="Repeats left (optional)" type="number" inputMode="numeric" min="0" step="1" value={f.repeatsLeft}
            onChange={(e) => set('repeatsLeft', e.target.value)} error={errors.repeatsLeft} />
          <TextInput label="Script expires (optional)" type="date" value={f.scriptExpiry} onChange={(e) => set('scriptExpiry', e.target.value)} />
        </div>
        <TextInput label={f.mixed ? `Price per ${f.kind === 'pen' ? 'pen' : 'vial'} ($, optional)` : 'Price per pack or script ($, optional)'} type="number" inputMode="decimal" min="0" step="any"
          value={f.cost} onChange={(e) => set('cost', e.target.value)} help={undefined} />
        <TextArea label="Script and refill notes (optional)" value={f.scriptNotes} onChange={(e) => set('scriptNotes', e.target.value)} />
      </Card>

      {existing && (
        <Card className="space-y-3">
          <Button variant="secondary" className="w-full" onClick={archive}>{existing.archived ? 'Restore medication' : 'Archive medication'}</Button>
          <Button variant="danger" className="w-full" onClick={() => { setTyped(''); setConfirmDelete(true); }}>Delete permanently</Button>
        </Card>
      )}
      </>)}

      {(!existing || editing) && (
        <div className="fixed bottom-0 inset-x-0 z-30 bg-surface border-t border-border" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="mx-auto max-w-[560px] px-4 py-3">
            <Button className="w-full min-h-[56px]" onClick={onSave}>{existing ? 'Save changes' : 'Save medication'}</Button>
          </div>
        </div>
      )}

      <Sheet open={!!change} onClose={() => setChange(null)} title="Record this as a change?">
        {change && (
          <div className="space-y-4">
            <ul className="space-y-1">{change.lines.map((l) => <li key={l} className="tnum">{l}</li>)}</ul>
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
          <TextInput label="Water usually added to a vial (mL)" type="number" inputMode="decimal" min="0" step="any" value={f.waterMl}
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
        <TextInput label={`Amount per click of the dial (${f.unit}, optional)`}
          type="number" inputMode="decimal" min="0" step="any" value={f.amountPerClick} onChange={(e) => set('amountPerClick', e.target.value)} error={errors.amountPerClick} />
      )}
      {f.mixed && (
        <>
          <TextInput label={f.kind === 'pen' ? 'Use a pen within (days of first use, optional)' : 'Use a mixed vial within (days, optional)'}
            type="number" inputMode="numeric" min="1" step="1" value={f.useWithinDays} onChange={(e) => set('useWithinDays', e.target.value)} error={errors.useWithinDays} />
          <div className="grid grid-cols-[1fr_auto] gap-3 items-start">
            <TextInput label="Half-life (optional)"
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
      <p className="text-sm text-muted">Other peptides in the same vial</p>
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

/** A tablet or capsule medicine's stock at a glance: what's left, how long it lasts, repeats. Counts are changed in Details. */
function StockLine({ med, onEdit }: { med: Medication; onEdit: () => void }) {
  const doses = useDoses(); const ss = useScheduleSettings(); const now = useNow(600_000);
  if (!doses || !ss) return null;
  const f = forecastRunOut(med, doses, now, ss[1]);
  return (
    <section aria-labelledby={`stock-${med.id}`} className="border-t border-border pt-5 space-y-2">
      <h2 id={`stock-${med.id}`} className="text-sm font-medium text-muted">Stock</h2>
      {med.stockCount !== undefined ? (
        <p className="tnum"><span className="text-[22px] font-semibold">{Math.round(med.stockCount * 100) / 100}</span> left{f?.runOutAt != null ? <span className="text-muted"> · about {f.daysLeft} days, runs out {format(f.runOutAt, 'EEE d MMM')}</span> : null}</p>
      ) : <p className="text-muted">No count yet: add one to see when it runs out.</p>}
      {med.repeatsLeft !== undefined && <p className="tnum">{med.repeatsLeft} repeat{med.repeatsLeft === 1 ? '' : 's'} left on the script</p>}
      <button type="button" onClick={onEdit} className="min-h-[44px] text-sm font-medium underline underline-offset-4">Change the count or repeats</button>
    </section>
  );
}
