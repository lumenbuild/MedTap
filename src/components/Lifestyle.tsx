// Trends: days on and off a medicine and heart rate after a dose (for the medicine picked), and every comparison in
// the person's records in one section. Each says what it rests on; links in the person's records, not causes.
import { format } from 'date-fns';
import type { CheckIn, DailyHealth, Dose, Medication, Vital, BodyEntry, Workout } from '../db/schema';
import type { ScheduleSettings } from '../logic/schedule';
import type { Units } from '../db/repos/settings';
import { heartAfterDose, onOffDays, stepsVsWeight, substanceFindings, type Side } from '../logic/lifestyle';
import { shownName } from '../logic/privacy';
import { kgTo, weightUnit } from '../logic/units';
import { CompareBars } from './ui/Visual';
import { proteinVsLean, readinessVsPerformance } from '../logic/fitnessInsights';
import type { SleepImpact } from '../logic/habits';

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
            {rows.length > 1 && <p className="font-medium mb-2">{shownName(r!.med)}</p>}
            <div><Compare a={`Taken (${r!.on.days} days)`} b={`Not taken (${r!.off.days})`} rows={sideRows(r!.on, r!.off)} /></div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted mt-1">Days taken vs not</p>
    </Section>
  );
}

/** Trends, "What goes with what": every comparison in the person's records in one section, each as two bars side by
 *  side: the last dose and sleep, caffeine and alcohol, steps and weight, readiness and lifts, protein and lean mass. */
export function LinksSection({ checkIns, daily, body, workouts, sleep, units, now, s, showBody = true, training }: {
  checkIns: CheckIn[]; daily: DailyHealth[]; body: BodyEntry[]; workouts: Workout[]; sleep: SleepImpact | null; units: Units; now: number; s: ScheduleSettings;
  /** Weight-based links (MedTap) and the training ones (training tools on). */
  showBody?: boolean; training: boolean;
}) {
  const hrs = (v: number) => `${one(v)} h`;
  const parts: { key: string; title: string; a: string; b: string; rows: Row[] }[] = [];
  if (sleep) {
    const t = format(new Date(2026, 0, 1, sleep.cutoffHour), 'h a').toLowerCase();
    parts.push({ key: 'sleep', title: 'Last dose and sleep', a: `Last dose before ${t} (${sleep.before.nights} nights)`, b: `After (${sleep.after.nights})`,
      rows: [row('Sleep', sleep.before.hours, sleep.after.hours, hrs), row('Sleep quality (1–5)', sleep.before.quality, sleep.after.quality)] });
  }
  for (const x of substanceFindings(checkIns, now, s)) {
    parts.push({ key: x.what, title: x.title, a: `With (${x.with.days} nights)`, b: `Without (${x.without.days})`, rows: [
      row('Sleep', x.with.sleepHours, x.without.sleepHours, hrs), row('Sleep quality (1–5)', x.with.sleepQuality, x.without.sleepQuality),
      ...(x.what === 'alcohol' ? [row('Side effects next day', x.with.effectPct, x.without.effectPct, (v) => `${Math.round(v)}%`)] : []),
    ] });
  }
  const sw = showBody ? stepsVsWeight(daily, body, now) : null;
  if (sw) {
    const k = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(kgTo(v, units))} ${weightUnit(units)}`;
    parts.push({ key: 'steps', title: 'Steps and weight', a: `Busier weeks (${sw.busier.weeks})`, b: `Quieter weeks (${sw.quieter.weeks})`, rows: [
      row('Steps a day', sw.busier.steps, sw.quieter.steps, (v) => Math.round(v).toLocaleString('en-AU')), row('Weight change a week', sw.busier.perWeek, sw.quieter.perWeek, k),
    ] });
  }
  const rp = showBody && training ? readinessVsPerformance(workouts, daily, checkIns, s) : null;
  if (rp) parts.push({ key: 'ready', title: 'Readiness and lifts', a: `Better readiness (about ${rp.higher.score})`, b: `Lower (about ${rp.lower.score})`,
    rows: [row(`Lifts against your recent level (${rp.higher.sessions} and ${rp.lower.sessions} sessions)`, rp.higher.pct, rp.lower.pct, (v) => `${v > 0 ? '+' : ''}${v}%`)] });
  const pl = showBody && training ? proteinVsLean(daily, body) : null;
  if (pl) parts.push({ key: 'lean', title: 'Protein and lean mass', a: `Protein about ${pl.higher.protein} g`, b: `About ${pl.lower.protein} g`,
    rows: [row(`Share of weight lost that was lean mass (${pl.higher.spans + pl.lower.spans} spans)`, pl.higher.share, pl.lower.share, (v) => `${v}%`)] });
  if (!parts.length) return null;
  return (
    <Section id="links-h" title="What goes with what">
      <div className="space-y-5">
        {parts.map((p) => (
          <div key={p.key}>
            <h3 className="font-medium mb-2">{p.title}</h3>
            <Compare a={p.a} b={p.b} rows={p.rows} />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted mt-2">Links in your own records, not causes. Caffeine and alcohol come from the buttons on Today or those chips in a check-in; steps from Health Connect or Apple Health.</p>
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
              {rows.length > 1 && <p className="font-medium">{shownName(m)}</p>}
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

