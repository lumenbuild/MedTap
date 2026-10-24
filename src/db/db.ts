import Dexie, { type Table } from 'dexie';
import type { Food, FoodLog, Appointment, BodyEntry, CheckIn, DailyHealth, Exercise, Routine, Workout, DeviceValue, Dose, LabResult, MedEvent, Medication, Person, Photo, Question, Setting, Tag, Vital, Supply } from './schema';
import { LEGACY_COLOURS } from '../logic/palette';
import { edition } from '../edition';

class MedDB extends Dexie {
  medications!: Table<Medication, string>;
  tags!: Table<Tag, string>;
  doses!: Table<Dose, string>;
  checkIns!: Table<CheckIn, string>;
  bodyEntries!: Table<BodyEntry, string>;
  medEvents!: Table<MedEvent, string>;
  settings!: Table<Setting, string>;
  photos!: Table<Photo, string>;
  device!: Table<DeviceValue, string>;
  people!: Table<Person, string>;
  vitals!: Table<Vital, string>;
  supplies!: Table<Supply, string>;
  labs!: Table<LabResult, string>;
  appointments!: Table<Appointment, string>;
  questions!: Table<Question, string>;
  daily!: Table<DailyHealth, string>;
  exercises!: Table<Exercise, string>;
  workouts!: Table<Workout, string>;
  routines!: Table<Routine, string>;
  foods!: Table<Food, string>;
  foodLogs!: Table<FoodLog, string>;

  constructor() {
    super(edition.dbName); // each edition keeps its own data, even on the same website
    // Add new versions below with .upgrade() migrations; never edit a shipped version.
    this.version(1).stores({
      medications: 'id, name, archived',
      tags: 'id, medicationId',
      doses: 'id, medicationId, takenAt',
      checkIns: 'id, at',
      bodyEntries: 'id, date',
      medEvents: 'id, medicationId, at',
      settings: 'key',
    });
    // v2: progress photos; medication colours moved to the validated palette.
    this.version(2).stores({ photos: 'id, date' }).upgrade((tx) =>
      tx.table('medications').toCollection().modify((m: Medication) => {
        const next = LEGACY_COLOURS[m.color?.toLowerCase()];
        if (next) m.color = next;
      }));
    // v3: device-only storage (auto-backup folder), never included in backups.
    this.version(3).stores({ device: 'key' });
    // v4: family members. Existing records have no personId, meaning the default person ("Me").
    this.version(4).stores({ people: 'id' });
    // v5: blood pressure and heart rate readings.
    this.version(5).stores({ vitals: 'id, at' });
    // v6: injection supplies (peptide tools).
    this.version(6).stores({ supplies: 'id, kind' });
    // v7: lab results, appointments and questions for them.
    this.version(7).stores({ labs: 'id, date', appointments: 'id, date', questions: 'id' });
    // v8: daily steps, sleep and heart rate imported from Health Connect / Apple Health.
    this.version(8).stores({ daily: 'id, date' });
    // v9: training (MedTap): your own exercises, workouts and routines.
    this.version(9).stores({ exercises: 'id', workouts: 'id, startedAt', routines: 'id' });
    // v10: food: saved products, meals and recipes, and what was eaten.
    this.version(10).stores({ foods: 'id, barcode', foodLogs: 'id, at' });
  }
}

export const db = new MedDB();

/** Every table, in a fixed order. Used by backup, restore and erase. */
export const TABLES = ['people', 'medications', 'tags', 'doses', 'checkIns', 'bodyEntries', 'vitals', 'medEvents', 'settings', 'photos', 'supplies', 'labs', 'appointments', 'questions', 'daily', 'exercises', 'workouts', 'routines', 'foods', 'foodLogs'] as const;
export type TableName = (typeof TABLES)[number];
