import Dexie, { type Table } from 'dexie';
import type { BodyEntry, CheckIn, Dose, MedEvent, Medication, Setting, Tag } from './schema';

class MedDB extends Dexie {
  medications!: Table<Medication, string>;
  tags!: Table<Tag, string>;
  doses!: Table<Dose, string>;
  checkIns!: Table<CheckIn, string>;
  bodyEntries!: Table<BodyEntry, string>;
  medEvents!: Table<MedEvent, string>;
  settings!: Table<Setting, string>;

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
  }
}

export const db = new MedDB();
