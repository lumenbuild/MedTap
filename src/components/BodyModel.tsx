// The weight and body model on Progress → Body: the true weight (and why today's reading is off it), where the
// current habits land, how much of the coming loss is likely to be muscle, and the landing plan near the goal.
import { format } from 'date-fns';
import { Dumbbell, Flag, Plane, Scale, TrendingDown } from 'lucide-react';
import { useDecisionData } from '../app/useDecisions';
import { useNow } from '../app/useNow';
import { landing, landingPlan, leanForecast, weightTrend } from '../logic/bodyModel';
import { usualBurn } from '../logic/energy';
import { goalView } from '../screens/Body/Goals';
import { fmtWeight } from '../logic/units';
import type { Units } from '../db/repos/settings';
import { MiniRing } from './ui/Visual';
import { muscleWarning, nextWeighIn, personalLevers, plateauAhead } from '../logic/aheadSmarts';
import { LeversCard, MuscleWarningCard, NextWeighInLine, PlateauCard } from './AheadCards';

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
  const burn = usualBurn(data.foodLogs, data.body, data.daily, now, s)?.kcal;
  const land = landing(tr, burn, goalKg, now);
  const goalF = dd.weightGoal ? goalView(dd.weightGoal, data.body, now).f : undefined;
  const burnFromSteps = data.daily.some((d) => d.kcalEstimated);
  const lean = leanForecast(data.body, data.workouts, data.daily, tr.perWeek, settings.proteinTargetG, now);
  const plan = landingPlan(tr, land, { daily: data.daily, workouts: data.workouts, checkIns: data.checkIns }, now);
  const rate = Math.abs(tr.perWeek);
  const next = nextWeighIn({ trend: tr, foodLogs: data.foodLogs, workouts: data.workouts, checkIns: data.checkIns, daily: data.daily }, now, s);
  const plateau = plateauAhead({ trend: tr, daily: data.daily, foodLogs: data.foodLogs }, now, s);
  const levers = personalLevers({ trend: tr, daily: data.daily, foodLogs: data.foodLogs, target: settings.energyTargetKcal }, now, s);
  const muscle = muscleWarning({ body: data.body, daily: data.daily, workouts: data.workouts, proteinTarget: settings.proteinTargetG }, now);
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
        {next && <NextWeighInLine n={next} units={units} />}
        <p className="text-[13px] text-muted mt-1">The trend smooths out water, salt and food in the gut, so one reading never moves it much.</p>
      </section>
      {plateau && <PlateauCard p={plateau} />}

      <section className="box space-y-2" aria-labelledby="head-h">
        <h2 id="head-h" className="text-sm font-medium text-muted flex items-center gap-1.5"><TrendingDown size={15} aria-hidden="true" />Where you're heading</h2>
        {/* The goal date is the goal forecast's (the same on Today, the goal card and Training); the level-off point
            only when it comes before the goal, since a body loses more slowly the lighter it gets. */}
        {goalF?.eta ? <p className="text-[17px] font-semibold tnum"><Flag size={16} aria-hidden="true" className="inline -mt-1 mr-1" />{w(goalKg!)} around {month(goalF.eta)}{goalF.etaEarly && goalF.etaLate && month(goalF.etaEarly) !== month(goalF.etaLate) ? <span className="font-normal text-muted text-[15px]"> · likely {month(goalF.etaEarly)} to {month(goalF.etaLate)}</span> : null}</p>
          : goalKg && land.plateauKg > goalKg ? <p className="text-[17px] font-semibold tnum">On today's habits you'd level off around {w(land.plateauKg)}, above your {w(goalKg)} goal</p>
          : !goalKg ? <p className="text-[17px] font-semibold tnum">On today's habits you'd level off around {w(land.plateauKg)}</p> : null}
        <p className="text-[15px] text-muted tnum">You burn about {land.burn.toLocaleString('en-AU')} Cal a day{land.burnEstimated ? ' (a rough estimate from your weight until there’s a watch or two weeks of food logs)' : burnFromSteps ? ' (your watch’s resting figure plus your steps)' : ''} and, from your weight change, eat about {land.intake.toLocaleString('en-AU')}. Each kg lighter burns about 22 Cal less, so loss slows as you go.</p>
        {land.plan && <p className="text-[15px] tnum">To reach {w(land.goal!.kg)} in about {land.plan.months} months: about <strong>{land.plan.kcal.toLocaleString('en-AU')} Cal a day</strong> on average (or the same gap from more movement).</p>}
        {land.pace !== 'unknown' && <p className="text-[13px] text-muted">{land.pace === 'expected' ? 'The slowdown so far is what a lighter body burning less explains.'
          : land.pace === 'slower-than-expected' ? 'Slower than a lighter body explains on its own: likely eating a little more, or water held (a new food, salt, a hard week of training).'
          : 'Faster than expected lately: worth checking protein and that you’re eating enough.'}</p>}
      </section>

      <LeversCard levers={levers} goalKg={goalKg} units={units} />
      {muscle && <MuscleWarningCard m={muscle} units={units} />}
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
