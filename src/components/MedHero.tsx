// A medicine's page, at the top: when the next dose is, how much, and Log. In the meds colour, like Today's headline.
import type { Medication } from '../db/schema';
import { useDaily, useDoses, useFamily, useScheduleSettings } from '../app/data';
import { personOf } from '../db/repos/people';
import { MedEffectsCard } from './HealthCards';
import { useNow } from '../app/useNow';
import { getDosesToday, getExpectedAmount, getNextDue, getStatus } from '../logic/schedule';
import { fmtAmount, fmtTime, fmtWhen } from '../logic/format';
import { go } from '../app/router';
import { requestLog } from '../app/pendingLog';

export function MedHero({ med }: { med: Medication }) {
  const doses = useDoses(); const ss = useScheduleSettings();
  const now = useNow(60_000);
  if (!doses || !ss) return null;
  const [, s] = ss;
  const mine = doses.filter((d) => d.medicationId === med.id && !d.deletedAt);
  const status = getStatus(med, mine, now, s);
  const next = getNextDue(med, mine, now, s);
  const today = getDosesToday(mine, med.id, now, s).filter((d) => !d.skipped);
  const last = [...mine].filter((d) => !d.skipped).sort((a, b) => b.takenAt.localeCompare(a.takenAt))[0];
  const prn = med.schedule.type === 'prn';
  const amount = getExpectedAmount(med, mine, next ?? now, s);
  const label = prn ? 'As needed' : status === 'due' ? 'Due now' : status === 'done-today' ? 'Done for today' : 'Next dose';
  const big = prn ? (last ? `Last ${fmtTime(Date.parse(last.takenAt))}` : 'Not taken yet') : status === 'due' ? 'Now' : next ? fmtWhen(next, now).replace(/^./, (c) => c.toUpperCase()) : '—';
  const sub = [fmtAmount(amount, med.unit), today.length ? `${today.length} taken today` : null].filter(Boolean).join(' · ');
  return (
    <section className="hero" aria-label={`${label}: ${big}`}>
      <p className="hero-label">{label}</p>
      <p className="mt-1 text-[34px] leading-[38px] font-bold tracking-[-0.02em] tnum">{big}</p>
      <p className="mt-1 text-muted text-[15px] tnum">{sub}</p>
      <button type="button" className="hero-btn mt-4 w-full min-h-[52px] rounded-btn font-semibold text-[17px]" onClick={() => { go('/today'); requestLog(med.id); }}>Log dose</button>
    </section>
  );
}

/** A medicine's page: what moved in the watch's numbers since starting it. */
export function MedBodyEffects({ med }: { med: Medication }) {
  const doses = useDoses(); const daily = useDaily(); const fam = useFamily();
  const now = useNow(3_600_000);
  if (!doses || !daily || !fam) return null;
  return <MedEffectsCard med={med} doses={doses.filter((d) => d.medicationId === med.id)} daily={daily.filter((d) => !d.deletedAt && personOf(d) === fam.personId)} now={now} />;
}
