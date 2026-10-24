import { edition, HAS_MEDS } from './edition';

// The app's name comes from the edition being built (see edition.ts).
export const APP_NAME = edition.name;
export const DISCLAIMER = HAS_MEDS
  ? `${APP_NAME} is a personal record-keeping tool. It doesn't give medical advice. Always follow your prescriber's instructions and talk to them or a pharmacist about any changes.`
  : `${APP_NAME} is a personal record-keeping tool. It doesn't give medical, dietary or training advice. Talk to your GP before big changes to how you eat or exercise.`;
