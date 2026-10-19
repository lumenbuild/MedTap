import { useEffect, useState } from 'react';

/** Current time, refreshed every `ms` and whenever the app comes back to the foreground.
 *  Timers always render from timestamps (now − takenAt); nothing is accumulated. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, ms);
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', tick); };
  }, [ms]);
  return now;
}
