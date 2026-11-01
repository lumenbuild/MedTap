// The weight and body model on Progress → Body: the true weight (and why today's reading is off it), where the
// current habits land, how much of the coming loss is likely to be muscle, and the landing plan near the goal.
import { format } from 'date-fns';
import { Dumbbell, Flag, Plane, Scale, TrendingDown } from 'lucide-react';
import { useDecisionData } from '../app/useDecisions';
import { useNow } from '../app/useNow';
import { landing, landingPlan, leanForecast, weightTrend } from '../logic/bodyModel';
import { energyBalance, expenditure } from '../logic/energy';
import { fmtWeight } from '../logic/units';
import type { Units } from '../db/repos/settings';
import { MiniRing } from './ui/Visual';

const sign = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '');
const month = (t: number) => format(t, 'MMM yyyy');

export function BodyModelCards({ units }: { units: Units }) {
  const dd = useDecisionData();
  const now = useNow(3_600_000);
  if (!dd || dd.everyone) return null;
  const { data, s, goalKg, settings } = dd;
  const tr = weightTrend({ body: data.body, foodLogs: data.foodLogs, workouts: data.workouts, checkIns: data.checkIns, daily: data.daily, doses: data.doses, meds: data.meds }, now);
  if (!tr) return null;
  const w = (kg: number) => fmtWeight(kg, units);
  const burn = expenditure(data.foodLogs, data.body, now, s)?.kcal ?? energyBalance(data.daily, data.foodLogs, now, s)?.watchMaintenance;
  const land = landing(tr, burn, goalKg, now);
  const lean = leanForecast(data.body, data.workouts, data.daily, tr.perWeek, settings.proteinTargetG, now);
  const plan = landingPlan(tr, land, { daily: data.daily, workouts: data.workouts, checkIns: data.checkIns }, now);
  const rate = Math.abs(tr.perWeek);
  return (
    <>
      <section className="hero body" aria-labelledby="tw-h">
        <p id="tw-h" className="hero-label flex items-center gap-1.5"><Scale size={15} aria-hidden="true" />True weight</p>
        <p className="mt-1 text-[40px] leading-[44px] font-bold tnum">{w(tr.trend)}</p>
        <p className="text-[17px] font-semibold tnum">{tr.perWeek < -0.05 ? `Down ${w(rate)} a week` : tr.perWeek > 0.05 ? `Up ${w(rate)} a week` : 'Holding steady'}
          <span className="text-muted font-normal text-[15px]"> · likely {w(Math.abs(tr.perWeekHigh))}–{w(Math.abs(tr.perWeekLow))}</span></p>
        <p className="mt-2 text-[15px]">
          {Math.abs(tr.off) < 0.4 ? `Latest weigh-in ${w(tr.latest)}, right on the trend.`
            : `Latest weigh-in ${w(tr.latest)}: ${sign(tr.off)}${w(Math.abs(tr.off))} off the trend${tr.causes.length ? `, likely ${tr.off > 0 ? 'water' : 'less water'}: ${tr.causes.join(', ')}` : ''}.`}
        </p>
        <p className="text-[13px] text-muted mt-1">The trend smooths out water, salt and food in the gut, so one reading never moves it much.</p>
      </section>

      <section className="box space-y-2" aria-labelledby="head-h">
        <h2 id="head-h" className="text-sm font-medium text-muted flex items-center gap-1.5"><TrendingDown size={15} aria-hidden="true" />Where you're heading</h2>
        <p className="text-[17px] font-semibold tnum">On today's habits you'd level off around {w(land.plateauKg)}</p>
        <p className="text-[15px] text-muted tnum">You burn about {land.burn.toLocaleString('en-AU')} Cal a day{land.burnEstimated ? ' (a rough estimate from your weight until there’s a watch or two weeks of food logs)' : ''} and, from your weight change, eat about {land.intake.toLocaleString('en-AU')}. Each kg lighter burns about 22 Cal less, so loss slows as you go.</p>
        {land.goal && (land.goal.reachable && land.goal.date
          ? <p className="text-[15px] tnum"><Flag size={14} aria-hidden="true" className="inline -mt-0.5 mr-1" />{w(land.goal.kg)} around <strong>{month(land.goal.date)}</strong>{land.goal.early && land.goal.late ? ` (likely ${month(land.goal.early)} to ${month(land.goal.late)})` : ''}.</p>
          : <p className="text-[15px]"><Flag size={14} aria-hidden="true" className="inline -mt-0.5 mr-1" />{w(land.goal.kg)} isn't on this path: the plateau comes first.</p>)}
        {land.plan && <p className="text-[15px] tnum">To reach {w(land.goal!.kg)} in about {land.plan.months} months: about <strong>{land.plan.kcal.toLocaleString('en-AU')} Cal a day</strong> on average (or the same gap from more movement).</p>}
        {land.pace !== 'unknown' && <p className="text-[13px] text-muted">{land.pace === 'expected' ? 'The slowdown so far is what a lighter body burning less explains.'
          : land.pace === 'slower-than-expected' ? 'Slower than a lighter body explains on its own: likely eating a little more, or water held (a new food, salt, a hard week of training).'
          : 'Faster than expected lately: worth checking protein and that you’re eating enough.'}</p>}
      </section>

      {lean && (
        <section className="box space-y-2" aria-labelledby="lean-h">
          <h2 id="lean-h" className="text-sm font-medium text-muted flex items-center gap-1.5"><Dumbbell size={15} aria-hidden="true" />Muscle in the coming loss</h2>
          <div className="flex items-center gap-4">
            <MiniRing value={Math.round(lean.share * 100)} max={100} size={72} tone={lean.share >= 0.3 ? 'watch' : 'good'} label={`${Math.round(lean.share * 100)}% likely muscle`}><span className="text-[17px] font-bold tnum">{Math.round(lean.share * 100)}%</span></MiniRing>
            <p className="text-[15px] flex-1">Of your next 10 kg, about <strong>{w(lean.share * 10)}</strong> is likely to be muscle and other lean mass{lean.better !== undefined ? <>; with {lean.levers.join(' and ')}, about <strong>{w(lean.better * 10)}</strong></> : ''}.</p>
          </div>
          {lean.raising.length > 0 && <p className="text-[13px] text-muted">Raising it: {lean.raising.join(', ')}. With {w(lean.fatKg)} of fat to lose, most of the loss can be fat.</p>}
          {lean.measured !== undefined && <p className="text-[13px] text-muted">Your scale says {Math.round(lean.measured * 100)}% of the last 8 weeks' loss was lean. Scales are rough on this; a DEXA scan settles it.</p>}
        </section>
      )}

      {plan && (
        <section className="box space-y-2" aria-labelledby="land-h">
          <h2 id="land-h" className="text-sm font-medium text-muted flex items-center gap-1.5"><Plane size={15} aria-hidden="true" />Landing at {w(land.goal!.kg)}</h2>
          <p className="text-[15px] tnum">Keeping it takes about <strong>{plan.maintenance.toLocaleString('en-AU')} Cal a day</strong>. Rise to it about 150 Cal a week:</p>
          <ul className="flex flex-wrap gap-1.5">{plan.steps.map((x) => <li key={x.week} className="text-[13px] rounded-full px-2.5 py-1 bg-surface-2 tnum">Week {x.week}: {x.kcal.toLocaleString('en-AU')}</li>)}</ul>
          <p className="text-[15px]">Regain risk: <strong>{plan.risk}</strong>{plan.riskWhy.length ? ` (${plan.riskWhy.join(', ')})` : ''}. Any change to medicine as you land is one for your prescriber.</p>
        </section>
      )}
    </>
  );
}
