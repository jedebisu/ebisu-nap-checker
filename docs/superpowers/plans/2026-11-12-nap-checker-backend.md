# EBISU NAP Checker — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the EBISU NAP Checker backend: invite-coded registration, 6-digit email OTP, temp password by email (24 h), forced first-login password reset, forgot-password, JWT auth, an invite-code admin page, and JWT-protected proxies to the existing Render NAP API.

**Architecture:** Node/Express server (port 3002) with its own Postgres database `napcheck` (accounts only — NAP data is never stored here). Mobile app comes later in a separate plan and consumes these endpoints. Emails go out via nodemailer over company SMTP; when SMTP is not configured the mailer writes messages to `server/outbox/` so the whole flow is testable locally first.

**Tech Stack:** Express 4, pg 8, bcryptjs 2, jsonwebtoken 9, nodemailer; jest + supertest (same libs as selfie-attendance's server).

**Spec:** `docs/superpowers/specs/2026-11-12-ebisu-nap-checker-design.md`

## Global Constraints

- Port **3002**; Express **4.x**; libs: `pg@^8`, `bcryptjs@^2.4.3`, `jsonwebtoken@^9`, `nodemailer@^6`, dev: `jest`, `supertest`.
- OTP: **6 digits**, expires **5 minutes**, resend cooldown **60 s**, max **5 wrong attempts** (then a new code is required).
- Temp password: server-generated **14 chars** containing upper, lower, digit and special; valid **24 hours** to log in.
- Password rules: **≥8 chars, ≥1 uppercase, ≥1 number, ≥1 special character** (special = non-alphanumeric).
- Account states: `pending_otp` → `pending_first_login` (temp password emailed) → `active`; `expired` when the 24 h window lapses without first login.
- Registration requires a valid **invite code**; registering with the email of a non-`active` account **replaces** that account (UPSERT, never crash on duplicate email).
- NAP data: proxy **read-only** to `RENDER_API_URL` (default `https://selfie-api-sqgh.onrender.com`). Never write or delete NAP records anywhere.
- All `/api/naps/*` proxy routes require a valid JWT. Auth token scope `app` (7 d); password-reset token scope `password_reset` (15 min).
- Emails: from `MAIL_FROM` via `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`; when `SMTP_HOST` is unset, write the message to `server/outbox/<timestamp>-<to>.txt` instead (dev fallback).
- Admin page disabled (404) unless `ADMIN_PASSWORD` is set.
- Tests run against a dedicated `napcheck_test` database (`TEST_DATABASE_URL`); never touch `selfie_attendance`.
- Beginner-readable: one job per file, short functions, comments explain *why*. Conventional commits.

## Review Focus

1. **Duplicate email on re-register** — registering again with the same email (expired/stale account) must replace the account, not crash with a unique-violation 500. → Task 5 test.
2. **OTP brute force** — the 6th wrong attempt must invalidate the code even if the right code is then entered. → Task 6 test.
3. **Temp-password expiry boundary** — logging in after the 24 h window must flip the account to `expired` and answer `ACCOUNT_EXPIRED` (register again), never accept the temp password. → Task 8 test.
4. **Email enumeration on forgot-password** — response is identical `200 { message }` whether or not the email exists. → Task 9 test.
5. **Unauthenticated NAP proxy access** — `/api/naps/*` without a token must be `401`, and a `password_reset`-scoped token must NOT work on them. → Task 11 test.
6. **Server-side password rules** — resetting to a password lacking upper/digit/special/8-chars must be rejected by the server even if a client never checks. → Task 7 test.

---

### Task 1: Server skeleton + `/api/health`

**Files:**
- Create: `server/package.json`, `server/src/server.js`, `server/src/app.js`, `server/.env.example`, `server/tests/health.test.js`, `.gitignore` (repo root)

**Interfaces:**
- Produces: `app` (Express app exported from `src/app.js`) that every later test imports; `GET /api/health` → `200 { status: 'ok' }`.

- [ ] **Step 1: Scaffold.** `server/package.json` with scripts `dev` (nodemon), `start`, `test` (`jest --runInBand`); deps per Global Constraints. `.env.example` with `PORT=3002`, `DATABASE_URL`, `TEST_DATABASE_URL`, `JWT_SECRET`, `RENDER_API_URL`, `SMTP_*`, `MAIL_FROM`, `ADMIN_PASSWORD` (all blank except PORT/RENDER_API_URL). `.gitignore`: `node_modules/`, `server/.env`, `server/outbox/`.
- [ ] **Step 2: Write the failing test** (`server/tests/health.test.js`):

```js
const request = require('supertest');
const app = require('../src/app');
test('GET /api/health returns ok', async () => {
  const res = await request(app).get('/api/health');
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('ok');
});
```

- [ ] **Step 3: Run it — expect FAIL** (no app yet): `cd server && npm test`
- [ ] **Step 4: Implement.** `src/app.js` creates the Express app (json parser, routes, error handler) and exports it; `src/server.js` requires `app` and listens on `process.env.PORT || 3002`. (Split exists so supertest never opens a port.)
- [ ] **Step 5: Run tests — expect PASS:** `npm test`
- [ ] **Step 6: Commit:** `git add -A && git commit -m "feat(server): express skeleton with health endpoint"`

### Task 2: Database config + migrations

**Files:**
- Create: `server/src/config/database.js`, `server/src/config/migrate.js`, `server/tests/db.test.js`
- Modify: `server/src/app.js` (attach `req.db = pool` middleware)

**Interfaces:**
- Consumes: `app` (Task 1).
- Produces: `pool` (pg Pool exported from `config/database.js`, picks `DATABASE_URL` or `DB_*` vars — same dual pattern as selfie-attendance); `runMigrations(pool)` from `config/migrate.js`; tables `users`, `otp_codes`, `invite_codes` (schema per spec: `users.email` UNIQUE; `status` CHECK in the four states; `otp_codes.code_hash/expires_at/attempts/used_at`; `invite_codes.code UNIQUE/max_uses/uses/last_used_by/last_used_at`).

- [ ] **Step 1: Write the failing test:** connect to `TEST_DATABASE_URL`, call `runMigrations(pool)` **twice** (idempotency), then query `information_schema.tables` for the three table names — expect all present both times.
- [ ] **Step 2: Run — expect FAIL** (`runMigrations` not defined). `CREATE DATABASE napcheck_test;` first via psql if missing.
- [ ] **Step 3: Implement** both files. Migrations are plain `CREATE TABLE IF NOT EXISTS` / `CREATE UNIQUE INDEX IF NOT EXISTS`.
- [ ] **Step 4: Run — expect PASS.** Also add `"db:migrate": "node src/config/migrate.js"` script (runs against `DATABASE_URL`).
- [ ] **Step 5: Commit:** `feat(server): database config and idempotent migrations`

### Task 3: Password utilities

**Files:**
- Create: `server/src/services/passwords.js`, `server/tests/passwords.test.js`

**Interfaces:**
- Produces: `validatePassword(pw) -> { valid, reason? }` (rejects <8 chars, no uppercase, no digit, no special); `generateTempPassword() -> string` (14 chars, guaranteed ≥1 upper/lower/digit/special); `hashPassword(pw) -> Promise<string>` and `verifyPassword(pw, hash) -> Promise<boolean>` (bcryptjs, 10 rounds).

- [ ] **Step 1: Failing tests:** `validatePassword('Ab1!xxxx')` valid; each of `'ab1!xxxx'` (no upper), `'AB!xxxxx'` (no digit), `'AB1xxxxx'` (no special), `'Ab1!xx'` (short) invalid with the right `reason`; `generateTempPassword()` 50×: length 14, charset classes all present; hash/verify roundtrip true, wrong password false.
- [ ] **Step 2: Run — expect FAIL** (module missing).
- [ ] **Step 3: Implement.** Generator: build one char from each class, fill the rest randomly from the combined alphabet, then shuffle (crypto.randomInt).
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit:** `feat(server): password validation and temp-password generation`

### Task 4: Mailer with dev outbox

**Files:**
- Create: `server/src/services/mailer.js`, `server/tests/mailer.test.js`
- Modify: `server/.gitignore`-relevant (`outbox/` already ignored in Task 1)

**Interfaces:**
- Produces: `sendMail({ to, subject, text }) -> Promise<{ delivered: 'smtp' | 'outbox', path? }>`. SMTP when `SMTP_HOST` is set (nodemailer transport, `MAIL_FROM` sender), else writes `server/outbox/<ISO-timestamp>-<to>.txt` with `To:`, `Subject:`, blank line, body.

- [ ] **Step 1: Failing tests:** with SMTP unset and outbox dir pointed at a temp dir (`MAIL_OUTBOX_DIR` env override — tests use it), `sendMail` resolves `delivered: 'outbox'`, creates a file containing the subject and body; second call doesn't overwrite the first (timestamp collision → append `-1`).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** (default outbox dir `path.join(__dirname, '../../outbox')`).
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit:** `feat(server): mailer with SMTP and dev-outbox fallback`

### Task 5: Registration (+ invite code, + re-register replaces stale account)

**Files:**
- Create: `server/src/routes/auth.js`, `server/tests/auth.register.test.js`
- Modify: `server/src/app.js` (mount `/api/auth`)

**Interfaces:**
- Consumes: `pool`, `runMigrations`, `hashPassword`, `sendMail`, `validatePassword` (Tasks 2–4).
- Produces: `POST /api/auth/register { first_name, last_name, email, phone, invite_code }` → `201 { message }` (OTP emailed) | `400 { error }` (bad/missing invite code, missing fields, bad email) | `409 { error: 'EMAIL_IN_USE' }` if an `active` account exists. OTP stored via `otp_codes` (hashed with sha256, 6 digits, 5-min `expires_at`). Helper `issueOtp(userId)` created here in `auth.js` — Task 6 builds on it.

- [ ] **Step 1: Failing tests** (beforeAll: `runMigrations`, truncate tables; invite code inserted directly):
  - register with unknown invite code → 400;
  - with valid code but missing phone → 400;
  - valid → 201, user row `status='pending_otp'`, one row in `otp_codes` not yet used, invite `uses` incremented, `last_used_by` = email;
  - re-register same email → 201 again (row replaced, still one user row, fresh OTP);
  - register same email after manually setting that user `status='active'` → 409.
- [ ] **Step 2: Run — expect FAIL** (route missing).
- [ ] **Step 3: Implement** `register` handler: normalize email to lowercase; lookup existing; replace-or-reject per state; generate OTP; hash; insert; `sendMail` with the 6-digit code in the body.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit:** `feat(server): invite-coded registration with email OTP`

### Task 6: OTP verification + resend

**Files:**
- Modify: `server/src/routes/auth.js`, `server/tests/auth.register.test.js` → add `server/tests/auth.otp.test.js`

**Interfaces:**
- Consumes: `issueOtp`, `otp_codes` schema.
- Produces: `POST /api/auth/verify-otp { email, code }` → `200 { message: 'OTP verified; temporary password sent' }` and (Task 7 wires the temp-password email in — here it only verifies and marks the OTP used) | `400 { error: 'OTP_INVALID' }` (wrong/unknown) | `400 { error: 'OTP_EXPIRED' }` | `400 { error: 'OTP_LOCKED' }` after 5 wrong attempts | `410 { error: 'ACCOUNT_EXPIRED' }` reserved for Task 8. `POST /api/auth/resend-otp { email }` → `200 { message }` (new code emailed) | `429 { error: 'OTP_RESEND_COOLDOWN' }` inside 60 s of the last code.

- [ ] **Step 1: Failing tests** (insert OTP rows directly to control `expires_at`):
  - wrong code → `OTP_INVALID`; attempts counter incremented each try;
  - 5 wrong tries then the correct code → `OTP_LOCKED` (code unusable);
  - expired code → `OTP_EXPIRED`;
  - correct code → 200, `used_at` set;
  - resend immediately → 429; resend after backdating last code by 61 s → 200 and new unused row.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** verify + resend handlers (cooldown read from newest `otp_codes.created_at` for the user).
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit:** `feat(server): otp verification, lockout and resend cooldown`

### Task 7: Temp password on OTP verify + forced reset endpoint

**Files:**
- Modify: `server/src/routes/auth.js`, `server/tests/auth.otp.test.js` → add `server/tests/auth.reset.test.js`

**Interfaces:**
- Consumes: `generateTempPassword`, `hashPassword`, `sendMail`, `signAuthToken`/`signResetToken` (added this task in `src/services/tokens.js`).
- Produces:
  - On successful `verify-otp`: user → `status='pending_first_login'`, `password_hash` = temp password hash, `temp_password_expires_at = now + 24 h`, OTP marked used, temp password **emailed** (body states the 24-hour rule).
  - `POST /api/auth/login { email, password }` → `200 { must_reset: true, reset_token }` when temp password matches and unexpired (`reset_token` = JWT `{ sub: userId, scope: 'password_reset' }`, 15 min) | `403 { error: 'ACCOUNT_EXPIRED' }` when expired (Task 8) | `200 { token, user, must_reset: false }` for `active` users (Task 8) | `401 { error: 'INVALID_CREDENTIALS' }`.
  - `POST /api/auth/reset-password { reset_token, new_password }` → `200 { token, user, must_reset: false }` (user `status='active'`, expiry cleared) | `400 { error: reason }` for weak password | `401 { error: 'RESET_TOKEN_INVALID' }` for missing/wrong-scope/expired token.

- [ ] **Step 1: Failing tests:** complete register→verify with outbox capture: temp-password email exists and user is `pending_first_login` with 24 h expiry; `login` with temp password returns `must_reset: true` + a token that decodes to `scope: 'password_reset'`; `reset-password` with `'weak'` → 400 with reason; with `'GoodPass1!'` → 200, app token decodes `scope: 'app'`, user `active`, expiry NULL; reuse of the same reset token → 401 (single-use: token invalid after reset — implement by embedding a token version / `password_changed_at` check).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** `tokens.js` (`signAuthToken`, `signResetToken`, `requireAuth` middleware asserting `scope: 'app'`), then wire login/reset handlers. Login is completed in Task 8; implement it now for the `pending_first_login` and `active` paths.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit:** `feat(server): temp password email, forced first-login reset, jwt tokens`

### Task 8: Login expiry rule (24 h)

**Files:**
- Modify: `server/src/routes/auth.js`, add `server/tests/auth.expiry.test.js`

**Interfaces:**
- Consumes: login handler (Task 7).
- Produces: the expiry branch — `pending_first_login` user with `temp_password_expires_at < now`: login flips `status='expired'` and returns `403 { error: 'ACCOUNT_EXPIRED', message: 'Registration expired. Please register again.' }`; the same temp password never works again.

- [ ] **Step 1: Failing tests:** register+verify, backdate `temp_password_expires_at` by 1 s → login → 403 `ACCOUNT_EXPIRED`, user row now `expired`; second login attempt → still 403.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** the expiry check before password comparison in `login`.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit:** `feat(server): 24h temp-password expiry marks account expired`

### Task 9: Forgot password

**Files:**
- Modify: `server/src/routes/auth.js`, add `server/tests/auth.forgot.test.js`

**Interfaces:**
- Consumes: temp-password issuance logic from Task 7 (extract into `issueTempPassword(userId)` reused by both).
- Produces: `POST /api/auth/forgot { email }` → **always** `200 { message }` (enumeration-safe). If the account is `active`: new temp password generated+emailed, `status='pending_first_login'`, 24 h expiry set. Otherwise: no email, same response.

- [ ] **Step 1: Failing tests:** active user → 200 and outbox gains a temp-password email, user flips to `pending_first_login`; unknown email → identical 200 body, no email written; `pending_otp` user → 200, no email, status unchanged.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run — expect PASS** (full suite: `npm test`).
- [ ] **Step 5: Commit:** `feat(server): forgot-password issues fresh 24h temp password`

### Task 10: Invite-code admin API + admin page

**Files:**
- Create: `server/src/routes/admin.js`, `server/tests/admin.test.js`
- Modify: `server/src/app.js` (mount at `/admin`)

**Interfaces:**
- Consumes: `invite_codes` table (Task 2).
- Produces:
  - `GET /admin` → HTML login form (server-rendered string, no template lib) when no session cookie, else a minimal codes-management page (list + generate form).
  - `POST /admin/login { password }` → sets `admin_session` cookie (JWT `{ scope: 'admin' }`, 8 h) | `401` wrong password | 404 when `ADMIN_PASSWORD` unset.
  - `POST /admin/api/invite-codes { max_uses? }` (cookie or admin JWT) → `{ code }` (random 8-char code, default `max_uses: 1`).
  - `GET /admin/api/invite-codes` → `{ codes: [{ code, max_uses, uses, last_used_by, last_used_at, created_at }] }`.
- The generated codes are exactly what `POST /api/auth/register` validates in Task 5 — no schema change.

- [ ] **Step 1: Failing tests:** admin disabled without env → 404 (set env before creating app or use two app instances); login wrong → 401; login correct → cookie set; generate with cookie → code usable by register flow (integration: register with it succeeds); list shows uses.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** Keep HTML tiny (one inline string per page).
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit:** `feat(server): admin page for invite-code management`

### Task 11: NAP proxy endpoints (read-only)

**Files:**
- Create: `server/src/routes/naps.js`, `server/tests/naps.proxy.test.js`
- Modify: `server/src/app.js` (mount `/api/naps`, behind `requireAuth`)

**Interfaces:**
- Consumes: `requireAuth` (Task 7); `RENDER_API_URL`.
- Produces: JWT-protected pass-through of the Render API (shapes verified 2026-11-12 against selfie-attendance's server):
  - `GET /api/naps/nearest?lat&lng&radius&limit` → `{ count, radius_km, naps: [...] }` — each nap: `id, nap_id, cabinet, location_type, building_served, floors_served, working_lines, vacant_lines, total_capacity, cfs_region, city_name, province_name, barangay_name, dp_nap_lat, dp_nap_long, naps_status, olt_id, sell_status, updated_at, marker_color ('red'|'yellow'|'green'), distance_km`.
  - `GET /api/naps/search?q&limit&status` → `{ count, naps: [...] }` (same fields, no `distance_km`).
  - `GET /api/naps/stats/summary` → `{ total_naps, full_naps, warning_naps, available_naps, total_ports, used_ports, available_ports, last_data_update, nap_report_date }`.
  - `GET /api/naps/:napId` → single NAP row.
  - Upstream failure/timeout (10 s) → `502 { error: 'NAP_SERVICE_UNAVAILABLE' }`.

- [ ] **Step 1: Failing tests** (mock upstream with jest module mock of global `fetch`; no network in tests): no token → 401; token with `scope: 'password_reset'` → 401; valid token → forwards query string and returns upstream JSON verbatim with 200; upstream 500 → 502.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** with global `fetch` (Node 18+), 10 s AbortController timeout.
- [ ] **Step 4: Run — expect PASS** (full suite).
- [ ] **Step 5: Commit:** `feat(server): jwt-protected read-only proxy to render nap api`

### Task 12: README + env wiring + GitHub

**Files:**
- Create: `README.md` (repo root), `server/src/scripts/print-env-check.js` (optional sanity script)
- Modify: none

- [ ] **Step 1: README** — beginner-readable: what the app is, how to set up Postgres (`createdb napcheck`), `cp server/.env.example server/.env`, `npm install && npm run db:migrate && npm start`, how the outbox fallback works before SMTP is configured, admin page URL, endpoint list.
- [ ] **Step 2: Full verification:** `cd server && npm test` all green; `npm start` and hand-smoke: register with an admin-made invite code, read OTP + temp password from `outbox/`, login, reset, hit `/api/naps/stats/summary` with the token.
- [ ] **Step 3: Commit:** `docs: setup guide and verification walkthrough`
- [ ] **Step 4: Create GitHub repo `jedebisu/ebisu-nap-checker`** (with the owner — `gh repo create jedebisu/ebisu-nap-checker --private --source . --push` or manual), push `main`.
