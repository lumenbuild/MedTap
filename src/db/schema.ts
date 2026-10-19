export type ScheduleType = 'interval' | 'fixed' | 'prn';

/** A set time and, optionally, how much to take then (falls back to the medication's usual dose). */
export interface DoseSlot { time: string /* 'HH:mm' local */; amount?: number }

export interface Schedule {
  type: ScheduleType;
  // Every X hours
  intervalHours?: number;
  maxPerDay?: number;
  latestDoseTime?: string; // 'HH:mm' local
  /** Amount for the 1st, 2nd, 3rd… dose of the day (e.g. 20, 20, 10 mg). Its length is the doses per day. */
  doseAmounts?: number[];
  // Set times
  slots?: DoseSlot[];
  /** Phase 1 set times, before each time could have its own amount. Read-only; the editor writes `slots`. */
  times?: string[];
  // Which days (both kinds of schedule). Neither set = every day.
  /** Days of the week, 0 = Sunday … 6 = Saturday. */
  days?: number[];
  /** Every N days counting from startDate (e.g. 14 for fortnightly). */
  everyNDays?: number;
  startDate?: string; // 'YYYY-MM-DD'
}

interface Stamped { id: string; createdAt: string; updatedAt: string }

export interface Medication extends Stamped {
  name: string; strength: number; unit: string; form: string; defaultAmount: number;
  schedule: Schedule; color: string; icon: string;
  stockCount?: number; lowStockAt?: number; scriptNotes?: string; archived: boolean;
  /** Free-text instructions shown when the tag is tapped (from the person, a carer, pharmacist or doctor). */
  instructions?: string; instructionsBy?: string; instructionsUpdatedAt?: string;
}
export interface Tag { id: string; medicationId: string; label?: string; createdAt: string; lastScannedAt?: string }
export interface Dose extends Stamped {
  medicationId: string; takenAt: string; amount: number;
  source: 'tag' | 'manual' | 'backdated'; tagId?: string; note?: string; deletedAt?: string;
}
export interface CheckIn extends Stamped {
  at: string; mood?: number; energy?: number; focus?: number; appetite?: number;
  sleepHours?: number; sleepQuality?: number; chips: string[]; note?: string;
  relatedDoseId?: string; deletedAt?: string;
}
export interface BodyEntry extends Stamped {
  date: string; // local YYYY-MM-DD
  weightKg?: number; waistCm?: number; hipsCm?: number; chestCm?: number; neckCm?: number;
  armCm?: number; thighCm?: number; calfCm?: number; note?: string; deletedAt?: string;
}
export interface MedEvent {
  id: string; medicationId: string; at: string; kind: 'started' | 'changed' | 'stopped';
  summary: string; before?: unknown; after?: unknown;
}
export interface Setting { key: string; value: unknown }
export interface Photo extends Stamped {
  date: string; // local YYYY-MM-DD
  blob: Blob; type: string; note?: string; deletedAt?: string;
}
