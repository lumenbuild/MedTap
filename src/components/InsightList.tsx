// The insights on screen, all in one design: an icon, a headline, what it rests on, one thing to do, and "Not now".
// Today shows the top couple (TopInsights); Progress shows every one (InsightFeed). Acting on one that changes a
// setting also notes it, so the app can check back a few weeks later on what happened.
import { useMemo, useState } from 'react';
import { ArrowDownRight, CalendarDays, Coffee, Droplet, Dumbbell, FileText, HeartPulse, Lightbulb, SearchCheck, Sparkles, Utensils, X, Zap, type LucideIcon } from 'lucide-react';
import { insights, type Insight, type InsightKind } from '../logic/insights';
import { fmtTime } from '../logic/format';
import { oddRecords } from '../logic/records';
import { setSetting, type AppSettings } from '../db/repos/settings';
import { dosesForPerson, medIsFor, personOf } from '../db/repos/people';
import { db } from '../db/db';
import { useLive } from '../db/live';
import { useAppointments, useBodyEntries, useCheckIns, useDaily, useDoses, useFamily, useMedEvents, useMeds, useScheduleSettings, useVitals, useWorkouts } from '../app/data';
import { useNow } from '../app/useNow';
import { useToast } from '../app/toast';
import { HAS_BODY, HAS_FOOD, HAS_MEDS, HAS_TRAINING } from '../edition';
import { OddSheet } from './Smart';
import { Button } from './ui/Button';

const ICON: Record<InsightKind, LucideIcon> = {
  script: FileText, reading: HeartPulse, stall: Droplet, wearoff: Zap, change: ArrowDownRight, odd: SearchCheck, cutoff: Coffee,
  calories: Utensils, protein: Dumbbell, lean: Dumbbell, appointment: CalendarDays, followup: Sparkles,
};
const TONE = { watch: { bg: 'var(--caution-soft)', fg: 'var(--caution)' }, good: { bg: 'var(--success-soft)', fg: 'var(--success)' }, plain: { bg: 'var(--surface-2)', fg: 'var(--primary)' } };

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
      has: { body: HAS_BODY, food: HAS_FOOD && settings.foodTracking, training: HAS_TRAINING && settings.trainingTools, meds: HAS_MEDS },
    }, minute * 60_000, s);
    return { list, settings };
  }, [minute, meds, doses, checkIns, daily, body, vitals, workouts, events, appointments, foodLogs, ss, fam]);
}

/** One insight: icon, headline, evidence, its action and Not now. */
export function InsightRow({ x, settings }: { x: Insight; settings: AppSettings }) {
  const toast = useToast();
  const [odd, setOdd] = useState(false);
  const now = useNow(60_000);
  const tone = TONE[x.tone];
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
    if (a.key === 'energyAuto') { const { updateCalorieTarget } = await import('../app/maintenance'); await setSetting('energyAutoAt', 0); await updateCalorieTarget(); }
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
  const top = r.list.slice(0, max);
  const more = r.list.length - top.length;
  return (
    <section aria-labelledby="ins-h" className="border-t border-border pt-3">
      <h2 id="ins-h" className="sr-only">For you</h2>
      <ul className="divide-y divide-border">{top.map((x) => <InsightRow key={x.id} x={x} settings={r.settings} />)}</ul>
      {more > 0 && <a href="#/progress/trends" className="min-h-[44px] flex items-center text-sm font-medium underline underline-offset-4">{more} more insight{more === 1 ? '' : 's'}</a>}
    </section>
  );
}

/** Progress: every insight, most important first. */
export function InsightFeed() {
  const r = useInsights();
  if (!r || !r.list.length) return null;
  return (
    <section aria-labelledby="feed-h" className="space-y-1">
      <h2 id="feed-h" className="text-sm font-medium text-muted">For you</h2>
      <ul className="divide-y divide-border">{r.list.map((x) => <InsightRow key={x.id} x={x} settings={r.settings} />)}</ul>
    </section>
  );
}
