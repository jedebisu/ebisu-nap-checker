# EBISU NAP Checker — Mobile App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the EBISU NAP Checker mobile app (Expo, APK) that talks to the
backend built in the first plan: invite-gated registration, email OTP, 24-hour
temporary password, forced first-login reset, dashboard with the NAP last-update
date, and a full NAP-checking map mirroring `selfie-attendance/mobile/src/screens/NapMapScreen.js`.

**Architecture:** Expo SDK 54 React Native app. A native-stack/tab navigator
switches between auth screens and the two main screens (Dashboard, NAP map).
`AuthContext` holds the JWT and user in AsyncStorage and drives the navigation
switch. `axios` talks to the backend at `http://localhost:3002/api` in dev. NAP
data is never stored locally; the map fetches it through the backend proxy.
`react-native-maps` + `expo-location` power the map exactly like EBISU-T&A.

**Tech Stack:** Expo ~54, React Native 0.81, React 19, React Navigation 7,
react-native-maps 1.20, expo-location, expo-clipboard, axios, AsyncStorage,
@expo/vector-icons (Ionicons).

**Spec:** `docs/superpowers/specs/2026-11-12-ebisu-nap-checker-design.md`
**Backend plan:** `docs/superpowers/plans/2026-11-12-nap-checker-backend.md`
(The backend is already built and pushed; the app depends on its endpoints and
response shapes.)

## Global Constraints

- Expo SDK 54, React Native 0.81.5, React 19.1.0 — do not upgrade without checking
  Expo Go compatibility on the owner's phone.
- App name "EBISU NAP Checker", slug `ebisu-nap-checker`, package
  `com.jedebisu.napchecker`, version `1.0.0`, versionCode `1`, minSdkVersion 21.
- Map API key: reuse the Google Maps key from selfie-attendance's app.json
  (`AIzaSyB5rkLpbkqqIMo6FYMVj7gqoLGH3uGWoWg`) unless the owner provides a new one.
- Portrait orientation, light UI, Ionicons for icons.
- The phone number is stored, never verified — do not add a phone-verification step.
- NAP data is read live from the backend proxy; never import or copy NAP data.
- Never delete NAP records (this app writes none).
- Keep one job per file and comments that explain *why*; the owner has zero
  coding experience.
- The backend runs locally at `http://localhost:3002` during development; the app's
  API base URL must be switchable (`__DEV__` → localhost, else production URL).
- APKs are published via GitHub Releases with immutable `app-v<versionCode>` tags;
  bump versionCode before every release build.

## Review Focus

Five failure modes the spec implies but no task's manual check fully covers:
1. **Stale token in AsyncStorage after a server-side revocation** (password change
   or logout elsewhere) — every API call that returns 401 must clear local auth and
   route back to Login, instead of looping on a dead token.
2. **Location permission denied** — the map must still render with a sensible default
   center (Cebu City) and allow manual search; "use my location" must say so plainly.
3. **Empty or failed NAP search** (offline, upstream cold start, no results) — must
   show an error/empty state with retry, never crash or hang.
4. **Mixed coordinate formats in the search box** (decimal, DMS, compact) — the
   helpers already parse these; the search bar must pass them through unchanged.
5. **Registration with a hostile or malformed email** — client validation plus the
   server's strict pattern must both reject it, and the error message must reach the
   user.

Each of these gets a manual check in the task that owns the relevant code.

---

## File Structure

```
mobile/
  package.json
  app.json
  babel.config.js
  index.js
  App.js
  .gitignore
  assets/                      (icon.png, splash.png, adaptive-icon.png)
  src/
    context/AuthContext.js
    services/api.js
    services/routing.js
    utils/helpers.js
    screens/
      LoginScreen.js
      RegisterScreen.js
      OtpVerifyScreen.js
      ForceResetScreen.js
      ForgotPasswordScreen.js
      DashboardScreen.js
      NapMapScreen.js
    components/StatusBadge.js
```

One responsibility per file: screens own their UI and local state; `AuthContext`
owns auth state; `api.js` owns HTTP; `helpers.js` owns pure functions.

---

### Task 1: Scaffold the Expo project

**Files:**
- Create: `mobile/package.json`
- Create: `mobile/app.json`
- Create: `mobile/babel.config.js`
- Create: `mobile/index.js`
- Create: `mobile/App.js`
- Create: `mobile/.gitignore`
- Create: `mobile/assets/icon.png`, `mobile/assets/splash.png`, `mobile/assets/adaptive-icon.png` (copy from selfie-attendance/mobile/assets)

**Interfaces:**
- Produces: a runnable Expo project (`npm install && npx expo start`).

- [ ] **Step 1: Create `mobile/package.json`** with the dependency set from
  selfie-attendance (Expo ~54, react 19.1, react-native 0.81.5, react-navigation
  native/native-stack/bottom-tabs, react-native-maps 1.20.1, expo-location ~19,
  expo-clipboard ~8, axios ^1.7, async-storage 2.2, gesture-handler ~2.28,
  screens ~4.16, safe-area-context ~5.6, expo-status-bar ~3.0, expo ~54.0.21,
  @expo/vector-icons, @babel/core devDep). Scripts: `start`, `android`, `ios`,
  `web` mirroring selfie-attendance.
- [ ] **Step 2: Create `mobile/app.json`** with name/slug/version/versionCode/package
  per Global Constraints, portrait, light, the Google Maps API key, location
  permission descriptions (foreground only — no background tracking in this app),
  and icon/splash paths.
- [ ] **Step 3: Create `mobile/babel.config.js`** (`module.exports = { presets: ['babel-preset-expo'] };`).
- [ ] **Step 4: Create `mobile/index.js`** (`import { registerRootComponent } from 'expo'; import App from './App'; registerRootComponent(App);`).
- [ ] **Step 5: Create `mobile/App.js`** as a minimal placeholder rendering a
  centered "EBISU NAP Checker" text, so the project boots before auth exists.
- [ ] **Step 6: Create `mobile/.gitignore`** ignoring `node_modules/`, `.expo/`,
  `android/`, `ios/`, `*.jks`, `*.p8`, `*.p12`, `*.key`.
- [ ] **Step 7: Copy assets** from selfie-attendance/mobile/assets (icon.png,
  splash.png, adaptive-icon.png) — or create simple placeholders if missing.
- [ ] **Step 8: Install and boot**

Run: `cd mobile && npm install && npx expo start`
Expected: Metro bundler starts, no red errors; scanning the QR with Expo Go shows
the placeholder screen.

- [ ] **Step 9: Commit**

```bash
git add mobile
git commit -m "feat(mobile): scaffold expo project for nap checker"
```

---

### Task 2: Auth context, API client, routing, helpers

**Files:**
- Create: `mobile/src/context/AuthContext.js`
- Create: `mobile/src/services/api.js`
- Create: `mobile/src/services/routing.js`
- Create: `mobile/src/utils/helpers.js`

**Interfaces:**
- Consumes: backend endpoints from the backend plan (register, verify-otp,
  resend-otp, login, reset-password, forgot, logout, naps/*).
- Produces: `useAuth()` → `{ user, token, loading, mustReset, resetToken, login,
  logout, setMustReset, clearMustReset }`; `authAPI`, `napsAPI`; `fetchRoute`;
  helpers `debounce, distanceMeters, parseCoordinate, parseCoordinateInput,
  formatCoords, formatDateTime, formatLatLng, copyToClipboard`.

- [ ] **Step 1: Create `mobile/src/utils/helpers.js`** by copying the relevant
  exports from selfie-attendance's helpers.js (debounce, distanceMeters,
  parseCoordinate, parseCoordinateInput, formatCoords, formatDateTime, plus
  `formatLatLng` and `copyToClipboard` from NapMapScreen.js). Keep them pure and
  unit-testable.
- [ ] **Step 2: Create `mobile/src/services/routing.js`** by copying fetchRoute
  (Valhalla pedestrian route, 20 s timeout, polyline decode) verbatim.
- [ ] **Step 3: Create `mobile/src/services/api.js`.** axios instance with
  `baseURL = __DEV__ ? 'http://localhost:3002/api' : 'https://<production>/api'`,
  timeout 60000, JSON content type. Request interceptor attaches the token from
  AsyncStorage. Response interceptor: on 401, remove `auth_token`/`auth_user` from
  AsyncStorage and call a registered `onUnauthorized` callback (set by AuthContext)
  so the app routes to Login. Export `authAPI` (register, verifyOtp, resendOtp,
  login, resetPassword, forgot, logout) and `napsAPI` (getNearest, search,
  getById, getStats) matching the backend endpoints exactly, plus `SERVER_URL`.
- [ ] **Step 4: Create `mobile/src/context/AuthContext.js`.** States: user, token,
  loading, mustReset, resetToken. `loadStoredAuth` reads AsyncStorage. `login`
  posts credentials; if the response has `must_reset`, store resetToken and set
  mustReset true without storing a session token; otherwise store token+user.
  `logout` calls authAPI.logout (best effort), then clears storage and state.
  Expose `clearMustReset()`.
- [ ] **Step 5: Wire AuthProvider into App.js** (placeholder still), so the
  context is available; keep the placeholder screen.
- [ ] **Step 6: Boot check**

Run: `cd mobile && npx expo start`
Expected: app boots; no red screen; Metro shows no module-resolution errors.

- [ ] **Step 7: Commit**

```bash
git add mobile/src
git commit -m "feat(mobile): auth context, api client, routing, helpers"
```

---

### Task 3: Register screen

**Files:**
- Create: `mobile/src/screens/RegisterScreen.js`

**Interfaces:**
- Consumes: `authAPI.register`, `navigation.navigate('OtpVerify', { email })`.
- Produces: a screen that, on success, hands off to OTP verification.

- [ ] **Step 1: Implement RegisterScreen.** Five inputs (first_name, last_name,
  email, phone, invite_code) with required-field and email-format validation.
  Submit button disabled while submitting; show inline errors from the server
  (`error` field). On 201, navigate to OtpVerify with the email.
- [ ] **Step 2: Manual check (Review Focus #5).** Start the backend locally,
  mint an invite code on `/admin`, run the app, register with a valid code → OTP
  email appears in `server/outbox/`. Then try an email containing `<script>` and
  an unknown invite code — both must show a readable error, not crash.
- [ ] **Step 3: Commit**

```bash
git add mobile/src/screens/RegisterScreen.js
git commit -m "feat(mobile): registration screen with invite code"
```

---

### Task 4: OTP verification screen

**Files:**
- Create: `mobile/src/screens/OtpVerifyScreen.js`

**Interfaces:**
- Consumes: `authAPI.verifyOtp`, `authAPI.resendOtp`, route param `email`.
- Produces: on success, navigates to Login with a param indicating "check your
  email for the temporary password".

- [ ] **Step 1: Implement OtpVerifyScreen.** A 6-digit input (numeric keyboard),
  submit button, and a "Resend code" button that is disabled for 60 seconds with
  a visible countdown. Show server errors (OTP_INVALID, OTP_EXPIRED, OTP_LOCKED,
  OTP_RESEND_COOLDOWN) as readable text. On success, navigate to Login and show
  an alert: "Your temporary password has been emailed. It is valid for 24 hours."
- [ ] **Step 2: Manual check (Review Focus #3).** Verify a correct code succeeds;
  verify a wrong code shows an error and the countdown; verify resend throttling.
- [ ] **Step 3: Commit**

```bash
git add mobile/src/screens/OtpVerifyScreen.js
git commit -m "feat(mobile): otp verification with resend cooldown"
```

---

### Task 5: Login screen

**Files:**
- Create: `mobile/src/screens/LoginScreen.js`

**Interfaces:**
- Consumes: `authAPI.login`, `useAuth().login`-equivalent (store token/user or
  reset token), route param `email` (optional).
- Produces: on `must_reset`, navigates to ForceReset with the reset token; otherwise
  sets auth state and the navigator switches to the main screens.

- [ ] **Step 1: Implement LoginScreen.** Email + password fields, submit, "Forgot
  password?" link to ForgotPasswordScreen. Handle 401 (INVALID_CREDENTIALS) and
  403 (ACCOUNT_EXPIRED, OTP_NOT_VERIFIED) with readable messages. On
  `must_reset: true`, store the reset token via AuthContext and navigate to
  ForceReset. On a normal login, store token + user.
- [ ] **Step 2: Manual check (Review Focus #1).** Log in with a valid account; log
  in with a wrong password; log in with an expired account. Confirm a 401 from any
  later request clears local auth.
- [ ] **Step 3: Commit**

```bash
git add mobile/src/screens/LoginScreen.js
git commit -m "feat(mobile): login screen with forced-reset routing"
```

---

### Task 6: Forced password-reset screen

**Files:**
- Create: `mobile/src/screens/ForceResetScreen.js`

**Interfaces:**
- Consumes: `authAPI.resetPassword`, route param `resetToken`, AuthContext (store
  resulting token/user).
- Produces: on success, auth state is set and the navigator switches to main.

- [ ] **Step 1: Implement ForceResetScreen.** New password + confirm password inputs.
  Client-side validation matching the server rules (≥8, uppercase, number, special)
  with per-rule hints that update as the user types. Submit disabled until all
  rules pass and the two fields match. On success, store token + user, navigate to
  main. Show server WEAK_PASSWORD reason if the client missed something.
- [ ] **Step 2: Manual check.** Try each weak password (short, no uppercase, no
  number, no special) and confirm the matching hint; complete a valid reset and
  land on the dashboard.
- [ ] **Step 3: Commit**

```bash
git add mobile/src/screens/ForceResetScreen.js
git commit -m "feat(mobile): forced first-login password reset"
```

---

### Task 7: Forgot-password screen

**Files:**
- Create: `mobile/src/screens/ForgotPasswordScreen.js`

**Interfaces:**
- Consumes: `authAPI.forgot`.
- Produces: always the same success message (enumeration-safe).

- [ ] **Step 1: Implement ForgotPasswordScreen.** Email input; on submit call
  forgot and show "If the account exists, a new password was sent." regardless of
  the answer. Include a "Back to login" link.
- [ ] **Step 2: Manual check.** Submit a known and an unknown email; both show the
  same message.
- [ ] **Step 3: Commit**

```bash
git add mobile/src/screens/ForgotPasswordScreen.js
git commit -m "feat(mobile): forgot-password screen"
```

---

### Task 8: Dashboard screen

**Files:**
- Create: `mobile/src/screens/DashboardScreen.js`

**Interfaces:**
- Consumes: `napsAPI.getStats`, `useAuth()` (user, logout), navigation to NapMap.
- Produces: greeting "Hi, {first_name}!" and the NAP last-update date.

- [ ] **Step 1: Implement DashboardScreen.** Greeting using `user.first_name`.
  Fetch stats on mount; show `nap_report_date` (formatted) as "NAP database last
  updated: …". Loading and error states with retry. A large button "Open NAP Map".
  A "Log out" button that calls logout and lets the navigator switch to Login.
- [ ] **Step 2: Manual check.** Log in, land on the dashboard, confirm the greeting
  and the date (2026-11-10 from the Render API). Tap "Open NAP Map".
- [ ] **Step 3: Commit**

```bash
git add mobile/src/screens/DashboardScreen.js
git commit -m "feat(mobile): dashboard with greeting and nap update date"
```

---

### Task 9: NAP map — core (location + nearest markers)

**Files:**
- Create: `mobile/src/screens/NapMapScreen.js` (core part)
- Create: `mobile/src/components/StatusBadge.js`

**Interfaces:**
- Consumes: `napsAPI.getNearest`, `expo-location`, `react-native-maps`.
- Produces: a map centered on the user (or Cebu City fallback) with colored
  markers for the nearest NAPs within 1 km and a status legend.

Constants to keep (from the source screen): `RADIUS_KM = 1`, `NEARBY_LIMIT = 1000`,
`MIN_REFRESH_DISTANCE_M = 50`, marker colors green/yellow/red by vacant-line status,
default center Cebu City (10.3157, 123.8854).

- [ ] **Step 1: Create `StatusBadge.js`** (small pill showing status text + color),
  copied from selfie-attendance.
- [ ] **Step 2: Implement the map core.** MapView with initial region (Cebu City).
  Request foreground location permission on mount; on grant, set the region to the
  user's position and call `napsAPI.getNearest({ lat, lng, radius: 1, limit: 1000 })`,
  rendering one Marker per NAP colored by vacant lines (green ≥ 50% free, yellow
  1–49%, red 0). Show a Circle for the 1 km radius and an ActivityIndicator while
  loading. On permission denial, keep the default center and show a banner
  "Location permission denied — search manually or tap 'Use my location'."
  (Review Focus #2.)
- [ ] **Step 3: Handle empty/failed fetch** with an error banner and a Retry
  button; never throw out of the effect (Review Focus #3).
- [ ] **Step 4: Manual check.** Open the map on a device; confirm markers appear
  around Cebu City; deny location permission and confirm the fallback.
- [ ] **Step 5: Commit**

```bash
git add mobile/src/screens/NapMapScreen.js mobile/src/components/StatusBadge.js
git commit -m "feat(mobile): nap map with location and nearest markers"
```

---

### Task 10: NAP map — search (place name + coordinate)

**Files:**
- Modify: `mobile/src/screens/NapMapScreen.js`

**Interfaces:**
- Consumes: `napsAPI.search`, `parseCoordinateInput` from helpers.
- Produces: a search bar that handles both place names and coordinates.

- [ ] **Step 1: Add the search bar.** Debounced (1.2 s) text input. If
  `parseCoordinateInput` returns a coordinate, drop a search marker at that point
  and fetch nearest NAPs around it; otherwise call `napsAPI.search({ q, limit: 100 })`
  and show up to 100 results as markers plus a results count. Show a "searching…"
  spinner and an empty-state message when nothing matches.
- [ ] **Step 2: Manual check (Review Focus #4).** Search "Cebu", then
  "10.3157, 123.8854", then a DMS string; all three must move the map and show
  markers.
- [ ] **Step 3: Commit**

```bash
git add mobile/src/screens/NapMapScreen.js
git commit -m "feat(mobile): nap map place and coordinate search"
```

---

### Task 11: NAP map — dropped pin + route line

**Files:**
- Modify: `mobile/src/screens/NapMapScreen.js`

**Interfaces:**
- Consumes: `fetchRoute` from routing.js, `napsAPI.getNearest`.
- Produces: long-press to drop a pin, tap a marker to select it, and a route line
  with distance to the selected NAP.

- [ ] **Step 1: Add long-press handler.** `onLongPress` sets `droppedPin` (with a
  purple marker), clears any selected NAP, and fetches nearest NAPs around the pin.
  Add a "Clear pin" button that removes it and reverts to the user's location.
- [ ] **Step 2: Add selection + route.** Tapping a marker sets `selectedNap` and
  calls `fetchRoute(origin, destination)` where origin is the dropped pin or the
  user's location and destination is the NAP. Draw a `Polyline` and show the
  distance in km. Handle route failure with a toast and no line.
- [ ] **Step 3: Manual check.** Long-press to drop a pin; tap a marker; confirm
  the purple line and distance appear; clear the pin.
- [ ] **Step 4: Commit**

```bash
git add mobile/src/screens/NapMapScreen.js
git commit -m "feat(mobile): dropped pin and route line on nap map"
```

---

### Task 12: NAP map — nearby list, status filter, details card

**Files:**
- Modify: `mobile/src/screens/NapMapScreen.js`

**Interfaces:**
- Consumes: the nearbyNaps state already populated.
- Produces: a toggleable nearby-NAP list, status filter chips, and a details card.

- [ ] **Step 1: Add status filter chips** (All / In Service / Out of Service /
  Planned) that re-run the search with the selected status.
- [ ] **Step 2: Add a toggleable nearby list** (FlatList) showing NAP id, cabinet,
  and distance; tapping an item selects the marker and pans the map.
- [ ] **Step 3: Add a details card** for the selected NAP: nap_id, cabinet,
  building served, vacant/total lines, location (with a "copy coordinates"
  button), and the last-update timestamp from stats.
- [ ] **Step 4: Manual check.** Filter by "Defective", open the nearby list, tap
  an item, copy coordinates, confirm the clipboard toast.
- [ ] **Step 5: Commit**

```bash
git add mobile/src/screens/NapMapScreen.js
git commit -m "feat(mobile): nearby list, status filter, nap details card"
```

---

### Task 13: Navigation wiring and branding

**Files:**
- Modify: `mobile/App.js`
- Modify: `mobile/app.json`

**Interfaces:**
- Consumes: all screens, `useAuth`.
- Produces: auth-gated navigation (Login/Register/OtpVerify/ForceReset/
  ForgotPassword when logged out; Dashboard + NAP map tabs when logged in).

- [ ] **Step 1: Replace the placeholder App.js** with the real navigator: a stack
  for auth screens and a bottom-tab navigator (Dashboard, NAPs) for the main
  screens, gated on `user` from AuthContext, with a loading spinner while auth
  loads. Register all screens.
- [ ] **Step 2: Set branding in app.json** (name, icon, splash, adaptive icon)
  using the copied assets; confirm no missing-asset warnings.
- [ ] **Step 3: Manual check (Review Focus #1).** Fresh install (clear AsyncStorage)
  shows Login; register → OTP → temp password → forced reset → dashboard → map.
  Log out returns to Login and a stale token no longer works.
- [ ] **Step 4: Commit**

```bash
git add mobile/App.js mobile/app.json
git commit -m "feat(mobile): navigation and branding"
```

---

### Task 14: End-to-end verification and docs

**Files:**
- Modify: `README.md` (add a "Running the mobile app" section)
- Modify: `mobile/README.md` (new, short)

**Interfaces:** none new.

- [ ] **Step 1: Full manual walkthrough** against the local backend:
  admin mints a code → register → OTP from outbox → verify → temp password →
  login → forced reset → dashboard shows greeting + date → open map → search
  "Cebu" → markers → long-press pin → route line → nearby list → logout →
  back to Login. Fix anything that breaks.
- [ ] **Step 2: Test the five Review Focus cases** (stale token, denied location,
  failed search, mixed coordinates, hostile email) and confirm each behaves.
- [ ] **Step 3: Add `mobile/README.md`** with `npm install`, `npx expo start`,
  how to point the app at a local backend, and how to build an APK
  (`npx expo run:android` / EAS preview).
- [ ] **Step 4: Update the root `README.md`** with a short "Mobile app" section
  pointing at `mobile/README.md`.
- [ ] **Step 5: Commit**

```bash
git add mobile/README.md README.md
git commit -m "docs(mobile): run and build instructions"
```

---

## Self-Review Notes

Spec coverage check:
- Register fields, invite code, email OTP, 24 h temp password, forced reset rules,
  forgot password, dashboard greeting + date, full map (markers, nearest, search
  place+coordinate, use-my-location, dropped pin, nearby list, tap details, route
  line), admin page, invite-only — all mapped to tasks.
- Non-goals honored: no attendance, no NAP import, no SMS, no NAP writes.
- Database (accounts only) already built in the backend plan; the mobile plan
  adds no tables.
- APK distribution guardrails (immutable tags, versionCode bump) captured in
  Global Constraints and Task 14.

Type consistency: API calls use the backend's exact field names
(`first_name`, `last_name`, `invite_code`, `nap_report_date`, `must_reset`,
`reset_token`). Navigation route names are consistent across tasks
(`OtpVerify`, `ForceReset`, `ForgotPassword`, `NapMap`).

Proportion: the plan references the source screen by path and lists behaviors
and constants; it does not transcribe the 1377-line screen. The implementer
ports the relevant chunks per task.

## Execution Handoff

Plan complete and saved to
`docs/superpowers/plans/2026-11-12-nap-checker-mobile.md`. Please review the
plan. Does it capture what you want?

You previously chose **native (inline) execution** for the backend, so I will use
that again unless you say otherwise. Once you confirm, I'll start with Task 1
(scaffold) and work through the tasks one at a time, committing after each.