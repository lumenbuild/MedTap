/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'tapdose' builds TapDose; anything else builds MedTap (see src/edition.ts). */
  readonly VITE_EDITION?: string;
}
