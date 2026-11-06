// Today, joined up: the goal rings (what adds up to the goal, at a glance) and one ranked plan in place of the
// separate calls, brief, insights and week cards. Each line says what to do, why, and links to the numbers it rests
// on; a filter shows one part of life at a time. The sickness forecast sits at the top when it flags something.
import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Activity, Footprints, HeartPulse, Moon, Pill, Scale, Thermometer, Utensils, X, type LucideIcon } from 'lucide-react';
import { useDecisionData } from '../app/useDecisions';
import { useInsights, InsightRow, BecauseChips } from './InsightList';
import { useNow } from '../app/useNow';
import { useToast } from '../app/toast';
import { HAS_PEPTIDES } from '../edition';
import { todaysCalls, earlyWarnings } from '../logic/decisions';
import { dailyBrief } from '../logic/brief';
import { conditionOn } from '../logic/experiments';
import { sickForecast, UNWELL, type SickForecast } from '../logic/sickness';
import { todayPlan, THREAD_LABEL, type PlanItem, type Thread } from '../logic/plan';
import { goalRings, type Ring } from '../logic/rings';
import { stepsTarget } from '../logic/movement';
import { readiness } from '../logic/training';
import { kgTo } from '../logic/units';
import { setSetting, type AppSettings } from '../db/repos/settings';
import { addCheckIn, removeCheckIn } from '../db/repos/checkIns';
import { storedPerson } from '../db/repos/people';
import { MiniRing } from './ui/Visual';

const THREAD_ICON: Record<Thread, LucideIcon> = { meds: Pill, fuel: Utensils, body: Scale, recovery: Moon, move: Footprints };
const THREAD_COLOUR: Record<Thread, string> = { meds: 'var(--c-meds)', fuel: 'var(--c-act)', body: 'var(--c-body)', recovery: 'var(--c-sleep)', move: 'var(--c-heart)' };
const SIGNAL_WORD = { skinTempDelta: 'skin temperature', restingHr: 'resting heart rate', respRate: 'breathing rate', hrvMs: 'HRV', spo2Avg: 'blood oxygen' } as const;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Everything Today's plan and rings need, worked out once every ten minutes or when the records change. */
export function useToday() {
  const dd = useDecisionData();
  const ins = useInsights();
  const now = useNow(600_000);
  const tick = Math.floor(now / 600_000);
  return useMemo(() => {
    if (!dd || dd.everyone || !ins) return null;
    const { data, s, settings } = dd;
    const biohack = HAS_PEPTIDES && settings.biohackTools;
    const brief = dailyBrief({ meds: data.meds, doses: data.doses, checkIns: data.checkIns, daily: data.daily, workouts: data.workouts, waterTarget: settings.waterTargetMl, biohack }, now, s);
    for (const e of data.experiments.filter((x) => !x.deletedAt && !x.ended)) {
      const c = conditionOn(e, format(now, 'yyyy-MM-dd'));
      if (c) brief.push({ key: `exp:${e.id}`, text: `Experiment “${e.title}”: today is ${c.arm === 'a' ? e.a : e.b}` });
    }
    const sick = settings.healthImport || data.daily.some((x) => typeof x.skinTempDelta === 'number' || typeof x.restingHr === 'number')
      ? sickForecast({ daily: data.daily, checkIns: data.checkIns, workouts: data.workouts, feedback: settings.sickFeedback }, now) : null;
    const plan = todayPlan({ calls: todaysCalls(data, now, s, settings), warnings: earlyWarnings(data, now, s, settings.waterTargetMl), brief, insights: ins.list, sick });
    const rings = goalRings({ body: data.body, daily: data.daily, goalKg: dd.goalKg, proteinTarget: settings.proteinTargetG,
      stepsTarget: settings.stepsTargetOwn ?? stepsTarget(data.daily, now) ?? undefined, sleepTargetMin: settings.sleepTargetH * 60 }, now, s);
    return { plan, rings, sick, settings, personId: dd.personId, data, s };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dd, ins, tick]);
}

// ── Goal rings ───────────────────────────────────────────────────────────────────────────────────────

const short = (r: Ring) => {
  if (r.key === 'steps') { const n = Number(r.value.replace(/\D/g, '')); return n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n); }
  if (r.key === 'protein') return r.value.replace(' of ', '/');
  if (r.key === 'sleep') return r.value.replace(' ', '').replace(/m$/, '');
  return r.value.replace(' kg', 'kg');
};

export function GoalRings() {
  const t = useToday();
  const now = useNow(600_000);
  if (!t) return null;
  const { rings, data, settings, s } = t;
  // A few numbers beside the rings: readiness, HRV against usual, and this week's weight change.
  const chips: { label: string; value: string; href: string; tone?: 'good' | 'watch' }[] = [];
  const r = readiness(data.daily, data.checkIns, now, s);
  if (r) chips.push({ label: 'Readiness', value: String(r.score), href: '#/health', tone: r.score >= 70 ? 'good' : r.score < 50 ? 'watch' : undefined });
  const hrvs = data.daily.filter((d) => d.hrvMs).sort((a, b) => a.date.localeCompare(b.date));
  const h = hrvs.at(-1);
  if (h && now - new Date(`${h.date}T12:00`).getTime() < 1.5 * 86_400_000) {
    const prior = hrvs.slice(-31, -1).map((d) => d.hrvMs!);
    const diff = prior.length >= 5 ? Math.round(h.hrvMs! - median(prior)) : 0;
    chips.push({ label: 'HRV', value: `${Math.round(h.hrvMs!)} ms${Math.abs(diff) >= 2 ? ` ${diff > 0 ? '▲' : '▼'}${Math.abs(diff)}` : ''}`, href: '#/health', tone: diff >= 2 ? 'good' : diff <= -2 ? 'watch' : undefined });
  }
  const ws = data.body.filter((b) => typeof b.weightKg === 'number').sort((a, b) => a.date.localeCompare(b.date));
  const w = ws.at(-1);
  if (w) {
    const weekAgo = format(new Date(`${w.date}T12:00`).getTime() - 7 * 86_400_000, 'yyyy-MM-dd');
    const before = [...ws].reverse().find((b) => b.date <= weekAgo);
    const u = settings.units;
    const ch = before ? Math.round((kgTo(w.weightKg!, u) - kgTo(before.weightKg!, u)) * 10) / 10 : undefined;
    chips.push({ label: 'Weight', value: `${kgTo(w.weightKg!, u)}${ch !== undefined && Math.abs(ch) >= 0.1 ? ` ${ch < 0 ? '▼' : '▲'}${Math.abs(ch)}` : ''}`, href: '#/progress/body', tone: ch !== undefined && ch <= -0.1 ? 'good' : undefined });
  }
  if (!rings.length && !chips.length) return null;
  const cols = ['grid-cols-1', 'grid-cols-2', 'grid-cols-3', 'grid-cols-4', 'grid-cols-5'][Math.max(0, Math.min(5, rings.length) - 1)];
  return (
    <section className="box space-y-3" aria-labelledby="rings-h">
      <h2 id="rings-h" className="text-sm font-medium text-muted">Your goals</h2>
      {rings.length > 0 && (
        <ul className={`grid ${cols} gap-1`}>
          {rings.slice(0, 5).map((x) => (
            <li key={x.key}>
              <a href={x.href} className="flex flex-col items-center text-center min-h-[44px] active:scale-[0.97] transition-transform">
                <MiniRing value={Math.round(x.frac * 100)} max={100} size={58} tone={x.tone} label={`${x.label}: ${x.value}, ${x.sub}`}>{short(x)}</MiniRing>
                <span className="mt-1 text-[12px] font-semibold leading-tight">{x.label}</span>
                <span className="text-[11px] text-muted leading-tight">{x.sub}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <li key={c.label}><a href={c.href} className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-full bg-surface-2 text-[13px] tnum">
              <span className="text-muted">{c.label}</span><span className={`font-semibold ${c.tone === 'good' ? 'text-success' : c.tone === 'watch' ? 'text-caution' : ''}`}>{c.value}</span></a></li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Today's plan ─────────────────────────────────────────────────────────────────────────────────────

const DOT: Record<PlanItem['tone'], string> = { go: 'var(--success)', good: 'var(--success)', easy: 'var(--caution)', watch: 'var(--caution)', stop: 'var(--danger)', info: 'var(--primary)' };

export function TodayPlan({ max = 4 }: { max?: number }) {
  const t = useToday();
  const [thread, setThread] = useState<Thread | 'all'>('all');
  const [all, setAll] = useState(false);
  const now = useNow(60_000);
  if (!t || !t.plan.length) return null;
  const hidden = t.settings.insightsHidden;
  const items = t.plan.filter((x) => !(hidden[x.key] > now));
  const threads = [...new Set(items.map((x) => x.thread))];
  const shown = items.filter((x) => thread === 'all' || x.thread === thread);
  const list = all ? shown : shown.slice(0, max);
  return (
    <section className="box space-y-2" aria-labelledby="plan-h">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="plan-h" className="font-semibold text-[17px]">Today's plan</h2>
        <span className="text-[13px] text-muted tnum">{items.length} {items.length === 1 ? 'thing' : 'things'}</span>
      </div>
      {threads.length > 1 && (
        <div role="group" aria-label="Show" className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5">
          {(['all', ...threads] as const).map((k) => (
            <button key={k} type="button" aria-pressed={thread === k} onClick={() => { setThread(k); setAll(false); }}
              className={`shrink-0 min-h-[36px] px-3 rounded-full text-[13px] font-medium inline-flex items-center gap-1.5 ${thread === k ? 'bg-text text-bg' : 'bg-surface-2'}`}>
              {k !== 'all' && <span aria-hidden="true" className="w-2 h-2 rounded-full" style={{ background: THREAD_COLOUR[k] }} />}
              {k === 'all' ? 'All' : THREAD_LABEL[k]}
            </button>
          ))}
        </div>
      )}
      <ul className="divide-y divide-border">
        {list.map((x) => x.sick ? <SickRow key={x.key} item={x} f={x.sick} settings={t.settings} personId={t.personId} />
          : x.insight ? <InsightRow key={x.key} x={x.insight} settings={t.settings} because={x.because} />
          : <PlanRow key={x.key} x={x} settings={t.settings} />)}
      </ul>
      {shown.length > max && <button type="button" aria-expanded={all} onClick={() => setAll((v) => !v)} className="min-h-[44px] text-sm font-medium underline underline-offset-4">{all ? 'Show fewer' : `Show ${shown.length - max} more`}</button>}
    </section>
  );
}

function PlanRow({ x, settings }: { x: PlanItem; settings: AppSettings }) {
  const toast = useToast();
  const Icon = THREAD_ICON[x.thread];
  const hide = async () => {
    const before = settings.insightsHidden;
    const now = Date.now();
    const kept = Object.fromEntries(Object.entries(before).filter(([, t]) => t > now));
    const end = new Date(); end.setHours(23, 59, 0, 0);
    await setSetting('insightsHidden', { ...kept, [x.key]: end.getTime() });
    toast('Put away for today', { onAction: () => setSetting('insightsHidden', before) });
  };
  return (
    <li className="py-2.5 flex items-start gap-3">
      <span aria-hidden="true" className="relative w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-white" style={{ background: THREAD_COLOUR[x.thread] }}>
        <Icon size={18} />
        <span className="absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full border-2" style={{ background: DOT[x.tone], borderColor: 'var(--surface)' }} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-medium leading-snug">{x.title}</p>
        {x.detail && <p className="text-sm text-muted leading-snug mt-0.5">{x.detail}</p>}
        {x.because.length > 0 && <BecauseChips items={x.because} />}
      </div>
      <button type="button" onClick={hide} aria-label={`Not now: ${x.title}`} className="w-11 h-11 -mr-2 -mt-1.5 rounded-full flex items-center justify-center text-muted shrink-0"><X size={18} aria-hidden="true" /></button>
    </li>
  );
}

/** The sickness forecast in the plan: what's off, the last two weeks, what it has learned, and two answers it learns from. */
function SickRow({ item, f, settings, personId }: { item: PlanItem; f: SickForecast; settings: AppSettings; personId: string }) {
  return (
    <li className="py-2.5 flex items-start gap-3">
      <span aria-hidden="true" className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--caution-soft)', color: 'var(--caution)' }}><Thermometer size={18} /></span>
      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-medium leading-snug">{item.title}</p>
        <SickBody f={f} settings={settings} personId={personId} />
        <BecauseChips items={item.because} />
      </div>
    </li>
  );
}

export function SickBody({ f, settings, personId, compact = true }: { f: SickForecast; settings: AppSettings; personId: string; compact?: boolean }) {
  const toast = useToast();
  const answered = settings.sickFeedback[f.date];
  const answer = async (v: 'sick' | 'fine') => {
    const before = settings.sickFeedback;
    await setSetting('sickFeedback', { ...before, [f.date]: v });
    const c = v === 'sick' ? await addCheckIn({ at: new Date().toISOString(), chips: [UNWELL], personId: storedPerson(personId) }) : undefined;
    toast(v === 'sick' ? 'Noted. It learns which signals move first for you.' : 'Noted. It will alert a little less readily.', { onAction: async () => { await setSetting('sickFeedback', before); if (c) await removeCheckIn(c.id); } });
  };
  const max = Math.max(f.watchAt * 1.6, ...f.recent.map((x) => x.score), 1);
  return (
    <div className="space-y-2 mt-1">
      {compact && f.off.length > 0 && <ul className="flex flex-wrap gap-1">{f.off.map((x) => <li key={x.key} className="text-[12px] rounded-full bg-caution-soft px-2 py-0.5 tnum"><span className="font-medium">{x.label}</span> {x.text.replace(' vs usual', '').replace(' breaths a min', '/min')}</li>)}</ul>}
      {f.confound && <p className="text-[13px] text-muted">Partly {f.confound}, so heart rate and HRV count for less.</p>}
      {!compact && f.recent.length >= 4 && (
        <div>
          <div className="relative flex items-end gap-[3px] h-12" role="img" aria-label={`Last ${f.recent.length} nights: ${f.recent.map((x) => x.score).join(', ')} (alert at ${f.watchAt})`}>
            <div aria-hidden="true" className="absolute inset-x-0 border-t border-dashed" style={{ bottom: `${(f.watchAt / max) * 100}%`, borderColor: 'var(--caution)' }} />
            {f.recent.map((x) => <div key={x.date} aria-hidden="true" className="flex-1 rounded-t-[3px]" style={{ height: `${Math.max(4, (x.score / max) * 100)}%`, background: x.score >= f.watchAt ? 'var(--caution)' : 'var(--border-strong)' }} />)}
          </div>
          <p className="text-[11px] text-muted flex justify-between"><span>2 weeks ago</span><span>Last night</span></p>
        </div>
      )}
      {!compact && f.all.length > 0 && (
        <ul className="grid grid-cols-2 gap-2">
          {f.all.map((x) => (
            <li key={x.key} className="rounded-btn bg-surface-2 p-2.5">
              <p className="text-[12px] text-muted">{x.label}</p>
              <p className="text-[17px] font-semibold tnum">{x.key === 'skinTempDelta' ? `${x.value > 0 ? '+' : ''}${x.value}` : x.value} <span className="text-[12px] font-normal text-muted">{x.unit}</span></p>
              <p className={`text-[12px] tnum ${x.z >= 1.5 ? 'text-caution font-medium' : 'text-muted'}`}>{Math.abs(x.z) < 0.5 ? 'your usual' : x.text}</p>
            </li>
          ))}
        </ul>
      )}
      {compact ? (f.learned.first && <p className="text-[13px] text-muted">For you, {SIGNAL_WORD[f.learned.first]} usually moves first.</p>) : <p className="text-[13px] text-muted">
        {f.learned.episodes === 0 ? 'Learning your usual. Tell it when you get sick and it learns your early signs.'
          : `Learned from ${f.learned.episodes} past illness${f.learned.episodes === 1 ? '' : 'es'}${f.learned.first ? `: ${f.learned.first === 'skinTempDelta' ? 'skin temperature' : f.learned.first === 'restingHr' ? 'resting heart rate' : f.learned.first === 'respRate' ? 'breathing rate' : f.learned.first === 'hrvMs' ? 'HRV' : 'blood oxygen'} usually moves first for you` : ''}${f.learned.checked ? `. It would have flagged ${f.learned.caught} of ${f.learned.checked} a day or more ahead` : ''}.`}
      </p>}
      {f.level !== 'clear' && !answered && (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => answer('sick')} className="min-h-[44px] rounded-btn bg-surface-2 font-medium text-[14px]">I'm unwell</button>
          <button type="button" onClick={() => answer('fine')} className="min-h-[44px] rounded-btn bg-surface-2 font-medium text-[14px]">I feel fine</button>
        </div>
      )}
      {answered && <p className="text-[13px] text-muted">You said: {answered === 'sick' ? 'unwell' : 'fine'}.</p>}
    </div>
  );
}

/** Health: the sickness watch, always on show (clear or not), with every signal against usual. */
export function SickCard() {
  const t = useToday();
  if (!t?.sick) return null;
  const f = t.sick;
  return (
    <section className={`box space-y-1 ${f.level === 'clear' ? '' : 'border-l-4'}`} style={f.level === 'clear' ? undefined : { borderLeftColor: 'var(--caution)' }} aria-labelledby="sick-h">
      <div className="flex items-center gap-3">
        <MiniRing value={f.score} max={100} size={52} tone={f.level === 'clear' ? 'good' : 'watch'} label={`Sickness score ${f.score} of 100`}>{f.score}</MiniRing>
        <div className="flex-1 min-w-0">
          <h2 id="sick-h" className="font-semibold flex items-center gap-1.5"><Activity size={16} aria-hidden="true" />Sickness watch</h2>
          <p className="text-[15px]">{f.level === 'clear' ? 'Nothing off together last night.' : f.level === 'likely' ? 'Your body may be fighting something.' : 'Early signs your body is under strain.'}</p>
        </div>
      </div>
      <SickBody f={f} settings={t.settings} personId={t.personId} compact={false} />
      <p className="text-[12px] text-muted flex items-center gap-1"><HeartPulse size={12} aria-hidden="true" />From your watch's overnight readings, against your own usual. A nudge, not a diagnosis.</p>
    </section>
  );
}
