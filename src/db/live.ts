import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';

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
