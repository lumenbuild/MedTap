// Forecast cards: a stall coming, tomorrow's weigh-in, each habit's worth in days, muscle going too fast (Body);
// appetite across the shot week, after a short night, and when cravings hit (Food).
import { format } from 'date-fns';
import { Cookie, Dumbbell, Moon, Sparkles, Syringe, TrendingDown } from 'lucide-react';
import type { CravingForecast, HungerWeek, Lever, MuscleWarning, NextWeighIn, PlateauAhead, ShortNight } from '../logic/aheadSmarts';
import { fmtHour } from '../logic/aheadSmarts';
import { fmtWeight } from '../logic/units';
import type { Units } from '../db/repos/settings';

const H = ({ id, Icon, children }: { id: string; Icon: typeof Moon; children: React.ReactNode }) =>
  <h2 id={id} className="text-sm font-medium text-muted flex items-center gap-1.5"><Icon size={15} aria-hidden="true" />{children}</h2>;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function NextWeighInLine({ n, units }: { n: NextWeighIn; units: Units }) {
  return (
    <p className="text-[15px] tnum mt-2"><strong>Tomorrow morning:</strong> likely {fmtWeight(n.lo, units)} to {fmtWeight(n.hi, units)}
      {n.nudges.length ? <span className="text-[13px]"> (includes {n.nudges.join(', ')})</span> : null}</p>
  );
}

export function PlateauCard({ p }: { p: PlateauAhead }) {
  return (
    <section className="box space-y-2" aria-labelledby="plat-h">
      <H id="plat-h" Icon={TrendingDown}>{p.level === 'high' ? 'A stall is likely in the next week or two' : 'Loss likely to slow soon'}</H>
      <p className="text-[15px]">About <strong>{p.shrinkPct}%</strong> of your daily gap has been eaten into over the last 2 weeks, often before the scale shows it:</p>
      <ul className="text-[14px] space-y-0.5">{p.reasons.map((r) => <li key={r}>• {cap(r)}</li>)}</ul>
      {p.fixes.length > 0 && <p className="text-[15px]">To keep going: {p.fixes.join(', and ')}.</p>}
    </section>
  );
}

export function LeversCard({ levers, goalKg, units }: { levers: Lever[]; goalKg?: number; units: Units }) {
  if (!levers.length) return null;
  const max = Math.max(...levers.map((l) => l.days));
  return (
    <section className="box space-y-2" aria-labelledby="lev-h">
      <H id="lev-h" Icon={Sparkles}>A month of each, in days{goalKg ? ` to ${fmtWeight(goalKg, units)}` : ''}</H>
      <ul className="space-y-2">
        {levers.map((l) => (
          <li key={l.what}>
            <div className="flex justify-between gap-3 text-[14px]"><span className="min-w-0">{cap(l.what)}</span><span className="tnum font-semibold shrink-0">{l.days} {l.days === 1 ? 'day' : 'days'} sooner</span></div>
            <div className="h-1.5 mt-1 rounded-full bg-surface-2" aria-hidden="true"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${(l.days / max) * 100}%` }} /></div>
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-muted">Kept up for a month, at your current pace. They add together, and keep adding each month.</p>
    </section>
  );
}

export function MuscleWarningCard({ m, units }: { m: MuscleWarning; units: Units }) {
  return (
    <section className="box space-y-2" aria-labelledby="mw-h">
      <H id="mw-h" Icon={Dumbbell}>Muscle going faster than it should</H>
      <p className="text-[15px] tnum">Of the last {fmtWeight(m.kgLost, units)} lost, your scale puts about <strong>{Math.round(m.share * 100)}%</strong> as lean mass ({fmtWeight(m.leanLost, units)}). For the fat you have to lose, about {Math.round(m.expected * 100)}% is expected.</p>
      {m.reasons.length > 0 && <ul className="text-[14px] space-y-0.5">{m.reasons.map((r) => <li key={r}>• {cap(r)}</li>)}</ul>}
      {m.fixes.length > 0 && <p className="text-[15px]">What protects it: {m.fixes.join(', ')}.</p>}
      <p className="text-[12px] text-muted">Scales estimate lean mass from water, so a few days can mislead; this is from the trend over 5 weeks.</p>
    </section>
  );
}

const DAYS = ['Shot', 'Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6'];

export function HungerWeekCard({ h, proteinPicks }: { h: HungerWeek; proteinPicks: string[] }) {
  const vals = h.byDay.map((d) => d.appetite ?? (d.kcal !== undefined ? d.kcal / 600 : undefined));
  const max = Math.max(...vals.filter((v): v is number => v !== undefined), 1);
  const isToday = h.nextPeak !== undefined && new Date(h.nextPeak).toDateString() === new Date().toDateString();
  return (
    <section className="box space-y-2" aria-labelledby="hw-h">
      <H id="hw-h" Icon={Syringe}>Appetite across your shot week</H>
      {h.nextPeak !== undefined && <p className="text-[17px] font-semibold">{isToday ? 'Today' : format(h.nextPeak, 'EEEE')}: appetite usually back{h.extraKcal ? `, about ${h.extraKcal} Cal more eaten` : ''}</p>}
      <div className="flex items-end gap-1.5 h-16" role="img" aria-label={h.byDay.map((d, i) => `${DAYS[i]}: ${d.appetite !== undefined ? `appetite ${d.appetite}` : ''}${d.kcal !== undefined ? ` ${d.kcal} Cal` : ''}`).join(', ')}>
        {vals.map((v, i) => (
          <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
            <div className="w-full max-w-[28px] rounded-t-[4px]" style={{ height: v !== undefined ? `${Math.max(8, (v / max) * 100)}%` : 0, background: h.peakDays.includes(i) ? 'var(--caution)' : 'var(--border-strong)' }} />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5" aria-hidden="true">{DAYS.map((d, i) => <span key={d} className={`flex-1 text-center text-[11px] ${h.peakDays.includes(i) ? 'font-semibold' : 'text-muted'}`}>{d.replace('Day ', 'D')}</span>)}</div>
      {proteinPicks.length > 0 && <p className="text-[14px]">Plan for it: protein first that day, from {proteinPicks.join(', ')}. Protein is the most filling per calorie.</p>}
    </section>
  );
}

export function ShortNightBanner({ n }: { n: ShortNight }) {
  return (
    <section className="box space-y-1 border-l-4" style={{ borderLeftColor: 'var(--caution)' }} aria-labelledby="sn-h">
      <H id="sn-h" Icon={Moon}>A short night{n.sleepMin ? ` (${Math.floor(n.sleepMin / 60)} h ${n.sleepMin % 60} min)` : ''}</H>
      <p className="text-[15px]">After nights like this you usually eat about <strong>{n.extra} Cal more</strong>. Tired brains want quick energy: have protein and something with fibre early, keep snacks out of reach, and an early night resets it.</p>
    </section>
  );
}

export function CravingCard({ c }: { c: CravingForecast }) {
  return (
    <section className="box space-y-1" aria-labelledby="cr-h">
      <H id="cr-h" Icon={Cookie}>When cravings hit</H>
      <p className="text-[15px]">{c.today ? <><strong>Today</strong>: usually around <strong>{fmtHour(c.today.hour)}–{fmtHour((c.today.hour + 2) % 24)}</strong> on a {format(new Date(), 'EEEE')}.</> : <>Most often around <strong>{fmtHour(c.usual.hour)}–{fmtHour((c.usual.hour + 2) % 24)}</strong> ({Math.round(c.usual.share * 100)}% of {c.events}).</>}</p>
      <p className="text-[14px] text-muted">A planned protein snack 30 minutes before takes the edge off. With reminders on, a nudge comes then.</p>
    </section>
  );
}
