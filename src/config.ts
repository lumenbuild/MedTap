import { edition } from './edition';

// The app's name comes from the edition being built (MedTap or TapDose, see edition.ts).
export const APP_NAME = edition.name;
export const DISCLAIMER =
  `${APP_NAME} is a personal record-keeping tool. It doesn't give medical advice. Always follow your prescriber's instructions and talk to them or a pharmacist about any changes.`;
