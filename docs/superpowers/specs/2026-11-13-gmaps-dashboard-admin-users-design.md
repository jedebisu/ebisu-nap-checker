# G-MAPS — Dashboard, NAP detail visibility, Admin Users panel, Globe theme refresh

Date: 2026-11-13 · Status: **APPROVED** — ready for planning & build
Parent spec: `docs/superpowers/specs/2026-11-13-gmaps-demo-design.md` (binding where not amended here)

## Owner decisions (2026-11-13)

- Dashboard placement: **A — separate screen**.
- Account removal: **Delete** (hard).
- Users tab scope: **"just the admin console accounts"** — the Users tab lists and can delete ONLY demo-created accounts (`users.employee_id LIKE 'gmaps-%'`, backfilled by the demo-defaults trigger on every row the demo API or seed creates). The 47 legacy employee accounts are NOT listed and CANNOT be deleted; the panel shows a read-only line "N legacy system accounts excluded".

## Why

Owner requests (post-v1.0.0, demo polish round):
1. A **dashboard screen** in the app — personal greeting + a card showing when the NAP database was last updated.
2. The **minimized NAP detail bar** is hard to see — raise it.
3. Admin console: a **Users tab** with account data and a **Delete** action to remove an account.
4. Overall app look should match **Globe Telecom's** brand, with the **Globe Telecom logo** as the app icon.

## Goals / non-goals

Goals: the four items above, shipped as server + app + console changes; APK rebuilt; Render redeployed.
Non-goals: no new auth mechanics, no attendance features, no multi-admin support, no backend re-architecture.
Anti-goals: anything that makes the first-login→map flow slower for evaluators than it is today (except the single intentional dashboard stop).

## Approaches considered

**Dashboard placement** — (A) separate dashboard screen after login vs (B) greeting chip on the map. Owner picked **A**: a proper dashboard moment for the demo. (B) rejected: "dashboard" reads as a destination, not a strip.

**Account removal** — owner picked **Delete** (hard removal) over suspend-only. Server-side, hard delete cascades through `sessions`, `attendance`, `leave_requests.user_id`, `location_pings` (all `ON DELETE CASCADE`, verified on the live DB) — with ONE exception: `leave_requests.approved_by` has no cascade, so deletions are pre-checked and blocked with a clear 409 when the account approved leave requests (see Builder-check rulings). The UI says what will be removed before the owner confirms.

**Theme refresh** — (A) keep the current Globe-blue base (#00539B/#003A6B/#E5F0FA) and add Globe Telecom's gradient accents + official logo vs (B) full re-skin. Owner wants the app to *feel* Globe: **A** — targeted restyle (hero/dashboard header, buttons, splash, icon), not a rewrite.

## Builder-check rulings (controller)

1. **Canonical line** (owner did not object — ruling stands): all work stays on branch `gmaps-demo` (the line whose APK the owner is testing and whose Render service is live). The repo's `main` branch holds a separate parallel product (v1.0.1, `mobile/` layout, `ebisu-nap-checker-api.onrender.com`) — it is NOT touched, not merged, not deleted.
2. **`records` count & cascade tests**: `GET /api/admin/users` counts linked rows with `to_regclass()` tolerance — reads 0 on databases lacking the production-shaped child tables (local `gmaps_demo`), real counts on the live Supabase. Tests use `sessions` (exists locally) as the cascade child fixture. No attendance/leave tables created locally.
3. **`leave_requests.approved_by` FK has NO cascade** (verified on live DB — the doc's blanket cascade claim was corrected): `DELETE /api/admin/users/:id` pre-checks `approved_by` references; if any exist → 409 `{ error, blocking: { leave_requests_approved: n } }` naming the blocker; audit links preserved. Owner may overrule to "null the approver link".
4. **No undeletable accounts** beyond the 409 rule above (token-gated owner-only console).

## Design

### 1. Dashboard screen (app)

- `App.js` state machine gains `'dashboard'`: after auth, when `must_change_password` is false → **DashboardScreen** (new file, `app/src/screens/DashboardScreen.js`); "Open NAP Map" button → current map flow. Password-setup gate unchanged (sits between login and dashboard).
- Dashboard contents (Globe-styled):
  - Time-of-day greeting: "Good morning/afternoon/evening, {firstname}" (large, dark blue on light tint).
  - **"Database last updated" card**: pulls `/api/naps/stats/summary` (authenticated) and shows `nap_report_date` (falls back to `last_data_update`), phrased "NAP database last updated: Nov 10, 2026". Also shows `total_naps` as a secondary line ("322,981 facilities on record") — data already in the response, no new endpoint.
  - **"Open NAP Map"** primary button (Globe gradient).
  - Logout icon button in the header (same pattern as the map header).
- Loading state while stats fetch; silent fallback ("Last updated unavailable") if the call fails.

### 2. Minimized NAP detail bar (app)

- `NapMapScreen.js` `collapsedBar`: raise it off the bottom edge — bottom margin raised to clear the gesture/safe area (~24px), slightly taller bar (56→64px), stronger shadow so it reads as floating. Expanded panel unchanged.

### 3. Admin console — Users tab (server + console)

- Admin page becomes **tabbed**: 4 tabs — Invite codes · Locked accounts · **Users** · (Generate invites stays above the tabs as its own card, it's an action not a list). Owner named "tabs"; current page is stacked cards — convert the three list panels to tabs, keep visual language.
- New endpoints (`server/src/routes/admin.js`, behind `requireAdminToken`):
  - `GET /api/admin/users` → demo-created accounts ONLY (`WHERE employee_id LIKE 'gmaps-%'`): id, firstname, lastname, email, phone, role, is_active, must_change_password, created_at + `records` = count of linked attendance/leave rows via `to_regclass()` tolerance (0 on DBs without those tables). Response also carries `legacy_count` for the "N legacy system accounts excluded" line.
  - `DELETE /api/admin/users/:id` → allowed ONLY when the target row matches `employee_id LIKE 'gmaps-%'` (else 404); hard delete (DB cascades sessions/attendance/leave/pings); pre-check `leave_requests.approved_by` → 409 with named blocker if referenced; `{ ok: true }` on success.
- UI: Users tab (demo accounts table: name, email, role, status Active/Suspended, created). Row action **Delete** → confirm dialog ("This removes the account and its sessions. This cannot be undone."); legacy count line under the table. No suspend button this round (owner chose delete; `is_active` mechanics remain server-side for later).
- Tests: users list shape + auth gate; delete removes the user row and cascades (fixture user + session + child row), 404 unknown.

### 4. Globe Telecom theme refresh (app assets + styling)

- **Logo**: official Globe Telecom logo as `icon.png` (1024px), `adaptive-icon.png` foreground, and `splash.png` (logo + "G-MAPS" wordmark on brand field). Owner did not supply a file — the controller attempts a public source (Wikimedia) download and produces the three assets from it; the owner has the standing icon-art veto before any rebuild ships (same window as the v1.0 draft icon). If no usable source is found, the current icon stays and this item is parked. *(Trademark note: the logo is Globe's IP; using it in a demo presented to Globe is the owner's call and is accepted as such.)*
- **Palette**: keep #00539B base (owner-set) + add Globe's signature **blue→pink→orange gradient** as accent on the dashboard header/hero, primary buttons, and splash; light-tint surfaces unchanged.
- Screens touched: LoginScreen (hero + button), DashboardScreen (new), NapMapScreen (brand header + logout + collapsed bar), PasswordSetupScreen (button) — no structural rewrites.
- Brand sweep after: `grep -rni ebisu app/src app/App.js app/app.json` → 0 hits (hostname exception stands).

## Constraints

- Server changes additive-only; `npx jest --forceExit` stays green (8 suites / 53 tests baseline).
- No new npm dependencies unless unavoidable.
- Shared production-shaped DB: the ONLY destructive op is the explicit admin Delete; everything else UPSERT/read-only.
- APK rebuilt and re-signed with the existing keystore; version stays 1.0.0? → **bump to 1.1.0 / versionCode 2** so sideloaded updates install over v1.0 cleanly.
- Render auto-deploys server changes on push; device re-verification is the owner's step.

## What's left to the builder

- Exact wording of greeting/status strings; exact gradient stops sampled from Globe's current brand.
- Tab styling details in admin.html.
- Anything the builder check surfaces as Minor.
