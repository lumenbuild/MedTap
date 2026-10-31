// Smart features shared by both apps: learned reminder times, missed-slot patterns, the effect window and script
// planning (medication page), the sheet for odd records (an insight on Today), and the coming days' check-in forecast
// (Trends). Each one shows what it rests on.
import { DoseHeartSection } from './DoseHeart';
import { format } from 'date-fns';
import type { CheckIn, Dose, Medication } from '../db/schema';
import type { ScheduleSettings } from '../logic/schedule';
import {
  effectWindow, reminderSuggestion, riskySlots, slotHabits, type CheckInForecast, type EffectWindow,
} from '../logic/habits';
import { scriptPlan, type OddRecord } from '../logic/records';
import { fmtHHmm, WEEKDAYS } from '../logic/format';
import { shownName } from '../logic/privacy';
import { setReminderTimes } from '../db/repos/visits';
import { removeDose, restoreDose } from '../db/repos/doses';
import { removeBody, restoreBody } from '../db/repos/body';
import { db } from '../db/db';
import { setSetting } from '../db/repos/settings';
import { useToast } from '../app/toast';
import { useCheckIns, useDoses, useScheduleSettings } from '../app/data';
import { useNow } from '../app/useNow';
import { personOf } from '../db/repos/people';
import { Button } from './ui/Button';
import { HeatTable } from './ui/Visual';
import { Sheet } from './ui/Sheet';

const DAY = 86_400_000;
const day = (ms: number) => format(ms, 'EEE d MMM');
const LONG = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const hours = (h: number) => { const whole = Math.floor(h); const half = h - whole >= 0.25 && h - whole < 0.75; return `${whole}${half ? '½' : ''} h`; };

// ── Medication page ─────────────────────────────────────────────────────────────────────────────────

/** When this medicine is really taken, learned reminder times, often-missed days, the effect window and script plan. */
export function HabitsSection({ med, doses, checkIns, s, now }: { med: Medication; doses: Dose[]; checkIns: CheckIn[]; s: ScheduleSettings; now: number }) {
  const toast = useToast();
  const habits = med.schedule.type === 'fixed' ? slotHabits(med, doses, now, s) : [];
  const suggestion = med.schedule.type === 'fixed' ? reminderSuggestion(med, doses, now, s) : null;
  const risky = med.schedule.type === 'fixed' ? riskySlots(med, doses, now, s) : [];
  // Focus-based, so not for injections (the same rule as Trends and the wear-off forecast).
  const win = med.peptide ? null : effectWindow(med, doses, checkIns, now);
  const script = scriptPlan(med, doses, now, s);
  const rows: React.ReactNode[] = [];
  const usual = habits.filter((h) => (h.weekday?.n ?? 0) >= 3 || (h.weekend?.n ?? 0) >= 3);
  if (usual.length) {
    rows.push(
      <li key="usual">
        <p className="font-medium">When you take it</p>
        {usual.map((h) => (
          <p key={h.slot} className="text-[15px] tnum">
            {fmtHHmm(h.slot)} dose: {[
              h.weekday && h.weekday.n >= 3 ? `weekdays usually ${fmtHHmm(shift(h.slot, h.weekday.median))} (give or take ${Math.max(5, h.weekday.spread)} min)` : null,
              h.weekend && h.weekend.n >= 3 ? `weekends ${fmtHHmm(shift(h.slot, h.weekend.median))}` : null,
            ].filter(Boolean).join(', ')}
          </p>
        ))}
        <p className="text-xs text-muted">From the last 6 weeks.</p>
      </li>,
    );
  }
  if (suggestion) {
    rows.push(
      <li key="suggest" className="space-y-2">
        <p className="font-medium">Remind you when you usually take it?</p>
        <p className="text-[15px]">{suggestion.map((x) => `Instead of ${fmtHHmm(x.slot)}: ${[x.weekday ? `${fmtHHmm(x.weekday)} on weekdays` : null, x.weekend ? `${fmtHHmm(x.weekend)} on weekends` : null].filter(Boolean).join(', ')}`).join('. ')}. The plan's times stay the same.</p>
        <Button variant="secondary" onClick={async () => {
          const before = await setReminderTimes(med.id, suggestion);
          toast('Reminders moved', { onAction: () => setReminderTimes(med.id, before) });
        }}>Use these times</Button>
      </li>,
    );
  } else if (med.reminderTimes?.length) {
    rows.push(
      <li key="learned" className="flex items-start justify-between gap-3">
        <p className="text-[15px]">Reminders at {med.reminderTimes.map((x) => [x.weekday ? `${fmtHHmm(x.weekday)} weekdays` : null, x.weekend ? `${fmtHHmm(x.weekend)} weekends` : null].filter(Boolean).join(', ')).join('; ')} (when you usually take it).</p>
        <button type="button" className="text-sm font-medium underline underline-offset-4 shrink-0 min-h-[44px]" onClick={async () => {
          const before = await setReminderTimes(med.id, undefined);
          toast('Reminders back at the set times', { onAction: () => setReminderTimes(med.id, before) });
        }}>Use set times</button>
      </li>,
    );
  }
  if (risky.length) {
    rows.push(
      <li key="risky">
        <p className="font-medium">Often missed</p>
        {risky.map((x) => <p key={`${x.weekday}${x.slot}`} className="text-[15px]">{LONG[x.weekday]} at {fmtHHmm(x.slot)}: {x.missed} of the last {x.of}. Reminders add an extra nudge then.</p>)}
      </li>,
    );
  }
  if (win) rows.push(<li key="win"><p className="font-medium">Effect window</p><p className="text-[15px]">{windowText(win)}</p><p className="text-xs text-muted">From {win.checkIns} check-ins after {win.doses} doses.</p></li>);
  if (script?.needBy) {
    rows.push(
      <li key="script">
        <p className="font-medium">New script</p>
        <p className={`text-[15px] tnum ${script.bookBy !== null && script.bookBy - now < 14 * DAY ? 'text-caution font-medium' : ''}`}>
          Needed by {day(script.needBy)}{script.reason === 'expiry' ? ' (the script expires)' : ` (${script.repeatsLeft} repeat${script.repeatsLeft === 1 ? '' : 's'} left)`}. Book your doctor by {day(script.bookBy!)}.
        </p>
        {script.lastRepeat && script.repeatsLeft === 1 && <p className="text-sm text-muted">Last repeat next</p>}
      </li>,
    );
  }
  if (!rows.length) return null;
  return (
    <section aria-labelledby="habits-h" className="border-t border-border pt-5 pb-1">
      <h2 id="habits-h" className="text-sm font-medium text-muted mb-2">Patterns</h2>
      <ul className="space-y-4">{rows}</ul>
    </section>
  );
}

/** The Patterns section with its own data, for the medication page. */
export function MedPatterns({ med }: { med: Medication }) {
  const doses = useDoses();
  const checkIns = useCheckIns();
  const ss = useScheduleSettings();
  const now = useNow(60_000);
  if (!doses || !checkIns || !ss) return null;
  const person = personOf(med);
  return <>
    <HabitsSection med={med} doses={med.shared ? doses.filter((d) => (d.personId ?? person) === person) : doses} checkIns={checkIns.filter((c) => personOf(c) === person)} s={ss[1]} now={now} />
    <DoseHeartSection med={med} />
  </>;
}

const shift = (hhmm: string, min: number) => {
  const [h, m] = hhmm.split(':').map(Number);
  const t = ((h * 60 + m + Math.round(min / 5) * 5) % 1440 + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

export function windowText(w: EffectWindow): string {
  if (w.onsetH !== undefined && w.wearOffH !== undefined) return `Usually working from about ${hours(w.onsetH)} to ${hours(w.wearOffH)} after a dose.`;
  if (w.onsetH !== undefined) return `Focus usually up from about ${hours(w.onsetH)} after a dose.`;
  return `Usually wearing off about ${hours(w.wearOffH!)} after a dose.`;
}

// ── Today ───────────────────────────────────────────────────────────────────────────────────────────

/** "Vyvanse: focus likely until about 4:30 pm" for medicines taken today with a known effect window. */
/** Records that look like mistakes, each to fix or keep (from the insight on Today). */
export function OddSheet({ odd, dismissed, onClose }: { odd: OddRecord[]; dismissed: string[]; onClose: () => void }) {
  const toast = useToast();
  const keep = (o: OddRecord) => setSetting('oddDismissed', [...dismissed, o.id].slice(-200));
  const del = async (o: OddRecord) => {
    if (o.dose) { await removeDose(o.dose.id); toast('Dose deleted', { onAction: () => restoreDose(o.dose!.id) }); }
    else if (o.body) { await removeBody(o.body.id); toast('Entry deleted', { onAction: () => restoreBody(o.body!.id) }); }
    else if (o.checkIn) { const now = new Date().toISOString(); await db.checkIns.update(o.checkIn.id, { deletedAt: now, updatedAt: now }); toast('Check-in deleted', { onAction: () => db.checkIns.update(o.checkIn!.id, { deletedAt: undefined, updatedAt: new Date().toISOString() }) }); }
    else if (o.vital) { const now = new Date().toISOString(); await db.vitals.update(o.vital.id, { deletedAt: now, updatedAt: now }); toast('Reading deleted', { onAction: () => db.vitals.update(o.vital!.id, { deletedAt: undefined, updatedAt: new Date().toISOString() }) }); }
  };
  return (
    <Sheet open onClose={onClose} title="Records to check">
      {odd.length === 0 ? <p>All checked.</p> : (
        <ul>
          {odd.map((o) => (
            <li key={o.id} className="border-t border-border py-3 space-y-2">
              <p className="font-medium">{o.title}</p>
              <p className="text-sm text-muted">{o.detail}</p>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => del(o)}>{o.kind === 'double-dose' ? 'Delete the second' : 'Delete it'}</Button>
                <Button variant="secondary" onClick={() => keep(o)}>It's right</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

// ── Trends ──────────────────────────────────────────────────────────────────────────────────────────

/** Under "How you've felt": the likely check-ins over the coming days. */
export function CheckInForecastBlock({ f }: { f: CheckInForecast }) {
  const fields = (['focus', 'mood', 'appetite'] as const).filter((k) => f.days.some((d) => d.values[k] !== undefined));
  return (
    <div className="mt-5">
      <h3 className="font-medium mb-2">The coming days</h3>
      <HeatTable columns={f.days.map((d) => format(d.start, 'EEE'))} highlight={0}
        rows={[
          ...fields.map((k) => ({ label: k[0].toUpperCase() + k.slice(1), values: f.days.map((d) => d.values[k] ?? null), fmt: (v: number) => v.toFixed(1) })),
          { label: 'Dose', values: f.days.map(() => null), text: f.days.map((d) => (d.dose ? '●' : '')) },
        ]} />
      <p className="text-xs text-muted mt-1">Likely check-ins, 1 to 5, from your usual pattern. Stronger colour is higher.</p>
    </div>
  );
}

export function EffectWindowCards({ meds, doses, checkIns, now }: { meds: Medication[]; doses: Dose[]; checkIns: CheckIn[]; now: number }) {
  const rows = meds.filter((m) => !m.peptide).map((m) => ({ m, w: effectWindow(m, doses, checkIns, now) })).filter((x) => x.w);
  if (!rows.length) return null;
  return (
    <section className="border-t border-border pt-5 pb-1" aria-labelledby="window-h">
      <h2 id="window-h" className="text-sm font-medium text-muted mb-2">Effect window</h2>
      <ul className="space-y-4">
        {rows.map(({ m, w }) => (
          <li key={m.id}>
            {rows.length > 1 && <p className="font-medium">{shownName(m)}</p>}
            <p className="text-[15px]">{windowText(w!)}</p>
            <div className="flex items-end gap-0.5 h-10 mt-2" role="img" aria-label={`Focus by hour after a dose: ${w!.byHour.filter((b) => b.focus !== undefined).map((b) => `${b.h} h ${b.focus}`).join(', ')}`}>
              {w!.byHour.map((b) => <div key={b.h} className="flex-1 rounded-[2px]" style={{ height: `${((b.focus ?? 0) / 5) * 100}%`, minHeight: b.focus ? 2 : 0, background: w!.onsetH !== undefined && b.h >= w!.onsetH && (w!.wearOffH === undefined || b.h < w!.wearOffH) ? 'var(--text)' : 'var(--border-strong)' }} />)}
            </div>
            <div className="flex justify-between text-xs text-muted mt-1" aria-hidden="true"><span>dose</span><span>6 h</span><span>12 h</span></div>
            <p className="text-xs text-muted">Focus by hours after a dose, from {w!.checkIns} check-ins.</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export const weekdayName = (wd: number) => WEEKDAYS[wd];


