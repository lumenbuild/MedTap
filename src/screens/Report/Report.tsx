import { useState } from 'react';
import { format } from 'date-fns';
import { Printer } from 'lucide-react';
import { useBodyEntries, useCheckIns, useDoses, useMedEvents, useMeds, useScheduleSettings } from '../../app/data';
import { APP_NAME } from '../../config';
import { fmtAmount, fmtMedName, fmtSchedule } from '../../logic/format';
import { adherenceByDay, average, daysBetween } from '../../logic/stats';
import { getDailyTarget } from '../../logic/schedule';
import { fmtWeight } from '../../logic/units';
import { Button } from '../../components/ui/Button';
import { AdherenceHeatmap, DoseTimingCharts, FeelingsChart, WeightChart } from '../../components/charts/Charts';

const ymd = (ms: number) => format(ms, 'yyyy-MM-dd');
const SOURCE: Record<string, string> = { tag: 'Tag', manual: 'In app', backdated: 'Logged later' };

/** A print-friendly summary for a chosen date range. Print / Save as PDF uses the browser's print dialog. */
export function Report() {
  const meds = useMeds();
  const doses = useDoses();
  const checkIns = useCheckIns();
  const body = useBodyEntries();
  const events = useMedEvents();
  const ss = useScheduleSettings();
  const [from, setFrom] = useState(ymd(Date.now() - 29 * 86_400_000));
  const [to, setTo] = useState(ymd(Date.now()));

  if (!meds || !doses || !checkIns || !body || !events || !ss) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const [settings, s] = ss;
  const start = new Date(`${from}T00:00`).getTime();
  const end = Math.min(new Date(`${to}T23:59:59`).getTime(), Date.now());
  const inRange = (iso: string) => { const t = Date.parse(iso); return t >= start && t <= end; };
  const rangeDoses = doses.filter((d) => !d.deletedAt && inRange(d.takenAt)).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  const usedMeds = meds.filter((m) => !m.archived || rangeDoses.some((d) => d.medicationId === m.id));
  const medById = new Map(meds.map((m) => [m.id, m]));
  const days = daysBetween(start, end, s);
  const rangeEvents = events.filter((e) => inRange(e.at)).sort((a, b) => a.at.localeCompare(b.at));
  const weights = body.filter((b) => !b.deletedAt && b.weightKg !== undefined && b.date >= from && b.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  const avg = (f: 'mood' | 'energy' | 'focus' | 'appetite') => { const v = average(checkIns, f, start, end); return v === null ? '–' : v.toFixed(1); };
  const nCheckIns = checkIns.filter((c) => !c.deletedAt && inRange(c.at)).length;
  const valid = from <= to;

  return (
    <div className="space-y-4 report">
      <div className="no-print bg-surface rounded-card shadow-card p-5 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1"><span className="block text-sm font-medium">From</span>
            <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="w-full min-h-[48px] rounded-btn bg-surface-2 border border-border px-3 tnum" /></label>
          <label className="block space-y-1"><span className="block text-sm font-medium">To</span>
            <input type="date" value={to} max={ymd(Date.now())} onChange={(e) => e.target.value && setTo(e.target.value)} className="w-full min-h-[48px] rounded-btn bg-surface-2 border border-border px-3 tnum" /></label>
        </div>
        {!valid && <p className="text-sm text-danger" role="alert">The start date is after the end date.</p>}
        <Button className="w-full min-h-[56px] flex items-center justify-center gap-2" onClick={() => window.print()} disabled={!valid}>
          <Printer size={20} aria-hidden="true" /> Print / Save as PDF
        </Button>
        <p className="text-sm text-muted">In the print dialog, choose “Save as PDF” to get a file you can email or bring to an appointment.</p>
      </div>

      {valid && (
        <>
          <header className="bg-surface rounded-card shadow-card p-5 report-block">
            <h1 className="text-2xl font-semibold">Medication and wellbeing record</h1>
            <p className="text-muted tnum">{format(start, 'd MMM yyyy')} – {format(end, 'd MMM yyyy')} · {days.length} days</p>
          </header>

          <section className="bg-surface rounded-card shadow-card p-5 report-block">
            <h2 className="text-lg font-semibold mb-2">Medications</h2>
            <table className="w-full text-sm">
              <thead><tr className="text-left">{['Medication', 'Form', 'Usual dose', 'Schedule (as entered)', 'Doses logged', 'Days at daily number'].map((h) => <th key={h} className="py-1.5 pr-3 border-b border-border font-semibold">{h}</th>)}</tr></thead>
              <tbody>
                {usedMeds.map((m) => {
                  const target = getDailyTarget(m);
                  const ad = adherenceByDay(doses, m, days, s);
                  return (
                    <tr key={m.id} className="tnum">
                      <td className="py-1.5 pr-3 border-b border-border">{fmtMedName(m)}{m.archived ? ' (stopped)' : ''}</td>
                      <td className="py-1.5 pr-3 border-b border-border">{m.form}</td>
                      <td className="py-1.5 pr-3 border-b border-border">{fmtAmount(m.defaultAmount, m.unit)}</td>
                      <td className="py-1.5 pr-3 border-b border-border">{fmtSchedule(m.schedule, m.unit)}</td>
                      <td className="py-1.5 pr-3 border-b border-border">
                        {rangeDoses.filter((d) => d.medicationId === m.id && !d.skipped).length}
                        {rangeDoses.some((d) => d.medicationId === m.id && d.skipped) ? ` (+${rangeDoses.filter((d) => d.medicationId === m.id && d.skipped).length} skipped)` : ''}
                      </td>
                      <td className="py-1.5 pr-3 border-b border-border">{target ? `${ad.filter((d) => d.target && d.count >= d.target).length} of ${ad.filter((d) => d.target).length} scheduled` : '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {usedMeds.some((m) => m.instructions?.trim()) && (
              <>
                <h3 className="font-semibold mt-4 mb-1">Instructions</h3>
                <ul className="text-sm space-y-1">
                  {usedMeds.filter((m) => m.instructions?.trim()).map((m) => (
                    <li key={m.id}><strong>{m.name}:</strong> <span className="whitespace-pre-line">{m.instructions!.trim()}</span>{m.instructionsBy ? <span className="text-muted"> (from {m.instructionsBy})</span> : null}</li>
                  ))}
                </ul>
              </>
            )}
            {rangeEvents.length > 0 && (
              <>
                <h3 className="font-semibold mt-4 mb-1">Changes recorded</h3>
                <ul className="text-sm space-y-0.5">
                  {rangeEvents.map((e) => <li key={e.id} className="tnum">{format(Date.parse(e.at), 'd MMM yyyy')}: {e.kind === 'changed' ? `${medById.get(e.medicationId)?.name ?? ''}: ` : ''}{e.summary}</li>)}
                </ul>
              </>
            )}
          </section>

          <section className="bg-surface rounded-card shadow-card p-5 report-block">
            <h2 className="text-lg font-semibold mb-2">Check-ins and body</h2>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm tnum">
              <div><dt className="text-muted">Check-ins</dt><dd className="font-semibold">{nCheckIns}</dd></div>
              <div><dt className="text-muted">Average mood (1–5)</dt><dd className="font-semibold">{avg('mood')}</dd></div>
              <div><dt className="text-muted">Average energy</dt><dd className="font-semibold">{avg('energy')}</dd></div>
              <div><dt className="text-muted">Average focus</dt><dd className="font-semibold">{avg('focus')}</dd></div>
              <div><dt className="text-muted">Average appetite</dt><dd className="font-semibold">{avg('appetite')}</dd></div>
              <div><dt className="text-muted">Weight</dt><dd className="font-semibold">{weights.length ? `${fmtWeight(weights[0].weightKg!, settings.units)} → ${fmtWeight(weights[weights.length - 1].weightKg!, settings.units)}` : '–'}</dd></div>
            </dl>
          </section>

          <div className="report-block"><AdherenceHeatmap meds={usedMeds} doses={doses} start={start} end={end} s={s} /></div>
          <div className="report-block"><DoseTimingCharts meds={usedMeds} doses={doses} start={start} end={end} s={s} /></div>
          <div className="report-block"><FeelingsChart checkIns={checkIns} events={events} meds={meds} start={start} end={end} s={s} prevStart={null} /></div>
          <div className="report-block"><WeightChart entries={body} units={settings.units} start={start} end={end} s={s} /></div>

          <section className="bg-surface rounded-card shadow-card p-5 report-block">
            <h2 className="text-lg font-semibold mb-2">Dose log</h2>
            {rangeDoses.length === 0 ? <p className="text-muted">No doses in this range.</p> : (
              <table className="w-full text-sm tnum">
                <thead><tr className="text-left">{['Date', 'Time', 'Medication', 'Amount', 'How logged'].map((h) => <th key={h} className="py-1 pr-3 border-b border-border font-semibold">{h}</th>)}</tr></thead>
                <tbody>
                  {rangeDoses.map((d) => {
                    const m = medById.get(d.medicationId);
                    return (
                      <tr key={d.id}>
                        <td className="py-1 pr-3 border-b border-border">{format(Date.parse(d.takenAt), 'EEE d MMM')}</td>
                        <td className="py-1 pr-3 border-b border-border">{format(Date.parse(d.takenAt), 'h:mm a').toLowerCase()}</td>
                        <td className="py-1 pr-3 border-b border-border">{m?.name ?? '–'}</td>
                        <td className="py-1 pr-3 border-b border-border">{d.skipped ? '–' : m ? fmtAmount(d.amount, m.unit) : d.amount}</td>
                        <td className="py-1 pr-3 border-b border-border">{d.skipped ? `Skipped${d.skipReason ? ` (${d.skipReason})` : ''}` : SOURCE[d.source]}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <footer className="text-sm text-muted text-center py-2">
            Generated by {APP_NAME} from self-recorded data on {format(Date.now(), 'd MMM yyyy')}. Schedules are as entered by the person, from their prescription.
          </footer>
        </>
      )}
    </div>
  );
}
