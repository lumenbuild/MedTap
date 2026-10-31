// Decisions on screen: a verdict for each medicine, peptide and supplement (with its evidence, costs, how sure, and a
// test that would settle it), dose decisions, today's calls, early warnings, and what's working this week.
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, CircleDashed, CircleHelp, FlaskConical, MinusCircle, XCircle } from 'lucide-react';
import type { Medication } from '../db/schema';
import { db } from '../db/db';
import { storedPerson } from '../db/repos/people';
import { randomBlocks } from '../logic/experiments';
import { lower, OUTCOMES, type Outcome, type ProposedExperiment, type Verdict } from '../logic/verdict';
import type { Call, DoseDecision, Warning, WhatsWorking } from '../logic/decisions';
import { fmtHM } from '../logic/sleep';
import { useToast } from '../app/toast';
import { go } from '../app/router';

const STATUS: Record<Verdict['status'], { word: string; Icon: typeof CheckCircle2; colour: string }> = {
  working: { word: 'Working', Icon: CheckCircle2, colour: 'var(--success)' },
  worse: { word: 'Going the wrong way', Icon: XCircle, colour: 'var(--danger)' },
  'not-working': { word: 'No clear effect', Icon: MinusCircle, colour: 'var(--text-muted)' },
  unclear: { word: 'Not clear yet', Icon: CircleHelp, colour: 'var(--primary)' },
  'too-early': { word: 'Too early', Icon: CircleDashed, colour: 'var(--text-muted)' },
  'cant-measure': { word: 'Nothing measures it', Icon: CircleDashed, colour: 'var(--text-muted)' },
};

const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Start a proposed on/off test (random blocks, from today) and open Experiments. */
export function useStartExperiment(personId: string) {
  const toast = useToast();
  return async (p: ProposedExperiment) => {
    const at = new Date().toISOString();
    await db.experiments.add({ id: crypto.randomUUID(), title: p.title, a: p.a, b: p.b, metric: p.metric, blockDays: p.blockDays, blocks: randomBlocks(p.blocks), start: ymd(Date.now()), personId: storedPerson(personId), createdAt: at, updatedAt: at });
    toast(`Started: ${p.weeks} weeks. Today's condition shows on Today.`);
    go('/experiments');
  };
}

export function ExperimentOffer({ p, personId, why }: { p: ProposedExperiment; personId: string; why?: string }) {
  const start = useStartExperiment(personId);
  return (
    <div className="rounded-card bg-surface-2 p-3 space-y-2">
      <p className="text-[15px] flex items-start gap-2"><FlaskConical size={18} aria-hidden="true" className="shrink-0 mt-0.5 text-[var(--c-mind)]" />
        <span>{why ?? 'To know for sure:'} {p.blockDays}-day blocks of <strong>{p.a}</strong> and <strong>{p.b.replace(/^No /, 'no ')}</strong> in a random order for {p.weeks} weeks, judged by {OUTCOME_OF_METRIC[p.metric]}.</span></p>
      <button type="button" onClick={() => start(p)} className="min-h-[44px] px-4 rounded-btn bg-primary text-on-primary font-semibold">Start the test</button>
    </div>
  );
}
const OUTCOME_OF_METRIC: Record<string, string> = { focus: 'your focus ratings', mood: 'your mood ratings', energy: 'your energy ratings', sleepH: 'sleep from the watch', deepMin: 'deep sleep from the watch', hrv: 'HRV from the watch', rhr: 'resting heart rate', weight: 'weight', brain: 'brain tests' };

/** A medicine's verdict: status, evidence, costs, how sure, what's next, and the test that would settle it. */
export function VerdictCard({ v, personId, dose, showName = true, onJudgeBy }: { v: Verdict; personId: string; dose?: DoseDecision | null; showName?: boolean; onJudgeBy?: (o: Outcome | '') => void }) {
  const st = STATUS[v.status];
  const name = v.med.nickname?.trim() || v.med.name;
  return (
    <article className="box space-y-2.5" aria-label={`${name}: ${st.word}`}>
      <div className="flex items-start gap-3">
        <st.Icon size={26} aria-hidden="true" className="shrink-0 mt-0.5" style={{ color: st.colour }} />
        <div className="flex-1 min-w-0">
          {showName && <a href={`#/meds/${v.med.id}`} className="text-[17px] font-semibold underline-offset-4 hover:underline">{name}</a>}
          <p className={showName ? 'text-[15px]' : 'text-[17px] font-semibold'}><span className="font-semibold" style={{ color: st.colour === 'var(--text-muted)' ? undefined : st.colour }}>{st.word}</span>{v.headline && v.headline !== st.word ? ` · ${v.headline}` : ''}</p>
          <p className="text-[13px] text-muted">{v.outcome ? `Judged by ${lower(OUTCOMES[v.outcome].label)}` : 'No measure picked'}{v.confidence ? ` · ${v.confidence}` : ''}{v.method ? ` · ${METHOD[v.method]}` : ''}</p>
        </div>
      </div>
      {v.evidence.length > 0 && <ul className="space-y-1 text-[15px] tnum">{v.evidence.map((e) => <li key={e}>{e}</li>)}</ul>}
      {v.costs.length > 0 && (
        <div className="rounded-btn bg-caution-soft p-2.5 text-[15px]">
          <p className="font-semibold flex items-center gap-1.5"><AlertTriangle size={16} aria-hidden="true" />What it costs</p>
          <ul className="mt-0.5">{v.costs.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      )}
      {dose && (
        <div className="rounded-btn bg-surface-2 p-2.5">
          <p className="font-semibold text-[15px]">{dose.title}</p>
          <ul className="text-sm text-muted">{dose.why.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
      {v.next && <p className="text-sm text-muted">{v.next}</p>}
      {v.experiment && <ExperimentOffer p={v.experiment} personId={personId} />}
      {onJudgeBy && (
        <label className="flex items-center gap-2 text-sm text-muted">
          <span>Judge it by</span>
          <select value={v.med.judgeBy ?? ''} onChange={(e) => onJudgeBy(e.target.value as Outcome | '')} className="min-h-[40px] rounded-btn bg-surface-2 px-2 text-[15px] text-text">
            <option value="">{v.outcome && !v.med.judgeBy ? `${OUTCOMES[v.outcome].label} (usual)` : 'Automatic'}</option>
            {(Object.keys(OUTCOMES) as Outcome[]).map((o) => <option key={o} value={o}>{OUTCOMES[o].label}</option>)}
          </select>
        </label>
      )}
    </article>
  );
}
const METHOD = { experiment: 'from your experiment', 'on-off': 'days on against days off', 'before-after': 'before against since starting', trend: 'trend since starting' } as const;

export async function setJudgeBy(med: Medication, o: Outcome | '') {
  await db.medications.update(med.id, { judgeBy: o || undefined, updatedAt: new Date().toISOString() });
}

/** Today's calls: train, caffeine, a second dose, food. */
export function CallsCard({ calls, warnings }: { calls: Call[]; warnings: Warning[] }) {
  if (!calls.length && !warnings.length) return null;
  const dot: Record<Call['tone'], string> = { go: 'var(--success)', easy: 'var(--caution)', stop: 'var(--danger)', info: 'var(--primary)' };
  return (
    <section className="box space-y-3" aria-labelledby="calls-h">
      <h2 id="calls-h" className="text-sm font-medium text-muted">Today's calls</h2>
      {warnings.map((w) => <WarningRow key={w.key} w={w} />)}
      {calls.length > 0 && (
        <ul className="divide-y divide-border">
          {calls.map((c) => (
            <li key={c.key} className="py-2.5 flex gap-3">
              <span aria-hidden="true" className="mt-[7px] w-2.5 h-2.5 rounded-full shrink-0" style={{ background: dot[c.tone] }} />
              <span><span className="block font-semibold">{c.title}</span><span className="block text-sm text-muted">{c.detail}</span></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function WarningRow({ w }: { w: Warning }) {
  return (
    <div className="rounded-btn bg-caution-soft p-3">
      <p className="font-semibold flex items-center gap-2"><AlertTriangle size={17} aria-hidden="true" className="shrink-0" />{w.title}</p>
      <p className="text-[15px]">{w.detail} {w.action}</p>
    </div>
  );
}

const fmtFactor = (o: Outcome, v: number) => (o === 'sleep' || o === 'deep' ? fmtHM(v) : o === 'recovery' ? `${Math.round(v)} ms` : v.toFixed(1));

/** What goes with better and worse, and one thing to try. */
export function WhatsWorkingCard({ w, personId }: { w: WhatsWorking; personId: string }) {
  if (!w.helps.length && !w.hurts.length && !w.tryNext) return null;
  const row = (f: WhatsWorking['helps'][number]) => (
    <li key={`${f.key}-${f.outcome}`} className="py-2 flex gap-2.5">
      {f.helps ? <ArrowUpRight size={18} aria-hidden="true" className="shrink-0 mt-0.5 text-success" /> : <ArrowDownRight size={18} aria-hidden="true" className="shrink-0 mt-0.5 text-caution" />}
      <span className="tnum"><span className="font-semibold">{f.label}</span>: {lower(OUTCOMES[f.outcome].label)} {fmtFactor(f.outcome, f.withIt)} against {fmtFactor(f.outcome, f.without)} without
        <span className="block text-[13px] text-muted">{f.nWith} and {f.nWithout} days · {f.p < 0.02 ? 'Solid' : f.p < 0.08 ? 'Likely' : 'Early'}</span></span>
    </li>
  );
  return (
    <section className="box space-y-2" aria-labelledby="ww-h">
      <h2 id="ww-h" className="text-sm font-medium text-muted">Your last 2 months</h2>
      {w.helps.length > 0 && <><p className="text-sm font-semibold text-success">Goes with better</p><ul className="divide-y divide-border">{w.helps.map(row)}</ul></>}
      {w.hurts.length > 0 && <><p className="text-sm font-semibold text-caution">Goes with worse</p><ul className="divide-y divide-border">{w.hurts.map(row)}</ul></>}
      {w.tryNext && <ExperimentOffer p={w.tryNext} personId={personId} why={`Try next: ${w.tryNext.why}`} />}
      <p className="text-[13px] text-muted">Things that go together, from your own days. An on/off test shows what causes what.</p>
    </section>
  );
}
