// Everything the decision features read, for the person being shown, kept live. Worked out once for the whole app
// each time the records change (every card asking gets the same object), not once per card per render.
import { useBodyEntries, useCheckIns, useDaily, useDoses, useExperiments, useFamily, useFoodLogs, useFoods, useMeds, useScheduleSettings, useWorkouts } from './data';
import { memoLast } from '../db/live';
import { medIsFor, personOf } from '../db/repos/people';
import type { AllData } from '../logic/decisions';
import type { AppSettings } from '../db/repos/settings';
import type { ScheduleSettings } from '../logic/schedule';
import type { BodyEntry, CheckIn, DailyHealth, Dose, Experiment, Food, FoodLog, Medication, Person, Workout } from '../db/schema';

const build = memoLast((meds: Medication[], doses: Dose[], checkIns: CheckIn[], daily: DailyHealth[], body: BodyEntry[], experiments: Experiment[],
  workouts: Workout[], foodLogs: FoodLog[], foods: Food[], settings: AppSettings, s: ScheduleSettings, personId: string, everyone: boolean, people: Person[]) => {
  const me = <T extends { personId?: string; deletedAt?: string }>(x: T) => personOf(x) === personId && !x.deletedAt;
  const myMeds = meds.filter((m) => medIsFor(m, personId));
  const ids = new Set(myMeds.map((m) => m.id));
  const data: AllData = {
    meds: myMeds, doses: doses.filter((d) => !d.deletedAt && ids.has(d.medicationId)), checkIns: checkIns.filter(me), daily: daily.filter(me),
    body: body.filter(me), experiments: experiments.filter(me), workouts: workouts.filter(me), foodLogs: foodLogs.filter(me), foods: foods.filter((f) => !f.deletedAt),
  };
  const weightGoal = people.find((p) => p.id === personId)?.goals?.find((g) => g.metric === 'weightKg');
  return { data, settings, s, personId, everyone, goalKg: weightGoal?.target, weightGoal };
});

export function useDecisionData() {
  const meds = useMeds(); const doses = useDoses(); const checkIns = useCheckIns(); const daily = useDaily(); const body = useBodyEntries();
  const experiments = useExperiments(); const workouts = useWorkouts(); const fam = useFamily(); const ss = useScheduleSettings();
  const foodLogs = useFoodLogs(); const foods = useFoods();
  if (!foods || !meds || !doses || !checkIns || !daily || !body || !experiments || !workouts || !fam || !ss || !foodLogs) return null;
  return build(meds, doses, checkIns, daily, body, experiments, workouts, foodLogs, foods, ss[0], ss[1], fam.personId, fam.everyone, fam.people);
}
