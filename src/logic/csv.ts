// Spreadsheet exports. One CSV per kind of record; deleted records are left out.
import { format } from 'date-fns';
import type { BodyEntry, CheckIn, DailyHealth, Dose, Medication, Vital, Workout } from '../db/schema';
import type { Units } from '../db/repos/settings';
import type { ExerciseDef } from './exercises';
import { loadUnit, showLoad } from './load';
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
    ['person', 'date', 'time', 'mood', 'energy', 'focus', 'appetite', 'sleep hours', 'sleep quality', 'soreness', 'noticed', 'note'],
    rows.filter((c) => !c.deletedAt).sort((a, b) => a.at.localeCompare(b.at))
      .map((c) => [person(c.personId), day(c.at), time(c.at), c.mood, c.energy, c.focus, c.appetite, c.sleepHours, c.sleepQuality, c.soreness, c.chips.join('; '), c.note ?? '']),
  );
}

export function bodyCsv(rows: BodyEntry[], person: PersonName = me): string {
  return toCsv(
    ['person', 'date', 'weight kg', ...MEASUREMENTS.map((m) => `${m.label.toLowerCase()} cm`), 'body fat %', 'lean mass kg', 'muscle kg', 'measured by', 'note'],
    rows.filter((b) => !b.deletedAt).sort((a, b) => a.date.localeCompare(b.date))
      .map((b) => [person(b.personId), b.date, b.weightKg, ...MEASUREMENTS.map((m) => b[m.key]), b.bodyFatPct, b.leanKg, b.muscleKg, b.compSource ?? '', b.note ?? '']),
  );
}

export function medicationsCsv(meds: Medication[], person: PersonName = me): string {
  return toCsv(
    ['person', 'name', 'strength', 'unit', 'form', 'usual dose', 'schedule', 'stock', 'archived', 'instructions', 'instructions from', 'notes'],
    meds.map((m) => [person(m.personId), m.name, m.strength, m.unit, m.form, m.defaultAmount, fmtSchedule(m.schedule, m.unit), m.stockCount, m.archived ? 'yes' : 'no',
      m.instructions ?? '', m.instructionsBy ?? '', m.scriptNotes ?? '']),
  );
}

export function vitalsCsv(rows: Vital[], person: PersonName = me): string {
  return toCsv(
    ['person', 'date', 'time', 'systolic mmHg', 'diastolic mmHg', 'heart rate bpm', 'note'],
    rows.filter((v) => !v.deletedAt).sort((a, b) => a.at.localeCompare(b.at))
      .map((v) => [person(v.personId), day(v.at), time(v.at), v.systolic, v.diastolic, v.heartRate, v.note ?? '']),
  );
}

/** Every set of every workout, and cardio sessions, one row each. Weights in the person's units. */
export function workoutsCsv(workouts: Workout[], defs: ExerciseDef[], units: Units = 'metric', person: PersonName = me): string {
  const u = loadUnit(units);
  const rows: unknown[][] = [];
  for (const w of workouts.filter((x) => !x.deletedAt).sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    const base = [person(w.personId), day(w.startedAt), time(w.startedAt), w.name ?? (w.cardio ? 'Cardio' : 'Workout')];
    if (w.cardio) { rows.push([...base, w.cardio.activity, '', '', '', '', w.cardio.durationMin, 'min', w.cardio.distanceKm ?? '', '', '', w.source, w.note ?? '']); continue; }
    const counts = new Map<string, number>();
    for (const s of w.sets) {
      const d = defs.find((x) => x.id === s.exerciseId);
      const nth = (counts.get(s.exerciseId) ?? 0) + 1; counts.set(s.exerciseId, nth);
      rows.push([...base, d?.name ?? 'Exercise', nth, s.warmup ? 'yes' : '', s.weightKg ? showLoad(s.weightKg, units) : '', d?.perHand ? 'yes' : '', s.reps, d?.timed ? 's' : 'reps', '', s.rpe ?? '', s.done ? 'yes' : 'no', w.source, w.note ?? '']);
    }
  }
  return toCsv(['person', 'date', 'time', 'workout', 'exercise or activity', 'set', 'warm-up', `weight ${u}`, 'per hand', 'reps / seconds / minutes', 'unit', 'distance km', 'RPE', 'done', 'source', 'note'], rows);
}

/** One row per day: steps, sleep, heart rate (imported) and protein / water (logged). */
export function dailyCsv(rows: DailyHealth[], person: PersonName = me): string {
  return toCsv(['person', 'date', 'steps', 'sleep hours', 'resting heart rate', 'heart rate variability ms', 'exercise minutes', 'protein g', 'water mL'],
    rows.filter((d) => !d.deletedAt).sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => [person(d.personId), d.date, d.steps, d.sleepMin !== undefined ? Math.round((d.sleepMin / 60) * 10) / 10 : '', d.restingHr, d.hrvMs, d.exerciseMin, d.proteinG, d.waterMl]));
}
