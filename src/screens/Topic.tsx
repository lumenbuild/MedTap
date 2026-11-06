// One result, joined up: where it is now and its last month, what moves it for you (from your own days), what today's
// plan says about it, and the full detail a tap away. Sleep, resting heart rate, HRV, focus, weight and lean mass.
import { ChevronRight, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { useDecisionData } from '../app/useDecisions';
import { useNow } from '../app/useNow';
import { driversFor, type Drivers, type Topic as TopicId } from '../logic/drivers';
import { fmtHM } from '../logic/sleep';
import { comps, muscleEvidence } from '../logic/scaleInsights';
import { weightTrend } from '../logic/bodyModel';
import { personalLevers } from '../logic/aheadSmarts';
import { rhrExplained } from '../logic/healthChecks';
import { fmtWeight, kgTo } from '../logic/units';
import { useToday } from '../components/TodayPlan';
import { BecauseChips } from '../components/InsightList';
import { RhrCard } from '../components/HealthChecks';
import { Sparkline } from '../components/ui/Visual';
import type { Thread } from '../logic/plan';

const DAY = 86_400_000;
const ymdMs = (k: string) => new Date(`${k}T12:00`).getTime();
const HERO: Record<string, string> = { sleep: 'sleep', rhr: 'act', hrv: 'act', focus: 'mind', weight: 'body', lean: 'body' };
const THREAD: Record<string, Thread> = { sleep: 'recovery', rhr: 'recovery', hrv: 'recovery', focus: 'meds', weight: 'body', lean: 'body' };
const FULL: Record<string, { label: string; href: string }> = {
  sleep: { label: 'Sleep in full', href: '#/sleep' }, rhr: { label: 'Health in full', href: '#/health' }, hrv: { label: 'Health in full', href: '#/health' },
  focus: { label: 'Trends', href: '#/progress/trends' }, weight: { label: 'Body in full', href: '#/progress/body' }, lean: { label: 'Body in full', href: '#/progress/body' },
};

export function Topic({ id }: { id: string }) {
  const dd = useDecisionData();
  const today = useToday();
  const now = useNow(600_000);
  if (!dd || dd.everyone) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const { data, s, settings } = dd;
  const u = settings.units;
  const recent = (pts: { t: number; v: number }[]) => pts.filter((p) => p.t > now - 30 * DAY).sort((a, b) => a.t - b.t);
  const daily = data.daily.filter((x) => !x.deletedAt);
  let pts: { t: number; v: number }[] = [];
  let show: (v: number) => string = (v) => String(Math.round(v));
  let unit = '';
  if (id === 'sleep') { pts = daily.filter((x) => (x.sleepMin ?? 0) > 60).map((x) => ({ t: ymdMs(x.date), v: x.sleepMin! })); show = (v) => fmtHM(Math.round(v)); }
  else if (id === 'rhr') { pts = daily.filter((x) => x.restingHr).map((x) => ({ t: ymdMs(x.date), v: x.restingHr! })); unit = 'bpm'; }
  else if (id === 'hrv') { pts = daily.filter((x) => x.hrvMs).map((x) => ({ t: ymdMs(x.date), v: x.hrvMs! })); unit = 'ms'; }
  else if (id === 'focus') {
    const by = new Map<string, number[]>();
    for (const c of data.checkIns) if (typeof c.focus === 'number') { const k = c.at.slice(0, 10); by.set(k, [...(by.get(k) ?? []), c.focus]); }
    pts = [...by].map(([k, v]) => ({ t: ymdMs(k), v: v.reduce((a, b) => a + b, 0) / v.length })); show = (v) => (Math.round(v * 10) / 10).toString(); unit = 'of 5';
  } else if (id === 'weight') { pts = data.body.filter((b) => b.weightKg).map((b) => ({ t: ymdMs(b.date), v: b.weightKg! })); show = (v) => String(kgTo(v, u)); unit = u === 'imperial' ? 'lb' : 'kg'; }
  else if (id === 'lean') { pts = comps(data.body).map((c) => ({ t: c.t, v: c.lean })); show = (v) => String(kgTo(v, u)); unit = u === 'imperial' ? 'lb' : 'kg'; }
  const series = recent(pts);
  const last = series.at(-1);
  const first = series[0];
  const change = last && first && series.length >= 3 ? last.v - first.v : undefined;

  const ddata = { ...data, proteinTarget: settings.proteinTargetG };
  const drivers = id === 'lean' ? null : driversFor(id as TopicId, ddata, now, s);
  const related = (today?.plan ?? []).filter((x) => x.thread === THREAD[id]).slice(0, 3);

  // Extra, per topic: the weight levers (a month of each), what protects muscle, what explains resting heart rate.
  let extra: ReactNode = null;
  if (id === 'weight') {
    const tr = weightTrend({ body: data.body, foodLogs: data.foodLogs, workouts: data.workouts, checkIns: data.checkIns, daily: data.daily, doses: data.doses, meds: data.meds }, now);
    const levers = personalLevers({ trend: tr, daily: data.daily, foodLogs: data.foodLogs, target: settings.energyTargetKcal }, now, s);
    if (levers.length) extra = (
      <section className="box space-y-2" aria-labelledby="lev-h">
        <h2 id="lev-h" className="text-sm font-medium text-muted">A month of each brings the goal closer by</h2>
        <ul className="space-y-1.5">{levers.map((l) => <li key={l.what} className="flex items-baseline justify-between gap-3"><span>{l.what}</span><span className="font-semibold tnum shrink-0">{l.days.toLocaleString('en-AU')} days</span></li>)}</ul>
      </section>
    );
  } else if (id === 'lean') {
    const ev = muscleEvidence({ body: data.body, daily: data.daily, workouts: data.workouts, proteinTarget: settings.proteinTargetG }, now);
    if (ev) extra = (
      <section className="box space-y-2" aria-labelledby="ev2-h">
        <h2 id="ev2-h" className="text-sm font-medium text-muted">What moves your lean mass</h2>
        <ul className="space-y-2">{ev.rows.map((r) => <li key={r.what} className="tnum"><p className="font-medium">{r.what}</p><p className="text-sm text-muted">{fmtWeight(r.with, u)} a week with ({r.weeksWith} weeks) against {fmtWeight(r.without, u)} without ({r.weeksWithout})</p></li>)}</ul>
      </section>
    );
  } else if (id === 'rhr') {
    const hours = (t: number) => data.workouts.filter((w) => Date.parse(w.startedAt) > t - 7 * DAY && Date.parse(w.startedAt) <= t).length;
    const r = rhrExplained({ daily: data.daily, body: data.body, doses: data.doses, meds: data.meds, workoutsPerWeek: data.workouts.length ? hours : undefined }, now);
    if (r && r.parts.length) extra = <RhrCard r={r} />;
  }

  return (
    <div className="space-y-4">
      <section className={`hero ${HERO[id] ?? 'body'}`} aria-label="Now">
        {last ? (
          <>
            <p className="hero-label">{id === 'sleep' ? 'Last night' : 'Latest'}</p>
            <p className="mt-1 text-[40px] leading-[44px] font-bold tnum">{show(last.v)} <span className="text-[17px] font-medium">{unit}</span></p>
            {change !== undefined && <p className="text-[15px] font-semibold tnum">{change > 0 ? '▲' : change < 0 ? '▼' : ''} {id === 'sleep' ? fmtHM(Math.abs(Math.round(change))) : show(Math.abs(change))} over the month</p>}
            {series.length >= 3 && <div className="mt-3"><Sparkline points={series} label={`Last 30 days`} height={44} /></div>}
          </>
        ) : <p className="text-[17px]">Nothing recorded yet for this.</p>}
      </section>

      {drivers && <DriversCard d={drivers} />}
      {extra}

      {related.length > 0 && (
        <section className="box space-y-1" aria-labelledby="rel-h">
          <h2 id="rel-h" className="text-sm font-medium text-muted">In today's plan</h2>
          <ul className="divide-y divide-border">{related.map((x) => <li key={x.key} className="py-2"><p className="font-medium leading-snug">{x.title}</p>{x.detail && <p className="text-sm text-muted leading-snug">{x.detail}</p>}{x.because.length > 0 && <BecauseChips items={x.because} />}</li>)}</ul>
        </section>
      )}

      <a href={FULL[id]?.href ?? '#/today'} className="box flex items-center gap-3 min-h-[56px]"><span className="flex-1 font-medium">{FULL[id]?.label ?? 'More'}</span><ChevronRight size={18} aria-hidden="true" className="text-muted" /></a>
    </div>
  );
}

/** What goes with better and worse, as bars from a middle line: green to the good side, amber to the other. */
export function DriversCard({ d, title }: { d: Drivers; title?: string }) {
  const max = Math.max(...d.drivers.map((x) => Math.abs(x.diff)), 1e-9);
  return (
    <section className="box space-y-3" aria-labelledby={`drv-${d.topic}`}>
      <h2 id={`drv-${d.topic}`} className="font-semibold flex items-center gap-1.5"><Sparkles size={16} aria-hidden="true" />{title ?? `What moves your ${d.label.toLowerCase()}`}</h2>
      {d.drivers.length ? (
        <ul className="space-y-3">
          {d.drivers.map((x) => (
            <li key={x.key}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium leading-snug">{x.label}</span>
                <span className={`tnum font-semibold shrink-0 ${x.helps ? 'text-success' : 'text-caution'}`}>{x.text}</span>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-0.5 h-2" aria-hidden="true">
                <div className="flex justify-end">{!x.helps && <div className="h-2 rounded-l-full" style={{ width: `${(Math.abs(x.diff) / max) * 100}%`, background: 'var(--caution)' }} />}</div>
                <div>{x.helps && <div className="h-2 rounded-r-full" style={{ width: `${(Math.abs(x.diff) / max) * 100}%`, background: 'var(--success)' }} />}</div>
              </div>
              <p className="text-[12px] text-muted mt-0.5 tnum">{x.sure === 'clear' ? 'Clear' : 'Likely'} · {x.nWith} days with, {x.nWithout} without</p>
            </li>
          ))}
        </ul>
      ) : <p className="text-[15px] text-muted">{d.days < 14 ? `Builds up from your own days: ${d.days} so far, about 3 weeks needed.` : 'Nothing stands out yet: the days with and without each thing look alike.'}</p>}
      <p className="text-[12px] text-muted">From your last 90 days. Links in your data, not proof of cause.</p>
    </section>
  );
}
