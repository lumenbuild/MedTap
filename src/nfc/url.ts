// ┌────────────────────────────────────────────────────────────────────────────┐
// │ TAG URL FORMAT — DO NOT CHANGE.                                            │
// │ Every physical tag has this URL written on it permanently:                 │
// │     https://APP_DOMAIN/?t=<TAG_ID>                                         │
// │ Changing the parameter name, the path, or the domain breaks every tag      │
// │ people have already stuck on their medication.                             │
// └────────────────────────────────────────────────────────────────────────────┘
export const TAG_PARAM = 't';

/** Where tag URLs point. Set VITE_TAG_BASE (e.g. https://meds.example.com/) for production builds. */
export function tagBase(): string {
  const env = import.meta.env.VITE_TAG_BASE as string | undefined;
  if (env) return env.endsWith('/') ? env : env + '/';
  if (typeof location === 'undefined') return '/';
  return `${location.origin}${import.meta.env.BASE_URL}`;
}

/** True when tags written now would point at a temporary test address rather than the final domain. */
export const isTemporaryTagBase = () => !import.meta.env.VITE_TAG_BASE;

export function tagUrl(id: string, base = tagBase()): string {
  return `${base}?${TAG_PARAM}=${id}`;
}

/** Read the tag ID from a query string. Lenient on purpose: we only generate 8-char IDs,
 *  but accept any URL-safe ID so a tag is never silently ignored. */
export function parseTagParam(search: string): string | null {
  const t = new URLSearchParams(search).get(TAG_PARAM);
  if (t === null) return null;
  const id = t.trim();
  return /^[A-Za-z0-9_-]{4,32}$/.test(id) ? id : '';
}

/** Pull a tag ID back out of a full URL read from a tag. */
export function tagIdFromUrl(url: string): string | null {
  try { return parseTagParam(new URL(url).search); } catch { return null; }
}
