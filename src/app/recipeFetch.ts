// Fetching a recipe page from the phone itself (its own connection, as a browser would), so sites that block servers
// still answer. Only in the Android and iPhone apps: a web page can't read another site.
import { CapacitorHttp } from '@capacitor/core';
import { isNative } from '../nfc/native';
import { parseRecipePage, type ImportedRecipe } from '../logic/recipeImport';

export type RecipeFetch = { ok: true; recipe: ImportedRecipe } | { ok: false; reason: 'web' | 'blocked' | 'offline' | 'not-found' };

export async function fetchRecipe(url: string): Promise<RecipeFetch> {
  if (!isNative) return { ok: false, reason: 'web' };
  try {
    const r = await CapacitorHttp.get({ url, responseType: 'text', connectTimeout: 15000, readTimeout: 20000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 15; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
        Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-AU,en;q=0.9' } });
    if (r.status === 403 || r.status === 429) return { ok: false, reason: 'blocked' };
    if (r.status >= 400) return { ok: false, reason: 'not-found' };
    const html = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    if (/access denied|captcha|are you a robot/i.test(html.slice(0, 2000))) return { ok: false, reason: 'blocked' };
    return { ok: true, recipe: parseRecipePage(html) };
  } catch {
    return { ok: false, reason: 'offline' };
  }
}
