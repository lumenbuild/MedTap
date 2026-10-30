import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/db';
import { createMed } from '../src/db/repos/meds';
import { forgetOldTag, linkTag } from '../src/db/repos/tags';
import { tagUrl } from '../src/nfc/url';

const base = { name: 'Vyvanse', strength: 50, unit: 'mg', form: 'capsule', defaultAmount: 50, schedule: { type: 'fixed' as const, times: ['07:30'] }, color: '#0B7A75', icon: 'pill' };

beforeEach(async () => { await Promise.all(db.tables.map((t) => t.clear())); });

describe('reusing a tag', () => {
  it('erasing or writing over a tag drops its old link, and says what it was for', async () => {
    const med = await createMed(base);
    await linkTag('oldTag123', med.id, 'Bottle at home');
    const r = await forgetOldTag(tagUrl('oldTag123'));
    expect(r?.what).toBe('Vyvanse');
    expect(await db.tags.get('oldTag123')).toBeUndefined();
  });
  it('leaves alone a tag that was blank, from elsewhere, or the one just written', async () => {
    const med = await createMed(base);
    await linkTag('keepMe456', med.id);
    expect(await forgetOldTag(null)).toBeNull();
    expect(await forgetOldTag('https://example.com/menu')).toBeNull();
    expect(await forgetOldTag(tagUrl('keepMe456'), 'keepMe456')).toBeNull();
    expect(await db.tags.get('keepMe456')).toBeTruthy();
  });
});
