// Trends cards for days on and off a medicine, caffeine and alcohol, the cycle, steps against weight, and heart rate
// after a dose. Each says what it rests on; links in the person's records, not causes.
import { format } from 'date-fns';
import type { CheckIn, DailyHealth, Dose, Medication, Vital, BodyEntry } from '../db/schema';
import type { ScheduleSettings } from '../logic/schedule';
import type { Units } from '../db/repos/settings';
import { heartAfterDose, onOffDays, stepsVsWeight, substanceFindings, type Side } from '../logic/lifestyle';
import { shownName } from '../logic/privacy';
import { kgTo, weightUnit } from '../logic/units';
import { CompareBars } from './ui/Visual';

const Section = ({ id, title, children }: { id: string; title: string; children: React.ReactNode }) => (
  <section className="border-t border-border pt-5 pb-1" aria-labelledby={id}>
    <h2 id={id} className="text-sm font-medium text-muted mb-2">{title}</h2>
    {children}
  </section>
);
const one = (v: number) => String(Math.round(v * 10) / 10);
type Row = { label: string; a: number | null; b: number | null; fmt: (v: number) => string };
const row = (label: string, a: number | undefined, b: number | undefined, fmt: (v: number) => string = one): Row => ({ label, a: a ?? null, b: b ?? null, fmt });
/** Side by side as bars; measures with nothing on either side are left out. */
const Compare = ({ a, b, rows }: { a: string; b: string; rows: Row[] }) => <CompareBars a={a} b={b} rows={rows.filter((r) => r.a !== null || r.b !== null)} />;
const sideRows = (a: Side, b: Side): Row[] => [
  row('Focus', a.focus, b.focus), row('Mood', a.mood, b.mood), row('Energy', a.energy, b.energy), row('Appetite', a.appetite, b.appetite),
  row('Sleep', a.sleepHours, b.sleepHours, (v) => `${one(v)} h`), row('Sleep quality', a.sleepQuality, b.sleepQuality),
];

export function OnOffCards({ meds, doses, checkIns, now, s }: { meds: Medication[]; doses: Dose[]; checkIns: CheckIn[]; now: number; s: ScheduleSettings }) {
  const rows = meds.filter((m) => !m.archived && !m.peptide && m.schedule.type !== 'prn').map((m) => onOffDays(m, doses, checkIns, now, s)).filter(Boolean);
  if (!rows.length) return null;
  return (
    <Section id="onoff-h" title="Days on and off">
      <div className="space-y-4">
        {rows.map((r) => (
          <div key={r!.med.id}>
            <p className="font-medium">{shownName(r!.med)}</p>
            <div className="mt-2"><Compare a={`Taken (${r!.on.days} days)`} b={`Not taken (${r!.off.days})`} rows={sideRows(r!.on, r!.off)} /></div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted mt-1">Days taken vs not</p>
    </Section>
  );
}

export function SubstanceCard({ checkIns, now, s }: { checkIns: CheckIn[]; now: number; s: ScheduleSettings }) {
  const f = substanceFindings(checkIns, now, s);
  if (!f.length) return null;
  return (
    <Section id="subst-h" title="Caffeine and alcohol">
      <div className="space-y-4">
        {f.map((x) => (
          <div key={x.what}>
            <p className="font-medium">{x.title}</p>
            <div className="mt-2"><Compare a={`With (${x.with.days} nights)`} b={`Without (${x.without.days})`} rows={[
              row('Sleep', x.with.sleepHours, x.without.sleepHours, (v) => `${one(v)} h`), row('Sleep quality (1–5)', x.with.sleepQuality, x.without.sleepQuality),
              ...(x.what === 'alcohol' ? [row('Side effects next day', x.with.effectPct, x.without.effectPct, (v) => `${Math.round(v)}%`)] : []),
            ]} /></div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted mt-1">From the Coffee and Alcohol buttons on Today (or those chips in a check-in).</p>
    </Section>
  );
}

export function StepsWeightCard({ daily, body, units, now }: { daily: DailyHealth[]; body: BodyEntry[]; units: Units; now: number }) {
  const r = stepsVsWeight(daily, body, now);
  if (!r) return null;
  const u = weightUnit(units);
  const k = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(kgTo(v, units))} ${u}`;
  return (
    <Section id="steps-h" title="Steps and weight">
      <Compare a={`Busier weeks (${r.busier.weeks})`} b={`Quieter weeks (${r.quieter.weeks})`} rows={[
        row('Steps a day', r.busier.steps, r.quieter.steps, (v) => Math.round(v).toLocaleString('en-AU')),
        row('Weight change a week', r.busier.perWeek, r.quieter.perWeek, k),
      ]} />
      <p className="text-xs text-muted mt-1">Weeks with more steps against weeks with fewer, from Health Connect or Apple Health.</p>
    </Section>
  );
}

export function HeartAfterCards({ meds, doses, daily, vitals, now, s }: { meds: Medication[]; doses: Dose[]; daily: DailyHealth[]; vitals: Vital[]; now: number; s: ScheduleSettings }) {
  const rows = meds.filter((m) => !m.archived).map((m) => ({ m, r: heartAfterDose(m, doses, daily, vitals, now, s) })).filter((x) => x.r);
  if (!rows.length) return null;
  return (
    <Section id="hr-h" title="Heart rate after a dose">
      <ul className="space-y-4">
        {rows.map(({ m, r }) => {
          const max = Math.max(...r!.byHour.map((b) => b.bpm ?? 0));
          const min = Math.min(...r!.byHour.filter((b) => b.bpm).map((b) => b.bpm!), r!.baseline ?? Infinity) - 5;
          return (
            <li key={m.id}>
              <p className="font-medium">{shownName(m)}</p>
              <p className="text-[15px] tnum">Highest about {r!.peak!.h} h after a dose: {r!.peak!.bpm} bpm{r!.baseline !== undefined ? ` (usually ${r!.baseline} without one)` : ''}.</p>
              <div className="flex items-end gap-0.5 h-12 mt-2" role="img" aria-label={`Heart rate by hour after a dose: ${r!.byHour.filter((b) => b.bpm).map((b) => `${b.h} h ${b.bpm}`).join(', ')}`}>
                {r!.byHour.map((b) => <div key={b.h} className="flex-1 rounded-[2px]" style={{ height: b.bpm ? `${Math.max(6, ((b.bpm - min) / Math.max(1, max - min)) * 100)}%` : 0, background: b.h < 0 ? 'var(--border-strong)' : 'var(--text)' }} />)}
              </div>
              <div className="flex justify-between text-xs text-muted mt-1" aria-hidden="true"><span>before</span><span>4 h</span><span>8 h</span></div>
              {r!.weekly.length >= 3 && <p className="text-sm text-muted tnum mt-1">1–6 h after, by week: {r!.weekly.map((w) => `${format(w.weekStart, 'd MMM')} ${w.bpm}`).join(' · ')}</p>}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted mt-1">From heart rate imported from your watch and readings you've logged.</p>
    </Section>
  );
}

