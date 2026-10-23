// "What changed?": for each daily signal (resting heart rate, HRV, sleep, steps, mood, focus, appetite, side effects),
// the moment it genuinely shifted in the last three months (a robust before/after test that must still hold this
// week), next to what happened just before it: a dose change, a new medicine, a new batch, missed doses. Pure.
import type { CheckIn, DailyHealth, Dose, MedEvent, Medication } from '../db/schema';
import { EFFECT_CHIPS } from './predict';
import { vialsOf } from './peptide';
import { shownName } from './privacy';

const DAY = 86_400_000;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export type SignalKey = 'restingHr' | 'hrv' | 'sleep' | 'steps' | 'mood' | 'focus' | 'appetite' | 'effects';
interface Signal { key: SignalKey; label: string; unit: string; min: number; dp: number; upGood?: boolean }
export const SIGNALS: Signal[] = [
  { key: 'restingHr', label: 'Resting heart rate', unit: 'bpm', min: 4, dp: 0, upGood: false },
  { key: 'hrv', label: 'HRV', unit: 'ms', min: 8, dp: 0, upGood: true },
  { key: 'sleep', label: 'Sleep', unit: 'h', min: 0.5, dp: 1, upGood: true },
  { key: 'steps', label: 'Steps', unit: '', min: 1500, dp: 0, upGood: true },
  { key: 'mood', label: 'Mood', unit: '', min: 0.5, dp: 1, upGood: true },
  { key: 'focus', label: 'Focus', unit: '', min: 0.5, dp: 1, upGood: true },
  { key: 'appetite', label: 'Appetite', unit: '', min: 0.5, dp: 1 },
  { key: 'effects', label: 'Side effects', unit: '%', min: 20, dp: 0, upGood: false },
];

export interface ChangeEvent { at: number; text: string }
export interface Change { key: SignalKey; label: string; at: number; before: number; after: number; unit: string; dp: number; good?: boolean; event?: ChangeEvent; z: number }

export interface ChangeData { meds: Medication[]; doses: Dose[]; checkIns: CheckIn[]; daily: DailyHealth[]; events: MedEvent[] }

const dayMs = (ymd: string) => new Date(`${ymd}T12:00`).getTime();

/** One value per day for each signal. */
export function dailySignals(d: ChangeData, now: number): Record<SignalKey, { t: number; v: number }[]> {
  const out = Object.fromEntries(SIGNALS.map((s) => [s.key, [] as { t: number; v: number }[]])) as Record<SignalKey, { t: number; v: number }[]>;
  const from = now - 100 * DAY;
  for (const r of d.daily) {
    if (r.deletedAt) continue;
    const t = dayMs(r.date);
    if (t < from || t > now) continue;
    if (r.restingHr) out.restingHr.push({ t, v: r.restingHr });
    if (r.hrvMs) out.hrv.push({ t, v: r.hrvMs });
    if (r.sleepMin) out.sleep.push({ t, v: r.sleepMin / 60 });
    if (r.steps) out.steps.push({ t, v: r.steps });
  }
  // Check-ins: daily averages (and side effects as a share of the day's check-ins).
  const byDay = new Map<number, CheckIn[]>();
  for (const c of d.checkIns) {
    if (c.deletedAt) continue;
    const t0 = new Date(c.at); t0.setHours(12, 0, 0, 0);
    const t = t0.getTime();
    if (t < from || t > now) continue;
    byDay.set(t, [...(byDay.get(t) ?? []), c]);
  }
  const sleepDays = new Set(out.sleep.map((p) => p.t));
  for (const [t, cs] of byDay) {
    for (const f of ['mood', 'focus', 'appetite'] as const) {
      const xs = cs.map((c) => c[f]).filter((v): v is number => typeof v === 'number');
      if (xs.length) out[f].push({ t, v: xs.reduce((a, b) => a + b, 0) / xs.length });
    }
    out.effects.push({ t, v: (cs.filter((c) => c.chips.some((ch) => EFFECT_CHIPS.includes(ch))).length / cs.length) * 100 });
    const sh = cs.map((c) => c.sleepHours).filter((v): v is number => typeof v === 'number');
    if (sh.length && !sleepDays.has(t)) out.sleep.push({ t, v: sh[0] });
  }
  for (const k of Object.keys(out) as SignalKey[]) out[k].sort((a, b) => a.t - b.t);
  return out;
}

/** Things that happened that could explain a change. */
export function changeEvents(d: ChangeData): ChangeEvent[] {
  const name = (id: string) => { const m = d.meds.find((x) => x.id === id); return m ? shownName(m) : 'A medicine'; };
  const out: ChangeEvent[] = d.events.map((e) => ({ at: Date.parse(e.at),
    text: e.kind === 'changed' ? `${name(e.medicationId)}: ${e.summary}` : `${e.kind === 'stopped' ? 'Stopped' : 'Started'} ${name(e.medicationId)}` }));
  for (const m of d.meds) {
    // New batch, and a step to a new dose amount.
    let lastLot: string | undefined;
    for (const v of vialsOf(m).filter((x) => x.startedAt).sort((a, b) => a.startedAt!.localeCompare(b.startedAt!))) {
      if (v.lot && lastLot && v.lot !== lastLot) out.push({ at: Date.parse(v.startedAt!), text: `New batch of ${shownName(m)} (${v.lot})` });
      if (v.lot) lastLot = v.lot;
    }
    const taken = d.doses.filter((x) => x.medicationId === m.id && !x.deletedAt && !x.skipped).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
    for (let i = 1; i < taken.length; i++) {
      if (taken[i].amount !== taken[i - 1].amount && !out.some((e) => Math.abs(e.at - Date.parse(taken[i].takenAt)) < 3 * DAY && e.text.startsWith(name(m.id))))
        out.push({ at: Date.parse(taken[i].takenAt), text: `${name(m.id)}: ${taken[i - 1].amount} → ${taken[i].amount} ${m.unit}` });
    }
    // Two or more skipped in a row.
    const all = d.doses.filter((x) => x.medicationId === m.id && !x.deletedAt).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
    for (let i = 1; i < all.length; i++) if (all[i].skipped && all[i - 1].skipped) out.push({ at: Date.parse(all[i - 1].takenAt), text: `${name(m.id)} skipped` });
  }
  return out.sort((a, b) => a.at - b.at);
}

export function whatChanged(d: ChangeData, now: number): Change[] {
  const series = dailySignals(d, now);
  const events = changeEvents(d);
  const out: Change[] = [];
  for (const sig of SIGNALS) {
    const pts = series[sig.key];
    if (pts.length < 14) continue;
    let best: { at: number; z: number; before: number; after: number } | undefined;
    for (let at = now - 75 * DAY; at <= now - 7 * DAY; at += DAY) {
      const b = pts.filter((p) => p.t >= at - 28 * DAY && p.t < at).map((p) => p.v);
      const a = pts.filter((p) => p.t >= at && p.t < at + 21 * DAY).map((p) => p.v);
      if (b.length < 7 || a.length < 5) continue;
      // Medians give the levels (robust to odd days); means place the change (they peak where the split is cleanest).
      const mb = median(b), ma = median(a);
      const avg = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / xs.length;
      const resid = [...b.map((v) => v - mb), ...a.map((v) => v - ma)].map(Math.abs);
      const scale = Math.max(1.4826 * median(resid), sig.min / 4);
      const z = (avg(a) - avg(b)) / (scale * Math.sqrt(1 / b.length + 1 / a.length));
      if (Math.abs(ma - mb) >= sig.min && Math.abs(z) >= 3 && (!best || Math.abs(z) > Math.abs(best.z))) best = { at, z, before: mb, after: ma };
    }
    if (!best) continue;
    // Still holding this week (at least half the shift, same way).
    const last = pts.filter((p) => p.t > now - 7 * DAY).map((p) => p.v);
    if (last.length < 3 || (median(last) - best.before) * Math.sign(best.after - best.before) < Math.abs(best.after - best.before) / 2) continue;
    const ev = [...events].reverse().find((e) => e.at <= best!.at + 2 * DAY && e.at >= best!.at - 10 * DAY);
    const up = best.after > best.before;
    out.push({ key: sig.key, label: sig.label, at: best.at, before: best.before, after: best.after, unit: sig.unit, dp: sig.dp, z: best.z,
      good: sig.upGood === undefined ? undefined : up === sig.upGood, event: ev });
  }
  return out.sort((a, b) => b.at - a.at);
}

export const fmtChangeValue = (c: Pick<Change, 'unit' | 'dp'>, v: number) =>
  `${c.unit === '' && v >= 1000 ? Math.round(v).toLocaleString('en-AU') : (Math.round(v * 10 ** c.dp) / 10 ** c.dp).toString()}${c.unit && c.unit !== '%' ? ` ${c.unit}` : c.unit}`;
