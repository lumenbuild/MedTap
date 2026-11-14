// Check my records: what the app has spotted in the records themselves (a scale that changed how it measures, a watch
// that sends only resting calories, food not logged lately, doses on a test's off days, a strength that can't be
// right, a medicine added twice, doses saved twice), each with its fix. Opened from Settings and Insights.
import { ClipboardCheck, CheckCircle2, ChevronRight } from 'lucide-react';
import { useRawBodyEntries, useDaily, useDoses, useExperiments, useFamily, useFoodLogs, useMeds, useScheduleSettings } from '../app/data';
import { useNow } from '../app/useNow';
import { useToast } from '../app/toast';
import { medIsFor, personOf } from '../db/repos/people';
import { mergeMeds } from '../db/repos/meds';
import { removeDose, restoreDose } from '../db/repos/doses';
import { dataCheck, type DataIssue } from '../logic/realUse';
import { HAS_FOOD } from '../edition';

export function DataCheck() {
  const meds = useMeds(); const doses = useDoses(); const body = useRawBodyEntries(); const daily = useDaily(); const foodLogs = useFoodLogs();
  const experiments = useExperiments(); const fam = useFamily(); const ss = useScheduleSettings();
  const now = useNow(60_000);
  const toast = useToast();
  if (!meds || !doses || !body || !daily || !foodLogs || !experiments || !fam || !ss) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const [settings, s] = ss;
  // The raw body entries: a change of method is found in the readings as they were taken.
  const issues = dataCheck({
    meds: meds.filter((m) => medIsFor(m, fam.personId)), doses, body: body.filter((b) => personOf(b) === fam.personId), daily: daily.filter((x) => personOf(x) === fam.personId),
    foodLogs: foodLogs.filter((l) => personOf(l) === fam.personId), experiments: experiments.filter((e) => personOf(e) === fam.personId), foodOn: HAS_FOOD && settings.foodTracking,
  }, now, s);
  const open = issues.filter((x) => !x.fixed), handled = issues.filter((x) => x.fixed);

  const action = (x: DataIssue) => {
    if (x.kind === 'twice' && x.medId && x.otherId) return { label: 'Merge', run: async () => { await mergeMeds(x.medId!, x.otherId!); toast('Merged into one medicine'); } };
    if (x.kind === 'double' && x.doseIds) return { label: `Remove ${x.doseIds.length === 1 ? 'the second' : `${x.doseIds.length} seconds`}`, run: async () => {
      for (const id of x.doseIds!) await removeDose(id);
      toast(`Removed ${x.doseIds!.length}`, { onAction: async () => { for (const id of x.doseIds!) await restoreDose(id); } });
    } };
    if ((x.kind === 'strength') && x.medId) return { label: 'Fix', href: `#/meds/${x.medId}/details` };
    if (x.kind === 'test') return { label: 'See the test', href: '#/experiments' };
    if (x.kind === 'food') return { label: 'Food', href: '#/food' };
    return null;
  };

  return (
    <div className="space-y-4">
      <section className="hero" aria-labelledby="dc-h">
        <p id="dc-h" className="hero-label flex items-center gap-1.5"><ClipboardCheck size={15} aria-hidden="true" />Check my records</p>
        <p className="mt-1 text-[40px] leading-[44px] font-bold tnum">{open.length}</p>
        <p className="text-[17px] font-semibold">{open.length === 0 ? 'Nothing to fix' : `thing${open.length === 1 ? '' : 's'} worth a look`}</p>
        <p className="mt-1 text-[15px] opacity-90">Things in your records that would otherwise make a number wrong.</p>
      </section>
      {open.length > 0 && (
        <ul className="space-y-3">
          {open.map((x) => {
            const a = action(x);
            return (
              <li key={x.key} className="box space-y-2">
                <p className="font-semibold text-[16px] leading-snug">{x.title}</p>
                <p className="text-[14px] text-muted leading-snug">{x.detail}</p>
                {a && ('href' in a
                  ? <a href={a.href} className="inline-flex items-center gap-1 min-h-[44px] font-medium text-primary">{a.label}<ChevronRight size={16} aria-hidden="true" /></a>
                  : <button type="button" onClick={() => void a.run()} className="min-h-[44px] px-4 rounded-btn bg-primary text-on-primary font-semibold">{a.label}</button>)}
              </li>
            );
          })}
        </ul>
      )}
      {handled.length > 0 && (
        <section className="box space-y-2" aria-labelledby="dc-done">
          <h2 id="dc-done" className="text-sm font-medium text-muted">Already allowed for</h2>
          <ul className="space-y-2">
            {handled.map((x) => (
              <li key={x.key} className="flex gap-2.5">
                <CheckCircle2 size={18} aria-hidden="true" className="text-success shrink-0 mt-0.5" />
                <span className="text-[14px] leading-snug"><span className="font-medium">{x.title}.</span> <span className="text-muted">{x.detail}</span></span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
