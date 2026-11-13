import { liveQuery } from 'dexie';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/** Subscribe to a Dexie query; re-renders whenever the data it reads changes. `undefined` while loading. */
export function useLive<T>(query: () => Promise<T> | T, deps: unknown[] = []): T | undefined {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    const sub = liveQuery(query).subscribe({ next: (v) => setValue(() => v), error: (e) => console.error(e) });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

// ── Shared queries ──────────────────────────────────────────────────────────────────────────────────
// A whole table read once for the whole app, however many cards show it. Every card gets the same array (so work
// done on it can be reused), the table is read again only when it changes, and a screen opened soon after another
// finds it already loaded.

interface Entry { value: unknown; loaded: boolean; listeners: Set<() => void>; stop?: () => void; idle?: ReturnType<typeof setTimeout> }
const shared = new Map<string, Entry>();
/** How long a query nobody is showing stays live, so moving between screens doesn't read the table again. */
const KEEP_MS = 60_000;

function entry(key: string, query: () => Promise<unknown> | unknown): Entry {
  let e = shared.get(key);
  if (!e) {
    const made: Entry = { value: undefined, loaded: false, listeners: new Set() };
    const sub = liveQuery(query).subscribe({
      next: (v) => { made.value = v; made.loaded = true; made.listeners.forEach((l) => l()); },
      error: (err) => console.error(err),
    });
    made.stop = () => sub.unsubscribe();
    shared.set(key, made);
    e = made;
  }
  return e;
}

/** A query shared app-wide under `key` (the key must change whenever the query would). `undefined` while loading. */
export function useShared<T>(key: string, query: () => Promise<T> | T): T | undefined {
  const subscribe = useCallback((l: () => void) => {
    const e = entry(key, query);
    if (e.idle) { clearTimeout(e.idle); e.idle = undefined; }
    e.listeners.add(l);
    return () => {
      e.listeners.delete(l);
      if (!e.listeners.size) e.idle = setTimeout(() => { if (!e.listeners.size) { e.stop?.(); shared.delete(key); } }, KEEP_MS);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return useSyncExternalStore(subscribe, () => shared.get(key)?.value as T | undefined);
}

/** Remember the last answer: called again with the same inputs (by identity), it returns the same result without
 *  working it out again. Shared by every card that calls it, so the same numbers are worked out once. */
export function memoLast<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  let last: A | undefined;
  let result: R;
  return (...args: A) => {
    if (last && last.length === args.length && args.every((x, i) => Object.is(x, last![i]))) return result;
    result = fn(...args);
    last = args;
    return result;
  };
}
