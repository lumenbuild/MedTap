// Body in four parts: the weight (true weight, the change, the goal), what it's made of (fat and lean, from the
// scale), where it's heading (the goal date, the two biggest levers, muscle in the coming loss), and measurements and
// photos (on the Body screen). Each number said once; the details a tap away.
import { format } from 'date-fns';
import { ChevronDown, Flag, Layers, Scale, TrendingDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { useDecisionData } from '../app/useDecisions';
import { useNow } from '../app/useNow';
import { useScaleChange } from '../app/data';
import type { Units } from '../db/repos/settings';
import { leanForecast, weightTrend } from '../logic/bodyModel';
import { fatForecast, lossMix } from '../logic/scaleInsights';
import { personalLevers } from '../logic/aheadSmarts';
import { fmtWeight } from '../logic/units';
import { goalView } from '../screens/Body/Goals';

const H = ({ id, Icon, children, right }: { id: string; Icon: typeof Scale; children: ReactNode; right?: ReactNode }) => (
  <div className="flex items-center gap-2">
    <h2 id={id} className="font-semibold text-[17px] flex items-center gap-2 flex-1"><Icon size={18} aria-hidden="true" className="text-primary" />{children}</h2>
    {right}
  </div>
);

/** 1. The weight: the true weight big, this week's change and since the start, and the bar to the goal. */
export function WeightHero({ units }: { units: Units }) {
  const dd = useDecisionData();
  const now = useNow(3_600_000);
  if (!dd || dd.everyone) return null;
  const { data, weightGoal } = dd;
  const tr = weightTrend({ body: data.body, foodLogs: data.foodLogs, workouts: data.workouts, checkIns: data.checkIns, daily: data.daily, doses: data.doses, meds: data.meds }, now);
  if (!tr) return null;
  const w = (kg: number) => fmtWeight(Math.abs(kg), units);
  const gv = weightGoal ? goalView(weightGoal, data.body, now) : null;
  const start = weightGoal?.start;
  const lost = start !== undefined ? start - tr.trend : undefined;
  const done = weightGoal && start !== undefined && start !== weightGoal.target ? Math.max(0, Math.min(1, (start - tr.trend) / (start - weightGoal.target))) : undefined;
  return (
    <section className="hero body" aria-labelledby="wh-h">
      <p id="wh-h" className="hero-label flex items-center gap-1.5"><Scale size={15} aria-hidden="true" />True weight</p>
      <p className="mt-1 text-[48px] leading-[52px] font-bold tnum tracking-[-0.02em]">{w(tr.trend)}</p>
      <div className="mt-2 grid grid-cols-2 gap-2 tnum">
        <div className="rounded-btn bg-white/15 p-2.5">
          <p className="text-[12px] opacity-85">This week</p>
          <p className="text-[20px] font-bold">{tr.perWeek < -0.05 ? '−' : tr.perWeek > 0.05 ? '+' : ''}{w(tr.perWeek)}</p>
        </div>
        {lost !== undefined && (
          <div className="rounded-btn bg-white/15 p-2.5">
            <p className="text-[12px] opacity-85">Since {w(start!)}</p>
            <p className="text-[20px] font-bold">{lost >= 0 ? '−' : '+'}{w(lost)}</p>
          </div>
        )}
      </div>
      {weightGoal && done !== undefined && (
        <div className="mt-3">
          <div className="h-2.5 rounded-full bg-white/25" role="img" aria-label={`${Math.round(done * 100)}% of the way to ${w(weightGoal.target)}`}>
            <div className="h-2.5 rounded-full bg-white" style={{ width: `${done * 100}%` }} />
          </div>
          <p className="mt-1.5 text-[14px] flex items-center gap-1.5"><Flag size={14} aria-hidden="true" />
            {w(weightGoal.target)}{gv?.f.eta ? <> around <strong>{format(gv.f.eta, 'MMM yyyy')}</strong></> : ''} · {Math.round(done * 100)}% of the way
          </p>
        </div>
      )}
      {Math.abs(tr.off) >= 0.4 && <p className="mt-2 text-[14px] opacity-90">Latest weigh-in {w(tr.latest)}, {tr.off > 0 ? 'above' : 'below'} the trend{tr.causes.length ? `: likely ${tr.causes[0]}` : ''}.</p>}
    </section>
  );
}

/** 2. What it's made of: body fat, fat and lean, and what the loss has been since the scale's readings began. */
export function MadeOfCard({ units, sex, children }: { units: Units; sex?: 'm' | 'f'; children?: ReactNode }) {
  const dd = useDecisionData();
  const changedOn = useScaleChange();
  const now = useNow(3_600_000);
  if (!dd || dd.everyone) return null;
  const ff = fatForecast(dd.data.body, sex, dd.goalKg, now);
  if (!ff) return children ? <>{children}</> : null;
  const mix = lossMix(dd.data.body, now);
  const w = (kg: number) => fmtWeight(Math.abs(kg), units);
  const total = ff.fatKg + ff.leanKg;
  return (
    <section className="box space-y-3" aria-labelledby="madeof-h">
      <H id="madeof-h" Icon={Layers}>What it's made of</H>
      <div className="grid grid-cols-3 gap-2 tnum text-center">
        <div className="rounded-btn bg-surface-2 p-2.5"><p className="text-[22px] font-bold">{ff.bf}%</p><p className="text-[12px] text-muted">body fat</p></div>
        <div className="rounded-btn bg-surface-2 p-2.5"><p className="text-[22px] font-bold">{w(ff.fatKg)}</p><p className="text-[12px] text-muted">fat</p></div>
        <div className="rounded-btn bg-surface-2 p-2.5"><p className="text-[22px] font-bold">{w(ff.leanKg)}</p><p className="text-[12px] text-muted">lean</p></div>
      </div>
      {/* Fat against lean as one bar, with the healthy line for fat at this lean mass. */}
      <div>
        <div className="flex h-3.5 rounded-full overflow-hidden" role="img" aria-label={`${w(ff.fatKg)} fat and ${w(ff.leanKg)} lean; a healthy ${ff.healthyBf}% is about ${w(ff.healthyKg)}`}>
          <div style={{ width: `${(ff.fatKg / total) * 100}%`, background: 'var(--c-pep, #eb6834)' }} />
          <div style={{ width: `${(ff.leanKg / total) * 100}%`, background: 'var(--c-body, #2a78d6)' }} />
        </div>
        <p className="mt-1 text-[13px] text-muted">A healthy {ff.healthyBf}% with your lean mass is about <strong className="text-text">{w(ff.healthyKg)}</strong>.</p>
      </div>
      {mix && (
        <p className="text-[14px]">Since {format(new Date(`${mix.since}T12:00`), 'd MMM')}: <strong>{w(mix.fatLost)} fat</strong> {mix.fatLost >= 0 ? 'lost' : 'gained'}, lean {Math.abs(mix.leanLost) < 0.3 ? 'about the same' : `${mix.leanLost > 0 ? '−' : '+'}${w(mix.leanLost)}`}.</p>
      )}
      {changedOn && <p className="text-[12px] text-muted">Your scale changed how it measures on {format(new Date(`${changedOn}T12:00`), 'd MMM')}; this counts from then.</p>}
      {children && (
        <details className="group">
          <summary className="min-h-[44px] flex items-center gap-1 text-[14px] font-medium text-primary cursor-pointer list-none">Every scale reading and importing <ChevronDown size={16} aria-hidden="true" className="transition-transform group-open:rotate-180" /></summary>
          <div className="mt-2 -mx-1">{children}</div>
        </details>
      )}
    </section>
  );
}

/** 3. Where it's heading: when the goal arrives, the two biggest levers, and muscle in the coming loss. */
export function HeadingCard({ units, children }: { units: Units; children?: ReactNode }) {
  const dd = useDecisionData();
  const now = useNow(3_600_000);
  if (!dd || dd.everyone) return null;
  const { data, s, settings, weightGoal, goalKg } = dd;
  const tr = weightTrend({ body: data.body, foodLogs: data.foodLogs, workouts: data.workouts, checkIns: data.checkIns, daily: data.daily, doses: data.doses, meds: data.meds }, now);
  if (!tr) return null;
  const w = (kg: number) => fmtWeight(Math.abs(kg), units);
  const gv = weightGoal ? goalView(weightGoal, data.body, now) : null;
  const levers = personalLevers({ trend: tr, daily: data.daily, foodLogs: data.foodLogs, target: settings.energyTargetKcal }, now, s).sort((a, b) => b.days - a.days).slice(0, 2);
  const lean = leanForecast(data.body, data.workouts, data.daily, tr.perWeek, settings.proteinTargetG, now);
  return (
    <section className="box space-y-3" aria-labelledby="heading-h">
      <H id="heading-h" Icon={TrendingDown}>Where it's heading</H>
      {gv?.f.eta ? (
        <div>
          <p className="text-[24px] font-bold tnum">{format(gv.f.eta, 'MMMM yyyy')}</p>
          <p className="text-[14px] text-muted">for {w(goalKg!)} at this pace{gv.f.etaEarly && gv.f.etaLate ? `, likely ${format(gv.f.etaEarly, 'MMM')} to ${format(gv.f.etaLate, 'MMM yyyy')}` : ''}; loss slows a little as you get lighter.</p>
        </div>
      ) : <p className="text-[15px]">Down {w(tr.perWeek)} a week lately.</p>}
      {levers.length > 0 && (
        <ul className="space-y-2" aria-label="What would bring it sooner">
          {levers.map((l) => (
            <li key={l.what} className="flex items-center gap-3 rounded-btn bg-surface-2 p-2.5">
              <span className="text-[20px] font-bold tnum text-primary w-14 shrink-0 text-center">{l.days}<span className="block text-[11px] font-medium">days</span></span>
              <span className="text-[14px] leading-snug">sooner with a month of {l.what.charAt(0).toLowerCase() + l.what.slice(1)}</span>
            </li>
          ))}
        </ul>
      )}
      {lean && (
        <p className="text-[14px]">Of your next 10 kg, about <strong>{w(lean.share * 10)}</strong> is likely lean mass{lean.better !== undefined ? <>; with {lean.levers.join(' and ')}, about <strong>{w(lean.better * 10)}</strong></> : ''}.</p>
      )}
      {children && (
        <details className="group">
          <summary className="min-h-[44px] flex items-center gap-1 text-[14px] font-medium text-primary cursor-pointer list-none">Goals and milestones <ChevronDown size={16} aria-hidden="true" className="transition-transform group-open:rotate-180" /></summary>
          <div className="mt-2 space-y-3">{children}</div>
        </details>
      )}
    </section>
  );
}
