import { useEffect, useState } from 'react';

// Hash routing: GitHub Pages has no SPA fallback.
export function useHashRoute(): string {
  const read = () => window.location.hash.replace(/^#/, '') || '/today';
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const go = (path: string) => { window.location.hash = path; };

const here = () => window.location.hash.replace(/^#/, '') || '/today';

// The screens visited in this app session, so the Back arrow returns to the screen you came from (the Doctor report
// opened from Meds goes back to Meds, not Trends). A screen opened straight from a tag, link or notification has
// nothing before it, so Back goes to its usual parent instead.
const trail: string[] = [];
let replacing = false;
if (typeof window !== 'undefined') {
  trail.push(here());
  window.addEventListener('hashchange', () => {
    const h = here();
    if (replacing) { replacing = false; trail[trail.length - 1] = h; return; }
    if (trail.length > 1 && trail[trail.length - 2] === h) trail.pop(); // Back (the arrow, the phone's or the browser's)
    else trail.push(h);
  });
}

/** The Back arrow: the previous screen in the app, or `parent` (a #/ link) when there isn't one. */
export function goBack(parent: string) {
  if (trail.length > 1) window.history.back();
  else replace(parent.replace(/^#/, ''));
}

/** Navigate without leaving a history entry (so Back doesn't return to a finished flow). */
export const replace = (path: string) => {
  if (path !== here()) replacing = true;
  window.location.replace(`${window.location.pathname}${window.location.search}#${path}`);
};

export type Route =
  | { name: 'today' } | { name: 'trends' } | { name: 'body' } | { name: 'settings'; section?: string }
  | { name: 'backup' } | { name: 'report' } | { name: 'help'; topic?: string }
  | { name: 'meds' } | { name: 'medNew'; tagId?: string } | { name: 'med'; id: string }
  | { name: 'tag'; id: string } | { name: 'sync' } | { name: 'join'; code: string } | { name: 'calc' } | { name: 'supplies' }
  | { name: 'protocol' } | { name: 'protocolReport' } | { name: 'progress'; view?: 'trends' | 'body' }
  | { name: 'appointments' } | { name: 'appointmentSummary' } | { name: 'labs' } | { name: 'travel' }
  | { name: 'training'; start?: boolean } | { name: 'workout'; id: string } | { name: 'exercise'; id: string } | { name: 'routines' } | { name: 'tags' } | { name: 'welcome' } | { name: 'food' } | { name: 'caffeine' };

export function parseRoute(path: string): Route {
  const [, a, b, c, d] = path.split('/').map(decodeURIComponent);
  switch (a) {
    case 'trends': return { name: 'trends' };
    case 'body': return { name: 'body' };
    case 'settings': return { name: 'settings', section: b || undefined };
    case 'backup': return { name: 'backup' };
    case 'report': return { name: 'report' };
    case 'help': return { name: 'help', topic: b || undefined };
    case 'tag': return { name: 'tag', id: b ?? '' };
    case 'sync': return { name: 'sync' };
    case 'calc': return { name: 'calc' };
    case 'supplies': return { name: 'supplies' };
    case 'protocol': return b === 'report' ? { name: 'protocolReport' } : { name: 'protocol' };
    case 'progress': return { name: 'progress', view: b === 'trends' || b === 'body' ? b : undefined };
    case 'appointments': return b === 'summary' ? { name: 'appointmentSummary' } : { name: 'appointments' };
    case 'labs': return { name: 'labs' };
    case 'tags': return { name: 'tags' };
    case 'welcome': return { name: 'welcome' };
    case 'food': return { name: 'food' };
    case 'caffeine': return { name: 'caffeine' };
    case 'travel': return { name: 'travel' };
    case 'training':
      if (b === 'workout' && c) return { name: 'workout', id: c };
      if (b === 'exercise' && c) return { name: 'exercise', id: c };
      if (b === 'routines') return { name: 'routines' };
      return { name: 'training', ...(b === 'start' ? { start: true } : {}) };
    case 'join': return { name: 'join', code: b ?? '' };
    case 'meds':
      if (b === 'new') return { name: 'medNew', tagId: c === 'tag' ? d : undefined };
      if (b) return { name: 'med', id: b };
      return { name: 'meds' };
    default: return { name: 'today' };
  }
}
