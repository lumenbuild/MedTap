import { describe, it, expect } from 'vitest';
import { newTagId, TAG_ALPHABET } from '../src/logic/tagId';
import { appIntentUrl, parseTagParam, tagIdFromUrl, tagUrl } from '../src/nfc/url';

describe('tag IDs', () => {
  it('are 8 characters with no look-alikes', () => {
    for (let i = 0; i < 200; i++) {
      const id = newTagId();
      expect(id).toMatch(/^[23456789abcdefghijkmnpqrstuvwxyz]{8}$/);
      expect(id).not.toMatch(/[01lIoO]/);
    }
    expect(TAG_ALPHABET).toHaveLength(32);
  });

  it('round-trip through the permanent URL format', () => {
    const url = tagUrl('ab3defgh', 'https://meds.example.com/');
    expect(url).toBe('https://meds.example.com/?t=ab3defgh');
    expect(tagIdFromUrl(url)).toBe('ab3defgh');
  });

  it('parse leniently but reject junk', () => {
    expect(parseTagParam('?t=ab3defgh')).toBe('ab3defgh');
    expect(parseTagParam('?x=1')).toBeNull();
    expect(parseTagParam('?t=<script>')).toBe('');
  });
});

describe('appIntentUrl', () => {
  it('opens the same tag link in the Android app, falling back to the download page', () => {
    const u = appIntentUrl('ab3defgh', 'https://lumenbuild.github.io/MedTap/');
    expect(u).toBe('intent://lumenbuild.github.io/MedTap/?t=ab3defgh#Intent;scheme=https;package=app.medtap.tracker;'
      + 'S.browser_fallback_url=https%3A%2F%2Fgithub.com%2Flumenbuild%2FMedTap%2Freleases%2Ftag%2Fandroid;end');
  });
});
