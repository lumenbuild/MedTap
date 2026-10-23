// Peptide predictions on the Protocol tab, Today and the report: the coming week, appetite through the week, changes
// worth a look, the weekly summary, and sheets for late shots, the best shot day, patterns across weeks and what's
// needed by a date. Everything is from the person's own records; each says what it's based on.
import { useState } from 'react';
import { format } from 'date-fns';
import type { Dose, Medication, Supply } from '../../db/schema';
import type { Units } from '../../db/repos/settings';
import { setSetting } from '../../db/repos/settings';
import type { ScheduleSettings } from '../../logic/schedule';
import {
  basisText, needsByDate, type AppetiteCurve, type ChangeFlag, type EffectForecast, type LateReport, type ShotDayResult,
  type VialRest, type WeekFinding, type WeeklySummary,
} from '../../logic/predict';
import { fmtAmount, WEEKDAYS } from '../../logic/format';
import { SUPPLY_LABELS } from '../../logic/peptide';
import { kgTo, weightUnit } from '../../logic/units';
import { shownName } from '../../logic/privacy';
import { HAS_BODY } from '../../edition';
import { Sheet } from '../../components/ui/Sheet';
import { TextInput } from '../../components/ui/Field';
import { Bar, Stat } from '../../components/ui/Visual';
import { Frown, Scale, Syringe } from 'lucide-react';

const day = (ms: number) => format(ms, 'EEE d MMM');
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ordinal = (n: number) => (n === 0 ? 'shot day' : `day ${n} after`);
const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;

/** What a prediction stands on, in a few words: "3 shots · 81 check-ins". */
export function Basis({ text }: { text: string }) {
  const short = text.replace(/^Based on /i, '').split('.')[0].replace(/, (and )?/g, ' · ').replace(/ and /g, ' · ');
  return short ? <p className="text-xs text-muted mt-1 tnum">{short}</p> : null;
}

/** Shifts worth a look: a dot and a line each. */
export function FlagList({ flags }: { flags: ChangeFlag[] }) {
  if (!flags.length) return null;
  return (
    <ul aria-label="Worth a look" className="mb-3 space-y-2">
      {flags.map((f) => (
        <li key={f.kind} className="relative pl-5">
          <span aria-hidden="true" className="absolute left-0 top-[9px] w-2 h-2 rounded-full" style={{ background: 'var(--caution)' }} />
          <p className="font-medium">{f.title}</p>
          <p className="text-sm text-muted">{f.detail}</p>
          <Basis text={basisText(f.basis)} />
        </li>
      ))}
    </ul>
  );
}

/** The next 7 days: a dot per day (darker = side effects more often on that day after a shot) and what's likely. */
export function ComingWeek({ fc }: { fc: EffectForecast }) {
  const likely = fc.days.filter((d) => d.likely.length);
  return (
    <div>
      <p className="text-sm font-medium text-muted mb-2">The coming week</p>
      <div className="grid grid-cols-7 gap-1 text-center" aria-hidden="true">
        {fc.days.map((d) => (
          <div key={d.start} className="flex flex-col items-center gap-1.5">
            <span className="text-xs text-muted">{format(d.start, 'EEEEE')}</span>
            <span className="w-5 h-5 rounded-full border" style={{ borderColor: 'var(--border-strong)', background: d.known ? `color-mix(in srgb, var(--caution) ${Math.max(0, Math.min(100, d.effectPct))}%, transparent)` : 'transparent' }} />
          </div>
        ))}
      </div>
      <p className="mt-2 text-[15px]">
        {likely.length
          ? likely.map((d) => `${format(d.start, 'EEE')}: ${d.likely.map((x) => x.chip.toLowerCase()).join(', ')} likely (${ordinal(d.day)})`).join(' · ')
          : 'Nothing usually shows up on these days.'}
      </p>
      <Basis text={`${basisText(fc.basis)}${fc.atThisDose ? ' at this dose' : ' across your doses'}.`} />
    </div>
  );
}

/** Appetite on each day after a shot, as bars, with today marked. */
export function AppetiteStrip({ c }: { c: AppetiteCurve }) {
  const known = c.days.filter((d) => d.appetite !== undefined);
  const back = c.today !== undefined ? c.days.find((d) => d.day > c.today! && d.appetite !== undefined && d.appetite >= 3.5) : undefined;
  return (
    <div>
      <p className="text-sm font-medium text-muted mb-2">Appetite through the week</p>
      <div className="flex items-end gap-1.5 h-14" role="img" aria-label={`Usual appetite by day after your shot: ${known.map((d) => `${ordinal(d.day)} ${d.appetite}`).join(', ')}`}>
        {c.days.map((d) => (
          <div key={d.day} className="flex-1 flex flex-col items-center justify-end h-full">
            <div className="w-full rounded-[3px]" style={{ height: `${((d.appetite ?? 0) / 5) * 100}%`, minHeight: d.appetite ? 3 : 0, background: d.day === c.today ? 'var(--text)' : 'var(--border-strong)' }} />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1" aria-hidden="true">{c.days.map((d) => <span key={d.day} className={`flex-1 text-center text-xs tnum ${d.day === c.today ? 'text-text font-semibold' : 'text-muted'}`}>{d.day}</span>)}</div>
      <p className="mt-2 text-[15px]">
        {c.today !== undefined && c.todayAppetite !== undefined
          ? `Today is ${ordinal(c.today)} your shot: appetite usually ${c.todayAppetite} of 5.${back ? ` Usually back to ${back.appetite} by day ${back.day}.` : ''}`
          : 'Days since your shot along the bottom; taller = more appetite (1–5).'}
      </p>
      <Basis text={`${basisText(c.basis)}${c.atThisDose ? ' at this dose' : ' across your doses'}.`} />
    </div>
  );
}

/** "Last full dose Tue 10 Nov; 1.5 mg left over." */
export function vialRestText(v: VialRest, unit: string, pen: boolean): string {
  const it = pen ? 'pen' : 'vial';
  if (v.ends === 'no-plan') return v.doses ? `${v.doses} more planned dose${v.doses === 1 ? '' : 's'} from this ${it}` : '';
  const last = v.lastFullAt ? `Last full dose ${day(v.lastFullAt)}` : `Not enough for the next dose`;
  if (v.ends === 'use-by') return `${last}; ${fmtAmount(v.leftover, unit)} will be past use-by on ${day(v.useBy!)}`;
  return `${last}${v.leftover > 0 ? `; ${fmtAmount(v.leftover, unit)} left over` : ''}`;
}

/** The last 7 days in a few lines. */
export function WeeklySummaryBlock({ w, med, units, title = 'Last 7 days' }: { w: WeeklySummary; med: Medication; units: Units; title?: string }) {
  const u = weightUnit(units);
  return (
    <div>
      <p className="text-sm font-medium text-muted mb-2">{title}</p>
      <div className="grid grid-cols-2 gap-2">
        <Stat Icon={Syringe} label={med.schedule.type === 'fixed' && w.planned ? `Shots · ${w.onTime} on time` : 'Shots'} value={w.planned ? `${w.shots}/${w.planned}` : w.shots}
          tone={w.planned && w.shots >= w.planned ? 'good' : 'watch'}>
          {w.planned ? <Bar value={w.shots} max={w.planned} tone={w.shots >= w.planned ? 'good' : 'watch'} label={`${w.shots} of ${w.planned} shots`} /> : null}
        </Stat>
        {HAS_BODY && w.weightPerWeek !== undefined && <Stat Icon={Scale} label="Weight a week" value={signed(kgTo(w.weightPerWeek, units))} unit={u} tone={w.weightPerWeek <= 0 ? 'good' : 'plain'} />}
        {w.effectPct !== undefined && <Stat Icon={Frown} label="Side effects" value={`${w.effectPct}%`} unit={w.effectPctBefore !== undefined ? `was ${w.effectPctBefore}%` : undefined}>
          <Bar value={w.effectPct} max={100} tone={w.effectPct > 50 ? 'watch' : 'plain'} label={`Side effects in ${w.effectPct}% of check-ins`} />
        </Stat>}
      </div>
    </div>
  );
}

// ── Sheets ───────────────────────────────────────────────────────────────────────────────────────────

export function LateShotsSheet({ med, report, onClose }: { med: Medication; report: LateReport; onClose: () => void }) {
  return (
    <Sheet open onClose={onClose} title="Late and missed shots">
      <p className="text-sm text-muted">Shots 12+ hours late, or missed, over the last {report.basis.weeks} weeks: how much lower the estimated level was until the next shot than if taken on time, and the check-ins in the 3 days after.</p>
      {report.usual && <p className="text-sm mt-2">Usually: {[report.usual.appetite !== undefined ? `appetite ${report.usual.appetite}` : null, report.usual.effectPct !== undefined ? `side effects in ${report.usual.effectPct}% of check-ins` : null].filter(Boolean).join(', ')}.</p>}
      {report.events.length === 0 ? <p className="border-t border-border mt-3 pt-4">None: every shot within 12 hours of its time.</p> : (
        <ul className="mt-3">
          {report.events.map((e) => (
            <li key={e.plannedAt} className="border-t border-border py-3">
              <p className="font-medium tnum">{day(e.plannedAt)} · {e.missed ? 'missed' : `${fmtLate(e.hoursLate!)} late`}</p>
              <p className="text-sm text-muted tnum">
                {[
                  e.levelDropPct !== undefined && e.levelDropPct > 0 ? `level about ${e.levelDropPct}% lower until the next shot` : null,
                  e.after ? `after: ${[e.after.appetite !== undefined ? `appetite ${e.after.appetite}` : null, e.after.effectPct !== undefined ? `side effects in ${e.after.effectPct}% of ${e.after.n}` : null].filter(Boolean).join(', ')}` : 'no check-ins after',
                ].filter(Boolean).join(' · ')}
              </p>
            </li>
          ))}
        </ul>
      )}
      {!med.peptide?.halfLifeHours && <p className="text-sm text-muted mt-2">Add a half-life on {shownName(med)}'s page to see the level change too.</p>}
    </Sheet>
  );
}
export const orList = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);
const fmtLate = (h: number) => (h >= 36 ? `${Math.round(h / 24 * 10) / 10} days` : `${Math.round(h)} hours`);

export function ShotDaySheet({ result, busy, onClose }: { result: ShotDayResult | null; busy: number[]; onClose: () => void }) {
  const toggle = (d: number) => setSetting('busyDays', busy.includes(d) ? busy.filter((x) => x !== d) : [...busy, d].sort());
  const best = result?.options.filter((o) => o.score === result.options[0].score) ?? [];
  const cur = result?.options.find((o) => o.weekday === result.current);
  return (
    <Sheet open onClose={onClose} title="Best shot day">
      <p className="text-sm text-muted">Tick your busy days</p>
      <fieldset className="mt-4">
        <legend className="text-sm font-medium mb-2">Busy days</legend>
        <div className="grid grid-cols-7 gap-1">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <button key={d} type="button" aria-pressed={busy.includes(d)} onClick={() => toggle(d)}
              className={`min-h-[44px] rounded-btn text-sm font-medium border ${busy.includes(d) ? 'bg-text text-bg border-text' : 'border-border-strong'}`}>
              {WEEKDAYS[d].slice(0, 2)}
            </button>
          ))}
        </div>
      </fieldset>
      {!result ? <p className="mt-4">Needs a once-a-week shot and at least 6 check-ins in the days after shots.</p> : (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-muted">Side effects by day after a shot: {result.burden.map((b, k) => `${ordinal(k)} ${b}%`).join(', ')}.</p>
          {busy.length === 0 ? <p>Pick at least one busy day.</p> : (
            <>
              <p className="text-lg font-medium">{orList(best.map((o) => LONG_DAYS[o.weekday]))}{best.some((o) => o.weekday === result.current) ? ' (your shot day now)' : ''}</p>
              {cur && cur.hardDays.length > 0 && <p className="text-[15px]">With {LONG_DAYS[result.current!]} shots, side effects usually land on {cur.hardDays.map((d) => LONG_DAYS[d]).join(' and ')}.</p>}
              <ul className="text-sm text-muted tnum">
                {result.options.map((o) => <li key={o.weekday}>{LONG_DAYS[o.weekday]}: {o.hardDays.length ? `side effects likely on ${o.hardDays.map((d) => WEEKDAYS[d]).join(', ')}` : 'busy days clear'}</li>)}
              </ul>
            </>
          )}
          <Basis text={basisText(result.basis)} />
        </div>
      )}
    </Sheet>
  );
}

export function PatternsSheet({ findings, weeks, onClose }: { findings: WeekFinding[]; weeks: number; onClose: () => void }) {
  return (
    <Sheet open onClose={onClose} title="Patterns across weeks">
      <p className="text-sm text-muted">What differs in your better weeks</p>
      {findings.length === 0 ? <p className="border-t border-border mt-3 pt-4">No clear differences yet across {weeks} week{weeks === 1 ? '' : 's'} with check-ins.</p> : (
        <ul className="mt-3">
          {findings.map((f) => (
            <li key={f.factor} className="border-t border-border py-3">
              <p className="font-medium">{f.title}</p>
              {[f.a, f.b].map((g) => (
                <p key={g.label} className="text-[15px] tnum">
                  {g.label} ({g.weeks} week{g.weeks === 1 ? '' : 's'}): {[g.effectPct !== undefined ? `side effects in ${g.effectPct}% of check-ins` : null, g.appetite !== undefined ? `appetite ${g.appetite}` : null].filter(Boolean).join(', ')}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

/** What's needed from now until a date (a trip, a planned change), against what's on hand. */
export function NeedsSheet({ meds, supplies, doses, s, now, onClose }: { meds: Medication[]; supplies: Supply[]; doses: Dose[]; s: ScheduleSettings; now: number; onClose: () => void }) {
  const [date, setDate] = useState(format(now + 28 * 86_400_000, 'yyyy-MM-dd'));
  const until = new Date(`${date}T23:59`).getTime();
  const r = until > now ? needsByDate(meds, supplies, doses, now, until, s) : null;
  const short = r ? [...r.meds.filter((m) => m.short > 0), ...r.supplies.filter((x) => x.short > 0)] : [];
  return (
    <Sheet open onClose={onClose} title="Enough until…">
      <TextInput label="Until" type="date" value={date} min={format(now, 'yyyy-MM-dd')} onChange={(e) => setDate(e.target.value)} help="The end of a trip, or the day before a planned change." />
      {r && (
        <div className="mt-4">
          <p className="text-lg font-medium">{short.length ? `Order ${short.length} thing${short.length === 1 ? '' : 's'} before then` : 'Enough of everything'}</p>
          <ul className="mt-2">
            {r.meds.map((m) => {
              const pen = m.med.peptide?.kind === 'pen';
              const unit = m.med.peptide ? (pen ? 'pen' : 'vial') : m.med.form === 'other' ? 'unit' : m.med.form;
              const n = (x: number) => `${Math.round(x * 100) / 100} ${unit}${x === 1 ? '' : 's'}`;
              return (
                <li key={m.med.id} className="border-t border-border py-3">
                  <p className="flex justify-between gap-3"><span className="font-medium">{shownName(m.med)}</span><span className={`tnum ${m.short > 0 ? 'text-caution font-medium' : ''}`}>{m.short > 0 ? `${n(Math.ceil(m.short))} short` : 'Enough'}</span></p>
                  <p className="text-sm text-muted tnum">Need about {n(m.need)}, have {n(m.have)}{m.basis === 'recent-use' ? ' (from the last 30 days)' : ''}</p>
                  {m.vialUseBy && <p className="text-sm text-caution">The {pen ? 'pen' : 'vial'} in use passes its use-by on {day(m.vialUseBy)}.</p>}
                </li>
              );
            })}
            {r.supplies.map((x) => {
              const l = SUPPLY_LABELS[x.supply.kind];
              const sharps = x.supply.kind === 'sharps';
              return (
                <li key={x.supply.id} className="border-t border-border py-3">
                  <p className="flex justify-between gap-3"><span className="font-medium">{l.name}</span><span className={`tnum ${x.short > 0 ? 'text-caution font-medium' : ''}`}>{x.short > 0 ? (sharps ? 'Will fill up' : `${Math.ceil(x.short)}${l.unit ? ` ${l.unit}` : ''} short`) : 'Enough'}</span></p>
                  <p className="text-sm text-muted tnum">{sharps ? `${Math.round(x.need)} more to go in; ${x.have} of ${x.supply.capacity ?? '?'} in it` : `Need about ${Math.round(x.need * 10) / 10}${l.unit ? ` ${l.unit}` : ''}, have ${x.have}${l.unit ? ` ${l.unit}` : ''}`}</p>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted mt-2">From your plans (planned changes included) and stock counts.</p>
        </div>
      )}
    </Sheet>
  );
}
