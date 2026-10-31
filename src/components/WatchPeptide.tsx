// The watch on Protocol: sleep on nights after a dose against nights without (DSIP, Epitalon and other sleep peptides),
// and, for a weekly shot, resting heart rate and HRV by days since the shot and by dose.
import type { Dose, Medication } from '../db/schema';
import type { ScheduleSettings } from '../logic/schedule';
import { courseSleep, shotWeek } from '../logic/watchSignals';
import { guideFor } from '../logic/peptideGuide';
import { inGroup } from '../logic/interactions';
import { fmtAmount } from '../logic/format';
import { personOf } from '../db/repos/people';
import { useDaily } from '../app/data';

const SLEEP_PEPTIDES = ['dsip', 'epitalon'];

export function WatchPeptide({ med, doses, now, s }: { med: Medication; doses: Dose[]; now: number; s: ScheduleSettings }) {
  const all = useDaily();
  if (!all) return null;
  const daily = all.filter((d) => personOf(d) === personOf(med));
  const g = guideFor(med.name);
  const cs = g && SLEEP_PEPTIDES.includes(g.id) ? courseSleep(med, doses, daily, now, s) : null;
  const weekly = med.schedule.type === 'fixed' && !!med.schedule.days?.length && med.schedule.days.length <= 3;
  const sw = weekly && (inGroup(med, 'glp1') || g?.id === 'retatrutide') ? shotWeek(med, doses, daily, now, s) : null;
  if (!cs && !sw) return null;
  return (
    <>
      {cs && (
        <section aria-labelledby={`cs-${med.id}`} className="space-y-2">
          <h3 id={`cs-${med.id}`} className="text-sm font-medium text-muted">Sleep from your watch</h3>
          <p className="text-[15px] leading-snug">{cs.lines.length ? `Nights after a dose against other nights: ${cs.lines.join('; ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}.` : 'No clear difference yet between nights after a dose and other nights.'}</p>
          <table className="w-full text-sm tnum">
            <caption className="sr-only">Sleep on nights after a dose and on other nights</caption>
            <thead><tr className="text-muted"><th scope="col" className="text-left font-normal" /><th scope="col" className="text-right font-normal">After a dose ({cs.on.nights})</th><th scope="col" className="text-right font-normal">Other nights ({cs.off.nights})</th></tr></thead>
            <tbody>
              {cs.on.sleepH !== undefined && <tr className="border-t border-border"><th scope="row" className="text-left font-normal py-1.5">Asleep</th><td className="text-right">{cs.on.sleepH} h</td><td className="text-right">{cs.off.sleepH ?? '–'} h</td></tr>}
              {cs.on.deepMin !== undefined && <tr className="border-t border-border"><th scope="row" className="text-left font-normal py-1.5">Deep sleep</th><td className="text-right">{cs.on.deepMin} min</td><td className="text-right">{cs.off.deepMin ?? '–'} min</td></tr>}
              {cs.on.wakes !== undefined && <tr className="border-t border-border"><th scope="row" className="text-left font-normal py-1.5">Times awake</th><td className="text-right">{cs.on.wakes}</td><td className="text-right">{cs.off.wakes ?? '–'}</td></tr>}
            </tbody>
          </table>
        </section>
      )}
      {sw && (
        <section aria-labelledby={`sw-${med.id}`} className="space-y-2">
          <h3 id={`sw-${med.id}`} className="text-sm font-medium text-muted">Resting heart rate through the week</h3>
          <p className="text-[15px] leading-snug">{sw.swing
            ? `Highest ${sw.swing.high === 0 ? 'on shot day' : `${sw.swing.high} day${sw.swing.high === 1 ? '' : 's'} after a shot`}, ${sw.swing.bpm} bpm over ${sw.swing.low === 0 ? 'shot day' : `day ${sw.swing.low}`}.`
            : 'Steady through the week: no clear rise after a shot.'}</p>
          <ShotWeekBars byDay={sw.byDay} />
          {sw.byDose.length > 1 && (
            <p className="text-sm tnum">By dose: {sw.byDose.map((d) => `${fmtAmount(d.dose, med.unit)} ${d.rhr ?? '–'} bpm${d.hrv ? ` · HRV ${d.hrv} ms` : ''}`).join('; ')}</p>
          )}
        </section>
      )}
    </>
  );
}

/** Resting heart rate by day since the shot, as columns with the value on top; HRV underneath where there is one. */
function ShotWeekBars({ byDay }: { byDay: { day: number; rhr?: number; hrv?: number; n: number }[] }) {
  const vals = byDay.map((d) => d.rhr).filter((v): v is number => v !== undefined);
  if (!vals.length) return null;
  const lo = Math.min(...vals) - 3, hi = Math.max(...vals) + 1;
  return (
    <div className="grid gap-1.5 tnum" style={{ gridTemplateColumns: `repeat(${byDay.length}, minmax(0, 1fr))` }} role="img"
      aria-label={`Resting heart rate by day since the shot: ${byDay.map((d) => `day ${d.day} ${d.rhr ?? 'no data'}`).join(', ')}`}>
      {byDay.map((d) => (
        <div key={d.day} className="flex flex-col items-center">
          <span className="text-[12px] font-semibold">{d.rhr ?? '–'}</span>
          <div className="w-full max-w-[24px] h-16 flex items-end">
            <div className="w-full rounded-t-[4px]" style={{ height: d.rhr !== undefined ? `${Math.max(8, ((d.rhr - lo) / (hi - lo)) * 100)}%` : 0, background: 'var(--primary)' }} />
          </div>
          <span className="text-[11px] text-muted mt-1">{d.day === 0 ? 'Shot' : `+${d.day}`}</span>
          {d.hrv !== undefined && <span className="text-[11px] text-muted">{d.hrv} ms</span>}
        </div>
      ))}
    </div>
  );
}
