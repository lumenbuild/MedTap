// Biohacking tools on the app's screens (each shows only with the tools on): readiness and the day's plan on Today,
// tolerance, dose creep, breaks and the effect after one on a stimulant's page, muscle protection on Body, and gut,
// appetite and fluids around a weekly shot on Protocol.
import { useState } from 'react';
import { format } from 'date-fns';
import { Activity, AlertTriangle, Brain, Droplets, Plus, Trash2 } from 'lucide-react';
import type { Medication } from '../db/schema';
import { medIsFor, personOf } from '../db/repos/people';
import { setBreaks } from '../db/repos/meds';
import { useBodyEntries, useCheckIns, useDaily, useDoses, useExperiments, useFamily, useMeds, useScheduleSettings, useSettings, useWorkouts } from '../app/data';
import { useNow } from '../app/useNow';
import { useToast } from '../app/toast';
import { afterBreak, doseCreep, eveningTestDue, focusByHour, illnessWarning, mindReadiness, recoveryTimes, tolerance } from '../logic/biohack';
import { appetiteAhead, fluids, gutByShotDay, muscleScore } from '../logic/bodyhack';
import { dailyBrief } from '../logic/brief';
import { conditionOn } from '../logic/experiments';
import { isStimulant } from '../logic/stimulant';
import { isGlpLike } from '../logic/peptideGuide';
import { fmtHHmm } from '../logic/format';
import { HAS_PEPTIDES } from '../edition';
import { MiniRing } from './ui/Visual';
import { Sheet, SheetActions } from './ui/Sheet';
import { Button } from './ui/Button';
import { TextInput } from './ui/Field';

const useOn = () => { const st = useSettings(); return HAS_PEPTIDES && !!st?.biohackTools; };
const fmtL = (ml: number) => `${Math.round(ml / 100) / 10} L`;

/** Today: the daily brief (doses, shots, appetite, water), and with the biohacking tools readiness, the plan for the
 *  day, an illness warning, how long recovery usually takes, and an evening test. */
export function DailyBrief() {
  const on = useOn();
  const daily = useDaily(); const checkIns = useCheckIns(); const doses = useDoses(); const meds = useMeds(); const workouts = useWorkouts(); const fam = useFamily(); const ss = useScheduleSettings();
  const experiments = useExperiments();
  const now = useNow(300_000);
  const [more, setMore] = useState(false);
  if (!daily || !checkIns || !doses || !meds || !workouts || !fam || !ss || fam.everyone) return null;
  const [st, s] = ss;
  const me = <T extends { personId?: string }>(x: T) => personOf(x) === fam.personId;
  const mine = { daily: daily.filter(me), checkIns: checkIns.filter(me), doses, meds: meds.filter((m) => medIsFor(m, fam.personId)), workouts: workouts.filter(me) };
  const brief = dailyBrief({ ...mine, waterTarget: st.waterTargetMl, biohack: on }, now, s);
  // Self-experiments running today.
  for (const e of (experiments ?? []).filter((x) => !x.deletedAt && me(x))) {
    const c = on && !e.ended ? conditionOn(e, format(now, 'yyyy-MM-dd')) : null;
    if (c) brief.push({ key: `exp:${e.id}`, text: `Experiment “${e.title}”: today is ${c.arm === 'a' ? e.a : e.b}` });
  }
  const ill = on ? illnessWarning(mine.daily, now, s) : null;
  const best = on ? focusByHour(mine.checkIns, now, s)?.best : undefined;
  const r = on ? mindReadiness(mine, now, s, { illness: !!ill, bestHours: best, bedtime: fmtHHmm(st.bedtime) }) : null;
  const rec = on ? recoveryTimes(mine, now, s) : [];
  const evening = on && eveningTestDue(mine.meds, doses, mine.checkIns, now, s);
  if (!r && !ill && !evening && !brief.length) return null;
  return (
    <section aria-labelledby="ready-h" className="box space-y-3">
      <h2 id="ready-h" className="text-sm font-medium text-muted">Your day</h2>
      {brief.length > 0 && <ul className="space-y-1 leading-snug">{brief.map((b) => <li key={b.key} className="flex gap-2"><span aria-hidden="true" className="mt-[0.55em] w-1.5 h-1.5 rounded-full bg-text shrink-0" /><span>{b.text}</span></li>)}</ul>}
      {r && (
        <div className="flex items-start gap-3">
          <MiniRing value={r.score} max={100} size={52} tone={r.score >= 75 ? 'good' : r.score >= 55 ? 'primary' : 'watch'} label={`Readiness ${r.score} of 100`}>{r.score}</MiniRing>
          <div className="flex-1 min-w-0">
            <p className="font-semibold">Readiness: {r.label}</p>
            <ul className="text-sm leading-snug mt-0.5 space-y-0.5">{r.plan.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        </div>
      )}
      {ill && <p className="text-sm flex gap-2 rounded-btn bg-caution-soft p-2.5"><AlertTriangle size={16} aria-hidden="true" className="shrink-0 mt-0.5 text-caution" /><span>Resting heart rate {ill.rhr} bpm (usually {ill.baseRhr}){ill.hrv !== undefined ? `, HRV ${ill.hrv} ms (usually ${ill.baseHrv})` : ''} two days running: often a sign of getting sick.</span></p>}
      {evening && <a href="#/brain" className="flex items-center gap-2 text-sm font-medium min-h-[44px]"><Brain size={18} aria-hidden="true" className="text-primary" />Quick evening test: is there a dip as it wears off?</a>}
      {r && (
        <>
          <button type="button" aria-expanded={more} onClick={() => setMore((x) => !x)} className="text-sm text-muted underline underline-offset-4 min-h-[44px]">{more ? 'Less' : 'What it’s from'}</button>
          {more && (
            <div className="space-y-2">
              <ul className="text-sm space-y-1">{r.parts.map((p) => <li key={p.what} className="flex justify-between gap-3"><span>{p.what}</span><span className={`tnum ${p.good ? '' : 'text-caution'}`}>{p.text}</span></li>)}</ul>
              {rec.length > 0 && <p className="text-sm text-muted">HRV takes {rec.map((x) => `${x.days} day${x.days === 1 ? '' : 's'} ${x.label.toLowerCase().replace('after ', 'after ')}`).join('; ')} to come back.</p>}
              <a href="#/brain" className="text-sm font-medium underline underline-offset-4">Brain test</a>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** A stimulant's page: is the effect holding up, is the dose creeping, and how strong it comes back after a break. */
export function ToleranceSection({ med }: { med: Medication }) {
  const on = useOn();
  const doses = useDoses(); const checkIns = useCheckIns(); const daily = useDaily(); const ss = useScheduleSettings();
  const now = useNow(300_000);
  const [sheet, setSheet] = useState(false);
  if (!on || !doses || !checkIns || !daily || !ss || !isStimulant(med) || med.peptide) return null;
  const s = ss[1];
  const who = personOf(med);
  const cis = checkIns.filter((c) => personOf(c) === who), dy = daily.filter((d) => personOf(d) === who);
  const t = tolerance(med, doses, cis, dy, now, s);
  const creep = doseCreep(med, doses, now, s);
  const ab = afterBreak(med, doses, cis, dy, now, s);
  const breaks = med.schedule.breaks ?? [];
  return (
    <section aria-labelledby={`tol-${med.id}`} className="border-t border-border pt-5 space-y-2">
      <h2 id={`tol-${med.id}`} className="text-sm font-medium text-muted">Tolerance and breaks</h2>
      {t && (t.drops.length
        ? <p className="leading-snug"><span className="font-medium">The effect is shrinking</span> on {t.amount} {med.unit}: {t.drops.map((d) => `${d.what.toLowerCase()} ${d.from} → ${d.to}`).join('; ')} (first 3 weeks against the last 3). A break often brings it back.</p>
        : <p className="leading-snug">Holding up: no drop in the effect of {t.amount} {med.unit} over 10 weeks.</p>)}
      {creep && <p className="leading-snug"><span className="font-medium">Dose creep:</span> {creep.lines.join('; ')} (the last 3 weeks against 5–8 weeks ago).</p>}
      {ab && <p className="leading-snug tnum">After a break ({ab.breaks} so far): {[ab.firstRise !== undefined && ab.usualRise !== undefined ? `heart rate +${ab.firstRise} against +${ab.usualRise} usually` : null, ab.firstFocus !== undefined && ab.usualFocus !== undefined ? `focus ${ab.firstFocus} against ${ab.usualFocus}` : null].filter(Boolean).join('; ')}.</p>}
      {!t && !creep && !ab && <p className="text-muted leading-snug">Builds up from your doses, focus check-ins, brain tests and heart rate over a few weeks.</p>}
      {breaks.filter((b) => b.to >= format(now, 'yyyy-MM-dd')).map((b) => (
        <p key={b.from} className="flex items-center justify-between gap-3 text-sm tnum"><span>Break {format(new Date(`${b.from}T12:00`), 'EEE d MMM')} – {format(new Date(`${b.to}T12:00`), 'EEE d MMM')}</span>
          <button type="button" aria-label="Remove this break" className="w-11 h-11 flex items-center justify-center text-muted" onClick={() => setBreaks(med.id, breaks.filter((x) => x !== b))}><Trash2 size={18} /></button></p>
      ))}
      <button type="button" className="min-h-[44px] text-sm font-medium flex items-center gap-1.5" onClick={() => setSheet(true)}><Plus size={18} aria-hidden="true" />Plan a break</button>
      {sheet && <BreakSheet med={med} onClose={() => setSheet(false)} />}
    </section>
  );
}

function BreakSheet({ med, onClose }: { med: Medication; onClose: () => void }) {
  const toast = useToast();
  const today = format(Date.now(), 'yyyy-MM-dd');
  const sat = new Date(); sat.setDate(sat.getDate() + ((6 - sat.getDay() + 7) % 7));
  const [from, setFrom] = useState(format(sat, 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(new Date(sat.getTime() + 86_400_000), 'yyyy-MM-dd'));
  const ok = from >= today && to >= from;
  return (
    <Sheet open onClose={onClose} title="Plan a break">
      <p className="text-muted leading-snug">No reminders on these days. Afterwards, the app shows how strong the first doses back are.</p>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <TextInput label="From" type="date" value={from} min={today} onChange={(e) => setFrom(e.target.value)} />
        <TextInput label="To" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
      </div>
      <SheetActions>
        <Button className="w-full min-h-[52px]" disabled={!ok} onClick={async () => { await setBreaks(med.id, [...(med.schedule.breaks ?? []), { from, to }]); toast('Break planned'); onClose(); }}>Plan it</Button>
      </SheetActions>
    </Sheet>
  );
}

/** Body: how well muscle is protected while losing weight. */
export function MuscleCard() {
  const on = useOn();
  const body = useBodyEntries(); const daily = useDaily(); const workouts = useWorkouts(); const fam = useFamily(); const st = useSettings();
  const now = useNow(3_600_000);
  if (!on || !body || !daily || !workouts || !fam || !st) return null;
  const me = <T extends { personId?: string }>(x: T) => personOf(x) === fam.personId;
  const m = muscleScore(body.filter(me), daily.filter(me), workouts.filter(me), st.proteinTargetG, now);
  if (!m) return null;
  return (
    <section aria-labelledby="muscle-h" className="border-t border-border pt-5 space-y-2">
      <h2 id="muscle-h" className="text-sm font-medium text-muted">Muscle protection</h2>
      <div className="flex items-center gap-3">
        <MiniRing value={m.score} max={100} size={52} tone={m.score >= 75 ? 'good' : m.score >= 50 ? 'primary' : 'watch'} label={`Muscle protection ${m.score} of 100`}>{m.score}</MiniRing>
        <p className="font-semibold">{m.label}</p>
      </div>
      <ul className="text-sm space-y-1">{m.parts.map((p) => <li key={p.what} className="flex justify-between gap-3"><span>{p.what}</span><span className="tnum text-right">{p.text} {p.of ? <span className="text-muted">({p.points}/{p.of})</span> : <span className="text-caution">({p.points})</span>}</span></li>)}</ul>
    </section>
  );
}

/** Protocol, for a weekly GLP-1 shot: water and electrolytes today, gut symptoms and appetite by days since the shot. */
export function ShotBodySection({ med }: { med: Medication }) {
  const on = useOn();
  const doses = useDoses(); const checkIns = useCheckIns(); const daily = useDaily(); const workouts = useWorkouts(); const meds = useMeds(); const st = useSettings(); const ss = useScheduleSettings();
  const now = useNow(300_000);
  if (!on || !doses || !checkIns || !daily || !workouts || !meds || !st || !ss) return null;
  if (!(isGlpLike(med))) return null;
  const s = ss[1];
  const who = personOf(med);
  const me = <T extends { personId?: string }>(x: T) => personOf(x) === who;
  const cis = checkIns.filter(me);
  const f = fluids(meds.filter((m) => medIsFor(m, who)), doses, workouts.filter(me), cis, daily.filter(me), st.waterTargetMl, now, s);
  const gut = gutByShotDay(med, doses, cis, now);
  const app = appetiteAhead(med, doses, cis, now);
  return (
    <section aria-label="Water, gut and appetite" className="space-y-3">
      <div className="flex items-start gap-3">
        <Droplets size={20} aria-hidden="true" className="text-primary shrink-0 mt-0.5" />
        <p className="leading-snug"><span className="font-medium">About {fmtL(f.ml)} of water today</span>{f.reasons.length ? ` (${f.reasons.join(', ')})` : ''}{f.drunk !== undefined ? `: ${fmtL(f.drunk)} so far` : ''}.{f.electrolytes ? ' Add electrolytes or a pinch of salt.' : ''}{f.low ? ' Behind for this time of day.' : ''}</p>
      </div>
      {app && <p className="leading-snug flex items-start gap-3"><Activity size={20} aria-hidden="true" className="text-primary shrink-0 mt-0.5" /><span>Appetite usually comes back about <span className="font-medium">{format(app.at, 'EEEE')}</span> (day {app.day} after a shot): a good day to plan bigger, protein-rich meals.</span></p>}
      {gut && gut.some((g) => g.chips.length) && (
        <div>
          <h3 className="text-sm font-medium text-muted">Gut by days since the shot</h3>
          <ul className="text-sm mt-1 space-y-0.5 tnum">
            {gut.map((g) => <li key={g.day} className="flex justify-between gap-3"><span className="text-muted">{g.day === 0 ? 'Shot day' : `Day ${g.day}`}</span><span>{g.chips.length ? g.chips.slice(0, 2).map((c) => `${c.chip} ${c.pct}%`).join(', ') : g.checkIns ? 'Nothing noted' : '–'}</span></li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
