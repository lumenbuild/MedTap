// Body: the health markers in one place, each with its latest value and how it's moved since the first (see
// logic/markers). A height turns on waist-to-height and BMI.
import { useState } from 'react';
import { format } from 'date-fns';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { BodyEntry, DailyHealth, LabResult, Vital } from '../db/schema';
import type { Units } from '../db/repos/settings';
import { healthMarkers } from '../logic/markers';
import { setHeight } from '../db/repos/training';
import { useToast } from '../app/toast';
import { TextInput } from './ui/Field';
import { Button } from './ui/Button';

const TONE = { good: 'var(--success)', watch: 'var(--caution)', plain: 'var(--text-muted)' };

export function MarkersCard({ personId, heightCm, labs, vitals, body, daily, units, now }: {
  personId: string; heightCm?: number; labs: LabResult[]; vitals: Vital[]; body: BodyEntry[]; daily: DailyHealth[]; units: Units; now: number;
}) {
  const toast = useToast();
  const [h, setH] = useState('');
  const list = healthMarkers({ labs, vitals, body, daily }, heightCm, now);
  const imperial = units === 'imperial';
  if (!list.length && heightCm) return null;
  return (
    <section className="border-t border-border pt-5 pb-1" aria-labelledby="mk-h">
      <h2 id="mk-h" className="text-sm font-medium text-muted mb-1">Health markers</h2>
      {list.length > 0 && (
        <ul className="divide-y divide-border">
          {list.map((m) => {
            const Arrow = m.better === undefined ? Minus : (m.better ? m.key !== 'hdl' : m.key === 'hdl') ? ArrowDownRight : ArrowUpRight;
            return (
              <li key={m.key} className="py-2.5 flex items-start gap-3">
                <span className="flex-1 min-w-0">
                  <span className="block font-medium">{m.label}</span>
                  {m.note && <span className="block text-sm" style={{ color: TONE[m.tone] }}>{m.note}</span>}
                  {m.first && <span className="block text-xs text-muted tnum">From {m.first} ({format(m.firstAt!, 'd MMM yyyy')})</span>}
                </span>
                <span className="text-right shrink-0 tnum">
                  <span className="flex items-center justify-end gap-1">
                    {m.first && <Arrow size={16} aria-hidden="true" style={{ color: m.better === undefined ? 'var(--text-muted)' : m.better ? 'var(--success)' : 'var(--caution)' }} />}
                    <span className="text-[20px] font-semibold">{m.latest}</span>{m.unit && <span className="text-sm text-muted">{m.unit}</span>}
                  </span>
                  <span className="block text-xs text-muted">{format(m.at, 'd MMM')}{m.first ? (m.better === undefined ? ' · same' : m.better ? ' · better' : ' · worse') : ''}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {list.length === 0 && <p className="text-[15px] text-muted">Blood pressure, resting heart rate and lab results (HbA1c, glucose, cholesterol) show here as you add them, each against where it started.</p>}
      {!heightCm && (
        <div className="flex gap-2 items-end mt-2">
          <div className="flex-1"><TextInput label={`Your height (${imperial ? 'inches' : 'cm'}), for waist-to-height and BMI`} type="number" inputMode="decimal" min="0" step="any" value={h} onChange={(e) => setH(e.target.value)} /></div>
          <Button variant="secondary" disabled={!(Number(h) > 0)} onClick={async () => { const cm = imperial ? Number(h) * 2.54 : Number(h); await setHeight(personId, Math.round(cm * 10) / 10); toast('Height saved'); }}>Save</Button>
        </div>
      )}
    </section>
  );
}
