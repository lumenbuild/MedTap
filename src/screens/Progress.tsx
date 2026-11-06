import { lazy, Suspense, useEffect, useState } from 'react';
import { Segmented } from '../components/ui/Field';
import { Body } from './Body/Body';
import { HAS_BODY } from '../edition';

const Trends = lazy(() => import('./Trends/Trends').then((m) => ({ default: m.Trends })));
type View = 'trends' | 'body';

/** Body (MedTap's tab): body first, with Trends beside it. */
export function Progress({ view: asked }: { view?: View }) {
  const [view, setView] = useState<View>(() => {
    if (asked) return asked;
    try { return (localStorage.getItem('progressView') as View) || (HAS_BODY ? 'body' : 'trends'); } catch { return HAS_BODY ? 'body' : 'trends'; }
  });
  useEffect(() => { if (asked) setView(asked); }, [asked]);
  const pick = (v: View) => { setView(v); try { localStorage.setItem('progressView', v); } catch { /* per-device preference only */ } };
  return (
    <div className="space-y-4">
      <Segmented<View> label="Show" value={view} onChange={pick}
        options={[{ value: 'body', label: HAS_BODY ? 'Body' : 'Vitals' }, { value: 'trends', label: 'Trends' }]} />
      {view === 'trends'
        ? <Suspense fallback={<div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />}><Trends /></Suspense>
        : <Body />}
    </div>
  );
}
