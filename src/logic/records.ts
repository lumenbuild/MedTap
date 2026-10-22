// Smaller helpers for both apps: when a new script is needed, check-in chips from a typed note, records that look odd,
// and reading a vial label or a lab printout from on-device OCR text. Pure; nothing leaves the phone.
import type { BodyEntry, CheckIn, Dose, Medication, Vital } from '../db/schema';
import { forecastRunOut } from './plans';
import { seriesOf, smoothTrend } from './forecast';
import type { ScheduleSettings } from './schedule';
import { cleanOcr } from './label';

const DAY = 86_400_000;

// ── Scripts ─────────────────────────────────────────────────────────────────────────────────────────

export interface ScriptPlan {
  /** When the stock on hand plus the repeats left (at the last refill's size) runs out, or the script expires if sooner. */
  needBy: number | null;
  reason: 'repeats' | 'expiry';
  /** Two weeks before, to book the doctor in time. */
  bookBy: number | null;
  repeatsLeft: number;
  lastRepeat: boolean;
}

/** When a new script will be needed, from the plan (or recent use), the stock, the repeats left and the expiry. Needs the
 *  repeats left and either a pack size (from the last refill) or an expiry date. */
export function scriptPlan(med: Medication, doses: Dose[], now: number, s: ScheduleSettings): ScriptPlan | null {
  if (med.archived || med.repeatsLeft === undefined) return null;
  const expiry = med.scriptExpiry ? Date.parse(`${med.scriptExpiry}T23:59:59`) : undefined;
  let runOut: number | null | undefined;
  if (med.packSize && med.stockCount !== undefined) {
    const f = forecastRunOut({ ...med, stockCount: med.stockCount + med.repeatsLeft * med.packSize }, doses, now, s, 3 * 366);
    runOut = f ? f.runOutAt : undefined;
  }
  if (runOut === undefined && expiry === undefined) return null;
  const byExpiry = expiry !== undefined && (runOut == null || expiry < runOut);
  const needBy = byExpiry ? expiry! : (runOut ?? null);
  return { needBy, reason: byExpiry ? 'expiry' : 'repeats', bookBy: needBy !== null ? needBy - 14 * DAY : null, repeatsLeft: med.repeatsLeft, lastRepeat: med.repeatsLeft <= 1 };
}

// ── Notes into chips ────────────────────────────────────────────────────────────────────────────────

const NOTE_WORDS: [RegExp, string][] = [
  [/\b(queasy|nause\w*|sick to my stomach|felt sick|feeling sick|vomit\w*|threw up)\b/i, 'Nausea'],
  [/\b(head ?aches?|migraine)\b/i, 'Headache'],
  [/\b(slept (badly|poorly)|couldn'?t sleep|can'?t sleep|insomnia|awake (all|half) (the )?night|bad sleep|poor sleep|trouble sleeping)\b/i, 'Trouble sleeping'],
  [/\b(jittery|jitters|shaky|wired|on edge)\b/i, 'Jittery'],
  [/\b(irritable|snappy|cranky|short[- ]tempered|grumpy|agitated)\b/i, 'Irritable'],
  [/\b(dry mouth|mouth (is |was )?dry|thirsty)\b/i, 'Dry mouth'],
  [/\b(not hungry|no appetite|low appetite|forgot to eat|skipped (lunch|breakfast|dinner)|couldn'?t eat)\b/i, 'Low appetite'],
  [/\b(wore off|wearing off|wears off|crash(ed|ing)?|comedown)\b/i, 'Wearing off'],
  [/\b(calm|relaxed|settled)\b/i, 'Calm'],
  [/\b(focused|productive|in the zone|got (a lot|heaps|lots) done)\b/i, 'Focused'],
  [/\b(reflux|heartburn|indigestion)\b/i, 'Reflux'],
  [/\b(constipat\w*|blocked up)\b/i, 'Constipation'],
  [/\b(diarrh?o?ea|loose (stools?|bowels?)|the runs)\b/i, 'Diarrhoea'],
  [/\b(tired|exhausted|fatigued?|wiped out|drained|sleepy)\b/i, 'Tired'],
  [/\b(sore|red|itchy|lump|bruis\w*) (at |near |around )?(the )?(injection|jab|shot) site\b|\b(injection|jab|shot) site\b/i, 'Injection site reaction'],
];

/** Chips a note mentions, from the chips the person uses, that aren't already ticked. "Not queasy" doesn't count. */
export function chipsFromNote(note: string, available: string[], ticked: string[]): string[] {
  const out: string[] = [];
  for (const [re, chip] of NOTE_WORDS) {
    if (!available.includes(chip) || ticked.includes(chip) || out.includes(chip)) continue;
    const m = re.exec(note);
    if (!m) continue;
    const before = note.slice(Math.max(0, m.index - 12), m.index).toLowerCase();
    if (/\b(not|no|never|wasn'?t|isn'?t|didn'?t|without)\s+(\w+\s+)?$/.test(before)) continue;
    out.push(chip);
  }
  // Also any of the person's own chips named outright.
  for (const chip of available) {
    if (ticked.includes(chip) || out.includes(chip)) continue;
    if (new RegExp(`\\b${chip.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(note)) out.push(chip);
  }
  return out;
}

// ── Records that look odd ───────────────────────────────────────────────────────────────────────────

export interface OddRecord {
  id: string; // stable, for "it's fine"
  kind: 'double-dose' | 'weight-off-trend' | 'future';
  title: string; detail: string;
  /** The record(s) involved, so the sheet can offer to delete one. */
  dose?: Dose; other?: Dose; body?: BodyEntry; checkIn?: CheckIn; vital?: Vital;
}

/** Likely mistakes: the same medication logged twice within 10 minutes (e.g. on two synced phones), a weight far from
 *  the trend, and records dated in the future. */
export function oddRecords(meds: Medication[], doses: Dose[], body: BodyEntry[], checkIns: CheckIn[], vitals: Vital[], now: number, dismissed: string[] = []): OddRecord[] {
  const out: OddRecord[] = [];
  const name = new Map(meds.map((m) => [m.id, m.name]));
  const live = doses.filter((d) => !d.deletedAt && !d.skipped).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  for (let i = 1; i < live.length; i++) {
    for (let j = i - 1; j >= 0 && Date.parse(live[i].takenAt) - Date.parse(live[j].takenAt) <= 10 * 60_000; j--) {
      const a = live[j], b = live[i];
      if (a.medicationId !== b.medicationId || (a.personId ?? '') !== (b.personId ?? '')) continue;
      const med = meds.find((m) => m.id === a.medicationId);
      if (med?.schedule.type === 'prn' && med.schedule.minHoursApart === undefined && (med.schedule.maxPer24h ?? 2) > 1 && a.source === 'manual' && b.source === 'manual') continue;
      out.push({ id: `double:${a.id}:${b.id}`, kind: 'double-dose', title: `${name.get(a.medicationId) ?? 'A medication'} logged twice`, detail: `${Math.round((Date.parse(b.takenAt) - Date.parse(a.takenAt)) / 60_000)} minutes apart. If it was taken once, delete one.`, dose: b, other: a });
    }
  }
  const pts = seriesOf(body.filter((b) => !b.deletedAt), 'weightKg');
  if (pts.length >= 6) {
    const trend = smoothTrend(pts);
    const resid = pts.map((p, i) => Math.abs(p.v - trend[i].v));
    const sorted = [...resid].sort((a, b) => a - b);
    const mad = sorted[sorted.length >> 1] || 0.3;
    for (const e of body.filter((b) => !b.deletedAt && typeof b.weightKg === 'number')) {
      const t = Date.parse(`${e.date}T12:00`);
      const near = pts.filter((p) => Math.abs(p.t - t) <= 14 * DAY && p.t !== t);
      if (near.length < 3) continue;
      const mid = [...near.map((p) => p.v)].sort((a, b) => a - b)[near.length >> 1];
      const off = e.weightKg! - mid;
      if (Math.abs(off) > Math.max(3, 6 * mad)) out.push({ id: `weight:${e.id}`, kind: 'weight-off-trend', title: `Weight on ${e.date} looks off`, detail: `${e.weightKg} kg, about ${Math.abs(Math.round(off * 10) / 10)} kg ${off > 0 ? 'above' : 'below'} the weigh-ins around it. A typo, or other units?`, body: e });
    }
  }
  const soon = now + 10 * 60_000;
  for (const d of doses) if (!d.deletedAt && Date.parse(d.takenAt) > soon) out.push({ id: `future:${d.id}`, kind: 'future', title: `${name.get(d.medicationId) ?? 'A dose'} dated in the future`, detail: new Date(d.takenAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }), dose: d });
  for (const c of checkIns) if (!c.deletedAt && Date.parse(c.at) > soon) out.push({ id: `future:${c.id}`, kind: 'future', title: 'A check-in dated in the future', detail: new Date(c.at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }), checkIn: c });
  for (const v of vitals) if (!v.deletedAt && Date.parse(v.at) > soon) out.push({ id: `future:${v.id}`, kind: 'future', title: 'A blood pressure reading dated in the future', detail: new Date(v.at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }), vital: v });
  return out.filter((o) => !dismissed.includes(o.id));
}

// ── Reading a vial label ────────────────────────────────────────────────────────────────────────────

export interface VialLabel { amount?: number; unit?: string; lot?: string; expiry?: string }

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** An expiry date in any of the usual label forms; month-only dates mean the end of that month. */
export function parseExpiry(text: string): string | undefined {
  const t = text.replace(/[,]/g, ' ');
  let m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/.exec(t);
  if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return `${y}-${pad(+m[2])}-${pad(+m[1])}`; }
  m = /\b(\d{1,2})\s+([a-z]{3,4})[a-z]*\.?\s+(\d{2,4})\b/i.exec(t);
  if (m && MONTHS[m[2].toLowerCase()]) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return `${y}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(+m[1])}`; }
  m = /\b([a-z]{3,4})[a-z]*\.?\s+(\d{4})\b/i.exec(t);
  if (m && MONTHS[m[1].toLowerCase()]) { const mo = MONTHS[m[1].toLowerCase()]; return `${m[2]}-${pad(mo)}-${pad(lastDay(+m[2], mo))}`; }
  m = /\b(\d{1,2})[-/.](\d{4})\b/.exec(t);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${pad(+m[1])}-${pad(lastDay(+m[2], +m[1]))}`;
  m = /\b(\d{1,2})[-/](\d{2})\b/.exec(t);
  if (m && +m[1] >= 1 && +m[1] <= 12) { const y = 2000 + +m[2]; return `${y}-${pad(+m[1])}-${pad(lastDay(y, +m[1]))}`; }
  return undefined;
}

/** Lot, expiry and amount from the text of a vial or pen label. The person checks them before saving. */
export function parseVialLabel(raw: string): VialLabel {
  const text = cleanOcr(raw);
  const out: VialLabel = {};
  const lot = /\b(?:lot|batch|lot no\.?|lot number|batch no\.?|lot#|lot\s*:)\s*[:#.]?\s*([A-Z0-9][A-Z0-9-]{2,})/i.exec(text);
  if (lot) out.lot = lot[1].toUpperCase();
  const expLine = text.split('\n').find((l) => /\b(exp|expiry|expires|use by|best before|exp\.? date)\b/i.test(l));
  out.expiry = expLine ? parseExpiry(expLine.replace(/^.*?\b(exp\w*|use by|best before)\b\.?\s*(date)?\s*[:.]?/i, '')) ?? parseExpiry(expLine) : undefined;
  const amt = /(\d+(?:\.\d+)?)\s*(mg|mcg|µg|ug|iu|units?)\b(?!\s*\/\s*(ml|kg))/i.exec(text);
  if (amt) { out.amount = Number(amt[1]); out.unit = /µg|ug/i.test(amt[2]) ? 'mcg' : /iu|unit/i.test(amt[2]) ? 'units' : amt[2].toLowerCase(); }
  return out;
}

// ── Reading a lab printout ──────────────────────────────────────────────────────────────────────────

export interface LabLine { name: string; value: number; unit?: string; range?: string; flag?: 'H' | 'L' }

const LAB_UNITS = String.raw`(mmol\/L|umol\/L|µmol\/L|nmol\/L|pmol\/L|mmol\/mol|g\/L|mg\/L|mg\/dL|g\/dL|U\/L|IU\/L|mU\/L|mIU\/L|x10\^?\d+\/L|×10\^?\d+\/L|10\^\d+\/L|fL|pg|%|ng\/mL|ng\/L|ug\/L|µg\/L|mL\/min(?:\/1\.73m2)?|mm\/h|ratio)`;
const LINE = new RegExp(String.raw`^\s*([A-Za-z][A-Za-z0-9 ()\-,.'/+]{1,40}?)\s*[:.]?\s+([<>]?\d+(?:\.\d+)?)\s*([HL])?\s*` + LAB_UNITS + String.raw`?\s*(?:\(?\s*(\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?|[<>]\s*\d+(?:\.\d+)?)\s*\)?)?\s*([HL])?\s*$`, 'i');
const NOT_TESTS = /\b(page|date|collected|received|reported|dob|birth|phone|tel|fax|ref|lab no|patient|doctor|dr\b|address|medicare|provider|specimen|time)\b/i;

/** OCR slips in common test names (l/I for 1, O for 0). */
const fixTestName = (n: string) => n
  .replace(/\bHbA[lI|]c\b/i, 'HbA1c').replace(/\bB[lI|]2\b/, 'B12').replace(/\bT[lI|]\b/, 'T1').replace(/\bVitamin D[lI|]\b/i, 'Vitamin D');

/** Test results from the text of a pathology printout: name, value, unit and reference range on one line. */
export function parseLabResults(raw: string): { date?: string; results: LabLine[] } {
  const text = cleanOcr(raw);
  const results: LabLine[] = [];
  for (const line of text.split('\n')) {
    if (NOT_TESTS.test(line)) continue;
    const m = LINE.exec(line);
    if (!m) continue;
    const name = fixTestName(m[1].replace(/\s+/g, ' ').trim());
    if (name.length < 2 || /^\d/.test(name)) continue;
    if (!m[4] && !m[5]) continue; // a unit or a range, or it's not a result line
    results.push({ name, value: Number(m[2].replace(/[<>]/, '')), unit: m[4] || undefined, range: m[5]?.replace(/\s+/g, '').replace('-', '–') || undefined, flag: (m[3] || m[6])?.toUpperCase() as 'H' | 'L' | undefined });
  }
  const dateLine = text.split('\n').find((l) => /\b(collected|collection|date of (test|collection)|sample (date|taken))\b/i.test(l));
  return { date: dateLine ? parseExpiry(dateLine) : undefined, results };
}
