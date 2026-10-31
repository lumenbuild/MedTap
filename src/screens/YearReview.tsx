// The year in review (biohacking tools): the last 12 months on one page, printable.
import { format } from 'date-fns';
import { Printer } from 'lucide-react';
import { personOf, medIsFor } from '../db/repos/people';
import { useBodyEntries, useCheckIns, useDaily, useDoses, useFamily, useLabs, useMeds, useWorkouts } from '../app/data';
import { yearReview } from '../logic/bodyhack';
import { shownName } from '../logic/privacy';
import { Button } from '../components/ui/Button';
import { Stat } from '../components/ui/Visual';

export function YearReview() {
  const meds = useMeds(); const doses = useDoses(); const body = useBodyEntries(); const daily = useDaily(); const checkIns = useCheckIns(); const workouts = useWorkouts(); const labs = useLabs(); const fam = useFamily();
  if (!meds || !doses || !body || !daily || !checkIns || !workouts || !labs || !fam) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const me = <T extends { personId?: string }>(x: T) => personOf(x) === fam.personId;
  const y = yearReview({ meds: meds.filter((m) => medIsFor(m, fam.personId)), doses, body: body.filter(me), daily: daily.filter(me), checkIns: checkIns.filter(me), workouts: workouts.filter(me), labs: labs.filter(me) }, Date.now());
  return (
    <div className="space-y-5 pb-8 report">
      <p className="text-muted">{format(y.from, 'd MMM yyyy')} – {format(y.to, 'd MMM yyyy')}</p>
      <div className="grid grid-cols-2 gap-2">
        {y.weight && <Stat label="Weight" value={`${y.weight.to < y.weight.from ? '−' : '+'}${Math.abs(Math.round((y.weight.to - y.weight.from) * 10) / 10)}`} unit="kg">{y.weight.from} → {y.weight.to} kg</Stat>}
        {y.bestMonth && <Stat label="Best month" value={`−${y.bestMonth.kg}`} unit="kg">{y.bestMonth.label}</Stat>}
        {y.sleepH !== undefined && <Stat label="Sleep" value={y.sleepH} unit="h a night" />}
        {y.steps !== undefined && <Stat label="Steps" value={y.steps.toLocaleString('en-AU')} unit="a day" />}
        {y.restingHr && <Stat label="Resting heart rate" value={`${y.restingHr.from} → ${y.restingHr.to}`} unit="bpm" />}
        {y.brain && <Stat label="Brain test" value={`${y.brain.first} → ${y.brain.last}`}>{y.brain.tests} tests</Stat>}
        {y.focus !== undefined && <Stat label="Focus" value={y.focus} unit="of 5" />}
        <Stat label="Workouts" value={y.workouts} />
      </div>
      {y.doses.length > 0 && (
        <section aria-labelledby="yr-doses" className="box">
          <h2 id="yr-doses" className="text-sm font-medium text-muted mb-1">Doses</h2>
          <ul>{y.doses.map((d) => <li key={d.med.id} className="flex justify-between py-1.5 tnum"><span>{shownName(d.med)}</span><span>{d.taken} taken{d.share !== undefined ? ` · ${d.share}% on plan` : ''}</span></li>)}</ul>
        </section>
      )}
      {y.labs.length > 0 && (
        <section aria-labelledby="yr-labs" className="box">
          <h2 id="yr-labs" className="text-sm font-medium text-muted mb-1">Lab results</h2>
          <ul>{y.labs.map((l) => <li key={l.name} className="flex justify-between py-1.5 tnum"><span>{l.name}</span><span>{l.from} → {l.to}</span></li>)}</ul>
        </section>
      )}
      {y.topChips.length > 0 && (
        <section aria-labelledby="yr-chips" className="box">
          <h2 id="yr-chips" className="text-sm font-medium text-muted mb-1">Noted most in check-ins</h2>
          <p>{y.topChips.map((c) => `${c.chip} (${c.n})`).join(', ')}</p>
          <p className="text-sm text-muted tnum mt-1">{y.checkIns} check-ins in the year</p>
        </section>
      )}
      <Button variant="secondary" className="no-print min-h-[48px]" onClick={() => window.print()}><Printer size={18} aria-hidden="true" className="inline mr-2 -mt-0.5" />Print or save as PDF</Button>
    </div>
  );
}
