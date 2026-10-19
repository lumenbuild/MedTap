import { describe, it, expect } from 'vitest';
import { hashPin, isValidPin, newSalt, verifyPin } from '../src/logic/pin';

describe('PIN', () => {
  it('accepts 4–6 digits only', () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('123456')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
  });
  it('verifies the right PIN and rejects others', async () => {
    const salt = newSalt();
    const hash = await hashPin('2580', salt);
    expect(hash).not.toContain('2580');
    expect(await verifyPin('2580', salt, hash)).toBe(true);
    expect(await verifyPin('2581', salt, hash)).toBe(false);
  });
  it('salts: same PIN, different hash', async () => {
    expect(await hashPin('2580', newSalt())).not.toBe(await hashPin('2580', newSalt()));
  });
});
