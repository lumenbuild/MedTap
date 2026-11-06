// Today's plan: one ranked list in place of separate cards. Today's calls, early warnings, the daily brief, the
// sickness forecast and the insights all become the same kind of item (what to do, why, and what it rests on), the
// same advice said twice is said once, and the most useful come first. Each item says which part of life it belongs
// to (meds, fuel, body, recovery, movement) and links to the numbers it rests on ("because" chips). Pure.
import type { Call, Warning } from './decisions';
import type { BriefLine } from './brief';
import type { Insight, InsightKind } from './insights';
import type { SickForecast } from './sickness';
import { sickHeadline } from './sickness';

export type Thread = 'meds' | 'fuel' | 'body' | 'recovery' | 'move';
export interface Because { label: string; href: string }
export interface PlanItem {
  key: string; thread: Thread; title: string; detail?: string;
  tone: 'go' | 'easy' | 'stop' | 'info' | 'watch' | 'good';
  /** How much it matters today, 0–100. */
  impact: number;
  because: Because[];
  /** An insight keeps its own actions (and Not now). */
  insight?: Insight;
  /** The sickness forecast, for its own row. */
  sick?: SickForecast;
}

const L = {
  readiness: { label: 'Readiness', href: '#/health' },
  hrv: { label: 'HRV', href: '#/health' },
  vitals: { label: 'Overnight vitals', href: '#/health' },
  load: { label: 'Training load', href: '#/training' },
  sleep: { label: 'Sleep', href: '#/sleep' },
  caffeine: { label: 'Caffeine', href: '#/caffeine' },
  food: { label: 'Food today', href: '#/food' },
  protein: { label: 'Protein', href: '#/food' },
  water: { label: 'Water', href: '#/health' },
  weight: { label: 'Weight trend', href: '#/progress/body' },
  body: { label: 'Body composition', href: '#/progress/body' },
  doses: { label: 'Doses', href: '#/meds' },
  steps: { label: 'Steps', href: '#/health' },
  checkins: { label: 'Check-ins', href: '#/progress/trends' },
  trends: { label: 'Trends', href: '#/progress/trends' },
} satisfies Record<string, Because>;

const CALL: Record<Call['key'], { thread: Thread; impact: number; because: Because[] }> = {
  'second-dose': { thread: 'meds', impact: 90, because: [L.doses, L.checkins] },
  ahead: { thread: 'fuel', impact: 70, because: [L.food, L.sleep] },
  lever: { thread: 'body', impact: 68, because: [L.weight, L.food] },
  train: { thread: 'move', impact: 66, because: [L.readiness, L.load] },
  protein: { thread: 'fuel', impact: 62, because: [L.protein, L.body] },
  weight: { thread: 'body', impact: 60, because: [L.weight] },
  sleep: { thread: 'recovery', impact: 56, because: [L.sleep, L.caffeine] },
  food: { thread: 'fuel', impact: 50, because: [L.food, L.weight] },
  caffeine: { thread: 'recovery', impact: 46, because: [L.caffeine, L.sleep] },
};
const WARN: Record<string, { thread: Thread; because: Because[] }> = {
  hydration: { thread: 'recovery', because: [L.water, L.body] },
  overtraining: { thread: 'move', because: [L.load, L.hrv] },
  'under-recovery': { thread: 'recovery', because: [L.food, L.hrv] },
  plateau: { thread: 'body', because: [L.weight, L.steps, L.food] },
  muscle: { thread: 'body', because: [L.body, L.protein] },
};
const AREA: Partial<Record<InsightKind, Thread>> = {
  sleep: 'recovery', dosecut: 'recovery', cutoff: 'recovery', illness: 'recovery', heart: 'recovery', reading: 'recovery',
  steps: 'move', load: 'move',
  protein: 'fuel', calories: 'fuel', undereat: 'fuel', eating: 'fuel', gut: 'fuel', fluids: 'fuel', appetite: 'fuel',
  lean: 'body', regain: 'body', maintain: 'body', target: 'body', stall: 'body',
};
const INSIGHT_LINK: Partial<Record<Thread, Because>> = { recovery: L.sleep, move: L.steps, fuel: L.food, body: L.weight, meds: L.doses };

export interface PlanInput { calls: Call[]; warnings: Warning[]; brief: BriefLine[]; insights: Insight[]; sick?: SickForecast | null }

/** One ranked list for today. */
export function todayPlan(d: PlanInput): PlanItem[] {
  const out: PlanItem[] = [];
  const has = (prefix: string) => out.some((x) => x.key.startsWith(prefix));

  // Getting sick comes first: it changes what the rest of the day should be.
  if (d.sick && d.sick.level !== 'clear') {
    out.push({ key: 'sick', thread: 'recovery', tone: 'watch', impact: d.sick.level === 'likely' ? 97 : 84, title: sickHeadline(d.sick),
      detail: `${d.sick.off.map((x) => `${x.label} ${x.text}`).join(' · ')}. An easier day, fluids and an early night help.`,
      because: [L.vitals, ...d.sick.off.slice(0, 2).map((x) => ({ label: x.label, href: '#/health' }))], sick: d.sick });
  }
  for (const w of d.warnings) {
    const m = WARN[w.key] ?? { thread: 'recovery' as Thread, because: [L.trends] };
    out.push({ key: `warn:${w.key}`, thread: m.thread, tone: 'watch', impact: 85, title: w.title, detail: `${w.detail} ${w.action}`.trim(), because: m.because });
  }
  for (const c of d.calls) {
    const m = CALL[c.key];
    // Two "ahead" calls (a short night, cravings) are both kept.
    out.push({ key: `call:${c.key}:${out.filter((x) => x.key.startsWith(`call:${c.key}`)).length}`, thread: m.thread, tone: c.tone, impact: m.impact, title: c.title, detail: c.detail, because: m.because });
  }
  for (const b of d.brief) {
    const [kind] = b.key.split(':');
    // Said already by today's calls.
    if (kind === 'second' && has('call:second-dose')) continue;
    if (kind === 'water' && has('warn:hydration')) continue;
    const m: Record<string, { thread: Thread; impact: number; because: Because[] }> = {
      first: { thread: 'meds', impact: 88, because: [L.doses, L.sleep] },
      second: { thread: 'meds', impact: 88, because: [L.doses] },
      shot: { thread: 'meds', impact: 80, because: [L.doses, L.checkins] },
      appetite: { thread: 'fuel', impact: 58, because: [L.checkins, L.food] },
      water: { thread: 'fuel', impact: 52, because: [L.water] },
      brain: { thread: 'recovery', impact: 30, because: [{ label: 'Brain tests', href: '#/brain' }] },
      exp: { thread: 'recovery', impact: 40, because: [{ label: 'Experiments', href: '#/experiments' }] },
    };
    const x = m[kind] ?? { thread: 'meds' as Thread, impact: 40, because: [] };
    out.push({ key: `brief:${b.key}`, thread: x.thread, tone: 'info', impact: x.impact, title: b.text, because: x.because });
  }
  for (const x of d.insights) {
    // Said already: a second dose, appetite, water, getting sick.
    if (x.kind === 'second' && (has('call:second-dose') || has('brief:second'))) continue;
    if (x.kind === 'appetite' && has('brief:appetite')) continue;
    if (x.kind === 'fluids' && (has('brief:water') || has('warn:hydration'))) continue;
    if (x.kind === 'illness' && has('sick')) continue;
    if (x.kind === 'cutoff' && has('call:caffeine')) continue;
    const thread = AREA[x.kind] ?? 'meds';
    const link = x.action?.kind === 'go' ? { label: x.action.label, href: x.action.href } : INSIGHT_LINK[thread];
    out.push({ key: `ins:${x.id}`, thread, tone: x.tone === 'watch' ? 'watch' : x.tone === 'good' ? 'good' : 'info', impact: x.importance * 0.8, title: x.headline, detail: x.evidence,
      because: [...(x.n ? [{ label: `${x.n} ${x.nOf ?? 'records'}`, href: link?.href ?? '#/progress/trends' }] : []), ...(link && x.action?.kind !== 'go' ? [link] : [])], insight: x });
  }
  // Most useful first; ties keep the order above (warnings, calls, brief, insights).
  return out.map((x, i) => ({ x, i })).sort((a, b) => b.x.impact - a.x.impact || a.i - b.i).map((p) => p.x);
}

export const THREAD_LABEL: Record<Thread, string> = { meds: 'Meds', fuel: 'Fuel', body: 'Body', recovery: 'Recovery', move: 'Move' };
