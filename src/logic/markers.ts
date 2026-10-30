// Health markers in one place (Body): the numbers that show health improving, not just the scale. Blood pressure and
// resting heart rate, waist-to-height and BMI (with a height), and lab results matched by name (HbA1c, glucose,
// cholesterol, LDL, HDL, triglycerides), each with its latest value and how it's moved since the first. Pure.
import type { BodyEntry, DailyHealth, LabResult, Vital } from '../db/schema';

const DAY = 86_400_000;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface Marker {
  key: string; label: string;
  /** Shown as is (e.g. "121/78"), with its unit. */
  latest: string; unit?: string; at: number;
  /** Since the first: the earlier value shown, and whether the move is the good way, the wrong way, or neither. */
  first?: string; firstAt?: number; better?: boolean;
  /** Where it stands against the usual healthy line, in a few words. */
  note?: string; tone: 'good' | 'watch' | 'plain';
}

/** Lab names as printed vary: one pattern per marker, and which way is better. */
const LABS: { key: string; label: string; re: RegExp; lowerBetter: boolean; high?: (v: number, unit?: string) => boolean }[] = [
  { key: 'hba1c', label: 'HbA1c', re: /hba1c|a1c|glycated/i, lowerBetter: true, high: (v, u) => (u && /mmol\/mol/i.test(u) ? v >= 48 : v >= 6.5) },
  { key: 'glucose', label: 'Glucose', re: /glucose/i, lowerBetter: true, high: (v, u) => (u && /mg/i.test(u) ? v >= 100 : v >= 5.6) },
  { key: 'ldl', label: 'LDL cholesterol', re: /\bldl\b/i, lowerBetter: true, high: (v, u) => (u && /mg/i.test(u) ? v >= 130 : v >= 3.4) },
  { key: 'hdl', label: 'HDL cholesterol', re: /\bhdl\b/i, lowerBetter: false },
  { key: 'chol', label: 'Total cholesterol', re: /^(total )?cholesterol|chol(esterol)?,? total/i, lowerBetter: true, high: (v, u) => (u && /mg/i.test(u) ? v >= 200 : v >= 5.5) },
  { key: 'trig', label: 'Triglycerides', re: /trig/i, lowerBetter: true, high: (v, u) => (u && /mg/i.test(u) ? v >= 150 : v >= 2) },
];

export function healthMarkers(d: { labs: LabResult[]; vitals: Vital[]; body: BodyEntry[]; daily: DailyHealth[] }, heightCm: number | undefined, now: number): Marker[] {
  const out: Marker[] = [];
  // A move smaller than `same` is noise, not better or worse.
  const better = (first: number, latest: number, lowerBetter: boolean, same = 1e-9) => (Math.abs(latest - first) < same ? undefined : lowerBetter ? latest < first : latest > first);

  // Blood pressure: the last two weeks' average against the first two weeks recorded.
  const bp = d.vitals.filter((v) => !v.deletedAt && v.systolic && v.diastolic).map((v) => ({ t: Date.parse(v.at), s: v.systolic!, d: v.diastolic! })).filter((p) => p.t <= now).sort((a, b) => a.t - b.t);
  if (bp.length) {
    const mean = (xs: typeof bp) => ({ s: Math.round(xs.reduce((a, x) => a + x.s, 0) / xs.length), d: Math.round(xs.reduce((a, x) => a + x.d, 0) / xs.length) });
    const last = mean(bp.filter((p) => p.t > bp[bp.length - 1].t - 14 * DAY));
    const firstW = bp.filter((p) => p.t < bp[0].t + 14 * DAY);
    const first = bp[bp.length - 1].t - bp[0].t > 21 * DAY ? mean(firstW) : undefined;
    const high = last.s >= 140 || last.d >= 90, raised = last.s >= 130 || last.d >= 85;
    out.push({ key: 'bp', label: 'Blood pressure', latest: `${last.s}/${last.d}`, unit: 'mmHg', at: bp[bp.length - 1].t,
      first: first ? `${first.s}/${first.d}` : undefined, firstAt: first ? bp[0].t : undefined, better: first ? better(first.s + first.d, last.s + last.d, true, 5) : undefined,
      note: high ? 'High: worth raising with your doctor' : raised ? 'A little high' : 'In the usual range', tone: high ? 'watch' : raised ? 'plain' : 'good' });
  }

  // Resting heart rate: the same, from the watch or readings.
  const hr = d.daily.filter((x) => !x.deletedAt && x.restingHr).map((x) => ({ t: new Date(`${x.date}T12:00`).getTime(), v: x.restingHr! })).filter((p) => p.t <= now).sort((a, b) => a.t - b.t);
  if (hr.length >= 3) {
    const mean = (xs: typeof hr) => Math.round(xs.reduce((a, x) => a + x.v, 0) / xs.length);
    const last = mean(hr.filter((p) => p.t > hr[hr.length - 1].t - 14 * DAY));
    const first = hr[hr.length - 1].t - hr[0].t > 21 * DAY ? mean(hr.filter((p) => p.t < hr[0].t + 14 * DAY)) : undefined;
    out.push({ key: 'rhr', label: 'Resting heart rate', latest: String(last), unit: 'bpm', at: hr[hr.length - 1].t, first: first !== undefined ? String(first) : undefined, firstAt: first !== undefined ? hr[0].t : undefined,
      better: first !== undefined ? better(first, last, true, 2) : undefined, tone: 'plain' });
  }

  // With a height: waist-to-height (under 0.5 is the usual healthy line) and BMI.
  if (heightCm && heightCm > 0) {
    const waists = d.body.filter((b) => !b.deletedAt && b.waistCm).sort((a, b) => a.date.localeCompare(b.date));
    if (waists.length) {
      const l = waists[waists.length - 1], f = waists[0];
      const lv = r2(l.waistCm! / heightCm), fv = r2(f.waistCm! / heightCm);
      out.push({ key: 'whtr', label: 'Waist-to-height', latest: lv.toFixed(2), at: new Date(`${l.date}T12:00`).getTime(),
        first: waists.length > 1 ? fv.toFixed(2) : undefined, firstAt: waists.length > 1 ? new Date(`${f.date}T12:00`).getTime() : undefined, better: waists.length > 1 ? better(fv, lv, true) : undefined,
        note: lv < 0.5 ? 'Under 0.5: the healthy range' : lv < 0.6 ? `${(0.5 * heightCm).toFixed(0)} cm waist is 0.5` : `Over 0.6; ${(0.5 * heightCm).toFixed(0)} cm waist is 0.5`, tone: lv < 0.5 ? 'good' : lv < 0.6 ? 'plain' : 'watch' });
    }
    const weights = d.body.filter((b) => !b.deletedAt && b.weightKg).sort((a, b) => a.date.localeCompare(b.date));
    if (weights.length) {
      const m = heightCm / 100;
      const l = weights[weights.length - 1], f = weights[0];
      const lv = r1(l.weightKg! / (m * m)), fv = r1(f.weightKg! / (m * m));
      out.push({ key: 'bmi', label: 'BMI', latest: lv.toFixed(1), at: new Date(`${l.date}T12:00`).getTime(),
        first: weights.length > 1 ? fv.toFixed(1) : undefined, firstAt: weights.length > 1 ? new Date(`${f.date}T12:00`).getTime() : undefined, better: weights.length > 1 ? better(fv, lv, true) : undefined,
        note: lv < 25 ? 'Under 25' : lv < 30 ? '25 to 30' : lv < 35 ? '30 to 35' : '35 or more', tone: 'plain' });
    }
  }

  // Lab results, matched by name.
  const labs = d.labs.filter((l) => !l.deletedAt && Number.isFinite(l.value)).sort((a, b) => a.date.localeCompare(b.date));
  for (const def of LABS) {
    const xs = labs.filter((l) => def.re.test(l.name) && !(def.key === 'chol' && /\b(ldl|hdl)\b/i.test(l.name)));
    if (!xs.length) continue;
    const l = xs[xs.length - 1], f = xs[0];
    const high = def.high?.(l.value, l.unit);
    out.push({ key: def.key, label: def.label, latest: String(l.value), unit: l.unit, at: new Date(`${l.date}T12:00`).getTime(),
      first: xs.length > 1 ? String(f.value) : undefined, firstAt: xs.length > 1 ? new Date(`${f.date}T12:00`).getTime() : undefined,
      better: xs.length > 1 ? better(f.value, l.value, def.lowerBetter) : undefined,
      note: l.range ? `Range ${l.range}` : undefined, tone: high ? 'watch' : 'plain' });
  }
  return out;
}
