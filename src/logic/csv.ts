// Spreadsheet exports. One CSV per kind of record; deleted records are left out.
import { format } from 'date-fns';
import type { BodyEntry, CheckIn, Dose, Medication } from '../db/schema';
import { fmtSchedule } from './format';
import { MEASUREMENTS } from './units';

function cell(v: unknown): string {
  if (v === undefined || v === null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

const day = (iso: string) => format(Date.parse(iso), 'yyyy-MM-dd');
const time = (iso: string) => format(Date.parse(iso), 'HH:mm');

/** Whose record it is, by person id (missing = the default person). */
type PersonName = (personId?: string) => string;
const me: PersonName = () => 'Me';

export function dosesCsv(doses: Dose[], meds: Medication[], person: PersonName = me): string {
  const m = new Map(meds.map((x) => [x.id, x]));
  const rows = doses.filter((d) => !d.deletedAt).sort((a, b) => a.takenAt.localeCompare(b.takenAt))
    .map((d) => [person(m.get(d.medicationId)?.shared ? d.personId : m.get(d.medicationId)?.personId), day(d.takenAt), time(d.takenAt), m.get(d.medicationId)?.name ?? '', d.skipped ? '' : d.amount, m.get(d.medicationId)?.unit ?? '',
      d.source, d.skipped ? 'yes' : '', d.skipReason ?? '', d.note ?? '']);
  return toCsv(['person', 'date', 'time', 'medication', 'amount', 'unit', 'how logged', 'skipped', 'skip reason', 'note'], rows);
}

export function checkInsCsv(rows: CheckIn[], person: PersonName = me): string {
  return toCsv(
    ['person', 'date', 'time', 'mood', 'energy', 'focus', 'appetite', 'sleep hours', 'sleep quality', 'noticed', 'note'],
    rows.filter((c) => !c.deletedAt).sort((a, b) => a.at.localeCompare(b.at))
      .map((c) => [person(c.personId), day(c.at), time(c.at), c.mood, c.energy, c.focus, c.appetite, c.sleepHours, c.sleepQuality, c.chips.join('; '), c.note ?? '']),
  );
}

export function bodyCsv(rows: BodyEntry[], person: PersonName = me): string {
  return toCsv(
    ['person', 'date', 'weight kg', ...MEASUREMENTS.map((m) => `${m.label.toLowerCase()} cm`), 'note'],
    rows.filter((b) => !b.deletedAt).sort((a, b) => a.date.localeCompare(b.date))
      .map((b) => [person(b.personId), b.date, b.weightKg, ...MEASUREMENTS.map((m) => b[m.key]), b.note ?? '']),
  );
}

export function medicationsCsv(meds: Medication[], person: PersonName = me): string {
  return toCsv(
    ['person', 'name', 'strength', 'unit', 'form', 'usual dose', 'schedule', 'stock', 'archived', 'instructions', 'instructions from', 'notes'],
    meds.map((m) => [person(m.personId), m.name, m.strength, m.unit, m.form, m.defaultAmount, fmtSchedule(m.schedule, m.unit), m.stockCount, m.archived ? 'yes' : 'no',
      m.instructions ?? '', m.instructionsBy ?? '', m.scriptNotes ?? '']),
  );
}
