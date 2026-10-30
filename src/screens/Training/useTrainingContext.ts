// What smart targets need to know about today for one person: readiness, and (with peptide tools) whether today is
// usually one of their weaker days after a shot.
import { useCheckIns, useDaily, useDoses, useMeds, useScheduleSettings, useWorkouts } from '../../app/data';
import { medIsFor, personOf } from '../../db/repos/people';
import { readiness, trainingVsPeptide } from '../../logic/training';
import { weakDayToday } from '../../logic/progression';
import { strongestWeekday } from '../../logic/trainingExtras';

export interface TrainingContext { readiness: number | null; weakDay: boolean; lighter: boolean;
  /** With a weekly shot: the weekday that's usually strongest (to put the heaviest session on). */
  strongest?: { weekday: string; day: number } }

export function useTrainingContext(personId: string | undefined, now: number): TrainingContext | null {
  const daily = useDaily(); const checkIns = useCheckIns(); const ss = useScheduleSettings(); const meds = useMeds(); const doses = useDoses(); const workouts = useWorkouts();
  if (!daily || !checkIns || !ss || !meds || !doses || !workouts || !personId) return null;
  const [settings, s] = ss;
  const mine = <T extends { personId?: string; deletedAt?: string }>(r: T) => personOf(r) === personId && !r.deletedAt;
  const r = readiness(daily.filter(mine), checkIns.filter(mine), now, s);
  let weakDay = false;
  let strongest: TrainingContext['strongest'];
  const pep = settings.peptideTools ? meds.find((m) => m.peptide && !m.archived && medIsFor(m, personId)) : undefined;
  if (pep) {
    const pv = trainingVsPeptide(pep, doses, workouts.filter(mine));
    const last = doses.filter((d) => d.medicationId === pep.id && !d.deletedAt && !d.skipped && Date.parse(d.takenAt) <= now).map((d) => Date.parse(d.takenAt)).sort((a, b) => b - a)[0];
    weakDay = weakDayToday(pv?.byDay, last, now);
    const shots = doses.filter((d) => d.medicationId === pep.id && !d.deletedAt && !d.skipped).map((d) => Date.parse(d.takenAt)).sort((a, b) => a - b).slice(-6);
    strongest = pv ? strongestWeekday(shots, pv.bestDays, s.tz) ?? undefined : undefined;
  }
  return { readiness: r?.score ?? null, weakDay, lighter: settings.lighterUntil > now, strongest };
}
