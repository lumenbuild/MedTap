import { describe, it, expect } from 'vitest';
import { isSealed, seal, unseal } from '../src/logic/crypto';

describe('password-protected backups', () => {
  it('round-trips with the right password', async () => {
    const s = await seal('{"hello":"world"}', 'correct horse');
    expect(s.data).not.toContain('hello');
    expect(await unseal(s, 'correct horse')).toBe('{"hello":"world"}');
    expect(isSealed({ sealed: s })).toBe(true);
    expect(isSealed({ format: 1 })).toBe(false);
  });
  it('rejects a wrong password', async () => {
    const s = await seal('secret', 'right');
    await expect(unseal(s, 'wrong')).rejects.toThrow();
  });
  it('rejects a tampered file', async () => {
    const s = await seal('secret', 'pw');
    const bad = { ...s, data: s.data.slice(0, -4) + (s.data.endsWith('AAAA') ? 'BBBB' : 'AAAA') };
    await expect(unseal(bad, 'pw')).rejects.toThrow();
  });
});
