# EBISU NAP Checker — Design

Date: 2026-11-12
Status: Final draft — builder check passed, awaiting owner approval

## Intent & Why

A standalone mobile app whose sole function is **NAP Checking** for EBISU Document
Process Services. Access is controlled (invite-only), so field staff/sales see
reliable, account-gated NAP facility lookups. It complements — but does not modify —
the existing EBISU-T&A app (selfie-attendance) and the public static NAP map
(ebisudps-naps). Ships as its own GitHub repo, built locally.

## Goals

- Users register (First name, Last name, Email, Phone number) with an **invite code**.
- Registration verified by a **6-digit OTP sent to their email** (chosen over SMS to
  avoid per-message cost; the phone number is stored on the account but not verified).
- After OTP verification, a **strong temporary password is emailed**, valid **24 hours**
  to log in. If they don't log in within 24 h, the account expires and they must
  **register again**.
- First login **forces a password reset**. New password rules: **min 8 characters,
  at least 1 uppercase, 1 number, 1 special character**.
- **Forgot password**: emails a fresh temporary password (same 24 h + forced-reset
  rules) so nobody is permanently locked out.
- **Dashboard**: greets the account owner ("Hi, <First name>!") and shows when the NAP
  database was last updated (from the Render API's `nap_report_date`).
- **NAP Checking**: a full interactive **map, mirroring the NAP Checking screen in the
  EBISU-T&A app** (`NapMapScreen.js`) — colored status markers, nearest-NAP lookup
  around the user's location or a dropped pin, search by place name or coordinates,
  "use my location", a nearby-NAP list, tap-a-marker for details, and a route line
  with distance to a selected NAP.
- **Admin**: the owner manages invite codes on a small password-protected admin web
  page served by the backend.

## Non-Goals / Anti-Goals

- No attendance/clock-in features (that's EBISU-T&A).
- No NAP data import — the app **reads the existing Render API** and never copies or
  imports NAP data.
- No SMS gateway, no paid services beyond what already exists.
- Never delete NAP records anywhere (this app doesn't write NAP data at all).

## Constraints

- Zero-coding-experience owner; beginner-readable code, one job per file, comments
  explain *why* (matches selfie-attendance AGENTS.md working rules).
- Built locally first; pushed to GitHub (`jedebisu`); APK distributed via GitHub
  Releases like EBISU-T&A (immutable `app-v<versionCode>` tags, never overwrite one
  release asset).
- Runs on the owner's macOS machine during development; deployment to a host is a
  later, separate decision.
- Email must be sent from the **company domain (ebisudps.com)** via configurable SMTP.

## Approaches Considered

1. **Mirror the EBISU-T&A stack (CHOSEN)** — Expo React Native app + Node/Express
   server + Postgres for accounts only; NAP data read live from the Render API;
   nodemailer + company SMTP. Trades: two processes to run locally (app + server),
   but reuses patterns, tooling and distribution the owner already knows.
2. **Supabase Auth built-ins (REJECTED)** — would handle OTP/password storage, but
   fights this custom flow (password emailed with 24 h expiry, forced first-login
   reset, re-register-after-expiry, invite codes); most of it would be overridden
   anyway.

## Decisions (as agreed with the owner)

| Question | Decision |
|---|---|
| App type | Standalone mobile app (Expo, APK) |
| App name | **EBISU NAP Checker** (repo: `ebisu-nap-checker`) |
| OTP channel | Email (6-digit); phone stored, not verified |
| Email sending | Company domain SMTP (host/port/creds via env vars) |
| NAP function | Full map view — mirrors EBISU-T&A's NAP Checking screen (search + nearest included) |
| NAP data source | Existing Render API (`selfie-api-sqgh.onrender.com`) |
| Registration | Invite-code only (admin generates codes) |
| Forgot password | Yes — fresh temp password, same 24 h + forced reset |
| Expiry rule | Temp password valid 24 h; past that, register again |

## Architecture

```
mobile/     Expo React Native app (SDK 54 to match the owner's Expo Go for dev)
server/     Node.js + Express (port 3002), local Postgres DB `napcheck`
admin page  Server-rendered minimal page at /admin (ADMIN_PASSWORD env)
```

- **Auth**: JWT (same pattern as selfie-attendance). Passwords hashed with bcrypt.
- **Emails**: nodemailer; env vars `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
  `MAIL_FROM`.
- **NAP data**: server proxies the Render API (nearest-NAP, search, and stats
  endpoints) behind JWT auth, so the app never talks to the Render API directly and
  the API URL is configured in one place. Dashboard "last updated" comes from
  `/api/napcheck/stats/summary` (`nap_report_date`).
- **Map**: `react-native-maps` + `expo-location`, same library and screen behaviour as
  EBISU-T&A's `NapMapScreen.js` (markers colored by vacant-line status, radius-based
  nearest lookup, route service for the distance line).

## Account lifecycle & rules

States: `pending_otp` → `pending_first_login` (temp password emailed) → `active`
(password set by user).

- OTP: 6 digits, **5-minute** expiry, resend with 60 s cooldown, max 5 wrong attempts
  then a new code is required.
- Temp password: server-generated ~14-char strong random password; email says it is
  valid 24 h to log in.
- Past 24 h without first login → account marked expired; the same email may
  register again (new registration replaces the expired account).
- Password reset on first login enforces: ≥8 chars, ≥1 uppercase, ≥1 number,
  ≥1 special character.
- Forgot password (for `active` users): email-confirmed temp password restarts the
  same `pending_first_login` 24 h window.
- Invite codes: generated on the admin page; each code usable once (or N uses),
  tracked with who/when it was used.

## Database (accounts only — no NAP data)

- `users`: id, first_name, last_name, email (unique), phone, password_hash,
  status, temp_password_expires_at, timestamps.
- `otp_codes`: id, user_id, code_hash, expires_at, attempts, used_at.
- `invite_codes`: id, code, max_uses, uses, created_by, used_by, created_at.

## Repo & distribution

- GitHub: `jedebisu/ebisu-nap-checker`. Built locally; APK published via GitHub
  Releases (`app-v<versionCode>` pattern, same guardrails as EBISU-T&A).

## What's Left to the Builder

- SMTP values from the owner's email host (setup-time env vars; blocks email testing
  only, not the build).
- Exact visual design of screens (follow EBISU-T&A look; plain and readable).
- APK build config (package name, versionCode starting at 1).
- Confirm the exact Render API endpoint shapes for nearest-NAP lookup and stats
  (`/api/naps/nearest`, `/api/napcheck/stats/summary`) during implementation.
