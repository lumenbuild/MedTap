// One weekly review: last week's results (wins first), what drove them (the things that move your results, against
// how often they usually happen), how each medicine is doing, and next week's three levers.
import { format } from 'date-fns';
import { ArrowRight, CheckCircle2, CircleDashed, CircleHelp, Pill, Sparkles, Target, XCircle } from 'lucide-react';
import { useDecisionData } from '../app/useDecisions';
import { useNow } from '../app/useNow';
import { useWeekReview, ReviewLines } from '../components/WeekReview';
import { driversFor, type Topic } from '../logic/drivers';
import { weekCauses, nextLevers } from '../logic/weekPlan';
import { verdicts, type VerdictStatus } from '../logic/verdict';
import { weightTrend } from '../logic/bodyModel';
import { personalLevers } from '../logic/aheadSmarts';
import { shownName } from '../logic/privacy';
import { ymd } from '../logic/day';
import { setSetting } from '../db/repos/settings';
import { HAS_BODY, HAS_MEDS } from '../edition';

const STATUS: Record<VerdictStatus, { label: string; Icon: typeof Pill; colour: string }> = {
  working: { label: 'Working', Icon: CheckCircle2, colour: 'var(--success)' },
  worse: { label: 'Worse on it', Icon: XCircle, colour: 'var(--danger)' },
  'not-working': { label: 'No clear effect', Icon: XCircle, colour: 'var(--caution)' },
  unclear: { label: 'Not clear yet', Icon: CircleHelp, colour: 'var(--text-muted)' },
  'too-early': { label: 'Too early', Icon: CircleDashed, colour: 'var(--text-muted)' },
  'cant-measure': { label: 'Nothing to measure', Icon: CircleDashed, colour: 'var(--text-muted)' },
};

export function Week() {
  const r = useWeekReview();
  const dd = useDecisionData();
  const now = useNow(3_600_000);
  if (!dd || dd.everyone) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const { data, s, settings } = dd;
  const start = r?.d.weekStart, end = r?.d.weekEnd;
  // Without a review yet (a first week), the last 7 days.
  const from = ymd(start ?? now - 7 * 86_400_000), to = ymd((end ?? now) - 43_200_000);
  const topics: Topic[] = ['sleep', 'rhr', 'focus', ...(HAS_BODY ? ['weight' as const] : [])];
  const all = topics.map((t) => driversFor(t, { ...data, proteinTarget: settings.proteinTargetG }, now, s));
  const causes = weekCauses(all, from, to);
  const tr = HAS_BODY ? weightTrend({ body: data.body, foodLogs: data.foodLogs, workouts: data.workouts, checkIns: data.checkIns, daily: data.daily, doses: data.doses, meds: data.meds }, now) : null;
  const levers = nextLevers(all, from, to, personalLevers({ trend: tr, daily: data.daily, foodLogs: data.foodLogs, target: settings.energyTargetKcal }, now, s));
  const vs = HAS_MEDS ? verdicts(data, now, s) : [];
  return (
    <div className="space-y-4">
      <section className="hero mind" aria-labelledby="wk-h">
        <p className="hero-label">{format(new Date(`${from}T12:00`), 'd MMM')} – {format(new Date(`${to}T12:00`), 'd MMM')}</p>
        <h2 id="wk-h" className="mt-1 text-[24px] leading-[30px] font-bold">{r?.d.headline ?? 'Your week so far'}</h2>
      </section>

      {r && (
        <section className="box" aria-labelledby="res-h">
          <h2 id="res-h" className="text-sm font-medium text-muted">Results</h2>
          <ReviewLines d={r.d} />
        </section>
      )}

      <section className="box space-y-2" aria-labelledby="why-h">
        <h2 id="why-h" className="font-semibold flex items-center gap-1.5"><Sparkles size={16} aria-hidden="true" />What drove it</h2>
        {causes.length ? (
          <ul className="space-y-2">{causes.map((c) => (
            <li key={`${c.topic}-${c.label}`} className="flex gap-2.5">
              <span aria-hidden="true" className="mt-1.5 w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.helps ? 'var(--success)' : 'var(--caution)' }} />
              <span className="leading-snug">{c.text}.</span>
            </li>))}
          </ul>
        ) : <p className="text-muted">Nothing ran far from usual last week{all.every((d) => !d.drivers.length) ? ', and your drivers are still building up (about 3 weeks of days needed)' : ''}.</p>}
        <p className="flex flex-wrap gap-1.5 pt-1">{all.filter((d) => d.drivers.length).map((d) => <a key={d.topic} href={`#/topic/${d.topic}`} className="inline-flex items-center min-h-[32px] px-3 rounded-full bg-surface-2 text-[13px] font-medium">What moves {d.label.toLowerCase()}</a>)}</p>
      </section>

      {vs.length > 0 && (
        <section className="box space-y-1" aria-labelledby="meds-wk-h">
          <h2 id="meds-wk-h" className="text-sm font-medium text-muted">Your medicines</h2>
          <ul className="divide-y divide-border">{vs.map((v) => {
            const st = STATUS[v.status];
            return (
              <li key={v.med.id}><a href={`#/meds/${v.med.id}`} className="flex items-start gap-3 py-2.5 min-h-[44px]">
                <st.Icon size={20} aria-hidden="true" className="shrink-0 mt-0.5" style={{ color: st.colour }} />
                <span className="flex-1 min-w-0"><span className="block font-medium">{shownName(v.med)} <span className="text-sm font-normal text-muted">· {st.label}</span></span><span className="block text-sm text-muted leading-snug">{v.headline}</span></span>
              </a></li>
            );
          })}</ul>
        </section>
      )}

      <section className="box space-y-3" aria-labelledby="next-h">
        <h2 id="next-h" className="font-semibold flex items-center gap-1.5"><Target size={16} aria-hidden="true" />Next week's three levers</h2>
        {levers.length ? (
          <ol className="space-y-3">{levers.map((l, i) => (
            <li key={l.title} className="flex gap-3">
              <span aria-hidden="true" className="w-7 h-7 rounded-full bg-text text-bg flex items-center justify-center text-[14px] font-bold shrink-0">{i + 1}</span>
              <span><span className="block font-semibold leading-snug">{l.title}</span><span className="block text-sm text-muted leading-snug">{l.why}</span></span>
            </li>))}
          </ol>
        ) : <p className="text-muted">These come from your own days once there are a few weeks of them.</p>}
      </section>

      {r && r.seen < r.d.weekStart && (
        <button type="button" onClick={() => setSetting('digestSeen', r.d.weekStart)} className="w-full min-h-[48px] rounded-btn bg-primary text-on-primary font-semibold flex items-center justify-center gap-2">Done with last week <ArrowRight size={18} aria-hidden="true" /></button>
      )}
    </div>
  );
}
