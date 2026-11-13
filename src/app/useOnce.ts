import { useCallback, useRef } from 'react';

/** One log at a time from a screen: while one is saving (and for a moment after, so a bounce of the finger doesn't
 *  count), further taps do nothing. Wrap each log button's handler: `const once = useOnce(); onClick={once(addWater)}`. */
export function useOnce(settleMs = 700) {
  const busy = useRef(false);
  return useCallback(<A extends unknown[]>(fn: (...args: A) => unknown) => async (...args: A) => {
    if (busy.current) return;
    busy.current = true;
    try { await fn(...args); } finally { setTimeout(() => { busy.current = false; }, settleMs); }
  }, [settleMs]);
}
