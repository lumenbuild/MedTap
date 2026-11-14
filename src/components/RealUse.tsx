// Cards built from how the app is really used (logic in logic/realUse.ts): what started together, a hard day
// explained, the first weeks on a blood-pressure medicine, stock against the plan, walking, and watch strength
// sessions with nothing logged. Short, visual, facts only.
import { useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, CalendarRange, Dumbbell, Footprints, HeartPulse, Layers, Package, Sunrise } from 'lucide-react';
import type { Medication } from '../db/schema';
import { useDaily, useDoses, useCheckIns, useFamily, useMeds, useScheduleSettings, useVitals, useWorkouts } from '../app/data';
import { personOf, medIsFor } from '../db/repos/people';
import { roughPattern, roughYesterday, startClusters, startedWith, startWatch, stockOutlook, unfilledStrength } from '../logic/realUse';
import { shownName } from '../logic/privacy';
import { useNow } from '../app/useNow';
import { MedBadge } from './MedBadge';
import { shownColour } from '../logic/privacy';
import { VitalsSheet, type VitalsSheetState } from './VitalsSheet';

const DAY = 86_400_000;
const d = (t: number) => format(t, 'd MMM');
const H = ({ id, Icon, children, right }: { id: string; Icon: typeof Layers; children: React.ReactNode; right?: React.ReactNode }) => (
  <div className="flex items-center gap-2">
    <h2 id={id} className="font-semibold text-[17px] flex items-center gap-2 flex-1"><Icon size={18} aria-hidden="true" className="text-primary" />{children}</h2>
    {right}
  </div>
);

/** Before and after as two bars, the change in words beside them. */
function BeforeAfter({ label, before, after, unit, lowerBetter }: { label: string; before: number; after: number; unit: string; lowerBetter?: boolean }) {
  const max = Math.max(before, after) * 1.1 || 1;
  const worse = lowerBetter ? after > before : after < before;
  const same = Math.abs(after - before) < Math.max(0.5, before * 0.03);
  return (
    <div className="grid grid-cols-[88px_1fr_auto] items-center gap-2 text-[13px]">
      <span className="text-muted">{label}</span>
      <span className="space-y-1" aria-hidden="true">
        <span className="block h-2 rounded-full bg-surface-2"><span className="block h-2 rounded-full" style={{ width: `${(before / max) * 100}%`, background: 'var(--border-strong, #9aa0a6)' }} /></span>
        <span className="block h-2 rounded-full bg-surface-2"><span className="block h-2 rounded-full" style={{ width: `${(after / max) * 100}%`, background: same ? 'var(--primary)' : worse ? 'var(--caution)' : 'var(--success)' }} /></span>
      </span>
      <span className="tnum font-semibold">{before} → {after}{unit}</span>
    </div>
  );
}

// ── What started together ──────────────────────────────────────────────────────────────────────────

export function StartClustersCard() {
  const meds = useMeds(); const daily = useDaily(); const fam = useFamily();
  const now = useNow(3_600_000);
  if (!meds || !daily || !fam) return null;
  const mine = meds.filter((m) => medIsFor(m, fam.personId));
  const c = startClusters(mine, daily.filter((x) => personOf(x) === fam.personId), now).find((x) => now - x.to < 60 * DAY);
  if (!c) return null;
  const span = Math.max(1, (c.to - c.from) / DAY);
  return (
    <section className="box space-y-3" aria-labelledby="together-h">
      <H id="together-h" Icon={Layers}>{c.meds.length} started together</H>
      {/* The stretch as a line, each start a badge at its day. */}
      <div className="relative h-14 mx-3" role="img" aria-label={c.meds.map((m) => `${shownName(m)} ${d(m.startedOn ? Date.parse(`${m.startedOn}T12:00`) : Date.parse(m.createdAt))}`).join(', ')}>
        <div className="absolute left-0 right-0 top-[18px] h-[3px] rounded-full bg-surface-2" />
        {c.meds.map((m, i) => {
          const t = m.startedOn ? Date.parse(`${m.startedOn}T12:00`) : Date.parse(m.createdAt);
          return (
            <div key={m.id} className="absolute -translate-x-1/2 flex flex-col items-center" style={{ left: `${((t - c.from) / DAY / span) * 100}%`, top: i % 2 ? 0 : 4 }}>
              <MedBadge color={shownColour(m)} icon={m.icon} size={26} />
            </div>
          );
        })}
        <span className="absolute left-0 bottom-0 text-[12px] text-muted tnum">{d(c.from)}</span>
        <span className="absolute right-0 bottom-0 text-[12px] text-muted tnum">{d(c.to)}</span>
      </div>
      <p className="text-[14px]">{c.meds.map((m) => shownName(m)).join(', ')}</p>
      {(c.hrv || c.rhr || c.sleepH) && (
        <div className="space-y-1.5">
          <p className="text-[13px] text-muted">Two weeks before, against since</p>
          {c.hrv && <BeforeAfter label="HRV" before={c.hrv.before} after={c.hrv.after} unit=" ms" />}
          {c.rhr && <BeforeAfter label="Resting HR" before={c.rhr.before} after={c.rhr.after} unit="" lowerBetter />}
          {c.sleepH && <BeforeAfter label="Sleep" before={c.sleepH.before} after={c.sleepH.after} unit=" h" />}
        </div>
      )}
      <p className="text-[13px] text-muted leading-snug">Started within days of each other, their effects can’t be told apart from your records.</p>
    </section>
  );
}

/** On a medicine's page: what else started the same week. */
export function StartedWithLine({ med }: { med: Medication }) {
  const meds = useMeds();
  if (!meds) return null;
  const w = startedWith(med, meds.filter((m) => medIsFor(m, med.personId ?? 'me') || m.personId === med.personId));
  if (w.length < 2) return null;
  return <p className="text-[14px] text-muted flex items-start gap-2 px-1"><Layers size={16} aria-hidden="true" className="shrink-0 mt-0.5" />Started the same week as {w.map((m) => shownName(m)).join(', ')}: their effects overlap.</p>;
}

// ── A hard day, explained ──────────────────────────────────────────────────────────────────────────

export function RoughDayCard() {
  const meds = useMeds(); const doses = useDoses(); const checkIns = useCheckIns(); const daily = useDaily(); const fam = useFamily(); const ss = useScheduleSettings();
  const now = useNow(600_000);
  if (!meds || !doses || !checkIns || !daily || !fam || !ss || fam.everyone) return null;
  const s = ss[1];
  if (new Date(now).getHours() >= 14) return null; // a morning look back
  const data = { meds: meds.filter((m) => medIsFor(m, fam.personId)), doses, checkIns: checkIns.filter((c) => personOf(c) === fam.personId), daily: daily.filter((x) => personOf(x) === fam.personId) };
  const r = roughYesterday(data, now, s);
  if (!r) return null;
  const p = roughPattern(data, now, s);
  return (
    <section className="box space-y-2.5" aria-labelledby="rough-h">
      <H id="rough-h" Icon={Sunrise}>Yesterday was a hard day</H>
      <p className="text-[14px] text-muted">Your check-ins averaged {r.score} of 5.{r.different.length ? ' What was different:' : ' Nothing in your records stood out from your usual.'}</p>
      {r.different.length > 0 && <ul className="flex flex-wrap gap-1.5">{r.different.map((x) => <li key={x} className="text-[13px] rounded-full px-2.5 py-1 bg-surface-2">{x}</li>)}</ul>}
      {p && <p className="text-[14px] rounded-btn bg-primary-soft p-2.5"><strong>{p.of} of your {p.days} lowest days</strong> came with {p.what}.</p>}
    </section>
  );
}

// ── The first weeks on guanfacine or clonidine ─────────────────────────────────────────────────────

export function StartWatchCards({ onLogBp }: { onLogBp?: () => void }) {
  const meds = useMeds(); const doses = useDoses(); const vitals = useVitals(); const daily = useDaily(); const fam = useFamily(); const ss = useScheduleSettings();
  const now = useNow(600_000);
  const [sheet, setSheet] = useState<VitalsSheetState>(null);
  if (!meds || !doses || !vitals || !daily || !fam || !ss || fam.everyone) return null;
  const ws = startWatch(meds.filter((m) => medIsFor(m, fam.personId)), doses, vitals.filter((v) => personOf(v) === fam.personId), daily.filter((x) => personOf(x) === fam.personId), now, ss[1]);
  if (!ws.length) return null;
  return (
    <>
      {ws.map((w) => (
        <section key={w.med.id} className="box space-y-3" aria-labelledby={`sw-${w.med.id}`}>
          <H id={`sw-${w.med.id}`} Icon={HeartPulse} right={<span className="text-[13px] text-muted tnum">day {w.day}</span>}>First weeks on {shownName(w.med)}</H>
          {w.missedRun >= 2 && (
            <p role="note" className="text-[14px] leading-snug rounded-btn p-2.5 flex gap-2" style={{ background: 'var(--caution-soft)' }}>
              <AlertTriangle size={16} aria-hidden="true" className="shrink-0 mt-0.5" style={{ color: 'var(--caution)' }} />
              <span>No dose logged on {w.missedRun} scheduled days in a row. Its label says that after 2 or more missed doses, check with your prescriber before the next one.</span>
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-btn bg-surface-2 p-3">
              <p className="text-[12px] text-muted">Blood pressure this week</p>
              <p className="text-[22px] font-bold tnum">{w.bpThisWeek}<span className="text-[13px] font-normal text-muted"> / 3 readings</span></p>
              {w.bp.length > 0 && <p className="text-[12px] text-muted tnum">Latest {w.bp[w.bp.length - 1].s}/{w.bp[w.bp.length - 1].d}</p>}
            </div>
            <div className="rounded-btn bg-surface-2 p-3">
              <p className="text-[12px] text-muted">Resting heart rate</p>
              {w.rhr ? <p className="text-[22px] font-bold tnum">{w.rhr.before} → {w.rhr.since}</p> : <p className="text-[15px] text-muted">From the watch, in a few days</p>}
              {w.rhr && <p className="text-[12px] text-muted">before, and since starting</p>}
            </div>
          </div>
          <p className="text-[13px] text-muted leading-snug">It lowers blood pressure and heart rate, and Ritalin raises them, so a few readings a week in the first weeks show how the two settle.</p>
          <button type="button" onClick={() => (onLogBp ? onLogBp() : setSheet({}))} className="w-full min-h-[48px] rounded-btn bg-primary text-on-primary font-semibold">Log blood pressure</button>
        </section>
      ))}
      {!onLogBp && <VitalsSheet state={sheet} onClose={() => setSheet(null)} personId={fam.personId} />}
    </>
  );
}

// ── Stock against the plan ─────────────────────────────────────────────────────────────────────────

export function StockOutlookCard() {
  const meds = useMeds(); const doses = useDoses(); const ss = useScheduleSettings(); const fam = useFamily();
  const now = useNow(3_600_000);
  if (!meds || !doses || !ss || !fam) return null;
  const rows = meds.filter((m) => medIsFor(m, fam.personId)).map((m) => stockOutlook(m, doses, now, ss[1])).filter((x): x is NonNullable<typeof x> => !!x && (x.lastsDays > 120 || x.expireFirst > 0 || !!x.courseEnds))
    .sort((a, b) => b.lastsDays - a.lastsDays);
  if (!rows.length) return null;
  // Two years across; longer runs fill the bar.
  const maxDays = 730;
  const mo = (days: number) => (days >= 60 ? `${Math.round(days / 30.4)} months` : `${days} days`);
  return (
    <section className="box space-y-3" aria-labelledby="outlook-h">
      <H id="outlook-h" Icon={Package}>Stock against your plan</H>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.med.id} className="space-y-1">
            <div className="flex items-baseline gap-2 text-[15px]">
              <span className="font-medium flex-1 truncate">{shownName(r.med)}</span>
              <span className="tnum text-muted text-[13px]">{r.unopened} unopened · {r.courses ? `about ${Math.floor(r.courses.n)} course${Math.floor(r.courses.n) === 1 ? '' : 's'} of ${r.courses.days} days` : `lasts ~${mo(r.lastsDays)}`}</span>
            </div>
            <div className="relative h-2.5 rounded-full bg-surface-2" role="img" aria-label={`Lasts about ${mo(r.lastsDays)}${r.courseEnds ? `; course ends ${d(r.courseEnds)}` : ''}`}>
              {r.courses
                ? <div className="absolute inset-0 flex gap-[3px]">{Array.from({ length: Math.min(24, Math.max(1, Math.floor(r.courses.n))) }, (_, i) => <span key={i} className="flex-1 rounded-full" style={{ background: shownColour(r.med) }} />)}</div>
                : <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, (r.lastsDays / maxDays) * 100)}%`, background: shownColour(r.med) }} />}
              {r.courseEnds && !r.courses && <div className="absolute -top-1 -bottom-1 w-[3px] rounded-full bg-text" style={{ left: `${Math.min(100, ((r.courseEnds - now) / DAY / maxDays) * 100)}%` }} />}
            </div>
            {(r.courseEnds || r.expireFirst > 0) && (
              <p className="text-[12px] text-muted">{[r.courseEnds ? `Course ends ${d(r.courseEnds)}` : null, r.expireFirst ? `${r.expireFirst} vial${r.expireFirst === 1 ? '' : 's'} past expiry before you'd reach ${r.expireFirst === 1 ? 'it' : 'them'}` : null].filter(Boolean).join(' · ')}</p>
            )}
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-muted">At your planned doses, oldest vial first. A bar is two years; a course medicine shows a segment per course.</p>
    </section>
  );
}

// ── Watch strength sessions with nothing logged ────────────────────────────────────────────────────

export function UnfilledStrengthCard() {
  const workouts = useWorkouts(); const fam = useFamily();
  const now = useNow(3_600_000);
  if (!workouts || !fam) return null;
  const ws = unfilledStrength(workouts.filter((w) => personOf(w) === fam.personId), now).slice(0, 3);
  if (!ws.length) return null;
  return (
    <section className="box space-y-2" aria-labelledby="fill-h">
      <H id="fill-h" Icon={Dumbbell}>What did you do?</H>
      <p className="text-[14px] text-muted">Your watch recorded strength sessions with nothing in them yet. Adding the exercises counts them towards your programme and muscle protection.</p>
      <ul className="divide-y divide-border">
        {ws.map((w) => (
          <li key={w.id}>
            <a href={`#/training/workout/${w.id}`} className="min-h-[52px] flex items-center gap-3">
              <span className="flex-1"><span className="block font-medium">{w.cardio?.title ?? 'Strength training'}</span><span className="block text-[13px] text-muted tnum">{format(Date.parse(w.startedAt), 'EEE d MMM, h:mm a')} · {w.cardio?.durationMin ?? '?'} min</span></span>
              <span className="text-primary font-medium text-[14px]">Add exercises</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export const WalkIcon = Footprints;
export const RangeIcon = CalendarRange;
