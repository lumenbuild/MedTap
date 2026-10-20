// Reads the text of a pharmacy dispensing label (from on-device OCR) into medication details.
// It only copies what the label says; the person checks everything before saving.

export type LabelUnit = 'mg' | 'mcg' | 'mL' | 'units';
export type LabelForm = 'tablet' | 'capsule' | 'liquid' | 'patch' | 'injection';

export type LabelSchedule =
  | { type: 'fixed'; slots: { time: string; count?: number }[]; days?: number[]; everyNDays?: number }
  | { type: 'interval'; hours: number }
  | { type: 'prn'; maxDoses?: number; maxCount?: number; minHoursApart?: number };

export interface LabelDetails {
  name?: string;
  strength?: number;
  unit?: LabelUnit;
  form?: LabelForm;
  /** The directions, as written ("Take one tablet twice a day with food"). */
  directions?: string;
  /** How many tablets/capsules (or mL, units, puffs) per dose. */
  count?: number;
  schedule?: LabelSchedule;
  quantity?: number;
  repeats?: number;
  prescriber?: string;
  /** Bottle expiry, YYYY-MM-DD. */
  expiry?: string;
}

const NUM_WORDS: Record<string, number> = {
  half: 0.5, 'a half': 0.5, '½': 0.5, '1/2': 0.5, one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, twelve: 12,
};
const NUM = String.raw`(\d+(?:\.\d+)?|half|a half|½|1/2|one|two|three|four|five|six|seven|eight|nine|ten|twelve)`;
const toNum = (s: string) => NUM_WORDS[s.toLowerCase()] ?? Number(s);

const VERBS = 'take|use|inject|apply|inhale|place|insert|instil|instill|dissolve|chew|spray|give|swallow|dissolve';
const DIRECTIONS_START = new RegExp(String.raw`^\W*(${VERBS})\b`, 'i');
const STRENGTH = /(\d+(?:\.\d+)?)\s*(mg|mcg|micrograms?|µg|ug|g|ml|units?|iu)\b(?:\s*\/\s*(\d+(?:\.\d+)?)?\s*(ml)\b)?/i;
const NOT_DIRECTIONS = /\b(dr\.?\s|qty|quantity|rpts?\b|repeats?|pharmacy|chemist|ph[:.]|tel\b|store\b|keep out|exp\b|expiry|mr\.?\s|mrs\.?\s|ms\.?\s|miss\s|\d{1,2}\/\d{1,2}\/\d{2,4})/i;
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const TIME_WORDS: [RegExp, string][] = [
  [/\b(morning|breakfast|mane|on waking)\b/i, '08:00'],
  [/\b(midday|lunch|noon|lunchtime)\b/i, '12:00'],
  [/\b(afternoon)\b/i, '15:00'],
  [/\b(evening|dinner|tea ?time|with tea)\b/i, '18:00'],
  [/\b(night|bedtime|bed|nocte)\b/i, '21:00'],
];

/** Fix common OCR slips: "1O mg" → "10 mg", "l0" → "10", odd spacing. */
export function cleanOcr(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/(\d)[oO](?=\d|[oO]|\b|\s*(?:mg|mcg|ml|g)\b)/g, '$10')
    .replace(/(\d)[oO](?=\d|\b)/g, '$10')
    .replace(/\b[lI](\d)/g, '1$1')
    .replace(/\b(rpts?|repeats?)\s*[lI]\b/gi, '$1 1')
    .replace(/\b[lI](?=\s*of\s*\d)/g, '1')
    .replace(/[|]/g, 'I')
    .replace(/[ \t]+/g, ' ')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

/** "TAKE ONE TABLET" → "Take one tablet"; mixed case is left alone. */
function sentenceCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s(-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

function hhmm(h: number, m = 0) {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "8am", "4 pm", "16:00", "8.30am" → "HH:mm". */
function explicitTime(s: string): string | undefined {
  const m = s.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/i) ?? s.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (!m) return undefined;
  let h = Number(m[1]);
  const mi = Number(m[2] ?? 0);
  const ap = m[3]?.toLowerCase().replace(/\./g, '');
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return h <= 23 && mi <= 59 ? hhmm(h, mi) : undefined;
}

function timeOf(segment: string): string | undefined {
  return explicitTime(segment) ?? TIME_WORDS.find(([re]) => re.test(segment))?.[1];
}

function countIn(segment: string): number | undefined {
  const m = segment.match(new RegExp(String.raw`\b(?:${VERBS})?\s*(?:up to\s+)?${NUM}\s*(?:to|-|or)?\s*(?:\w+\s*)?(?:tablets?|tabs?|capsules?|caps?|puffs?|drops?|ml|units?|sachets?|patch(?:es)?|injections?|doses?)\b`, 'i'));
  if (m) return toNum(m[1]);
  const lead = segment.match(new RegExp(String.raw`^\W*(?:(?:${VERBS})\s+)?${NUM}\b`, 'i'));
  return lead ? toNum(lead[1]) : undefined;
}

function timesPerDay(d: string): number | undefined {
  if (/\b(four times|4 times|qid|qds)\b/i.test(d)) return 4;
  if (/\b(three times|3 times|tds|tid)\b/i.test(d)) return 3;
  if (/\b(twice|two times|2 times|bd|b\.d\.|morning and (?:at )?(?:night|evening))\b/i.test(d)) return 2;
  if (/\b(once (?:a|each|every|per) day|once daily|daily|each day|every day|one time a day|once a day|once)\b/i.test(d)) return 1;
  return undefined;
}

const DEFAULT_TIMES: Record<number, string[]> = {
  1: ['08:00'], 2: ['08:00', '20:00'], 3: ['08:00', '14:00', '20:00'], 4: ['08:00', '12:00', '16:00', '20:00'],
};

export function parseSchedule(d: string): { schedule?: LabelSchedule; count?: number } {
  const count = countIn(d);
  if (/\b(when required|as required|when needed|as needed|if needed|if required|prn|when necessary)\b/i.test(d)) {
    const s: LabelSchedule = { type: 'prn' };
    const every = d.match(new RegExp(String.raw`every\s+${NUM}(?:\s*(?:to|-)\s*${NUM})?\s*hours?`, 'i'));
    if (every) s.minHoursApart = toNum(every[1]);
    const max = d.match(new RegExp(String.raw`(?:max(?:imum)?\.?(?:\s+of)?|no more than|not more than|not to exceed|up to)\s+${NUM}\s*(tablets?|tabs?|capsules?|caps?|doses?|times|puffs?|sachets?)?\s*(?:in|per|a|each|every)\s*(?:24\s*hours?|24\s*hrs?|day)`, 'i'));
    if (max) {
      if (!max[2] || /dose|time/i.test(max[2])) s.maxDoses = toNum(max[1]);
      else s.maxCount = toNum(max[1]);
    }
    return { schedule: s, count };
  }
  const everyHours = d.match(new RegExp(String.raw`every\s+${NUM}\s*hours?`, 'i'));
  if (everyHours) return { schedule: { type: 'interval', hours: toNum(everyHours[1]) }, count };

  // Days: weekly on a day, every N days.
  let days: number[] | undefined;
  let everyNDays: number | undefined;
  if (/\b(once a week|once weekly|weekly|every week|each week)\b/i.test(d) || /\bevery\s+(sun|mon|tue|wed|thu|fri|sat)/i.test(d)) {
    const named = WEEKDAYS.map((w, i) => (new RegExp(String.raw`\b${w}[a-z]*\b`, 'i').test(d) ? i : -1)).filter((i) => i >= 0);
    days = named.length ? named : undefined;
    if (!days) everyNDays = 7;
  }
  const nDays = d.match(new RegExp(String.raw`every\s+${NUM}\s*days`, 'i'));
  if (nDays) everyNDays = toNum(nDays[1]);
  if (/\b(every (?:second|other) day|alternate days)\b/i.test(d)) everyNDays = 2;

  // Several parts, each with its own amount and time: "two in the morning, two at midday and one at 4pm".
  const parts = d.split(/,|;|\band\b|\bthen\b/i).map((p) => p.trim()).filter(Boolean);
  const timed = parts.map((p) => ({ time: timeOf(p), count: countIn(p) })).filter((p) => p.time);
  if (timed.length >= 2) {
    const slots = timed.map((p) => ({ time: p.time!, count: p.count ?? count })).sort((a, b) => a.time.localeCompare(b.time));
    return { schedule: { type: 'fixed', slots, days, everyNDays }, count: slots[0].count };
  }
  const n = timesPerDay(d);
  const one = timed[0]?.time;
  if (n || one || days || everyNDays) {
    const times = n && n > 1 ? DEFAULT_TIMES[n] ?? [] : [one ?? '08:00'];
    return { schedule: { type: 'fixed', slots: times.map((time) => ({ time })), days, everyNDays }, count };
  }
  return { count };
}

function parseStrengthLine(line: string): { name?: string; strength?: number; unit?: LabelUnit; perMl?: string } | undefined {
  const m = line.match(STRENGTH);
  if (!m) return undefined;
  let amount = Number(m[1]);
  const raw = m[2].toLowerCase();
  let unit: LabelUnit = raw === 'ml' ? 'mL' : /^(mcg|micrograms?|µg|ug)$/.test(raw) ? 'mcg' : /^(units?|iu)$/.test(raw) ? 'units' : 'mg';
  if (raw === 'g') amount *= 1000;
  const name = line.slice(0, m.index).replace(/^\s*\d+\s*x\s*/i, '').replace(/[-–:,(]+\s*$/, '').trim();
  if (m[4]) return { name, perMl: `${m[1]} ${raw === 'g' ? 'g' : unit}/${m[3] ?? ''}${m[3] ? ' ' : ''}mL` };
  return { name, strength: amount, unit };
}

/** Australian pharmacy labels: name and strength, directions, Qty, Rpts, Dr, Exp. */
export function parseLabel(text: string): LabelDetails {
  const lines = cleanOcr(text).split('\n');
  const out: LabelDetails = {};
  const all = lines.join(' ');

  // Directions: the line starting "Take…" (or Use, Inject…) and the lines that continue it.
  const start = lines.findIndex((l) => DIRECTIONS_START.test(l));
  let end = start;
  if (start >= 0) {
    const dir: string[] = [];
    for (let i = start; i < lines.length; i++) {
      const l = lines[i];
      if (i > start && (NOT_DIRECTIONS.test(l) || DIRECTIONS_START.test(l) || (STRENGTH.test(l) && !/\b(of|each|every|with|up to)\b/i.test(l)))) break;
      if (NOT_DIRECTIONS.test(l) && i === start) {
        dir.push(l.replace(NOT_DIRECTIONS, '').trim());
        break;
      }
      dir.push(l);
      end = i;
    }
    out.directions = sentenceCase(dir.join(' ').replace(/\s+/g, ' ').trim()).replace(/\.?$/, '.');
    const { schedule, count } = parseSchedule(out.directions);
    if (schedule) out.schedule = schedule;
    if (count !== undefined) out.count = count;
  }

  // Name and strength: the first line (outside the directions) with an amount like "10mg".
  for (let i = 0; i < lines.length; i++) {
    if (start >= 0 && i >= start && i <= end) continue;
    if (NOT_DIRECTIONS.test(lines[i])) continue;
    const s = parseStrengthLine(lines[i]);
    if (!s) continue;
    let name = s.name || (i > 0 && !NOT_DIRECTIONS.test(lines[i - 1]) ? lines[i - 1] : '');
    name = name.replace(/\b(tablets?|tabs?|capsules?|caps?|film[- ]coated|modified release|oral|solution|liquid|injection)\b/gi, '').replace(/\s+/g, ' ').trim();
    if (name) out.name = titleCase(name) + (s.perMl ? ` ${s.perMl}` : '');
    if (s.strength !== undefined) { out.strength = s.strength; out.unit = s.unit; }
    if (s.perMl) out.unit = 'mL';
    break;
  }

  if (/\b(injection|inj\.?|pen|prefilled|pre-filled|syringe)\b/i.test(all)) out.form = 'injection';
  else if (/\b(capsules?|caps?)\b/i.test(all)) out.form = 'capsule';
  else if (/\b(patch(?:es)?)\b/i.test(all)) out.form = 'patch';
  else if (/\b(liquid|solution|syrup|suspension|mixture|elixir|drops)\b/i.test(all) || out.unit === 'mL') out.form = 'liquid';
  else if (/\b(tablets?|tabs?)\b/i.test(all)) out.form = 'tablet';

  const qty = all.match(/\b(?:qty|quantity|qnty)\s*[:.]?\s*(\d+)/i);
  if (qty) out.quantity = Number(qty[1]);
  const rpt = all.match(/\b(?:rpts?|repeats?)\b\s*[:.]?\s*(?:left\s*)?(\d+)(?:\s*(?:of|\/)\s*(\d+))?/i);
  if (rpt) out.repeats = rpt[2] ? Math.max(0, Number(rpt[2]) - Number(rpt[1])) : Number(rpt[1]);
  const dr = all.match(/\bDr\.?(?:\s+|(?=[A-Z]))((?:[A-Z][A-Za-z.'-]*\s*){1,3})/);
  if (dr) {
    // OCR sometimes drops spaces: "DrASmith".
    const words = dr[1].replace(/([A-Z])(?=[A-Z][a-z])/g, '$1 ').trim().split(/\s+/);
    const stop = words.findIndex((w) => /^(qty|quantity|rpts?|repeats?|exp|expiry|ph|tel|date)\b/i.test(w));
    out.prescriber = `Dr ${titleCase((stop >= 0 ? words.slice(0, stop) : words).join(' '))}`;
  }
  const exp = all.match(/\b(?:exp(?:iry)?|use by|discard after)\b\s*[:.]?\s*(\d{1,2})[/.-](\d{2,4})(?:[/.-](\d{2,4}))?/i);
  if (exp) {
    const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
    if (exp[3]) out.expiry = `${year(exp[3])}-${exp[2].padStart(2, '0')}-${exp[1].padStart(2, '0')}`;
    else {
      const y = year(exp[2]), m = Number(exp[1]);
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      if (m >= 1 && m <= 12) out.expiry = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    }
  }
  return out;
}
