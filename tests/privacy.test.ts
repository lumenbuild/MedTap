import { describe, it, expect } from 'vitest';
import { isPrivate, shownColour, shownMedName, shownName } from '../src/logic/privacy';

const med = { name: 'Ritalin', nickname: '', strength: 10, unit: 'mg', color: '#2a78d6' };

describe('nicknames', () => {
  it('show the real name and colour when there is no nickname', () => {
    expect(isPrivate(med)).toBe(false);
    expect(shownName(med)).toBe('Ritalin');
    expect(shownMedName(med)).toBe('Ritalin 10 mg');
    expect(shownColour(med)).toBe('#2a78d6');
  });
  it('hide the name, strength and colour behind a nickname', () => {
    const m = { ...med, nickname: '  Morning tablet ' };
    expect(isPrivate(m)).toBe(true);
    expect(shownName(m)).toBe('Morning tablet');
    expect(shownMedName(m)).toBe('Morning tablet');
    expect(shownColour(m)).toBe('private');
  });
});
