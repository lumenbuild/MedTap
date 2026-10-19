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
