// Keeping the automatic targets up to date (once a day), and setting one by hand (which makes it the person's own).
import { db } from '../db/db';
import { getSettings, scheduleSettings, setSetting, type AppSettings } from '../db/repos/settings';
import { medIsFor, personOf } from '../db/repos/people';
import { caffeineDays, intakesOf } from '../logic/caffeine';
import { currentTarget, differs, FIELD, isAuto, LABEL, suggestTargets, TARGET_KEYS, TARGETS_VERSION, type Suggestion, type TargetKey } from '../logic/targets';

const DAY = 86_400_000;

/** Everything the suggestions need, for the person using this phone. */
export async function targetSuggestions(st?: AppSettings, now = Date.now()): Promise<Partial<Record<TargetKey, Suggestion>>> {
  const s = st ?? await getSettings();
  const who = s.activePersonId;
  const mine = <T extends { personId?: string; deletedAt?: string }>(r: T) => personOf(r) === who && !r.deletedAt;
  const since = new Date(now - 70 * DAY).toISOString();
  const [body, daily, workouts, meds, doses, checkIns, foodLogs, people] = await Promise.all([
    db.bodyEntries.toArray(), db.daily.toArray(), db.workouts.where('startedAt').aboveOrEqual(since).toArray(), db.medications.toArray(),
    db.doses.toArray(), db.checkIns.toArray(), db.foodLogs.where('at').aboveOrEqual(since).toArray(), db.people.toArray(),
  ]);
  const myCheckIns = checkIns.filter(mine), myDaily = daily.filter(mine);
  const goalKg = people.find((p) => p.id === who)?.goals?.find((g) => g.metric === 'weightKg')?.target;
  const days = caffeineDays(intakesOf(myCheckIns, foodLogs.filter(mine)), myCheckIns, myDaily, now, scheduleSettings(s), s.bedtime, s.caffeineHalfLifeH);
  return suggestTargets({ body: body.filter(mine), goalKg, daily: myDaily, workouts: workouts.filter(mine), meds: meds.filter((m) => !m.archived && medIsFor(m, who)), doses,
    checkIns: myCheckIns, caffeineDays: days, calorieKcal: s.energyTargetKcal, now });
}

/** Once a day: move each automatic target to its suggestion when it's changed enough to matter, and note the change. */
export async function updateAutoTargets(now = Date.now(), force = false) {
  const st = await getSettings();
  // Right away when the stack changes (something started, stopped or archived), else once a day.
  const stack = (await db.medications.toArray()).filter((m) => !m.archived && medIsFor(m, st.activePersonId)).map((m) => m.id).sort().join(',');
  if (!force && stack === st.targetsStack && st.targetsVersion === TARGETS_VERSION && now - st.targetsAt < DAY) return;
  await setSetting('targetsStack', stack);
  await setSetting('targetsVersion', TARGETS_VERSION);
  // Calories never set by the person: worked out for them too (from the next weekly update, once there's enough).
  if (!st.energyAuto && st.energyTargetKcal === null) { await setSetting('energyAuto', true); await setSetting('energyAutoAt', 0); }
  const sug = await targetSuggestions(st, now);
  const changes: AppSettings['targetChanges'] = [];
  for (const key of TARGET_KEYS) {
    if (key === 'calories' || key === 'steps') continue; // calories: their own weekly update; steps: worked out where used
    const s = sug[key];
    if (!s || !isAuto(st, key)) continue;
    const cur = currentTarget(st, key, sug);
    if (!differs(key, cur, s.value)) continue;
    await setSetting(FIELD[key], s.value as never);
    // A first fill (nothing set before) isn't news; a change is.
    if (cur !== null) changes.push({ key, from: cur, to: s.value, at: now, why: s.why });
  }
  // Remember which are automatic, so later changes to the number aren't mistaken for the person's own.
  const auto = Object.fromEntries((['water', 'protein', 'fibre', 'sleep', 'caffeine'] as const).map((k) => [k, isAuto(st, k)]));
  await setSetting('targetAuto', auto);
  if (changes.length) await setSetting('targetChanges', [...changes, ...st.targetChanges].slice(0, 12));
  await setSetting('targetsAt', now);
}

/** The person sets a target themselves: it's theirs now (until they switch it back to automatic). */
export async function setOwnTarget(key: TargetKey, value: number | null) {
  const st = await getSettings();
  if (key === 'calories') { await setSetting('energyAuto', false); await setSetting('energyTargetKcal', value); return; }
  if (key === 'steps') { await setSetting('stepsTargetOwn', value); return; }
  await setSetting(FIELD[key], value as never);
  await setSetting('targetAuto', { ...st.targetAuto, [key]: false });
}

/** Back to automatic: worked out again now. */
export async function setAutoTarget(key: TargetKey) {
  const st = await getSettings();
  if (key === 'calories') { await setSetting('energyAuto', true); await setSetting('energyAutoAt', 0); return; }
  if (key === 'steps') { await setSetting('stepsTargetOwn', null); return; }
  await setSetting('targetAuto', { ...st.targetAuto, [key]: true });
  await updateAutoTargets(Date.now(), true);
}

export const targetLabel = (key: string) => LABEL[key as TargetKey] ?? key;
