// What's working: a verdict for everything taken, the supplements worth a second look, early warnings, and what went
// with better or worse over the last 2 months, with one thing to try next.
import { ChevronRight, ClipboardCheck, FlaskConical } from 'lucide-react';
import { useDecisionData } from '../app/useDecisions';
import { useNow } from '../app/useNow';
import { useToast } from '../app/toast';
import { verdicts, supplementAudit, type Verdict } from '../logic/verdict';
import { earlyWarnings, whatsWorking } from '../logic/decisions';
import { shownName } from '../logic/privacy';
import { setArchived } from '../db/repos/meds';
import { ExperimentOffer, WarningRow, WhatsWorkingCard } from '../components/Verdicts';
import { StartClustersCard } from '../components/RealUse';
import { HardDaysCard, MonthRecapCard } from '../components/Graphics';

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

      <MonthRecapCard />
      <StartClustersCard />
      <HardDaysCard />
      <a href="#/datacheck" className="box flex items-center gap-3 min-h-[56px]"><ClipboardCheck size={18} aria-hidden="true" className="text-primary" /><span className="flex-1 font-medium">Check my records</span><ChevronRight size={18} aria-hidden="true" className="text-muted" /></a>
      {warnings.length > 0 && <section className="space-y-2" aria-label="Early warnings">{warnings.map((w) => <WarningRow key={w.key} w={w} />)}</section>}

      {/* One row each; the full verdict, what it's judged by and a test are on the medicine's own page. Ones
          too new to judge share one line. */}
      {(() => {
        const decided = shown.filter((v) => v.status !== 'too-early');
        const early = shown.filter((v) => v.status === 'too-early');
        const tone = (st: Verdict['status']) => st === 'working' ? 'var(--success)' : st === 'not-working' || st === 'worse' ? 'var(--caution)' : 'var(--muted)';
        return (
          <section className="box" aria-label="Each medicine">
            <ul className="divide-y divide-border">
              {decided.map((v) => (
                <li key={v.med.id}>
                  <a href={`#/meds/${v.med.id}`} className="min-h-[60px] flex items-center gap-3 py-2">
                    <span aria-hidden="true" className="w-3 h-3 rounded-full shrink-0" style={{ background: tone(v.status) }} />
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium truncate">{shownName(v.med)}</span>
                      <span className="block text-[13px] text-muted leading-snug">{v.headline}{v.confidence ? ` · ${v.confidence}` : ''}</span>
                    </span>
                    <ChevronRight size={18} aria-hidden="true" className="text-muted shrink-0" />
                  </a>
                </li>
              ))}
            </ul>
            {early.length > 0 && (
              <p className="pt-3 mt-1 border-t border-border text-[14px] text-muted leading-snug">
                <span className="font-medium text-text">{early.length} too new to judge:</span> {early.map((v) => shownName(v.med)).join(', ')}.
                {(() => { const dates = early.map((v) => /Clearer from (.+)\./.exec(v.next ?? '')?.[1]).filter(Boolean); return dates.length ? ` The first is clearer from ${dates.sort((a, b) => Date.parse(a!) - Date.parse(b!))[0]}.` : ''; })()}
              </p>
            )}
          </section>
        );
      })()}

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
