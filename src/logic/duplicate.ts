// A second tap on the same log, a minute or less after the first, is the same entry, not a new one: a slow screen or a
// missed response makes it easy to tap twice. The log functions return the first entry, marked `duplicate`, and the
// screen says it's already logged (with "Log again" for the rare time it really was twice).

/** How soon after the first a matching log counts as the same tap. */
export const SAME_TAP_MS = 60_000;
/** How close the two times have to be (a log can be backdated). */
export const SAME_TIME_MS = 2 * 60_000;

const SKIP = new Set(['id', 'createdAt', 'updatedAt', 'deletedAt', 'at', 'takenAt', 'waterMl', 'duplicate']);

/** What a record says, apart from its id, stamps and time: two logs with the same fingerprint say the same thing. */
export function fingerprint(r: object): string {
  const e = Object.entries(r).filter(([k, v]) => !SKIP.has(k) && v !== undefined && v !== null && v !== false && v !== '' && !(Array.isArray(v) && !v.length));
  e.sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(e.map(([k, v]) => [k, Array.isArray(v) ? [...v].sort() : v]));
}

/** The earlier entry this one repeats, if any. */
export function sameTap<T extends { createdAt: string; deletedAt?: string }, N extends object>(rows: T[], next: N, nextAt: string, atOf: (r: T) => string,
  fp: (r: T | N) => string = fingerprint, now = Date.now()): T | undefined {
  const want = fp(next);
  const t = Date.parse(nextAt);
  return rows.find((r) => !r.deletedAt && now - Date.parse(r.createdAt) < SAME_TAP_MS && Math.abs(Date.parse(atOf(r)) - t) <= SAME_TIME_MS && fp(r) === want);
}
