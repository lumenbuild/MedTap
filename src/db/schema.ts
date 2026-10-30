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
  /** On/off cycle: `on` days taking it, then `off` days not, repeating from `start` ('YYYY-MM-DD'). */
  cycle?: { on: number; off: number; start: string };
  /** A course: `days` days from `start` ('YYYY-MM-DD'), then a break until the person starts another. */
  course?: Course;
}

export interface Course {
  start: string; days: number;
  /** During the break, ask about starting again when a check-in mentions one of these (e.g. "Pain")… */
  restartOn?: string[];
  /** …or once the break has lasted this many days. */
  remindAfterDays?: number;
  /** When the person last said "Not now" to starting again (ISO), so the same reason doesn't ask twice. */
  dismissedAt?: string;
}

/** Step the dose when ready: by `by` (in the medication's unit, or syringe units with `byUnits`) once the step-up
 *  checklist (Medication.stepUp: weeks on the dose, appetite, side effects…) is all met, up to `max` a dose or a week.
 *  The person's own (or prescriber's) plan: the app says when it's due and changes nothing until they confirm. */
export interface StepPlan {
  by: number; byUnits?: boolean;
  /** Step down instead (a taper). */
  down?: boolean;
  max: number; maxPer: 'dose' | 'week';
  /** "Not yet": don't ask again before this date ('YYYY-MM-DD'). */
  snoozedUntil?: string;
}

interface Stamped { id: string; createdAt: string; updatedAt: string }

export interface Bottle { id: string; expiry: string /* 'YYYY-MM-DD' */; label?: string; addedAt: string }

/** A family member. Records without a personId belong to the default person, DEFAULT_PERSON ("Me"). */
/** Body measurements a goal can be set for. */
export type GoalMetric = 'weightKg' | 'waistCm' | 'bodyFatPct' | 'leanKg';

/** A goal for a body measurement, e.g. weight 95 → 80 kg, optionally by a date. Values are in kg or cm. */
export interface BodyGoal {
  metric: GoalMetric;
  target: number;
  /** Optional date to reach it by ('YYYY-MM-DD'). */
  targetDate?: string;
  /** Where it started (the trend when the goal was set) and when. */
  start: number; startDate: string;
}

/** A training goal: a lift (estimated one-rep max, or a weight for a number of reps), a cardio time over a distance,
 *  or sessions a week. */
export interface FitnessGoal {
  id: string;
  kind: 'lift' | 'cardio' | 'sessions';
  exerciseId?: string; targetKg?: number; reps?: number;
  activity?: CardioActivity; distanceKm?: number; targetMin?: number;
  perWeek?: number;
  targetDate?: string; setAt: string;
}

export interface Person extends Stamped {
  name: string;
  /** Body goals, at most one per measurement. */
  goals?: BodyGoal[];
  /** Strength, cardio and training-days goals. */
  fitnessGoals?: FitnessGoal[];
  /** The training plan the app runs for them (see logic/coach). */
  coach?: CoachPlan;
  /** Height (cm), for waist-to-height and BMI. */
  heightCm?: number;
}

/** Training plan set-up: what it's for, how often and with what, and the programme being run (from when). */
export interface CoachPlan {
  goal: 'strength' | 'muscle' | 'fitness' | 'bodyweight';
  days: number; minutes: number;
  kit: 'gym' | 'home' | 'none';
  /** Training before starting: 0 new, 1 some (months), 2 a lot (years). */
  experience: 0 | 1 | 2;
  /** Strength standards to compare with, or none. */
  standards: 'f' | 'm' | null;
  programId: string;
  /** When this programme started (ISO): its weeks and sessions count from here. */
  startedAt: string;
  /** Training max per main lift (kg), for wave and block programmes; set from the estimated max when they start. */
  maxes?: Record<string, number>;
  /** The weekdays the person trains (0 Sunday … 6 Saturday), if they've picked them: reminders come on these. */
  weekdays?: number[];
}
export const DEFAULT_PERSON = 'me';

/** A schedule that takes over on a future date (dose change or taper step). Applied automatically on that day. */
/** What "ready for the next step" means for this person; each is optional. */
export interface StepUpCriteria {
  minWeeks?: number;
  /** Side effects in at most this % of check-ins over the last 2 weeks. */
  maxEffectPct?: number;
  /** Losing no more than this (kg a week) over the last 3 weeks: loss has slowed. */
  maxLossKgWeek?: number;
  /** Appetite averaging at least this (1–5) over the last 2 weeks. */
  minAppetite?: number;
  /** No missed or skipped shots in this many weeks. */
  noMissedWeeks?: number;
}

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
  /** What was paid for it ($), for cost per mg. */
  cost?: number;
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
  /** How it appears when the app is opened with the privacy PIN: under `coverName`, or not at all (with its doses,
   *  tags and history). Missing = as it is (peptides: hidden while the peptide tools are left out). */
  privateView?: 'show' | 'cover' | 'hide';
  coverName?: string;
  /** Bottles/packs on hand, each with its own expiry (e.g. a liquid at home and one in the school bag). */
  bottles?: Bottle[];
  /** Script refills left, and when the script expires ('YYYY-MM-DD'). */
  repeatsLeft?: number; scriptExpiry?: string;
  /** How many each refill adds (the last refill), for working out when a new script is needed. */
  packSize?: number;
  /** Mixed from a powder vial, or a pre-filled pen: syringe units are worked out from this (peptide tools). */
  peptide?: PeptideSetup;
  /** Step-up checklist: the person's (or prescriber's) criteria for being ready for the next dose step. */
  stepUp?: StepUpCriteria;
  /** Step the dose when the checklist is met (see StepPlan). */
  stepPlan?: StepPlan;
  /** Vials or pens: in stock, in use and finished, each with its own water, lot and expiry. */
  vials?: PeptideVial[];
  /** Batches flagged by the person (peptide tools). */
  lotFlags?: LotFlag[];
  /** Reminder times learned from when doses are actually taken, per set time (the plan's times stay as they are). */
  reminderTimes?: ReminderTime[];
  /** Active ingredients as the person entered them (mg per tablet / unit). Otherwise worked out from the name. */
  ingredients?: { name: string; mg?: number }[];
  /** Price paid per vial or pen (peptide tools) or per pack, for cost tracking. */
  costPerUnit?: number;
}
/** For one set time ('HH:mm'): remind at these times instead, on weekdays and/or weekends. */
export interface ReminderTime { slot: string; weekday?: string; weekend?: string }
/** `vialId`: a tag stuck on a vial (peptide tools). Tapping it logs from that vial; mixing a new vial can move the tag to
 *  it, so the same sticker is reused. */
/** What a tap does when the tag isn't for a medication (`medicationId` is then ''). */
export type TagAction =
  | { kind: 'exercise'; exerciseId: string } // on a machine or rack: add it to the workout (or start one)
  | { kind: 'routine'; routineId: string } // start that routine
  | { kind: 'water'; ml: number } | { kind: 'protein'; g: number } // a bottle or shaker: add that much to today
  | { kind: 'cardio'; activity: CardioActivity } // treadmill, bike: log a session
  | { kind: 'weight' } | { kind: 'bp' } | { kind: 'checkin' } // scales, blood pressure cuff, bedside
  | { kind: 'measure' } | { kind: 'food'; foodId: string }; // tape measure; a product or the pantry: log one serving
export interface Tag {
  id: string; medicationId: string; label?: string; createdAt: string; lastScannedAt?: string; vialId?: string;
  action?: TagAction;
  /** Whose records an action tag logs to (medication tags follow the medication). */
  personId?: string;
}
export interface Dose extends Stamped {
  medicationId: string; takenAt: string; amount: number;
  source: 'tag' | 'manual' | 'backdated' | 'reminder' | 'watch' | 'widget'; tagId?: string; note?: string; deletedAt?: string;
  /** Recorded as skipped on purpose: covers its place in the plan but wasn't taken (no stock change). */
  skipped?: boolean; skipReason?: string;
  /** Who took it, for shared medications (otherwise the medication's person). */
  personId?: string;
  /** The vial or pen it came from (peptide tools). */
  vialId?: string;
}
export interface CheckIn extends Stamped {
  at: string; mood?: number; energy?: number; focus?: number; appetite?: number;
  /** Muscle soreness 1 (none) to 5 (very sore), for training readiness. */
  soreness?: number;
  /** Stress 1 (calm) to 5 (very stressed); optional. */
  stress?: number;
  sleepHours?: number; sleepQuality?: number; chips: string[]; note?: string;
  relatedDoseId?: string; deletedAt?: string; personId?: string;
  /** A caffeine drink (with the Caffeine chip): its mg; the note is the drink's name. */
  caffeineMg?: number;
}
export interface BodyEntry extends Stamped {
  date: string; // local YYYY-MM-DD
  weightKg?: number; waistCm?: number; hipsCm?: number; chestCm?: number; neckCm?: number;
  armCm?: number; thighCm?: number; calfCm?: number; note?: string; deletedAt?: string; personId?: string;
  /** Body composition, from a smart scale or a scan (DEXA, InBody). */
  bodyFatPct?: number; leanKg?: number; muscleKg?: number; compSource?: 'scale' | 'dexa' | 'inbody' | 'other';
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

/** A blood test or other lab result, typed in or read from a photo of the printout. */
export interface LabResult extends Stamped {
  date: string; // local YYYY-MM-DD the sample was taken
  name: string; value: number; unit?: string;
  /** Reference range as printed, e.g. "4.0–6.0". */
  range?: string;
  note?: string; personId?: string; deletedAt?: string;
}
/** A doctor's (or other) appointment, so charts and the summary can compare before and after. */
export interface Appointment extends Stamped {
  date: string; // local YYYY-MM-DD
  with?: string; note?: string; personId?: string; deletedAt?: string;
}
/** A question to bring to the next appointment. */
export interface Question extends Stamped {
  text: string; done?: boolean; personId?: string; deletedAt?: string;
}

/** One day of data imported from Health Connect or Apple Health (and kept up to date by later imports). */
export interface DailyHealth extends Stamped {
  /** One row per person per day: later imports update it. */
  date: string; // local YYYY-MM-DD
  steps?: number; sleepMin?: number; restingHr?: number; exerciseMin?: number;
  /** Heart rate variability (ms), the night's or the day's average. */
  hrvMs?: number;
  /** Logged by hand on Today: protein (g) and water (mL). */
  proteinG?: number; waterMl?: number;
  /** Average heart rate in each hour of the day (local), null where there's none. */
  hrByHour?: (number | null)[];
  personId?: string; deletedAt?: string;
}

// ── Training ─────────────────────────────────────────────────────────────────────────────────────────

export type MuscleGroup = 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps' | 'quads' | 'hamstrings' | 'glutes' | 'calves' | 'core';
export type CardioActivity = 'run' | 'walk' | 'ride' | 'swim' | 'row' | 'other';

/** An exercise the person added (built-in ones live in src/logic/exercises.ts). */
export interface Exercise extends Stamped {
  name: string; muscles: MuscleGroup[]; pattern?: 'push' | 'pull' | 'legs' | 'core';
  /** Bodyweight exercises log reps (and any added weight). */
  bodyweight?: boolean;
  /** How much to add when it's time to go up (kg). */
  increment?: number;
  equipment?: 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight' | 'kettlebell' | 'none';
  /** Weight is for each hand. */
  perHand?: boolean;
  /** Held for time: reps are seconds. */
  timed?: boolean;
  personId?: string; deletedAt?: string;
}

export interface WorkoutSet {
  id: string; exerciseId: string;
  /** kg; added weight for bodyweight exercises (0 = none). */
  weightKg: number; reps: number;
  /** How hard it felt: reps in reserve as RPE 6–10 (optional). */
  rpe?: number;
  warmup?: boolean; done: boolean;
  /** Sets with the same group are a superset: done back to back, resting after each round. */
  group?: string;
}

export interface CardioEntry { activity: CardioActivity; distanceKm?: number; durationMin: number; title?: string }

export interface Workout extends Stamped {
  startedAt: string; endedAt?: string;
  routineId?: string; name?: string; note?: string;
  sets: WorkoutSet[];
  cardio?: CardioEntry;
  source: 'manual' | 'health';
  personId?: string; deletedAt?: string;
}

/** `repsMax` makes it a rep range (e.g. 8–12): add reps up to the top, then add weight and start from the bottom. */
export interface RoutineItem { exerciseId: string; sets: number; reps: number; repsMax?: number; weightKg?: number }
export interface Routine extends Stamped { name: string; items: RoutineItem[]; personId?: string; deletedAt?: string }

// ── Food ───────────────────────────────────────────────────────────────────────────────────────────

/** Nutrients by key (see logic/nutrition NUTRIENTS for each one's unit: kcal, g, mg or µg). */
export type Nutrients = Partial<Record<string, number>>;

/** Hand portions (an estimate without weighing): palms of protein, fists of veg, cupped hands of carbs, thumbs of fat. */
export interface Portions { palm: number; fist: number; cupped: number; thumb: number }

/** Something to log again: a packaged product (from its barcode or label), a meal you make, or a batch recipe. */
export interface Food extends Stamped {
  name: string; brand?: string; barcode?: string;
  kind: 'product' | 'meal' | 'recipe';
  /** Nutrients in one serving. */
  nutrients: Nutrients;
  /** What a serving is, in words ("500 mL can", "1 scoop", "1 of 6 serves"). */
  serving?: string;
  /** Grams or millilitres in a serving, and nutrients per 100 g/mL, when known (to log by weight). */
  servingQty?: number; servingUnit?: 'g' | 'mL'; per100?: Nutrients;
  /** A meal estimated by hand portions. */
  portions?: Portions;
  /** A batch recipe: what went in (whole batch) and how many serves it makes. */
  recipe?: { items: { name: string; amount: string; nutrients: Nutrients }[]; serves: number };
  /** Where the numbers came from. */
  source?: 'openfoodfacts' | 'label' | 'typed' | 'portions' | 'recipe';
  favourite?: boolean; lastUsedAt?: string;
  personId?: string; deletedAt?: string;
}

/** Something eaten or drunk. Nutrients are stored as logged, so editing the food later doesn't change history. */
export interface FoodLog extends Stamped {
  at: string; name: string; foodId?: string;
  /** Servings (0.5, 1, 1.5…), or for a meal its size (0.75 small, 1 usual, 1.25 large). */
  servings: number;
  nutrients: Nutrients;
  /** Protein added to the day's protein total (taken off again if this is removed), and the caffeine check-in made. */
  proteinPosted?: number; caffeineCheckInId?: string;
  /** How hungry they were (1 not at all … 5 very), and why they ate, if they said. */
  hunger?: number; why?: EatWhy;
  personId?: string; deletedAt?: string;
}
export type EatWhy = 'hungry' | 'craving' | 'stress' | 'bored' | 'habit' | 'social';
