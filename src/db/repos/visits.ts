// Appointments, questions for them, and lab results. Each belongs to a family member (none = "Me") and syncs.
import { db } from '../db';
import { DEFAULT_PERSON, type Appointment, type LabResult, type Medication, type Question, type ReminderTime } from '../schema';

const nowIso = () => new Date().toISOString();
const who = (personId: string) => (personId === DEFAULT_PERSON ? undefined : personId);

export async function addAppointment(date: string, personId: string, withWho?: string, note?: string): Promise<Appointment> {
  const now = nowIso();
  const a: Appointment = { id: crypto.randomUUID(), date, with: withWho?.trim() || undefined, note: note?.trim() || undefined, personId: who(personId), createdAt: now, updatedAt: now };
  await db.appointments.add(a);
  return a;
}
export async function removeAppointment(id: string) { const now = nowIso(); await db.appointments.update(id, { deletedAt: now, updatedAt: now }); }
export async function restoreAppointment(id: string) { await db.appointments.update(id, { deletedAt: undefined, updatedAt: nowIso() }); }

export async function addQuestion(text: string, personId: string): Promise<Question> {
  const now = nowIso();
  const q: Question = { id: crypto.randomUUID(), text: text.trim(), personId: who(personId), createdAt: now, updatedAt: now };
  await db.questions.add(q);
  return q;
}
export async function setQuestionDone(id: string, done: boolean) { await db.questions.update(id, { done, updatedAt: nowIso() }); }
export async function removeQuestion(id: string) { const now = nowIso(); await db.questions.update(id, { deletedAt: now, updatedAt: now }); }
export async function restoreQuestion(id: string) { await db.questions.update(id, { deletedAt: undefined, updatedAt: nowIso() }); }

export async function addLabs(rows: Omit<LabResult, 'id' | 'createdAt' | 'updatedAt' | 'personId'>[], personId: string): Promise<string[]> {
  const now = nowIso();
  const all = rows.map((r) => ({ ...r, id: crypto.randomUUID(), personId: who(personId), createdAt: now, updatedAt: now }));
  await db.labs.bulkAdd(all);
  return all.map((x) => x.id);
}
export async function removeLabs(ids: string[]) { const now = nowIso(); await db.labs.bulkUpdate(ids.map((key) => ({ key, changes: { deletedAt: now, updatedAt: now } }))); }
export async function restoreLabs(ids: string[]) { const now = nowIso(); await db.labs.bulkUpdate(ids.map((key) => ({ key, changes: { deletedAt: undefined, updatedAt: now } }))); }

/** Remind at these times instead of the set times (learned from when doses are taken). `undefined` clears them. */
export async function setReminderTimes(medId: string, times: ReminderTime[] | undefined): Promise<Medication['reminderTimes']> {
  const med = await db.medications.get(medId);
  await db.medications.update(medId, { reminderTimes: times?.length ? times : undefined, updatedAt: nowIso() });
  return med?.reminderTimes;
}
