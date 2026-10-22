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
  /** On/off cycle (peptide tools): `on` days taking it, then `off` days not, repeating from `start` ('YYYY-MM-DD'). */
  cycle?: { on: number; off: number; start: string };
}

interface Stamped { id: string; createdAt: string; updatedAt: string }

export interface Bottle { id: string; expiry: string /* 'YYYY-MM-DD' */; label?: string; addedAt: string }

/** A family member. Records without a personId belong to the default person, DEFAULT_PERSON ("Me"). */
/** Body measurements a goal can be set for. */
export type GoalMetric = 'weightKg' | 'waistCm';

/** A goal for a body measurement, e.g. weight 95 → 80 kg, optionally by a date. Values are in kg or cm. */
export interface BodyGoal {
  metric: GoalMetric;
  target: number;
  /** Optional date to reach it by ('YYYY-MM-DD'). */
  targetDate?: string;
  /** Where it started (the trend when the goal was set) and when. */
  start: number; startDate: string;
}

export interface Person extends Stamped {
  name: string;
  /** Body goals, at most one per measurement. */
  goals?: BodyGoal[];
}
export const DEFAULT_PERSON = 'me';

/** A schedule that takes over on a future date (dose change or taper step). Applied automatically on that day. */
export interface PlannedChange {
  id: string;
  from: string; // 'YYYY-MM-DD', the first user day it applies
  schedule: Schedule;
  defaultAmount: number;
  note?: string;
}

export type SyringeType = 'U-100' | 'U-40';

/** Another peptide in the same vial (a blend), with its amount per vial. */
export interface BlendPart { name: string; amount: number; unit: string }

/** Injected from a vial mixed with water ('vial', the default) or a pre-filled pen (peptide tools).
 *  `strength` is the amount in each vial or pen. */
export interface PeptideSetup {
  kind?: 'vial' | 'pen';
  /** Usual water added to a vial, mL (each vial records its own). */
  waterMl: number;
  syringe: SyringeType;
  /** Syringe capacity in units (30, 50 or 100 on a U-100 syringe). */
  syringeUnits: number;
  /** Days a mixed vial or an in-use pen can be used for, from the label or pharmacist (optional). */
  useWithinDays?: number;
  /** Before vial records: when the vial in use was mixed. Read-only. */
  mixedAt?: string;
  /** Pens: amount per click of the dose dial (optional). */
  amountPerClick?: number;
  /** Blends: the other peptides in each vial. The medication's own name and strength are the first. */
  blend?: BlendPart[];
  /** Half-life in hours, entered by the person, for the estimated level chart (optional). */
  halfLifeHours?: number;
  /** Days an order takes to arrive, for the "order by" date (optional; 7 if not set). */
  leadTimeDays?: number;
}

/** A batch the person has flagged (e.g. "seemed weak"): mixing another vial from it shows the note. */
export interface LotFlag { lot: string; note?: string; at: string }

/** One vial or pen: in stock (unmixed/unused), in use, or finished. */
export interface PeptideVial {
  id: string;
  status: 'stock' | 'in-use' | 'finished';
  /** Amount in it, in the medication's unit. */
  amount: number;
  /** Vials: water added when it was mixed. */
  waterMl?: number;
  lot?: string; supplier?: string; purity?: number;
  /** Expiry printed on it ('YYYY-MM-DD'). */
  expiry?: string;
  addedAt: string; startedAt?: string; finishedAt?: string;
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
  /** Mixed from a powder vial, or a pre-filled pen: syringe units are worked out from this (peptide tools). */
  peptide?: PeptideSetup;
  /** Vials or pens: in stock, in use and finished, each with its own water, lot and expiry. */
  vials?: PeptideVial[];
  /** Batches flagged by the person (peptide tools). */
  lotFlags?: LotFlag[];
}
/** `vialId`: a tag stuck on a vial (peptide tools). Tapping it logs from that vial; mixing a new vial can move the tag to
 *  it, so the same sticker is reused. */
export interface Tag { id: string; medicationId: string; label?: string; createdAt: string; lastScannedAt?: string; vialId?: string }
export interface Dose extends Stamped {
  medicationId: string; takenAt: string; amount: number;
  source: 'tag' | 'manual' | 'backdated' | 'reminder'; tagId?: string; note?: string; deletedAt?: string;
  /** Recorded as skipped on purpose: covers its place in the plan but wasn't taken (no stock change). */
  skipped?: boolean; skipReason?: string;
  /** Who took it, for shared medications (otherwise the medication's person). */
  personId?: string;
  /** The vial or pen it came from (peptide tools). */
  vialId?: string;
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
  /** A photo of a vial's label or certificate (peptide tools), not a progress photo. */
  vialId?: string;
}

/** Injection supplies. The count on hand is worked out from `base` and the doses logged since (so it syncs). */
export type SupplyKind = 'syringes' | 'pen-needles' | 'swabs' | 'water' | 'sharps';
export interface Supply extends Stamped {
  kind: SupplyKind;
  deletedAt?: string;
  /** Count on hand (mL for water; for the sharps container, how many are in it) and when it was set. */
  base: { count: number; at: string };
  /** Sharps container: how many it holds. */
  capacity?: number;
  /** Warn at or below this many (or for sharps, at this many in it). */
  warnAt?: number;
}
/** Device-only values that must never go into a backup (e.g. a folder permission handle). */
export interface DeviceValue { key: string; value: unknown }
