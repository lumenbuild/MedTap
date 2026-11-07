# MedTap: full review, SWOT and plan forward (personal use)

Reviewed 7 Nov 2026 at commit `6618a94` (PR #61). Everything below was checked in the code, the build and CI, not
assumed from PROGRESS.md.

**Scope:** this app is for the owner's own use. It isn't being published or sold, so store listings, regulation,
business and other users are out of scope. What matters is that it's reliable, fast, keeps the data safe and stays
easy to change.

---

## 1. What the app is, in one paragraph

A local-first, offline web app (React 18 + TypeScript + Vite + Tailwind + Dexie/IndexedDB) wrapped in Capacitor 8 for
Android and iOS, with a custom native plugin (Java/Kotlin/Swift, ~4,800 lines) for NFC, Health Connect / HealthKit,
widgets, Wear OS, reminders, printing and file access. Its core idea is **tap an NFC tag stuck on a thing (a medicine,
a vial, scales, a gym machine, a shaker) to log it**. Around that sits a large on-device analytics layer: schedules,
stock and refills, peptide reconstitution and vial tracking, check-ins, body composition, training progression, food and
micronutrients, forecasts and pattern finding. One codebase builds four apps (MedTap, TapDose, TapWeigh, TapLift),
each with its own data, website path, tag URLs and Android package.

### By the numbers

| Measure | Value |
|---|---|
| Source | 316 TS/TSX files, 44,011 lines in `src/` |
| Pure logic modules | ~150 in `src/logic/` (time passed in, so testable) |
| Tests | 88 files, 688 tests, 7,520 lines, **all passing** (29 s) |
| Type check | Clean (`tsc --noEmit`) |
| Production dependency audit | 0 known vulnerabilities |
| Screens / routes | ~45 routes, 5 main tabs |
| Database | Dexie schema v11, 22 tables |
| History | 169 commits, 61 PRs, 20 Oct → 7 Nov 2026 (18 days) |
| Main JS bundle | **1,973 KB (630 KB gzipped)**, plus lazy chunks; `dist/` is 18 MB with OCR assets |
| CI | Pages deploy + native builds green on the latest merge |
| Open issues | 0 (the issue tracker isn't being used) |

### Architecture map

```
Tag tap (NFC / QR / URL ?t=ID) ──► router (#/tag/ID) ──► TagLanding ──► db/repos/* ──► IndexedDB (Dexie, per edition)
                                                                     ▲
Screens (src/screens) ── hooks (app/data.ts: useLive → liveQuery, private-view filtering) ──┘
        │
        └── pure analytics (src/logic/*: schedule, plans, predict, forecast, training, nutrition, peptide …)

Native shell (Capacitor) ── medtap-native plugin: NFC, Health Connect/HealthKit, notifications, widgets, Wear OS, files
Backups: JSON → AES-GCM with a built-in public key ── file / auto-backup folder
Family sync: snapshot → gzip → AES-GCM (random 256-bit family key) ── optional Cloudflare Worker relay or files
```

---

## 2. Strengths

1. **Tap-to-log works, and works on your phone.** The hard parts are solved: tags open the app rather than Chrome
   (Android Application Record), vial tags move to a new vial, the double-tap guard, undo, QR fallback. Confirmed on
   your Samsung and watch on 7 Nov 2026 (`docs/DEVICE-TESTS.md`).
2. **Private by design.** No accounts, no analytics, no server. App lock, private view, nicknames, discreet
   reminders. Family sync, if you ever use it across your own devices, is properly end-to-end encrypted.
3. **A well-shaped logic layer.** Logic is pure functions with `now` passed in, and time-zone maths is tested across
   daylight saving. That makes it safe to change.
4. **Good test discipline for logic.** 688 unit tests over schedules, stock, sync, crypto, migrations, peptides,
   training and food, all passing. Migrations never edit a shipped version.
5. **Built exactly around how you live.** Peptides and vials, training progression, food, the smart scale, Health
   Connect, widgets and the watch in one app, with no subscription.
6. **Decisions are written down.** PROGRESS.md records why things are the way they are, which is what lets you (or
   an AI helper) change things later without breaking them.
7. **Hands-off updates.** CI builds and signs the APK on every merge and the app updates itself from GitHub releases.

## 3. Weaknesses

### 3.1 Process
1. **Features are growing faster than they're checked.** 44k lines in 18 days, ~45 screens, ~150 analytics modules.
   Each PR bundles several features. For one person that's fine while it works, but each feature is something that
   can break after an update, and you'll only find out by noticing.
2. **The "smart" estimates rest on small samples.** Side-effect forecasts, wear-off, "what goes with your good weeks",
   stall causes and step-up readiness are gated on minimum counts, but with a few weeks of one person's data, some will
   be noise. It's easy to act on a pattern that isn't really there. The app doesn't always show how much data an
   estimate rests on.
3. **Four apps' worth of overhead for one user.** Every push builds MedTap, TapDose, TapWeigh and TapLift (APKs, Play
   bundles, watch apps), and every change has to respect four editions. If you only use MedTap, that's slower CI and
   more to keep correct, for nothing.
4. **Docs have drifted.** PROGRESS.md doesn't cover the Food tab, scale sync, micros, the five tabs, Stack smart or
   Week ahead, and it refers to a `HANDOFF.md` that isn't in the repo. Thirteen screenshots and `tsconfig.tsbuildinfo`
   are committed at the repo root. The default branch is still `claude/confident-maxwell-rta5d8`.
5. **Mostly AI-written code.** Fine, but it means the docs and tests are what lets future sessions change things
   safely. Keep them current.

### 3.2 Engineering
6. **The bundle is big for a tag tap.** A tag tap loads a 1.97 MB main chunk (630 KB gzipped). Four lazy imports
   don't take effect because the same modules are also imported directly (`maintenance.ts`, `native.ts`, `ocr.ts`,
   `LogFoodSheet.tsx`; see the build warnings). It feels fine on your Samsung now; it's the first thing to fix if a tap
   starts to feel slow.
7. **It will slow down as your history grows.** 84 whole-table `toArray()` loads (doses, daily health, food logs,
   workouts), with the analytics rerun on every render (Today has 3 `useMemo`s; Trends and Protocol have none). After
   a year of food logs, heart rate and workouts, Today and Trends will lag.
8. **Screens aren't regression-tested.** The browser runs, accessibility checks and screen-fit checks in PROGRESS.md
   were one-offs and aren't in the repo. There's no lint and no coverage report. A change to one screen can quietly
   break another.
9. **Dose maths is the one place a bug can hurt you.** Units per dose, U-100 vs U-40 syringes, pens, blends and vial
   yield are tested, but by example only. A mix-up between syringe types is a 2.5× error.
10. **Lock-screen back-off lives in React state**, so a reload resets it. Fine for a privacy screen, which is what
    the code says it is.

### 3.3 Data safety
11. **Your phone is the main copy of everything.** Auto-backup to a folder works (tested). But if that folder is on
    the same phone, a lost or broken phone takes the backups with it.
12. **Backups can be read by anyone with the app's code.** The built-in backup key is in the public repo, so a backup
    in Google Drive, email or a shared folder is only scrambled, not protected. That's about your own privacy if that
    copy ever leaks.
13. **The signing key.** If the keystore or its password is lost, the next APK won't install over the current one, and
    you'd have to uninstall the app, wiping its data unless you've backed up first.

## 4. Opportunities

1. **Make it faster** (bundle split, loading only recent data, a Web Worker for analytics), so it stays snappy for
   years of data.
2. **Simplify.** Build only the edition you use in CI (keeping the others' code if you like), and after a month of
   real use, hide or remove the features you never open. Less to break.
3. **Make the insights trustworthy.** Show "based on N weeks / N check-ins" everywhere and hide estimates below a
   confidence bar, so the ones you see are worth acting on.
4. **Health Connect write-back** (weight, workouts, nutrition), so other apps and your watch see what you log here.
5. **Self-host the sync relay** (one free Cloudflare Worker) if you want the app on a second device, such as a tablet.
6. **Clinic visits.** The doctor report already exists; it's useful whenever you see a GP.

## 5. Threats

1. **Losing your data:** phone lost or broken, the app uninstalled, or a restore that doesn't work when you need it.
2. **Losing the signing key** (see 3.3 #13).
3. **The permanent address `lumenbuild.github.io/MedTap/`.** Every tag points there.
   - On Android with the app installed, tags open the app via the Application Record, so this matters less.
   - QR codes, and tags read by a browser or an iPhone, depend on the site.
   - **Don't make the repo private on a free GitHub plan.** Pages on a private repo needs a paid plan, so the site
     (and those tag links) would go down. Renaming the repo breaks them too (the deploy workflow already guards
     against that).
4. **Android sideloading rules.** Google is bringing in developer verification for apps installed outside Play
   (from September 2026 in some countries, wider in 2027). Check whether it affects installing your own APK, and
   whether installing over USB with `adb` stays exempt for you.
5. **OS and library updates.** Android, One UI, Health Connect or Capacitor updates can quietly break reminders,
   Health Connect or NFC. Re-run the device checklist after a big phone update.
6. **Acting on a wrong number.** A dose-maths bug or a noisy pattern (3.1 #2, 3.2 #9).

### SWOT at a glance

| | Helpful | Harmful |
|---|---|---|
| **Internal** | Tap-to-log proven on your phone · private · pure, tested logic · everything you track in one app · decisions written down · self-updating | Features outpacing checks · small-sample insights · four editions' overhead · 2 MB bundle · whole-table loading · no screen tests or lint · dose maths tested by example only · docs drift |
| **External** | Faster with growth · simplify · trustworthy insights · Health Connect write-back · second device via relay | Data loss · losing the keystore · dependency on the Pages address · sideloading rules · OS updates breaking things |

---

## 6. The plan forward

The principle: **protect the data, keep it from breaking, keep it fast, and only add what you'll use.**

### Step 1: protect your data (this week, about an hour)
- [ ] Copy the keystore file and its password into a password manager, plus one offline copy (USB stick).
- [ ] Point automatic backups at a folder that syncs off the phone (Google Drive or OneDrive folder via the
      Android picker), or copy a backup off the phone weekly.
- [ ] Do a restore drill once: restore the latest backup onto a second phone or a fresh install and check the doses,
      vials and workouts are all there.
- [ ] Optional, worth it if backups live in the cloud: add a **backup passphrase** (real encryption, PBKDF2 with the
      existing 310k iterations), keeping the built-in key as the fallback so old backups still restore.
- [ ] Lock back-off saved in the `device` table so a reload doesn't reset it (small).

### Step 2: keep it from breaking (next 2–3 weeks)
- [ ] **Property tests for the dose maths** (`fast-check`): draw ↔ dose round-trips across U-100/U-40, pens and
      blends, plus a few golden cases worked by hand. Show the working on the draw screen
      ("5 mg in 2 mL → 2.5 mg/mL → 0.25 mg = 10 units") so you can sanity-check it at a glance.
- [ ] **A small Playwright smoke suite in CI** (MedTap only): open Today, unknown tag → assign → log → undo, log a
      shot from a vial, check-in, log food, start a workout, backup → erase → restore. Plus screen fit at 360×800 and
      axe. This catches "an update broke a screen" before it reaches your phone.
- [ ] **ESLint** with the React hooks rules; fix the real issues it finds.
- [ ] **A local error log** (last 200 errors in the `device` table) with "Copy diagnostics" in Settings → About, so
      when something odd happens you can paste it into a session instead of describing it.
- [ ] **Bring PROGRESS.md up to date** and keep updating it with each PR. Move or delete the root screenshots, ignore
      `*.tsbuildinfo`, rename the default branch to `main`.
- [ ] After a big phone or app update, re-run `docs/DEVICE-TESTS.md`. When you get the chance, run its edge cases
      once (restart, daylight saving, double tap) and time a cold tag tap.

### Step 3: keep it fast (when you have a session free)
- [ ] Run `rollup-plugin-visualizer` once to see what's in the 2 MB chunk.
- [ ] Fix the four lazy imports that don't take effect, and give the tag screen its own small entry. Target: under
      250 KB gzipped to reach the Log button.
- [ ] Load recent data by default (`where('at').above(since)`, e.g. 90 days), and all of it only when a screen
      asks for "All".
- [ ] `useMemo` the per-screen analytics, and move the heavy ones (predict, forecast, weekAhead, insights, changes)
      into a Web Worker.
- [ ] A "two years of data" test fixture with a time budget, so slowdowns show up in CI rather than on your phone.

### Step 4: simplify (after a month of real use)
- [ ] Decide whether you need TapDose, TapWeigh and TapLift. If not, build only MedTap in CI (faster runs). The
      edition code can stay; it costs little.
- [ ] Look at what you actually open. Hide or remove features you never use; that's less to keep correct.
- [ ] For the insights you do use, show how much data they rest on and hide them below a minimum.

### Step 5: add only what you'll use
A short list to pick from when you want something new:
- Health Connect write-back (weight, workouts, nutrition).
- The sync relay deployed on a free Cloudflare account, if you want a second device.
- Injection-site rotation (previously skipped).

Rule of thumb: one feature per PR, with its tests, and a line in PROGRESS.md.

## 7. Ten things to do first

1. Back up the keystore and password (password manager + offline).
2. Make sure automatic backups land somewhere off the phone.
3. Do one restore drill.
4. Property tests and on-screen working for the dose maths.
5. A Playwright smoke suite and ESLint in CI.
6. A local error log with "Copy diagnostics".
7. Bring PROGRESS.md up to date; rename the default branch to `main`; tidy the repo root.
8. Fix the four lazy imports and shrink the tag-tap bundle.
9. Load recent data by default; memoise or move the heavy analytics to a worker.
10. After a month, prune what you don't use, and decide about the other three editions.
