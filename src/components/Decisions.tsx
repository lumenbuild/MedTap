// The decision features where people already look: today's calls and warnings on Today, an "Is it working?" summary
// on Insights and Health, and each medicine's verdict and dose decision on its page.
import { ChevronRight, Scale } from 'lucide-react';
import type { Medication } from '../db/schema';
import { useDecisionData } from '../app/useDecisions';
import { useNow } from '../app/useNow';
import { verdictFor, verdicts } from '../logic/verdict';
import { doseDecision, earlyWarnings, todaysCalls } from '../logic/decisions';
import { CallsCard, setJudgeBy, VerdictCard } from './Verdicts';

export function TodayCalls() {
  const dd = useDecisionData();
  const now = useNow(600_000);
  if (!dd || dd.everyone) return null;
  const { data, s, settings } = dd;
  const calls = todaysCalls(data, now, s, settings);
  const warnings = earlyWarnings(data, now, s);
  return <CallsCard calls={calls} warnings={warnings} />;
}

/** "Is it working?": how many of the things taken are working, not clear yet, or not working, opening the full list. */
export function WorkingLink() {
  const dd = useDecisionData();
  const now = useNow(3_600_000);
  if (!dd || dd.everyone) return null;
  const vs = verdicts(dd.data, now, dd.s);
  if (!vs.length) return null;
  const n = (xs: string[]) => vs.filter((v) => xs.includes(v.status)).length;
  const parts = [`${n(['working'])} working`, `${n(['unclear', 'too-early', 'cant-measure'])} not clear yet`, `${n(['not-working', 'worse'])} no effect`].filter((x) => !x.startsWith('0 '));
  return (
    <a href="#/working" className="box flex items-center gap-3 min-h-[64px] active:scale-[0.99] transition-transform">
      <span aria-hidden="true" className="w-9 h-9 rounded-[10px] flex items-center justify-center text-white shrink-0" style={{ background: 'var(--c-mind)' }}><Scale size={19} /></span>
      <span className="flex-1 min-w-0"><span className="block font-semibold">Is it working?</span><span className="block text-sm text-muted tnum">{parts.join(' · ')}</span></span>
      <ChevronRight size={18} aria-hidden="true" className="text-muted" />
    </a>
  );
}

/** A medicine's page: its verdict and, where there is one, the dose decision. */
export function MedVerdict({ med }: { med: Medication }) {
  const dd = useDecisionData();
  const now = useNow(3_600_000);
  if (!dd) return null;
  const v = verdictFor(med, dd.data, now, dd.s);
  return <VerdictCard v={v} personId={dd.personId} dose={doseDecision(med, dd.data, now, dd.s)} showName={false} onJudgeBy={(o) => setJudgeBy(med, o)} />;
}
