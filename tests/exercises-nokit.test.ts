import { describe, it, expect } from 'vitest';
import { BUILT_IN, NO_KIT_SESSIONS } from '../src/logic/exercises';

describe('no-equipment exercises', () => {
  const none = BUILT_IN.filter((e) => e.equipment === 'none');
  it('cover every movement and progress by reps', () => {
    expect(none.length).toBeGreaterThanOrEqual(30);
    for (const p of ['legs', 'push', 'pull', 'core'] as const) expect(none.filter((e) => e.pattern === p).length).toBeGreaterThanOrEqual(4);
    for (const e of none) { expect(e.bodyweight).toBe(true); expect(e.increment).toBe(0); expect(e.perHand).toBeFalsy(); }
  });
  it('ids are unique and ready-made sessions only use no-equipment exercises', () => {
    expect(new Set(BUILT_IN.map((e) => e.id)).size).toBe(BUILT_IN.length);
    for (const s of NO_KIT_SESSIONS) for (const it of s.items) expect(none.map((e) => e.id)).toContain(it.exerciseId);
  });
});
