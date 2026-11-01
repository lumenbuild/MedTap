// The watch's data as cards, used on the Health tab and also on Today, Training, Sleep, Food and each medicine's page:
// the overnight alert, last night's vitals, training load and fitness, energy in and out, glucose, and what changed
// after starting a medicine.
import { Activity, AlertTriangle, Droplet, Flame, HeartPulse, Wind } from 'lucide-react';
import type { DailyHealth, Dose, Medication } from '../db/schema';
import type { IllnessWatch, VitalStat } from '../logic/vitals';
import { ZONES, type TrainingLoad, type vo2Trend } from '../logic/trainingLoad';
import { medEffects, type MedEffects } from '../logic/medEffects';
import type { EnergyBalance } from '../logic/energy';
import { shownName } from '../logic/privacy';
import { Sparkline } from './ui/Visual';
import { fmtHM } from '../logic/sleep';

const DAY = 86_400_000;
const n0 = (v: number) => Math.round(v).toLocaleString('en-AU');
const signed = (v: number, dp = 0) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(dp)}`;

/** Each zone a step darker in the training colour (ordered, one hue). */
const zoneColour = (z: number) => `color-mix(in srgb, var(--c-act) ${[30, 48, 66, 84, 100][z]}%, var(--fill))`;

export function IllnessCard({ ill }: { ill: IllnessWatch }) {
  return (
    <section className="rounded-card bg-caution-soft p-4 space-y-1.5" aria-labelledby="ill-h">
      <h2 id="ill-h" className="font-semibold flex items-center gap-2"><AlertTriangle size={18} aria-hidden="true" />{ill.level === 'likely' ? 'Your body may be fighting something' : 'A few readings are off together'}</h2>
      <p className="text-[15px]">{ill.signals.join(' · ')}.</p>
      <p className="text-sm text-muted">This pattern often comes a day or two before feeling unwell. An easier day, fluids and sleep help; see a doctor if you feel unwell.</p>
    </section>
  );
}

/** Last night's vitals, each against your usual, with the last month. */
export function NightVitalsCard({ stats, title = 'Overnight' }: { stats: VitalStat[]; title?: string }) {
  const icon = { hrvMs: HeartPulse, restingHr: HeartPulse, respRate: Wind, spo2Avg: Droplet, skinTempDelta: Flame } as const;
  return (
    <section className="box space-y-3" aria-labelledby="nv-h">
      <h2 id="nv-h" className="text-sm font-medium text-muted">{title}</h2>
      <div className="grid grid-cols-2 gap-2">
        {stats.map((v) => {
          const Icon = icon[v.key];
          const value = v.key === 'skinTempDelta' ? signed(v.value, 1) : String(v.value);
          return (
            <div key={v.key} className="rounded-card bg-surface-2 p-3 min-w-0">
              <p className="text-[13px] text-muted font-medium flex items-center gap-1.5"><span aria-hidden="true" className="w-[22px] h-[22px] rounded-[7px] flex items-center justify-center text-white" style={{ background: v.ok ? 'var(--c-sleep)' : 'var(--caution)' }}><Icon size={13} /></span>{v.label}</p>
              <p className="mt-1.5"><span className="text-[24px] font-bold tnum leading-none">{value}</span><span className="text-sm text-muted ml-1">{v.unit}</span></p>
              <p className={`text-[13px] tnum ${v.ok ? 'text-muted' : 'text-caution font-medium'}`}>{v.usual !== undefined ? (Math.abs(v.diff ?? 0) < (v.key === 'hrvMs' || v.key === 'restingHr' ? 1 : 0.1) ? 'Your usual' : `${signed(v.diff!, v.key === 'hrvMs' || v.key === 'restingHr' ? 0 : 1)} vs usual ${v.key === 'skinTempDelta' ? '' : v.usual}`) : v.key === 'skinTempDelta' ? 'from your baseline' : 'Building your usual'}</p>
              {v.series.length >= 3 && <div className="mt-1.5"><Sparkline points={v.series} label={`${v.label}, last month`} height={28} /></div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** This week's training load against your usual, time in each heart-rate zone, and cardio fitness. */
export function LoadCard({ load, vo2 }: { load: TrainingLoad | null; vo2: ReturnType<typeof vo2Trend> }) {
  const maxDay = Math.max(1, ...(load?.days.map((d) => d.load) ?? [1]));
  const zoneTotal = load ? load.zoneWeek.reduce((a, b) => a + b, 0) : 0;
  return (
    <section className="box space-y-4" aria-labelledby="ld-h">
      <h2 id="ld-h" className="text-sm font-medium text-muted flex items-center gap-1.5"><Activity size={16} aria-hidden="true" />Training load</h2>
      {load && (
        <>
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[28px] font-bold tnum leading-none">{n0(load.week)}</p>
              <p className="text-sm text-muted">this week{load.usualWeek ? ` · usual ${n0(load.usualWeek)}` : ''}</p>
            </div>
            {load.status ? <span className={`rounded-full px-3 py-1 text-sm font-semibold ${load.status === 'Spiking' ? 'bg-caution-soft text-caution' : 'bg-surface-2'}`}>{load.status}{load.ratio ? ` · ${Math.round(load.ratio * 100)}%` : ''}</span>
              : <span className="rounded-full px-3 py-1 text-sm font-semibold bg-surface-2">Building your usual</span>}
          </div>
          <div role="img" aria-label={`Load each day, last 4 weeks: ${load.days.map((d) => d.load).join(', ')}`}>
            <div className="flex items-end gap-[2px] h-14" aria-hidden="true">
              {load.days.map((d, i) => <div key={d.t} className="flex-1 rounded-t-[2px]" style={{ height: `${(d.load / maxDay) * 100}%`, minHeight: d.load ? 2 : 0, background: i >= load.days.length - 7 ? 'var(--c-act)' : 'var(--border-strong)' }} />)}
            </div>
            <div className="flex justify-between text-[11px] text-muted mt-1" aria-hidden="true"><span>4 weeks ago</span><span>Today</span></div>
          </div>
          {zoneTotal > 0 && (
            <div>
              <p className="text-sm text-muted mb-1.5">Heart-rate zones this week · max {load.maxHr} bpm</p>
              <div className="flex h-3 rounded-full overflow-hidden gap-[2px]" role="img" aria-label={ZONES.map((z, i) => `${z.label} ${Math.round(load.zoneWeek[i])} min`).join(', ')}>
                {load.zoneWeek.map((m, i) => m > 0 && <div key={i} style={{ width: `${(m / zoneTotal) * 100}%`, background: zoneColour(i) }} />)}
              </div>
              <ul className="grid grid-cols-5 gap-1 mt-1.5 text-[12px] tnum">
                {ZONES.map((z, i) => <li key={z.n} className="flex flex-col items-center text-center min-w-0"><span aria-hidden="true" className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: zoneColour(i) }} /><span className="text-muted text-[11px] leading-4 mt-0.5 max-w-full truncate">{z.label}</span><span className="font-semibold">{Math.round(load.zoneWeek[i])} min</span></li>)}
              </ul>
            </div>
          )}
        </>
      )}
      {vo2 && (
        <div className="flex items-center gap-3 rounded-card bg-surface-2 p-3">
          <div className="flex-1">
            <p className="text-[13px] text-muted font-medium">Cardio fitness (VO2 max)</p>
            <p><span className="text-[24px] font-bold tnum">{vo2.value}</span><span className="text-sm text-muted ml-1">mL/kg/min</span></p>
            {vo2.change !== undefined && <p className={`text-[13px] tnum ${vo2.change > 0 ? 'text-success' : vo2.change < 0 ? 'text-caution' : 'text-muted'}`}>{signed(vo2.change, 1)} over 2 months</p>}
          </div>
          {vo2.points.length >= 3 && <div className="w-28"><Sparkline points={vo2.points} label="VO2 max, last 6 months" height={36} /></div>}
        </div>
      )}
    </section>
  );
}

/** Calories in against calories out, and what that means for weight. */
export function EnergyCard({ e }: { e: EnergyBalance }) {
  const max = Math.max(1, ...e.days.flatMap((d) => [d.burned ?? 0, d.eaten ?? 0]));
  return (
    <section className="box space-y-3" aria-labelledby="en-h">
      <h2 id="en-h" className="text-sm font-medium text-muted flex items-center gap-1.5"><Flame size={16} aria-hidden="true" />Energy in and out</h2>
      <dl className="grid grid-cols-3 gap-2 tnum">
        <div className="rounded-card bg-surface-2 p-3"><dt className="text-[12px] text-muted">Burned today</dt><dd className="text-[20px] font-bold">{e.today.burned !== undefined ? n0(e.today.burned) : '–'}</dd></div>
        <div className="rounded-card bg-surface-2 p-3"><dt className="text-[12px] text-muted">Eaten today</dt><dd className="text-[20px] font-bold">{e.today.eaten !== undefined ? n0(e.today.eaten) : '–'}</dd></div>
        <div className="rounded-card bg-surface-2 p-3"><dt className="text-[12px] text-muted">Usual burn</dt><dd className="text-[20px] font-bold">{e.watchMaintenance ? n0(e.watchMaintenance) : '–'}</dd></div>
      </dl>
      <div role="img" aria-label={`Last 2 weeks, burned and eaten each day: ${e.days.map((d) => `${d.date.slice(5)} ${d.burned ?? '–'} / ${d.eaten ?? '–'}`).join(', ')}`}>
        <div className="flex items-end gap-1 h-20" aria-hidden="true">
          {e.days.map((d) => (
            <div key={d.date} className="flex-1 flex items-end gap-[1px] h-full">
              <div className="flex-1 rounded-t-[2px]" style={{ height: `${((d.burned ?? 0) / max) * 100}%`, background: 'var(--c-act)' }} />
              <div className="flex-1 rounded-t-[2px]" style={{ height: `${((d.eaten ?? 0) / max) * 100}%`, background: 'var(--c-body)' }} />
            </div>
          ))}
        </div>
        <p className="flex gap-4 text-[12px] text-muted mt-1.5" aria-hidden="true">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--c-act)' }} />Burned</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--c-body)' }} />Eaten</span>
        </p>
      </div>
      {e.avgBalance !== undefined ? (
        <p className="text-[15px] tnum">Over {e.balanceDays} logged days: <strong>{signed(e.avgBalance)} kcal a day</strong> ({e.avgBalance < 0 ? 'a deficit' : 'a surplus'}). Kept up, that's about <strong>{signed(e.kgIn4Weeks ?? 0, 1)} kg in 4 weeks</strong>.</p>
      ) : <p className="text-sm text-muted">Log food (here or in another app) on 5+ days to see your balance and where your weight is heading.</p>}
    </section>
  );
}

/** Glucose from a CGM or meter app: the latest day's average and time in range, its hours, and the last 2 weeks. */
export function GlucoseCard({ daily, now }: { daily: DailyHealth[]; now: number }) {
  const days = daily.filter((d) => typeof d.glucoseAvg === 'number' && new Date(`${d.date}T12:00`).getTime() > now - 15 * DAY).sort((a, b) => a.date.localeCompare(b.date));
  const last = days[days.length - 1];
  if (!last) return null;
  const hours = last.glucoseByHour ?? [];
  const hi = Math.max(10, ...hours.filter((x): x is number => typeof x === 'number'));
  return (
    <section className="box space-y-3" aria-labelledby="gl-h">
      <h2 id="gl-h" className="text-sm font-medium text-muted flex items-center gap-1.5"><Droplet size={16} aria-hidden="true" />Glucose</h2>
      <dl className="grid grid-cols-3 gap-2 tnum">
        <div className="rounded-card bg-surface-2 p-3"><dt className="text-[12px] text-muted">Average</dt><dd className="text-[20px] font-bold">{last.glucoseAvg}<span className="text-[12px] font-normal text-muted"> mmol/L</span></dd></div>
        <div className="rounded-card bg-surface-2 p-3"><dt className="text-[12px] text-muted">In range</dt><dd className="text-[20px] font-bold">{last.glucoseInRange ?? '–'}%</dd></div>
        <div className="rounded-card bg-surface-2 p-3"><dt className="text-[12px] text-muted">Low–high</dt><dd className="text-[20px] font-bold">{last.glucoseMin}–{last.glucoseMax}</dd></div>
      </dl>
      {hours.some((x) => typeof x === 'number') && (
        <div role="img" aria-label={`Each hour on ${last.date}: ${hours.map((v, h) => `${h}:00 ${v ?? '–'}`).join(', ')}`}>
          <div className="relative flex items-end gap-[2px] h-16" aria-hidden="true">
            <div className="absolute inset-x-0 border-t border-dashed" style={{ bottom: `${(10 / hi) * 100}%`, borderColor: 'var(--border-strong)' }} />
            {hours.map((v, h) => <div key={h} className="flex-1 rounded-t-[2px]" style={{ height: `${((v ?? 0) / hi) * 100}%`, background: typeof v === 'number' && (v > 10 || v < 3.9) ? 'var(--caution)' : 'var(--c-body)' }} />)}
          </div>
          <div className="flex justify-between text-[11px] text-muted mt-1" aria-hidden="true"><span>12 am</span><span>12 pm</span><span>11 pm</span></div>
        </div>
      )}
      {days.length >= 3 && <Sparkline points={days.map((d) => ({ t: new Date(`${d.date}T12:00`).getTime(), v: d.glucoseAvg! }))} label="Daily average glucose, last 2 weeks" height={32} />}
    </section>
  );
}

/** What moved after starting a medicine. */
export function MedEffectsList({ med, e, link = false }: { med: Medication; e: MedEffects; link?: boolean }) {
  const name = shownName(med);
  return (
    <div className="space-y-1.5">
      {link ? <a href={`#/meds/${med.id}/patterns`} className="font-semibold underline underline-offset-4">{name}</a> : null}
      <ul className="space-y-1">
        {e.effects.map((x) => (
          <li key={x.key} className="flex items-baseline justify-between gap-3 tnum text-[15px]">
            <span>{x.label}</span>
            <span><span className="text-muted">{fmt(x.before, x.key)} → </span><span className={`font-semibold ${x.better === undefined ? '' : x.better ? 'text-success' : 'text-caution'}`}>{fmt(x.after, x.key)}</span> <span className="text-muted">{x.unit}</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
const fmt = (v: number, key: string) => (key === 'sleepMin' || key === 'sleepDeepMin' ? fmtHM(v) : key === 'steps' || key === 'kcalTotal' ? n0(v) : String(v));

/** On a medicine's page: what moved in the watch's numbers since starting it. */
export function MedEffectsCard({ med, doses, daily, now }: { med: Medication; doses: Dose[]; daily: DailyHealth[]; now: number }) {
  const e = medEffects(med, doses, daily, now);
  if (!e || !e.checked) return null;
  return (
    <section className="box space-y-2" aria-labelledby={`fx-${med.id}`}>
      <h2 id={`fx-${med.id}`} className="text-sm font-medium text-muted">Your body since starting</h2>
      {e.effects.length ? <MedEffectsList med={med} e={e} /> : <p className="text-[15px]">No clear change in the {e.checked} measures the watch has before and since.</p>}
      <p className="text-sm text-muted">The 4 weeks before the first dose against the latest 4 weeks. Other things change over the same time too.</p>
    </section>
  );
}


