import 'fake-indexeddb/auto';
import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('editions', () => {
  it('MedTap is the default, with everything', async () => {
    const e = await import('../src/edition');
    expect(e.edition.name).toBe('MedTap');
    expect(e.HAS_BODY).toBe(true);
    expect(e.HAS_PEPTIDES).toBe(true);
    const { appIntentUrl } = await import('../src/nfc/url');
    expect(appIntentUrl('ab3defgh', 'https://lumenbuild.github.io/MedTap/')).toContain('package=app.medtap.tracker;');
  });

  it('TapDose: own name, data, app and download, and no body or peptide tools', async () => {
    vi.stubEnv('VITE_EDITION', 'tapdose');
    const e = await import('../src/edition');
    expect(e.edition.name).toBe('TapDose');
    expect(e.HAS_BODY).toBe(false);
    expect(e.HAS_PEPTIDES).toBe(false);
    expect(e.apkDownload).toBe('https://github.com/lumenbuild/MedTap/releases/download/tapdose-android/TapDose.apk');
    expect((await import('../src/config')).APP_NAME).toBe('TapDose');
    expect((await import('../src/db/db')).db.name).toBe('tapdose');
    const { appIntentUrl } = await import('../src/nfc/url');
    const u = appIntentUrl('ab3defgh', 'https://lumenbuild.github.io/MedTap/tapdose/');
    expect(u).toContain('intent://lumenbuild.github.io/MedTap/tapdose/?t=ab3defgh#Intent;');
    expect(u).toContain('package=app.tapdose.tracker;');
    expect(u).toContain('tapdose-android');
  });

  it('TapDose never turns peptide tools on, even from a restored MedTap backup', async () => {
    vi.stubEnv('VITE_EDITION', 'tapdose');
    const { getSettings, setSetting } = await import('../src/db/repos/settings');
    await setSetting('peptideTools', true);
    expect((await getSettings()).peptideTools).toBe(false);
  });
});
