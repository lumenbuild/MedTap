// One day on one timeline: doses, meals, drinks, workouts, check-ins and weigh-ins in lanes over the watch's heart
// rate and the night's sleep, what connects them, and every entry in order. Back and forward a day at a time.
import { ChevronLeft, ChevronRight, Coffee, Dumbbell, HeartPulse, Pill, Scale, Smile, Utensils, type LucideIcon } from 'lucide-react';
import { useDecisionData } from '../app/useDecisions';
import { useVitals } from '../app/data';
import { useNow } from '../app/useNow';
import { personOf } from '../db/repos/people';
import { dayView, ymd, type Lane } from '../logic/day';
import { fmtTime } from '../logic/format';
import { fmtWeight } from '../logic/units';
import { fmtHM } from '../logic/sleep';

const LANES: { key: Lane; label: string; Icon: LucideIcon; colour: string }[] = [
  { key: 'meds', label: 'Doses', Icon: Pill, colour: 'var(--c-meds)' },
  { key: 'food', label: 'Food', Icon: Utensils, colour: 'var(--c-act)' },
  { key: 'drink', label: 'Drinks', Icon: Coffee, colour: 'var(--primary)' },
  { key: 'move', label: 'Move', Icon: Dumbbell, colour: 'var(--c-heart)' },
  { key: 'feel', label: 'Feel', Icon: Smile, colour: 'var(--c-mind)' },
  { key: 'body', label: 'Body', Icon: Scale, colour: 'var(--c-body)' },
];
const LANE = Object.fromEntries(LANES.map((l) => [l.key, l])) as Record<Lane, (typeof LANES)[number]>;

export function Day({ date }: { date?: string }) {
  const dd = useDecisionData();
  const vitals = useVitals();
  const now = useNow(300_000);
  if (!dd || dd.everyone || !vitals) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const { data, settings } = dd;
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : ymd(now);
  const v = dayView({ ...data, vitals: vitals.filter((x) => personOf(x) === dd.personId) }, day,
    { halfLifeH: settings.caffeineHalfLifeH, proteinTarget: settings.proteinTargetG, waterTarget: settings.waterTargetMl, kg: (k) => fmtWeight(k, settings.units) });
  const prev = ymd(v.from - 12 * 3_600_000), next = ymd(v.to + 12 * 3_600_000);
  const isToday = day === ymd(now);
  const label = new Date(v.from + 12 * 3_600_000).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
  const lanes = LANES.filter((l) => v.events.some((e) => e.lane === l.key));
  const t = v.totals;
  const chips = [
    t.sleepMin ? ['Sleep', fmtHM(t.sleepMin)] : null,
    t.steps ? ['Steps', t.steps.toLocaleString('en-AU')] : null,
    t.kcal ? ['Food', `${t.kcal.toLocaleString('en-AU')} Cal`] : null,
    t.protein ? ['Protein', `${t.protein}${settings.proteinTargetG ? ` / ${settings.proteinTargetG}` : ''} g`] : null,
    t.waterMl ? ['Water', `${(t.waterMl / 1000).toFixed(1)} L`] : null,
    t.caffeineMg ? ['Caffeine', `${t.caffeineMg} mg`] : null,
  ].filter((x): x is string[] => !!x);

  // The chart: 6 am to 6 am-ish would hide the morning; midnight to midnight, with lanes above the heart rate.
  const W = 320, laneH = 20, top = 4, hrH = 72;
  const H = top + lanes.length * laneH + hrH + 18;
  const x = (ms: number) => ((Math.min(Math.max(ms, v.from), v.to) - v.from) / (v.to - v.from)) * W;
  const hrs = v.hr.map((p) => p.v);
  const lo = hrs.length ? Math.min(...hrs) - 3 : 40, hi = hrs.length ? Math.max(...hrs) + 3 : 120;
  const hy = (b: number) => top + lanes.length * laneH + 6 + (1 - (b - lo) / Math.max(1, hi - lo)) * (hrH - 8);
  const path = v.hr.map((p, i) => `${i && p.t - v.hr[i - 1].t < 40 * 60_000 ? 'L' : 'M'}${x(p.t).toFixed(1)},${hy(p.v).toFixed(1)}`).join('');
  const nowX = isToday ? x(now) : null;

  return (
    <div className="space-y-4">
      <nav className="flex items-center justify-between" aria-label="Day">
        <a href={`#/day/${prev}`} aria-label="Day before" className="w-11 h-11 -ml-2 rounded-full flex items-center justify-center"><ChevronLeft size={22} aria-hidden="true" /></a>
        <p className="font-semibold">{isToday ? 'Today' : label}</p>
        {isToday ? <span className="w-11 h-11" /> : <a href={`#/day/${next === ymd(now) ? '' : next}`} aria-label="Day after" className="w-11 h-11 -mr-2 rounded-full flex items-center justify-center"><ChevronRight size={22} aria-hidden="true" /></a>}
      </nav>

      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">{chips.map(([k, val]) => <li key={k} className="inline-flex items-center gap-1.5 min-h-[34px] px-3 rounded-full bg-surface-2 text-[13px] tnum"><span className="text-muted">{k}</span><span className="font-semibold">{val}</span></li>)}</ul>
      )}

      {(lanes.length > 0 || v.hr.length > 0) && (
        <section className="box space-y-2" aria-labelledby="dayline-h">
          <h2 id="dayline-h" className="text-sm font-medium text-muted">The day at a glance</h2>
          <div className="flex gap-2">
            <ul className="shrink-0 pt-[4px] text-[11px] text-muted" aria-hidden="true">
              {lanes.map((l) => <li key={l.key} className="flex items-center gap-1" style={{ height: laneH }}><span className="w-2 h-2 rounded-full" style={{ background: l.colour }} />{l.label}</li>)}
              {v.hr.length > 0 && <li className="flex items-center gap-1 mt-2"><HeartPulse size={11} />bpm</li>}
            </ul>
            <svg viewBox={`0 0 ${W} ${H}`} className="flex-1 min-w-0 block" style={{ height: H }} role="img"
              aria-label={`${label}: ${v.events.length} entries${v.hr.length ? `, heart rate ${Math.min(...hrs)} to ${Math.max(...hrs)}` : ''}${v.sleep.length ? ', with sleep shaded' : ''}. Each entry is listed below.`}>
              {v.sleep.map((s, i) => <rect key={i} x={x(s.from)} y={0} width={Math.max(0, x(s.to) - x(s.from))} height={H - 16} fill="var(--c-sleep)" opacity="0.14" />)}
              {[0, 6, 12, 18, 24].map((h) => <line key={h} x1={(h / 24) * W} x2={(h / 24) * W} y1={0} y2={H - 16} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
              {lanes.map((l, i) => {
                const y = top + i * laneH + laneH / 2;
                return (
                  <g key={l.key}>
                    {v.events.filter((e) => e.lane === l.key).map((e) => e.end
                      ? <rect key={e.id} x={x(e.t)} y={y - 5} width={Math.max(6, x(e.end) - x(e.t))} height={10} rx={5} fill={l.colour} />
                      : <circle key={e.id} cx={x(e.t)} cy={y} r={5} fill={l.colour} stroke="var(--surface)" strokeWidth="2" />)}
                  </g>
                );
              })}
              {path && <path d={path} fill="none" stroke="var(--c-heart)" strokeWidth="1.75" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
              {nowX !== null && <line x1={nowX} x2={nowX} y1={0} y2={H - 16} stroke="var(--text)" strokeWidth="1.5" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
              {[0, 6, 12, 18].map((h) => <text key={h} x={(h / 24) * W + 2} y={H - 4} fontSize="10" fill="var(--text-muted)">{h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`}</text>)}
            </svg>
          </div>
          {v.sleep.length > 0 && <p className="text-[11px] text-muted">Shaded: asleep.</p>}
        </section>
      )}

      {v.notes.length > 0 && (
        <section className="box space-y-2" aria-labelledby="links-h">
          <h2 id="links-h" className="font-semibold">How it connects</h2>
          <ul className="space-y-1.5 leading-snug">{v.notes.map((n) => <li key={n} className="flex gap-2"><span aria-hidden="true" className="mt-[0.55em] w-1.5 h-1.5 rounded-full bg-text shrink-0" /><span>{n}</span></li>)}</ul>
        </section>
      )}

      <section className="box" aria-labelledby="entries-h">
        <h2 id="entries-h" className="text-sm font-medium text-muted mb-1">In order</h2>
        {v.events.length ? (
          <ol className="divide-y divide-border">
            {v.events.map((e) => {
              const l = LANE[e.lane];
              const body = (
                <>
                  <span className="w-[62px] shrink-0 text-[13px] text-muted tnum pt-0.5">{fmtTime(e.t)}</span>
                  <span aria-hidden="true" className="w-7 h-7 rounded-full flex items-center justify-center text-white shrink-0" style={{ background: l.colour }}><l.Icon size={15} /></span>
                  <span className="flex-1 min-w-0"><span className="block font-medium leading-snug">{e.title}</span>{e.detail && <span className="block text-sm text-muted leading-snug">{e.detail}</span>}</span>
                </>
              );
              return <li key={e.id}>{e.href ? <a href={e.href} className="flex items-start gap-2.5 py-2.5 min-h-[44px]">{body}</a> : <div className="flex items-start gap-2.5 py-2.5">{body}</div>}</li>;
            })}
          </ol>
        ) : <p className="text-muted py-2">Nothing logged on this day.</p>}
      </section>
    </div>
  );
}
