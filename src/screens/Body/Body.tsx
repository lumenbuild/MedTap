import { useState } from 'react';
import { format } from 'date-fns';
import { ChevronRight, Ruler, Scale } from 'lucide-react';
import { useBodyEntries, useFamily, useSettings } from '../../app/data';
import { personOf } from '../../db/repos/people';
import { PersonSwitcher } from '../../components/PersonSwitcher';
import { fmtLength, fmtWeight, MEASUREMENTS } from '../../logic/units';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { BodySheet, todayYmd, type BodySheetState } from '../../components/BodySheets';
import { ProgressPhotos } from './ProgressPhotos';

const fmtYmd = (ymd: string) => (ymd === todayYmd() ? 'Today' : format(new Date(`${ymd}T12:00`), 'EEE d MMM yyyy'));

export function Body() {
  const settings = useSettings();
  const all = useBodyEntries();
  const fam = useFamily();
  const [sheet, setSheet] = useState<BodySheetState>(null);
  if (!settings || !all || !fam) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;

  const units = settings.units;
  const entries = all.filter((b) => !b.deletedAt && personOf(b) === fam.personId).sort((a, b) => b.date.localeCompare(a.date));
  const latestWeight = entries.find((e) => e.weightKg !== undefined);
  const latestOf = (k: (typeof MEASUREMENTS)[number]['key']) => entries.find((e) => e[k] !== undefined);
  const measured = MEASUREMENTS.map((m) => ({ ...m, entry: latestOf(m.key) })).filter((m) => m.entry);

  return (
    <div className="space-y-4">
      <PersonSwitcher />
      <Card>
        <div className="flex items-center gap-2 text-muted"><Scale size={18} aria-hidden="true" /><h2 className="font-semibold">Weight</h2></div>
        {latestWeight ? (
          <p className="mt-2"><span className="text-[40px] leading-[44px] font-semibold tnum">{fmtWeight(latestWeight.weightKg!, units)}</span>
            <span className="block text-muted">{fmtYmd(latestWeight.date)}</span></p>
        ) : <p className="mt-1">No weight logged yet. It takes a few seconds.</p>}
        <Button className="w-full min-h-[56px] mt-4" onClick={() => setSheet({ kind: 'weight' })}>Log weight</Button>
      </Card>

      <Card>
        <div className="flex items-center gap-2 text-muted"><Ruler size={18} aria-hidden="true" /><h2 className="font-semibold">Measurements</h2></div>
        {measured.length ? (
          <dl className="mt-3 grid grid-cols-2 gap-3">
            {measured.map((m) => (
              <div key={m.key}>
                <dt className="text-sm text-muted">{m.label}</dt>
                <dd className="font-semibold tnum">{fmtLength(m.entry![m.key]!, units)} <span className="text-xs text-muted font-normal">{fmtYmd(m.entry!.date)}</span></dd>
              </div>
            ))}
          </dl>
        ) : <p className="mt-1">Log any of waist, hips, chest, neck, upper arm, thigh or calf. Only the ones you want.</p>}
        <Button variant="secondary" className="w-full mt-4" onClick={() => setSheet({ kind: 'measure' })}>Add measurements</Button>
      </Card>

      <ProgressPhotos personId={fam.personId} />

      {entries.length > 0 && (
        <Card>
          <h2 className="text-lg font-semibold">History</h2>
          <ul className="mt-2 -mx-2">
            {entries.slice(0, 60).map((e) => {
              const n = MEASUREMENTS.filter((m) => e[m.key] !== undefined).length;
              return (
                <li key={e.id}>
                  <button onClick={() => setSheet({ kind: 'edit', entry: e })} className="w-full min-h-[56px] flex items-center gap-3 px-2 rounded-btn text-left hover:bg-surface-2">
                    <span className="flex-1">
                      <span className="block font-medium">{fmtYmd(e.date)}</span>
                      <span className="block text-sm text-muted tnum">
                        {[e.weightKg !== undefined ? fmtWeight(e.weightKg, units) : null, n ? `${n} measurement${n === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <ChevronRight size={18} className="text-muted" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card className="bg-primary-soft shadow-none">
        <p className="text-sm">Weigh at the same time of day, ideally in the morning before eating, for the most useful trends.</p>
      </Card>

      <BodySheet state={sheet} onClose={() => setSheet(null)} units={units} personId={fam.personId} />
    </div>
  );
}
