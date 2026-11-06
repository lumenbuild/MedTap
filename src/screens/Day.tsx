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
  { key: 'drink', label: 'Drinks', Icon: Coffee, colour: 'var(--c-pep)' },
  { key: 'move', label: 'Move', Icon: Dumbbell, colour: 'var(--success)' },
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

  // The chart, midnight to midnight: a lane per kind of entry over the heart rate, with sleep shaded behind. Lanes are
  // laid out as boxes (dots stay round at any width); the heart rate is a line stretched to fit.
  const laneH = 22, hrH = v.hr.length ? 64 : 0;
  const pct = (ms: number) => ((Math.min(Math.max(ms, v.from), v.to) - v.from) / (v.to - v.from)) * 100;
  const hrs = v.hr.map((p) => p.v);
  const lo = hrs.length ? Math.min(...hrs) - 3 : 40, hi = hrs.length ? Math.max(...hrs) + 3 : 120;
  const path = v.hr.map((p, i) => `${i && p.t - v.hr[i - 1].t < 40 * 60_000 ? 'L' : 'M'}${pct(p.t).toFixed(2)},${(4 + (1 - (p.v - lo) / Math.max(1, hi - lo)) * (hrH - 8)).toFixed(1)}`).join('');
  const nowPct = isToday ? pct(now) : null;

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
            <ul className="shrink-0 text-[11px] text-muted" aria-hidden="true">
              {lanes.map((l) => <li key={l.key} className="flex items-center gap-1" style={{ height: laneH }}><span className="w-2 h-2 rounded-full" style={{ background: l.colour }} />{l.label}</li>)}
              {hrH > 0 && <li className="flex items-center gap-1" style={{ height: hrH }}><HeartPulse size={11} />{Math.min(...hrs)}–{Math.max(...hrs)}</li>}
            </ul>
            <div className="flex-1 min-w-0">
            <div className="relative" role="img"
              aria-label={`${label}: ${v.events.length} entries${v.hr.length ? `, heart rate ${Math.min(...hrs)} to ${Math.max(...hrs)}` : ''}${v.sleep.length ? ', with sleep shaded' : ''}. Each entry is listed below.`}>
              <div aria-hidden="true">
                {v.sleep.map((sl, i) => <div key={i} className="absolute top-0 bottom-0" style={{ left: `${pct(sl.from)}%`, width: `${Math.max(0, pct(sl.to) - pct(sl.from))}%`, background: 'var(--c-sleep)', opacity: 0.14 }} />)}
                {[0, 25, 50, 75, 100].map((x) => <div key={x} className="absolute top-0 bottom-0 w-px" style={{ left: `${x}%`, background: 'var(--border)' }} />)}
                {lanes.map((l) => (
                  <div key={l.key} className="relative" style={{ height: laneH }}>
                    {v.events.filter((e) => e.lane === l.key).map((e) => e.end
                      ? <span key={e.id} className="absolute top-1/2 -translate-y-1/2 h-2.5 rounded-full" style={{ left: `${pct(e.t)}%`, width: `max(10px, ${pct(e.end) - pct(e.t)}%)`, background: l.colour }} />
                      : <span key={e.id} className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2" style={{ left: `${pct(e.t)}%`, background: l.colour, borderColor: 'var(--surface)' }} />)}
                  </div>
                ))}
                {hrH > 0 && (
                  <svg viewBox={`0 0 100 ${hrH}`} preserveAspectRatio="none" className="block w-full" style={{ height: hrH }}>
                    <path d={path} fill="none" stroke="var(--c-heart)" strokeWidth="1.75" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                  </svg>
                )}
                {nowPct !== null && <div className="absolute top-0 bottom-0 w-0.5" style={{ left: `${nowPct}%`, background: 'var(--text)' }} />}
              </div>
            </div>
            <div className="relative h-4 mt-1 text-[11px] text-muted" aria-hidden="true">
              {[['12a', 0], ['6a', 25], ['12p', 50], ['6p', 75]].map(([t, x]) => <span key={t} className="absolute" style={{ left: `${x}%`, transform: x ? 'translateX(-50%)' : undefined }}>{t}</span>)}
            </div>
            </div>
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
