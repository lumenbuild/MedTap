// Two apps are built from this code (VITE_EDITION at build time):
// - MedTap: everything, including peptide tools, weight and measurements, goals and progress photos.
// - TapDose: medications and ADHD support. It never shows or mentions peptides, weight, measurements, goals or photos.
// Each has its own name, website address, tag links, Android app and data.
export type Edition = 'medtap' | 'tapdose';

export const EDITION: Edition = import.meta.env.VITE_EDITION === 'tapdose' ? 'tapdose' : 'medtap';

const EDITIONS = {
  medtap: {
    name: 'MedTap',
    androidId: 'app.medtap.tracker',
    dbName: 'medtap',
    /** GitHub release the Android app is published to (see .github/workflows/native.yml). */
    release: 'android',
    apk: 'MedTap.apk',
    /** The Wear OS watch app, in the same release. */
    watchApk: 'MedTap-watch.apk',
    body: true,
    peptides: true,
    visits: false,
  },
  tapdose: {
    name: 'TapDose',
    androidId: 'app.tapdose.tracker',
    dbName: 'tapdose',
    release: 'tapdose-android',
    apk: 'TapDose.apk',
    watchApk: 'TapDose-watch.apk',
    body: false,
    peptides: false,
    visits: true,
  },
} as const;

export const edition = EDITIONS[EDITION];
/** Weight, measurements, goals and progress photos. */
export const HAS_BODY = edition.body;
/** Peptide and injection tools (still switched on per person in Settings). */
export const HAS_PEPTIDES = edition.peptides;
/** Appointments (questions, the "since my last appointment" summary, the Trends range) and the trip planner. TapDose only
 *  (owner decision); MedTap keeps lab results under Settings. */
export const HAS_VISITS = edition.visits;
export const releasePage = `https://github.com/lumenbuild/MedTap/releases/tag/${edition.release}`;
export const apkDownload = `https://github.com/lumenbuild/MedTap/releases/download/${edition.release}/${edition.apk}`;
export const watchDownload = `https://github.com/lumenbuild/MedTap/releases/download/${edition.release}/${edition.watchApk}`;
