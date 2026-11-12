# EBISU NAP Checker — Backend

The server behind the **EBISU NAP Checker** mobile app: invite-only accounts,
phone verification by **6-digit email OTP**, a **temporary password emailed for
24 hours**, forced password reset on first login, forgot-password, and a
login-protected proxy to the existing NAP facility data.

NAP data itself is **not stored here** — the app reads it live from the existing
Render API (`selfie-api-sqgh.onrender.com`), the same source the EBISU-T&A app
uses. Updating the NAP database is still done exactly as before; nothing in this
project needs to run for an update to appear.

## What the flow looks like

1. Admin generates an invite code on the admin page.
2. User registers in the app: first name, last name, email, phone, invite code.
3. A 6-digit code arrives by email (valid **5 minutes**).
4. After verifying, a strong temporary password arrives by email (valid **24 hours**).
5. Logging in with it forces a password reset:
   **8+ characters, 1 uppercase, 1 number, 1 special character**.
6. The dashboard shows the NAP database last-update date and the NAP map.

## Setup (first time)

```bash
cd server
npm install
cp .env.example .env      # then edit .env (see below)
npm run db:migrate        # creates the tables in the `napcheck` database
npm start                 # http://localhost:3002
```

Create the databases once (Postgres must be running):

```bash
createdb napcheck
createdb napcheck_test
```

## Environment (`server/.env`)

| Variable | Meaning |
|---|---|
| `PORT` | 3002 |
| `JWT_SECRET` | Long random string used to sign tokens. Change it in production. |
| `DB_USER` / `DB_HOST` / `DB_NAME` / `DB_PASSWORD` / `DB_PORT` | Local dev database (defaults work for a stock macOS Postgres). |
| `DATABASE_URL` | Production connection string (only used when `NODE_ENV=production`). |
| `TEST_DATABASE_URL` | Test database; defaults to `postgres://localhost:5432/napcheck_test`. |
| `RENDER_API_URL` | Upstream NAP API. Default `https://selfie-api-sqgh.onrender.com`. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | Company email sending. **Leave `SMTP_HOST` blank to use the outbox** (see below). |
| `ADMIN_PASSWORD` | Password for `/admin`. Blank disables the admin page entirely. |

### Emails without SMTP: the outbox

Until the company SMTP values are filled in, every email the server "sends" is
written as a plain-text file into `server/outbox/`. Open a file to read the OTP
or temporary password. This is how you can walk through the whole flow locally
before touching real email.

## Admin page

Open `http://localhost:3002/admin`, log in with `ADMIN_PASSWORD`, and generate
invite codes. Each code has a use limit; the page lists codes with how many
times they were used and by whom, plus a Log out button.

## API at a glance

All NAP routes need `Authorization: Bearer <token>` from a normal login.

| Method & path | Purpose |
|---|---|
| `POST /api/auth/register` | Register with invite code (emails OTP) |
| `POST /api/auth/verify-otp` | Verify 6-digit code (emails temp password) |
| `POST /api/auth/resend-otp` | New code, max once per 60 s |
| `POST /api/auth/login` | Temp password → `{ must_reset: true, reset_token }`; normal → `{ token }` |
| `POST /api/auth/reset-password` | Set the real password (single-use reset token) |
| `POST /api/auth/forgot` | Email a fresh temp password (always answers 200, max once per 60 s) |
| `POST /api/auth/logout` | Revoke the token used for the call |
| `GET /api/naps/nearest?lat&lng&radius&limit` | Nearest NAP facilities (map pins) |
| `GET /api/naps/search?q&limit&status` | Search by NAP id / building / city |
| `GET /api/naps/stats/summary` | Totals + `nap_report_date` (dashboard date) |
| `GET /api/naps/:napId` | One NAP facility |

## Session rules

- An app token lasts 7 days, but it dies immediately when the password changes
  (reset or a fresh temporary password) or when the user logs out.
- Reset links last 15 minutes and can be used once.
- Five wrong OTP guesses kill the code; only the newest code ever works.

## Tests

```bash
cd server
npm test
```

Tests use the separate `napcheck_test` database and never touch real data.

## After pulling an update

Run `npm run db:migrate` again whenever the code changes: migrations are
idempotent and only add what is missing. Running an old database against new
code makes password/OTP emails fail with a database error.

## Publishing the app

The mobile app is built separately (see `mobile/README.md`). APKs will be published on GitHub Releases, the same way as EBISU-T&A.

## Mobile app

A standalone Expo SDK 54 React Native app (`mobile/`) that talks to this server.
Features:

- Invite-only registration with 6-digit email OTP and a 24-hour temporary password
- Forced first-login password reset (8+ chars, uppercase, digit, special character)
- Dashboard greeting ("Hi, <first name>!") and NAP report last-update date
- NAP map mirroring the EBISU-T&A checker: colour-coded markers, search by place
  name or coordinate, dropped pin with walking route, nearby list with status
  filter chips, tap-to-select detail panel with copy-coordinates

See [`mobile/README.md`](mobile/README.md) for setup and build instructions.
