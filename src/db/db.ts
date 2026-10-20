import Dexie, { type Table } from 'dexie';
import type { BodyEntry, CheckIn, DeviceValue, Dose, MedEvent, Medication, Person, Photo, Setting, Tag, Vital, Supply } from './schema';
import { LEGACY_COLOURS } from '../logic/palette';

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

  constructor() {
    super('medtap');
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
  }
}

export const db = new MedDB();

/** Every table, in a fixed order. Used by backup, restore and erase. */
export const TABLES = ['people', 'medications', 'tags', 'doses', 'checkIns', 'bodyEntries', 'vitals', 'medEvents', 'settings', 'photos', 'supplies'] as const;
export type TableName = (typeof TABLES)[number];
