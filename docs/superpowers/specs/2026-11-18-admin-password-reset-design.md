# Admin Password Reset (Temp Password) — Design

**Date:** 2026-11-18  
**Status:** Approved (approach selected by user)  
**Scope:** Small change — admin-console-only password reset for demo-managed accounts

## Intent & Why
Provide a way for administrators to help users who forgot their password. Reset is initiated only from the admin console (not self-service) to keep control with the operator and reuse existing auth patterns.

## Goals
- Admin can reset a demo-managed user's password from the **Users** tab in the admin console.
- User receives a temporary password by email and must set a new password on next login.
- Any existing sessions for that user are revoked immediately.

## Non-goals
- No self-service "forgot password" flow on the login screen.
- No reset-link/token flow, reset UI for end users, or new database tables.
- No changes to legacy/system (non-demo) account handling beyond existing scoping.

## Constraints
- Admin console is protected by static `ADMIN_TOKEN` (`requireAdminToken`); actions go through `/api/admin/*`.
- Users panel lists/deletes only demo-managed accounts (`employee_id LIKE 'gmaps-%'` when column exists, else all treated demo-managed per existing `hasEmployeeIdColumn` logic). Reset must follow the same scoping and return 404 for unmanaged/unknown ids.
- Email delivery uses existing `sendTempPasswordEmail` (Resend in non-test env; in-memory log in tests). If email send fails, the reset must not leave the account in a half-reset/inaccessible state.

## Approaches Considered
1. **Temp password + `must_change_password` + revoke sessions (chosen).** Generate temp password, email it, update `password_hash`, set `must_change_password=true`, delete all sessions for the user. Reuses `sendTempPasswordEmail`, existing `must_change_password` enforcement, and `POST /api/auth/setup-password`. Simple, consistent with registration, no schema/UX additions.
2. **One-time reset link/token.** Email a time-limited token and provide a reset page/endpoint. More standard for self-service but requires token storage/expiry/validation and new end-user reset flow; unnecessary for admin-only trigger and heavier to implement/maintain.
3. **Admin sets a specific password manually.** Avoids email dependency but requires securely communicating the password out-of-band and increases handling risk; worse UX/security than emailed temp password with forced change.

**Decision:** Approach 1.

## Design (How)

### API
- **`POST /api/admin/users/:id/reset-password`** (behind `requireAdminToken`, in `server/src/routes/admin.js`)
  - Validate `:id` is integer; resolve target user with same demo scoping as `GET/DELETE /users` (`AND employee_id LIKE 'gmaps-%'` when applicable). If not found → `404 { error: 'Account not found or not managed' }`.
  - Generate temp password (same shape as registration: `crypto.randomBytes(8).toString('base64url') + '!A1'` or equivalent meeting policy) and bcrypt-hash it.
  - **Atomicity / email safety:** perform email send before committing irreversible state, or use a transaction with rollback on send failure so password/sessions are unchanged if delivery fails (preferred: send first, then in a transaction update user `password_hash`, set `must_change_password=true`, delete sessions, commit; on send error return 500 without DB changes). Follow the spirit of verify-otp’s “don’t strand user” behavior.
  - On success → `200 { ok: true }`.

### Email
- Reuse `sendTempPasswordEmail(to, tempPassword)` from `services/email.js` (no template changes required unless wording needs tweak; existing copy is acceptable).

### Admin Console UI (`server/public/admin.html`)
- **Users** table: add a **“Reset password”** button per row (alongside Delete).
- On click: `window.confirm` (or equivalent inline confirm) — “Reset password for <name/email>? They will be emailed a temporary password and signed out everywhere.” **Proceed/Cancel** (Cancel = no action).
- On proceed: call `POST /api/admin/users/:id/reset-password` with admin token; disable button/show progress while in-flight.
- On success: show success message/toast. On failure: show error (including non-200 body error).

### Data/Schema
- No migrations; uses existing `users.password_hash`, `users.must_change_password`, and `sessions` table.

### Security & Behavior
- Revokes all sessions for the target user on reset.
- Admin-only endpoint; no changes to public `/api/auth` routes.
- Scoped to demo-managed users only.

### Tests
- Add/extend server tests (admin route tests) covering: successful reset emails temp password, sets `must_change_password`, clears sessions, rejects unmanaged/unknown ids (404), and handles email-send failure without corrupting credentials/session state (as feasible with existing test patterns/mocks). Update admin UI only as needed (static HTML) — no frontend test harness assumed.

## What’s Left to the Builder
- Exact confirm copy and button placement/styling consistent with existing admin UI.
- Precise transaction/send ordering implementation details matching codebase conventions.
- Any minor test scaffolding adjustments consistent with existing admin/email tests.