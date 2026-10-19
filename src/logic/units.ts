// Everything is stored metric (kg, cm). Imperial is display-only.
import type { Units } from '../db/repos/settings';

const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;

export const weightUnit = (u: Units) => (u === 'imperial' ? 'lb' : 'kg');
export const lengthUnit = (u: Units) => (u === 'imperial' ? 'in' : 'cm');

/** Stored kg → number in the user's unit, rounded to 1 decimal. */
export const kgTo = (kg: number, u: Units) => round1(u === 'imperial' ? kg / KG_PER_LB : kg);
export const toKg = (v: number, u: Units) => (u === 'imperial' ? v * KG_PER_LB : v);
export const cmTo = (cm: number, u: Units) => round1(u === 'imperial' ? cm / CM_PER_IN : cm);
export const toCm = (v: number, u: Units) => (u === 'imperial' ? v * CM_PER_IN : v);

export const fmtWeight = (kg: number, u: Units) => `${kgTo(kg, u)} ${weightUnit(u)}`;
export const fmtLength = (cm: number, u: Units) => `${cmTo(cm, u)} ${lengthUnit(u)}`;

function round1(n: number) { return Math.round(n * 10) / 10; }

export const MEASUREMENTS = [
  { key: 'waistCm', label: 'Waist' },
  { key: 'hipsCm', label: 'Hips' },
  { key: 'chestCm', label: 'Chest' },
  { key: 'neckCm', label: 'Neck' },
  { key: 'armCm', label: 'Upper arm' },
  { key: 'thighCm', label: 'Thigh' },
  { key: 'calfCm', label: 'Calf' },
] as const;
export type MeasurementKey = (typeof MEASUREMENTS)[number]['key'];
