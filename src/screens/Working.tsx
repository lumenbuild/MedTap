// What's working: a verdict for everything taken, the supplements worth a second look, early warnings, and what went
// with better or worse over the last 2 months, with one thing to try next.
import { FlaskConical } from 'lucide-react';
import { useDecisionData } from '../app/useDecisions';
import { useNow } from '../app/useNow';
import { useToast } from '../app/toast';
import { verdicts, supplementAudit, type Verdict } from '../logic/verdict';
import { doseDecision, earlyWarnings, whatsWorking } from '../logic/decisions';
import { setArchived } from '../db/repos/meds';
import { ExperimentOffer, setJudgeBy, VerdictCard, WarningRow, WhatsWorkingCard } from '../components/Verdicts';

export function Working() {
  const dd = useDecisionData();
  const now = useNow(600_000);
  const toast = useToast();
  if (!dd) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const { data, s, personId } = dd;
  const vs = verdicts(data, now, s);
  const counts = (st: Verdict['status'][]) => vs.filter((v) => st.includes(v.status)).length;
  const audit = supplementAudit(vs, data.doses, now);
  const warnings = earlyWarnings(data, now, s);
  const ww = whatsWorking(data, now, s);
  const shown = vs.filter((v) => !audit.includes(v));
  return (
    <div className="space-y-3 pb-8">
      <section className="hero mind" aria-label="Summary">
        <p className="hero-label">Is it working?</p>
        <div className="mt-2 grid grid-cols-3 gap-2 tnum">
          <div><p className="text-[40px] leading-[44px] font-bold">{counts(['working'])}</p><p className="text-muted text-[15px]">working</p></div>
          <div><p className="text-[40px] leading-[44px] font-bold">{counts(['unclear', 'too-early'])}</p><p className="text-muted text-[15px]">not clear yet</p></div>
          <div><p className="text-[40px] leading-[44px] font-bold">{counts(['not-working', 'worse'])}</p><p className="text-muted text-[15px]">no effect or worse</p></div>
        </div>
        <p className="mt-3 text-muted text-[15px]">Each judged by what it's for, from your own data: on/off tests first, then days on against off, then before against since starting.</p>
      </section>

      {warnings.length > 0 && <section className="space-y-2" aria-label="Early warnings">{warnings.map((w) => <WarningRow key={w.key} w={w} />)}</section>}

      {shown.map((v) => <VerdictCard key={v.med.id} v={v} personId={personId} dose={doseDecision(v.med, data, now, s)} onJudgeBy={(o) => setJudgeBy(v.med, o)} />)}

      {audit.length > 0 && (
        <section className="box space-y-3" aria-labelledby="audit-h">
          <h2 id="audit-h" className="text-sm font-medium text-muted">Supplements worth a second look</h2>
          {audit.map((v) => (
            <div key={v.med.id} className="space-y-2 border-t border-border pt-3 first:border-0 first:pt-0">
              <p><a href={`#/meds/${v.med.id}`} className="font-semibold underline underline-offset-4">{v.med.nickname?.trim() || v.med.name}</a> <span className="text-muted">· {v.status === 'cant-measure' ? 'nothing measures it' : v.status === 'worse' ? 'going the wrong way' : v.status === 'unclear' ? 'no clear effect after 4+ weeks' : 'no measurable effect'}</span></p>
              {v.evidence[0] && <p className="text-[15px] tnum">{v.evidence[0]}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="min-h-[44px] px-4 rounded-btn font-semibold" style={{ background: 'var(--fill)' }}
                  onClick={async () => { await setArchived(v.med.id, true); toast(`${v.med.nickname?.trim() || v.med.name} stopped (moved to archived)`, { onAction: () => setArchived(v.med.id, false) }); }}>Stop taking it</button>
              </div>
              {v.experiment && <ExperimentOffer p={v.experiment} personId={personId} why="Or find out for sure:" />}
            </div>
          ))}
        </section>
      )}

      <WhatsWorkingCard w={ww} personId={personId} />

      <a href="#/experiments" className="box flex items-center gap-3 min-h-[56px]"><FlaskConical size={20} aria-hidden="true" className="text-[var(--c-mind)]" /><span className="flex-1 font-semibold">Your experiments</span><span aria-hidden="true" className="text-muted">›</span></a>
    </div>
  );
}
