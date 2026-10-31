// Brain tests (biohacking tools): a 2-minute test (reaction time, then a 2-back working-memory round) or a 30-second
// reaction test, saved as a check-in tied to the last stimulant dose. Below: recent scores, focus by the hour (focus
// ratings and test scores), and the evening rebound.
import { useEffect, useRef, useState } from 'react';
import { Brain as BrainIcon, Timer, Zap } from 'lucide-react';
import { addCheckIn } from '../db/repos/checkIns';
import { personOf, storedPerson } from '../db/repos/people';
import { useCheckIns, useDoses, useFamily, useMeds, useScheduleSettings } from '../app/data';
import { useNow } from '../app/useNow';
import { useToast } from '../app/toast';
import { brainScore, brainTests, focusByHour, nBackSequence, rebound, scoreNBack, scoreReaction } from '../logic/biohack';
import { isStimulant } from '../logic/stimulant';
import { Button } from '../components/ui/Button';
import { Sparkline } from '../components/ui/Visual';

type Phase = { kind: 'idle' } | { kind: 'reaction'; full: boolean } | { kind: 'nback'; rt: NonNullable<ReturnType<typeof scoreReaction>> } | { kind: 'done'; score: number; rtMs: number; lapses: number; nback?: number };

const clock = (h: number) => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`;

export function Brain() {
  const meds = useMeds(); const doses = useDoses(); const checkIns = useCheckIns(); const fam = useFamily(); const ss = useScheduleSettings();
  const now = useNow(60_000);
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  if (!meds || !doses || !checkIns || !fam || !ss) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const s = ss[1];
  const mine = checkIns.filter((c) => personOf(c) === fam.personId);
  const tests = brainTests(mine);
  const prior = tests.slice(-30).map((c) => brainScore(c)!);
  const usual = prior.length >= 3 ? Math.round([...prior].sort((a, b) => a - b)[prior.length >> 1]) : undefined;
  const fb = focusByHour(mine, now, s);
  const rb = rebound(meds.filter((m) => !m.archived), doses, mine, now, s);

  const save = async (r: { rtMs: number; rtLapses: number; rtEarly: number }, nbackPct: number | undefined, full: boolean) => {
    const stimIds = new Set(meds.filter((m) => isStimulant(m)).map((m) => m.id));
    const last = doses.filter((d) => !d.deletedAt && !d.skipped && stimIds.has(d.medicationId) && Date.parse(d.takenAt) > Date.now() - 8 * 3_600_000).sort((a, b) => b.takenAt.localeCompare(a.takenAt))[0];
    await addCheckIn({ at: new Date().toISOString(), chips: [], ...r, ...(nbackPct !== undefined ? { nbackPct } : {}), test: full ? 'full' : 'quick', relatedDoseId: last?.id, personId: storedPerson(fam.personId) });
    const score = brainScore({ ...r, nbackPct })!;
    setPhase({ kind: 'done', score, rtMs: r.rtMs, lapses: r.rtLapses, nback: nbackPct });
    toast(`Brain test saved: ${score}`);
  };

  return (
    <div className="space-y-5 pb-8">
      {phase.kind === 'idle' && (
        <section className="space-y-3">
          <p className="text-muted leading-snug">A quick, objective read on focus. Take it at the same moments (before a dose, an hour or two after, in the evening) and the app learns how your doses and days change it.</p>
          <Button className="w-full min-h-[56px]" onClick={() => setPhase({ kind: 'reaction', full: true })}><BrainIcon size={20} aria-hidden="true" className="inline mr-2 -mt-0.5" />2-minute test</Button>
          <Button variant="secondary" className="w-full min-h-[52px]" onClick={() => setPhase({ kind: 'reaction', full: false })}><Zap size={18} aria-hidden="true" className="inline mr-2 -mt-0.5" />30-second reaction test</Button>
        </section>
      )}
      {phase.kind === 'reaction' && <Reaction trials={phase.full ? 10 : 8} onDone={(r) => { if (!r) { toast('Too many early taps: try again'); setPhase({ kind: 'idle' }); return; } if (phase.full) setPhase({ kind: 'nback', rt: r }); else void save(r, undefined, false); }} onCancel={() => setPhase({ kind: 'idle' })} />}
      {phase.kind === 'nback' && <NBack onDone={(pct) => void save(phase.rt, pct, true)} onCancel={() => setPhase({ kind: 'idle' })} />}
      {phase.kind === 'done' && (
        <section className="space-y-3 text-center" aria-live="polite">
          <p className="text-sm text-muted">Score</p>
          <p className="text-[56px] font-semibold leading-none tnum">{phase.score}</p>
          <p className="tnum">{phase.rtMs} ms reaction · {phase.lapses} slow{phase.nback !== undefined ? ` · ${phase.nback}% working memory` : ''}</p>
          {usual !== undefined && <p className="text-sm text-muted tnum">Your usual: {usual}</p>}
          <Button variant="secondary" className="min-h-[48px]" onClick={() => setPhase({ kind: 'idle' })}>Done</Button>
        </section>
      )}

      {tests.length >= 2 && phase.kind === 'idle' && (
        <section aria-labelledby="bt-h" className="border-t border-border pt-4 space-y-2">
          <h2 id="bt-h" className="text-sm font-medium text-muted">Your scores</h2>
          <p className="tnum"><span className="text-[28px] font-semibold">{brainScore(tests[tests.length - 1])}</span> <span className="text-muted">latest · {tests.length} tests{usual !== undefined ? ` · usual ${usual}` : ''}</span></p>
          <Sparkline points={tests.slice(-30).map((c) => ({ t: Date.parse(c.at), v: brainScore(c)! }))} label="Brain test scores, last 30" />
        </section>
      )}

      {fb && phase.kind === 'idle' && (
        <section aria-labelledby="fh-h" className="border-t border-border pt-4 space-y-2">
          <h2 id="fh-h" className="text-sm font-medium text-muted">Focus by the hour</h2>
          <p className="leading-snug">{fb.best ? `Your sharpest stretch is usually ${clock(fb.best.from)}–${clock(fb.best.to)}.` : 'No clear best time yet.'}</p>
          <div className="grid gap-[3px]" style={{ gridTemplateColumns: 'repeat(17, minmax(0, 1fr))' }} role="img"
            aria-label={`Focus by hour: ${fb.hours.filter((h) => h.score !== undefined).map((h) => `${clock(h.hour)} ${h.score! > 0 ? 'above' : 'below'} usual`).join(', ')}`}>
            {fb.hours.map((h) => {
              const v = h.score ?? 0;
              return <div key={h.hour} className="h-8 rounded-[3px]" style={{ background: h.score === undefined ? 'var(--fill)' : v > 0 ? 'var(--success)' : 'var(--caution)', opacity: h.score === undefined ? 1 : Math.min(1, 0.25 + Math.abs(v) * 0.6) }} />;
            })}
          </div>
          <div className="flex justify-between text-[11px] text-muted tnum"><span>6 am</span><span>noon</span><span>6 pm</span><span>10 pm</span></div>
          <p className="text-[12px] text-muted">Green: better than your usual. Amber: worse. From focus ratings and brain tests over 6 weeks.</p>
        </section>
      )}

      {rb && phase.kind === 'idle' && (
        <section aria-labelledby="rb-h" className="border-t border-border pt-4 space-y-1">
          <h2 id="rb-h" className="text-sm font-medium text-muted">Evening rebound</h2>
          <p className="leading-snug">{rb.dipPct >= 5 ? `A real evening dip: reaction ${rb.evening} ms in the evening against ${rb.day} ms 1–4 hours after a dose (${rb.dipPct}% slower).` : `No real evening dip: ${rb.evening} ms in the evening against ${rb.day} ms after a dose.`}</p>
          {rb.offEvening !== undefined && <p className="text-sm text-muted tnum">Evenings without a dose: {rb.offEvening} ms.</p>}
        </section>
      )}
      {phase.kind === 'idle' && <p className="text-[12px] text-muted flex items-center gap-1.5"><Timer size={14} aria-hidden="true" />The watch has a 30-second version too.</p>}
    </div>
  );
}

/** Tap when the circle turns green. Early taps restart that trial (and count); after the run, the median. */
function Reaction({ trials, onDone, onCancel }: { trials: number; onDone: (r: ReturnType<typeof scoreReaction>) => void; onCancel: () => void }) {
  const [state, setState] = useState<'wait' | 'go' | 'shown'>('wait');
  const [last, setLast] = useState<number | null>(null);
  const times = useRef<(number | 'early')[]>([]);
  const goAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const arm = () => { setState('wait'); timer.current = setTimeout(() => { goAt.current = performance.now(); setState('go'); }, 1500 + Math.random() * 2500); };
  useEffect(() => { arm(); return () => clearTimeout(timer.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const done = times.current.filter((t) => typeof t === 'number').length;
  const tap = () => {
    if (state === 'shown') return;
    if (state === 'wait') { clearTimeout(timer.current); times.current.push('early'); setLast(null); if (times.current.filter((t) => t === 'early').length > 5) { onDone(null); return; } arm(); return; }
    const ms = Math.round(performance.now() - goAt.current);
    times.current.push(ms); setLast(ms); setState('shown');
    if (times.current.filter((t) => typeof t === 'number').length >= trials) { setTimeout(() => onDone(scoreReaction(times.current)), 500); return; }
    setTimeout(arm, 600);
  };
  return (
    <section className="space-y-3">
      <p className="text-sm text-muted tnum">Reaction · {done} of {trials}</p>
      <button type="button" onPointerDown={tap} aria-label={state === 'go' ? 'Tap now' : 'Wait for green'}
        className="w-full aspect-square max-h-[60vh] rounded-card flex items-center justify-center text-[22px] font-semibold select-none touch-manipulation"
        style={{ background: state === 'go' ? 'var(--success)' : 'var(--fill)', color: state === 'go' ? '#fff' : 'var(--text)' }}>
        {state === 'go' ? 'Tap!' : state === 'shown' && last !== null ? `${last} ms` : 'Wait for green…'}
      </button>
      <p className="sr-only" aria-live="assertive">{state === 'go' ? 'Now' : ''}</p>
      <button type="button" className="min-h-[44px] text-sm text-muted underline underline-offset-4" onClick={onCancel}>Stop</button>
    </section>
  );
}

/** 2-back: tap Match when the letter is the same as the one two before. 20 letters, 2 seconds each. */
function NBack({ onDone, onCancel }: { onDone: (pct: number) => void; onCancel: () => void }) {
  const seq = useRef(nBackSequence(20));
  const tapped = useRef<boolean[]>([]);
  const [i, setI] = useState(-1);
  const [show, setShow] = useState(true);
  useEffect(() => {
    if (i >= seq.current.length) { onDone(scoreNBack(seq.current, tapped.current)); return; }
    const t1 = setTimeout(() => setShow(false), i < 0 ? 3000 : 1500);
    const t2 = setTimeout(() => { setShow(true); setI((x) => x + 1); }, i < 0 ? 3000 : 2000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="space-y-3">
      <p className="text-sm text-muted tnum">Working memory · {Math.max(0, i + 1)} of 20</p>
      {i < 0 ? <p className="leading-snug">Tap <strong>Match</strong> when a letter is the same as the one <strong>two before</strong> it. Ready…</p> : (
        <div className="aspect-[2/1] rounded-card bg-surface-2 flex items-center justify-center" aria-live="assertive">
          <span className="text-[72px] font-semibold tnum">{show && i < seq.current.length ? seq.current[i] : ''}</span>
        </div>
      )}
      <Button className="w-full min-h-[64px] text-lg" disabled={i < 2} onClick={() => { tapped.current[i] = true; }}>Match</Button>
      <button type="button" className="min-h-[44px] text-sm text-muted underline underline-offset-4" onClick={onCancel}>Stop</button>
    </section>
  );
}
