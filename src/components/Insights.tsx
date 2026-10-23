// The smart insights, each in one place: today's wear-off forecast, a weight stall, today's cycle phase and recent
// changes as one line on Today; "What changed" and "Ask your data" on Trends; the step-up checklist on Protocol.
import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ArrowDownRight, ArrowUpRight, Check, CircleHelp, Droplet, Minus, Pencil, Search, Sparkles, TrendingDown, X, Zap } from 'lucide-react';
import type { CheckIn, DailyHealth, Dose, Medication, StepUpCriteria } from '../db/schema';
import type { ScheduleSettings } from '../logic/schedule';
import { wearOffToday, type WearOff } from '../logic/wearOff';
import type { Stall } from '../logic/stall';
import type { CycleForecast } from '../logic/cycle';
import { fmtChangeValue, type Change } from '../logic/changes';
import { ask, askSuggestions, type AskData } from '../logic/ask';
import { DEFAULT_STEP_UP, stepUpChecklist } from '../logic/stepUp';
import { shownName } from '../logic/privacy';
import { fmtTime } from '../logic/format';
import { db } from '../db/db';
import { Bar, IconRow } from './ui/Visual';
import { Button } from './ui/Button';
import { Sheet, SheetActions } from './ui/Sheet';
import { TextInput } from './ui/Field';
import { TrendChart } from './charts/TrendChart';
import type { BodyEntry } from '../db/schema';

const day = (t: number) => format(t, 'EEE d MMM');

// ── Wear-off (Today) ───────────────────────────────────────────────────────────────────────────────

/** Today's forecast for each medicine with a learned effect window: a bar from the dose to the likely drop. */
export function WearOffLines({ meds, doses, checkIns, daily, now, s }: { meds: Medication[]; doses: Dose[]; checkIns: CheckIn[]; daily: DailyHealth[]; now: number; s: ScheduleSettings }) {
  const list = meds.filter((m) => !m.archived && !m.peptide).map((m) => wearOffToday(m, doses, checkIns, daily, now, s)).filter((w): w is WearOff => !!w && w.late > now - 2 * 3_600_000);
  if (!list.length) return null;
  return <ul aria-label="Wear-off forecast">{list.map((w) => <li key={w.med.id}><WearOffRow w={w} now={now} /></li>)}</ul>;
}

function WearOffRow({ w, now }: { w: WearOff; now: number }) {
  const past = now > w.at;
  const span = w.late - w.dosedAt;
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - w.dosedAt) / span) * 100));
  return (
    <div className="py-1.5">
      <IconRow Icon={Zap} tone={past ? 'plain' : 'good'}>
        <span className="font-medium">{shownName(w.med)}</span> · {past ? `likely wearing off since ${fmtTime(w.at)}` : `focus likely drops about ${fmtTime(w.at)}`}
        {w.reasons.length > 0 && <span className="block text-sm text-muted">{w.reasons.join(' · ')}</span>}
      </IconRow>
      <div className="ml-12 mt-1 relative h-2 rounded-full bg-surface-2" role="img" aria-label={`From the dose at ${fmtTime(w.dosedAt)} to a likely drop between ${fmtTime(w.early)} and ${fmtTime(w.late)}`}>
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct(w.early)}%`, background: 'var(--success)' }} />
        <div className="absolute inset-y-0 rounded-full" style={{ left: `${pct(w.early)}%`, width: `${pct(w.late) - pct(w.early)}%`, background: 'var(--caution-soft)' }} />
        <div className="absolute -top-1 -bottom-1 w-0.5 bg-text" style={{ left: `${pct(now)}%` }} />
      </div>
      <div className="ml-12 mt-0.5 flex justify-between text-[11px] text-muted tnum"><span>{fmtTime(w.dosedAt)}</span><span>{fmtTime(w.early)}–{fmtTime(w.late)}</span></div>
    </div>
  );
}

// ── Stall ──────────────────────────────────────────────────────────────────────────────────────────

export function StallLine({ stall }: { stall: Stall }) {
  return (
    <IconRow Icon={stall.likelyWater ? Droplet : TrendingDown} tone="watch" href="#/progress">
      {stall.likelyWater ? `Weight steady ${stall.days} days, probably water` : `Weight steady for ${stall.days} days`}
      {!stall.likelyWater && stall.diffs.length > 0 && <span className="block text-sm text-muted">{stall.diffs.slice(0, 2).map((d) => `${d.label} ${d.before} → ${d.during}`).join(' · ')}</span>}
    </IconRow>
  );
}

/** Under the weight chart: since when, the rate before and during, water reasons, and what's different. */
export function StallBlock({ stall }: { stall: Stall }) {
  return (
    <div className="mt-3 rounded-card bg-surface-2 p-3 space-y-2">
      <p className="font-semibold">{stall.likelyWater ? 'Probably water' : `Steady since ${day(stall.since)}`}</p>
      <p className="text-sm tnum">{stall.before.toFixed(2)} kg/wk before · {stall.during >= 0 ? '+' : ''}{stall.during.toFixed(2)} kg/wk now{stall.cycleAdjusted ? ' · cycle water taken out' : ''}</p>
      {stall.water.length > 0 && <p className="text-sm text-muted">Water from {stall.water.join(', ')}</p>}
      {stall.diffs.length > 0 && (
        <table className="w-full text-sm tnum">
          <thead><tr className="text-left text-muted"><th className="font-medium py-1">Different now</th><th className="font-medium py-1">Before</th><th className="font-medium py-1">During</th></tr></thead>
          <tbody>{stall.diffs.map((d) => <tr key={d.key} className="border-t border-border"><td className="py-1.5 pr-2">{d.label}</td><td className="py-1.5 pr-2">{d.before}</td><td className="py-1.5 font-medium">{d.during}</td></tr>)}</tbody>
        </table>
      )}
    </div>
  );
}

// ── Cycle ──────────────────────────────────────────────────────────────────────────────────────────

export function CycleLine({ f }: { f: CycleForecast }) {
  if (!f.today?.notes.length || f.day === undefined) return null;
  return <IconRow Icon={Droplet} tone="primary" href="#/progress">Cycle day {f.day}<span className="block text-sm text-muted">{f.today.notes.join(' · ')}</span></IconRow>;
}

/** The next five weeks by phase, each with what usually differs. */
export function CycleStrip({ f, now }: { f: CycleForecast; now: number }) {
  return (
    <div className="mt-3">
      <p className="text-sm font-medium text-muted mb-2">Coming weeks · next period about {day(f.nextStart)}</p>
      <ul className="space-y-1.5">
        {f.upcoming.map((u) => (
          <li key={u.from} className={`flex gap-3 text-sm ${u.from <= now && u.to > now ? 'font-medium' : ''}`}>
            <span className="w-28 shrink-0 tnum text-muted">{format(Math.max(u.from, now), 'd MMM')}–{format(u.to - 1, 'd MMM')}</span>
            <span className="flex-1">{u.notes.length ? u.notes.join(' · ') : 'Usual'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── What changed ───────────────────────────────────────────────────────────────────────────────────

const toneOf = (c: Change) => (c.good === undefined ? 'var(--text-muted)' : c.good ? 'var(--success)' : 'var(--caution)');

export function ChangeLine({ c }: { c: Change }) {
  return (
    <IconRow Icon={c.after > c.before ? ArrowUpRight : ArrowDownRight} tone={c.good === undefined ? 'plain' : c.good ? 'good' : 'watch'} href="#/progress">
      {c.label} {c.after > c.before ? 'up' : 'down'}: {fmtChangeValue(c, c.before)} → {fmtChangeValue(c, c.after)}
      {c.event && <span className="block text-sm text-muted">After {c.event.text}</span>}
    </IconRow>
  );
}

/** A timeline of genuine shifts, newest first, each beside what happened just before. */
export function ChangesCard({ changes }: { changes: Change[] }) {
  return (
    <section className="border-t border-border pt-5 pb-2 chart-card" aria-label="What changed">
      <h2 className="text-sm font-medium text-muted">What changed</h2>
      {!changes.length ? <p className="text-muted mt-1">Nothing has clearly shifted in the last 3 months.</p> : (
        <ol className="mt-3 relative">
          {changes.map((c, i) => (
            <li key={c.key} className="relative pl-7 pb-4">
              {i < changes.length - 1 && <span aria-hidden="true" className="absolute left-[9px] top-5 bottom-0 w-px bg-border" />}
              <span aria-hidden="true" className="absolute left-0 top-1 w-[19px] h-[19px] rounded-full border-2 border-bg" style={{ background: toneOf(c) }} />
              <p className="text-sm text-muted tnum">{day(c.at)}</p>
              <p className="font-medium tnum">{c.label}: {fmtChangeValue(c, c.before)} → {fmtChangeValue(c, c.after)}</p>
              {c.event ? <p className="text-sm">After {c.event.text} <span className="text-muted tnum">({day(c.event.at)})</span></p> : <p className="text-sm text-muted">No logged change just before</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ── Ask your data ──────────────────────────────────────────────────────────────────────────────────

export function AskBox({ data, now }: { data: AskData; now: number }) {
  const [q, setQ] = useState('');
  const [asked, setAsked] = useState('');
  const suggestions = useMemo(() => askSuggestions(data), [data]);
  const result = useMemo(() => (asked ? ask(asked, data, now) : null), [asked, data, now]);
  const go = (text: string) => { setQ(text); setAsked(text); };
  return (
    <section className="space-y-3" aria-label="Ask your data">
      <form className="flex items-center gap-2 rounded-btn bg-surface-2 pl-3 pr-1" onSubmit={(e) => { e.preventDefault(); if (q.trim()) setAsked(q.trim()); }}>
        <Search size={18} aria-hidden="true" className="text-muted shrink-0" />
        <label className="flex-1"><span className="sr-only">Ask your data</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask, e.g. sleep since 7.5 mg" className="w-full min-h-[48px] bg-transparent outline-none text-base" enterKeyHint="search" /></label>
        {asked && <button type="button" aria-label="Clear" onClick={() => { setQ(''); setAsked(''); }} className="w-10 h-10 flex items-center justify-center text-muted"><X size={18} /></button>}
      </form>
      {!asked && suggestions.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Try asking">
          {suggestions.map((s) => <li key={s}><button type="button" onClick={() => go(s)} className="h-9 px-3.5 rounded-chip border border-border-strong text-sm">{s}</button></li>)}
        </ul>
      )}
      {result && ('error' in result ? (
        <IconRow Icon={CircleHelp} tone="plain">{result.error}</IconRow>
      ) : (
        <div className="rounded-card bg-surface-2 p-3 space-y-3" role="status">
          <p className="text-sm text-muted flex items-center gap-1.5"><Sparkles size={14} aria-hidden="true" />{result.title}</p>
          <p className="text-[17px] font-medium tnum">{result.answer}</p>
          {result.trend && (
            <TrendChart bare height={150} title={result.title} start={result.trend.start} end={result.trend.end} unit={result.unit.startsWith('%') || result.unit === 'of 5' ? undefined : result.unit}
              marks={result.trend.split ? [{ at: result.trend.split, text: 'From here' }] : []}
              series={[{ label: result.title, style: 'dots', points: result.trend.points }, { label: '7-day average', style: 'line', points: rolling(result.trend.points) }]} />
          )}
          {result.bars && (() => {
            const max = Math.max(...result.bars.map((b) => b.value));
            const best = [...result.bars].sort((a, b) => (result.higherBetter === false ? a.value - b.value : b.value - a.value))[0];
            return (
              <ul className="space-y-2">
                {result.bars.map((b) => (
                  <li key={b.label} className="grid grid-cols-[6.5rem_1fr_3.5rem] items-center gap-2 text-sm tnum">
                    <span className="truncate">{b.label}</span>
                    <Bar value={b.value} max={max || 1} tone={result.higherBetter !== undefined && b === best ? 'good' : 'primary'} label={`${b.label}: ${Math.round(b.value * 10) / 10}`} />
                    <span className="text-right">{Math.round(b.value * 10) / 10}{result.unit.startsWith('%') ? '%' : ''}</span>
                  </li>
                ))}
              </ul>
            );
          })()}
        </div>
      ))}
    </section>
  );
}

function rolling(points: { t: number; v: number }[]) {
  return points.map((p) => { const w = points.filter((q) => q.t > p.t - 7 * 86_400_000 && q.t <= p.t); return { t: p.t, v: w.reduce((a, b) => a + b.v, 0) / w.length }; });
}

// ── Step-up checklist (Protocol) ───────────────────────────────────────────────────────────────────

export function StepUpCard({ med, doses, checkIns, body, now, s }: { med: Medication; doses: Dose[]; checkIns: CheckIn[]; body: BodyEntry[]; now: number; s: ScheduleSettings }) {
  const [editing, setEditing] = useState(false);
  const v = stepUpChecklist(med, doses, checkIns, body, now, s);
  if (!v) return null;
  return (
    <div className="mt-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted">Step-up checklist · {v.met} of {v.checks.length}</p>
        <button type="button" className="min-h-[44px] flex items-center gap-1.5 text-sm font-medium" onClick={() => setEditing(true)}><Pencil size={14} aria-hidden="true" />{med.stepUp ? 'Edit' : 'Set yours'}</button>
      </div>
      <ul className="mt-1">
        {v.checks.map((c) => (
          <li key={c.key} className="flex items-center gap-3 min-h-[40px]">
            <span aria-hidden="true" className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
              style={{ background: c.ok ? 'var(--success-soft)' : c.ok === false ? 'var(--surface-2)' : 'var(--surface-2)', color: c.ok ? 'var(--success)' : 'var(--text-muted)' }}>
              {c.ok ? <Check size={14} /> : c.ok === false ? <X size={14} /> : <Minus size={14} />}
            </span>
            <span className="flex-1 text-[15px]">{c.label}</span>
            <span className="text-sm text-muted tnum">{c.value}</span>
            <span className="sr-only">{c.ok ? 'met' : c.ok === false ? 'not yet' : 'not enough data'}</span>
          </li>
        ))}
      </ul>
      {!med.stepUp && <p className="text-xs text-muted">Starting criteria · set your own (or your prescriber's)</p>}
      {editing && <StepUpSheet med={med} onClose={() => setEditing(false)} />}
    </div>
  );
}

function StepUpSheet({ med, onClose }: { med: Medication; onClose: () => void }) {
  const c = med.stepUp ?? DEFAULT_STEP_UP;
  const [f, setF] = useState({ minWeeks: c.minWeeks ?? '', maxEffectPct: c.maxEffectPct ?? '', maxLossKgWeek: c.maxLossKgWeek ?? '', minAppetite: c.minAppetite ?? '', noMissedWeeks: c.noMissedWeeks ?? '' } as Record<keyof StepUpCriteria, string | number>);
  const num = (v: string | number) => (String(v).trim() === '' ? undefined : Number(v));
  const save = async () => {
    const stepUp: StepUpCriteria = { minWeeks: num(f.minWeeks), maxEffectPct: num(f.maxEffectPct), maxLossKgWeek: num(f.maxLossKgWeek), minAppetite: num(f.minAppetite), noMissedWeeks: num(f.noMissedWeeks) };
    await db.medications.update(med.id, { stepUp, updatedAt: new Date().toISOString() });
    onClose();
  };
  const field = (k: keyof StepUpCriteria, label: string) => (
    <TextInput label={label} type="number" inputMode="decimal" min="0" step="any" value={String(f[k])} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
  );
  return (
    <Sheet open onClose={onClose} title="Ready for the next step when">
      <div className="space-y-3">
        <p className="text-sm text-muted">Leave any blank to skip it</p>
        {field('minWeeks', 'Weeks on the dose, at least')}
        {field('maxEffectPct', 'Side effects in at most this % of check-ins')}
        {field('maxLossKgWeek', 'Losing at most this many kg a week')}
        {field('minAppetite', 'Appetite at least (1–5)')}
        {field('noMissedWeeks', 'No missed shots for this many weeks')}
        <SheetActions><Button className="w-full min-h-[56px]" onClick={save}>Save</Button></SheetActions>
      </div>
    </Sheet>
  );
}
