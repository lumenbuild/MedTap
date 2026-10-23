import { useState } from 'react';
import { format } from 'date-fns';
import { CheckCircle2, ChevronRight, Flag, TrendingDown, TrendingUp } from 'lucide-react';
import type { BodyEntry, BodyGoal, GoalMetric } from '../../db/schema';
import type { Units } from '../../db/repos/settings';
import { setGoal } from '../../db/repos/people';
import { useToast } from '../../app/toast';
import { forecast, forecastWeekAgo, GOAL_METRICS, isFastWeightPace, milestones, robustFit, seriesOf, type Forecast, type Pt } from '../../logic/forecast';
import { cmTo, fmtLength, fmtWeight, kgTo, lengthUnit, toCm, toKg, weightUnit } from '../../logic/units';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Sheet, SheetActions } from '../../components/ui/Sheet';
import { Select, TextInput } from '../../components/ui/Field';

const DAY = 86_400_000;
const fmtD = (ms: number) => format(ms, 'EEE d MMM');
const fmtDY = (ms: number) => format(ms, new Date(ms).getFullYear() === new Date().getFullYear() ? 'EEE d MMM' : 'd MMM yyyy');
const todayYmd = () => format(Date.now(), 'yyyy-MM-dd');

/** Show and enter values in the person's units (kg/lb, cm/in). */
export function valueFmt(metric: GoalMetric, units: Units) {
  if (metric === 'bodyFatPct') return { fmt: (v: number) => `${Math.round(v * 10) / 10}%`, show: (v: number) => Math.round(v * 10) / 10, store: (v: number) => v, unit: '%', name: 'body fat' };
  const isW = metric === 'weightKg' || metric === 'leanKg';
  return {
    fmt: (v: number) => (isW ? fmtWeight(v, units) : fmtLength(v, units)),
    show: (v: number) => (isW ? kgTo(v, units) : cmTo(v, units)),
    store: (v: number) => (isW ? toKg(v, units) : toCm(v, units)),
    unit: isW ? weightUnit(units) : lengthUnit(units),
    name: metric === 'leanKg' ? 'lean mass' : isW ? 'weight' : 'waist',
  };
}

export interface GoalView { goal: BodyGoal; points: Pt[]; f: Forecast; weekAgo: Forecast; last?: number }

export function goalView(goal: BodyGoal, entries: BodyEntry[], now: number): GoalView {
  const pts = seriesOf(entries, goal.metric);
  return { goal, points: pts, f: forecast(pts, goal, now), weekAgo: forecastWeekAgo(pts, goal, now), last: pts[pts.length - 1]?.v };
}

/** One sentence for Today and summaries. */
export function goalLine(v: GoalView, units: Units): string {
  const u = valueFmt(v.goal.metric, units);
  const label = `${u.name[0].toUpperCase()}${u.name.slice(1)} goal ${u.fmt(v.goal.target)}`;
  const { f } = v;
  switch (f.status) {
    case 'need-data': return `${label}: log on a few more days to see when you'll get there.`;
    case 'reached': return `${label}: reached${f.reachedAt ? ` ${fmtD(f.reachedAt)}` : ''}.`;
    case 'flat': return `${label}: steady lately, so no date for now.`;
    case 'away': return `${label}: moving away from it lately.`;
    default: return `${label}: likely around ${fmtDY(f.eta!)}.`;
  }
}

/** Body screen: each goal's forecast, and setting goals. */
export function GoalsSection({ personId, goals, entries, units, now }: { personId: string; goals: BodyGoal[]; entries: BodyEntry[]; units: Units; now: number }) {
  const [editing, setEditing] = useState<GoalMetric | 'new' | null>(null);
  const free = GOAL_METRICS.filter((m) => !goals.some((g) => g.metric === m.metric));
  return (
    <>
      {goals.map((g) => <GoalCard key={g.metric} view={goalView(g, entries, now)} units={units} now={now} onEdit={() => setEditing(g.metric)} />)}
      {free.length > 0 && (
        <Button variant="secondary" className="w-full flex items-center justify-center gap-2" onClick={() => setEditing('new')}>
          <Flag size={18} aria-hidden="true" /> {goals.length ? 'Set another goal' : 'Set a goal: weight, waist, body fat or lean mass'}
        </Button>
      )}
      {editing && (
        <GoalSheet personId={personId} units={units} entries={entries} now={now}
          existing={editing === 'new' ? undefined : goals.find((g) => g.metric === editing)}
          metrics={editing === 'new' ? free.map((m) => m.metric) : [editing]} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function GoalCard({ view, units, now, onEdit }: { view: GoalView; units: Units; now: number; onEdit: () => void }) {
  const { goal: g, points, f, weekAgo, last } = view;
  const u = valueFmt(g.metric, units);
  const down = g.target < g.start;
  const rate = (w: number) => `${w < 0 ? 'down' : 'up'} ${u.fmt(Math.abs(w))} a week`;
  const ms = f.status === 'need-data' ? [] : milestones(points, g, f, now);
  const moved = f.eta && weekAgo.eta ? Math.round((weekAgo.eta - f.eta) / DAY) : null;
  const fast = g.metric === 'weightKg' && isFastWeightPace(f.neededPerWeek, f.level);

  return (
    <Card className="space-y-3">
      <div className="flex items-start gap-2">
        <h2 className="flex-1 text-lg font-semibold">{u.name[0].toUpperCase()}{u.name.slice(1)} goal: {u.fmt(g.target)}{g.targetDate ? ` by ${fmtDY(new Date(`${g.targetDate}T12:00`).getTime())}` : ''}</h2>
        <button onClick={onEdit} className="min-h-[44px] px-2 -mr-2 -mt-2 text-primary font-semibold">Edit</button>
      </div>

      {f.status === 'need-data' ? (
        <p className="text-muted">Log your {u.name} on at least 5 days over a week and the forecast appears here. Daily is best: the more you log, the sharper it gets.</p>
      ) : (
        <>
          <div>
            <div className="h-3 rounded-full bg-surface-2 overflow-hidden" role="progressbar" aria-label={`${Math.round((f.done ?? 0) * 100)}% of the way`} aria-valuenow={Math.round((f.done ?? 0) * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-primary" style={{ width: `${(f.done ?? 0) * 100}%` }} />
            </div>
            <div className="flex justify-between text-sm text-muted tnum mt-1">
              <span>{u.fmt(g.start)}</span><span>{Math.round((f.done ?? 0) * 100)}% of the way</span><span>{u.fmt(g.target)}</span>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3 tnum">
            <div><dt className="text-sm text-muted">Trend now</dt><dd className="font-semibold">{u.fmt(f.level!)}</dd>{last !== undefined && <dd className="text-xs text-muted">Last logged {u.fmt(last)}</dd>}</div>
            <div><dt className="text-sm text-muted">Lately</dt><dd className="font-semibold flex items-center gap-1">{f.perWeek! < 0 ? <TrendingDown size={16} aria-hidden="true" /> : <TrendingUp size={16} aria-hidden="true" />}{rate(f.perWeek!)}</dd>
              <dd className="text-xs text-muted">Likely {(() => {
                const [lo, hi] = [Math.abs(f.perWeekLow!), Math.abs(f.perWeekHigh!)].sort((a, b) => a - b);
                return Math.sign(f.perWeekLow!) !== Math.sign(f.perWeekHigh!) ? `between ${u.fmt(f.perWeekLow!)} and ${u.fmt(f.perWeekHigh!)}` : `${u.show(lo)}–${u.fmt(hi)}`;
              })()}</dd></div>
          </dl>
          <Outlook view={view} units={units} moved={moved} />
          {fast && (
            <p className="text-sm rounded-btn bg-surface-2 p-3">Reaching it by your date would take more than about 1% of your body weight a week. Your doctor can help set a pace that suits you.</p>
          )}
          {f.slowing && f.status !== 'reached' && (
            <p className="text-sm rounded-btn bg-surface-2 p-3">Slower lately: {rate(f.slowing.was)} over the fortnight before, {rate(f.slowing.now)} this fortnight. Plateaus are common; the forecast follows the recent rate.</p>
          )}
          {ms.length > 0 && <Milestones list={ms} fmt={u.fmt} />}
        </>
      )}
      <a href="#/trends" className="flex items-center gap-1 min-h-[44px] text-primary font-semibold">See the chart <ChevronRight size={18} aria-hidden="true" /></a>
    </Card>
  );
}

function Outlook({ view, units, moved }: { view: GoalView; units: Units; moved: number | null }) {
  const { goal: g, f } = view;
  const u = valueFmt(g.metric, units);
  if (f.status === 'reached') {
    const off = f.drift ?? 0;
    const holding = Math.abs(off) <= (g.metric === 'weightKg' ? 1.5 : 2);
    return (
      <div className="rounded-btn bg-success-soft p-3">
        <p className="font-semibold flex items-center gap-2"><CheckCircle2 size={18} aria-hidden="true" /> Reached{f.reachedAt ? ` on ${fmtDY(f.reachedAt)}` : ''}</p>
        <p className="text-sm">{holding ? `Holding steady: ${off === 0 ? 'right on it' : `${u.fmt(Math.abs(off))} ${off > 0 ? 'above' : 'below'}`}.` : `Now ${u.fmt(Math.abs(off))} ${off > 0 ? 'above' : 'below'} it on the trend.`}</p>
      </div>
    );
  }
  if (f.status === 'flat') return <p className="rounded-btn bg-surface-2 p-3">Steady lately, so there's no date for now. It updates as soon as the trend moves again.</p>;
  if (f.status === 'away') return <p className="rounded-btn bg-surface-2 p-3">Moving away from the goal lately ({u.fmt(Math.abs(f.perWeek!))} a week). The date comes back once the trend turns.</p>;
  return (
    <div className="rounded-btn bg-primary-soft p-3 space-y-1">
      <p className="text-sm">At this rate you'll likely reach it around</p>
      <p className="text-2xl font-semibold tnum">{fmtDY(f.eta!)}</p>
      <p className="text-sm tnum">Likely between {fmtDY(f.etaEarly!)} and {f.etaLate ? fmtDY(f.etaLate) : 'much later if it slows'}</p>
      {moved !== null && moved !== 0 && <p className="text-sm tnum">{Math.abs(moved)} day{Math.abs(moved) === 1 ? '' : 's'} {moved > 0 ? 'sooner' : 'later'} than this time last week</p>}
      {f.daysPastTarget !== undefined && (
        <p className="text-sm tnum font-medium">
          {f.daysPastTarget <= 0 ? `About ${Math.abs(f.daysPastTarget)} days before your date.`
            : `About ${f.daysPastTarget} days after your date. To get there by then: ${u.fmt(Math.abs(f.neededPerWeek!))} a week.`}
        </p>
      )}
    </div>
  );
}

function Milestones({ list, fmt }: { list: ReturnType<typeof milestones>; fmt: (v: number) => string }) {
  return (
    <ol className="space-y-1">
      {list.map((m) => (
        <li key={m.label} className="flex items-center gap-2 text-sm tnum">
          {m.reachedAt ? <CheckCircle2 size={16} className="text-success shrink-0" aria-label="Reached" /> : <span className="w-4 h-4 rounded-full border-2 border-border shrink-0" aria-hidden="true" />}
          <span className="flex-1"><strong>{m.label}</strong> · {fmt(m.value)}</span>
          <span className="text-muted">{m.reachedAt ? fmtD(m.reachedAt) : m.eta ? `~${fmtDY(m.eta)}` : ''}</span>
        </li>
      ))}
    </ol>
  );
}

function GoalSheet({ personId, existing, metrics, units, entries, now, onClose }: {
  personId: string; existing?: BodyGoal; metrics: GoalMetric[]; units: Units; entries: BodyEntry[]; now: number; onClose: () => void;
}) {
  const toast = useToast();
  const [metric, setMetric] = useState<GoalMetric>(existing?.metric ?? metrics[0]);
  const u = valueFmt(metric, units);
  // Start from where the trend is now (or the last log), not a single high or low day.
  const pts = seriesOf(entries, metric);
  const fit = robustFit(pts.filter((p) => p.t > now - 28 * DAY), now);
  const current = fit && fit.n >= 3 ? fit.level : pts[pts.length - 1]?.v;
  const [target, setTarget] = useState(existing ? String(u.show(existing.target)) : '');
  const [start, setStart] = useState(existing ? String(u.show(existing.start)) : current !== undefined ? String(u.show(current)) : '');
  const [date, setDate] = useState(existing?.targetDate ?? '');
  const t = Number(target), s0 = Number(start);
  const valid = t > 0 && s0 > 0 && t !== s0 && (!date || date > todayYmd());

  const save = async () => {
    if (!valid) return;
    await setGoal(personId, metric, {
      metric, target: u.store(t), start: u.store(s0), targetDate: date || undefined,
      startDate: existing && Math.abs(existing.start - u.store(s0)) < 0.05 ? existing.startDate : todayYmd(),
    });
    toast('Goal saved');
    onClose();
  };
  const remove = async () => {
    if (!existing) return;
    await setGoal(personId, existing.metric, undefined);
    toast('Goal removed', { onAction: () => setGoal(personId, existing.metric, existing) });
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title={existing ? 'Edit goal' : 'Set a goal'}>
      <div className="space-y-4">
        {metrics.length > 1 && (
          <Select label="Goal for" value={metric} onChange={(e) => setMetric(e.target.value as GoalMetric)}>
            {GOAL_METRICS.filter((m) => metrics.includes(m.metric)).map((m) => <option key={m.metric} value={m.metric}>{m.label}</option>)}
          </Select>
        )}
        <TextInput label={`Goal (${u.unit})`} type="number" inputMode="decimal" min="0" step="any" value={target} onChange={(e) => setTarget(e.target.value)} />
        <TextInput label={`Starting from (${u.unit})`} help={current !== undefined ? `Your trend now is ${u.fmt(current)}.` : `Log your ${u.name} to fill this in.`}
          type="number" inputMode="decimal" min="0" step="any" value={start} onChange={(e) => setStart(e.target.value)} />
        <TextInput label="By (optional)" help="Leave blank to just see when you'll get there." type="date" min={todayYmd()} value={date} onChange={(e) => setDate(e.target.value)} />
        <p className="text-sm text-muted">The forecast uses your own logs: the trend over the last few weeks, ignoring day-to-day ups and downs. It updates every time you log.</p>
        <SheetActions>
          <Button className="w-full min-h-[56px]" disabled={!valid} onClick={save}>Save goal</Button>
        </SheetActions>
        {existing && <Button variant="danger" className="w-full" onClick={remove}>Remove goal</Button>}
      </div>
    </Sheet>
  );
}

/** Today: one line per goal, linking to Body. */
export function GoalLines({ goals, entries, units, now }: { goals: BodyGoal[]; entries: BodyEntry[]; units: Units; now: number }) {
  if (!goals.length) return null;
  return (
    <a href="#/body" className="block border-t border-border py-4 space-y-1">
      {goals.map((g) => (
        <p key={g.metric} className="flex items-center gap-2 text-sm tnum"><Flag size={16} className="text-primary shrink-0" aria-hidden="true" /> {goalLine(goalView(g, entries, now), units)}</p>
      ))}
    </a>
  );
}
