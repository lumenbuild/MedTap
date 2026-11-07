import { useEffect } from 'react';

/** Run the housekeeping in ./maintenance at start, every 5 minutes while open, and whenever the app comes back to the
 *  foreground. Its code (targets, calories, vial stock, auto-backup) loads a moment after start, so it isn't part of
 *  what a tag tap has to load. Planned changes due today are also applied in main.tsx before the first screen. */
export function useMaintenance() {
  useEffect(() => {
    const run = () => {
      if (document.visibilityState !== 'visible') return;
      import('./maintenance').then((m) => m.runMaintenance()).catch((e) => console.error(e));
    };
    run();
    const id = setInterval(run, 5 * 60_000);
    document.addEventListener('visibilitychange', run);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', run); };
  }, []);
}
