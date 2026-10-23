import { db } from '../db';
import { DEFAULT_PERSON, type BodyGoal, type Dose, type GoalMetric, type Medication, type Person } from '../schema';

const nowIso = () => new Date().toISOString();

/** Who records belong to. Missing personId = the default person. */
export const personOf = (r: { personId?: string }) => r.personId ?? DEFAULT_PERSON;
/** The value to store for a person (the default person is stored as "no personId", so old data needs no migration). */
export const storedPerson = (personId: string) => (personId === DEFAULT_PERSON ? undefined : personId);

/** Who a dose was for: the dose's own person for shared medications, otherwise the medication's person. */
export function doseOwner(d: Pick<Dose, 'personId'>, med?: Pick<Medication, 'personId' | 'shared'>): string {
  return med?.shared ? personOf(d) : personOf(med ?? {});
}

/** Whether a medication appears for a person: theirs, or shared. */
export const medIsFor = (m: Pick<Medication, 'personId' | 'shared'>, personId: string) => !!m.shared || personOf(m) === personId;

/** A person's view of the doses: everything, except other people's doses of shared medications. Feeding this to the
 *  schedule logic makes "last dose", today's count, the double-tap guard and notes per person for shared medicines. */
export function dosesForPerson(doses: Dose[], meds: Medication[], personId: string): Dose[] {
  const shared = new Set(meds.filter((m) => m.shared).map((m) => m.id));
  return doses.filter((d) => !shared.has(d.medicationId) || personOf(d) === personId);
}

/** Everyone, default person first. The default person exists even before the table has a row for it. */
export async function listPeople(): Promise<Person[]> {
  const rows = await db.people.toArray();
  const me = rows.find((p) => p.id === DEFAULT_PERSON) ?? { id: DEFAULT_PERSON, name: 'Me', createdAt: '', updatedAt: '' };
  return [me, ...rows.filter((p) => p.id !== DEFAULT_PERSON).sort((a, b) => a.createdAt.localeCompare(b.createdAt))];
}

export async function addPerson(name: string): Promise<Person> {
  const now = nowIso();
  if (!(await db.people.get(DEFAULT_PERSON))) await db.people.put({ id: DEFAULT_PERSON, name: 'Me', createdAt: now, updatedAt: now });
  const p: Person = { id: crypto.randomUUID(), name: name.trim(), createdAt: now, updatedAt: now };
  await db.people.add(p);
  return p;
}

export async function renamePerson(id: string, name: string) {
  const now = nowIso();
  const existing = await db.people.get(id);
  await db.people.put({ ...(existing ?? { id, createdAt: now }), name: name.trim(), updatedAt: now });
}

/** How much is recorded for a person (removing someone with records isn't allowed, to avoid losing history). */
export async function personRecordCount(id: string): Promise<number> {
  const mine = (r: { personId?: string; deletedAt?: string }) => personOf(r) === id && !r.deletedAt;
  const [meds, checks, body, photos, doses, vitals, labs, appts, qs, workouts] = await Promise.all([db.medications.toArray(), db.checkIns.toArray(), db.bodyEntries.toArray(),
    db.photos.toArray(), db.doses.toArray(), db.vitals.toArray(), db.labs.toArray(), db.appointments.toArray(), db.questions.toArray(), db.workouts.toArray()]);
  return meds.filter((m) => !m.shared && personOf(m) === id).length + checks.filter(mine).length + body.filter(mine).length
    + photos.filter(mine).length + doses.filter((d) => d.personId === id && !d.deletedAt).length + vitals.filter(mine).length
    + labs.filter(mine).length + appts.filter(mine).length + qs.filter(mine).length + workouts.filter(mine).length;
}

export async function removePerson(id: string): Promise<boolean> {
  if (id === DEFAULT_PERSON || (await personRecordCount(id)) > 0) return false;
  await db.people.delete(id);
  return true;
}

/** Set (or with `undefined`, clear) a person's goal for a measurement. */
export async function setGoal(personId: string, metric: GoalMetric, goal: BodyGoal | undefined) {
  const now = nowIso();
  const existing = await db.people.get(personId);
  const base = existing ?? { id: personId, name: 'Me', createdAt: now };
  const goals = [...(existing?.goals ?? []).filter((g) => g.metric !== metric), ...(goal ? [goal] : [])];
  await db.people.put({ ...base, goals: goals.length ? goals : undefined, updatedAt: now });
}
