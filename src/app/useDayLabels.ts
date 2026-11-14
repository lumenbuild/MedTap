// The day marks for charts (logic/dayLabels), worked out once for the whole app.
import { memoLast } from '../db/live';
import { dayLabels } from '../logic/dayLabels';
import { useDaily, useDoses, useExperiments, useFamily, useFoodLogs, useMeds, useScheduleSettings } from './data';
import { personOf, medIsFor } from '../db/repos/people';

const build = memoLast((meds: Parameters<typeof dayLabels>[0]['meds'], doses: Parameters<typeof dayLabels>[0]['doses'], experiments: Parameters<typeof dayLabels>[0]['experiments'],
  daily: Parameters<typeof dayLabels>[0]['daily'], foodLogs: Parameters<typeof dayLabels>[0]['foodLogs'], s: Parameters<typeof dayLabels>[1], personId: string) =>
  dayLabels({ meds: meds.filter((m) => medIsFor(m, personId)), doses, experiments: experiments.filter((e) => personOf(e) === personId), daily: daily.filter((x) => personOf(x) === personId), foodLogs: foodLogs.filter((l) => personOf(l) === personId) }, s));

export function useDayLabels() {
  const meds = useMeds(); const doses = useDoses(); const experiments = useExperiments(); const daily = useDaily(); const foodLogs = useFoodLogs(); const fam = useFamily(); const ss = useScheduleSettings();
  if (!meds || !doses || !experiments || !daily || !foodLogs || !fam || !ss) return undefined;
  return build(meds, doses, experiments, daily, foodLogs, ss[1], fam.personId);
}
