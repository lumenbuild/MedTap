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
  // Rolling 24-hour limits the person enters from the label or their doctor (mainly for as-needed medicines).
  maxPer24h?: number;
  maxAmountPer24h?: number;
  minHoursApart?: number;
}

interface Stamped { id: string; createdAt: string; updatedAt: string }

export interface Bottle { id: string; expiry: string /* 'YYYY-MM-DD' */; label?: string; addedAt: string }

/** A family member. Records without a personId belong to the default person, DEFAULT_PERSON ("Me"). */
export interface Person extends Stamped { name: string }
export const DEFAULT_PERSON = 'me';

/** A schedule that takes over on a future date (dose change or taper step). Applied automatically on that day. */
export interface PlannedChange {
  id: string;
  from: string; // 'YYYY-MM-DD', the first user day it applies
  schedule: Schedule;
  defaultAmount: number;
  note?: string;
}

export interface Medication extends Stamped {
  name: string; strength: number; unit: string; form: string; defaultAmount: number;
  schedule: Schedule; color: string; icon: string;
  stockCount?: number; lowStockAt?: number; scriptNotes?: string; archived: boolean;
  /** The stock count as last set by hand or by a refill, and when. Family sync recounts stock from here plus the
   *  doses logged since, so doses logged on two phones both come off. */
  stockBase?: { count: number; at: string };
  /** Free-text instructions shown when the tag is tapped (from the person, a carer, pharmacist or doctor). */
  instructions?: string; instructionsBy?: string; instructionsUpdatedAt?: string;
  /** Future schedule changes, oldest first. Each is moved into `schedule` on its date. */
  plannedChanges?: PlannedChange[];
  /** Who takes it (a Person id); missing = the default person. Ignored when shared. */
  personId?: string;
  /** Used by anyone in the family (e.g. Panadol): one stock count; each dose records who took it. */
  shared?: boolean;
  /** Shown instead of the real name wherever someone might glance (Today, tag taps, reminders, charts), with a plain
   *  grey badge. The real name only shows on the medication's own page, in the doctor report and in exports. */
  nickname?: string;
  /** Bottles/packs on hand, each with its own expiry (e.g. a liquid at home and one in the school bag). */
  bottles?: Bottle[];
  /** Script refills left, and when the script expires ('YYYY-MM-DD'). */
  repeatsLeft?: number; scriptExpiry?: string;
}
export interface Tag { id: string; medicationId: string; label?: string; createdAt: string; lastScannedAt?: string }
export interface Dose extends Stamped {
  medicationId: string; takenAt: string; amount: number;
  source: 'tag' | 'manual' | 'backdated' | 'reminder'; tagId?: string; note?: string; deletedAt?: string;
  /** Recorded as skipped on purpose: covers its place in the plan but wasn't taken (no stock change). */
  skipped?: boolean; skipReason?: string;
  /** Who took it, for shared medications (otherwise the medication's person). */
  personId?: string;
}
export interface CheckIn extends Stamped {
  at: string; mood?: number; energy?: number; focus?: number; appetite?: number;
  sleepHours?: number; sleepQuality?: number; chips: string[]; note?: string;
  relatedDoseId?: string; deletedAt?: string; personId?: string;
}
export interface BodyEntry extends Stamped {
  date: string; // local YYYY-MM-DD
  weightKg?: number; waistCm?: number; hipsCm?: number; chestCm?: number; neckCm?: number;
  armCm?: number; thighCm?: number; calfCm?: number; note?: string; deletedAt?: string; personId?: string;
}
/** A blood pressure and/or heart rate reading. */
export interface Vital extends Stamped {
  at: string; // UTC
  systolic?: number; diastolic?: number; // mmHg
  heartRate?: number; // beats per minute
  note?: string; personId?: string; deletedAt?: string;
}

export interface MedEvent {
  id: string; medicationId: string; at: string; kind: 'started' | 'changed' | 'stopped';
  summary: string; before?: unknown; after?: unknown;
}
export interface Setting { key: string; value: unknown }
export interface Photo extends Stamped {
  date: string; // local YYYY-MM-DD
  blob: Blob; type: string; note?: string; deletedAt?: string; personId?: string;
}
/** Device-only values that must never go into a backup (e.g. a folder permission handle). */
export interface DeviceValue { key: string; value: unknown }
