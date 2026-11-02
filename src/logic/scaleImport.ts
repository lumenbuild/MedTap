// A smart scale's full reading, beyond the six things Health Connect carries (weight, body fat, lean mass, bone,
// body water and BMR): the scale app's export (Renpho's CSV: every weigh-in ever, all 13 measures) and a screenshot
// of its result screen (read on the phone). Both become one reading per day (the morning's), filling only what that
// day doesn't already have. Pure.
import type { BodyEntry } from '../db/schema';

export type ScaleField = 'weightKg' | 'bodyFatPct' | 'leanKg' | 'subcutFatPct' | 'visceralFat' | 'waterPct' | 'skeletalMusclePct' | 'muscleKg' | 'boneKg'
  | 'proteinPct' | 'bmrKcal' | 'metabolicAge';
export interface ScaleReading { date: string; t?: number; values: Partial<Record<ScaleField, number>> }

/** How each measure is named in exports and on result screens, and its sensible range (to drop misreads). */
const FIELDS: { key: ScaleField; re: RegExp; min: number; max: number; mass?: boolean }[] = [
  { key: 'leanKg', re: /fat[\s-]*free\s*(body\s*)?(weight|mass)|lean\s*(body\s*)?mass/i, min: 15, max: 150, mass: true },
  { key: 'subcutFatPct', re: /subcutaneous\s*fat/i, min: 2, max: 70 },
  { key: 'visceralFat', re: /visceral\s*fat/i, min: 1, max: 59 },
  { key: 'bodyFatPct', re: /body\s*fat(?!\s*free)|^fat\s*(%|\(%\))/i, min: 2, max: 75 },
  { key: 'waterPct', re: /body\s*water|^water/i, min: 20, max: 80 },
  { key: 'skeletalMusclePct', re: /skeletal\s*muscle/i, min: 10, max: 70 },
  { key: 'muscleKg', re: /muscle\s*mass/i, min: 10, max: 150, mass: true },
  { key: 'boneKg', re: /bone\s*mass|^bone/i, min: 0.5, max: 8, mass: true },
  { key: 'proteinPct', re: /protein/i, min: 3, max: 40 },
  { key: 'bmrKcal', re: /\bbmr\b|basal\s*metabolic/i, min: 600, max: 5000 },
  { key: 'metabolicAge', re: /metabolic\s*age|body\s*age/i, min: 10, max: 99 },
  { key: 'weightKg', re: /^weight|\bweight\b(?!.*free)/i, min: 20, max: 350, mass: true },
];

const LB = 0.45359237;
const r1 = (v: number) => Math.round(v * 10) / 10;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Split one CSV line, minding quotes. */
function cells(line: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if ((c === ',' || c === ';' || c === '\t') && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

/** Dates as exports write them: 2026.03.14 07:31:22, 2026-03-14 07:31, 14/03/2026 7:31 am, 03/14/2026, Mar 14, 2026. */
function parseWhen(s: string, order: 'dmy' | 'mdy'): Date | null {
  const t = s.replace(/[,]/g, ' ').replace(/\s+/g, ' ').trim();
  const time = t.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
  let h = time ? Number(time[1]) : 12; const mi = time ? Number(time[2]) : 0;
  if (time?.[4]) { const pm = /pm/i.test(time[4]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  let m = t.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h, mi);
  m = t.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) {
    const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    const [d, mo] = order === 'dmy' ? [Number(m[1]), Number(m[2])] : [Number(m[2]), Number(m[1])];
    return new Date(y, mo - 1, d, h, mi);
  }
  const p = Date.parse(t);
  return Number.isFinite(p) ? new Date(p) : null;
}

function inRange(key: ScaleField, v: number): boolean { const f = FIELDS.find((x) => x.key === key)!; return v >= f.min && v <= f.max; }

/** A scale app's CSV export: each row a weigh-in. Columns are matched by name, so other scales' exports work too. */
export function parseScaleCsv(text: string): ScaleReading[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const hi = lines.findIndex((l) => /weight/i.test(l) && /(time|date)/i.test(l));
  if (hi < 0) return [];
  const head = cells(lines[hi]);
  const timeCol = head.findIndex((h) => /time|date/i.test(h));
  const cols = head.map((h) => {
    const f = FIELDS.find((x) => x.re.test(h.replace(/\(.*?\)/g, (m) => m).trim()));
    return f ? { key: f.key, lb: /\blbs?\b/i.test(h), mass: !!f.mass } : null;
  });
  const rows = lines.slice(hi + 1).map(cells);
  // Day-month or month-day: whichever the export's own dates make clear (Australia's day first if none do).
  let order: 'dmy' | 'mdy' = 'dmy';
  for (const r of rows) { const m = r[timeCol]?.match(/^(\d{1,2})[./-](\d{1,2})[./-]\d{2,4}/); if (m) { if (Number(m[2]) > 12) { order = 'mdy'; break; } if (Number(m[1]) > 12) break; } }
  const out: ScaleReading[] = [];
  for (const r of rows) {
    const when = r[timeCol] ? parseWhen(r[timeCol], order) : null;
    if (!when) continue;
    const values: ScaleReading['values'] = {};
    cols.forEach((c, i) => {
      if (!c || i === timeCol) return;
      const n = Number(String(r[i] ?? '').replace(/[^\d.,-]/g, '').replace(',', '.'));
      if (!r[i] || !Number.isFinite(n) || n === 0) return;
      const v = c.mass && c.lb ? n * LB : n;
      if (inRange(c.key, v)) values[c.key] = c.key === 'bmrKcal' || c.key === 'metabolicAge' || c.key === 'visceralFat' ? Math.round(v) : r1(v);
    });
    if (values.weightKg !== undefined) out.push({ date: ymd(when), t: when.getTime(), values });
  }
  return out;
}

/** The text of a scale app's result screen (read from a screenshot): each measure's name, then its number. */
export function parseScaleScreen(text: string, today: string): ScaleReading | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const values: ScaleReading['values'] = {};
  const lb = /\blbs?\b/i.test(text) && !/\bkg\b/i.test(text);
  for (let i = 0; i < lines.length; i++) {
    // Most specific name first (fat-free before body fat, visceral before fat, muscle mass before muscle).
    const f = FIELDS.find((x) => x.re.test(lines[i]));
    if (!f || values[f.key] !== undefined) continue;
    // The number on the same line after the name, else on the next line or two.
    const after = lines[i].replace(f.re, ' ');
    const pick = [after, lines[i + 1] ?? '', lines[i + 2] ?? ''].map((l) => l.match(/(\d+(?:[.,]\d+)?)/)?.[1]).find((x) => x !== undefined);
    if (!pick) continue;
    let v = Number(pick.replace(',', '.'));
    if (f.mass && lb) v *= LB;
    if (inRange(f.key, v)) values[f.key] = f.key === 'bmrKcal' || f.key === 'metabolicAge' || f.key === 'visceralFat' ? Math.round(v) : r1(v);
  }
  const date = text.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  const d = date ? `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}` : today;
  return Object.keys(values).length >= 3 ? { date: d, values } : null;
}

/** One reading a day (the earliest: the morning weigh-in), each field only where the day's entry doesn't have it.
 *  A weight is added only to a day with none. */
export function planScaleImport(readings: ScaleReading[], existing: BodyEntry[], personId: string | undefined): { date: string; fields: Partial<BodyEntry> }[] {
  const mine = existing.filter((b) => !b.deletedAt && (b.personId ?? undefined) === personId);
  const byDay = new Map<string, ScaleReading>();
  for (const r of readings) { const o = byDay.get(r.date); if (!o || (r.t ?? 0) < (o.t ?? 0)) byDay.set(r.date, r); }
  const out: { date: string; fields: Partial<BodyEntry> }[] = [];
  for (const [date, r] of [...byDay].sort((a, b) => a[0].localeCompare(b[0]))) {
    const e = mine.find((b) => b.date === date);
    const fields: Partial<BodyEntry> = {};
    for (const [k, v] of Object.entries(r.values) as [ScaleField, number][]) if (e?.[k] === undefined) (fields as Record<string, number>)[k] = v;
    if (Object.keys(fields).length) out.push({ date, fields: { ...fields, ...(e?.compSource ? {} : { compSource: 'scale' }), ...(fields.weightKg !== undefined && !e?.note ? { note: 'From scale' } : {}) } });
  }
  return out;
}

export const SCALE_LABEL: Record<ScaleField, string> = {
  weightKg: 'Weight', bodyFatPct: 'Body fat', leanKg: 'Fat-free mass', subcutFatPct: 'Subcutaneous fat', visceralFat: 'Visceral fat', waterPct: 'Body water',
  skeletalMusclePct: 'Skeletal muscle', muscleKg: 'Muscle mass', boneKg: 'Bone mass', proteinPct: 'Protein', bmrKcal: 'BMR', metabolicAge: 'Metabolic age',
};
