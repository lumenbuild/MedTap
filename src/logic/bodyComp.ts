// Lean mass, one way everywhere: the reading's own weight minus its own fat (weight × body fat %), so fat lost and
// lean lost always add up to the weight lost. A lean figure stored on its own (another app's "lean body mass", taken
// at a different moment of the day) is used only when the reading has no body fat %. Skeletal muscle (a different and
// smaller measure) is never mixed in. Pure.
import type { BodyEntry } from '../db/schema';

export function leanOf(b: Pick<BodyEntry, 'weightKg' | 'bodyFatPct' | 'leanKg'>): number | undefined {
  if (typeof b.weightKg === 'number' && typeof b.bodyFatPct === 'number') return b.weightKg * (1 - b.bodyFatPct / 100);
  return typeof b.leanKg === 'number' ? b.leanKg : undefined;
}
