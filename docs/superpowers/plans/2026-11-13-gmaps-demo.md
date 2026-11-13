# G-MAPS Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build "G-MAPS" — a rebranded, stripped-down NAP-Checking-only Android app (login + registration with invitation keys and emailed OTP) backed by an isolated demo API with real NAP data, plus an owner-only admin web console.

**Architecture:** New repo `gmaps/` with a slim Node/Express demo server (copied NAP route + fresh auth/admin/email modules, Supabase Postgres) and an Expo/React Native app derived from `selfie-attendance/mobile` (Login/Registration screens + NapMapScreen only). APK built locally via Expo prebuild + Gradle, same toolchain as EBISU T&A.

**Tech Stack:** React Native (Expo, bare workflow), react-native-maps, Node/Express, pg, bcryptjs, jsonwebtoken, express-rate-limit, Resend (email), Jest + supertest (server), Gradle (APK).

**Spec:** `docs/superpowers/specs/2026-11-13-gmaps-demo-design.md`

## Global Constraints

- App display name: **G-MAPS**; zero user-facing "EBISU"/"ebisu" strings in the app.
- Android package: `com.gmaps.demo`; version 1.0.0, versionCode 1.
- Palette: Globe-style blues — primary `#00539B`, dark `#003A6B`, light tint `#E5F0FA`, replacing all EBISU tan (`#c8956c`) accents.
- Google Maps API key: reuse `AIzaSyB5rkLpbkqqIMo6FYMVj7gqoLGH3uGWoWg` (not package-restricted).
- Android permissions: only `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`.
- Registration fields exactly: Firstname, Lastname, Email, Number, Invitation Key.
- OTP: 6 digits, expires **5 minutes**, delivered via Resend from `@ebisudps.com`.
- Lockout: after **6 wrong OTP attempts** → 5 min; further wrong attempts → 10 min → 30 min → 1 hour (cap). Counters reset on success; admin can reset from console.
- Password rules: temp password emailed after OTP verification (random, strong); user's own password: ≥8 chars, ≥1 uppercase, ≥1 special character.
- Server env secrets (JWT_SECRET, ADMIN_TOKEN, RESEND_API_KEY, DATABASE_URL) never committed; `.env` gitignored.
- Never touch EBISU production (`selfie-api-sqgh.onrender.com`, its Supabase DB). NAP data copied one-way via export file.

## Review Focus

1. **Lockout escalation math** — 6 wrong OTPs must lock 5 min; the 7th wrong must move to 10 min, then 30, then cap at 60. Test in Task 6.
2. **Invite key exhaustion race** — a key with 1 use must reject the second registration even if two register in the same second. Test in Task 6.
3. **Temp password gate** — logging in with a still-active temp password must return `must_change_password: true` and no NAP access until password setup succeeds. Tests in Task 5.
4. **NAP endpoints behind auth** — unauthenticated `GET /api/naps` must 401 (app leaked EBISU's open endpoints otherwise). Test in Task 3.
5. **Brand sweep** — `grep -ri ebisu app/src app/App.js app/app.json` must return nothing user-facing; verified in Task 10.

---

### Task 1: Scaffold the `gmaps` repo

**Files:**
- Create: `gmaps/.gitignore`, `gmaps/README.md`
- Create (copy): `gmaps/server/src/config/naps_export.csv.gz` (from `selfie-attendance/server/src/config/naps_export.csv.gz`)

**Interfaces:**
- Produces: repo skeleton all later tasks build in; `naps_export.csv.gz` consumed by Task 4's import script.

- [ ] **Step 1: Init repo and copy bases**

```bash
cd ~/VibecodeProjects/gmaps
git init
rsync -a --exclude node_modules --exclude android --exclude .git \
  ~/VibecodeProjects/selfie-attendance/mobile/ app/
mkdir -p server/src/config server/src/routes server/src/middleware server/src/services
cp ~/VibecodeProjects/selfie-attendance/server/src/config/naps_export.csv.gz server/src/config/
cp ~/VibecodeProjects/selfie-attendance/server/src/config/nap_report_date.txt server/src/config/ 2>/dev/null || true
```

- [ ] **Step 2: Write `.gitignore`**

```
node_modules/
android/
.env
*.keystore
!debug.keystore
app/build/
server/dist/
apk/*.apk
.DS_Store
```

- [ ] **Step 3: Write minimal `README.md`** — one paragraph: what G-MAPS is (NAP-checking demo for Globe), pointer to the spec and plan, build/deploy commands added by later tasks.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: scaffold gmaps repo from selfie-attendance sources"
```

---

### Task 2: Demo server skeleton — DB, migrations, seed users

**Files:**
- Create: `server/package.json`, `server/.env.example`, `server/src/server.js`, `server/src/config/database.js`, `server/src/config/migrate.js`, `server/src/config/seed.js`, `server/src/middleware/auth.js`
- Test: `server/src/__tests__/health.test.js`

**Interfaces:**
- Produces: `{ pool }` from `src/config/database.js` (pg Pool over `DATABASE_URL` in production, local DB_* vars in dev — same pattern as selfie-attendance); `authenticateToken(req,res,next)` and `requireAdmin` from `src/middleware/auth.js` (JWT + `sessions` table, same as EBISU middleware); `requireAdminToken(req,res,next)` (new — checks `Authorization: Bearer $ADMIN_TOKEN`).
- Produces: server listens on `process.env.PORT || 3001`; `GET /api/health` → `{ ok: true }`.

- [ ] **Step 1: Write failing health test** (`supertest(app)` on the exported app; assert 200 and `ok: true`).

- [ ] **Step 2: Run** `cd server && npx jest health --forceExit` → expect FAIL (module not found).

- [ ] **Step 3: Implement.** `package.json` deps: `express cors pg bcryptjs jsonwebtoken express-rate-limit resend dotenv uuid`; devDeps: `jest supertest nodemon`. Scripts: `start`, `dev`, `db:migrate`, `db:seed`, `test`.
  - `database.js`: copy the dev/prod split pattern from `selfie-attendance/server/src/config/database.js`.
  - `migrate.js` creates tables:
    - `users` (adapted): `id SERIAL PK`, `firstname`, `lastname`, `email UNIQUE`, `phone`, `password_hash`, `must_change_password BOOLEAN DEFAULT false`, `is_active BOOLEAN DEFAULT true`, `role VARCHAR DEFAULT 'user'`, `otp_fail_count INT DEFAULT 0`, `locked_until TIMESTAMPTZ`, `lockout_tier INT DEFAULT 0`, `created_at`.
    - `sessions` (`token PK`, `user_id`, `expires_at`) — same shape as EBISU's.
    - `naps` — copy the `CREATE TABLE IF NOT EXISTS naps` block verbatim from `selfie-attendance/server/src/config/migrate.js:148-184` (columns + the three ALTER/index statements).
    - `invite_codes`: `id SERIAL PK`, `code VARCHAR(16) UNIQUE`, `max_uses INT`, `used_count INT DEFAULT 0`, `expires_at TIMESTAMPTZ NULL`, `created_at`.
    - `registrations`: `id SERIAL PK`, `email`, `firstname`, `lastname`, `phone`, `invite_code_id INT REFERENCES invite_codes(id)`, `otp_hash`, `otp_expires_at`, `created_at` (one row per in-flight registration; replaced on re-register).
  - `seed.js`: 2 demo users — `{ firstname:'Demo', lastname:'One', email:'demo1@ebisudps.com', password:'DemoPass1!' }` and `demo2@ebisudps.com` / `DemoPass2!`, `must_change_password:false`; and 1 admin-console user row is NOT needed (admin uses ADMIN_TOKEN).
  - `middleware/auth.js`: copy EBISU's `authenticateToken` verbatim (it selects `id, name, is_active, is_admin, role` — keep `name` derived as `firstname || ' ' || lastname` in the SELECT); add `requireAdminToken` reading `process.env.ADMIN_TOKEN`.
  - `server.js`: express, `trust proxy 1`, the security-header block and CORS `origin` function copied from `selfie-attendance/server/src/server.js` (ALLOWED_ORIGINS empty by default, filled via `CORS_ORIGINS` env). NO scheduled jobs, NO multer/cloudinary imports.

- [ ] **Step 4: Run** `npx jest health --forceExit` → PASS.

- [ ] **Step 5: Verify migration + seed locally** (`npm run db:migrate && npm run db:seed` against local Postgres; expect "2 users seeded").

- [ ] **Step 6: Commit** — `feat: demo server skeleton with auth middleware, migrations, seed`

---

### Task 3: NAP endpoints (behind auth)

**Files:**
- Create: `server/src/routes/naps.js`
- Modify: `server/src/server.js` (mount at `/api/naps` with `authenticateToken` applied)
- Test: `server/src/__tests__/naps.test.js`

**Interfaces:**
- Consumes: `pool`, `authenticateToken` (Task 2); `naps` table (Task 2).
- Produces (contract the mobile app relies on, Task 9/11): `GET /api/naps/stats/summary` → `{ total, byStatus:{...} }`; `GET /api/naps/nearest?lat&lng&limit` → array of NAP rows sorted by distance; `GET /api/naps/search?q&limit&status` → array; `GET /api/naps/:napId` → row. Row shape = `naps` table columns (`nap_id`, `naps_status`, `dp_nap_lat`, `dp_nap_long`, `city_name`, `barangay_name`, …).

- [ ] **Step 1: Copy `routes/naps.js`** from `selfie-attendance/server/src/routes/naps.js` into `server/src/routes/naps.js` unchanged (it already imports only `express`, `pool`, `middleware/auth`, `fs`, `path`, `zlib`).

- [ ] **Step 2: Write failing test** — insert 3 fixture NAP rows (one `GOOD`, one `FOR REPAIR`, one `FOR CUT`), create a session+JWT via a test helper that logs in `demo1@ebisudps.com`; assert: unauthenticated `GET /api/naps` → 401; authenticated `/api/naps/stats/summary` → `total: 3`; `/api/naps/nearest?lat=10.3&lng=123.9` returns rows ordered nearest-first; `/api/naps/search?q=...&status=GOOD` filters.

- [ ] **Step 3: Run** → FAIL, then fix mounting (apply `authenticateToken` to the whole `/api/naps` router, except `/stats/summary` may stay authenticated too — the app is always logged in when fetching).

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** — `feat: NAP endpoints with auth gate`

---

### Task 4: NAP data import

**Files:**
- Create: `server/scripts/import-naps.js`
- Modify: `server/package.json` (script `"naps:import": "node scripts/import-naps.js"`)

**Interfaces:**
- Consumes: `server/src/config/naps_export.csv.gz` (Task 1), `pool`, `naps` table.
- Produces: `npm run naps:import` — bulk-loads/UPSERTs all rows `ON CONFLICT (nap_id) DO UPDATE`; prints loaded count.

- [ ] **Step 1: Adapt the import script** from `selfie-attendance/server/src/config/import-naps-production.js` — same CSV column mapping and upsert, but pointed at the local copy `src/config/naps_export.csv.gz` and no production-only extras (no snapshot emit, no SFTP).

- [ ] **Step 2: Run** `npm run naps:import` against local DB. Expected: printed row count > 5000 and `naps` table count matches.

- [ ] **Step 3: Verify** — `psql $DEV_URL -c "SELECT naps_status, count(*) FROM naps GROUP BY 1"` shows the real status distribution (sanity: total equals the report's row count).

- [ ] **Step 4: Commit** — `feat: NAP data import from Globe report export`

---

### Task 5: Auth — email/password login + password setup

**Files:**
- Create: `server/src/routes/auth.js`
- Modify: `server/src/server.js` (mount `/api/auth`), `server/src/middleware/auth.js` (user SELECT includes `must_change_password`, `email`)
- Test: `server/src/__tests__/auth.test.js`

**Interfaces:**
- Consumes: `pool`, `bcryptjs`, `jsonwebtoken`, `sessions` table, `users` table (Task 2); `requireAdminToken` not used here.
- Produces (mobile contract, Tasks 9/11):
  - `POST /api/auth/login` `{ email, password }` → 200 `{ token, user: { id, email, firstname, lastname, must_change_password } }`; 401 on bad credentials; applies the EBISU-style per-IP login rate limit (5/min).
  - `POST /api/auth/setup-password` (auth required) `{ password }` → validates ≥8 chars, ≥1 uppercase, ≥1 special (`/(?=.{8,})(?=.*[A-Z])(?=.*[^A-Za-z0-9])/`); sets `password_hash`, `must_change_password=false`; → `{ ok: true }`.

- [ ] **Step 1: Write failing tests** — login wrong password → 401; login seeded `demo1@ebisudps.com`/`DemoPass1!` → token + `must_change_password:false`; seeded temp-user flow: create user with `must_change_password:true`, login → `must_change_password:true`, call `/setup-password` with `weak` → 400 with message naming the rules, with `GoodPass1!` → ok; token from temp login must be accepted by `authenticateToken` after setup.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `routes/auth.js` — login does bcrypt compare against `password_hash` (no legacy PIN migration code — demo DB is fresh); issues JWT (`{ userId }`, 30d) + `sessions` row exactly like EBISU's login tail (sessions insert + response shape).

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** — `feat: email+password auth with forced password setup`

---

### Task 6: Registration, invitation keys, OTP + lockout

**Files:**
- Create: `server/src/services/otp.js`
- Modify: `server/src/routes/auth.js` (add register + verify-otp), `server/src/config/migrate.js` (tables already in Task 2)
- Test: `server/src/__tests__/registration.test.js`

**Interfaces:**
- Consumes: `registrations`, `invite_codes`, `users` tables; `services/email.js` is consumed via an injected stub in tests (Task 7 wires the real one).
- Produces (mobile contract, Task 11):
  - `POST /api/auth/register` `{ firstname, lastname, email, phone, invite_code }` → 200 `{ ok: true, message: 'OTP sent to <email>' }`. Validates: all fields present, email format, invite code exists with `used_count < max_uses` and not expired → else 400 `{ error }` ("Invalid invitation key" / "Invitation key has no uses remaining"). Creates/replaces the `registrations` row, generates 6-digit OTP, stores bcrypt hash + `otp_expires_at = now() + 5 minutes`, emails it (Task 7).
  - `POST /api/auth/verify-otp` `{ email, otp }` → on success creates the `users` row (bcrypt temp password, `must_change_password:true`), increments `invite_codes.used_count`, deletes the registration row, emails the temp password (Task 7) → `{ ok: true, message: 'Temporary password sent to <email>' }`. On wrong OTP → 400 `{ error, lockout_minutes? }`.
  - `POST /api/auth/resend-otp` `{ email }` → new OTP, same 5-min TTL.
- Produces (`services/otp.js`): `generateOtp() -> string(6)`, `hashOtp(code) -> string`, `checkLockout(user) -> { locked: bool, minutesLeft: int }`, `escalate(user) -> minutes` implementing the tier table `LOCKOUT_TIERS = [5, 10, 30, 60]`: wrong attempt #6 → tier 0 (5 min); each wrong attempt after → next tier; `locked_until = now() + tier minutes`. Verified OTP resets `otp_fail_count`/`lockout_tier`/`locked_until`.

- [ ] **Step 1: Write failing tests**, in order:
  1. register with unknown invite code → 400 "Invalid invitation key"; with exhausted key (`max_uses:1`, `used_count:1`) → 400 "no uses remaining"; valid → 200 and a `registrations` row with `otp_expires_at` ~5 min out.
  2. verify wrong OTP 5 times → 400 each, no lockout field yet; 6th wrong → 400 with `lockout_minutes: 5`; 7th wrong (after faking clock past lockout or stubbing `checkLockout`) → `lockout_minutes: 10`; then 30; then 60 (cap).
  3. correct OTP after 2 wrong attempts → 200, user created with `must_change_password:true`, `used_count` incremented, fail counters zeroed.
  4. exhausted-key race: two parallel `register` calls against a `max_uses:1` fresh key → exactly one 200, one 400 (assert with `Promise.all`).
  5. resend issues a new OTP that replaces the old (old code → 400 "expired or invalid", new → 200).

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `services/otp.js` (pure functions over a passed row object so tests need no clock mocking for the tier math) and the two routes. Guard the `used_count` increment with `UPDATE invite_codes SET used_count = used_count + 1 WHERE id = $1 AND used_count < max_uses` returning rowCount — abort registration if 0 rows (this is what makes the race test pass).

- [ ] **Step 4: Run** → PASS (all 5 groups).

- [ ] **Step 5: Commit** — `feat: invitation-key registration with OTP lockout escalation`

---

### Task 7: Email service (Resend)

**Files:**
- Create: `server/src/services/email.js`
- Modify: `server/src/routes/auth.js` (replace injected stub with real service)
- Test: `server/src/__tests__/email.test.js`

**Interfaces:**
- Consumes: `resend` npm package, `RESEND_API_KEY` env; from-address `G-MAPS <noreply@ebisudps.com>` via `EMAIL_FROM` env override.
- Produces: `sendOtpEmail(email, code) -> Promise<void>`, `sendTempPasswordEmail(email, tempPassword) -> Promise<void>` — plain-text + minimal HTML, Globe-blue header bar, no EBISU wording.

- [ ] **Step 1: Write failing test** — mock `resend` module (`jest.mock`): `sendOtpEmail` calls `Resend().emails.send` with `from: 'G-MAPS <noreply@ebisudps.com>'`, `subject` containing "G-MAPS", body containing the code; `sendTempPasswordEmail` likewise with the password; no network when `RESEND_API_KEY` unset → both throw a clear config error.

- [ ] **Step 2: Run** → FAIL → **Step 3: Implement** → **Step 4: Run** → PASS.

- [ ] **Step 5: Wire into routes:** `register`/`resend` call `sendOtpEmail`; `verify-otp` calls `sendTempPasswordEmail`. Manual smoke: run server with a real test key later during Task 14 (not committed).

- [ ] **Step 6: Commit** — `feat: Resend email service for OTP and temp passwords`

---

### Task 8: Admin console + admin API

**Files:**
- Create: `server/src/routes/admin.js`, `server/public/admin.html` (single-file HTML+CSS+vanilla JS, Globe-blue styled)
- Modify: `server/src/server.js` (serve `GET /admin` → static `admin.html`, mount `/api/admin` behind `requireAdminToken`)
- Test: `server/src/__tests__/admin.test.js`

**Interfaces:**
- Consumes: `requireAdminToken` (Task 2), `invite_codes`, `users` tables, `LOCKOUT_TIERS` helpers.
- Produces:
  - `POST /api/admin/invites` `{ max_uses, expires_at? }` → `{ code }` (generated `GMAPS-XXXXXX`, cryptographically random).
  - `GET /api/admin/invites` → list with `used_count/max_uses`.
  - `GET /api/admin/lockouts` → `{ email, locked_until, otp_fail_count }` for users with `locked_until > now() OR otp_fail_count > 0`.
  - `POST /api/admin/unlock` `{ email }` → zeroes `otp_fail_count`, `lockout_tier`, `locked_until` → `{ ok: true }`.
- Admin page behavior: token input → stored in memory → the three panels (Generate invite [uses number input], Invite list, Locked accounts [Unlock button]).

- [ ] **Step 1: Write failing tests** — no token → 401; wrong token → 401; correct token: create invite with `max_uses: 10` → code matches `/^GMAPS-/`; unlock a user seeded `locked_until = now()+1h` → fields zeroed.

- [ ] **Step 2: Run** → FAIL → **Step 3: Implement** routes + page → **Step 4: Run** → PASS.

- [ ] **Step 5: Manual check** — `ADMIN_TOKEN=test123 npm start`, open `http://localhost:3001/admin`, generate a code, see it listed.

- [ ] **Step 6: Commit** — `feat: admin console for invite codes and lockout resets`

---

### Task 9: Mobile — strip to Login + NAP map

**Files:**
- Modify: `app/App.js`, `app/src/context/AuthContext.js`, `app/src/services/api.js`, `app/src/services/cache.js`, `app/src/utils/helpers.js`
- Delete: `app/src/screens/{HomeScreen,CameraScreen,HistoryScreen,LeaveApprovalScreen,LeaveRequestScreen,ProfileScreen}.js`, `app/src/services/{locationTracker,offlineQueue,syncService}.js`, `app/src/utils/notifications.js`
- Keep: `app/src/screens/{LoginScreen,NapMapScreen}.js`, `app/src/components/StatusBadge.js`, `app/src/services/{network,routing}.js`

**Interfaces:**
- Consumes: NAP API contract (Task 3) unchanged; auth contract changes in Task 11.
- Produces: `App.js` renders `AuthProvider → (loading ? spinner : user ? NapMapScreen : LoginScreen)` — no navigators at all.

- [ ] **Step 1: Rewrite `App.js`** — remove all navigator imports; single conditional render as above. NapMapScreen gets `headerShown:false` styling from its own internals.

- [ ] **Step 2: Trim `AuthContext.js`** — remove `syncOnStartup`, `startSyncOnConnect`, `stopLocationTracking`, `flushPings` imports and their `useEffect`s; keep `loadStoredAuth`, `login`, `logout` (clears AsyncStorage keys), `user`, `token`, `loading`. Same exported context shape (`useAuth()`).

- [ ] **Step 3: Trim `api.js`** — delete `attendanceAPI`'s `submit/getAll` and `leaveAPI`, `locationAPI` if present; keep the axios instance, interceptor, `napsAPI` (all 5 methods) and `SERVER_URL`. Set `API_BASE_URL` to the demo URL placeholder `http://10.0.2.2:3001/api` (dev) with a `// TODO(demo-deploy): swap to Render URL` comment — final swap happens in Task 14.

- [ ] **Step 4: Trim `cache.js` + `helpers.js`** — delete attendance/leave cache keys and helpers not imported by `NapMapScreen`/`LoginScreen` (check each import; delete only unreferenced exports).

- [ ] **Step 5: Delete the listed files.** Then `grep -rn "HomeScreen\|CameraScreen\|HistoryScreen\|Leave\|Profile\|locationTracker\|syncService\|offlineQueue" app/src app/App.js` → zero hits.

- [ ] **Step 6: Verify bundle** — `cd app && npx expo export --platform android` succeeds with no unresolved-import errors.

- [ ] **Step 7: Commit** — `refactor: strip app to login + NAP checking only`

---

### Task 10: Mobile — Globe rebrand

**Files:**
- Modify: `app/app.json`, `app/src/screens/LoginScreen.js` (palette only), `app/src/screens/NapMapScreen.js` (palette + header), `app/src/components/StatusBadge.js` (if it carries tan accents)
- Create: `app/assets/icon-gmaps.png`, `app/assets/adaptive-icon.png`, `app/assets/splash.png` (replacing EBISU assets in place — same filenames, new art)

**Interfaces:**
- Consumes: nothing new. Produces: rebranded app matching Global Constraints palette; `app.json` name "G-MAPS", slug `gmaps`, package `com.gmaps.demo`, version 1.0.0/versionCode 1, EAS block dropped, icon/adaptiveIcon/splash pointing at the new assets, `googleMaps` key unchanged, permissions trimmed to the two location entries.

- [ ] **Step 1: Generate icon art** — 1024px G-MAPS mark: white map-pin/"G" motif on `#00539B` field; adaptive-icon foreground on `#00539B` background; splash 1284×2778 `#00539B` background with white "G-MAPS" wordmark. (Owner reacts to a draft before final build.)

- [ ] **Step 2: Edit `app.json`** per the interface above (delete `extra.eas`, `owner`; set `backgroundColor` values to `#00539B`; permissions list replaced).

- [ ] **Step 3: Palette sweep** — replace `#c8956c`/`#007AFF` accents with `#00539B` (primary), `#003A6B` (pressed/dark), `#E5F0FA` (light fills) across the three kept screens + StatusBadge. Header title text "G-MAPS".

- [ ] **Step 4: Brand sweep** — `grep -rni ebisu app/src app/App.js app/app.json app/eas.json` → remove every hit (rename `logo.png` usage → new icon; delete `eas.json`).

- [ ] **Step 5: Verify bundle** again (`npx expo export --platform android`) → succeeds.

- [ ] **Step 6: Commit** — `feat: G-MAPS rebrand (Globe palette, icon, package id)`

---

### Task 11: Mobile — email/password login + registration screens

**Files:**
- Modify: `app/src/screens/LoginScreen.js` (rewrite), `app/src/context/AuthContext.js` (login signature)
- Create: `app/src/screens/RegisterScreen.js`, `app/src/screens/OtpScreen.js`, `app/src/screens/PasswordSetupScreen.js`
- Modify: `app/src/services/api.js` (auth endpoints), `app/App.js` (screen wiring)

**Interfaces:**
- Consumes: server contract from Tasks 5/6: `login({email,password})` → `{token,user}`, `register({firstname,lastname,email,phone,invite_code})`, `verifyOtp({email,otp})`, `resendOtp({email})`, `setupPassword({password})`; user object fields `must_change_password`, `firstname`, `lastname`.
- Produces: `AuthContext.login(email, password)` (replaces `(employeeId, pin)`); App flow: Login ⇄ Register ⇄ Otp (params: `{email}`) → back to Login with "temporary password sent" toast; after login, if `user.must_change_password` → PasswordSetupScreen (blocks back-navigation) → NapMapScreen.

- [ ] **Step 1: Rewrite `LoginScreen.js`** — Email + Password inputs (secure), Globe-blue palette, "Create Account" link → `RegisterScreen`, error alerts as today.

- [ ] **Step 2: Add the three API methods** to `api.js` under `authAPI = { login, register, verifyOtp, resendOtp, setupPassword }` hitting the Task 5/6 endpoints.

- [ ] **Step 3: Build `RegisterScreen.js`** — the five labeled fields (Firstname, Lastname, Email, Number, Invitation Key), client-side required validation, submit → `register()` → alert "OTP sent to <email>" → navigate to `OtpScreen` with email param.

- [ ] **Step 4: Build `OtpScreen.js`** — 6-digit input, Verify button, Resend button (disabled 30s after each send); on `lockout_minutes` in the 400 response → Alert: "Too many wrong attempts. Try again in N minutes, or ask the administrator to reset your account."; on success → "Temporary password sent to your email" → `Navigation.goBack()` to Login.

- [ ] **Step 5: Build `PasswordSetupScreen.js`** — new password + confirm fields, live rule checklist (8+ chars / 1 uppercase / 1 special), submit → `setupPassword()` → on ok, refresh stored user (`must_change_password:false`) → proceed to NAP map.

- [ ] **Step 6: Wire `App.js`** — registration screens rendered when `showRegister` state or via params; simplest: a plain React state machine in `App.js` (`'login' | 'register' | 'otp'`) before auth, and `must_change_password ? PasswordSetupScreen : NapMapScreen` after auth. Pass callbacks, no navigator dependency.

- [ ] **Step 7: Manual E2E against local server** — start server (`ADMIN_TOKEN=x RESEND_API_KEY= ` locally with email stubbed/logged), run `npx expo run:android` or `expo start`; walk: generate invite via `/admin` → register → OTP (read code from server log stub) → temp password email stub → login → forced setup → NAP map loads markers. Fix anything the flow surfaces.

- [ ] **Step 8: Commit** — `feat: email login, registration with invite key, OTP and password setup screens`

---

### Task 12: Mobile — logout button on NAP map header

**Files:**
- Modify: `app/src/screens/NapMapScreen.js`

**Interfaces:**
- Consumes: `useAuth().logout` (Task 9 trim). Produces: header-right `Ionicons` `log-out-outline` button → `Alert.alert('Log out','…',[cancel, confirm])` → `logout()` → app returns to LoginScreen.

- [ ] **Step 1: Add the button** to the existing header row (next to the search cluster).

- [ ] **Step 2: Manual check** — log out → LoginScreen appears; log back in → map loads.

- [ ] **Step 3: Commit** — `feat: logout control on NAP map header`

---

### Task 13: APK build pipeline

**Files:**
- Create: `app/build-apk.sh` (adapted from `selfie-attendance/mobile/build-apk.sh`), `app/keystore/README.md`

**Interfaces:**
- Consumes: Android SDK (`~/Library/Android/sdk`), Java 17 (`/opt/homebrew/opt/openjdk@17`). Produces: `gmaps/app/apk/G-MAPS-v1.0.apk` and `gmaps/app/G-MAPS-latest.apk`.

- [ ] **Step 1: Adapt the script** — same env vars/prebuild/gradle flow; version bump logic starts from `1.0.0`/versionCode 1; archive names `G-MAPS-$VERSION.apk` / `G-MAPS-latest.apk`; add signing config using `app/keystore/gmaps-release.keystore` with `KEYSTORE_PASSWORD`/`KEY_ALIAS` read from `app/keystore/.env` (gitignored).

- [ ] **Step 2: Generate the keystore** (one-time):

```bash
keytool -genkeypair -v -keystore app/keystore/gmaps-release.keystore \
  -alias gmaps -keyalg RSA -keysize 2048 -validity 10000
```
Store passwords in `app/keystore/.env` (gitignored); `keystore/README.md` says: back this file up — losing it forfeits update-in-place for `com.gmaps.demo`.

- [ ] **Step 3: Build** — `./build-apk.sh v1.0`. Expected: `BUILD SUCCESSFUL`, `app/apk/G-MAPS-v1.0.apk` exists (~25–50 MB, smaller than EBISU-TA since nothing was stripped from native but bundle is smaller).

- [ ] **Step 4: Install-and-verify** — `adb install -r app/apk/G-MAPS-v1.0.apk` on a device/emulator; confirm launcher name "G-MAPS", icon is the new mark, login → register → map all function against the local server.

- [ ] **Step 5: Commit** — `feat: G-MAPS APK build script and signing keystore`

---

### Task 14: Demo backend deployment + end-to-end verification

**Files:**
- Create: `server/render.yaml` (adapted from `selfie-attendance/server/render.yaml`)
- Modify: `app/src/services/api.js` (final `API_BASE_URL`)

**Interfaces:**
- Consumes: owner creates Supabase project (publishable key already provided; project URL + service_role/DATABASE_URL to be pasted into `server/.env` by owner) and the GitHub repo when reached.

- [ ] **Step 1: Write `server/render.yaml`** — web service `gmaps-api`, `npm start`, env vars `DATABASE_URL`, `JWT_SECRET` (generate: `openssl rand -hex 32`), `ADMIN_TOKEN` (generate), `RESEND_API_KEY`, `EMAIL_FROM`, `NODE_ENV=production`, `CORS_ORIGINS=` (none needed — only the mobile app talks to it; leave empty).

- [ ] **Step 2: Owner-assisted steps** (pause and hand to owner): create Supabase project → paste `DATABASE_URL` (pooler string) + service key into `server/.env` locally; create empty private GitHub repo → push `gmaps`; connect Render service.

- [ ] **Step 3: Seed the demo DB** — locally against the Supabase URL: `NODE_ENV=production DATABASE_URL=... npm run db:migrate && npm run db:seed && npm run naps:import`. Verify: `/api/health` → ok; login as demo1 works; `naps` count > 5000.

- [ ] **Step 4: Point the app at production** — set `API_BASE_URL = 'https://<render-url>/api'` in `app/src/services/api.js`, remove the TODO.

- [ ] **Step 5: Rebuild the APK** (`./build-apk.sh v1.0`) and reinstall; full E2E on-device: register with a real invite (email OTP arrives via Resend on `ebisudps.com`), temp password email, forced setup, NAP map with real data, logout, admin unlock of a deliberately locked account.

- [ ] **Step 6: Final brand sweep** — `grep -rni ebisu app/src app/App.js app/app.json` → 0 hits (assets named logo/icon are fine if unreferenced).

- [ ] **Step 7: Commit + tag** — `feat: demo backend deployed; app pointed at demo API` → `git tag v1.0.0`.

---

## Task Order Note

Tasks 1–8 (server) and Tasks 9–12 (app) are two mostly-independent tracks after Task 1 — they meet at Task 11 Step 7 (manual E2E) and Task 14. An executor may interleave.
