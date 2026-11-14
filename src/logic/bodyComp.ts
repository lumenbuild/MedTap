// Lean mass, one way everywhere: the reading's own weight minus its own fat (weight × body fat %), so fat lost and
// lean lost always add up to the weight lost. A lean figure stored on its own (another app's "lean body mass", taken
// at a different moment of the day) is used only when the reading has no body fat %. Skeletal muscle (a different and
// smaller measure) is never mixed in. Pure.
import type { BodyEntry } from '../db/schema';

export function leanOf(b: Pick<BodyEntry, 'weightKg' | 'bodyFatPct' | 'leanKg'>): number | undefined {
  if (typeof b.weightKg === 'number' && typeof b.bodyFatPct === 'number') return b.weightKg * (1 - b.bodyFatPct / 100);
  return typeof b.leanKg === 'number' ? b.leanKg : undefined;
}

// ── When the scale changes how it measures ────────────────────────────────────────────────────────────
// A scale app update, a new profile or a different scale can move body fat by 8 points overnight while the weight
// stays put: no body changes that fast. Each composition measure is read only from its latest such change on, so a
// change of method never reads as fat lost or muscle gained. The stored readings are kept as they are.

/** The composition measures a scale reports, with the overnight shift no body makes (in the measure's own unit). */
export const COMP_JUMP: Partial<Record<keyof BodyEntry, number>> = {
  bodyFatPct: 4, visceralFat: 4, subcutFatPct: 4, skeletalMusclePct: 8, waterPct: 4, muscleKg: 4, leanKg: 4,
  proteinPct: 3, metabolicAge: 6, boneKg: 0.6, bmrKcal: 150,
};
type CompKey = keyof typeof COMP_JUMP;
const DAYMS = 86_400_000;
const at = (d: string) => Date.parse(`${d}T12:00`);
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** The date a measure's latest change of method starts, if there is one. Needs 2 readings after it that agree. */
export function methodChange(rows: BodyEntry[], key: CompKey): string | undefined {
  const jump = COMP_JUMP[key]!;
  const xs = rows.filter((b) => !b.deletedAt && typeof b[key] === 'number').sort((a, b) => a.date.localeCompare(b.date));
  let found: string | undefined;
  for (let i = 1; i < xs.length - 1; i++) {
    const t = at(xs[i].date);
    const before = xs.slice(0, i).filter((b) => at(b.date) >= t - 21 * DAYMS).slice(-3);
    const after = xs.slice(i).filter((b) => at(b.date) <= t + 21 * DAYMS).slice(0, 3);
    if (!before.length || after.length < 2) continue;
    const v = (b: BodyEntry) => b[key] as number;
    const shift = med(after.map(v)) - med(before.map(v));
    const spread = Math.max(...after.map(v)) - Math.min(...after.map(v));
    if (Math.abs(shift) < jump || spread > jump * 0.75) continue;
    // The weight has to have held: a real loss of 10 kg in a fortnight can move body fat too.
    const wb = before.filter((b) => typeof b.weightKg === 'number').map((b) => b.weightKg!), wa = after.filter((b) => typeof b.weightKg === 'number').map((b) => b.weightKg!);
    if (wb.length && wa.length && Math.abs(med(wa) - med(wb)) >= 2) continue;
    // The step must be sharp: the readings just before it sit with the earlier ones, not halfway.
    if (Math.abs(v(xs[i]) - v(xs[i - 1])) < jump * 0.75) continue;
    found = xs[i].date;
  }
  return found;
}

export interface ScaleRebase { body: BodyEntry[]; changedOn?: string; changed: Partial<Record<CompKey, string>> }

/** The entries with each composition measure kept only from its latest change of method; changedOn is body fat's
 *  (or, without body fat, the latest of any). Per person. */
export function rebaseScale(body: BodyEntry[]): ScaleRebase {
  const people = new Map<string, BodyEntry[]>();
  for (const b of body) people.set(b.personId ?? 'me', [...(people.get(b.personId ?? 'me') ?? []), b]);
  const cut = new Map<string, Partial<Record<CompKey, string>>>();
  let changedOn: string | undefined; const changed: Partial<Record<CompKey, string>> = {};
  for (const [p, rows] of people) {
    const c: Partial<Record<CompKey, string>> = {};
    for (const k of Object.keys(COMP_JUMP) as CompKey[]) { const d = methodChange(rows, k); if (d) c[k] = d; }
    if (Object.keys(c).length) cut.set(p, c);
    if (p === 'me' || people.size === 1) { Object.assign(changed, c); changedOn = c.bodyFatPct ?? Object.values(c).sort().at(-1); }
  }
  if (!cut.size) return { body, changed };
  return {
    changedOn, changed,
    body: body.map((b) => {
      const c = cut.get(b.personId ?? 'me');
      if (!c) return b;
      let out: BodyEntry | undefined;
      for (const [k, d] of Object.entries(c) as [CompKey, string][]) {
        if (b.date < d && b[k] !== undefined) { out ??= { ...b }; delete out[k]; }
      }
      return out ?? b;
    }),
  };
}
