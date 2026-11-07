# Device tests

Run after a big phone or app update, on each phone you use. Record the date, device, Android/iOS version, app build and
result. A failure goes in an issue labelled `device-test`. Fix it before relying on that feature again.

## Results so far

| Date | Device | OS | Build | Who | Result |
|---|---|---|---|---|---|
| 7 Nov 2026 | Samsung (model not recorded) | Android (version not recorded) | after PR #61 | Owner | All 8 core areas below work |

Next time, write down the model, the Android version and the build number (Settings → About), so a later failure can
be compared against a known good run.

## Devices

| Device | Status |
|---|---|
| Samsung phone | Tested 7 Nov 2026 |
| Wear OS watch | Tested 7 Nov 2026 (with the Samsung) |

Add a row if you start using another phone or tablet.

## Core areas (owner-tested on Samsung, 7 Nov 2026)

1. **Tag tap with the app closed:** opens the app, not Chrome, and logs once. ✅
2. **Writing tags:** link a new tag; "Update this tag" adds the app record. ✅
3. **Reminders:** arrive on time after a day or two without opening the app; Log it / In 15 min / Skip. ✅
4. **Health Connect import:** steps, sleep, heart rate, weight. ✅
5. **Home-screen widgets.** ✅
6. **Automatic backups** to a folder, and restoring. ✅
7. **Watch app.** ✅
8. **Speed:** a tag tap gets to the Log button quickly. ✅ (not timed; target below)

## Still worth checking on the Samsung

These go beyond the eight above, and are the cases most likely to break quietly:

- [ ] Double tap (tag held to the phone, or tapped twice fast): one dose, guard shown.
- [ ] Tag tap while a sheet is open, while locked (PIN), with "Ask for the PIN on every tag tap" on.
- [ ] A tag from another edition (TapDose tag with MedTap installed) opens the right app, or says so.
- [ ] Reminders after a phone restart, and after an app update.
- [ ] Reminders across a time-zone change and a daylight-saving change (Sydney: first Sunday in April / October).
- [ ] Health Connect: deny twice, then grant from the settings button; revoke and re-grant; HRV, body fat, lean mass,
      workouts; an item deleted in the app isn't re-imported.
- [ ] Each of the 8 widgets, light and dark; widget taps (+25 g protein, coffee, as-needed) with the app killed.
- [ ] Auto-backup folder still works after a restart and an app update; restore on a second phone.
- [ ] Family sync between two phones, with offline edits on both; stock correct afterwards.
- [ ] One-tap update install from the GitHub release.
- [ ] **Timed cold start:** force-stop the app, tap a tag, time to the Log button. Target under 1.5 s. Record it.
