// Body's scale insights: what the loss has been made of, fat's pace and when it reaches a healthy range, what the
// goal weight means for body fat, recomposition, what protects muscle in your own weeks, today's reading and water,
// and metabolic age and visceral fat at the goal.
import { format } from 'date-fns';
import { Droplets, Flag, Flame, Layers, ShieldCheck, Sparkles } from 'lucide-react';
import type { BodyEntry, DailyHealth, Workout } from '../db/schema';
import type { Units } from '../db/repos/settings';
import { atGoalWeight, bodyFatBand, fatForecast, lossMix, muscleEvidence, recomp, todayWater } from '../logic/scaleInsights';
import { fmtWeight } from '../logic/units';

const H = ({ id, Icon, children }: { id: string; Icon: typeof Flame; children: React.ReactNode }) =>
  <h2 id={id} className="text-sm font-medium text-muted flex items-center gap-1.5"><Icon size={15} aria-hidden="true" />{children}</h2>;
const sgn = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '');

export function ScaleInsights({ entries, daily, workouts, proteinTarget, sex, goalKg, units, now, today, onAbout }: {
  entries: BodyEntry[]; daily: DailyHealth[]; workouts: Workout[]; proteinTarget: number | null; sex?: 'm' | 'f'; goalKg?: number; units: Units; now: number; today: string;
  /** Where to set sex (for healthy ranges), when it isn't set. */ onAbout?: () => void;
}) {
  const w = (kg: number) => fmtWeight(Math.abs(kg), units);
  const water = todayWater(entries, today);
  const mix = lossMix(entries, now);
  const ff = fatForecast(entries, sex, goalKg, now);
  const rc = recomp(entries, now);
  const ev = muscleEvidence({ body: entries, daily, workouts, proteinTarget }, now);
  const ag = atGoalWeight(entries, goalKg, now);
  if (!water && !mix && !ff && !rc && !ev && !ag) return null;
  return (
    <>
      {water && (
        <section className="box space-y-1 border-l-4" style={{ borderLeftColor: 'var(--primary)' }} aria-labelledby="tw2-h">
          <H id="tw2-h" Icon={Droplets}>Today's reading</H>
          <p className="text-[15px]">{water.text}</p>
        </section>
      )}

      {rc && (
        <section className="box space-y-1 border-l-4" style={{ borderLeftColor: 'var(--success)' }} aria-labelledby="rc-h">
          <H id="rc-h" Icon={Sparkles}>Recomposition: progress the scale hides</H>
          <p className="text-[15px] tnum">Weight about steady over 4 weeks, but fat <strong>{sgn(rc.fat)}{w(rc.fat)}</strong> and lean <strong>+{w(rc.lean)}</strong>. Strength training and protein doing their job.</p>
        </section>
      )}

      {mix && (
        <section className="box space-y-3" aria-labelledby="mix-h">
          <H id="mix-h" Icon={Layers}>What you've lost since {format(new Date(`${mix.since}T12:00`), 'd MMM')}</H>
          <div className="grid grid-cols-3 gap-2 tnum">
            <div><p className="text-[22px] font-bold leading-tight whitespace-nowrap">{w(mix.fatLost)}</p><p className="text-[12px] text-muted">fat {mix.fatLost < 0 ? 'gained' : 'lost'}</p></div>
            <div><p className="text-[22px] font-bold leading-tight whitespace-nowrap text-muted">{mix.leanLost < 0 ? '+' : ''}{w(mix.leanLost)}</p><p className="text-[12px] text-muted">lean {mix.leanLost < 0 ? 'gained' : 'lost'}: muscle, water, organs</p></div>
            <div><p className="text-[22px] font-bold leading-tight whitespace-nowrap">{w(mix.kgLost)}</p><p className="text-[12px] text-muted">in all</p></div>
          </div>
          {mix.kgLost > 0 && mix.fatLost > 0 && (
            <div className="flex h-3 rounded-full overflow-hidden" role="img" aria-label={`${Math.round((mix.fatLost / mix.kgLost) * 100)}% of the loss fat`}>
              <div style={{ width: `${Math.min(100, (mix.fatLost / mix.kgLost) * 100)}%`, background: 'var(--caution)' }} />
              <div style={{ flex: 1, background: 'var(--border-strong)' }} />
            </div>
          )}
          {mix.weeks.length >= 3 && (
            <div>
              <p className="text-[12px] text-muted mb-1">Week by week: fat (amber) and lean (grey)</p>
              <div className="flex items-center gap-1.5 h-20" role="img" aria-label={mix.weeks.map((x) => `Week of ${format(x.start, 'd MMM')}: fat ${sgn(x.fat)}${Math.abs(x.fat)} kg, lean ${sgn(x.lean)}${Math.abs(x.lean)} kg`).join('; ')}>
                {(() => {
                  const max = Math.max(0.5, ...mix.weeks.flatMap((x) => [Math.abs(x.fat), Math.abs(x.lean)]));
                  return mix.weeks.map((x) => (
                    <div key={x.start} className="flex-1 h-full flex gap-0.5 items-center" aria-hidden="true">
                      {[['fat', x.fat, 'var(--caution)'], ['lean', x.lean, 'var(--border-strong)']].map(([k, v, c]) => (
                        <div key={k as string} className="flex-1 h-full relative">
                          <div className="absolute inset-x-0" style={{ background: c as string, borderRadius: 3, height: `${(Math.abs(v as number) / max) * 50}%`, ...(Number(v) < 0 ? { top: '50%' } : { bottom: '50%' }) }} />
                        </div>
                      ))}
                    </div>
                  ));
                })()}
              </div>
              <p className="text-[11px] text-muted">Below the middle is lost, above is gained.</p>
            </div>
          )}
        </section>
      )}

      {ff && (
        <section className="box space-y-2" aria-labelledby="ff-h">
          <H id="ff-h" Icon={Flame}>Body fat: where it's heading</H>
          <p className="text-[15px] tnum"><strong className="text-[22px]">{ff.bf}%</strong> body fat ({w(ff.fatKg)} of fat, {w(ff.leanKg)} lean){sex ? ` · ${bodyFatBand(ff.bf, sex)}` : ''}
            {ff.fatPerWeek !== undefined ? <>, {ff.fatPerWeek < 0 ? 'losing' : 'gaining'} <strong>{w(ff.fatPerWeek)} of fat a week</strong></> : ''}.</p>
          <p className="text-[15px] tnum">A healthy {ff.healthyBf}% with your lean mass is about <strong>{w(ff.healthyKg)}</strong>{ff.healthyBy ? <>: at this pace, around <strong>{format(ff.healthyBy, 'MMM yyyy')}</strong></> : ''}.</p>
          {ff.atGoal && (
            <div className={`rounded-btn p-3 text-[15px] tnum ${ff.atGoal.tooLean ? 'bg-caution-soft' : 'bg-surface-2'}`}>
              <p><Flag size={14} className="inline -mt-0.5 mr-1" aria-hidden="true" />At your {w(ff.atGoal.kg)} goal: about <strong>{ff.atGoal.atShare}%</strong> body fat if the loss keeps its mix ({Math.round(ff.atGoal.share * 100)}% lean), or {ff.atGoal.keepAll}% keeping all your lean mass.</p>
              {ff.atGoal.tooLean
                ? <p className="mt-1">That's leaner than is healthy to keep. With your lean mass, a goal around <strong>{w(ff.atGoal.sensibleKg)}</strong> is the lowest sensible one, and the more muscle you keep the higher it sits. Worth talking through with your doctor.</p>
                : ff.atGoal.leanMustGo !== undefined && <p className="mt-1">So reaching {w(ff.atGoal.kg)} also means losing at least <strong>{w(ff.atGoal.leanMustGo)}</strong> of lean mass. If you'd rather keep your muscle, about <strong>{w(ff.atGoal.sensibleKg)}</strong> is the floor.</p>}
            </div>
          )}
          {!sex && onAbout && <button type="button" onClick={onAbout} className="min-h-[44px] text-[14px] font-medium underline underline-offset-4">Set your sex for healthy ranges</button>}
          <p className="text-[12px] text-muted">Healthy upper end: men 25%, women 32%. Scales put body fat a few points off a DEXA scan; the trend is reliable.</p>
        </section>
      )}

      {ag && (
        <section className="box space-y-2" aria-labelledby="ag-h">
          <H id="ag-h" Icon={Flag}>At {w(ag.kg)}, from your own readings</H>
          <ul className="grid grid-cols-2 gap-2">
            {ag.metabolicAge && <li className="rounded-btn bg-surface-2 p-3"><p className="text-[12px] text-muted">Metabolic age</p><p className="text-[20px] font-bold tnum">{ag.metabolicAge.now} → {ag.metabolicAge.atGoal}</p></li>}
            {ag.visceral && <li className="rounded-btn bg-surface-2 p-3"><p className="text-[12px] text-muted">Visceral fat</p><p className="text-[20px] font-bold tnum">{ag.visceral.now} → {ag.visceral.atGoal}</p><p className="text-[11px] text-muted">{ag.visceral.atGoal <= 9 ? 'healthy range' : 'still above 9'}</p></li>}
          </ul>
          <p className="text-[12px] text-muted">How each has moved with your weight so far, carried on to the goal.</p>
        </section>
      )}

      {ev && (
        <section className="box space-y-2" aria-labelledby="ev-h">
          <H id="ev-h" Icon={ShieldCheck}>What protects your muscle, in your own weeks</H>
          <ul className="space-y-2">
            {ev.rows.map((r) => (
              <li key={r.what} className="text-[15px] tnum">
                <p className="font-medium">{r.what}</p>
                <p>Lean {sgn(r.with)}{w(r.with)} a week ({r.weeksWith} weeks with) against {sgn(r.without)}{w(r.without)} ({r.weeksWithout} without)</p>
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-muted">From the scale's lean mass, week to week. More weeks make it surer.</p>
        </section>
      )}
    </>
  );
}
