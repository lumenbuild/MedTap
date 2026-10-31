// Everything the decision features read, for the person being shown, kept live.
import { useBodyEntries, useCheckIns, useDaily, useDoses, useExperiments, useFamily, useMeds, useScheduleSettings, useWorkouts } from './data';
import { useLive } from '../db/live';
import { db } from '../db/db';
import { medIsFor, personOf } from '../db/repos/people';
import type { AllData } from '../logic/decisions';
import type { FoodLog } from '../db/schema';

export function useDecisionData() {
  const meds = useMeds(); const doses = useDoses(); const checkIns = useCheckIns(); const daily = useDaily(); const body = useBodyEntries();
  const experiments = useExperiments(); const workouts = useWorkouts(); const fam = useFamily(); const ss = useScheduleSettings();
  const foodLogs = useLive(() => db.foodLogs.toArray(), []);
  if (!meds || !doses || !checkIns || !daily || !body || !experiments || !workouts || !fam || !ss || !foodLogs) return null;
  const me = <T extends { personId?: string; deletedAt?: string }>(x: T) => personOf(x) === fam.personId && !x.deletedAt;
  const myMeds = meds.filter((m) => medIsFor(m, fam.personId));
  const ids = new Set(myMeds.map((m) => m.id));
  const data: AllData = {
    meds: myMeds, doses: doses.filter((d) => !d.deletedAt && ids.has(d.medicationId)), checkIns: checkIns.filter(me), daily: daily.filter(me),
    body: body.filter(me), experiments: experiments.filter(me), workouts: workouts.filter(me), foodLogs: foodLogs.filter(me) as FoodLog[],
  };
  return { data, settings: ss[0], s: ss[1], personId: fam.personId, everyone: fam.everyone };
}
