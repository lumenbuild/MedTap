import { describe, it, expect } from 'vitest';
import { actionTitle } from '../src/logic/tagActions';

describe('food and tape-measure tags', () => {
  it('are named after what they do', () => {
    expect(actionTitle({ kind: 'measure' }, [], [])).toBe('Add measurements');
    expect(actionTitle({ kind: 'food', foodId: 'f1' }, [], [], [{ id: 'f1', name: 'Protein shake' }])).toBe('Protein shake');
    expect(actionTitle({ kind: 'food', foodId: 'gone' }, [], [], [{ id: 'gone', name: 'Old', deletedAt: 'x' }])).toBe('A food');
  });
});
