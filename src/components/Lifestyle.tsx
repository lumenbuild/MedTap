// Trends cards for days on and off a medicine, caffeine and alcohol, the cycle, steps against weight, and heart rate
// after a dose. Each says what it rests on; links in the person's records, not causes.
import { format } from 'date-fns';
import type { CheckIn, DailyHealth, Dose, Medication, Vital, BodyEntry } from '../db/schema';
import type { ScheduleSettings } from '../logic/schedule';
import type { Units } from '../db/repos/settings';
import { cycleView, heartAfterDose, onOffDays, stepsVsWeight, substanceFindings, type Side } from '../logic/lifestyle';
import { shownName } from '../logic/privacy';
import { kgTo, weightUnit } from '../logic/units';
import type { CycleForecast } from '../logic/cycle';
import { CycleStrip } from './Insights';

const Section = ({ id, title, children }: { id: string; title: string; children: React.ReactNode }) => (
  <section className="border-t border-border pt-5 pb-1" aria-labelledby={id}>
    <h2 id={id} className="text-sm font-medium text-muted mb-2">{title}</h2>
    {children}
  </section>
);
const cell = (v?: number, unit = '') => (v === undefined ? '–' : `${v}${unit}`);

function CompareTable({ cols, rows }: { cols: [string, string]; rows: [string, string, string][] }) {
  const shown = rows.filter((r) => r[1] !== '–' || r[2] !== '–');
  return (
    <table className="w-full text-[15px] tnum">
      <thead><tr className="text-left text-sm text-muted"><th className="font-medium py-1"><span className="sr-only">Measure</span></th><th className="font-medium py-1">{cols[0]}</th><th className="font-medium py-1">{cols[1]}</th></tr></thead>
      <tbody>{shown.map(([k, a, b]) => <tr key={k} className="border-t border-border"><td className="py-1.5 pr-3 text-muted">{k}</td><td className="py-1.5 pr-3">{a}</td><td className="py-1.5">{b}</td></tr>)}</tbody>
    </table>
  );
}
const sideRows = (a: Side, b: Side): [string, string, string][] => [
  ['Focus', cell(a.focus), cell(b.focus)], ['Mood', cell(a.mood), cell(b.mood)], ['Energy', cell(a.energy), cell(b.energy)], ['Appetite', cell(a.appetite), cell(b.appetite)],
  ['Sleep', cell(a.sleepHours, ' h'), cell(b.sleepHours, ' h')], ['Sleep quality', cell(a.sleepQuality), cell(b.sleepQuality)],
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
            <CompareTable cols={[`Taken (${r!.on.days} days)`, `Not taken (${r!.off.days})`]} rows={sideRows(r!.on, r!.off)} />
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
            <CompareTable cols={[`With (${x.with.days} nights)`, `Without (${x.without.days})`]} rows={[
              ['Sleep', cell(x.with.sleepHours, ' h'), cell(x.without.sleepHours, ' h')], ['Sleep quality', cell(x.with.sleepQuality), cell(x.without.sleepQuality)],
              ...(x.what === 'alcohol' ? [['Side effects next day', cell(x.with.effectPct, '%'), cell(x.without.effectPct, '%')] as [string, string, string]] : []),
            ]} />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted mt-1">From the Coffee and Alcohol buttons on Today (or those chips in a check-in).</p>
    </Section>
  );
}

export function CycleCard({ checkIns, now, forecast }: { checkIns: CheckIn[]; now: number; forecast?: CycleForecast | null }) {
  const v = cycleView(checkIns, now);
  if (!v) return <Section id="cycle-h" title="Your cycle"><p className="text-[15px] text-muted">Tap Period on Today when one starts.</p></Section>;
  return (
    <Section id="cycle-h" title="Your cycle">
      <p className="text-[15px] mb-2 tnum">{v.today ? `Day ${v.today} today` : ''}{v.averageLength ? ` · usually ${v.averageLength} days` : ''} · {v.starts.length} cycles logged</p>
      <div className="table-scroll" tabIndex={0}>
        <table className="w-full text-sm tnum">
          <thead><tr className="text-left text-muted"><th className="font-medium py-1 pr-3">Phase</th><th className="font-medium py-1 pr-2">Mood</th><th className="font-medium py-1 pr-2">Focus</th><th className="font-medium py-1 pr-2">Appetite</th><th className="font-medium py-1 pr-2">Side effects</th></tr></thead>
          <tbody>{v.phases.map((p) => <tr key={p.name} className="border-t border-border"><td className="py-1.5 pr-3">{p.name}</td><td className="py-1.5 pr-2">{cell(p.mood)}</td><td className="py-1.5 pr-2">{cell(p.focus)}</td><td className="py-1.5 pr-2">{cell(p.appetite)}</td><td className="py-1.5 pr-2">{cell(p.effectPct, '%')}</td></tr>)}</tbody>
        </table>
      </div>
      {forecast && forecast.upcoming.length > 0 && <CycleStrip f={forecast} now={now} />}
    </Section>
  );
}

export function StepsWeightCard({ daily, body, units, now }: { daily: DailyHealth[]; body: BodyEntry[]; units: Units; now: number }) {
  const r = stepsVsWeight(daily, body, now);
  if (!r) return null;
  const u = weightUnit(units);
  const k = (v: number) => `${v > 0 ? '+' : ''}${kgTo(v, units)} ${u}`;
  return (
    <Section id="steps-h" title="Steps and weight">
      <CompareTable cols={[`Busier (${r.busier.weeks} wks)`, `Quieter (${r.quieter.weeks})`]} rows={[
        ['Steps a day', r.busier.steps.toLocaleString('en-AU'), r.quieter.steps.toLocaleString('en-AU')],
        ['Weight a week', k(r.busier.perWeek), k(r.quieter.perWeek)],
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

