// Appointments, questions to bring, the one-page "since my last appointment" summary, and lab results (both apps).
import { useState } from 'react';
import { format } from 'date-fns';
import { Printer, Trash2 } from 'lucide-react';
import type { LabResult } from '../db/schema';
import {
  useAppointments, useBodyEntries, useCheckIns, useDoses, useFamily, useLabs, useMedEvents, useMeds, useQuestions, useScheduleSettings, useVitals,
} from '../app/data';
import { dosesForPerson, medIsFor, personOf } from '../db/repos/people';
import { addAppointment, addLabs, addQuestion, removeAppointment, removeLabs, removeQuestion, restoreAppointment, restoreLabs, restoreQuestion, setQuestionDone } from '../db/repos/visits';
import { appointmentsAround, summarySince, type Compare } from '../logic/appointments';
import { parseLabResults, type LabLine } from '../logic/records';
import { dayKey } from '../logic/stats';
import { kgTo, weightUnit } from '../logic/units';
import { HAS_BODY } from '../edition';
import { APP_NAME } from '../config';
import { printPage } from '../app/print';
import { useNow } from '../app/useNow';
import { useToast } from '../app/toast';
import { PersonSwitcher } from '../components/PersonSwitcher';
import { PhotoReader } from '../components/PhotoReader';
import { Button } from '../components/ui/Button';
import { TextInput } from '../components/ui/Field';
import { Sheet, SheetActions } from '../components/ui/Sheet';
import { fmtYmdDay } from '../logic/format';

const ymd = (x: string) => fmtYmdDay(x);
const Loading = () => <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;

// ── Appointments and questions ──────────────────────────────────────────────────────────────────────

export function Appointments() {
  const appts = useAppointments();
  const questions = useQuestions();
  const fam = useFamily();
  const ss = useScheduleSettings();
  const now = useNow(60_000);
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  if (!appts || !questions || !fam || !ss) return <Loading />;
  const mine = <T extends { personId?: string; deletedAt?: string }>(r: T) => personOf(r) === fam.personId && !r.deletedAt;
  const list = appts.filter(mine).sort((a, b) => b.date.localeCompare(a.date));
  const { last, next } = appointmentsAround(list, dayKey(now, ss[1]));
  const qs = questions.filter(mine).sort((a, b) => Number(!!a.done) - Number(!!b.done) || b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="space-y-2">
      <PersonSwitcher />
      <section className="border-t border-border pt-5 pb-3 space-y-3">
        <h2 className="text-sm font-medium text-muted">Since your last appointment</h2>
        {last ? (
          <>
            <p className="text-[17px]">{ymd(last.date)}{last.with ? ` with ${last.with}` : ''}{next ? `. Next: ${ymd(next.date)}${next.with ? ` with ${next.with}` : ''}` : ''}.</p>
            <a href="#/appointments/summary" className="inline-flex items-center min-h-[48px] px-5 rounded-btn bg-text text-bg font-medium">One-page summary</a>
          </>
        ) : <p className="text-[15px] text-muted">Add your last appointment to see what's changed since</p>}
      </section>

      <section className="border-t border-border pt-5 pb-3" aria-labelledby="q-h">
        <h2 id="q-h" className="text-sm font-medium text-muted">Questions to ask</h2>
        <form className="flex gap-2 mt-2" onSubmit={async (e) => { e.preventDefault(); if (!q.trim()) return; await addQuestion(q, fam.personId); setQ(''); }}>
          <input aria-label="New question" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Can I take it later on weekends?"
            className="flex-1 min-h-[48px] rounded-btn border border-border-strong bg-transparent px-3.5" />
          <Button type="submit" variant="secondary" disabled={!q.trim()}>Add</Button>
        </form>
        <ul className="mt-2">
          {qs.map((x) => (
            <li key={x.id} className="flex items-center gap-3 border-t border-border py-2">
              <input type="checkbox" checked={!!x.done} onChange={(e) => setQuestionDone(x.id, e.target.checked)} aria-label={`Asked: ${x.text}`} className="w-5 h-5 accent-[var(--primary)]" />
              <span className={`flex-1 ${x.done ? 'line-through text-muted' : ''}`}>{x.text}</span>
              <button type="button" aria-label={`Delete question: ${x.text}`} className="w-11 h-11 flex items-center justify-center text-muted" onClick={async () => { await removeQuestion(x.id); toast('Question deleted', { onAction: () => restoreQuestion(x.id) }); }}><Trash2 size={18} aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-t border-border pt-5 pb-3" aria-labelledby="a-h">
        <div className="flex items-baseline justify-between">
          <h2 id="a-h" className="text-sm font-medium text-muted">Appointments</h2>
          <button type="button" className="text-sm font-medium underline underline-offset-4 min-h-[44px]" onClick={() => setAdding(true)}>Add</button>
        </div>
        {list.length === 0 && <p className="text-[15px] text-muted mt-1">None yet.</p>}
        <ul>
          {list.map((a) => (
            <li key={a.id} className="flex items-center gap-3 border-t border-border py-2">
              <span className="flex-1"><span className="block">{ymd(a.date)}{a.with ? ` · ${a.with}` : ''}</span>{a.note && <span className="block text-sm text-muted">{a.note}</span>}</span>
              <button type="button" aria-label={`Delete appointment ${a.date}`} className="w-11 h-11 flex items-center justify-center text-muted" onClick={async () => { await removeAppointment(a.id); toast('Appointment deleted', { onAction: () => restoreAppointment(a.id) }); }}><Trash2 size={18} aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      </section>
      <a href="#/labs" className="border-t border-border flex items-center justify-between min-h-[64px] text-[17px] font-medium">Lab results<span className="text-sm font-normal text-muted">Blood tests and others</span></a>
      {adding && <AddAppointmentSheet personId={fam.personId} today={dayKey(now, ss[1])} onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddAppointmentSheet({ personId, today, onClose }: { personId: string; today: string; onClose: () => void }) {
  const [date, setDate] = useState(today);
  const [withWho, setWith] = useState('');
  const [note, setNote] = useState('');
  return (
    <Sheet open onClose={onClose} title="Add an appointment">
      <div className="space-y-4">
        <TextInput label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <TextInput label="With (optional)" value={withWho} onChange={(e) => setWith(e.target.value)} placeholder="e.g. Dr Lee" />
        <TextInput label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Dose went up to 50 mg" />
        <SheetActions><Button className="w-full min-h-[56px]" disabled={!date} onClick={async () => { await addAppointment(date, personId, withWho, note); onClose(); }}>Add</Button></SheetActions>
      </div>
    </Sheet>
  );
}

// ── One-page summary ────────────────────────────────────────────────────────────────────────────────

export function AppointmentSummary() {
  const meds = useMeds(); const doses = useDoses(); const checkIns = useCheckIns(); const body = useBodyEntries(); const vitals = useVitals();
  const events = useMedEvents(); const labs = useLabs(); const questions = useQuestions(); const appts = useAppointments();
  const fam = useFamily(); const ss = useScheduleSettings(); const now = useNow(60_000);
  if (!meds || !doses || !checkIns || !body || !vitals || !events || !labs || !questions || !appts || !fam || !ss) return <Loading />;
  const [settings, s] = ss;
  const mine = <T extends { personId?: string }>(r: T) => personOf(r) === fam.personId;
  const myMeds = meds.filter((m) => medIsFor(m, fam.personId));
  const ids = new Set(myMeds.map((m) => m.id));
  const { last } = appointmentsAround(appts.filter(mine), dayKey(now, s));
  const from = last?.date ?? format(now - 30 * 86_400_000, 'yyyy-MM-dd');
  const sum = summarySince(from, now, s, {
    meds: myMeds, doses: dosesForPerson(doses.filter((d) => ids.has(d.medicationId)), myMeds, fam.personId), checkIns: checkIns.filter(mine),
    body: HAS_BODY ? body.filter(mine) : [], vitals: vitals.filter(mine), events: events.filter((e) => ids.has(e.medicationId)), labs: labs.filter(mine), questions: questions.filter(mine),
  });
  const cmp = (label: string, c: Compare, unit = '') => (c.since === undefined && c.before === undefined ? null
    : <tr key={label} className="border-t border-border"><td className="py-1.5 pr-3">{label}</td><td className="py-1.5 pr-3 tnum">{c.since ?? '–'}{unit}</td><td className="py-1.5 tnum text-muted">{c.before ?? '–'}{unit}</td></tr>);
  return (
    <div className="space-y-4 report">
      <div className="no-print space-y-2">
        <PersonSwitcher />
        <Button className="w-full min-h-[56px] flex items-center justify-center gap-2" onClick={() => printPage(`${APP_NAME} appointment summary`)}><Printer size={20} aria-hidden="true" /> Print / Save as PDF</Button>
      </div>
      <header className="border-t border-border pt-5">
        <h2 className="text-2xl font-medium">{fam.many ? `${fam.person}: s` : 'S'}ince {last ? `the appointment on ${ymd(last.date)}` : 'the last 30 days'}</h2>
        <p className="text-muted tnum">{sum.days} days, compared with the {sum.days} days before · made {format(now, 'd MMM yyyy')}</p>
      </header>
      <section className="report-block">
        <h3 className="text-sm font-medium text-muted mb-1">Medications</h3>
        <ul className="space-y-2">
          {sum.meds.map((x) => (
            <li key={x.med.id}>
              <p className="font-medium">{x.med.name}</p>
              <p className="text-[15px] tnum">{x.med.schedule.type === 'prn' ? `${x.taken} dose${x.taken === 1 ? '' : 's'} as needed` : `${x.taken} of ${x.planned} planned doses${x.pct !== undefined ? ` (${x.pct}%${x.pctBefore !== undefined ? `; ${x.pctBefore}% before` : ''})` : ''}`}</p>
              {x.changes.map((c) => <p key={c} className="text-sm text-muted">{c}</p>)}
            </li>
          ))}
        </ul>
      </section>
      {sum.checkIns.n > 0 && (
        <section className="report-block">
          <h3 className="text-sm font-medium text-muted mb-1">Check-ins ({sum.checkIns.n})</h3>
          <table className="w-full text-[15px]"><thead><tr className="text-left text-sm text-muted"><th className="font-medium py-1">Average</th><th className="font-medium py-1">Since</th><th className="font-medium py-1">Before</th></tr></thead>
            <tbody>{[cmp('Mood', sum.checkIns.mood), cmp('Focus', sum.checkIns.focus), cmp('Energy', sum.checkIns.energy), cmp('Appetite', sum.checkIns.appetite), cmp('Sleep', sum.checkIns.sleepHours, ' h'), cmp('Sleep quality', sum.checkIns.sleepQuality)]}</tbody></table>
          {sum.chips.length > 0 && <p className="text-[15px] mt-2">Noted: {sum.chips.map((c) => `${c.chip} ${c.since}× (before ${c.before}×)`).join(', ')}</p>}
        </section>
      )}
      {(sum.weight || sum.bp) && (
        <section className="report-block">
          <h3 className="text-sm font-medium text-muted mb-1">Body</h3>
          {sum.weight?.change !== undefined && <p className="text-[15px] tnum">Weight {kgTo(sum.weight.first!, settings.units)} → {kgTo(sum.weight.last!, settings.units)} {weightUnit(settings.units)}{sum.weight.perWeek !== undefined ? ` (${sum.weight.perWeek > 0 ? '+' : ''}${kgTo(sum.weight.perWeek, settings.units)} a week)` : ''}</p>}
          {sum.bp?.since && <p className="text-[15px] tnum">Blood pressure average {sum.bp.since.sys}/{sum.bp.since.dia} ({sum.bp.since.n} readings){sum.bp.before ? `; before ${sum.bp.before.sys}/${sum.bp.before.dia}` : ''}</p>}
        </section>
      )}
      {sum.labs.length > 0 && (
        <section className="report-block">
          <h3 className="text-sm font-medium text-muted mb-1">Lab results</h3>
          <ul className="text-[15px] tnum">{sum.labs.map((l) => <li key={l.id}>{format(new Date(`${l.date}T12:00`), 'd MMM')}: {l.name} {l.value}{l.unit ? ` ${l.unit}` : ''}{l.range ? ` (range ${l.range})` : ''}</li>)}</ul>
        </section>
      )}
      <section className="report-block">
        <h3 className="text-sm font-medium text-muted mb-1">Questions</h3>
        {sum.questions.length ? <ol className="list-decimal pl-5 text-[15px] space-y-1">{sum.questions.map((q) => <li key={q.id}>{q.text}</li>)}</ol> : <p className="text-[15px] text-muted no-print">Add questions on the Appointments page.</p>}
      </section>
      <p className="text-xs text-muted">What was recorded, side by side. It doesn't show cause.</p>
    </div>
  );
}

// ── Lab results ─────────────────────────────────────────────────────────────────────────────────────

export function Labs() {
  const labs = useLabs();
  const fam = useFamily();
  const toast = useToast();
  const [adding, setAdding] = useState<{ date?: string; rows: LabLine[] } | null>(null);
  if (!labs || !fam) return <Loading />;
  const mine = labs.filter((l) => personOf(l) === fam.personId && !l.deletedAt).sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  const byName = new Map<string, LabResult[]>();
  for (const l of mine) byName.set(l.name, [...(byName.get(l.name) ?? []), l]);
  return (
    <div className="space-y-2">
      <PersonSwitcher />
      <section className="border-t border-border pt-5 pb-3 space-y-3">
        <PhotoReader what="the printout" onText={(text) => {
          const r = parseLabResults(text);
          if (!r.results.length) toast("Couldn't find results on it. Add them by hand.");
          setAdding({ date: r.date, rows: r.results });
        }} />
        <Button variant="secondary" className="w-full" onClick={() => setAdding({ rows: [{ name: '', value: NaN }] })}>Add by hand</Button>
      </section>
      {byName.size === 0 && <p className="border-t border-border pt-5 text-muted">No results yet. They show on the appointment summary and the doctor report.</p>}
      {[...byName].map(([name, rows]) => (
        <section key={name} className="border-t border-border py-3">
          <p className="font-medium">{name}</p>
          <ul>
            {rows.map((l) => (
              <li key={l.id} className="flex items-center gap-3">
                <span className="flex-1 text-[15px] tnum">{format(new Date(`${l.date}T12:00`), 'd MMM yyyy')}: {l.value}{l.unit ? ` ${l.unit}` : ''}{l.range ? <span className="text-muted"> (range {l.range})</span> : null}</span>
                <button type="button" aria-label={`Delete ${l.name} ${l.date}`} className="w-11 h-11 flex items-center justify-center text-muted" onClick={async () => { await removeLabs([l.id]); toast('Result deleted', { onAction: () => restoreLabs([l.id]) }); }}><Trash2 size={18} aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {adding && <LabSheet initial={adding} personId={fam.personId} onClose={() => setAdding(null)} />}
    </div>
  );
}

function LabSheet({ initial, personId, onClose }: { initial: { date?: string; rows: LabLine[] }; personId: string; onClose: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState(initial.date ?? format(Date.now(), 'yyyy-MM-dd'));
  const [rows, setRows] = useState(initial.rows.map((r) => ({ name: r.name, value: Number.isFinite(r.value) ? String(r.value) : '', unit: r.unit ?? '', range: r.range ?? '' })));
  const set = (i: number, k: keyof (typeof rows)[number], v: string) => setRows((p) => p.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const valid = rows.filter((r) => r.name.trim() && Number.isFinite(Number(r.value)) && r.value !== '');
  return (
    <Sheet open onClose={onClose} title="Lab results">
      <div className="space-y-4">
        <TextInput label="Date of the test" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        {rows.map((r, i) => (
          <fieldset key={i} className="border-t border-border pt-3 space-y-2">
            <legend className="sr-only">Result {i + 1}</legend>
            <TextInput label="Test" value={r.name} onChange={(e) => set(i, 'name', e.target.value)} placeholder="e.g. HbA1c" />
            <div className="grid grid-cols-3 gap-2">
              <TextInput label="Result" inputMode="decimal" value={r.value} onChange={(e) => set(i, 'value', e.target.value)} />
              <TextInput label="Unit" value={r.unit} onChange={(e) => set(i, 'unit', e.target.value)} />
              <TextInput label="Range" value={r.range} onChange={(e) => set(i, 'range', e.target.value)} />
            </div>
            <button type="button" className="text-sm text-muted underline underline-offset-4 min-h-[44px]" onClick={() => setRows((p) => p.filter((_, j) => j !== i))}>Remove</button>
          </fieldset>
        ))}
        <Button variant="secondary" onClick={() => setRows((p) => [...p, { name: '', value: '', unit: '', range: '' }])}>Add another</Button>
        <p className="text-xs text-muted">Check each result against the printout.</p>
        <SheetActions>
          <Button className="w-full min-h-[56px]" disabled={!valid.length || !date} onClick={async () => {
            const ids = await addLabs(valid.map((r) => ({ date, name: r.name.trim(), value: Number(r.value), unit: r.unit.trim() || undefined, range: r.range.trim() || undefined })), personId);
            toast(`Saved ${ids.length} result${ids.length === 1 ? '' : 's'}`, { onAction: () => removeLabs(ids) });
            onClose();
          }}>Save {valid.length || ''} result{valid.length === 1 ? '' : 's'}</Button>
        </SheetActions>
      </div>
    </Sheet>
  );
}

