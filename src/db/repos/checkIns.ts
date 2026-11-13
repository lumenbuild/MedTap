import { db } from '../db';
import { DEFAULT_PERSON, type CheckIn } from '../schema';
import { CAFFEINE, drinkMl } from '../../logic/caffeine';
import { addIntake } from './training';
import { SAME_TIME_MS, sameTap } from '../../logic/duplicate';

const nowIso = () => new Date().toISOString();
const localDay = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export type CheckInInput = Omit<CheckIn, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;

/** A drink's volume counts toward the day's water: what it says (waterMl), else its size from the drink list or its
 *  name. Only caffeine drinks logged on their own; one from Food posts its water there. */
const volumeOf = (c: CheckInInput) => (c.chips.includes(CAFFEINE) ? c.waterMl ?? drinkMl(c.note) : undefined);
const postWater = (c: Pick<CheckIn, 'at' | 'personId' | 'waterMl'>, sign: 1 | -1) =>
  c.waterMl && c.waterMl > 0 ? addIntake(c.personId ?? DEFAULT_PERSON, localDay(c.at), 'waterMl', sign * c.waterMl) : Promise.resolve(0);

/** Save a check-in (or a drink). The same one tapped again within a minute isn't saved twice: the first comes back,
 *  marked `duplicate` (pass `again` to save it anyway). */
export async function addCheckIn(input: CheckInInput, opts: { water?: boolean; again?: boolean } = {}): Promise<CheckIn & { duplicate?: boolean }> {
  // In one transaction, so two quick taps run one after the other and the second finds the first.
  return db.transaction('rw', db.checkIns, db.daily, async () => {
    const now = nowIso();
    if (!opts.again) {
      const t = Date.parse(input.at);
      const near = await db.checkIns.where('at').between(new Date(t - SAME_TIME_MS).toISOString(), new Date(t + SAME_TIME_MS).toISOString(), true, true).toArray();
      const first = sameTap(near, input, input.at, (c) => c.at);
      if (first) return { ...first, duplicate: true };
    }
    const ml = opts.water === false ? undefined : volumeOf(input);
    const c: CheckIn = { ...input, waterMl: ml, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
    if (c.waterMl === undefined) delete c.waterMl;
    await db.checkIns.add(c);
    await postWater(c, 1);
    return c;
  });
}

export async function updateCheckIn(id: string, input: CheckInInput) {
  // Replace the editable fields wholesale so cleared answers really clear.
  const old = await db.checkIns.get(id);
  if (!old) return;
  // A drink's water moves with it: off the old day (and amount), onto the new.
  const next: CheckIn = { id, createdAt: old.createdAt, ...input, updatedAt: nowIso() };
  if (old.waterMl !== undefined && !old.deletedAt) {
    const renamed = (input.note ?? '') !== (old.note ?? '');
    next.waterMl = renamed ? drinkMl(input.note) ?? old.waterMl : input.waterMl ?? old.waterMl;
    if (!next.chips.includes(CAFFEINE)) delete next.waterMl;
    if (next.waterMl !== old.waterMl || localDay(next.at) !== localDay(old.at)) { await postWater(old, -1); await postWater(next, 1); }
  }
  await db.checkIns.put(next);
}

export async function removeCheckIn(id: string) {
  const now = nowIso();
  const old = await db.checkIns.get(id);
  await db.checkIns.update(id, { deletedAt: now, updatedAt: now });
  if (old && !old.deletedAt) await postWater(old, -1);
}

export async function restoreCheckIn(id: string) {
  const old = await db.checkIns.get(id);
  await db.checkIns.update(id, { deletedAt: undefined, updatedAt: nowIso() });
  if (old?.deletedAt) await postWater(old, 1);
}
