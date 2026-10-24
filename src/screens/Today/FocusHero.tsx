// Today's headline in the apps without medicines: TapWeigh leads with the weight and Log weight, TapLift with
// readiness and Start a workout (or the workout in progress). Each says the tag does the same in one tap.
import { Nfc } from 'lucide-react';
import type { BodyEntry, Tag, Workout } from '../../db/schema';
import type { Units } from '../../db/repos/settings';
import type { Readiness } from '../../logic/training';
import { fmtWeight, kgTo, weightUnit } from '../../logic/units';
import { fmtDay, fmtYmdDay } from '../../logic/format';
import { format } from 'date-fns';
import { go } from '../../app/router';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Sparkline } from '../../components/ui/Visual';
import { ReadinessBlock } from '../../components/Fitness';
import { openWorkout } from '../../logic/tagActions';

const DAY = 86_400_000;

function TagHint({ has, text, setup }: { has: boolean; text: string; setup: string }) {
  return (
    <p className="mt-3 flex items-center gap-2 text-sm text-muted">
      <Nfc size={16} aria-hidden="true" className="shrink-0" />
      {has ? text : <a href="#/tags" className="underline underline-offset-4">{setup}</a>}
    </p>
  );
}

export function WeightHero({ entries, tags, units, now, onLog }: { entries: BodyEntry[]; tags: Tag[]; units: Units; now: number; onLog: () => void }) {
  const weights = entries.filter((e) => !e.deletedAt && e.weightKg !== undefined).sort((a, b) => a.date.localeCompare(b.date));
  const latest = weights[weights.length - 1];
  const t = (e: BodyEntry) => Date.parse(`${e.date}T12:00`);
  const recent = weights.filter((e) => t(e) > now - 60 * DAY).map((e) => ({ t: t(e), v: e.weightKg! }));
  // The change over about a month, from the weigh-in nearest 30 days ago.
  const monthAgo = [...weights].reverse().find((e) => t(e) <= now - 25 * DAY);
  const diff = latest && monthAgo ? kgTo(latest.weightKg! - monthAgo.weightKg!, units) : null;
  return (
    <Card>
      <h2 className="text-sm font-medium text-muted">Weight</h2>
      {latest ? (
        <>
          <p className="mt-1 flex items-baseline flex-wrap gap-x-3 tnum">
            <span className="text-[44px] leading-[48px] font-semibold">{fmtWeight(latest.weightKg!, units)}</span>
            {diff !== null && <span className="text-[15px] text-muted">{diff === 0 ? 'same as a month ago' : `${diff < 0 ? '−' : '+'}${Math.abs(Math.round(diff * 10) / 10)} ${weightUnit(units)} in a month`}</span>}
          </p>
          <p className="text-sm text-muted">{latest.date === format(now, 'yyyy-MM-dd') ? 'Today' : fmtYmdDay(latest.date)}</p>
          {recent.length >= 3 && (
            <a href="#/body" className="block mt-3" aria-label="Weight over the last 60 days, open Body">
              <Sparkline points={recent} height={44} label={`Weight over the last 60 days: ${fmtWeight(recent[0].v, units)} to ${fmtWeight(recent[recent.length - 1].v, units)}`} />
            </a>
          )}
        </>
      ) : <p className="mt-1 text-[17px]">No weigh-ins yet. Your first one starts the trend.</p>}
      <Button className="w-full min-h-[56px] mt-4" onClick={onLog}>Log weight</Button>
      <TagHint has={tags.some((x) => x.action?.kind === 'weight')} text="Or tap the tag on your scales" setup="Put a tag on your scales to log in one tap" />
    </Card>
  );
}

export function TrainingHero({ workouts, tags, ready, now }: { workouts: Workout[]; tags: Tag[]; ready: Readiness | null; now: number }) {
  const open = openWorkout(workouts, now);
  const week = workouts.filter((w) => !w.deletedAt && Date.parse(w.startedAt) > now - 7 * DAY).length;
  const last = workouts.filter((w) => !w.deletedAt).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  return (
    <Card>
      {ready ? <ReadinessBlock r={ready} compact /> : <h2 className="text-sm font-medium text-muted">Training</h2>}
      <p className="mt-3 text-[15px] text-muted tnum">
        {week ? `${week} session${week === 1 ? '' : 's'} in the last 7 days` : 'No sessions in the last 7 days'}
        {last ? ` · last ${fmtDay(Date.parse(last.startedAt), now)}` : ''}
      </p>
      {open
        ? <Button className="w-full min-h-[56px] mt-4" onClick={() => go(`/training/workout/${open.id}`)}>Continue workout ({Math.round((now - Date.parse(open.startedAt)) / 60_000)} min)</Button>
        : <Button className="w-full min-h-[56px] mt-4" onClick={() => go('/training/start')}>Start a workout</Button>}
      <TagHint has={tags.some((x) => !!x.action && ['exercise', 'routine', 'cardio'].includes(x.action.kind))}
        text="Or tap a tag on your gym bag or a machine" setup="Put tags on your gym bag and machines to log in one tap" />
    </Card>
  );
}
