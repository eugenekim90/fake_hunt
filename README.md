# Fake Hunt

**Fake Hunt** is a multiplayer hunter arena web game packaged with [Capacitor](https://capacitorjs.com/) for iOS and Android. Everyone looks the same—some are real hunters, most are dummies. Move toward your finger, double-tap to swing: hit a real player to kill, hit a dummy and you die. Climb the kill count and leaderboard in Open World (shared server) or private rooms with bot/dummy settings.

- **App ID:** `com.fakehunt.app`
- **Repository:** [github.com/eugenekim90/fake_hunt](https://github.com/eugenekim90/fake_hunt)

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS)
- For native builds: [Android Studio](https://developer.android.com/studio) (Android) and/or Xcode on macOS (iOS)

## Setup

```bash
npm install
npm run build:web
npx cap sync
```

Source web assets live at the project root (`index.html`, `style.css`, `game.js`, `config.js`, `net.js`). `npm run build:web` copies them into `www/` for Capacitor.

## Run in the browser

Serve the root files or `www/` with any static server, or open `index.html` locally for quick checks.

## Android

```bash
npm run android
```

Opens the project in Android Studio. Run on a device or emulator from there.

### Build a release AAB (Play Store)

```bash
npm run build:web
npx cap sync
cd android
./gradlew bundleRelease
```

On Windows:

```powershell
npm run build:web
npx cap sync
cd android
.\gradlew.bat bundleRelease
```

The bundle is under `android/app/build/outputs/bundle/release/`. Upload it to Google Play Console.

**Signing:** Upload keystore and `android/keystore.properties` are **local only** and are not in this repository. Configure signing in Android Studio or via your own `keystore.properties` on each machine that builds releases.

## iOS

```bash
npm run ios
```

Open in Xcode, configure signing with your Apple Developer team, then run on a simulator or device. Archive for TestFlight / App Store from Xcode.

## After game changes

Edit the root web files, then:

```bash
npm run cap:sync
```

Rebuild the native app in Android Studio or Xcode.

## Supabase / realtime

Multiplayer uses [Supabase](https://supabase.com/) Realtime. The app only subscribes to channels named with the `fh:` prefix (for example `fh:<roomCode>`), not generic broadcast channels.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run build:web` | Sync root assets to `www/` |
| `npm run cap:sync` | `build:web` + `npx cap sync` |
| `npm run android` | Sync and open Android Studio |
| `npm run ios` | Sync and open Xcode |
