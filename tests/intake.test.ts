import { describe, it, expect } from 'vitest';
import { keepAmount, parseAmount, shownAmounts, usedAmount } from '../src/logic/intake';

describe('your own water and protein amounts', () => {
  it('any whole amount, within reason', () => {
    expect(parseAmount('350', 'waterMl')).toBe(350);
    expect(parseAmount('37.6', 'proteinG')).toBe(38);
    expect(parseAmount('0', 'waterMl')).toBeNull();
    expect(parseAmount('', 'waterMl')).toBeNull();
    expect(parseAmount('9000', 'waterMl')).toBeNull();
  });
  it('a cup kept as a button stays; past four, the one used longest ago goes', () => {
    let list = [250, 500];
    list = keepAmount(list, 350);
    expect(shownAmounts(list)).toEqual([250, 350, 500]);
    list = usedAmount(list, 250); // 250 used, 500 now the oldest
    list = keepAmount(list, 750);
    list = keepAmount(list, 1000);
    expect(list).toHaveLength(4);
    expect(list).not.toContain(500);
    expect(usedAmount(list, 123)).toBe(list); // not a button: nothing changes
  });
});
