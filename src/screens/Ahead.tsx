// The week ahead: what to watch for this week, then each day with its shots, what usually follows them for you, and
// what to do about it. How sure each part is, and how the forecast did last month, at the foot.
import { format } from 'date-fns';
import { AlertTriangle, Coffee, Droplets, Dumbbell, HeartPulse, Moon, Scale, Syringe, Utensils, type LucideIcon } from 'lucide-react';
import { useDecisionData } from '../app/useDecisions';
import { useNow } from '../app/useNow';
import { weekAhead, type AdviceKind, type DayAhead } from '../logic/weekAhead';
import { fmtAmount } from '../logic/format';
import { fmtWeight } from '../logic/units';
import { HAS_PEPTIDES } from '../edition';

const KIND_ICON: Record<AdviceKind, LucideIcon> = { food: Utensils, water: Droplets, train: Dumbbell, sleep: Moon, caffeine: Coffee };

export function useWeekAhead() {
  const dd = useDecisionData();
  const now = useNow(1_800_000);
  if (!dd || dd.everyone) return null;
  const { data, settings, s } = dd;
  return { w: weekAhead(data, { waterTargetMl: settings.waterTargetMl, fibreTargetG: settings.fibreTargetG, proteinTargetG: settings.proteinTargetG, bedtime: settings.bedtime,
    caffeineCutoff: settings.caffeineCutoff, orders: HAS_PEPTIDES ? settings.peptideOrders : [] }, now, s), units: settings.units, now };
}

export function Ahead() {
  const r = useWeekAhead();
  if (!r) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const { w, units, now } = r;
  const anything = w.days.some((d) => d.shots.length || d.effects.length || d.advice.length) || w.risks.length;
  return (
    <div className="space-y-4">
      {w.risks.length > 0 && (
        <section className="box space-y-2.5" aria-labelledby="risk-h">
          <h2 id="risk-h" className="font-semibold flex items-center gap-1.5"><AlertTriangle size={17} aria-hidden="true" className="text-caution" />Watch for this week</h2>
          <ul className="space-y-2.5">
            {w.risks.map((x) => (
              <li key={x.key} className={`rounded-btn p-3 ${x.level === 'watch' ? 'bg-caution-soft' : 'bg-surface-2'}`}>
                <p className="font-semibold leading-snug">{x.title}</p>
                <p className="text-[15px] leading-snug mt-0.5">{x.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {anything ? (
        <ol className="space-y-3" aria-label="Day by day">
          {w.days.map((d, i) => <DayCard key={d.date} d={d} label={i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : format(d.start + 43_200_000, 'EEEE')} units={units} />)}
        </ol>
      ) : <p className="box text-muted">The forecast builds up from your shots and check-ins: a few weeks of both, and it starts.</p>}

      {w.prescriber.length > 0 && (
        <section className="box space-y-2" aria-labelledby="rx-h">
          <h2 id="rx-h" className="font-semibold">Worth raising with your prescriber</h2>
          {w.prescriber.map((p) => (
            <div key={p.title}><p className="font-medium leading-snug">{p.title}</p><ul className="text-[14px] text-muted list-disc pl-5">{p.why.map((x) => <li key={x}>{x}</li>)}</ul></div>
          ))}
        </section>
      )}

      <section className="text-[13px] text-muted space-y-1 px-1">
        {w.accuracy && <p className="tnum">Last month, the side-effect forecast was right on {w.accuracy.right} of {w.accuracy.of} days it could be checked ({Math.round((w.accuracy.right / w.accuracy.of) * 100)}%).</p>}
        {w.basis.length > 0 && <p>From {w.basis.join('; ')}.</p>}
        <p>Forecasts from your own records; the dose is between you and your prescriber. Updated {format(now, 'h:mm a')}.</p>
      </section>
    </div>
  );
}

function DayCard({ d, label, units }: { d: DayAhead; label: string; units: 'metric' | 'imperial' }) {
  const facts: { Icon: LucideIcon; text: string; tone?: 'watch' | 'good' }[] = [];
  if (d.hrDelta !== undefined) facts.push({ Icon: HeartPulse, text: `Resting HR ${d.hrDelta > 0 ? '+' : '−'}${Math.abs(d.hrDelta)}`, tone: d.hrDelta > 0 ? 'watch' : 'good' });
  if (d.sleepDelta !== undefined) facts.push({ Icon: Moon, text: `Sleep ${d.sleepDelta > 0 ? '+' : '−'}${Math.abs(d.sleepDelta)} min`, tone: d.sleepDelta < 0 ? 'watch' : 'good' });
  if (d.appetite && d.appetite !== 'usual') facts.push({ Icon: Utensils, text: `Appetite ${d.appetite}` });
  if (d.weightKg !== undefined) facts.push({ Icon: Scale, text: fmtWeight(d.weightKg, units) });
  return (
    <li className={`box space-y-2 ${d.trainDay === 'easy' || d.effects.length ? 'border-l-4' : ''}`} style={d.trainDay === 'easy' || d.effects.length ? { borderLeftColor: 'var(--caution)' } : undefined}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold text-[17px]">{label}</h2>
        <span className="text-[13px] text-muted">{format(d.start + 43_200_000, 'd MMM')}</span>
      </div>
      {d.shots.length > 0 && (
        <p className="flex flex-wrap gap-1.5">{d.shots.map((x) => (
          <span key={x.med.id} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-medium" style={{ background: 'var(--fill)' }}><Syringe size={13} aria-hidden="true" />{x.name} {fmtAmount(x.amount, x.unit)}</span>
        ))}</p>
      )}
      {d.effects.length > 0 && (
        <p className="flex flex-wrap gap-1.5">{d.effects.map((e) => (
          <span key={`${e.name}${e.chip}`} className="rounded-full px-2.5 py-1 text-[13px] bg-caution-soft tnum">{e.chip} likely · {e.pct}%</span>
        ))}</p>
      )}
      {facts.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[14px] tnum">
          {facts.map((f) => <li key={f.text} className={`inline-flex items-center gap-1.5 ${f.tone === 'watch' ? 'text-caution' : ''}`}><f.Icon size={14} aria-hidden="true" />{f.text}</li>)}
        </ul>
      )}
      {d.advice.length > 0 && (
        <ul className="space-y-1.5 pt-1 border-t border-border">
          {d.advice.map((a) => { const Icon = KIND_ICON[a.kind]; return (
            <li key={a.key} className="flex gap-2.5 pt-1.5"><Icon size={17} aria-hidden="true" className="shrink-0 mt-0.5 text-primary" />
              <span><span className="block font-medium leading-snug">{a.text}</span><span className="block text-[13px] text-muted leading-snug">{a.why}</span></span></li>
          ); })}
        </ul>
      )}
      {!d.shots.length && !d.effects.length && !facts.length && !d.advice.length && <p className="text-[14px] text-muted">Nothing usual stands out.</p>}
    </li>
  );
}
