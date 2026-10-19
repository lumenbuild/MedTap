export type ScheduleType = 'interval' | 'fixed' | 'prn';

export interface Schedule {
  type: ScheduleType;
  intervalHours?: number;
  times?: string[]; // 'HH:mm' local
  maxPerDay?: number;
  latestDoseTime?: string; // 'HH:mm' local
}

interface Stamped { id: string; createdAt: string; updatedAt: string }

export interface Medication extends Stamped {
  name: string; strength: number; unit: string; form: string; defaultAmount: number;
  schedule: Schedule; color: string; icon: string;
  stockCount?: number; lowStockAt?: number; scriptNotes?: string; archived: boolean;
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
