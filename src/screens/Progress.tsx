import { lazy, Suspense, useState } from 'react';
import { Segmented } from '../components/ui/Field';
import { Body } from './Body/Body';
import { HAS_BODY } from '../edition';

const Trends = lazy(() => import('./Trends/Trends').then((m) => ({ default: m.Trends })));
type View = 'trends' | 'body';

/** Progress (peptide tools on): Trends and Body behind one tab, so Protocol can have its own. */
export function Progress() {
  const [view, setView] = useState<View>(() => {
    try { return (localStorage.getItem('progressView') as View) || 'trends'; } catch { return 'trends'; }
  });
  const pick = (v: View) => { setView(v); try { localStorage.setItem('progressView', v); } catch { /* per-device preference only */ } };
  return (
    <div className="space-y-4">
      <Segmented<View> label="Show" value={view} onChange={pick}
        options={[{ value: 'trends', label: 'Trends' }, { value: 'body', label: HAS_BODY ? 'Body' : 'Vitals' }]} />
      {view === 'trends'
        ? <Suspense fallback={<div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />}><Trends /></Suspense>
        : <Body />}
    </div>
  );
}
