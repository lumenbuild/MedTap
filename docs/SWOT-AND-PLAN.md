# MedTap: full review, SWOT and plan forward

Reviewed 7 Nov 2026 at commit `6618a94` (PR #61). Everything below was checked in the code, the build and CI, not
assumed from PROGRESS.md.

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

1. **A genuinely distinctive core interaction.** Tap-to-log with physical NFC tags is a real wedge: it removes the
   "did I take it?" problem better than any reminder app. The hard parts are solved: tag IDs, permanent URLs, Android
   Application Records so tags open the app instead of Chrome, re-pointing a vial tag to a new vial, double-tap guard,
   undo, QR fallback, iPhone Scan button.
2. **Privacy by design, honestly engineered.** No accounts, no analytics, no server. App lock (PBKDF2 PIN), a second
   "private view" PIN with cover names, nicknames, discreet reminders, PIN on every tag tap. Family sync is properly
   end-to-end encrypted (random 256-bit key, AES-GCM, relay sees only ciphertext and a hashed family ID).
3. **A well-shaped logic layer.** Business logic is pure functions with `now` passed in, time-zone maths via `Intl`,
   tested across DST and machine zones. This is the hardest part of a medication app to get right and it's the best
   part of this codebase.
4. **Real test discipline for logic.** 688 unit tests over schedules, stock, sync, crypto, migrations, peptides,
   training, food, privacy. Migrations follow "never edit a shipped version".
5. **One codebase, four products.** Edition flags (`src/edition.ts`) gate features, data, URLs, icons and Android
   flavours, with tests and a Gradle check that stops cross-edition builds. That's a cheap way to test four markets.
6. **Breadth that competitors charge for.** Peptide reconstitution and vial yield, refill forecasting with planned
   changes, ADHD effect windows, training progression (RPE-aware), food with barcode/OCR/recipes, smart-scale data,
   Health Connect, widgets, Wear OS, doctor reports.
7. **Accessibility and fit were taken seriously.** axe-core WCAG 2.1 AA audits, every sheet checked at four phone
   sizes, colour-blind-safe validated palette, tables behind every chart.
8. **Decisions are written down.** PROGRESS.md records the why (permanent URL, backup key, what was rejected). Rare
   and valuable.
9. **Shipping pipeline exists.** CI builds all flavours, signs releases, publishes APKs and Play bundles, stamps build
   numbers, and the app updates itself from GitHub releases.

## 3. Weaknesses

### 3.1 Product and process
1. **Real-device testing is one phone, and isn't written down.** The owner has tested on a Samsung (update 7 Nov
   2026), but PROGRESS.md still lists Health Connect, widgets, the watch, Web NFC error mapping, double NFC fire and
   training reminders as "not tested on a real phone yet", and there's no record of what passed. Still untested:
   iPhone (tag taps, HealthKit, Siri), a non-Samsung Android, an older Android version, and the Wear OS watch.
   Samsung is the hardest case for reminders (battery saving), so that's a good start; the gap now is coverage and a
   repeatable written test plan.
2. **Scope has outrun validation.** 44k lines in 18 days, ~45 screens, ~150 analytics modules, four editions. Each
   PR bundles several features ("Week ahead … warnings … water target … morning briefing … forecast checked against
   last month"). No real user has used most of it yet. Every new feature adds surface that must be kept correct.
3. **Many "smart" estimates rest on small samples.** Side-effect forecasts, wear-off, "what goes with your good
   weeks", stall causes, step-up readiness: they're thoughtfully gated (minimum counts), but with one person's
   handful of weeks, many will be noise presented as insight. Confidence isn't always visible.
4. **Caution notes were removed deliberately** ("Remove caution notes"), while the app moved closer to advice
   (see Threats 5.1). That combination is risky.
5. **No issue tracker, no roadmap, no review.** One long-lived branch (`claude/exciting-clarke-4n7pg3`) merges into
   a default branch still called `claude/confident-maxwell-rta5d8`. PRs are merged without review or a checklist.
6. **Docs have drifted.** PROGRESS.md stops before the Food tab, scale sync, micros, five tabs, Stack smart and Week
   ahead. It references `HANDOFF.md`, which isn't in the repo. Thirteen screenshots and `tsconfig.tsbuildinfo` are
   committed at the repo root.
7. **Bus factor of one, and a codebase written mostly by an AI.** If you can't explain how stock is recounted after
   a sync merge, you can't safely change it. That's a maintenance risk, not a criticism.

### 3.2 Engineering
8. **The bundle works against the main promise.** The tag-tap path loads a 1.97 MB main chunk (630 KB gz). Four
   dynamic imports are defeated because the same modules are also imported statically (`maintenance.ts`,
   `native.ts`, `ocr.ts`, `LogFoodSheet.tsx`; see the build warnings). On a mid-range Android phone, a cold tag tap
   will be noticeably slower than it should be.
9. **Data loading won't scale.** 84 `toArray()` calls; hooks like `useDoses`, `useDaily`, `useWorkouts` load whole
   tables, and screens rerun the analytics every render (Today has 3 `useMemo`s; Trends and Protocol have none).
   After a year of food logs, hourly heart rate and workouts, Today and Trends will get sluggish. No analytics run in a
   Web Worker.
10. **UI isn't regression-tested.** The browser flows, axe audits and fit audits in PROGRESS.md were one-off runs and
    aren't in the repo. No Playwright suite, no ESLint (the code has `eslint-disable` comments, but there's no
    config), and no coverage report.
11. **Sync relay has rough edges** (`sync-relay/worker.js`):
    - the first writer's token is set with a non-atomic get-then-put on KV, so two phones can race;
    - no rate limiting or size budget per family;
    - whole-snapshot sync with a 5 MB cap, which food logs and daily heart rate will eventually hit;
    - last-writer-wins per record, so simultaneous edits to the same record lose one;
    - not deployed (`id = "PASTE_THE_ID_HERE"`), so for real users sync is file-based only.
12. **Lock screen back-off lives in React state**, so a reload resets it. A 4–6 digit PIN over unencrypted
    IndexedDB is a privacy screen (which the code says honestly), not protection.
13. **Australia-only by construction.** "Call 000", AU dispensing labels, AU brands, en-AU text, no i18n layer. Fine
    for now; it limits the market.

### 3.3 Data safety
14. **The device is the only copy.** Backups are manual or folder-based; on iPhone they're reminders only. On the
    web, `navigator.storage.persist()` is only requested after the first dose, and Safari can clear site data for
    sites not added to the home screen. One lost phone = lost history.
15. **"Encrypted backups" is a misleading claim.** The internal note is honest: the key is in public code, so
    backups are scrambled, not protected. But the **privacy policy says "Backup files are encrypted"** and the **Play
    listings say "Encrypted backups"**. That's a store-policy and consumer-law problem as well as a trust problem.

## 4. Opportunities

1. **GLP-1 and injectables are a huge, fast-growing user base.** People on semaglutide/tirzepatide (branded and
   compounded) want shot day, site, dose step, side effects, weight and protein in one place. Your shot-week,
   vial, side-effect timing and lean-mass features are ahead of most trackers. TapWeigh plus a "shot" add-on (approved
   medicines only) is Play-friendly.
2. **ADHD medication (TapDose)** is underserved: effect window, wear-off heads-up, caffeine against sleep, days on
   and off, the "did I take it?" problem. A clear, focused niche with active online communities.
3. **Sell the tags.** `store/shop/` already has kit images (medicine kit, gym kit, metal tags). Pre-encoded tag kits
   are a physical product with margin, a reason to buy, and a moat (the tags only work with your app).
4. **Caregivers and families.** Shared medicines, per-person views and sync are built. Parents managing a child's
   ADHD meds, or adults managing an ageing parent's, are a buying audience.
5. **Clinician-facing output.** The doctor report and appointment summary could become a standard (PDF + a FHIR
   export later). GPs and pharmacists who like the report become referrers.
6. **Gyms (TapLift).** Tags on machines are a natural gym partnership: the gym tags its machines, members use the app.
7. **Business models that fit local-first:** a one-time "Pro" unlock, tag kits, and an optional *hosted* sync
   relay as a small subscription (you already have the encrypted relay; you'd just run it).
8. **iOS.** Most paying health-app users in Australia are on iPhone. TapDose on the App Store, with Associated
   Domains (tags open the app) and a WidgetKit widget.
9. **Localisation** (NZ, UK, Ireland, Canada, US) once the core is proven: emergency numbers, label parsers, units.
10. **Health Connect / HealthKit write-back** (weight, workouts, nutrition) makes the app a good citizen of the
    phone's health ecosystem and helps store review.

## 5. Threats

### 5.1 Regulatory and legal (take these seriously before any wide release)
1. **Software as a medical device.** In Australia the TGA exempts or excludes some software (simple record keeping,
   reminders), but software that recommends or calculates doses, or tells someone when to step up a dose, can be
   regulated as a medical device. Features like **"Step when ready"** (prompts to increase a dose),
   **reconstitution draw calculations**, the guide's "lowest dose … the app holds the dose while you're losing and
   asks about a step", and Week ahead's "what to do about each" move the app away from record keeping. PROGRESS.md
   originally said "protocol templates with doses (would be dosing advice)" were *not* built; the peptide guide
   now contains dose ranges, step-up schedules and setup that fills them in. Equivalent rules exist in the US (FDA),
   UK (MHRA) and EU (MDR).
2. **Promoting unapproved therapeutic goods.** The guide covers unapproved or research peptides (retatrutide,
   BPC-157, TB-500, melanotan …) with "common use" doses, suppliers, purity and batch tracking. In Australia,
   advertising therapeutic goods to the public is regulated and some of these substances are prohibited or
   prescription-only. Publishing that on a public website and a public GitHub repo carries legal risk to you
   personally, and to the hosting accounts the whole tag system depends on.
3. **Liability for calculation errors.** A wrong units-per-dose figure on a U-100 vs U-40 syringe is a 2.5× dosing
   error. Dose maths is safety-critical and needs independent verification and a documented test basis.
4. **Consumer law and store policy.** "Encrypted backups" (see 3.15); health claims in store copy; Google Play's
   health app declarations, Health Connect permission review and "medical functionality" disclaimers. Removed
   disclaimers make all of this harder.
5. **Open Food Facts licence (ODbL)** requires attribution, and share-alike for a database derived from it.

**Get advice from an Australian health/regulatory lawyer before the peptide features reach anyone beyond yourself.**
This document flags the issues; it isn't legal advice.

### 5.2 Platform
6. **Single point of failure: `lumenbuild.github.io/MedTap/`.** Every tag ever written points there, by design and
   forever. If the GitHub account is suspended (for example over the peptide content), the repo is renamed, or Pages
   changes, every web/iPhone tag breaks (Android tags with the app installed still open the app via the AAR). The cost
   of changing this grows with every tag written: it's cheapest to reconsider now, before you sell tag kits.
7. **Android sideloading is tightening.** Google announced developer verification for apps installed on certified
   Android devices (starting in some countries from September 2026, broader in 2027). Check the current status: it
   could affect the GitHub-APK route, which is MedTap's *only* route, since it can't go on Play.
8. **Play onboarding.** New personal developer accounts must run a closed test (currently at least 12 testers for 14
   days) before production. Health Connect access needs a separate declaration and review.
9. **OS changes** to background work, exact alarms, battery optimisation (Samsung especially), Health Connect APIs
   and Capacitor majors can silently break reminders, the feature people most depend on.

### 5.3 Market and personal
10. **Competition** is polished and cloud-backed: Medisafe, MyTherapy (meds); Shotsy, Glapp and other GLP-1
    trackers; Strong, Hevy (lifting); MacroFactor, Cronometer (food). You win on tags, privacy and depth, not on
    breadth: four editions spread thin against four specialised competitors.
11. **Trust is fragile in health.** One data-loss event, one wrong reminder, one wrong draw figure, and reviews say so
    permanently.
12. **Maintenance load and burnout.** The surface area is already large for one person; feature pace is not
    sustainable alongside support, store reviews and real-device testing.

### SWOT at a glance

| | Helpful | Harmful |
|---|---|---|
| **Internal** | Tap-to-log wedge · privacy-first · pure, tested logic · four editions from one codebase · depth (peptides, ADHD, training, food) · CI and signing | Not tested on real devices · scope sprawl · 2 MB bundle · whole-table loading · no UI tests or lint · device is the only copy · misleading "encrypted" claim · docs drift · bus factor of one |
| **External** | GLP-1 boom · ADHD niche · tag kits · caregivers · clinician reports · gyms · hosted sync · iOS · other countries | Medical device rules · unapproved goods advertising · dose-error liability · single-URL dependency · Android sideloading changes · store review · strong competitors · burnout |

---

## 6. The plan forward

The principle: **stop adding, prove what's there, make it safe, then launch one thing well.**

### Phase 0: freeze and organise (week 1)

- [ ] **Feature freeze** until Phase 2 is done. Only fixes.
- [ ] Rename the default branch to `main` (the workflows need no change, as PROGRESS.md notes). Turn on branch
      protection: CI must pass, no direct pushes.
- [ ] Start using GitHub Issues with labels: `bug`, `device-test`, `safety`, `legal`, `perf`, `docs`, `idea`. Move
      every "not tested on a real phone" line from PROGRESS.md into an issue.
- [ ] One feature per PR from now on, with a short checklist (tests added, editions checked, device-tested?).
- [ ] Bring PROGRESS.md up to date (Food tab, scale, micros, five tabs, Stack smart, Week ahead). Add HANDOFF.md
      or remove the reference. Move root screenshots to `docs/images/` (or delete) and add `*.tsbuildinfo` to
      `.gitignore`.
- [ ] Fix the claims now: privacy policy and Play listings should say backups are "scrambled so they can't be read
      by casually opening them" (or ship a passphrase, Phase 1), not "encrypted". Add the recipe-page fetch to the
      "when something leaves your phone" list.
- [ ] Back up the Android keystore and password in two places (password manager + offline). Losing it means every
      user reinstalls.

### Phase 1: safety and trust (weeks 1–4)

**Dose safety**
- [ ] Write a one-page "dose maths spec" for `logic/peptide.ts`, `doseCheck.ts`, `countTablets.ts`, `stock.ts`:
      formulas, units, rounding, syringe types. Have someone else (a pharmacist friend is ideal) check it.
- [ ] Add property-based tests (e.g. `fast-check`) for draw ↔ dose round-trips, U-40/U-100, pens and blends; and
      golden tests from worked examples checked by hand.
- [ ] Show the working on every draw: "5 mg in 2 mL → 2.5 mg/mL → 0.25 mg = 10 units". People catch errors when they
      can see the arithmetic.

**Regulatory scoping**
- [ ] Book a consult with a health/regulatory lawyer (AU). Bring: the feature list, the peptide guide, "Step when
      ready", Week ahead advice, the store listings.
- [ ] Until then, decide per edition what's in scope. Suggested default:
  - **TapDose / TapWeigh / TapLift (Play):** record keeping, reminders, the person's own entered plan, their own
    patterns. No dose suggestions, no step-up prompts, no peptide guide.
  - **MedTap (personal / GitHub):** consider keeping it private (a private repo and a site that isn't public) until
    you've had advice, or strip guide dose ranges down to links to primary sources.
- [ ] Bring back a small, consistent, non-nagging line where calculations or plans appear ("Check against your
      prescriber's instructions"). One line, not banners; it matters for both safety and store review.
- [ ] Mark low-evidence insights with how much they rest on ("based on 4 weeks, 9 check-ins") everywhere, and hide
      them below a confidence bar rather than showing noise.

**Data durability**
- [ ] Ask for `navigator.storage.persist()` at onboarding, not after the first dose; show storage status in Backup.
- [ ] Optional **backup passphrase** (real encryption, PBKDF2 at the existing 310k iterations); keep the built-in key
      as the default so old backups and the no-password flow still work.
- [ ] Auto-backup on iPhone in the native app (Files/iCloud Drive folder via the plugin you already have for Android).
- [ ] A "restore drill" test in CI: build a large realistic dataset, back up, erase, restore, compare every table.
- [ ] Lock back-off persisted in the `device` table so a reload doesn't reset it.

### Phase 2: prove it on real hardware (weeks 2–6, overlaps Phase 1)

**Hardware you need**
- Android: the Samsung you already test on (battery optimisation is the worst case), plus one Pixel on current
  Android and one older Android (12 or 13).
- iPhone: one on current iOS (iPhone XS or newer for background tag reading).
- Wear OS watch (if keeping the watch app; otherwise drop it for now).
- Tags: NTAG213 and NTAG215 stickers, on-metal tags for gym kit, a couple of key fobs.
- Smart scale that writes to Health Connect.

**Device test plan** (make it `docs/DEVICE-TESTS.md`, run it before every release)
1. Tag write, test, update (AAR) on Android; write on iPhone app; read with the app closed, locked, in another app.
2. Double tap, tap during a sheet, tap with the PIN-on-tag setting, tap a tag from another edition.
3. Reminders: set times across a day boundary, intervals, snooze, skip, Log it; after a reboot; with battery saving;
   after 3 days without opening the app; across a time-zone change and DST.
4. Health Connect / HealthKit: permission grant, deny twice, revoke, import each type, re-import, deleted items.
5. Widgets: each of the 8 placed, light/dark, tap actions while the app is killed.
6. Backups: auto-backup folder survives a reboot and an app update; restore on a second phone.
7. Sync: two phones, offline edits on both, merge; stock correct after.
8. Update install from GitHub; Play internal test track install.
9. Cold-start time of a tag tap on the mid-range phone (target below).

**Recruit 10–20 real testers** (also satisfies Play's closed-test rule): friends on GLP-1s, ADHD meds, lifters. Give
them tags. A short weekly form: what broke, what confused you, what you'd pay for.

### Phase 3: engineering health (weeks 3–8)

**Performance**
- [ ] Fix the four defeated dynamic imports (move static imports behind the lazy boundary). Split the tag-landing
      path into its own small entry: target **< 250 KB gzipped** to log a dose, **< 1.5 s** cold tag tap to the Log
      button on the mid-range Android.
- [ ] Add `rollup-plugin-visualizer` once to see what's in the 2 MB chunk (likely charts, analytics, guides, food
      data, lucide icons imported broadly).
- [ ] Indexed, ranged queries instead of whole-table loads (`where('at').above(since)`); load 90 days by default and
      more only on Trends' "All".
- [ ] Memoise per-screen analytics (`useMemo` keyed on data versions), and move heavy analytics (predict, forecast,
      weekAhead, insights, changes) into a Web Worker.
- [ ] A seeded "two years of data" fixture and a perf test that fails if Today's compute goes over a budget.

**Quality gates in CI**
- [ ] ESLint (typescript-eslint + react-hooks) and Prettier; fix or explicitly allow existing patterns.
- [ ] Playwright suite in the repo, run in CI per edition: onboarding, add medicine, unknown tag → assign → log →
      undo, check-in, backup/restore, private view never leaks a real name, TapDose forbidden-word scan, fit at
      320×568 and 412×915, axe in light and dark. (These all existed as one-off runs; commit them.)
- [ ] Coverage report on `src/logic` with a floor (e.g. 80%) for safety-critical modules.
- [ ] Type-check every edition in deploy.yml (cheap) and keep `npm audit` in CI.
- [ ] Renovate or Dependabot for Capacitor/Vite/Dexie with CI as the gate.

**Sync relay** (only if you'll offer hosted sync)
- [ ] Use a Durable Object (or D1) for the family token so the first write is atomic; add per-family rate limits and
      a storage budget; deploy it.
- [ ] Move from whole snapshots to per-table deltas since the last sync (by `updatedAt`) to stay well under limits.
- [ ] Field-level merge for the records most likely to be edited on two phones (medications, people).

**Diagnostics without tracking**
- [ ] A local error log (last 200 errors in the `device` table) with "Copy diagnostics" in Settings → About, so
      testers can send you what went wrong without any analytics.

### Phase 4: focus and launch one app (weeks 6–12)

Pick **one** lead product. The recommendation: **TapDose** (medications and ADHD) or **TapWeigh** (weight + food,
optionally with approved-GLP-1 shot logging). Both can go on Play, have clear audiences and avoid the peptide-guide
risk. Keep MedTap as your personal/power-user build.

- [ ] Accounts: Google Play developer ($25 one-off; an organisation account needs a D-U-N-S number), Apple Developer
      Program (US$99/yr) when iOS starts, an ABN if you'll sell anything, a support email on a domain you control.
- [ ] Play: closed test (12+ testers, 14 days) → health app declaration → Health Connect declaration with the
      privacy page → data safety form (matches the corrected privacy policy) → production.
- [ ] Store listing rewritten to match what's verified on devices; screenshots regenerated
      (`scripts/store/make-store-graphics.mjs`); Open Food Facts attribution in the app and listing.
- [ ] A one-page website on your own domain explaining tags, with a "get tags" link (it can link to the permanent
      GitHub Pages app; the tags keep working).
- [ ] Decide the URL question before selling tag kits (see Threat 6): either commit to GitHub Pages with eyes open,
      or put a domain you own in front of new tags now, keeping the old address working.

### Phase 5: business (from launch)

- **Free:** logging, tags, reminders, Today, basic trends, backups.
- **Pro (one-time, ~A$15–30):** doctor report, advanced insights, widgets, family members, auto-backup, watch.
- **Hosted sync (~A$2–3/month):** the existing E2E relay, run by you.
- **Tag kits (A$15–30):** 6–10 pre-encoded, printed tags with a QR card; gym kit with on-metal tags. Start with a
  small batch and a simple shop (Shopify/Square); measure attach rate.
- Product liability / professional indemnity insurance once there's revenue and real users.

### Phase 6: grow (after product–market fit signals)

- iOS release of the lead app; Associated Domains (needs the `lumenbuild.github.io` root repo's
  `apple-app-site-association`); WidgetKit widget.
- Health Connect / HealthKit write-back; FHIR/CSV export for clinicians.
- Localisation: an i18n layer, emergency numbers, label parsers per country (NZ and UK first).
- Partnerships: pharmacies (print-on-dispense tags), ADHD clinics, gyms.
- Then, and only then, revisit the other editions and new features from the issue tracker, ranked by what testers
  asked for.

---

## 7. What success looks like (track these)

| Metric | Target before scaling |
|---|---|
| Device test plan | 100% pass on the Samsung, Pixel and iPhone |
| Cold tag tap → Log button (mid-range Android) | < 1.5 s |
| Tag-path JS | < 250 KB gzipped |
| Crash/error reports per tester-week | trending to ~0 |
| Reminder delivery on time (tester self-report) | > 98% |
| Testers still logging after 4 weeks | > 60% |
| Testers who'd pay | > 30% |
| Data-loss incidents | 0 |

## 8. The ten things to do first

1. Freeze features; rename the branch to `main`; turn on branch protection; start Issues.
2. Correct "encrypted backups" in the privacy policy and store listings.
3. Back up the keystore twice.
4. Write down the device test plan, record what already passes on the Samsung, and update PROGRESS.md's "not
   tested on a real phone" lines; then add a Pixel, an older Android and an iPhone.
5. Book the regulatory/legal consult; until then, keep peptide dosing content and step-up prompts out of anything public.
6. Independent check and property tests for all dose maths; show the working on draws.
7. Fix the bundle (tag path < 250 KB gz) and stop loading whole tables.
8. Commit a Playwright + axe suite and ESLint to CI.
9. Recruit 12–20 testers and run the Play closed test for the lead app.
10. Bring PROGRESS.md up to date and keep it current with each PR.
