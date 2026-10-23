// Android app only: is there a newer build than this one? Asks GitHub for the latest release of this app (nothing
// about the person is sent), at most once a day. Installs are by hand (the APK isn't from the Play Store), so without
// this a phone would stay on an old build.
import { edition } from '../edition';
import { isNativeAndroid } from '../platform';
import { getSettings, setSetting } from '../db/repos/settings';
import { MedTapNative } from '../nfc/native';

export const BUILD = Number(import.meta.env.VITE_BUILD) || 0;
const API = `https://api.github.com/repos/lumenbuild/MedTap/releases/tags/${edition.release}`;
const DAY = 86_400_000;

export interface Update { build: number; notes: string; url: string; page: string }

/** The release's build number, from its title "MedTap for Android (build 42)". */
export const buildOf = (title: string) => Number(title.match(/build (\d+)/i)?.[1] ?? 0);
/** The "What's new: …" line of the release notes. */
export const newsOf = (body: string) => body.match(/What's new: ([^\n]+)/)?.[1]?.trim() ?? '';

/** The newer build, if any. Checks at most once a day unless `force`; the last answer is kept in settings. */
export async function checkForUpdate(force = false): Promise<Update | null> {
  if (!isNativeAndroid || !BUILD) return null;
  const s = await getSettings();
  if (!s.updateCheck && !force) return null;
  if (!force && s.lastUpdateCheck && Date.now() - Date.parse(s.lastUpdateCheck) < DAY) return s.latestUpdate && s.latestUpdate.build > BUILD ? s.latestUpdate : null;
  try {
    const res = await fetch(API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    const r = (await res.json()) as { name?: string; body?: string; html_url?: string; assets?: { name: string; browser_download_url: string }[] };
    const build = buildOf(r.name ?? '');
    const asset = r.assets?.find((a) => a.name === edition.apk);
    const u: Update = { build, notes: newsOf(r.body ?? ''), url: asset?.browser_download_url ?? '', page: r.html_url ?? '' };
    await setSetting('lastUpdateCheck', new Date().toISOString());
    await setSetting('latestUpdate', u);
    return build > BUILD && u.url ? u : null;
  } catch { return null; }
}

export type InstallResult = 'started' | 'permission' | 'failed';

/** Download the build and open Android's installer (the person confirms there). `onPct` gets the download progress.
 *  'permission': Android's "install unknown apps" setting was opened for this app; try again once it's allowed. */
export async function installUpdate(u: Update, onPct: (pct: number) => void): Promise<InstallResult> {
  const h = await MedTapNative.addListener('updateProgress', (e) => onPct(e.pct));
  try { await MedTapNative.installUpdate({ url: u.url }); return 'started'; }
  catch (e) { return (e as { code?: string }).code === 'permission' ? 'permission' : 'failed'; }
  finally { void h.remove(); }
}
