// How a stimulant dose shows in the watch's heart rate: the usual rise over the hour before, at rest, from the dose to
// 8 hours after, with when it starts showing, peaks and settles back. A line with a soft wash, three labelled marks,
// and a table of the same numbers.
import type { Medication } from '../db/schema';
import { heartResponse, type HeartResponse } from '../logic/watchSignals';
import { isStimulant } from '../logic/stimulant';
import { personOf } from '../db/repos/people';
import { useCheckIns, useDaily, useDoses, useScheduleSettings } from '../app/data';
import { useNow } from '../app/useNow';

const hm = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`);

export function DoseHeartSection({ med }: { med: Medication }) {
  const doses = useDoses(); const checkIns = useCheckIns(); const daily = useDaily(); const ss = useScheduleSettings();
  const now = useNow(300_000);
  if (!doses || !checkIns || !daily || !ss || !isStimulant(med) || med.peptide) return null;
  const who = personOf(med);
  const r = heartResponse(med, doses, checkIns.filter((c) => personOf(c) === who), daily.filter((d) => personOf(d) === who), now, ss[1]);
  if (!r) return null;
  return (
    <section aria-labelledby={`hr-${med.id}`} className="box space-y-2">
      <h2 id={`hr-${med.id}`} className="text-sm font-medium text-muted">Your heart rate after a dose</h2>
      {r.signal ? (
        <>
          <p className="text-[15px] leading-snug">
            {r.onsetMin !== undefined ? `Starts showing about ${hm(r.onsetMin)} after a dose, ` : ''}peaks around {hm(r.peakMin!)} (+{r.peakBpm} bpm)
            {r.wearOffMin !== undefined ? `, and settles back by about ${hm(r.wearOffMin)}.` : '. It hasn’t settled back within 8 hours.'}
          </p>
          <DoseHeartChart r={r} />
          <p className="text-sm text-muted">From {r.doses} doses, at rest only (moving and caffeine left out where possible){r.controlDays ? `, with the usual morning rise on ${r.controlDays} days without a dose taken off` : '. Days without a dose (a weekend or a break) will make it more accurate by taking off the usual morning rise'}. Your usual before a dose: {r.baseline} bpm.</p>
        </>
      ) : (
        <p className="text-[15px] leading-snug text-muted">No clear rise after a dose yet (+{r.peakBpm} bpm at most, from {r.doses} doses). The forecast keeps using your focus check-ins.</p>
      )}
    </section>
  );
}

export function DoseHeartChart({ r }: { r: HeartResponse }) {
  const W = 320, H = 162, L = 30, R = 8, T = 28, B = 22;
  const pts = r.curve.filter((p) => p.delta !== null) as { min: number; delta: number }[];
  const top = Math.max(6, Math.ceil(Math.max(...pts.map((p) => p.delta)) + 1)), bottom = Math.min(-2, Math.floor(Math.min(...pts.map((p) => p.delta))));
  const x = (m: number) => L + (m / 480) * (W - L - R);
  const y = (v: number) => T + ((top - v) / (top - bottom)) * (H - T - B);
  // The line breaks where there are no readings.
  const segs: string[] = [];
  let cur = '';
  for (const p of r.curve) {
    if (p.delta === null) { if (cur) segs.push(cur); cur = ''; continue; }
    cur += `${cur ? 'L' : 'M'}${x(p.min).toFixed(1)},${y(p.delta).toFixed(1)}`;
  }
  if (cur) segs.push(cur);
  const area = segs.map((d) => { const xs = [...d.matchAll(/[ML]([\d.]+),/g)].map((m) => m[1]); return `${d}L${xs[xs.length - 1]},${y(0)}L${xs[0]},${y(0)}Z`; });
  const marks = [
    r.onsetMin !== undefined && { min: r.onsetMin, label: 'Starts' },
    r.peakMin !== undefined && { min: r.peakMin, label: `Peak +${Math.round(r.peakBpm)}` },
    r.wearOffMin !== undefined && { min: r.wearOffMin, label: 'Settled' },
  ].filter(Boolean) as { min: number; label: string }[];
  const at = (m: number) => r.curve.find((p) => p.min === m)?.delta ?? 0;
  // Labels on two rows above the plot: one that would run into the one before drops to the lower row.
  const rows: number[] = [];
  marks.forEach((m, i) => { const prev = marks[i - 1]; rows.push(prev && x(m.min) - x(prev.min) < 64 && rows[i - 1] === 0 ? 1 : 0); });
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
        aria-label={`Heart rate rise after a dose: ${marks.map((m) => `${m.label.toLowerCase()} at ${hm(m.min)}`).join(', ')}`}>
        {[0, Math.round(top / 2), top].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={v === 0 ? 1.2 : 0.8} />
            <text x={L - 5} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="var(--text-muted)">{v > 0 ? `+${v}` : v}</text>
          </g>
        ))}
        {[0, 2, 4, 6, 8].map((h) => <text key={h} x={x(h * 60)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--text-muted)">{h} h</text>)}
        {area.map((d, i) => <path key={`a${i}`} d={d} fill="var(--primary)" opacity="0.1" />)}
        {segs.map((d, i) => <path key={i} d={d} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />)}
        {marks.map((m, i) => (
          <g key={m.label}>
            <line x1={x(m.min)} x2={x(m.min)} y1={y(at(m.min))} y2={rows[i] ? 17 : 4} stroke="var(--text-muted)" strokeDasharray="2 3" strokeWidth="1" />
            <circle cx={x(m.min)} cy={y(at(m.min))} r="3.5" fill="var(--primary)" stroke="var(--surface)" strokeWidth="2" />
            <text x={Math.min(W - R - 2, Math.max(L + 2, x(m.min) + 3))} y={rows[i] ? 24 : 11} textAnchor={x(m.min) > W - 60 ? 'end' : 'start'} fontSize="10" fontWeight="600" fill="var(--text)">{m.label}</text>
          </g>
        ))}
      </svg>
      <details className="mt-1 chart-table">
        <summary className="text-sm text-muted cursor-pointer min-h-[44px] flex items-center">Table</summary>
        <table className="w-full text-sm tnum">
          <thead><tr className="text-muted"><th scope="col" className="text-left font-normal">After the dose</th><th scope="col" className="text-right font-normal">Above your usual</th></tr></thead>
          <tbody>{r.curve.filter((p) => p.min % 30 === 0 && p.delta !== null).map((p) => <tr key={p.min} className="border-t border-border"><td className="py-1">{hm(p.min)}</td><td className="py-1 text-right">{p.delta! > 0 ? '+' : ''}{p.delta} bpm</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}
