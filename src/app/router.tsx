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

/** Navigate without leaving a history entry (so Back doesn't return to a finished flow). */
export const replace = (path: string) => {
  window.location.replace(`${window.location.pathname}${window.location.search}#${path}`);
};

export type Route =
  | { name: 'today' } | { name: 'trends' } | { name: 'body' } | { name: 'settings' }
  | { name: 'backup' } | { name: 'report' } | { name: 'help'; topic?: string }
  | { name: 'meds' } | { name: 'medNew'; tagId?: string } | { name: 'med'; id: string }
  | { name: 'tag'; id: string };

export function parseRoute(path: string): Route {
  const [, a, b, c, d] = path.split('/').map(decodeURIComponent);
  switch (a) {
    case 'trends': return { name: 'trends' };
    case 'body': return { name: 'body' };
    case 'settings': return { name: 'settings' };
    case 'backup': return { name: 'backup' };
    case 'report': return { name: 'report' };
    case 'help': return { name: 'help', topic: b || undefined };
    case 'tag': return { name: 'tag', id: b ?? '' };
    case 'meds':
      if (b === 'new') return { name: 'medNew', tagId: c === 'tag' ? d : undefined };
      if (b) return { name: 'med', id: b };
      return { name: 'meds' };
    default: return { name: 'today' };
  }
}
