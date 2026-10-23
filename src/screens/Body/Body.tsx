import { useState } from 'react';
import { Sparkline } from '../../components/ui/Visual';
import { format } from 'date-fns';
import { ChevronRight, Ruler, Scale } from 'lucide-react';
import { useBodyEntries, useDoses, useFamily, useMeds, useSettings } from '../../app/data';
import { medIsFor } from '../../db/repos/people';
import { MuscleWatchCard } from '../../components/Fitness';
import { personOf } from '../../db/repos/people';
import { PersonSwitcher } from '../../components/PersonSwitcher';
import { fmtLength, fmtWeight, MEASUREMENTS } from '../../logic/units';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { BodySheet, todayYmd, type BodySheetState } from '../../components/BodySheets';
import { ProgressPhotos } from './ProgressPhotos';
import { VitalsCard } from './VitalsCard';
import { GoalsSection } from './Goals';
import { useNow } from '../../app/useNow';
import { HAS_BODY } from '../../edition';
import { fmtYmdDay } from '../../logic/format';

const fmtYmd = (ymd: string) => (ymd === todayYmd() ? 'Today' : fmtYmdDay(ymd));

export function Body() {
  const settings = useSettings();
  const all = useBodyEntries();
  const fam = useFamily();
  const meds = useMeds();
  const doses = useDoses();
  const [sheet, setSheet] = useState<BodySheetState>(null);
  const now = useNow(60_000);
  if (!settings || !all || !fam || !meds || !doses) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;

  if (!HAS_BODY) return (
    <div className="space-y-4">
      <PersonSwitcher />
      <VitalsCard personId={fam.personId} />
    </div>
  );

  const units = settings.units;
  const entries = all.filter((b) => !b.deletedAt && personOf(b) === fam.personId).sort((a, b) => b.date.localeCompare(a.date));
  const latestWeight = entries.find((e) => e.weightKg !== undefined);
  const weights = entries.filter((e) => e.weightKg !== undefined && Date.parse(`${e.date}T12:00`) > now - 60 * 86_400_000).map((e) => ({ t: Date.parse(`${e.date}T12:00`), v: e.weightKg! })).reverse();
  const latestOf = (k: (typeof MEASUREMENTS)[number]['key']) => entries.find((e) => e[k] !== undefined);
  const measured = MEASUREMENTS.map((m) => ({ ...m, entry: latestOf(m.key) })).filter((m) => m.entry);
  const latestComp = entries.find((e) => e.bodyFatPct !== undefined || e.leanKg !== undefined || e.muscleKg !== undefined);
  const peptide = settings.peptideTools ? meds.find((m) => m.peptide && !m.archived && medIsFor(m, fam.personId)) : undefined;

  return (
    <div className="space-y-4">
      <PersonSwitcher />
      <Card>
        <div className="flex items-center gap-2 text-muted"><Scale size={18} aria-hidden="true" /><h2 className="text-sm font-medium text-muted">Weight</h2></div>
        {latestWeight ? (
          <>
            <p className="mt-2"><span className="text-[40px] leading-[44px] font-semibold tnum">{fmtWeight(latestWeight.weightKg!, units)}</span>
              <span className="block text-muted">{fmtYmd(latestWeight.date)}</span></p>
            {weights.length >= 3 && (
              <a href="#/progress" className="block mt-3" aria-label="Weight over the last 60 days, open the chart">
                <Sparkline points={weights} height={44} label={`Weight over the last 60 days: ${fmtWeight(weights[0].v, units)} to ${fmtWeight(weights[weights.length - 1].v, units)}`} />
                <span className="flex justify-between text-xs text-muted tnum mt-0.5" aria-hidden="true"><span>{format(weights[0].t, 'd MMM')}: {fmtWeight(weights[0].v, units)}</span><span>Today</span></span>
              </a>
            )}
          </>
        ) : <p className="mt-1">No weight logged yet. It takes a few seconds.</p>}
        <Button className="w-full min-h-[56px] mt-4" onClick={() => setSheet({ kind: 'weight' })}>Log weight</Button>
      </Card>

      <GoalsSection personId={fam.personId} goals={fam.people.find((p) => p.id === fam.personId)?.goals ?? []} entries={entries} units={units} now={now} />

      <Card>
        <div className="flex items-center gap-2 text-muted"><Ruler size={18} aria-hidden="true" /><h2 className="text-sm font-medium text-muted">Measurements</h2></div>
        {measured.length ? (
          <dl className="mt-3 grid grid-cols-2 gap-3">
            {measured.map((m) => (
              <div key={m.key}>
                <dt className="text-sm text-muted">{m.label}</dt>
                <dd className="font-semibold tnum">{fmtLength(m.entry![m.key]!, units)} <span className="text-xs text-muted font-normal">{fmtYmd(m.entry!.date)}</span></dd>
              </div>
            ))}
          </dl>
        ) : <p className="mt-1">Log any of waist, hips, chest, neck, upper arm, thigh or calf, and body fat or lean mass if you have them. Only the ones you want.</p>}
        {latestComp && (
          <p className="mt-3 text-[15px] tnum">
            {[latestComp.bodyFatPct !== undefined ? `Body fat ${latestComp.bodyFatPct}%` : null, latestComp.leanKg !== undefined ? `lean ${fmtWeight(latestComp.leanKg, units)}` : null,
              latestComp.muscleKg !== undefined ? `muscle ${fmtWeight(latestComp.muscleKg, units)}` : null].filter(Boolean).join(' · ')}
            <span className="text-xs text-muted"> {fmtYmd(latestComp.date)}</span>
          </p>
        )}
        <Button variant="secondary" className="w-full mt-4" onClick={() => setSheet({ kind: 'measure' })}>Add measurements or body fat</Button>
      </Card>

      {entries.some((e) => e.bodyFatPct !== undefined || e.leanKg !== undefined) && <MuscleWatchCard body={entries} units={units} med={peptide} doses={doses} now={now} />}

      <VitalsCard personId={fam.personId} />

      <ProgressPhotos personId={fam.personId} />

      {entries.length > 0 && (
        <Card>
          <h2 className="text-sm font-medium text-muted">History</h2>
          <ul className="mt-2 -mx-2">
            {entries.slice(0, 60).map((e) => {
              const n = MEASUREMENTS.filter((m) => e[m.key] !== undefined).length + (e.bodyFatPct !== undefined || e.leanKg !== undefined || e.muscleKg !== undefined ? 1 : 0);
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
