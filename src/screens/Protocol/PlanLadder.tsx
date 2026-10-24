// Protocol's plan, drawn: each dose level as a step over time, the ones taken solid and the planned ones dashed, with
// today marked. The step plan (when it isn't dated) is a line of words under it.
import { format } from 'date-fns';
import type { Dose, Medication } from '../../db/schema';
import { doseLevels } from '../../logic/peptide';
import { fmtAmount } from '../../logic/format';
import { medColour, resolveColour } from '../../logic/palette';
import { shownColour } from '../../logic/privacy';

const DAY = 86_400_000;
const W = 360, H = 134, L = 8, R = 352, TOP = 26, BASE = 112;

export interface PlanStep { amount: number; from: number; to: number; planned: boolean }

/** The levels taken (from the doses logged), then the planned changes still to come. */
export function planSteps(med: Medication, doses: Dose[], now: number): PlanStep[] {
  const taken = doseLevels(doses.filter((d) => d.medicationId === med.id), [], [], now)
    .map((l) => ({ amount: l.dose, from: l.from, to: l.to, planned: false }));
  const ahead = (med.plannedChanges ?? []).map((c) => ({ amount: c.defaultAmount, from: Date.parse(`${c.from}T00:00`) }))
    .filter((c) => c.from > now).sort((a, b) => a.from - b.from);
  const out: PlanStep[] = [...taken];
  // The current amount carries on to the first planned change (or a few weeks on).
  const first = ahead[0]?.from ?? now + 28 * DAY;
  if (out.length) out[out.length - 1] = { ...out[out.length - 1], to: Math.max(now, out[out.length - 1].to) };
  out.push({ amount: med.defaultAmount, from: now, to: first, planned: true });
  ahead.forEach((c, i) => out.push({ amount: c.amount, from: c.from, to: ahead[i + 1]?.from ?? c.from + 28 * DAY, planned: true }));
  // Merge a planned run that just continues the level taken now.
  const merged: PlanStep[] = [];
  for (const st of out) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.amount - st.amount) < 1e-6 && last.planned === st.planned) last.to = st.to;
    else merged.push({ ...st });
  }
  return merged.filter((x) => x.to > x.from);
}

export function PlanLadder({ med, doses, now }: { med: Medication; doses: Dose[]; now: number }) {
  const steps = planSteps(med, doses, now);
  if (steps.length < 2 && !steps.some((x) => !x.planned)) return null;
  const t0 = Math.max(steps[0].from, now - 26 * 7 * DAY);
  const t1 = steps[steps.length - 1].to;
  const max = Math.max(...steps.map((x) => x.amount), med.stepPlan && med.stepPlan.maxPer === 'dose' && !med.stepPlan.down ? med.stepPlan.max : 0);
  const X = (t: number) => L + ((Math.max(t, t0) - t0) / Math.max(1, t1 - t0)) * (R - L);
  const Y = (v: number) => BASE - (v / (max || 1)) * (BASE - TOP);
  const colour = resolveColour(medColour(shownColour(med)));
  const seg = (st: PlanStep) => `M${X(st.from)} ${Y(st.amount)}H${X(st.to)}`;
  // Risers between consecutive levels, solid where both sides were taken.
  const risers = steps.slice(1).map((st, i) => ({ x: X(st.from), y1: Y(steps[i].amount), y2: Y(st.amount), planned: st.planned }));
  const label = steps.map((st) => `${fmtAmount(st.amount, med.unit)} ${st.planned ? 'planned' : 'taken'} from ${format(st.from, 'd MMM')}`).join(', ');
  // A step that only carries the same amount on (taken into planned) gets no new label or date; neither does today.
  const same = (i: number) => i > 0 && Math.abs(steps[i - 1].amount - steps[i].amount) < 1e-6;
  const changes = steps.filter((st, i) => i > 0 && st.from > t0 && !same(i) && Math.abs(st.from - now) > 2 * DAY && X(st.from) > L + 52);
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Dose plan: ${label}`}>
        <line x1={L} x2={R} y1={BASE} y2={BASE} stroke="var(--border)" />
        {steps.map((st, i) => (
          <path key={i} d={seg(st)} fill="none" stroke={colour} strokeWidth={st.planned ? 2.5 : 3.5} strokeLinecap="round" strokeDasharray={st.planned ? '5 5' : undefined} />
        ))}
        {risers.map((r, i) => <line key={i} x1={r.x} x2={r.x} y1={r.y1} y2={r.y2} stroke={colour} strokeWidth="2" strokeDasharray={r.planned ? '3 4' : undefined} />)}
        {steps.map((st, i) => {
          if (same(i)) return null;
          const x = Math.min(X(st.from) + 2, R - 40);
          return <text key={`l${i}`} x={x} y={Y(st.amount) - 8} fontSize="12" fontWeight={!st.planned || i === steps.findIndex((s2) => s2.planned) ? 600 : 400} fill="var(--text)">{fmtAmount(st.amount, med.unit)}</text>;
        })}
        <line x1={X(now)} x2={X(now)} y1={TOP - 14} y2={BASE} stroke="var(--text)" strokeWidth="1" strokeDasharray="2 3" />
        <text x={X(now)} y={TOP - 18} fontSize="11" textAnchor="middle" fill="var(--text-muted)">Today</text>
        {changes.map((st, i) => (
          <text key={`d${i}`} x={Math.min(X(st.from), R - 20)} y={BASE + 18} fontSize="11" textAnchor="middle" fill="var(--text-muted)">{format(st.from, 'd MMM')}</text>
        ))}
        <text x={L} y={BASE + 18} fontSize="11" fill="var(--text-muted)">{format(t0, 'd MMM')}</text>
      </svg>
      <figcaption className="sr-only">{label}</figcaption>
    </figure>
  );
}
