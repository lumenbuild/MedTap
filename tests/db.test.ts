import { describe, it, expect } from 'vitest';
import { getTheme } from '../src/app/theme';

describe('foundation', () => {
  it('defaults theme to system when storage is unavailable', () => {
    expect(getTheme()).toBe('system');
  });
});
