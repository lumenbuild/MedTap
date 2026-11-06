// A sickness forecast that learns the person's own signature. Each night's skin temperature, resting heart rate,
// breathing rate, HRV and blood oxygen are scored against that person's own usual (median and spread of the 60 nights
// before, leaving out nights around past illnesses), so a small change in someone very steady counts for more than the
// same change in someone who varies a lot. Past illnesses (a sick check-in, or "I'm unwell" on the card) teach it which
// signals move first for this person and how high the score went beforehand; "I'm fine" on an alert teaches it to
// alert less readily. Alcohol or a hard session the day before explain some of a raised heart rate and lower HRV, so
// those count for less. A nudge to look after yourself, not a diagnosis. Pure.
import type { CheckIn, DailyHealth, Workout } from '../db/schema';

const DAY = 86_400_000;
const live = <T extends { deletedAt?: string }>(x: T) => !x.deletedAt;
const ymdMs = (k: string) => new Date(`${k}T12:00`).getTime();
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const addDays = (k: string, n: number) => { const d = new Date(`${k}T12:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export type SickSignal = 'skinTempDelta' | 'restingHr' | 'respRate' | 'hrvMs' | 'spo2Avg';
interface Def { key: SickSignal; label: string; unit: string; dp: number; /** +1 when higher is worse, −1 when lower is. */ dir: 1 | -1; /** The smallest spread to assume. */ floor: (m: number) => number }
const DEFS: Def[] = [
  { key: 'skinTempDelta', label: 'Skin temperature', unit: '°C', dp: 1, dir: 1, floor: () => 0.15 },
  { key: 'restingHr', label: 'Resting heart rate', unit: 'bpm', dp: 0, dir: 1, floor: () => 1.5 },
  { key: 'respRate', label: 'Breathing rate', unit: 'a min', dp: 1, dir: 1, floor: () => 0.4 },
  { key: 'hrvMs', label: 'HRV', unit: 'ms', dp: 0, dir: -1, floor: (m) => Math.max(2, m * 0.08) },
  { key: 'spo2Avg', label: 'Blood oxygen', unit: '%', dp: 1, dir: -1, floor: () => 0.5 },
];
export const SICK_LABEL: Record<SickSignal, string> = Object.fromEntries(DEFS.map((d) => [d.key, d.label])) as Record<SickSignal, string>;

/** Words in a check-in that mean the person was unwell. */
export const SICK_WORDS = /\b(sick|ill|unwell|cold|flu|fever|feverish|sore throat|covid|virus|chills|run down|infection|temperature)\b/i;
export const UNWELL = 'Unwell';

export interface SickInput {
  daily: DailyHealth[]; checkIns: CheckIn[]; workouts?: Workout[];
  /** "I'm unwell" / "I'm fine" answers on the card, by night. */
  feedback?: Record<string, 'sick' | 'fine'>;
}

export interface SignalReading { key: SickSignal; label: string; unit: string; value: number; usual: number; /** How far off, in the person's own spreads (+ is the unwell direction). */ z: number; text: string }
export interface NightScore { date: string; score: number; signals: SignalReading[]; /** Alcohol or a hard session the day before. */ confound?: string }
export interface SickForecast {
  level: 'clear' | 'watch' | 'likely';
  /** 0–100: how strongly last night looks like the run-up to being unwell. */
  score: number;
  date: string;
  /** The signals off last night, most off first. */
  off: SignalReading[];
  /** Every signal last night, against usual. */
  all: SignalReading[];
  confound?: string;
  /** The last two weeks' scores, for a chart. */
  recent: { date: string; score: number }[];
  /** What it has learned. */
  learned: {
    episodes: number;
    /** Of past illnesses with data the nights before, how many it would have flagged a day or more ahead. */
    caught?: number; checked?: number;
    /** The signal that moved most in the nights before past illnesses. */
    first?: SickSignal;
    /** Alerts answered "I'm fine". */
    falseAlarms: number;
  };
  /** The score it alerts at, for this person. */
  watchAt: number;
}

/** The nights (dates) that started an illness: sick check-ins and "I'm unwell" answers, merged when within 5 days. */
export function sickEpisodes(checkIns: CheckIn[], feedback: Record<string, 'sick' | 'fine'> = {}): string[] {
  const days = new Set<string>();
  for (const c of checkIns.filter(live)) {
    if (c.chips.some((x) => x === UNWELL || SICK_WORDS.test(x)) || (c.note && SICK_WORDS.test(c.note))) {
      const d = new Date(Date.parse(c.at));
      days.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
  }
  for (const [k, v] of Object.entries(feedback)) if (v === 'sick') days.add(k);
  const sorted = [...days].sort();
  const starts: string[] = [];
  for (const k of sorted) if (!starts.length || ymdMs(k) - ymdMs(starts[starts.length - 1]) > 5 * DAY) starts.push(k);
  // A run of sick days counts once, from its first day.
  return starts;
}

/** Days with alcohol or a hard session (an hour or more, or 15+ sets): the night after reads worse for that reason. */
function confounds(checkIns: CheckIn[], workouts: Workout[]): Map<string, string> {
  const out = new Map<string, string>();
  const key = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  for (const c of checkIns.filter(live)) if (c.chips.some((x) => /alcohol/i.test(x))) out.set(addDays(key(Date.parse(c.at)), 1), 'alcohol the evening before');
  for (const w of workouts.filter(live)) {
    const mins = w.endedAt ? (Date.parse(w.endedAt) - Date.parse(w.startedAt)) / 60_000 : 0;
    const hard = mins >= 60 || w.sets.filter((s) => s.done && !s.warmup).length >= 15 || (w.cardio?.durationMin ?? 0) >= 60;
    if (hard) { const k = addDays(key(Date.parse(w.startedAt)), 1); if (!out.has(k)) out.set(k, 'a hard session the day before'); }
  }
  return out;
}

/** Score each night from `from` on, each against the 60 nights before it (leaving out the week around past illnesses). */
function scoreNights(rows: DailyHealth[], episodes: string[], weights: Record<SickSignal, number>, conf: Map<string, string>, fromIdx: number): NightScore[] {
  const near = (k: string) => episodes.some((e) => ymdMs(k) >= ymdMs(e) - 3 * DAY && ymdMs(k) <= ymdMs(e) + 7 * DAY);
  const out: NightScore[] = [];
  for (let i = fromIdx; i < rows.length; i++) {
    const row = rows[i];
    const t = ymdMs(row.date);
    const base = rows.slice(0, i).filter((r) => ymdMs(r.date) > t - 61 * DAY && !near(r.date));
    const signals: SignalReading[] = [];
    let score = 0, wsum = 0;
    const why = conf.get(row.date);
    for (const d of DEFS) {
      const v = row[d.key];
      if (typeof v !== 'number') continue;
      const vals = base.map((r) => r[d.key]).filter((x): x is number => typeof x === 'number');
      if (vals.length < 10) continue;
      const m = median(vals);
      const spread = Math.max(d.floor(m), 1.4826 * median(vals.map((x) => Math.abs(x - m))));
      let z = (d.dir * (v - m)) / spread;
      // Alcohol and hard training raise heart rate and lower HRV on their own.
      if (why && (d.key === 'restingHr' || d.key === 'hrvMs')) z *= 0.5;
      const r = (x: number) => Math.round(x * 10 ** d.dp) / 10 ** d.dp;
      const diff = r(v - m);
      const text = d.key === 'hrvMs' ? `${Math.round((v / m - 1) * 100)}% vs usual` : `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${Math.abs(diff)} ${d.unit === 'a min' ? 'breaths a min' : d.unit} vs usual`;
      signals.push({ key: d.key, label: d.label, unit: d.unit, value: r(v), usual: r(m), z: Math.round(z * 10) / 10, text });
      // Only past one spread counts, and no one signal can carry it alone.
      score += weights[d.key] * Math.min(3, Math.max(0, z - 1));
      wsum += weights[d.key];
    }
    if (signals.length < 2) continue;
    // Scaled so the same strength reads the same with 2 signals or 5.
    const s = (score / wsum) * DEFS.length;
    out.push({ date: row.date, score: Math.round(s * 10) / 10, signals: signals.sort((a, b) => b.z - a.z), confound: why });
  }
  return out;
}

const WATCH_AT = 2.5;
const toPct = (s: number) => Math.min(100, Math.round((s / 8) * 100));

export function sickForecast(d: SickInput, now: number): SickForecast | null {
  const rows = d.daily.filter(live).filter((r) => DEFS.some((x) => typeof r[x.key] === 'number')).sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < 12) return null;
  const last = rows[rows.length - 1];
  if (now - ymdMs(last.date) > 1.5 * DAY) return null;
  const feedback = d.feedback ?? {};
  const episodes = sickEpisodes(d.checkIns, feedback);
  const conf = confounds(d.checkIns, d.workouts ?? []);

  // Learn: which signals were off in the 1–3 nights before past illnesses, against all other nights.
  const even = Object.fromEntries(DEFS.map((x) => [x.key, 1])) as Record<SickSignal, number>;
  const history = scoreNights(rows, episodes, even, conf, 0);
  const lead = (e: string) => history.filter((n) => ymdMs(n.date) >= ymdMs(e) - 3 * DAY && ymdMs(n.date) <= ymdMs(e));
  const withLead = episodes.filter((e) => lead(e).length > 0);
  const weights = { ...even };
  let first: SickSignal | undefined;
  if (withLead.length >= 2) {
    let best = 0;
    for (const def of DEFS) {
      const zs = withLead.flatMap(lead).flatMap((n) => n.signals.filter((x) => x.key === def.key).map((x) => x.z));
      if (zs.length < 2) continue;
      const m = zs.reduce((a, b) => a + b, 0) / zs.length;
      // A signal that rose before illnesses counts up to 2½ times; one that didn't, half.
      weights[def.key] = m >= 0.5 ? Math.min(2.5, 1 + m * 0.6) : 0.5;
      if (m > best) { best = m; first = def.key; }
    }
  }
  const nights = scoreNights(rows, episodes, weights, conf, Math.max(0, rows.length - 90));
  // The alert level: lower when past illnesses scored lower beforehand, higher after "I'm fine" answers.
  const leadPeaks = withLead.map((e) => Math.max(0, ...nights.filter((n) => ymdMs(n.date) >= ymdMs(e) - 3 * DAY && ymdMs(n.date) < ymdMs(e)).map((n) => n.score)));
  const falseAlarms = Object.values(feedback).filter((v) => v === 'fine').length;
  let watchAt = WATCH_AT;
  const peaks = leadPeaks.filter((p) => p > 0);
  if (peaks.length >= 2) watchAt = Math.min(WATCH_AT, Math.max(1.5, median(peaks) * 0.8));
  watchAt = Math.round(Math.min(4.5, watchAt + falseAlarms * 0.25) * 10) / 10;
  const caught = peaks.filter((p) => p >= watchAt).length;

  const tonight = nights.find((n) => n.date === last.date);
  if (!tonight) return null;
  const prev = nights.find((n) => n.date === addDays(last.date, -1));
  const offs = tonight.signals.filter((x) => x.z >= 1.5);
  const twoNights = prev !== undefined && prev.score >= watchAt;
  const level: SickForecast['level'] = tonight.score >= watchAt * 1.6 && offs.length >= 2 ? 'likely'
    : tonight.score >= watchAt && offs.length >= 2 ? (twoNights ? 'likely' : 'watch')
    : 'clear';
  return {
    level, score: toPct(tonight.score), date: last.date, off: offs, all: tonight.signals, confound: tonight.confound,
    recent: nights.filter((n) => ymdMs(n.date) > ymdMs(last.date) - 14 * DAY).map((n) => ({ date: n.date, score: toPct(n.score) })),
    learned: { episodes: episodes.length, caught: peaks.length ? caught : undefined, checked: peaks.length || undefined, first, falseAlarms },
    watchAt: toPct(watchAt),
  };
}

/** One line for the card or a notification. */
export function sickHeadline(f: SickForecast): string {
  return f.level === 'likely' ? 'Your body may be fighting something' : f.level === 'watch' ? 'Early signs your body is under strain' : 'No signs of getting sick';
}
