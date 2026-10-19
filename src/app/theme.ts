export type Theme = 'system' | 'light' | 'dark';

export function getTheme(): Theme {
  try { return (localStorage.getItem('theme') as Theme) || 'system'; } catch { return 'system'; }
}

// Theme is a per-device display preference, so localStorage is fine here (records still live in IndexedDB).
export function setTheme(t: Theme) {
  try { t === 'system' ? localStorage.removeItem('theme') : localStorage.setItem('theme', t); } catch { /* ignore */ }
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}
