// "When and how to take it" on a medicine's page, and "Supplements and timing" on the Meds list: what to avoid together,
// keep apart and pair, daily totals against upper limits, and notes before a blood test.
import { Clock, Sparkles } from 'lucide-react';
import type { Medication } from '../db/schema';
import { db } from '../db/db';
import { personOf, medIsFor } from '../db/repos/people';
import { useAppointments, useCheckIns, useDaily, useDoses, useFamily, useMeds, useScheduleSettings } from '../app/data';
import { useNow } from '../app/useNow';
import { useToast } from '../app/toast';
import { howToTake } from '../logic/howToTake';
import { isStimulant } from '../logic/stimulant';
import { bloodTestSoon, dailyTotals, supplementRules, supplementsOf } from '../logic/supplements';
import { Switch } from './ui/Switch';

export function HowToTakeCard({ med, onPeptidePage = false }: { med: Medication; onPeptidePage?: boolean }) {
  const meds = useMeds(); const doses = useDoses(); const checkIns = useCheckIns(); const daily = useDaily(); const ss = useScheduleSettings();
  const now = useNow(600_000);
  const toast = useToast();
  if (!meds || !doses || !checkIns || !daily || !ss || med.archived) return null;
  const who = personOf(med);
  const me = <T extends { personId?: string }>(x: T) => personOf(x) === who;
  const advice = howToTake(med, { meds: meds.filter((m) => medIsFor(m, who)), doses, checkIns: checkIns.filter(me), daily: daily.filter(me) }, now, ss[1]).filter((a) => !(onPeptidePage && a.shownOnPeptide));
  const canFollow = med.schedule.type === 'fixed' && !med.peptide && (isStimulant(med) || supplementsOf(med).length > 0 || (med.schedule.slots?.[0]?.time ?? '99') < '11:00');
  if (!advice.length && !canFollow) return null;
  return (
    <section aria-labelledby={`how-${med.id}`} className="border-t border-border pt-5 space-y-2">
      <h2 id={`how-${med.id}`} className="text-sm font-medium text-muted">When and how to take it</h2>
      <ul className="space-y-1.5">
        {advice.map((a) => (
          <li key={a.text} className="flex gap-2.5 leading-snug">
            {a.yours ? <Sparkles size={16} aria-label="From your records" className="shrink-0 mt-0.5 text-primary" /> : <Clock size={16} aria-hidden="true" className="shrink-0 mt-0.5 text-muted" />}
            <span>{a.text}</span>
          </li>
        ))}
      </ul>
      {canFollow && (
        <Switch label="First reminder follows when I wake" checked={med.followWakeMin !== undefined}
          onChange={async (v) => { await db.medications.update(med.id, { followWakeMin: v ? 30 : undefined, updatedAt: new Date().toISOString() }); toast(v ? 'Reminds 30 minutes after the watch says you woke' : 'Back to the set time'); }}>
          30 minutes after the watch says you woke, on days that’s known by then (and within 3 hours of the set time).
        </Switch>
      )}
    </section>
  );
}

const KIND = { avoid: 'Avoid together', apart: 'Keep apart', pair: 'Goes well together', lab: 'Before a blood test' } as const;

export function SupplementsSection() {
  const meds = useMeds(); const doses = useDoses(); const appts = useAppointments(); const fam = useFamily(); const ss = useScheduleSettings();
  const now = useNow(600_000);
  if (!meds || !doses || !fam || !ss) return null;
  const mine = meds.filter((m) => !m.archived && medIsFor(m, fam.personId));
  const sups = mine.filter((m) => supplementsOf(m).length);
  if (!sups.length) return null;
  const rules = supplementRules(mine, { bloodTestSoon: bloodTestSoon((appts ?? []).filter((a) => personOf(a) === fam.personId), now) });
  const totals = dailyTotals(mine, doses, now, ss[1]);
  return (
    <section aria-labelledby="sup-h" className="border-t border-border pt-4 space-y-3">
      <h2 id="sup-h" className="text-sm font-medium text-muted">Supplements and timing</h2>
      {(['avoid', 'apart', 'pair', 'lab'] as const).map((k) => {
        const rs = rules.filter((r) => r.kind === k);
        return rs.length > 0 && (
          <div key={k}>
            <h3 className={`text-sm font-semibold ${k === 'avoid' ? 'text-caution' : ''}`}>{KIND[k]}</h3>
            <ul className="mt-0.5 space-y-1 text-[15px] leading-snug">{rs.map((r) => <li key={r.id}>{r.text}</li>)}</ul>
          </div>
        );
      })}
      {totals.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">A day, against the upper limit</h3>
          <ul className="mt-0.5 space-y-1 text-[15px] tnum">
            {totals.map((t) => <li key={t.key} className="flex justify-between gap-3"><span>{t.name}</span><span className={t.over ? 'text-caution font-semibold' : ''}>{t.perDay} of {t.ul} {t.per}{t.what ? ` (${t.what})` : ''}</span></li>)}
          </ul>
        </div>
      )}
      <p className="text-[12px] text-muted">From product information and Australian/NZ nutrient reference values. Tap a supplement for its best time to take.</p>
    </section>
  );
}
