// The Sleep tab (Settings → Sleep): last night with its score and stages, tonight's bedtime, sleep debt and how steady
// your times are, the last 30 nights, and what goes with better or worse sleep in your own records. Built from the
// watch's nights (Health Connect), with doses, caffeine, alcohol and workouts from the app.
import { useState } from 'react';
import { BedDouble, ChevronDown, Moon, Sunrise, TrendingDown, TrendingUp } from 'lucide-react';
import { useCheckIns, useDaily, useDoses, useFamily, useMeds, useScheduleSettings, useWorkouts } from '../app/data';
import { useNow } from '../app/useNow';
import { useToast } from '../app/toast';
import { personOf, medIsFor } from '../db/repos/people';
import { setSetting } from '../db/repos/settings';
import { go } from '../app/router';
import { bedtimeTonight, consistency, fmtClock, fmtHM, nightsOf, sleepDebt, sleepFactors, sleepScore, usualNight, type Night, type SleepFactor } from '../logic/sleep';
import { sleepImpact } from '../logic/habits';
import { isStimulant } from '../logic/stimulant';
import { bedtimeOf, intakesOf, level } from '../logic/caffeine';
import { zonedParts } from '../logic/tz';
import { MiniRing } from '../components/ui/Visual';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Field';

// Stages in a fixed order, from the app's validated chart colours; awake is no sleep at all, so it's the neutral grey.
const STAGES = [
  { key: 'deep', label: 'Deep', color: 'var(--med-1)' },
  { key: 'rem', label: 'REM', color: 'var(--med-2)' },
  { key: 'light', label: 'Light', color: 'var(--med-3)' },
  { key: 'awake', label: 'Awake', color: 'var(--border-strong)' },
] as const;
const hhmm = (min: number) => { const m = ((Math.round(min) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const dayLabel = (ymd: string) => new Date(`${ymd}T12:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });

export function Sleep() {
  const daily = useDaily(); const doses = useDoses(); const meds = useMeds(); const checkIns = useCheckIns(); const workouts = useWorkouts();
  const fam = useFamily(); const ss = useScheduleSettings(); const now = useNow(300_000); const toast = useToast();
  if (!daily || !doses || !meds || !checkIns || !workouts || !fam || !ss) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const [settings, s] = ss;
  const me = <T extends { personId?: string }>(x: T) => personOf(x) === fam.personId;
  const mine = { daily: daily.filter(me), checkIns: checkIns.filter(me), workouts: workouts.filter(me), meds: meds.filter((m) => medIsFor(m, fam.personId)), doses };
  const ns = nightsOf(mine.daily, now);
  const target = Math.round(settings.sleepTargetH * 60);

  if (!ns.length) return (
    <div className="space-y-4">
      <p className="leading-snug">Sleep comes from your watch: once Health Connect shares it, last night, your sleep score and what affects your sleep show here.</p>
      <Button variant="secondary" className="w-full min-h-[52px]" onClick={() => go('/settings/health')}>Health data settings</Button>
      <TargetPick value={settings.sleepTargetH} />
    </div>
  );

  const last = ns[ns.length - 1];
  const usual = usualNight(ns, s, last.date);
  const score = sleepScore(last, target, usual, s);
  const cons = consistency(ns, s);
  const debt = sleepDebt(ns, target, now);
  const factors = sleepFactors(ns, mine, target, s);

  // Tonight: bedtime for your target before your usual wake, and what could get in the way.
  const wake = cons?.usualWake ?? usual?.wake;
  const stim = mine.meds.filter((m) => isStimulant(m) && !m.peptide && !m.archived);
  const impact = sleepImpact(stim, doses, mine.checkIns, now, s, mine.daily);
  const today = zonedParts(now, s.tz);
  const todayKey = `${today.y}-${today.m}-${today.d}`;
  const lastToday = doses.filter((d) => !d.deletedAt && !d.skipped && stim.some((m) => m.id === d.medicationId)).map((d) => Date.parse(d.takenAt))
    .filter((t) => { const p = zonedParts(t, s.tz); return `${p.y}-${p.m}-${p.d}` === todayKey; }).sort((a, b) => b - a)[0];
  const lastHour = lastToday !== undefined ? zonedParts(lastToday, s.tz).h + zonedParts(lastToday, s.tz).mi / 60 : undefined;
  const coach = wake !== undefined ? bedtimeTonight({
    usualWake: wake, targetMin: target, debtMin: debt?.minutes,
    lateStimulant: impact && lastHour !== undefined && lastHour >= impact.cutoffHour ? `Today’s last stimulant dose was after ${fmtClock(impact.cutoffHour * 60)}, which goes with worse sleep for you.` : undefined,
  }) : null;
  if (coach) {
    const bedMs = bedtimeOf(now, hhmm(coach.bedtime), s);
    const mg = level(intakesOf(mine.checkIns), bedMs, settings.caffeineHalfLifeH);
    if (mg >= 50) coach.notes.push(`About ${Math.round(mg)} mg of caffeine will still be in your system at ${fmtClock(coach.bedtime)}.`);
  }

  return (
    <div className="space-y-3 pb-8">
      <LastNight n={last} score={score} usual={usual} s={s} />

      {coach && (
        <section aria-labelledby="tonight-h" className="box space-y-3">
          <h2 id="tonight-h" className="text-sm font-medium text-muted flex items-center gap-1.5"><Moon size={16} aria-hidden="true" />Tonight</h2>
          <dl className="grid grid-cols-3 gap-2 tnum">
            <div className="rounded-card bg-surface-2 p-3"><dt className="text-[12px] text-muted">Wind down</dt><dd className="text-[20px] font-semibold">{fmtClock(coach.windDown)}</dd></div>
            <div className="rounded-card bg-surface-2 p-3"><dt className="text-[12px] text-muted">In bed by</dt><dd className="text-[20px] font-semibold">{fmtClock(coach.bedtime)}</dd></div>
            <div className="rounded-card bg-surface-2 p-3"><dt className="text-[12px] text-muted">Usual wake</dt><dd className="text-[20px] font-semibold">{fmtClock(coach.wake)}</dd></div>
          </dl>
          {coach.notes.length > 0 && <ul className="space-y-1.5">{coach.notes.map((t) => <li key={t} className="leading-snug flex gap-2.5"><span aria-hidden="true" className="mt-[0.55em] w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--caution)' }} />{t}</li>)}</ul>}
          <p className="text-sm text-muted">For {fmtHM(target)} asleep before your usual wake, with 15 minutes to fall asleep.</p>
          {settings.bedtime !== hhmm(coach.bedtime) && (
            <Button variant="secondary" className="w-full min-h-[48px]" onClick={async () => { const was = settings.bedtime; await setSetting('bedtime', hhmm(coach.bedtime)); toast(`Bedtime set to ${fmtClock(coach.bedtime)}`, { onAction: () => setSetting('bedtime', was) }); }}>
              Use {fmtClock(coach.bedtime)} as my bedtime
            </Button>
          )}
        </section>
      )}

      {(debt || cons) && (
        <section aria-labelledby="debt-h" className="box space-y-3">
          <h2 id="debt-h" className="text-sm font-medium text-muted">This week</h2>
          <dl className="grid grid-cols-2 gap-2 tnum">
            {debt && (
              <div className="rounded-card bg-surface-2 p-3">
                <dt className="text-[12px] text-muted">Sleep debt, 7 nights</dt>
                <dd className="text-[20px] font-semibold">{debt.minutes > 15 ? fmtHM(debt.minutes) : 'None'}</dd>
                <dd className="text-[12px] text-muted">{debt.minutes > 15 ? `behind ${fmtHM(target)} a night` : debt.minutes < -15 ? `${fmtHM(-debt.minutes)} ahead` : 'on target'}</dd>
              </div>
            )}
            {cons && (
              <div className="rounded-card bg-surface-2 p-3">
                <dt className="text-[12px] text-muted">Bed and wake times</dt>
                <dd className="text-[20px] font-semibold">{cons.word}</dd>
                <dd className="text-[12px] text-muted">± {cons.bedSd} min to sleep, ± {cons.wakeSd} min waking</dd>
              </div>
            )}
          </dl>
          {cons && <TimesChart c={cons} />}
          {cons?.socialJetLag !== undefined && Math.abs(cons.socialJetLag) >= 45 && (
            <p className="leading-snug">Weekends shift your sleep {fmtHM(cons.socialJetLag)} {cons.socialJetLag > 0 ? 'later' : 'earlier'}, like a small time-zone change each week. Keeping weekend times within an hour of weekdays usually helps Monday.</p>
          )}
        </section>
      )}

      <NightsChart ns={ns.slice(-30)} target={target} />

      <section aria-labelledby="factors-h" className="box space-y-3">
        <h2 id="factors-h" className="text-sm font-medium text-muted">What affects your sleep</h2>
        {factors.length ? <ul className="space-y-3">{factors.map((f) => <FactorRow key={f.key} f={f} />)}</ul>
          : <p className="text-muted leading-snug">Nothing stands out yet. Each pattern needs 4+ nights with and without it: dose times, caffeine, alcohol, sleep peptides, workouts and active days are all checked.</p>}
        <p className="text-[12px] text-muted">The day before each night, with against without. Patterns, not proof: an experiment (on and off in a random order) settles one.</p>
      </section>

      <TargetPick value={settings.sleepTargetH} />
    </div>
  );
}

function LastNight({ n, score, usual, s }: { n: Night; score: ReturnType<typeof sleepScore>; usual: ReturnType<typeof usualNight>; s: Parameters<typeof sleepScore>[3] }) {
  const [why, setWhy] = useState(false);
  const vs = (v: number | undefined, u: number | undefined, unit: string, higherBetter = true) => {
    if (v === undefined || u === undefined) return null;
    const d = Math.round(v - u);
    if (Math.abs(d) < (unit === 'min' ? 10 : 2)) return <span className="text-muted">usual</span>;
    const good = higherBetter ? d > 0 : d < 0;
    return <span className={good ? 'text-success' : 'text-caution'}>{d > 0 ? '+' : '−'}{Math.abs(d)} {unit}</span>;
  };
  const tz = s.tz;
  const t = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: tz }) : undefined);
  const stageMin: Record<string, number | undefined> = { deep: n.deep, rem: n.rem, light: n.light, awake: n.awake };
  const total = STAGES.reduce((a, st) => a + (stageMin[st.key] ?? 0), 0);
  return (
    <>
    <section aria-labelledby="last-h" className="hero sleep">
      <h2 id="last-h" className="hero-label">Last night · {dayLabel(n.date)}</h2>
      <div className="mt-3 flex items-center gap-4">
        <MiniRing value={score.score} max={100} size={92} label={`Sleep score ${score.score} of 100: ${score.word}`}>
          <span className="text-[30px] font-bold tnum">{score.score}</span>
        </MiniRing>
        <div className="flex-1 min-w-0">
          <p className="text-[40px] leading-[44px] font-bold tracking-[-0.02em] tnum">{fmtHM(n.asleep)}</p>
          <p className="text-muted text-[15px]">{score.word}{n.start && n.end ? ` · ${t(n.start)} to ${t(n.end)}` : ''}</p>
        </div>
      </div>
    </section>
    <section aria-label="Last night in detail" className="box space-y-4">
      {total > 0 && (
        <div className="space-y-2">
          <div role="img" aria-label={STAGES.filter((st) => stageMin[st.key]).map((st) => `${st.label} ${Math.round(stageMin[st.key]!)} min`).join(', ')} className="flex h-4 gap-[2px] rounded-full overflow-hidden">
            {STAGES.filter((st) => stageMin[st.key]).map((st) => <div key={st.key} style={{ width: `${(stageMin[st.key]! / total) * 100}%`, background: st.color }} />)}
          </div>
          <dl className="grid grid-cols-4 gap-1 text-sm tnum">
            {STAGES.map((st) => (
              <div key={st.key}>
                <dt className="flex items-center gap-1.5 text-muted"><span aria-hidden="true" className="w-2.5 h-2.5 rounded-full" style={{ background: st.color }} />{st.label}</dt>
                <dd className="font-medium">{stageMin[st.key] !== undefined ? fmtHM(stageMin[st.key]!) : '–'}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {usual && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm tnum">
          <div className="flex justify-between"><dt className="text-muted">Asleep</dt><dd>{vs(n.asleep, usual.asleep, 'min')}</dd></div>
          {n.deep !== undefined && <div className="flex justify-between"><dt className="text-muted">Deep</dt><dd>{vs(n.deep, usual.deep, 'min')}</dd></div>}
          {n.hrv !== undefined && <div className="flex justify-between"><dt className="text-muted">HRV</dt><dd>{vs(n.hrv, usual.hrv, 'ms')}</dd></div>}
          {n.rhr !== undefined && <div className="flex justify-between"><dt className="text-muted">Resting HR</dt><dd>{vs(n.rhr, usual.rhr, 'bpm', false)}</dd></div>}
        </dl>
      )}
      <button type="button" aria-expanded={why} onClick={() => setWhy((x) => !x)} className="min-h-[44px] flex items-center gap-1.5 text-sm font-medium">
        How the score is made <ChevronDown size={16} aria-hidden="true" className={`transition-transform ${why ? 'rotate-180' : ''}`} />
      </button>
      {why && (
        <ul className="space-y-2">
          {score.parts.map((p) => (
            <li key={p.key} className="space-y-1">
              <p className="flex justify-between text-sm"><span className="font-medium">{p.label}</span><span className="tnum">{Math.round(p.points)} of {p.max}</span></p>
              <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(p.points / p.max) * 100}%`, background: 'var(--primary)' }} /></div>
              <p className="text-[12px] text-muted">{p.note}</p>
            </li>
          ))}
          <li className="text-[12px] text-muted">Parts without data last night are left out and the rest scaled to 100. Your usual is the median of the 30 nights before.</li>
        </ul>
      )}
    </section>
    </>
  );
}

/** 14 nights: a bar from falling asleep to waking, against 8 pm to noon. */
function TimesChart({ c }: { c: NonNullable<ReturnType<typeof consistency>> }) {
  const W = 320, rowH = 14, from = 8 * 60, to = 24 * 60; // minutes from noon: 8 pm to noon
  const x = (m: number) => ((Math.min(to, Math.max(from, m)) - from) / (to - from)) * W;
  const ticks = [{ m: 10 * 60, l: '10 pm' }, { m: 12 * 60, l: '12 am' }, { m: 14 * 60, l: '2 am' }, { m: 18 * 60, l: '6 am' }, { m: 20 * 60, l: '8 am' }, { m: 22 * 60, l: '10 am' }];
  const H = c.nights.length * rowH + 18;
  return (
    <figure className="space-y-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Asleep to awake, last ${c.nights.length} nights: usually ${fmtClock(c.usualBed - 720)} to ${fmtClock(c.usualWake)}`}>
        <line x1={x(c.usualBed)} x2={x(c.usualBed)} y1={0} y2={H - 18} stroke="var(--border-strong)" strokeDasharray="3 3" />
        <line x1={x(c.usualWake + 720)} x2={x(c.usualWake + 720)} y1={0} y2={H - 18} stroke="var(--border-strong)" strokeDasharray="3 3" />
        {c.nights.map((r, i) => (
          <rect key={r.date} x={x(r.bed)} y={i * rowH + 3} width={Math.max(2, x(r.wake + 720) - x(r.bed))} height={rowH - 6} rx={4} fill="var(--med-1)">
            <title>{dayLabel(r.date)}: {fmtClock(r.bed - 720)} to {fmtClock(r.wake)}</title>
          </rect>
        ))}
        {ticks.map((t) => <text key={t.m} x={x(t.m)} y={H - 4} textAnchor="middle" fontSize="10" fill="var(--text-muted)">{t.l}</text>)}
      </svg>
      <figcaption className="text-[12px] text-muted flex items-center gap-3"><span className="flex items-center gap-1"><BedDouble size={12} aria-hidden="true" />usual sleep {fmtClock(c.usualBed - 720)}</span><span className="flex items-center gap-1"><Sunrise size={12} aria-hidden="true" />usual wake {fmtClock(c.usualWake)}</span></figcaption>
    </figure>
  );
}

/** The last 30 nights: stages stacked, against your target. */
function NightsChart({ ns, target }: { ns: Night[]; target: number }) {
  const [table, setTable] = useState(false);
  if (ns.length < 3) return null;
  const W = 320, H = 150, pad = 18;
  const max = Math.max(target + 60, ...ns.map((n) => n.asleep + (n.awake ?? 0)));
  const bw = W / ns.length;
  const y = (m: number) => H - pad - (m / max) * (H - pad - 6);
  const avg = Math.round(ns.reduce((a, n) => a + n.asleep, 0) / ns.length);
  return (
    <section aria-labelledby="nights-h" className="box space-y-2">
      <h2 id="nights-h" className="text-sm font-medium text-muted">Last {ns.length} nights</h2>
      <p className="tnum"><span className="text-[22px] font-semibold">{fmtHM(avg)}</span> <span className="text-muted">a night on average · target {fmtHM(target)}</span></p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Sleep stages for the last ${ns.length} nights, average ${fmtHM(avg)}`}>
        <line x1={0} x2={W} y1={y(target)} y2={y(target)} stroke="var(--text-muted)" strokeDasharray="4 3" />
        <text x={W} y={y(target) - 3} textAnchor="end" fontSize="10" fill="var(--text-muted)">target</text>
        {ns.map((n, i) => {
          let acc = 0;
          const segs = n.deep !== undefined && n.rem !== undefined && n.light !== undefined
            ? [{ v: n.deep, c: 'var(--med-1)' }, { v: n.rem, c: 'var(--med-2)' }, { v: n.light, c: 'var(--med-3)' }, { v: n.awake ?? 0, c: 'var(--border-strong)' }]
            : [{ v: n.asleep, c: 'var(--med-1)' }];
          return (
            <g key={n.date}>
              <title>{dayLabel(n.date)}: {fmtHM(n.asleep)} asleep</title>
              {segs.map((sg, k) => { const y0 = y(acc), y1 = y(acc + sg.v); acc += sg.v; return sg.v > 0 ? <rect key={k} x={i * bw + 1.5} y={y1 + (k ? 1 : 0)} width={Math.max(1, bw - 3)} height={Math.max(0, y0 - y1 - (k ? 1 : 0))} rx={k === segs.length - 1 ? 2 : 0} fill={sg.c} /> : null; })}
            </g>
          );
        })}
        <text x={0} y={H - 4} fontSize="10" fill="var(--text-muted)">{dayLabel(ns[0].date)}</text>
        <text x={W} y={H - 4} fontSize="10" textAnchor="end" fill="var(--text-muted)">{dayLabel(ns[ns.length - 1].date)}</text>
      </svg>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">{STAGES.map((st) => <span key={st.key} className="flex items-center gap-1"><span aria-hidden="true" className="w-2.5 h-2.5 rounded-full" style={{ background: st.color }} />{st.label}</span>)}</div>
      <button type="button" aria-expanded={table} onClick={() => setTable((x) => !x)} className="min-h-[44px] text-sm font-medium underline underline-offset-4">{table ? 'Hide the table' : 'Show as a table'}</button>
      {table && (
        <table className="w-full text-sm tnum">
          <caption className="sr-only">Nights</caption>
          <thead><tr className="text-muted"><th scope="col" className="text-left font-normal py-1">Night</th><th scope="col" className="text-right font-normal">Asleep</th><th scope="col" className="text-right font-normal">Deep</th><th scope="col" className="text-right font-normal">REM</th><th scope="col" className="text-right font-normal">Awake</th></tr></thead>
          <tbody>{[...ns].reverse().map((n) => <tr key={n.date} className="border-t border-border"><th scope="row" className="text-left font-normal py-1.5">{dayLabel(n.date)}</th><td className="text-right">{fmtHM(n.asleep)}</td><td className="text-right">{n.deep !== undefined ? Math.round(n.deep) : '–'}</td><td className="text-right">{n.rem !== undefined ? Math.round(n.rem) : '–'}</td><td className="text-right">{n.awake !== undefined ? Math.round(n.awake) : '–'}</td></tr>)}</tbody>
        </table>
      )}
    </section>
  );
}

function FactorRow({ f }: { f: SleepFactor }) {
  const better = f.scoreDiff > 0 || (f.scoreDiff === 0 && f.asleepDiff > 0);
  const Icon = better ? TrendingUp : TrendingDown;
  const bits = [
    f.scoreDiff ? `${f.scoreDiff > 0 ? '+' : '−'}${Math.abs(f.scoreDiff)} points` : null,
    Math.abs(f.asleepDiff) >= 5 ? `${f.asleepDiff > 0 ? '+' : '−'}${Math.abs(f.asleepDiff)} min asleep` : null,
    f.deepDiff !== undefined && Math.abs(f.deepDiff) >= 5 ? `${f.deepDiff > 0 ? '+' : '−'}${Math.abs(f.deepDiff)} min deep` : null,
  ].filter(Boolean);
  return (
    <li className="flex gap-3">
      <Icon size={20} aria-hidden="true" className="shrink-0 mt-0.5" style={{ color: better ? 'var(--success)' : 'var(--caution)' }} />
      <div className="flex-1 min-w-0">
        <p className="font-medium">{f.label}</p>
        <p className="text-sm tnum">{better ? 'Better sleep' : 'Worse sleep'}: {bits.join(', ')}</p>
        <p className="text-[12px] text-muted">{f.certainty} · {f.on} nights with, {f.off} without</p>
      </div>
    </li>
  );
}

function TargetPick({ value }: { value: number }) {
  return (
    <Select label="Sleep target" value={String(value)} onChange={(e) => setSetting('sleepTargetH', Number(e.target.value))}>
      {[6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5].map((h) => <option key={h} value={h}>{fmtHM(h * 60)} a night</option>)}
    </Select>
  );
}
