import { describe, it, expect } from 'vitest';
import { getTheme } from '../src/app/theme';

describe('theme', () => {
  it('defaults to system when storage is unavailable', () => {
    expect(getTheme()).toBe('system');
  });
});
