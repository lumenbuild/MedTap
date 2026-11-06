// Vitamins and minerals on the Food tab: the day (or the last 7 days' average) against your targets, one bar each,
// grouped; what runs low this week and the foods (your own first) that would fix it; and how much of the food it
// could count.
import { useState } from 'react';
import { Leaf } from 'lucide-react';
import type { FoodLog } from '../../db/schema';
import { fmtMicro, microTotals, microWeek, type MicroRow } from '../../logic/micros';
import { Segmented } from '../ui/Field';

export function MicrosCard({ logs, from, to, now, sex, age, dayLabel }: { logs: FoodLog[]; from: number; to: number; now: number; sex?: 'm' | 'f'; age?: number; dayLabel: string }) {
  const [view, setView] = useState<'day' | 'week'>('day');
  const day = microTotals(logs, from, to, { sex, age });
  const week = microWeek(logs, now, { sex, age });
  if (day.kcal === 0 && !week) return null;
  const shown = view === 'week' && week ? week.avg : day;
  const group = (kind: 'vitamin' | 'mineral') => shown.rows.filter((r) => r.kind === kind);
  return (
    <section className="box space-y-3" aria-labelledby="micro-h">
      <div className="flex items-center justify-between gap-2">
        <h2 id="micro-h" className="font-semibold flex items-center gap-1.5"><Leaf size={16} aria-hidden="true" />Vitamins and minerals</h2>
      </div>
      {week && <Segmented<'day' | 'week'> label="Show" value={view} onChange={setView} options={[{ value: 'day', label: dayLabel }, { value: 'week', label: '7-day average' }]} />}
      {shown.kcal === 0 ? <p className="text-muted">Nothing logged {dayLabel === 'Today' ? 'yet today' : 'this day'}.</p> : (
        <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2">
          {(['vitamin', 'mineral'] as const).map((k) => (
            <div key={k}>
              <h3 className="text-[12px] font-medium text-muted uppercase tracking-wide mb-1.5">{k === 'vitamin' ? 'Vitamins' : 'Minerals'}</h3>
              <ul className="space-y-1.5">{group(k).map((r) => <MicroBar key={r.key} r={r} />)}</ul>
            </div>
          ))}
        </div>
      )}
      {view === 'week' && week && week.lows.length > 0 && (
        <div className="rounded-btn bg-caution-soft p-3 space-y-2">
          <p className="font-semibold">Low this week</p>
          <ul className="space-y-1.5 text-[15px]">
            {week.lows.map((l) => (
              <li key={l.key}><span className="font-medium">{l.label}</span> <span className="tnum">({l.pct}% of target)</span>: {l.yours.length ? <>more of your <span className="font-medium">{l.yours.join(', ')}</span>, or </> : ''}{l.foods.slice(0, 3).join(', ').toLowerCase()}.</li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[12px] text-muted">
        {Math.round(shown.coverage * 100)}% of {view === 'week' ? 'the week' : 'the day'}'s food counted{shown.estimated ? ', partly estimated from what each food is' : ''}. Targets: Australian and NZ reference values{sex ? '' : ' (set your sex in Health for your own)'}.
      </p>
    </section>
  );
}

function MicroBar({ r }: { r: MicroRow }) {
  const pct = Math.min(100, r.pct);
  const tone = r.over ? 'var(--danger)' : r.pct >= 100 ? 'var(--success)' : r.pct >= 70 ? 'var(--primary)' : 'var(--caution)';
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className="truncate">{r.label}</span>
        <span className="tnum text-muted shrink-0">{fmtMicro(r.amount, r.unit)} · <span className="font-semibold" style={{ color: r.over || r.pct < 70 ? tone : undefined }}>{r.pct}%</span></span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--fill)' }} role="img" aria-label={`${r.label}: ${r.pct}% of ${fmtMicro(r.target, r.unit)}${r.over ? ', over the upper limit' : ''}`}>
        <div className="h-full rounded-full" style={{ width: `${Math.max(pct, r.amount > 0 ? 3 : 0)}%`, background: tone }} />
      </div>
    </li>
  );
}
