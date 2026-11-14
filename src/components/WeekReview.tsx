// The weekly review, in one place: last week (Monday to Sunday) against the week before (doses, weight, training,
// protein, sleep, mood, side effects for an injection) with the week's wins (milestones included). Its home is the top
// of Progress; Today has a line for it on Monday to Wednesday, and the Monday notification opens it.
import { useMemo } from 'react';
import { format } from 'date-fns';
import { Beef, Brain, CalendarRange, Dumbbell, Frown, Moon, Pill, Scale, Smile, Trophy, X, type LucideIcon } from 'lucide-react';
import { weeklyDigest, type Digest } from '../logic/digest';
import { milestones, streaks } from '../logic/motivation';
import { allExercises } from '../logic/exercises';
import { dosesForPerson, medIsFor, personOf } from '../db/repos/people';
import { setSetting } from '../db/repos/settings';
import { setDigestNotify } from '../app/native';
import { useBodyEntries, useCheckIns, useDaily, useDoses, useExercises, useFamily, useMeds, useScheduleSettings, useWorkouts } from '../app/data';
import { useNow } from '../app/useNow';
import { useToast } from '../app/toast';
import { isNative } from '../platform';
import { HAS_BODY, HAS_TRAINING } from '../edition';
import { IconRow } from './ui/Visual';

const ICON: Record<string, LucideIcon> = { doses: Pill, weight: Scale, training: Dumbbell, protein: Beef, sleep: Moon, mood: Smile, effects: Frown, stress: Brain };

/** Last week's review for the person shown (null in everyone's view, or with nothing to say). */
export function useWeekReview(): { d: Digest; seen: number; notify: boolean } | null {
  const meds = useMeds(); const doses = useDoses(); const checkIns = useCheckIns(); const body = useBodyEntries();
  const workouts = useWorkouts(); const daily = useDaily(); const own = useExercises(); const fam = useFamily(); const ss = useScheduleSettings();
  const hour = Math.floor(useNow(60_000) / 3_600_000);
  return useMemo(() => {
    if (!meds || !doses || !checkIns || !body || !workouts || !daily || !own || !fam || fam.everyone || !ss) return null;
    const [st, s] = ss;
    const now = hour * 3_600_000;
    const who = fam.personId;
    const me = <T extends { personId?: string }>(r: T) => personOf(r) === who;
    const pm = meds.filter((m) => medIsFor(m, who));
    const ids = new Set(pm.map((m) => m.id));
    const person = fam.people.find((p) => p.id === who);
    const training = HAS_TRAINING && st.trainingTools;
    const data = { meds: pm, doses: dosesForPerson(doses.filter((d) => ids.has(d.medicationId)), pm, who), checkIns: checkIns.filter(me), body: HAS_BODY ? body.filter(me) : [],
      workouts: workouts.filter(me), daily: daily.filter(me), defs: allExercises(own), goals: person?.goals ?? [], perWeek: person?.fitnessGoals?.find((g) => g.kind === 'sessions')?.perWeek };
    const ms = milestones(data, streaks(data, now, s, { training, checkIns: true }), now, st.units, { training, body: HAS_BODY });
    const goal = person?.goals?.find((x) => x.metric === 'weightKg');
    const d = weeklyDigest(data, now, s, { units: st.units, body: HAS_BODY, training, milestones: ms, goalDir: goal ? Math.sign(goal.target - goal.start) : undefined });
    return d ? { d, seen: st.digestSeen, notify: st.digestNotify } : null;
  }, [hour, meds, doses, checkIns, body, workouts, daily, own, fam, ss]);
}

/** A review's lines, each result once: a line that was also a win is marked with a trophy, and wins that aren't a line
 *  (milestones) come first. Used by the weekly review and the summary since the last appointment. */
export function ReviewLines({ d }: { d: Digest }) {
  const won = new Set(d.wonKeys ?? []);
  const other = d.otherWins ?? d.wins;
  return (
    <>
      {other.length > 0 && <ul className="tnum mt-1" aria-label="Wins">{other.map((w) => <li key={w}><IconRow Icon={Trophy} tone="good">{w}</IconRow></li>)}</ul>}
      <ul className="tnum mt-1">
        {d.lines.map((l) => <li key={l.key}><IconRow Icon={won.has(l.key) ? Trophy : ICON[l.key] ?? Smile} tone={won.has(l.key) || l.tone === 'good' ? 'good' : l.tone === 'watch' ? 'watch' : 'plain'}>{won.has(l.key) && <span className="sr-only">Win: </span>}{l.text}</IconRow></li>)}
      </ul>
    </>
  );
}

/** Insights: last week's headline, opening the weekly review. */
export function WeekReviewSection() {
  const r = useWeekReview();
  const toast = useToast();
  if (!r) return null;
  const { d } = r;
  return (
    <section aria-labelledby="week-h" id="week">
      <h2 id="week-h" className="text-sm font-medium text-muted">Last week · {format(d.weekStart, 'd MMM')} – {format(d.weekEnd - 43_200_000, 'd MMM')}</h2>
      {/* The headline only: the week in full (results, what drove them, next week's levers) is one tap away, said once there. */}
      <a href="#/week" className="mt-1 flex items-center gap-3 rounded-btn bg-surface-2 p-3 min-h-[56px]">
        <Trophy size={20} aria-hidden="true" className="text-success shrink-0" />
        <span className="flex-1 min-w-0"><span className="block font-medium leading-snug">{d.headline}</span><span className="block text-sm text-muted">Results, what drove them, and next week's levers</span></span>
      </a>
      {isNative && !r.notify && (
        <button type="button" className="min-h-[44px] text-sm text-muted underline underline-offset-4" onClick={async () => {
          const on = await setDigestNotify(true);
          toast(on ? 'You’ll get your week each Monday at 8:30 am' : 'Notifications are off for this app. Turn them on in your phone’s settings.');
        }}>Send it to me each Monday</button>
      )}
    </section>
  );
}

/** Today, Monday to Wednesday: one line for the week, opening the review on Progress. */
export function WeekTeaser({ now }: { now: number }) {
  const r = useWeekReview();
  if (!r || r.seen >= r.d.weekStart || ![1, 2, 3].includes(new Date(now).getDay())) return null;
  return (
    <div className="border-t border-border pt-3">
      <IconRow Icon={CalendarRange} tone="good" href="#/week"
        action={<button type="button" aria-label="Done with last week" onClick={() => setSetting('digestSeen', r.d.weekStart)} className="w-11 h-11 -mr-2 rounded-full flex items-center justify-center text-muted"><X size={18} aria-hidden="true" /></button>}>
        <span className="font-medium">Your week: {r.d.headline}</span>
        <span className="block text-sm text-muted">{r.d.lines.length + r.d.wins.length} things from last week · see them</span>
      </IconRow>
    </div>
  );
}
