// Health tab cards for the cross-checks a watch app can't do alone: each reading against your own usual, sleep
// apnoea check, blood pressure with the weight loss, fitness age, why resting heart rate moved, and the body clock.
import { useState } from 'react';
import { format } from 'date-fns';
import { Activity, Clock, Gauge, HeartPulse, Moon, UserRound, Wind } from 'lucide-react';
import { setAbout } from '../db/repos/training';
import { addCheckIn } from '../db/repos/checkIns';
import { setSetting } from '../db/repos/settings';
import { upsertBody } from '../db/repos/body';
import { useToast } from '../app/toast';
import type { ApnoeaCheck, Band, BodyClock, BpWeight, FitnessAge, RhrExplained } from '../logic/healthChecks';
import { Button } from './ui/Button';
import { Segmented, TextInput } from './ui/Field';
import { BandChart, MiniRing } from './ui/Visual';

const H = ({ id, Icon, children }: { id: string; Icon: typeof Activity; children: React.ReactNode }) =>
  <h2 id={id} className="text-sm font-medium text-muted flex items-center gap-1.5"><Icon size={15} aria-hidden="true" />{children}</h2>;

/** Height, year of birth and sex, asked for once, inline, by the checks that need them. */
export function AboutYou({ personId, need }: { personId: string; need: ('height' | 'birthYear' | 'sex')[] }) {
  const toast = useToast();
  const [h, setH] = useState(''); const [y, setY] = useState(''); const [sex, setSex] = useState<'m' | 'f' | ''>('');
  if (!need.length) return null;
  const ok = (need.includes('height') && Number(h) > 100) || (need.includes('birthYear') && Number(y) > 1900) || !!sex;
  return (
    <div className="rounded-btn bg-surface-2 p-3 space-y-2">
      <p className="text-[13px] flex items-center gap-1.5"><UserRound size={14} aria-hidden="true" />Sharpens this: kept on this phone only.</p>
      <div className="grid grid-cols-2 gap-2">
        {need.includes('height') && <TextInput label="Height (cm)" type="number" inputMode="numeric" value={h} onChange={(e) => setH(e.target.value)} />}
        {need.includes('birthYear') && <TextInput label="Year of birth" type="number" inputMode="numeric" value={y} onChange={(e) => setY(e.target.value)} />}
      </div>
      {need.includes('sex') && <Segmented label="Sex at birth" value={sex || 'x'} onChange={(v) => setSex(v === 'x' ? '' : v as 'm' | 'f')} options={[{ value: 'm', label: 'Male' }, { value: 'f', label: 'Female' }, { value: 'x', label: 'Skip' }]} />}
      <Button variant="secondary" disabled={!ok} onClick={async () => {
        await setAbout(personId, { ...(Number(h) > 100 ? { heightCm: Number(h) } : {}), ...(Number(y) > 1900 ? { birthYear: Number(y) } : {}), ...(sex ? { sex } : {}) });
        toast('Saved');
      }}>Save</Button>
    </div>
  );
}

/** Each reading's latest against the person's own range, as a marker on a band. */
export function UsualBandsCard({ bands }: { bands: Band[] }) {
  if (!bands.length) return null;
  const off = bands.filter((b) => b.state !== 'usual');
  return (
    <section className="box space-y-2" aria-labelledby="usual-h">
      <H id="usual-h" Icon={Gauge}>Against your usual{off.length ? ` · ${off.length} outside` : ' · all in range'}</H>
      <ul className="space-y-2.5">
        {bands.map((b) => {
          const span = (b.hi - b.lo) * 2 || 1, min = b.lo - (b.hi - b.lo) / 2;
          const pos = Math.max(0, Math.min(100, ((b.value - min) / span) * 100));
          const bad = b.state !== 'usual' && (b.higherBetter === undefined || (b.higherBetter ? b.state === 'low' : b.state === 'high'));
          const fmt = (v: number) => `${v.toLocaleString('en-AU', { maximumFractionDigits: b.dp })}${b.unit && b.unit !== '/min' ? (b.unit === '%' || b.unit === '°C' ? '' : ' ') + b.unit : b.unit}`;
          return (
            <li key={b.key}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[14px] min-w-0 truncate">{b.label}</span>
                <span className={`text-[14px] tnum font-semibold shrink-0 ${bad ? 'text-caution' : ''}`}>{b.key === 'skinTempDelta' && b.value > 0 ? '+' : ''}{fmt(b.value)}<span className="text-muted font-normal text-[12px]"> · usual {b.usual.toLocaleString('en-AU', { maximumFractionDigits: b.dp })}</span></span>
              </div>
              {b.recent.length >= 7
                ? <BandChart points={b.recent} lo={b.lo} hi={b.hi} fmt={fmt} label={b.label} bad={bad} />
                : (<div className="relative h-2 mt-1 rounded-full bg-surface-2" role="img" aria-label={`${b.label} ${fmt(b.value)}, your usual range ${fmt(b.lo)} to ${fmt(b.hi)}${b.state !== 'usual' ? `: ${b.state}` : ''}`}>
                <div className="absolute inset-y-0 rounded-full bg-border-strong" style={{ left: '25%', width: '50%' }} />
                <div className={`absolute -top-1 w-1.5 h-4 rounded-full ${bad ? 'bg-caution' : 'bg-text'}`} style={{ left: `calc(${pos}% - 3px)` }} />
              </div>)}
            </li>
          );
        })}
      </ul>
      <p className="text-[12px] text-muted">Last 8 weeks. Grey band: your usual from the 4 weeks before. Line: 7-day average. Dot: the latest. Touch a chart to read a day.</p>
    </section>
  );
}

export function ApnoeaCard({ a, personId, need }: { a: ApnoeaCheck; personId: string; need: ('height' | 'birthYear' | 'sex')[] }) {
  const text = a.level === 'high' ? 'Worth raising with your GP' : a.level === 'some' ? 'Some signs: worth mentioning to your GP' : 'Few signs so far';
  return (
    <section className="box space-y-2" aria-labelledby="osa-h">
      <H id="osa-h" Icon={Wind}>Sleep apnoea check</H>
      <div className="flex items-center gap-3">
        <MiniRing value={a.score} max={8} size={56} tone={a.level === 'low' ? 'good' : 'watch'} label={`${a.score} of 8 risk factors`}><span className="text-[15px] font-bold tnum">{a.score}/8</span></MiniRing>
        <p className="text-[17px] font-semibold flex-1">{text}</p>
      </div>
      {(a.items.length > 0 || a.nightSigns.length > 0) && <ul className="text-[14px] space-y-0.5">{[...a.nightSigns, ...a.items].map((x) => <li key={x}>• {x}</li>)}</ul>}
      {a.level !== 'low' && <p className="text-[13px] text-muted">Pauses in breathing at night are common at a higher weight, often missed, and treatable. A home sleep study settles it, and treating it helps energy, appetite and weight loss.</p>}
      {a.unknown.length > 0 && <p className="text-[12px] text-muted">Not known yet: {a.unknown.join(', ')}.</p>}
      <FinishApnoea personId={personId} snoring={a.unknown.includes('snoring')} neck={a.unknown.includes('neck measurement')} />
      <AboutYou personId={personId} need={need} />
    </section>
  );
}

export function BpWeightCard({ b }: { b: BpWeight }) {
  return (
    <section className="box space-y-2" aria-labelledby="bpw-h">
      <H id="bpw-h" Icon={HeartPulse}>Blood pressure and your weight</H>
      <p className="text-[24px] font-bold tnum">{b.sysNow}/{b.diaNow} <span className="text-[13px] font-normal text-muted">lately{b.sysThen !== undefined ? `, from about ${b.sysThen} at the start` : ''}</span></p>
      {b.perKg !== undefined && <p className="text-[15px]">In your readings, each kg lost goes with about <strong>{b.perKg} mmHg</strong> lower on top{b.kgLost ? ` (${b.kgLost} kg so far)` : ''}.</p>}
      {b.reviewBy && <p className="text-[15px] rounded-btn bg-surface-2 p-3">Falling steadily: at this rate your readings reach about 110 around <strong>{format(b.reviewBy, 'd MMM')}</strong>. Worth booking a review of your blood pressure tablets with your prescriber before then.</p>}
      {b.lowOnTablets && (
        <p className="text-[15px] rounded-btn bg-caution-soft p-3">Worth mentioning to your prescriber: {b.lowOnTablets.join(', ')}, while on blood pressure tablets. Weight loss and GLP-1 medicines often lower blood pressure; any change to the tablets is theirs to make.</p>
      )}
    </section>
  );
}

export function FitnessAgeCard({ f, personId, need }: { f: FitnessAge; personId: string; need: ('height' | 'birthYear' | 'sex')[] }) {
  return (
    <section className="box space-y-2" aria-labelledby="fa-h">
      <H id="fa-h" Icon={Activity}>Fitness age</H>
      <div className="flex items-end gap-6">
        {f.fitnessAge !== undefined && <div><p className="text-[34px] leading-none font-bold tnum">{f.fitnessAge}</p><p className="text-[12px] text-muted mt-1">fitness age{f.age !== undefined ? ` (you're ${f.age})` : ''}</p></div>}
        <div><p className="text-[22px] leading-none font-semibold tnum">{f.vo2}</p><p className="text-[12px] text-muted mt-1">VO2 max{f.band ? `, ${f.band} for your age` : ''}</p></div>
      </div>
      {f.atGoal && <p className="text-[15px]">At {f.atGoal.kg} kg, with the same heart and lungs: VO2 max about <strong>{f.atGoal.vo2}</strong>{f.atGoal.fitnessAge !== undefined ? <>, a fitness age of <strong>{f.atGoal.fitnessAge}</strong></> : ''}. Training on top of that raises it further.</p>}
      <p className="text-[12px] text-muted">VO2 max is per kg of body weight, so losing weight raises it on its own. Against population averages by age.</p>
      <AboutYou personId={personId} need={need} />
    </section>
  );
}

export function RhrCard({ r }: { r: RhrExplained }) {
  const max = Math.max(1, ...r.parts.map((p) => Math.abs(p.bpm)), Math.abs(r.other));
  const rows = [...r.parts, ...(Math.abs(r.other) >= 0.5 ? [{ what: 'Other (sleep, stress, illness, heat)', bpm: r.other }] : [])];
  const s = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}`;
  return (
    <section className="box space-y-2" aria-labelledby="rhr-h">
      <H id="rhr-h" Icon={HeartPulse}>Why your resting heart rate moved</H>
      <p className="text-[15px] tnum"><strong className="text-[22px]">{r.now} bpm</strong> lately, from {r.then} two to three months ago ({s(r.change)})</p>
      <ul className="space-y-1.5">
        {rows.map((p) => (
          <li key={p.what} className="grid grid-cols-[1fr_auto] gap-2 items-center">
            <span className="text-[14px]">{p.what}</span><span className="text-[14px] tnum font-semibold">{s(p.bpm)} bpm</span>
            <div className="col-span-2 h-1.5 rounded-full bg-surface-2 relative" aria-hidden="true">
              <div className="absolute top-0 h-1.5 rounded-full" style={{ left: p.bpm < 0 ? `${50 - (Math.abs(p.bpm) / max) * 50}%` : '50%', width: `${(Math.abs(p.bpm) / max) * 50}%`, background: p.bpm > 0 ? 'var(--caution)' : 'var(--success)' }} />
            </div>
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-muted">From your own days: how heart rate moves with your weight, medicine dose and training. A GLP-1 or GIP medicine often adds a few beats; that's expected, not a sign of poor recovery.</p>
    </section>
  );
}

export function BodyClockCard({ c }: { c: BodyClock }) {
  return (
    <section className="box space-y-2" aria-labelledby="clock-h">
      <H id="clock-h" Icon={Clock}>Body clock</H>
      <div className="flex items-center gap-4">
        <MiniRing value={c.score} max={100} size={64} tone={c.score >= 70 ? 'good' : 'watch'} label={`Body clock ${c.score} of 100`}><span className="text-[18px] font-bold tnum">{c.score}</span></MiniRing>
        <div className="text-[14px] tnum space-y-0.5">
          <p>Middle of sleep: <strong>{c.midWork}</strong> work nights, <strong>{c.midFree}</strong> weekends</p>
          <p>{c.jetLagH >= 1 ? `${c.jetLagH} h of weekend jet lag` : 'Weekends close to weekdays'} · shifts {c.driftMin} min night to night</p>
        </div>
      </div>
      {c.effects.length > 0 && (
        <ul className="text-[14px] space-y-0.5">
          {c.effects.map((e) => <li key={e.what}><Moon size={13} className="inline -mt-0.5 mr-1" aria-hidden="true" />After an off-timing night: {e.what.toLowerCase()} {e.what.startsWith('Days') ? `${e.off}% against ${e.on}%` : `${e.off} against ${e.on}`}</li>)}
        </ul>
      )}
      <p className="text-[12px] text-muted">A steady sleep time keeps appetite hormones and focus steadier. Links in your own days, not proof.</p>
    </section>
  );
}

export const fmtMonth = (t: number) => format(t, 'MMM yyyy');

/** The two things the check can't learn by itself, asked once: snoring (a partner's word counts) and neck size. */
function FinishApnoea({ personId, snoring, neck }: { personId: string; snoring: boolean; neck: boolean }) {
  const toast = useToast();
  const [cm, setCm] = useState('');
  if (!snoring && !neck) return null;
  return (
    <div className="rounded-btn bg-surface-2 p-3 space-y-3">
      <p className="text-[15px] font-semibold">Finish the check</p>
      {snoring && (
        <div className="space-y-1.5">
          <p className="text-[14px]">Do you snore, or has someone said you do?</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={async () => { await addCheckIn({ at: new Date().toISOString(), chips: ['Snoring'], personId }); toast('Noted: snoring'); }}>Yes</Button>
            <Button variant="secondary" onClick={async () => { await setSetting('noSnoring', true); toast('Noted: no snoring'); }}>No</Button>
          </div>
        </div>
      )}
      {neck && (
        <div className="flex items-end gap-2">
          <TextInput label="Neck, around the middle (cm)" type="number" inputMode="decimal" value={cm} onChange={(e) => setCm(e.target.value)} />
          <Button onClick={async () => { const v = Number(cm); if (!(v > 20 && v < 80)) return; await upsertBody(format(Date.now(), 'yyyy-MM-dd'), { neckCm: v }, personId); setCm(''); toast(`Neck ${v} cm saved`); }} disabled={!(Number(cm) > 20 && Number(cm) < 80)}>Save</Button>
        </div>
      )}
    </div>
  );
}
