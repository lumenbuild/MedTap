import Dexie, { type Table } from 'dexie';
import type { BodyEntry, CheckIn, Dose, MedEvent, Medication, Photo, Setting, Tag } from './schema';
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
  }
}

export const db = new MedDB();

/** Every table, in a fixed order. Used by backup, restore and erase. */
export const TABLES = ['medications', 'tags', 'doses', 'checkIns', 'bodyEntries', 'medEvents', 'settings', 'photos'] as const;
export type TableName = (typeof TABLES)[number];
