// Smart features shared by both apps: learned reminder times and missed-slot patterns (medication page), the effect
// window and script planning (Today and the medication page), odd records (Today), and sleep impact and the coming
// days' check-in forecast (Trends). Each one shows what it rests on.
import { useState } from 'react';
import { format } from 'date-fns';
import type { CheckIn, Dose, Medication, Vital, BodyEntry } from '../db/schema';
import type { ScheduleSettings } from '../logic/schedule';
import {
  effectWindow, reminderSuggestion, riskySlots, slotHabits, type CheckInForecast, type EffectWindow, type SleepImpact,
} from '../logic/habits';
import { oddRecords, scriptPlan, type OddRecord } from '../logic/records';
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
import { Sheet } from './ui/Sheet';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const day = (ms: number) => format(ms, 'EEE d MMM');
const LONG = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const hours = (h: number) => { const whole = Math.floor(h); const half = h - whole >= 0.25 && h - whole < 0.75; return `${whole}${half ? '½' : ''} h`; };
/** An estimated time, to the nearest quarter hour. */
const clock = (ms: number) => format(Math.round(ms / 900_000) * 900_000, 'h:mm a').toLowerCase();

// ── Medication page ─────────────────────────────────────────────────────────────────────────────────

/** When this medicine is really taken, learned reminder times, often-missed days, the effect window and script plan. */
export function HabitsSection({ med, doses, checkIns, s, now }: { med: Medication; doses: Dose[]; checkIns: CheckIn[]; s: ScheduleSettings; now: number }) {
  const toast = useToast();
  const habits = med.schedule.type === 'fixed' ? slotHabits(med, doses, now, s) : [];
  const suggestion = med.schedule.type === 'fixed' ? reminderSuggestion(med, doses, now, s) : null;
  const risky = med.schedule.type === 'fixed' ? riskySlots(med, doses, now, s) : [];
  const win = effectWindow(med, doses, checkIns, now);
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
  if (win) rows.push(<li key="win"><p className="font-medium">Effect window</p><p className="text-[15px]">{windowText(win)}</p><p className="text-xs text-muted">From {win.checkIns} check-ins after {win.doses} doses. Your own pattern, not a measurement.</p></li>);
  if (script?.needBy) {
    rows.push(
      <li key="script">
        <p className="font-medium">New script</p>
        <p className={`text-[15px] tnum ${script.bookBy !== null && script.bookBy - now < 14 * DAY ? 'text-caution font-medium' : ''}`}>
          Needed by {day(script.needBy)}{script.reason === 'expiry' ? ' (the script expires)' : ` (${script.repeatsLeft} repeat${script.repeatsLeft === 1 ? '' : 's'} left)`}. Book your doctor by {day(script.bookBy!)}.
        </p>
        {script.lastRepeat && script.repeatsLeft === 1 && <p className="text-sm text-muted">The next refill is the last repeat.</p>}
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
  return <HabitsSection med={med} doses={med.shared ? doses.filter((d) => (d.personId ?? person) === person) : doses} checkIns={checkIns.filter((c) => personOf(c) === person)} s={ss[1]} now={now} />;
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
export function EffectToday({ meds, doses, checkIns, now }: { meds: Medication[]; doses: Dose[]; checkIns: CheckIn[]; now: number }) {
  const lines = meds.filter((m) => !m.archived && !m.peptide).map((m) => {
    const last = doses.filter((d) => d.medicationId === m.id && !d.deletedAt && !d.skipped && Date.parse(d.takenAt) <= now).sort((a, b) => b.takenAt.localeCompare(a.takenAt))[0];
    if (!last) return null;
    const t = Date.parse(last.takenAt);
    if (now - t > 14 * HOUR) return null;
    const w = effectWindow(m, doses, checkIns, now);
    if (!w || w.wearOffH === undefined) return null;
    const off = t + w.wearOffH * HOUR;
    const on = w.onsetH !== undefined ? t + w.onsetH * HOUR : undefined;
    if (off < now) return { m, text: `usually wearing off since about ${clock(off)}` };
    return { m, text: on && on > now ? `usually working from about ${clock(on)} until ${clock(off)}` : `focus likely until about ${clock(off)}` };
  }).filter(Boolean) as { m: Medication; text: string }[];
  if (!lines.length) return null;
  return (
    <ul className="space-y-1" aria-label="Effect window">
      {lines.map(({ m, text }) => <li key={m.id} className="text-[15px]"><span className="font-medium">{shownName(m)}</span>: {text}</li>)}
    </ul>
  );
}

/** "Book a doctor for a new Vyvanse script by Mon 14 Sep" when that's within 3 weeks. */
export function ScriptToday({ meds, doses, s, now }: { meds: Medication[]; doses: Dose[]; s: ScheduleSettings; now: number }) {
  const due = meds.map((m) => ({ m, p: scriptPlan(m, doses, now, s) })).filter((x) => x.p?.bookBy != null && x.p.bookBy - now < 21 * DAY);
  if (!due.length) return null;
  return (
    <ul className="space-y-1" aria-label="Scripts">
      {due.map(({ m, p }) => (
        <li key={m.id} className="relative pl-5 text-[15px] tnum">
          <span aria-hidden="true" className="absolute left-0 top-[9px] w-2 h-2 rounded-full" style={{ background: 'var(--caution)' }} />
          <a href={`#/meds/${m.id}`}>
            Book a doctor {p!.bookBy! < now ? 'soon' : `by ${day(p!.bookBy!)}`} for a new <span className="font-medium">{shownName(m)}</span> script (needed {day(p!.needBy!)}{p!.reason === 'expiry' ? ', when it expires' : ''}).
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Records that look like mistakes, with a sheet to fix or keep each. */
export function OddRecordsLine({ meds, doses, body, checkIns, vitals, dismissed, now }: {
  meds: Medication[]; doses: Dose[]; body: BodyEntry[]; checkIns: CheckIn[]; vitals: Vital[]; dismissed: string[]; now: number;
}) {
  const [open, setOpen] = useState(false);
  const odd = oddRecords(meds, doses, body, checkIns, vitals, now, dismissed);
  if (!odd.length && !open) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="w-full text-left relative pl-5 text-[15px] min-h-[44px]">
        <span aria-hidden="true" className="absolute left-0 top-[9px] w-2 h-2 rounded-full" style={{ background: 'var(--caution)' }} />
        {odd.length} record{odd.length === 1 ? '' : 's'} look{odd.length === 1 ? 's' : ''} odd. <span className="underline underline-offset-4 font-medium">Check</span>
      </button>
      {open && <OddSheet odd={odd} dismissed={dismissed} onClose={() => setOpen(false)} />}
    </>
  );
}

function OddSheet({ odd, dismissed, onClose }: { odd: OddRecord[]; dismissed: string[]; onClose: () => void }) {
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

export function SleepImpactCard({ r }: { r: SleepImpact }) {
  const t = format(new Date(2026, 0, 1, r.cutoffHour), 'h a').toLowerCase();
  const line = (x: SleepImpact['before']) => [x.quality !== undefined ? `sleep rated ${x.quality} of 5` : null, x.hours !== undefined ? `${x.hours} hours` : null].filter(Boolean).join(', ');
  return (
    <section className="border-t border-border pt-5 pb-1" aria-labelledby="sleep-h">
      <h2 id="sleep-h" className="text-sm font-medium text-muted mb-1">Last dose and sleep</h2>
      <p className="text-[17px]">When your last dose is after about <span className="font-medium">{t}</span>, your sleep is usually worse.</p>
      <p className="text-[15px] tnum mt-1">Before {t}: {line(r.before)} ({r.before.nights} nights). After: {line(r.after)} ({r.after.nights} nights).</p>
      <p className="text-xs text-muted mt-1">The day's last dose time against the next morning's check-in. A link in your records, not a cause; ask your prescriber about timing.</p>
    </section>
  );
}

export function CheckInForecastCard({ f }: { f: CheckInForecast }) {
  const fields = (['focus', 'mood', 'appetite'] as const).filter((k) => f.days.some((d) => d.values[k] !== undefined));
  return (
    <section className="border-t border-border pt-5 pb-1" aria-labelledby="ciforecast-h">
      <h2 id="ciforecast-h" className="text-sm font-medium text-muted mb-2">The coming days</h2>
      <div className="table-scroll">
        <table className="w-full text-sm tnum">
          <thead><tr className="text-left"><th className="py-1 pr-3 font-medium" />{f.days.map((d) => <th key={d.start} className="py-1 px-1 font-medium text-center">{format(d.start, 'EEE')}</th>)}</tr></thead>
          <tbody>
            {fields.map((k) => (
              <tr key={k} className="border-t border-border">
                <td className="py-1.5 pr-3 capitalize text-muted">{k}</td>
                {f.days.map((d) => <td key={d.start} className="py-1.5 px-1 text-center">{d.values[k]?.toFixed(1) ?? '–'}</td>)}
              </tr>
            ))}
            <tr className="border-t border-border"><td className="py-1.5 pr-3 text-muted">Dose</td>{f.days.map((d) => <td key={d.start} className="py-1.5 px-1 text-center">{d.dose ? '•' : ''}</td>)}</tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted mt-1">Likely scores (1–5) from your usual day of the week, days with and without doses, and the last 2 weeks. Based on {f.checkIns} check-ins over {f.weeks} weeks.</p>
    </section>
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
            <p className="font-medium">{shownName(m)}</p>
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
