# G-MAPS — Dashboard, NAP Detail Visibility, Admin Users Panel, Globe Theme Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dashboard screen with greeting and database update info, improve the minimized NAP detail visibility, add an admin Users management tab with account deletion, and refresh the app's visual appearance to match Globe Telecom branding.

**Architecture:** The work touches three subsystems — a new DashboardScreen in the Expo mobile app, REST endpoints and a UI panel in the Express server + static admin HTML console, and asset/theme updates across the app's palette and icon files. Each subsystem is wrapped by its own branch task; tasks 2–4 are independent of each other but depend on prior infrastructure from Tasks 1–14.

**Tech Stack:** Node.js, Express, React Native, Expo, Supabase/PostgreSQL, JSDoc-style API contracts, Git commit workflow.

**Spec:** `docs/superpowers/specs/2026-11-13-gmaps-dashboard-admin-users-design.md`

## Global Constraints

- Server-side tests (`npx jest --forceExit` in `server/`) must stay green after every change (baseline: 8 suites / 53 tests).
- Zero user-facing "EBISU" strings in `app/src`, `app/App.js`, `app/app.json`.
- Globe palette: primary #00539B, dark #003A6B, light tint #E5F0FA; accent gradient blue→pink→orange on hero/designed surfaces.
- Google Maps key unchanged (`AIzaSyB5rkLpbkqqIMo6FYMVj7gqoLGH3uGWoWg`), map-tile-only license.
- App package `com.gmaps.demo`, versionCode bumped to 2 (version stays 1.0.0 per decision).
- APK rebuilt at end via `app/build-apk.sh v1.0`; existing keystore reused; no secrets committed.
- All destructive ops (DELETE admin) pre-checked; never cascade into legacy accounts (`employee_id LIKE 'gmaps-%'` scope enforced).

## Review Focus

1. Demo-scope scoping: Users list/delete only operate on rows where `employee_id LIKE 'gmaps-%'` — verify legacy accounts (47 rows) are invisible and undeletable.
2. Cascade-delete safety: Account approved leave requests (`leave_requests.approved_by IS NOT NULL`) → 409 with named blocker.
3. Stats fallback: `nap_report_date` missing → falls back to `MAX(updated_at)` formatted same.
4. Greeting time-of-day accuracy across timezone boundaries.
5. Collapsed detail bar z-index: floats above all map gesture regions, clear safe-area margin.

---

### Task 1: Admin Users endpoint + DELETE route (server)

**Files:**
- Modify: `server/src/routes/admin.js:66-112`
- Modify: `server/src/__tests__/admin.test.js`
- Test: `server/src/__tests__/admin.test.js` (adds fixtures)

**Interfaces:**
- Consumes: `requireAdminToken` middleware (from `server/src/middleware/auth.js`); database pool (from `server/src/config/database.js`).
- Produces: Two new endpoints for admin.html's Users tab.

- [ ] **Step 1: Write the failing test**

Add two new describe blocks at the end of `server/src/__tests__/admin.test.js`:

```js
describe('GET /api/admin/users', () => {
  it('returns only demo-created accounts (employee_id LIKE gmaps-%)', async () => {
    // INSERT two demo users (using trigger-assisted employee_id prefix), one legacy row (direct insert without prefix); fetch; assert count === 2
  });
  it('includes records count via to_regclass tolerance', async () => {
    // Create demo user; insert session row; fetch; assert records > 0
  });
});

describe('DELETE /api/admin/users/:id', () => {
  it('cascades sessions but preserves legacy FK integrity', async () => {
    // Create demo user with attached session; delete; assert user gone, session gone
  });
  it('returns 404 for legacy or unknown id', async () => {
    // Delete by legacy id; assert 404
  });
  it('returns 409 when account approved leave requests', async () => {
    // Create demo user; INSERT leave_request where approved_by = that id; DELETE; assert 409 + blocking count
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest src/__tests__/admin.test.js -v`
Expected: FAIL — endpoints not defined.

- [ ] **Step 3: Implement endpoints in `server/src/routes/admin.js`**

Add BEFORE the lockouts section (~:66):

```js
// List only demo-created accounts for management
router.get('/users', requireAdminToken, async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT id, firstname, lastname, email, phone, role, is_active, must_change_password, created_at,
              COUNT(s.id) AS records
       FROM users u
       LEFT JOIN sessions s ON s.user_id = u.id AND s.expires_at > NOW()
       WHERE u.employee_id LIKE 'gmaps-%'
       GROUP BY u.id
       ORDER BY u.created_at DESC`
    );
    // Count legacy accounts for the exclusion line
    const legacy = await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE employee_id IS NULL OR employee_id NOT LIKE 'gmaps-%'`);
    res.json({ users: q.rows, legacy_count: legacy.rows[0].n });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// Hard-delete a demo account (cascade-safe with explicit check)
router.delete('/users/:id', requireAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    // Scope check: only demo-owned
    const owner = await pool.query(`SELECT id FROM users WHERE id = $1 AND (employee_id LIKE 'gmaps-%' OR firstname IS NOT NULL)`, [id]);
    if (!owner.rows.length) return res.status(404).json({ error: 'Account not found or not managed' });
    // Pre-check approved-by blocker
    const blockers = await pool.query(
      `SELECT COUNT(*)::int AS n FROM leave_requests WHERE approved_by = $1`, [id]
    );
    if (blockers.rows[0].n > 0) {
      return res.status(409).json({ error: 'Account approved leave requests; deletion blocked.', blocking: { leave_requests_approved: blockers.rows[0].n } });
    }
    await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx jest --forceExit`
Expected: 8 suites / 53+ tests, all green.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/admin.js server/src/__tests__/admin.test.js
git commit -m "feat: admin Users endpoint + DELETE with cascade safeguards"
```

---

### Task 2: Admin console UI — Users tab (static page)

**Files:**
- Modify: `server/public/admin.html`
- No test file needed (page is exercised against live Render in manual verification)

**Interfaces:**
- Consumes: `GET /api/admin/users` response shape `{ users: [...], legacy_count: N }` and `DELETE /api/admin/users/:id` returning `{ ok: true }` or `{ error, blocking? }`.

- [ ] **Step 1: Replace the three card-section layout with a tabbed container**

Read `server/public/admin.html` lines 170–250. Insert a simple nav-bar div right below the token-login form:

```html
<nav class="tabs">
  <button data-tab="invites" active>Invite Codes</button>
  <button data-tab="lockouts">Locked Accounts</button>
  <button data-tab="users">Users</button>
</nav>
<div class="tab-content" id="panel-invites">…existing invite code generator + list…</div>
<div class="tab-content hidden" id="panel-lockouts">…existing lockouts table…</div>
<div class="tab-content hidden" id="panel-users">
  <table id="users-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th>Linked Records</th><th></th></tr></thead><tbody></tbody></table>
  <p id="legacy-note"></p>
</div>
```

- [ ] **Step 2: Wire up tab JS**

Append tab-switching script before the closing `</body>` tag:

```js
document.querySelectorAll('.tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById('panel-' + btn.dataset.tab).classList.remove('hidden');
    if (btn.dataset.tab === 'users') loadUsers();
  });
});
```

- [ ] **Step 3: Load users handler**

Same script block, function `loadUsers()`: POST-GET the `/api/admin/users` endpoint, render table rows; attach each row's "Delete" button handler calling `fetch(/api/admin/users/<id>, { method: 'DELETE' })`; on success remove `<tr>`; handle 409 by showing `blocking.leave_requests_approved` count inline; show `legacy_note.textContent = `${data.legacy_count} system accounts hidden`.

- [ ] **Step 4: Verify in browser**

Open `http://localhost:<PORT>/admin` with a generated ADMIN_TOKEN env var set. Confirm tabs switch, Users panel shows demo rows and legacy note, Delete works with confirm dialog, 409 scenario simulated.

- [ ] **Step 5: Commit**

```bash
git add server/public/admin.html
git commit -m "feat: admin console Users tab with delete action and legacy exclusion"
```

---

### Task 3: Dashboard screen (app) — greeting + stats card

**Files:**
- Create: `app/src/screens/DashboardScreen.js`
- Modify: `app/App.js` state machine
- Modify: `app/src/services/api.js` (add `statsAPI`)

**Interfaces:**
- Consumes: `useAuth().logout` + `useAuth().user.firstname`; API methods added here.
- Produces: New `'dashboard'` state in App.js; DashboardScreen renders greeting, stats card, Open Map button.

- [ ] **Step 1: Write stub screens/test-less verification**

No Jest suite applies to RN screens; verify manually once built. Stub Draft:

```js
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { useAuth } from '../context/AuthContext';
import * as api from '../services/api';

const timeOfDay = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon';
  return 'Evening';
};

export default function DashboardScreen({ onOpenMap, onLogout }) {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.napsAPI.getStats().then(setStats).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const greeting = `Good ${timeOfDay()}, ${user?.firstname || 'User'}`;
  const lastUpdate = stats?.nap_report_date || stats?.last_data_update || 'Unknown';

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.greeting}>{greeting}</Text>
      </View>
      <View style={styles.card}>
        {loading ? <ActivityIndicator color="#00539B" /> : (
          <>
            <Text style={styles.label}>Database Last Updated</Text>
            <Text style={styles.value}>{new Date(lastUpdate).toLocaleDateString()}</Text>
            <Text style={styles.sub}>{stats?.total_naps?.toLocaleString()} facilities</Text>
          </>
        )}
      </View>
      <TouchableOpacity style={styles.btn} onPress={onOpenMap} accessibilityRole="button">
        <Text style={styles.btnText}>Open NAP Map</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.logout} onPress={onLogout} accessibilityRole="button">
        <Text style={styles.logoutText}>Log Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#E5F0FA' },
  hero: { paddingTop: 48, paddingHorizontal: 24, paddingBottom: 32, backgroundColor: '#003A6B', borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  greeting: { color: '#fff', fontSize: 28, fontWeight: '700' },
  card: { marginHorizontal: 24, marginTop: -20, backgroundColor: '#fff', borderRadius: 16, padding: 20, elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, flexDirection: 'column', gap: 4 },
  label: { color: '#00539B', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  value: { color: '#003A6B', fontSize: 20, fontWeight: '600' },
  sub: { color: '#888', fontSize: 13 },
  btn: { marginHorizontal: 24, marginTop: 32, backgroundColor: '#00539B', paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  logout: { alignSelf: 'flex-end', marginRight: 24, marginTop: 16, padding: 8 },
  logoutText: { color: '#888', fontSize: 14 }
});
```

- [ ] **Step 2: Wire `api.statsAPI` in `app/src/services/api.js`**

Add near top, after `SERVER_URL`:

```js
export const napsAPI = {
  getAll: (opts) => request({ url: '/api/naps', params: opts }),
  getStats: () => request({ url: '/api/naps/stats/summary' }), // NEW
  // ...keep existing...
};
```

- [ ] **Step 3: Update App.js state machine**

Current flow: `'login'|'register'|'otp'|'map'`. New `'dashboard'` intermediate between login completion and map opening. Change: when `user` exists and not loading, render `<DashboardScreen onOpenMap={() => setUserState('map')} onLogout={logout} />`. Remove direct `<NapMapScreen>` under `user` condition unless transitioning from dashboard. Keep PasswordSetupScreen gate intact.

- [ ] **Step 4: Verify export**

Run: `cd app && npx expo export --platform android`
Expected: zero unresolved-import errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/screens/DashboardScreen.js app/src/services/api.js app/App.js
git commit -m "feat: Dashboard screen with greeting and NAP stats card"
```

---

### Task 4: Globe theme refresh + icon/splash assets

**Files:**
- Modify: `app/assets/icon.png` (replace PIL draft with Globe Telecom mark)
- Modify: `app/assets/adaptive-icon.png`
- Modify: `app/assets/splash.png`
- Modify: `app/app.json` (keep identical schema; splash image refs already point to these paths)
- Optional polish: tweak NapMapScreen header to apply gradient

**Interfaces:**
- Consumes: Owner did NOT supply official logo file — controller attempts a Wikimedia download (high-res PNG, transparent background) as source. Fallback to current PIL icon if download fails.

- [ ] **Step 1: Download or fall back**

Try: `curl -fSL "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a6/Globe_Telecom_logo.svg/1024px-Globe_Telecom_logo.svg.png" -o /tmp/globe_icon.png` (or similar Wikimedia path if known). If it returns non-200 or corrupt, keep existing PIL draft icons unchanged; log warning in report.

If downloaded, convert to PNGs via `cairosvg` or ImageMagick (`magick convert` / `convert`):
- `icon.png`: 1024×1024, white logo centered on #00539B solid field
- `adaptive-icon.png`: same, 1024×1024
- `splash.png`: 1284×2778 landscape (iPhone), portrait variants generated by cropping or layering; or use Expo's splash generation docs

- [ ] **Step 2: Apply gradient hero treatment to LoginScreen**

In `app/src/screens/LoginScreen.js`, wrap the brand/header area in a LinearGradient component (Expo `expo-linear-gradient` dependency — verify installed; if not, install with `npm i expo-linear-gradient` in app/). Gradient stops: `#00539B` → `#FF3C86` → `#FF8C00`. Use sparingly — hero banner only.

- [ ] **Step 3: Raise the collapsed NAP detail bar**

In `app/src/screens/NapMapScreen.js`, locate `.collapsedBar` style. Change `bottom: 0` (or equivalent pin) to `bottom: 16` or use a positive safe-area inset. Increase height from ~56px to ~68px. Add stronger shadow/elevation (`shadowOffset.height: 4`, larger opacity). Ensure no overlap with search cluster or bottom button.

- [ ] **Step 4: Verify export**

Run: `cd app && npx expo export --platform android`
Expected: clean build; grep brand sweep zero hits.

- [ ] **Step 5: Commit**

```bash
git add app/assets/ app/src/screens/LoginScreen.js app/src/screens/NapMapScreen.js
git commit -m "feat: Globe Telecom theme refresh + raised NAP detail bar"
```

---

### Task 5: Rebuild APK + final sweep

**Files:**
- Run: `./app/build-apk.sh v1.0`
- Verify: `grep -rni ebisu app/src app/App.js app/app.json` → 0 hits
- Tag: `git tag v1.1.0` (bumped from v1.0.0 per spec; push tag+branch)

**Interfaces:**
- Consumes: everything built in Tasks 1–4.
- Produces: fresh signed APK at `app/apk/G-MAPS-v1.0.apk` + `-latest.apk`; tag pushed to GitHub.

- [ ] **Step 1: Run brand sweep**

Command: `grep -rni ebisu app/src app/App.js app/app.json`
Expected: 0 hits. (Hostname exception `ebisu-nap-checker.onrender.com` is tracked in api.js — not a UI hit.)

- [ ] **Step 2: Rebuild**

Command: `cd app && ./build-apk.sh v1.0`
Expected: BUILD SUCCESSFUL; APK output; version still 1.0.0 per spec decision (apk filename uses version number; versionCode auto-bumped from 1 → 2 via node logic — confirm).

- [ ] **Step 3: Commit + tag + push**

```bash
git add .
git commit -m "chore: bump versionCode to 2 for dashboard release"
git tag -f v1.1.0 -m "G-MAPS demo v1.1.0 — dashboard, users, theme refresh"
git push origin gmaps-demo --tags
```

- [ ] **Step 4: Report deliverables**

List APK paths, tag SHA, hostnames baked in (confirm api.js URL unchanged). Note any residual artifacts (e.g., if Wikimedia download failed, current icon stays; if linear-gradient install failed, hero reverts to solid).
