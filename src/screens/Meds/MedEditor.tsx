import { useEffect, useState } from 'react';
import { Check, ClipboardList, Plus, X } from 'lucide-react';
import { format } from 'date-fns';
import type { Medication, Schedule, ScheduleType } from '../../db/schema';
import { db } from '../../db/db';
import { useLive } from '../../db/live';
import { useMeds } from '../../app/data';
import { createMed, deleteMedForever, setArchived, updateMed, type MedInput } from '../../db/repos/meds';
import { linkTag } from '../../db/repos/tags';
import { go, replace } from '../../app/router';
import { useToast } from '../../app/toast';
import { MED_COLOURS, MED_ICONS, medColour, medInk } from '../../logic/palette';
import { stockUnitsFor } from '../../logic/stock';
import { fmtAmount, fmtSchedule } from '../../logic/format';
import { getSlots } from '../../logic/schedule';
import { APP_NAME } from '../../config';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { Segmented, Select, TextArea, TextInput } from '../../components/ui/Field';
import { MED_ICON_COMPONENTS } from '../../components/MedBadge';
import { TagsSection } from './TagsSection';

const UNITS = ['mg', 'mcg', 'mL', 'units', 'tablet'];
const FORMS = ['tablet', 'capsule', 'liquid', 'patch', 'injection', 'other'];

type DayMode = 'every' | 'days' | 'everyN';

interface Form {
  name: string; strength: string; unit: string; form: string; defaultAmount: string;
  type: ScheduleType; intervalHours: string; maxPerDay: string; latestDoseTime: string;
  /** Every few hours: a different amount for each dose of the day. */
  varyAmounts: boolean; doseAmounts: string[];
  /** Set times, each with an optional amount. */
  slots: { time: string; amount: string }[];
  dayMode: DayMode; days: number[]; everyNDays: string; startDate: string;
  color: string; icon: string; stockCount: string; lowStockAt: string; scriptNotes: string;
  instructions: string; instructionsBy: string;
}

const todayYmd = () => format(Date.now(), 'yyyy-MM-dd');

const blank: Form = {
  name: '', strength: '', unit: 'mg', form: 'tablet', defaultAmount: '',
  type: 'interval', intervalHours: '4', maxPerDay: '', latestDoseTime: '',
  varyAmounts: false, doseAmounts: ['', ''], slots: [{ time: '08:00', amount: '' }],
  dayMode: 'every', days: [], everyNDays: '14', startDate: todayYmd(),
  color: MED_COLOURS[0].value, icon: 'pill', stockCount: '', lowStockAt: '', scriptNotes: '',
  instructions: '', instructionsBy: '',
};

const str = (n?: number) => (n === undefined || n === null ? '' : String(n));
const num = (s: string) => (s.trim() === '' ? undefined : Number(s));

function fromMed(m: Medication): Form {
  const sc = m.schedule;
  const slots = getSlots(m);
  return {
    name: m.name, strength: str(m.strength), unit: m.unit, form: m.form, defaultAmount: str(m.defaultAmount),
    type: sc.type, intervalHours: str(sc.intervalHours) || '4', maxPerDay: str(sc.maxPerDay), latestDoseTime: sc.latestDoseTime ?? '',
    varyAmounts: !!sc.doseAmounts?.length, doseAmounts: sc.doseAmounts?.length ? sc.doseAmounts.map(String) : ['', ''],
    slots: slots.length ? slots.map((x) => ({ time: x.time, amount: str(x.amount) })) : [{ time: '08:00', amount: '' }],
    dayMode: sc.everyNDays && sc.everyNDays > 1 ? 'everyN' : sc.days?.length ? 'days' : 'every',
    days: sc.days ?? [], everyNDays: str(sc.everyNDays) || '14', startDate: sc.startDate ?? todayYmd(),
    color: m.color, icon: m.icon, stockCount: str(m.stockCount), lowStockAt: str(m.lowStockAt), scriptNotes: m.scriptNotes ?? '',
    instructions: m.instructions ?? '', instructionsBy: m.instructionsBy ?? '',
  };
}

function toInput(f: Form, before?: Medication): MedInput {
  let schedule: Schedule;
  if (f.type === 'interval') {
    const amounts = f.varyAmounts ? f.doseAmounts.filter((a) => a.trim()).map(Number) : [];
    schedule = {
      type: 'interval', intervalHours: Number(f.intervalHours), latestDoseTime: f.latestDoseTime || undefined,
      doseAmounts: amounts.length ? amounts : undefined, maxPerDay: amounts.length ? undefined : num(f.maxPerDay),
    };
  } else if (f.type === 'fixed') {
    const seen = new Set<string>();
    const slots = f.slots.filter((x) => x.time && !seen.has(x.time) && seen.add(x.time))
      .map((x) => ({ time: x.time, amount: num(x.amount) }))
      .sort((a, b) => a.time.localeCompare(b.time));
    schedule = { type: 'fixed', slots };
  } else {
    schedule = { type: 'prn' };
  }
  if (f.type !== 'prn') {
    if (f.dayMode === 'days' && f.days.length && f.days.length < 7) schedule.days = [...f.days].sort((a, b) => a - b);
    if (f.dayMode === 'everyN') { schedule.everyNDays = Number(f.everyNDays); schedule.startDate = f.startDate; }
  }
  // Usual dose can be left blank when the plan gives every amount; it then defaults to the first planned amount.
  const planned = schedule.doseAmounts?.[0] ?? schedule.slots?.find((x) => x.amount !== undefined)?.amount;
  const instructions = f.instructions.trim() || undefined;
  return {
    name: f.name.trim(), strength: Number(f.strength) || 0, unit: f.unit, form: f.form,
    defaultAmount: Number(f.defaultAmount) || planned || 0, schedule, color: f.color, icon: f.icon,
    stockCount: num(f.stockCount), lowStockAt: num(f.lowStockAt), scriptNotes: f.scriptNotes.trim() || undefined,
    instructions, instructionsBy: instructions ? f.instructionsBy.trim() || undefined : undefined,
    instructionsUpdatedAt: !instructions ? undefined
      : instructions === before?.instructions?.trim() ? before?.instructionsUpdatedAt : new Date().toISOString(),
  };
}

type Errors = Partial<Record<keyof Form | `dose${number}` | `slot${number}`, string>>;

function validate(f: Form): Errors {
  const e: Errors = {};
  const pos = (s: string) => s.trim() !== '' && Number(s) > 0;
  const posOrBlank = (s: string) => s.trim() === '' || Number(s) > 0;
  if (!f.name.trim()) e.name = 'Enter a name.';
  if (!posOrBlank(f.strength)) e.strength = 'Enter a number above 0, or leave it blank.';
  const planCoversAmounts = (f.type === 'interval' && f.varyAmounts && f.doseAmounts.some((a) => pos(a)))
    || (f.type === 'fixed' && f.slots.every((x) => pos(x.amount)));
  if (!pos(f.defaultAmount) && !(planCoversAmounts && f.defaultAmount.trim() === '')) e.defaultAmount = 'Enter how much you usually take.';
  if (f.type === 'interval') {
    if (!pos(f.intervalHours)) e.intervalHours = 'Enter how many hours apart.';
    if (f.varyAmounts) {
      f.doseAmounts.forEach((a, i) => { if (!pos(a)) e[`dose${i}`] = 'Enter an amount, or remove this dose.'; });
    } else if (f.maxPerDay.trim() && !(Number.isInteger(Number(f.maxPerDay)) && Number(f.maxPerDay) > 0)) {
      e.maxPerDay = 'Enter a whole number, or leave it blank.';
    }
  }
  if (f.type === 'fixed') {
    if (!f.slots.some((x) => x.time)) e.slots = 'Add at least one time.';
    f.slots.forEach((x, i) => { if (!posOrBlank(x.amount)) e[`slot${i}`] = 'Enter an amount above 0, or leave it blank for your usual dose.'; });
    const times = f.slots.map((x) => x.time).filter(Boolean);
    if (new Set(times).size !== times.length) e.slots = 'Each time can only be listed once.';
  }
  if (f.type !== 'prn' && f.dayMode === 'days' && !f.days.length) e.days = 'Choose at least one day.';
  if (f.type !== 'prn' && f.dayMode === 'everyN') {
    if (!(Number.isInteger(Number(f.everyNDays)) && Number(f.everyNDays) >= 2)) e.everyNDays = 'Enter a whole number of days, 2 or more.';
    if (!f.startDate) e.startDate = 'Choose a day you take it.';
  }
  if (f.stockCount.trim() && !(Number(f.stockCount) >= 0)) e.stockCount = 'Enter a number, or leave it blank.';
  if (f.lowStockAt.trim() && !(Number(f.lowStockAt) >= 0)) e.lowStockAt = 'Enter a number, or leave it blank.';
  return e;
}

const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** What changed in strength, dose or schedule, in words. Empty when nothing did. */
function describeChange(before: Medication, after: MedInput): string[] {
  const out: string[] = [];
  if (before.strength !== after.strength || before.unit !== after.unit)
    out.push(`Strength ${fmtAmount(before.strength, before.unit)} → ${fmtAmount(after.strength, after.unit)}`);
  if (before.defaultAmount !== after.defaultAmount)
    out.push(`Dose ${fmtAmount(before.defaultAmount, before.unit)} → ${fmtAmount(after.defaultAmount, after.unit)}`);
  if (fmtSchedule(before.schedule, before.unit) !== fmtSchedule(after.schedule, after.unit))
    out.push(`Schedule ${fmtSchedule(before.schedule, before.unit)} → ${fmtSchedule(after.schedule, after.unit)}`);
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
      const lines = describeChange(existing, toInput(f, existing));
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
        <div className="space-y-1.5">
          <span className="block text-sm font-medium">Schedule</span>
          <Segmented<ScheduleType> label="Schedule" value={f.type} onChange={(v) => set('type', v)}
            options={[{ value: 'interval', label: 'Every few hours' }, { value: 'fixed', label: 'Set times' }, { value: 'prn', label: 'As needed' }]} />
        </div>

        {f.type === 'interval' && (
          <>
            <TextInput label="Hours between doses" type="number" inputMode="decimal" min="0" step="0.5" value={f.intervalHours}
              onChange={(e) => set('intervalHours', e.target.value)} error={errors.intervalHours} />
            <label className="flex items-start gap-3 min-h-[48px] py-1">
              <input type="checkbox" checked={f.varyAmounts} onChange={(e) => set('varyAmounts', e.target.checked)} className="w-5 h-5 mt-0.5 accent-[var(--primary)]" />
              <span><span className="block font-medium">The amount changes from dose to dose</span>
                <span className="block text-sm text-muted">For example 20 mg, then 20 mg, then 10 mg.</span></span>
            </label>
            {f.varyAmounts ? (
              <div className="space-y-2">
                {f.doseAmounts.map((a, i) => (
                  <div key={i}>
                    <div className="flex gap-2 items-center">
                      <label htmlFor={`dose${i}`} className="w-24 shrink-0 text-sm font-medium">{ORDINAL[i] ?? `${i + 1}th`} dose</label>
                      <input id={`dose${i}`} type="number" inputMode="decimal" min="0" step="any" value={a} aria-invalid={!!errors[`dose${i}`]}
                        onChange={(e) => set('doseAmounts', f.doseAmounts.map((x, j) => (j === i ? e.target.value : x)))}
                        className="flex-1 min-w-0 min-h-[48px] rounded-btn bg-surface-2 border border-border px-3 tnum" />
                      <span className="w-14 text-muted">{amountLabel}</span>
                      {f.doseAmounts.length > 1 && (
                        <button type="button" onClick={() => set('doseAmounts', f.doseAmounts.filter((_, j) => j !== i))} aria-label={`Remove ${ORDINAL[i]} dose`}
                          className="w-12 h-12 shrink-0 rounded-btn bg-surface-2 flex items-center justify-center"><X size={20} aria-hidden="true" /></button>
                      )}
                    </div>
                    {errors[`dose${i}`] && <p className="text-sm text-danger mt-1" role="alert">{errors[`dose${i}`]}</p>}
                  </div>
                ))}
                {f.doseAmounts.length < 12 && (
                  <Button variant="secondary" className="flex items-center gap-2" onClick={() => set('doseAmounts', [...f.doseAmounts, ''])}>
                    <Plus size={18} aria-hidden="true" /> Add a dose
                  </Button>
                )}
                <p className="text-sm text-muted tnum">
                  {f.doseAmounts.length} dose{f.doseAmounts.length === 1 ? '' : 's'} a day
                  {f.doseAmounts.every((a) => Number(a) > 0) ? `, ${fmtAmount(f.doseAmounts.reduce((t, a) => t + Number(a), 0), f.unit)} in total` : ''}.
                  Logging fills in the right amount for each dose.
                </p>
              </div>
            ) : (
              <TextInput label="Most doses in a day (optional)" type="number" inputMode="numeric" min="1" step="1" value={f.maxPerDay}
                onChange={(e) => set('maxPerDay', e.target.value)} error={errors.maxPerDay} help="Shown as “Today: 2 of 3”." />
            )}
            <div className="space-y-1.5">
              <label htmlFor="latest" className="block text-sm font-medium">Latest dose time (optional)</label>
              <div className="flex gap-2">
                <input id="latest" type="time" value={f.latestDoseTime} onChange={(e) => set('latestDoseTime', e.target.value)}
                  className="flex-1 min-w-0 min-h-[48px] rounded-btn bg-surface-2 border border-border px-3 tnum" />
                {f.latestDoseTime && <Button variant="secondary" onClick={() => set('latestDoseTime', '')}>Clear</Button>}
              </div>
              <p className="text-sm text-muted">For example, if you were told not to take it after 4 pm.</p>
            </div>
          </>
        )}

        {f.type === 'fixed' && (
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_1fr_48px] gap-2 text-sm font-medium" aria-hidden="true">
              <span>Time</span><span>Amount ({amountLabel})</span><span />
            </div>
            {f.slots.map((x, i) => (
              <div key={i}>
                <div className="grid grid-cols-[1fr_1fr_48px] gap-2">
                  <input type="time" aria-label={`Time ${i + 1}`} value={x.time}
                    onChange={(e) => set('slots', f.slots.map((y, j) => (j === i ? { ...y, time: e.target.value } : y)))}
                    className="flex-1 min-w-0 min-h-[48px] rounded-btn bg-surface-2 border border-border px-3 tnum" />
                  <input type="number" inputMode="decimal" min="0" step="any" aria-label={`Amount at time ${i + 1}`} placeholder={f.defaultAmount || 'Usual'}
                    value={x.amount} aria-invalid={!!errors[`slot${i}`]}
                    onChange={(e) => set('slots', f.slots.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))}
                    className="flex-1 min-w-0 min-h-[48px] rounded-btn bg-surface-2 border border-border px-3 tnum" />
                  {f.slots.length > 1 ? (
                    <button type="button" onClick={() => set('slots', f.slots.filter((_, j) => j !== i))} aria-label={`Remove time ${i + 1}`}
                      className="w-12 h-12 rounded-btn bg-surface-2 flex items-center justify-center"><X size={20} aria-hidden="true" /></button>
                  ) : <span />}
                </div>
                {errors[`slot${i}`] && <p className="text-sm text-danger mt-1" role="alert">{errors[`slot${i}`]}</p>}
              </div>
            ))}
            {errors.slots && <p className="text-sm text-danger" role="alert">{errors.slots}</p>}
            <Button variant="secondary" className="flex items-center gap-2" onClick={() => set('slots', [...f.slots, { time: '', amount: '' }])}>
              <Plus size={18} aria-hidden="true" /> Add a time
            </Button>
            <p className="text-sm text-muted">Leave an amount blank to use your usual dose. Different times can have different amounts.</p>
          </div>
        )}

        {f.type === 'prn' && <p className="text-sm text-muted">No countdown. Today shows when you last took it.</p>}

        {f.type !== 'prn' && (
          <div className="space-y-3 pt-1">
            <div className="space-y-1.5">
              <span className="block text-sm font-medium">Which days</span>
              <Segmented<DayMode> label="Which days" value={f.dayMode} onChange={(v) => set('dayMode', v)}
                options={[{ value: 'every', label: 'Every day' }, { value: 'days', label: 'Certain days' }, { value: 'everyN', label: 'Every few days' }]} />
            </div>
            {f.dayMode === 'days' && (
              <div>
                <div className="grid grid-cols-7 gap-1" role="group" aria-label="Days of the week">
                  {DAY_NAMES.map((name, d) => {
                    const on = f.days.includes(d);
                    return (
                      <button key={d} type="button" aria-pressed={on} aria-label={name}
                        onClick={() => set('days', on ? f.days.filter((x) => x !== d) : [...f.days, d])}
                        className={`min-h-[48px] rounded-btn font-semibold ${on ? 'bg-primary text-on-primary' : 'bg-surface-2'}`}>
                        {name.slice(0, 2)}
                      </button>
                    );
                  })}
                </div>
                {errors.days && <p className="text-sm text-danger mt-1" role="alert">{errors.days}</p>}
                <div className="flex gap-2 mt-2">
                  <button type="button" className="min-h-[44px] px-3 rounded-chip bg-surface-2 text-sm font-medium" onClick={() => set('days', [1, 2, 3, 4, 5])}>Weekdays</button>
                  <button type="button" className="min-h-[44px] px-3 rounded-chip bg-surface-2 text-sm font-medium" onClick={() => set('days', [0, 6])}>Weekends</button>
                </div>
              </div>
            )}
            {f.dayMode === 'everyN' && (
              <div className="grid grid-cols-2 gap-3 items-start">
                <TextInput label="Every how many days" type="number" inputMode="numeric" min="2" step="1" value={f.everyNDays}
                  onChange={(e) => set('everyNDays', e.target.value)} error={errors.everyNDays} help="14 = fortnightly" />
                <TextInput label="Starting on" type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)}
                  error={errors.startDate} help="A day you take it" />
              </div>
            )}
          </div>
        )}

        <TextInput label={`Usual dose (${amountLabel})${(f.type === 'interval' && f.varyAmounts) || f.type === 'fixed' ? ' (optional)' : ''}`}
          type="number" inputMode="decimal" min="0" step="any" value={f.defaultAmount}
          onChange={(e) => set('defaultAmount', e.target.value)} error={errors.defaultAmount}
          help={f.type === 'interval' && f.varyAmounts ? 'Used for any extra doses beyond the plan. Leave blank to use the 1st dose amount.'
            : f.type === 'fixed' ? 'Used for any time without its own amount.' : 'Filled in each time you log. You can change it when logging.'} />
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
