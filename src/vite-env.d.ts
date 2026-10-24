/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'tapdose' builds TapDose; anything else builds MedTap (see src/edition.ts). */
  readonly VITE_EDITION?: string;
  readonly VITE_STORE?: string;
  /** The CI run number of a native build (compared with the latest release to offer updates). */
  readonly VITE_BUILD?: string;
  readonly VITE_APP_VERSION?: string;
}
