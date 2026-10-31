// The insights on screen, all in one design: an icon, a headline, what it rests on, one thing to do, and "Not now".
// Today shows the top couple (TopInsights); Progress shows every one (InsightFeed). Acting on one that changes a
// setting also notes it, so the app can check back a few weeks later on what happened.
import { useMemo, useState } from 'react';
import { Activity, ArrowDownRight, ClipboardList, Pill, Brain, Thermometer, TrendingDown, TrendingUp, BatteryLow, CalendarDays, CalendarX, Clock, Footprints, Moon, Scale, Coffee, Droplet, Dumbbell, FileText, HeartPulse, Layers, Lightbulb, SearchCheck, Sparkles, Target, Utensils, X, Zap, type LucideIcon } from 'lucide-react';
import { certainty, insights, type Insight, type InsightKind } from '../logic/insights';
import { fmtTime } from '../logic/format';
import { oddRecords } from '../logic/records';
import { setSetting, type AppSettings } from '../db/repos/settings';
import { dosesForPerson, medIsFor, personOf } from '../db/repos/people';
import { db } from '../db/db';
import { useLive } from '../db/live';
import { useAppointments, useBodyEntries, useCheckIns, useDaily, useDoses, useFamily, useMedEvents, useMeds, useScheduleSettings, useVitals, useWorkouts } from '../app/data';
import { useNow } from '../app/useNow';
import { useToast } from '../app/toast';
import { HAS_BODY, HAS_FOOD, HAS_MEDS, HAS_PEPTIDES, HAS_TRAINING } from '../edition';
import { OddSheet } from './Smart';
import { Button } from './ui/Button';

const ICON: Record<InsightKind, LucideIcon> = {
  script: FileText, reading: HeartPulse, stall: Droplet, wearoff: Zap, change: ArrowDownRight, odd: SearchCheck, cutoff: Coffee,
  calories: Utensils, protein: Dumbbell, lean: Dumbbell, appointment: CalendarDays, followup: Sparkles, steps: Footprints, sleep: Moon, gut: Utensils, eating: Utensils, regain: Scale, maintain: Scale,
  second: Clock, dosecut: Moon, bestdose: Target, crash: BatteryLow, load: Layers, heart: Activity, undereat: Utensils, missed: CalendarX,
  illness: Thermometer, tolerance: TrendingDown, creep: TrendingUp, fluids: Droplet, appetite: Utensils, rebound: Brain, review: ClipboardList, supplement: Pill,
};
const TONE = { watch: { bg: 'var(--caution-soft)', fg: 'var(--caution)' }, good: { bg: 'var(--success-soft)', fg: 'var(--success)' }, plain: { bg: 'var(--fill)', fg: 'var(--primary)' } };
/** Each kind in the colour of its part of the app (sleep, heart, activity, body, peptides, focus, medicines). */
const AREA: Partial<Record<InsightKind, string>> = {
  sleep: 'sleep', dosecut: 'sleep', cutoff: 'sleep',
  reading: 'heart', heart: 'heart', illness: 'heart',
  steps: 'act', protein: 'act', lean: 'act',
  regain: 'body', maintain: 'body', calories: 'body', undereat: 'body', eating: 'body',
  stall: 'pep', fluids: 'pep', appetite: 'pep', gut: 'pep', missed: 'pep',
  wearoff: 'mind', second: 'mind', bestdose: 'mind', crash: 'mind', rebound: 'mind', load: 'mind', tolerance: 'mind', creep: 'mind', review: 'mind',
};

/** Every insight for the person shown, worked out once a minute (or when the records change). */
export function useInsights(): { list: Insight[]; settings: AppSettings } | null {
  const meds = useMeds(); const doses = useDoses(); const checkIns = useCheckIns(); const daily = useDaily(); const body = useBodyEntries();
  const vitals = useVitals(); const workouts = useWorkouts(); const events = useMedEvents(); const appointments = useAppointments();
  const foodLogs = useLive(() => db.foodLogs.where('at').aboveOrEqual(new Date(Date.now() - 70 * 86_400_000).toISOString()).toArray(), []);
  const ss = useScheduleSettings(); const fam = useFamily();
  const minute = Math.floor(useNow(60_000) / 60_000);
  return useMemo(() => {
    if (!meds || !doses || !checkIns || !daily || !body || !vitals || !workouts || !events || !appointments || !foodLogs || !ss || !fam || fam.everyone) return null;
    const [settings, s] = ss;
    const who = fam.personId;
    const me = <T extends { personId?: string; deletedAt?: string }>(r: T) => personOf(r) === who;
    const pm = meds.filter((m) => medIsFor(m, who));
    const ids = new Set(pm.map((m) => m.id));
    const list = insights({
      meds: pm, doses: dosesForPerson(doses.filter((d) => ids.has(d.medicationId)), pm, who), checkIns: checkIns.filter(me), daily: daily.filter(me),
      body: HAS_BODY ? body.filter(me) : [], vitals: vitals.filter(me), workouts: workouts.filter(me), events, foodLogs: foodLogs.filter(me),
      appointments: appointments.filter(me), goals: fam.people.find((p) => p.id === who)?.goals ?? [], settings, units: settings.units,
      has: { body: HAS_BODY, food: HAS_FOOD && settings.foodTracking, training: HAS_TRAINING && settings.trainingTools, meds: HAS_MEDS, biohack: HAS_PEPTIDES && settings.biohackTools },
    }, minute * 60_000, s);
    return { list, settings };
  }, [minute, meds, doses, checkIns, daily, body, vitals, workouts, events, appointments, foodLogs, ss, fam]);
}

/** One insight: icon, headline, evidence, its action and Not now. */
export function InsightRow({ x, settings }: { x: Insight; settings: AppSettings }) {
  const toast = useToast();
  const [odd, setOdd] = useState(false);
  const now = useNow(60_000);
  const area = AREA[x.kind] ?? 'meds';
  // Watch and good keep their meaning; the rest wear their area's colour.
  const tone = x.tone === 'plain' ? { bg: `var(--c-${area})`, fg: '#FFFFFF' } : TONE[x.tone];
  const Icon = ICON[x.kind] ?? Lightbulb;
  const hide = async (days: number) => {
    const until = now + (days > 0 ? days : 3650) * 86_400_000;
    const before = settings.insightsHidden;
    // Keep the list short: drop anything already back on show.
    const kept = Object.fromEntries(Object.entries(before).filter(([, t]) => t > now));
    await setSetting('insightsHidden', { ...kept, [x.id]: until });
    toast(days > 0 && days < 365 ? `Put away for ${days === 1 ? 'today' : `${days} days`}` : 'Put away', { onAction: () => setSetting('insightsHidden', before) });
  };
  const act = async () => {
    const a = x.action;
    if (!a) return;
    if (a.kind === 'go') { location.hash = a.href; return; }
    if (a.kind === 'odd') { setOdd(true); return; }
    const before = settings[a.key];
    await setSetting(a.key, a.value as never);
    if (a.followUp) await setSetting('followUps', [...settings.followUps.filter((f) => f.kind !== a.followUp!.kind), { id: `${a.followUp.kind}-${now}`, at: now, ...a.followUp }]);
    // The calorie target follows: worked out (and kept up to date) for the new aim.
    if (a.key === 'energyAuto' || a.key === 'lossRateKgWeek') {
      if (a.key === 'lossRateKgWeek') await setSetting('energyAuto', true);
      const { updateCalorieTarget } = await import('../app/maintenance'); await setSetting('energyAutoAt', 0); await updateCalorieTarget();
    }
    toast(`${a.done}. ${a.followUp ? 'It’ll check back in a few weeks.' : ''}`.trim(), { onAction: () => setSetting(a.key, before as never) });
  };
  const span = x.bar ? x.bar.late - x.bar.from : 0;
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - x.bar!.from) / span) * 100));
  return (
    <li className="py-2.5 flex items-start gap-3">
      <span aria-hidden="true" className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: tone.bg, color: tone.fg }}><Icon size={18} /></span>
      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-medium leading-snug">{x.headline}</p>
        {x.evidence && <p className="text-sm text-muted leading-snug mt-0.5">{x.evidence}</p>}
        {x.lines && x.lines.length > 0 && <ul className="text-sm text-muted leading-snug mt-1 space-y-0.5 list-disc pl-4">{x.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
        {x.n !== undefined && <p className="text-[12px] text-muted mt-0.5"><span className="font-medium">{certainty(x)}</span> · {x.n} {x.nOf ?? 'records'}</p>}
        {x.bar && (
          <>
            <div className="mt-2 relative h-2 rounded-full bg-surface-2" role="img" aria-label={`From the dose at ${fmtTime(x.bar.from)} to a likely drop between ${fmtTime(x.bar.early)} and ${fmtTime(x.bar.late)}`}>
              <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct(x.bar.early)}%`, background: 'var(--success)' }} />
              <div className="absolute inset-y-0 rounded-full" style={{ left: `${pct(x.bar.early)}%`, width: `${pct(x.bar.late) - pct(x.bar.early)}%`, background: 'var(--caution-soft)' }} />
              <div className="absolute -top-1 -bottom-1 w-0.5 bg-text" style={{ left: `${pct(now)}%` }} />
            </div>
            <div className="mt-0.5 flex justify-between text-[11px] text-muted tnum"><span>{fmtTime(x.bar.from)}</span><span>{fmtTime(x.bar.early)}–{fmtTime(x.bar.late)}</span></div>
          </>
        )}
        {x.lanes && x.lanes.length > 0 && <Lanes lanes={x.lanes} now={now} />}
        {x.action && <Button variant="secondary" className="mt-2 min-h-[44px]" onClick={act}>{x.action.label}</Button>}
      </div>
      <button type="button" onClick={() => hide(x.snoozeDays)} aria-label={`Not now: ${x.headline}`} className="w-11 h-11 -mr-2 -mt-1.5 rounded-full flex items-center justify-center text-muted shrink-0">
        <X size={18} aria-hidden="true" />
      </button>
      {odd && <OddInsightSheet settings={settings} onClose={() => setOdd(false)} />}
    </li>
  );
}

/** Odd records, with the data the sheet needs. */
function OddInsightSheet({ settings, onClose }: { settings: AppSettings; onClose: () => void }) {
  const meds = useMeds(); const doses = useDoses(); const body = useBodyEntries(); const checkIns = useCheckIns(); const vitals = useVitals();
  const fam = useFamily();
  const now = useNow(60_000);
  if (!meds || !doses || !body || !checkIns || !vitals || !fam) return null;
  const me = <T extends { personId?: string }>(r: T) => personOf(r) === fam.personId;
  const pm = meds.filter((m) => medIsFor(m, fam.personId));
  const ids = new Set(pm.map((m) => m.id));
  const pd = dosesForPerson(doses.filter((d) => ids.has(d.medicationId)), pm, fam.personId);
  return <OddSheet odd={oddRecords(pm, pd, HAS_BODY ? body.filter(me) : [], checkIns.filter(me), vitals.filter(me), now, settings.oddDismissed)} dismissed={settings.oddDismissed} onClose={onClose} />;
}

/** Today: the one or two that matter most, and a link to the rest. */
export function TopInsights({ max = 2 }: { max?: number }) {
  const r = useInsights();
  if (!r || !r.list.length) return null;
  // The daily brief above already says these (second dose, appetite coming back, water).
  const list = r.list.filter((x) => !['second', 'appetite', 'fluids'].includes(x.kind));
  if (!list.length) return null;
  const top = list.slice(0, max);
  const more = list.length - top.length;
  return (
    <section aria-labelledby="ins-h" className="box">
      <h2 id="ins-h" className="sr-only">For you</h2>
      <ul className="divide-y divide-border">{top.map((x) => <InsightRow key={x.id} x={x} settings={r.settings} />)}</ul>
      {more > 0 && <a href="#/progress/trends" className="min-h-[44px] flex items-center text-sm font-medium underline underline-offset-4">{more} more insight{more === 1 ? '' : 's'}</a>}
    </section>
  );
}

/** Progress: every insight, most important first (the first few, then the rest on request). */
export function InsightFeed({ max = 3 }: { max?: number }) {
  const r = useInsights();
  const [all, setAll] = useState(false);
  if (!r || !r.list.length) return null;
  const shown = all ? r.list : r.list.slice(0, max);
  return (
    <section aria-labelledby="feed-h" className="space-y-1">
      <h2 id="feed-h" className="text-sm font-medium text-muted">For you</h2>
      <ul className="divide-y divide-border">{shown.map((x) => <InsightRow key={x.id} x={x} settings={r.settings} />)}</ul>
      {r.list.length > max && <button type="button" aria-expanded={all} onClick={() => setAll((x) => !x)} className="min-h-[44px] text-sm font-medium underline underline-offset-4">{all ? 'Show fewer' : `Show all ${r.list.length}`}</button>}
    </section>
  );
}

/** A day's timeline (6 am to midnight) with a bar for each lane: what's working when, and where it overlaps. */
function Lanes({ lanes, now }: { lanes: { label: string; from: number; to: number }[]; now: number }) {
  const d0 = new Date(now); d0.setHours(6, 0, 0, 0);
  const from = d0.getTime(), span = 18 * 3_600_000;
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - from) / span) * 100));
  return (
    <div className="mt-2 space-y-1" role="img" aria-label={lanes.map((l) => `${l.label} ${fmtTime(l.from)} to ${fmtTime(l.to)}`).join(', ')}>
      {lanes.map((l, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-[11px] text-muted truncate">{l.label}</span>
          <div className="relative flex-1 h-2 rounded-full bg-surface-2">
            <div className="absolute inset-y-0 rounded-full" style={{ left: `${pct(l.from)}%`, width: `${Math.max(2, pct(l.to) - pct(l.from))}%`, background: 'var(--primary)' }} />
            <div className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-text" style={{ left: `${pct(now)}%` }} />
          </div>
        </div>
      ))}
      <div className="flex justify-between pl-[72px] text-[11px] text-muted tnum"><span>6 am</span><span>noon</span><span>6 pm</span><span>12</span></div>
    </div>
  );
}
