// Four apps are built from this code (VITE_EDITION at build time):
// - MedTap: everything, including peptide tools. Published on GitHub only.
// - TapDose: medications and ADHD support. It never shows or mentions peptides, weight, measurements, goals or photos.
// - TapWeigh: weight, measurements, goals, photos and food. No medicines.
// - TapLift: training, with weight and body composition. No medicines or food logging.
// Each has its own name, website address, tag links, Android app and data, and every one is built around NFC tags.
export type Edition = 'medtap' | 'tapdose' | 'tapweigh' | 'taplift';

const ASKED = import.meta.env.VITE_EDITION;
export const EDITION: Edition = ASKED === 'tapdose' || ASKED === 'tapweigh' || ASKED === 'taplift' ? ASKED : 'medtap';

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
    /** Where the website (and so the NFC tag links) lives, under lumenbuild.github.io/MedTap/. */
    path: '',
    meds: true,
    body: true,
    training: true,
    food: true,
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
    path: 'tapdose/',
    meds: true,
    body: false,
    training: false,
    food: false,
    peptides: false,
    visits: true,
  },
  tapweigh: {
    name: 'TapWeigh',
    androidId: 'app.tapweigh.tracker',
    dbName: 'tapweigh',
    release: 'tapweigh-android',
    apk: 'TapWeigh.apk',
    watchApk: 'TapWeigh-watch.apk',
    path: 'tapweigh/',
    meds: false,
    body: true,
    training: false,
    food: true,
    peptides: false,
    visits: false,
  },
  taplift: {
    name: 'TapLift',
    androidId: 'app.taplift.tracker',
    dbName: 'taplift',
    release: 'taplift-android',
    apk: 'TapLift.apk',
    watchApk: 'TapLift-watch.apk',
    path: 'taplift/',
    meds: false,
    body: true,
    training: true,
    food: false,
    peptides: false,
    visits: false,
  },
} as const;

export const edition = EDITIONS[EDITION];
/** Medications, doses and everything about them (reminders, refills, effect windows). Off in TapWeigh and TapLift. */
export const HAS_MEDS = edition.meds;
/** Weight, measurements, goals and progress photos. */
export const HAS_BODY = edition.body;
/** Workouts, the exercise library, readiness, protein and water (still switched on in Settings where it's optional). */
export const HAS_TRAINING = edition.training;
/** Food logging: barcodes, labels, meals and recipes. */
export const HAS_FOOD = edition.food;
/** The app's one main thing, where it is a single thing: TapWeigh is about weight, TapLift about training. */
export const FOCUS: 'meds' | 'weight' | 'training' = EDITION === 'tapweigh' ? 'weight' : EDITION === 'taplift' ? 'training' : 'meds';
/** Built for Google Play (VITE_STORE=play): updates come from Play, so the app's own update check and installer are off. */
export const PLAY = import.meta.env.VITE_STORE === 'play';
/** A Wear OS app to go with it (MedTap and TapDose), installed from GitHub, so not offered in Play builds. */
export const HAS_WATCH = (EDITION === 'medtap' || EDITION === 'tapdose') && !PLAY;
/** Peptide and injection tools (still switched on per person in Settings). */
export const HAS_PEPTIDES = edition.peptides;
/** Appointments (questions, the "since my last appointment" summary, the Trends range) and the trip planner. TapDose only
 *  (owner decision); MedTap keeps lab results under Settings. */
export const HAS_VISITS = edition.visits;
export const releasePage = `https://github.com/lumenbuild/MedTap/releases/tag/${edition.release}`;
export const apkDownload = `https://github.com/lumenbuild/MedTap/releases/download/${edition.release}/${edition.apk}`;
export const watchDownload = `https://github.com/lumenbuild/MedTap/releases/download/${edition.release}/${edition.watchApk}`;
