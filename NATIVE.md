# MedTap for Android and iPhone

The installable apps are the same web app inside a native shell ([Capacitor](https://capacitorjs.com)), plus a
small plugin of our own (`native/medtap-native`) for the things a website can't do:

| | Website | App |
|---|---|---|
| Dose reminders | Calendar events, one at a time | Phone notifications for the week, with a **Log it** button |
| Write tags | Android Chrome only | Android and iPhone |
| Tag tap when closed | Android opens the browser; iPhone opens Safari | Android opens the app; iPhone: **Scan** button on Today |
| Data | Separate in each browser | One place |

Tags don't change: they still hold `https://lumenbuild.github.io/MedTap/?t=<ID>`, so the same tags work with
the website and the app.

## Build

```sh
npm ci
npm run build:native   # builds the web app into dist-native/ and copies it into android/ and ios/
```

Then open `android/` in Android Studio, or `ios/App/App.xcodeproj` in Xcode.

## Android

GitHub Actions (`.github/workflows/native.yml`) builds the app on every push.

**Publishing a signed app (do this once).** Android only installs an update if it's signed with the same key as
the app already installed, so the key must never change. Add two repository secrets (GitHub → Settings →
Secrets and variables → Actions → New repository secret):

- `MEDTAP_KEYSTORE_BASE64`: the keystore file, base64-encoded
- `MEDTAP_KEYSTORE_PASSWORD`: its password (key alias `medtap`)

Keep a copy of the keystore and password somewhere safe (a password manager). If they're lost, people would have
to uninstall the app (losing its data unless they back up first) to install a new one.

With the secrets set, each push to the default branch publishes `MedTap.apk` as the **android** release:
`https://github.com/lumenbuild/MedTap/releases/download/android/MedTap.apk`. Open that on an Android phone to
install or update. Without the secrets, CI still builds an unsigned debug APK as a workflow artifact.

To make a keystore yourself:

```sh
keytool -genkeypair -keystore medtap.keystore -alias medtap -keyalg RSA -keysize 4096 -validity 36500
base64 -w0 medtap.keystore   # paste this into MEDTAP_KEYSTORE_BASE64
```

## iPhone

CI compiles the iOS app on a Mac runner (unsigned, for the simulator) to catch build errors. Installing it on an
iPhone needs signing, which needs an Apple account:

1. On a Mac with Xcode, run `npm ci && npm run build:native`, then open `ios/App/App.xcodeproj`.
2. Select the **App** target → Signing & Capabilities → choose your team. The bundle id is `app.medtap.tracker`
   (change it if Apple says it's taken).
3. Tag reading/writing needs the **NFC Tag Reading** capability (already in `App.entitlements`), which needs a paid
   Apple Developer Program membership.
4. Plug in the iPhone and press Run, or Product → Archive to send it to TestFlight.

**Optional: tag taps that open the iPhone app.** iPhones read URL tags in the background and open the link in
Safari. To open the app instead, the domain must vouch for it with an `apple-app-site-association` file at
`https://lumenbuild.github.io/.well-known/apple-app-site-association` (the `lumenbuild.github.io` repository, not
this one), and the app needs the Associated Domains capability with `applinks:lumenbuild.github.io`. Until then,
use the **Scan** button at the top of Today.

## Family sync relay

Optional; see `sync-relay/README.md`.
