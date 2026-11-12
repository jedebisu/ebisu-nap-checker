# EBISU NAP Checker — Mobile App

Expo SDK 54 React Native app. Talks to the EBISU NAP Checker server (`server/`).
NAP data is never stored locally; every map view fetches fresh from the backend.

## Prerequisites

- Node 20+ and npm
- Expo Go on your phone (SDK 54) for quick testing
- A running backend at `http://localhost:3002` (see `../README.md`)

## Quick start

```bash
cd mobile
npm install
npx expo start
```

Scan the QR code with Expo Go, or open `http://localhost:8081` in a browser.

### Pointing at a local backend

By default the app hits `http://localhost:3002/api`. Expo Go runs on your phone,
not on this laptop, so `localhost` would resolve to the phone itself — which has
no server. Override it with an environment variable before starting Metro:

```bash
# Find your laptop's Wi-Fi address (macOS):
ipconfig getifaddr en0   # Wi-Fi
# Then:
EXPO_PUBLIC_API_URL=http://192.168.1.42:3002/api npx expo start
```

Pass the same URL through Metro's dev settings (`e` → "Clear cache and restart")
after changing it, or just set it once via:

```bash
export EXPO_PUBLIC_API_URL=http://192.168.1.42:3002/api
npx expo start
```

In release builds (`__DEV__ = false`) the app falls back to the production
address hardcoded in `src/services/api.js`. Change that placeholder once the
server gets its permanent Render URL.

## Building an APK

Two options — both produce an internal-distribution Android package:

**Local Gradle build (recommended, free):**
```bash
npx expo run:android --variant release
```
Requires JDK 17 and the Android SDK. The first run downloads them if missing.

**EAS Build (cloud):**
```bash
npx eas build --platform android --profile preview
```
Free tier quota applies. See https://expo.dev/accounts/jedebisu/projects/ebisu-nap-checker.

APKs are published to GitHub Releases with immutable tags (`app-v<versionCode>`).
Bump `versionCode` in `app.json` before each release build — Android refuses to
update over install unless the code increases.

## Directory layout

```
mobile/
  app.json              ← package name com.jedebisu.napchecker, map key, assets
  src/
    context/AuthContext.js   ← JWT + user persisted in AsyncStorage
    services/api.js          ← axios instance; all HTTP calls go here
    services/routing.js      ← Valhalla walking-direction polyline decoder
    utils/helpers.js         ← pure functions (debounce, coordinate parsers, etc.)
    screens/                 ← one file per screen
    components/StatusBadge.js
```

One job per file. Comments explain *why*, not what the code does.
