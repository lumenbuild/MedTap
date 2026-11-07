// "Your week", day by day: small charts that share the week's seven columns, one per measure, each on its own scale
// (never two scales on one chart). Doses are dots (filled taken, outlined not), sleep and steps are bars, weight and
// mood are a line with dots. A dashed line in each is the week before's average. Touch a column to read that day.
import { useState } from 'react';
import type { Units } from '../db/repos/settings';
import { kgTo, weightUnit } from '../logic/units';
import type { WeekRow } from '../logic/weekDays';

const LABEL: Record<WeekRow['key'], string> = { doses: 'Doses', weight: 'Weight', sleep: 'Sleep', steps: 'Steps', mood: 'Mood' };
const W = 280, H = 44, PAD = 6;

export function WeekByDay({ days, rows, units }: { days: string[]; rows: WeekRow[]; units: Units }) {
  const [day, setDay] = useState<number | null>(null);
  if (!rows.length) return null;
  const fmt = (k: WeekRow['key'], v: number) =>
    k === 'weight' ? `${kgTo(v, units)} ${weightUnit(units)}` : k === 'sleep' ? `${v.toFixed(1)} h` : k === 'steps' ? Math.round(v).toLocaleString('en-AU')
      : k === 'mood' ? `${v.toFixed(1)} of 5` : `${Math.round(v * 100)}%`;
  const cx = (i: number) => PAD + ((i + 0.5) / 7) * (W - 2 * PAD);
  const letters = days.map((d) => new Date(`${d}T12:00`).toLocaleDateString('en-AU', { weekday: 'narrow' }));
  const longDay = (i: number) => new Date(`${days[i]}T12:00`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short' });

  return (
    <section className="box space-y-3" aria-labelledby="wbd-h">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="wbd-h" className="text-sm font-medium text-muted">Day by day</h2>
        <span className="text-[12px] text-muted inline-flex items-center gap-1.5" aria-hidden="true">
          <svg width="18" height="6"><line x1="0" x2="18" y1="3" y2="3" stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="3 3" /></svg>week before
        </span>
      </div>
      {day !== null && <p className="text-[13px] font-medium" aria-live="polite">{longDay(day)}</p>}
      {rows.map((r) => {
        const vals = r.values.map((v) => (v === null ? null : r.key === 'weight' ? kgTo(v, units) : v));
        const prev = r.prevAvg === null ? null : r.key === 'weight' ? kgTo(r.prevAvg, units) : r.prevAvg;
        const nums = [...vals.filter((v): v is number => v !== null), ...(prev !== null ? [prev] : [])];
        const bars = r.key === 'sleep' || r.key === 'steps';
        const lo = bars ? 0 : r.key === 'mood' ? 1 : Math.min(...nums), hi = r.key === 'mood' ? 5 : Math.max(...nums);
        const y = (v: number) => PAD + (1 - (v - lo) / Math.max(1e-9, hi - lo)) * (H - 2 * PAD);
        const picked = day !== null ? r.values[day] : null;
        const right = day !== null
          ? (r.key === 'doses' && r.counts ? `${r.counts[day].taken} of ${r.counts[day].planned}` : picked === null ? '–' : fmt(r.key, picked))
          : r.avg === null ? '' : `${fmt(r.key, r.avg)}${r.prevAvg !== null ? ` · ${fmt(r.key, r.prevAvg)} before` : ''}`;
        const desc = days.map((_, i) => `${letters[i]} ${r.key === 'doses' && r.counts ? `${r.counts[i].taken} of ${r.counts[i].planned}` : r.values[i] === null ? 'none' : fmt(r.key, r.values[i]!)}`).join(', ');
        const pts = vals.map((v, i) => (v === null ? null : { x: cx(i), y: y(v) })).filter((p): p is { x: number; y: number } => p !== null);
        return (
          <div key={r.key}>
            <div className="flex items-baseline justify-between gap-2 text-[13px]">
              <span className="font-medium">{LABEL[r.key]}{r.key === 'doses' ? ' taken' : ''}</span>
              <span className="tnum text-muted">{right}</span>
            </div>
            <svg role="img" aria-label={`${LABEL[r.key]}: ${desc}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full block touch-pan-y" style={{ height: H }}
              onPointerDown={(e) => pick(e)} onPointerMove={(e) => e.buttons || e.pointerType === 'mouse' ? pick(e) : undefined} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setDay(null); }}>
              {day !== null && <rect x={cx(day) - (W - 2 * PAD) / 14} width={(W - 2 * PAD) / 7} y={0} height={H} fill="var(--surface-2)" />}
              {r.key === 'doses' && r.counts ? r.counts.map((c, i) => {
                // Up to 4 dots a day, filled for taken, outlined for planned but not taken.
                const n = Math.min(4, Math.max(c.planned, c.taken)), gap = 9;
                return Array.from({ length: n }, (_, j) => {
                  const done = j < c.taken;
                  return <circle key={`${i}-${j}`} cx={cx(i)} cy={H / 2 + (j - (n - 1) / 2) * gap} r={3.5} fill={done ? 'var(--text)' : 'none'}
                    stroke={done ? 'var(--surface)' : 'var(--text-muted)'} strokeWidth={done ? 1.5 : 1.25} vectorEffect="non-scaling-stroke" />;
                });
              }) : bars ? vals.map((v, i) => v === null ? null : (
                <rect key={i} x={cx(i) - 6} width={12} y={y(v)} height={Math.max(2, H - PAD - y(v))} rx={3} fill="var(--text)" />
              )) : (
                <>
                  {pts.length > 1 && <path d={pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('')} fill="none" stroke="var(--text)" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
                  {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={4} fill="var(--text)" stroke="var(--surface)" strokeWidth={2} vectorEffect="non-scaling-stroke" />)}
                </>
              )}
              {r.key !== 'doses' && prev !== null && <line x1={PAD} x2={W - PAD} y1={y(prev)} y2={y(prev)} stroke="var(--text-muted)" strokeWidth={1.5} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
            </svg>
          </div>
        );
      })}
      <div className="grid grid-cols-7 text-center text-[12px] text-muted" aria-hidden="true" style={{ paddingInline: `${(PAD / W) * 100}%` }}>
        {letters.map((l, i) => <span key={i} className={day === i ? 'font-semibold text-text' : ''}>{l}</span>)}
      </div>
    </section>
  );

  function pick(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const f = ((e.clientX - r.left) / r.width * W - PAD) / (W - 2 * PAD);
    setDay(Math.max(0, Math.min(6, Math.floor(f * 7))));
  }
}
