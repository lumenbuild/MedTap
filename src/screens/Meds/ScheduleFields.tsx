import { useId } from 'react';
import { format } from 'date-fns';
import { Plus, X } from 'lucide-react';
import type { Medication, Schedule, ScheduleType } from '../../db/schema';
import { fmtAmount } from '../../logic/format';
import { getSlots } from '../../logic/schedule';
import { Button } from '../../components/ui/Button';
import { Segmented, TextInput } from '../../components/ui/Field';

// The schedule part of a medication (kind, amounts, times, days, usual dose), shared by the medication editor
// and "Plan a change". Strings mirror the inputs; scheduleFromForm turns them into a Schedule.

export type DayMode = 'every' | 'days' | 'everyN';

export interface ScheduleForm {
  defaultAmount: string;
  type: ScheduleType; intervalHours: string; maxPerDay: string; latestDoseTime: string;
  /** Every few hours: a different amount for each dose of the day. */
  varyAmounts: boolean; doseAmounts: string[];
  /** Set times, each with an optional amount. */
  slots: { time: string; amount: string }[];
  dayMode: DayMode; days: number[]; everyNDays: string; startDate: string;
  /** As needed: limits from the label or the doctor. */
  maxPer24h: string; maxAmountPer24h: string; minHoursApart: string;
  /** Ongoing, on and off (repeating), or a course then a break until started again. */
  pattern: Pattern;
  cycleOn: string; cycleOnUnit: CycleUnit; cycleOff: string; cycleOffUnit: CycleUnit; cycleStart: string;
  courseLen: string; courseLenUnit: CycleUnit; courseStart: string;
  /** During the break: ask about starting again when a check-in mentions these (comma-separated), or after this many weeks. */
  restartOn: string; restartAfterWeeks: string;
}

export type Pattern = 'ongoing' | 'cycle' | 'course';

export type CycleUnit = 'days' | 'weeks';
const inUnit = (days: number): [string, CycleUnit] => (days >= 7 && days % 7 === 0 ? [String(days / 7), 'weeks'] : [String(days), 'days']);
const toDays = (n: string, u: CycleUnit) => Number(n) * (u === 'weeks' ? 7 : 1);

export type ScheduleErrors = Partial<Record<keyof ScheduleForm | `dose${number}` | `slot${number}`, string>>;
export type ScheduleSetter = <K extends keyof ScheduleForm>(k: K, v: ScheduleForm[K]) => void;

const todayYmd = () => format(Date.now(), 'yyyy-MM-dd');
const str = (n?: number) => (n === undefined || n === null ? '' : String(n));
const num = (s: string) => (s.trim() === '' ? undefined : Number(s));

export const blankSchedule = (): ScheduleForm => ({
  defaultAmount: '', type: 'interval', intervalHours: '4', maxPerDay: '', latestDoseTime: '',
  varyAmounts: false, doseAmounts: ['', ''], slots: [{ time: '08:00', amount: '' }],
  dayMode: 'every', days: [], everyNDays: '14', startDate: todayYmd(),
  maxPer24h: '', maxAmountPer24h: '', minHoursApart: '',
  pattern: 'ongoing', cycleOn: '8', cycleOnUnit: 'weeks', cycleOff: '4', cycleOffUnit: 'weeks', cycleStart: todayYmd(),
  courseLen: '12', courseLenUnit: 'weeks', courseStart: todayYmd(), restartOn: '', restartAfterWeeks: '',
});

export function scheduleFormFromMed(m: Pick<Medication, 'schedule' | 'defaultAmount'>): ScheduleForm {
  const sc = m.schedule;
  const slots = getSlots(m as Medication);
  return {
    defaultAmount: str(m.defaultAmount),
    type: sc.type, intervalHours: str(sc.intervalHours) || '4', maxPerDay: str(sc.maxPerDay), latestDoseTime: sc.latestDoseTime ?? '',
    varyAmounts: !!sc.doseAmounts?.length, doseAmounts: sc.doseAmounts?.length ? sc.doseAmounts.map(String) : ['', ''],
    slots: slots.length ? slots.map((x) => ({ time: x.time, amount: str(x.amount) })) : [{ time: '08:00', amount: '' }],
    dayMode: sc.everyNDays && sc.everyNDays > 1 ? 'everyN' : sc.days?.length ? 'days' : 'every',
    days: sc.days ?? [], everyNDays: str(sc.everyNDays) || '14', startDate: sc.startDate ?? todayYmd(),
    maxPer24h: str(sc.maxPer24h), maxAmountPer24h: str(sc.maxAmountPer24h), minHoursApart: str(sc.minHoursApart),
    ...(sc.cycle ? (() => {
      const [on, onU] = inUnit(sc.cycle.on);
      const [off, offU] = inUnit(sc.cycle.off);
      return { cycleOn: on, cycleOnUnit: onU, cycleOff: off, cycleOffUnit: offU, cycleStart: sc.cycle.start };
    })() : { cycleOn: '8', cycleOnUnit: 'weeks' as const, cycleOff: '4', cycleOffUnit: 'weeks' as const, cycleStart: todayYmd() }),
    ...(sc.course ? (() => {
      const [len, lenU] = inUnit(sc.course.days);
      return { courseLen: len, courseLenUnit: lenU, courseStart: sc.course.start, restartOn: (sc.course.restartOn ?? []).join(', '),
        restartAfterWeeks: sc.course.remindAfterDays ? String(Math.round(sc.course.remindAfterDays / 7)) : '' };
    })() : { courseLen: '12', courseLenUnit: 'weeks' as const, courseStart: todayYmd(), restartOn: '', restartAfterWeeks: '' }),
    pattern: sc.course ? 'course' : sc.cycle ? 'cycle' : 'ongoing',
  };
}

export function scheduleFromForm(f: ScheduleForm): { schedule: Schedule; defaultAmount: number } {
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
    schedule = { type: 'prn', maxPer24h: num(f.maxPer24h), maxAmountPer24h: num(f.maxAmountPer24h), minHoursApart: num(f.minHoursApart) };
  }
  if (f.type !== 'prn') {
    if (f.dayMode === 'days' && f.days.length && f.days.length < 7) schedule.days = [...f.days].sort((a, b) => a - b);
    if (f.dayMode === 'everyN') { schedule.everyNDays = Number(f.everyNDays); schedule.startDate = f.startDate; }
    if (f.pattern === 'cycle') schedule.cycle = { on: toDays(f.cycleOn, f.cycleOnUnit), off: toDays(f.cycleOff, f.cycleOffUnit), start: f.cycleStart };
    if (f.pattern === 'course') {
      const words = f.restartOn.split(',').map((w) => w.trim()).filter(Boolean);
      schedule.course = { start: f.courseStart, days: toDays(f.courseLen, f.courseLenUnit),
        ...(words.length ? { restartOn: words } : {}), ...(Number(f.restartAfterWeeks) > 0 ? { remindAfterDays: Math.round(Number(f.restartAfterWeeks) * 7) } : {}) };
    }
  }
  // Usual dose can be left blank when the plan gives every amount; it then defaults to the first planned amount.
  const planned = schedule.doseAmounts?.[0] ?? schedule.slots?.find((x) => x.amount !== undefined)?.amount;
  return { schedule, defaultAmount: Number(f.defaultAmount) || planned || 0 };
}

export function validateSchedule(f: ScheduleForm): ScheduleErrors {
  const e: ScheduleErrors = {};
  const pos = (s: string) => s.trim() !== '' && Number(s) > 0;
  const posOrBlank = (s: string) => s.trim() === '' || Number(s) > 0;
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
  if (f.type === 'prn') {
    if (f.maxPer24h.trim() && !(Number.isInteger(Number(f.maxPer24h)) && Number(f.maxPer24h) > 0)) e.maxPer24h = 'Enter a whole number, or leave it blank.';
    if (!posOrBlank(f.maxAmountPer24h)) e.maxAmountPer24h = 'Enter a number above 0, or leave it blank.';
    if (!posOrBlank(f.minHoursApart)) e.minHoursApart = 'Enter a number above 0, or leave it blank.';
  }
  if (f.type !== 'prn' && f.dayMode === 'days' && !f.days.length) e.days = 'Choose at least one day.';
  if (f.type !== 'prn' && f.dayMode === 'everyN') {
    if (!(Number.isInteger(Number(f.everyNDays)) && Number(f.everyNDays) >= 2)) e.everyNDays = 'Enter a whole number of days, 2 or more.';
    if (!f.startDate) e.startDate = 'Choose a day you take it.';
  }
  if (f.type !== 'prn' && f.pattern === 'course') {
    if (!(Number.isInteger(Number(f.courseLen)) && Number(f.courseLen) >= 1)) e.courseLen = 'Enter a whole number.';
    if (!f.courseStart) e.courseStart = 'Choose the first day of the course.';
    if (f.restartAfterWeeks.trim() && !(Number(f.restartAfterWeeks) > 0)) e.restartAfterWeeks = 'Enter a number of weeks, or leave it blank.';
  }
  if (f.type !== 'prn' && f.pattern === 'cycle') {
    if (!(Number.isInteger(Number(f.cycleOn)) && Number(f.cycleOn) >= 1)) e.cycleOn = 'Enter a whole number.';
    if (!(Number.isInteger(Number(f.cycleOff)) && Number(f.cycleOff) >= 1)) e.cycleOff = 'Enter a whole number.';
    if (!f.cycleStart) e.cycleStart = 'Choose the first day of an "on" stretch.';
  }
  return e;
}

const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function ScheduleFields({ f, set, errors, unit }: {
  f: ScheduleForm; set: ScheduleSetter; errors: ScheduleErrors; unit: string;
}) {
  const amountLabel = unit === 'tablet' ? 'tablets' : unit;
  const uid = useId(); // the editor and "Plan a change" can both be on screen
  return (
    <>
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
                    <label htmlFor={`${uid}dose${i}`} className="w-24 shrink-0 text-sm font-medium">{ORDINAL[i] ?? `${i + 1}th`} dose</label>
                    <input id={`${uid}dose${i}`} type="number" inputMode="decimal" min="0" step="any" value={a} aria-invalid={!!errors[`dose${i}`]}
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
                {f.doseAmounts.every((a) => Number(a) > 0) ? `, ${fmtAmount(f.doseAmounts.reduce((t, a) => t + Number(a), 0), unit)} in total` : ''}.
                Logging fills in the right amount for each dose.
              </p>
            </div>
          ) : (
            <TextInput label="Most doses in a day (optional)" type="number" inputMode="numeric" min="1" step="1" value={f.maxPerDay}
              onChange={(e) => set('maxPerDay', e.target.value)} error={errors.maxPerDay} />
          )}
          <div className="space-y-1.5">
            <label htmlFor={`${uid}latest`} className="block text-sm font-medium">Latest dose time (optional)</label>
            <div className="flex gap-2">
              <input id={`${uid}latest`} type="time" value={f.latestDoseTime} onChange={(e) => set('latestDoseTime', e.target.value)}
                className="flex-1 min-w-0 min-h-[48px] rounded-btn bg-surface-2 border border-border px-3 tnum" />
              {f.latestDoseTime && <Button variant="secondary" onClick={() => set('latestDoseTime', '')}>Clear</Button>}
            </div>
            
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
        </div>
      )}

      {f.type === 'prn' && (
        <div className="space-y-3">
          <div>
            <h3 className="font-semibold">Limits (optional)</h3>
            <p className="text-sm text-muted">Over any 24 hours</p>
          </div>
          <div className="grid grid-cols-2 gap-3 items-start">
            <TextInput label="Most doses in 24 hours" type="number" inputMode="numeric" min="1" step="1" value={f.maxPer24h}
              onChange={(e) => set('maxPer24h', e.target.value)} error={errors.maxPer24h} />
            <TextInput label="Hours apart, at least" type="number" inputMode="decimal" min="0" step="0.5" value={f.minHoursApart}
              onChange={(e) => set('minHoursApart', e.target.value)} error={errors.minHoursApart} />
          </div>
          <TextInput label={`Most in 24 hours (${amountLabel})`} type="number" inputMode="decimal" min="0" step="any" value={f.maxAmountPer24h}
            onChange={(e) => set('maxAmountPer24h', e.target.value)} error={errors.maxAmountPer24h} />
        </div>
      )}

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
          <div className="space-y-3">
            <Segmented<Pattern> label="Pattern" value={f.pattern} onChange={(v) => set('pattern', v)}
              options={[{ value: 'ongoing', label: 'Ongoing' }, { value: 'cycle', label: 'On and off' }, { value: 'course', label: 'Course' }]} />
            {f.pattern === 'cycle' && (
              <>
                <p className="text-sm text-muted">Repeats, e.g. 4 weeks on, 12 weeks off. Off days aren't scheduled.</p>
                <div className="grid grid-cols-[1fr_auto] gap-3 items-start">
                  <TextInput label="On for" type="number" inputMode="numeric" min="1" step="1" value={f.cycleOn} onChange={(e) => set('cycleOn', e.target.value)} error={errors.cycleOn} />
                  <Segmented<CycleUnit> label="On for, days or weeks" value={f.cycleOnUnit} onChange={(v) => set('cycleOnUnit', v)} options={[{ value: 'days', label: 'Days' }, { value: 'weeks', label: 'Weeks' }]} />
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-3 items-start">
                  <TextInput label="Then off for" type="number" inputMode="numeric" min="1" step="1" value={f.cycleOff} onChange={(e) => set('cycleOff', e.target.value)} error={errors.cycleOff} />
                  <Segmented<CycleUnit> label="Off for, days or weeks" value={f.cycleOffUnit} onChange={(v) => set('cycleOffUnit', v)} options={[{ value: 'days', label: 'Days' }, { value: 'weeks', label: 'Weeks' }]} />
                </div>
                <TextInput label="First day of an “on” stretch" type="date" value={f.cycleStart} onChange={(e) => set('cycleStart', e.target.value)} error={errors.cycleStart} />
              </>
            )}
            {f.pattern === 'course' && (
              <>
                <p className="text-sm text-muted">Taken for a set time, then a break until you start another course, e.g. 12 weeks then off until it's needed again.</p>
                <div className="grid grid-cols-[1fr_auto] gap-3 items-start">
                  <TextInput label="Course length" type="number" inputMode="numeric" min="1" step="1" value={f.courseLen} onChange={(e) => set('courseLen', e.target.value)} error={errors.courseLen} />
                  <Segmented<CycleUnit> label="Course length, days or weeks" value={f.courseLenUnit} onChange={(v) => set('courseLenUnit', v)} options={[{ value: 'days', label: 'Days' }, { value: 'weeks', label: 'Weeks' }]} />
                </div>
                <TextInput label="First day of the course" type="date" value={f.courseStart} onChange={(e) => set('courseStart', e.target.value)} error={errors.courseStart} />
                <TextInput label="On the break, ask about starting again when a check-in mentions (optional)" value={f.restartOn} onChange={(e) => set('restartOn', e.target.value)}
                  placeholder="e.g. Pain" help="Comma between words. They're added as check-in chips." />
                <TextInput label="Or after this many weeks off (optional)" type="number" inputMode="numeric" min="1" step="1" value={f.restartAfterWeeks}
                  onChange={(e) => set('restartAfterWeeks', e.target.value)} error={errors.restartAfterWeeks} />
              </>
            )}
          </div>
        </div>
      )}

      <TextInput label={`Usual dose (${amountLabel})${(f.type === 'interval' && f.varyAmounts) || f.type === 'fixed' ? ' (optional)' : ''}`}
        type="number" inputMode="decimal" min="0" step="any" value={f.defaultAmount}
        onChange={(e) => set('defaultAmount', e.target.value)} error={errors.defaultAmount}
        help={f.type === 'fixed' ? 'For times without their own amount' : undefined} />
    </>
  );
}
