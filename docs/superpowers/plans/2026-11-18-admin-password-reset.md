# Admin Password Reset (Admin Console) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-console-only password reset that emails a temporary password, forces password change on next login, and revokes all sessions for the target demo-managed account.

**Architecture:** Extend the existing admin API (`/api/admin/users/:id/reset-password`) and admin console Users UI to trigger a confirmed reset. The server generates a temp password, emails it via the existing `sendTempPasswordEmail` service before mutating state, then in a transaction updates `password_hash`, sets `must_change_password=true`, and deletes all sessions. Scoping matches existing demo-managed user rules.

**Tech Stack:** Node/Express, pg (`pool`), bcryptjs, crypto, existing email service (Resend/in-memory in tests), supertest/Jest, static `admin.html`.

**Spec:** `docs/superpowers/specs/2026-11-18-admin-password-reset-design.md`

---

## File Structure

- **Modify:** `server/src/routes/admin.js` — add `POST /users/:id/reset-password` endpoint; add `bcrypt` and `sendTempPasswordEmail` imports; reuse `hasEmployeeIdColumn`/demo scoping.
- **Modify:** `server/src/__tests__/admin.test.js` — add coverage for reset-password success, scoping/404, and email-failure rollback without corrupting credentials.
- **Modify:** `server/public/admin.html` — add “Reset password” action per user row with Proceed/Cancel confirm and API call/status handling.
- **Reference (no changes expected):** `server/src/services/email.js` (reuse `sendTempPasswordEmail`, `getSentEmails`, `clearSentEmails` in tests), `server/src/routes/auth.js` and `server/src/middleware/auth.js` (existing `must_change_password`/session behavior).

---

### Task 1: Add failing tests for admin password reset endpoint

**Files:**
- Modify: `server/src/__tests__/admin.test.js`

- [ ] **Step 1: Add email service import and reset-password test block**

In `server/src/__tests__/admin.test.js`, add the email service import near the top (after existing requires):

```js
const emailService = require('../services/email');
```

Append the following describe block at the end of the file:

```js
describe('POST /api/admin/users/:id/reset-password', () => {
  const RESET_EMAIL = 'admin-test-reset@example.com';

  beforeEach(() => {
    emailService.clearSentEmails();
  });

  afterEach(async () => {
    await pool.query(
      `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = $1)`,
      [RESET_EMAIL]
    );
    await pool.query('DELETE FROM users WHERE email = $1', [RESET_EMAIL]);
  });

  it('emails a temp password, forces password change, and revokes sessions for a demo-managed user', async () => {
    const id = await insertFixtureUser(RESET_EMAIL, 'gmaps-admin-test-reset@example.com');
    await pool.query(
      `INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, 'admin-test-reset-session', NOW() + INTERVAL '1 hour')`,
      [id]
    );
    const before = await pool.query(
      'SELECT password_hash, must_change_password FROM users WHERE id = $1',
      [id]
    );

    const res = await request(app)
      .post(`/api/admin/users/${id}/reset-password`)
      .set('Authorization', `Bearer ${ADMIN}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const after = await pool.query(
      'SELECT password_hash, must_change_password, email FROM users WHERE id = $1',
      [id]
    );
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0].must_change_password).toBe(true);
    expect(after.rows[0].password_hash).not.toBe(before.rows[0].password_hash);

    const sessions = await pool.query('SELECT id FROM sessions WHERE user_id = $1', [id]);
    expect(sessions.rows).toHaveLength(0);

    const sent = emailService.getSentEmails();
    expect(sent.length).toBe(1);
    expect(sent[0]).toEqual(
      expect.objectContaining({ to: RESET_EMAIL, type: 'temp-password' })
    );
    expect(typeof sent[0].tempPassword).toBe('string');
    expect(sent[0].tempPassword.length).toBeGreaterThan(0);
    const matches = await bcrypt.compare(sent[0].tempPassword, after.rows[0].password_hash);
    expect(matches).toBe(true);
  });

  it('returns 404 for legacy or unknown id', async () => {
    const legacy = await pool.query('SELECT id FROM users WHERE email = $1', [LEGACY_EMAIL]);
    expect(legacy.rows.length).toBeGreaterThan(0);
    const beforeLegacy = await pool.query(
      'SELECT password_hash, must_change_password FROM users WHERE id = $1',
      [legacy.rows[0].id]
    );

    const legacyRes = await request(app)
      .post(`/api/admin/users/${legacy.rows[0].id}/reset-password`)
      .set('Authorization', `Bearer ${ADMIN}`);
    expect(legacyRes.status).toBe(404);

    const unknownRes = await request(app)
      .post('/api/admin/users/99999999/reset-password')
      .set('Authorization', `Bearer ${ADMIN}`);
    expect(unknownRes.status).toBe(404);

    const afterLegacy = await pool.query(
      'SELECT password_hash, must_change_password FROM users WHERE id = $1',
      [legacy.rows[0].id]
    );
    expect(afterLegacy.rows[0].password_hash).toBe(beforeLegacy.rows[0].password_hash);
    expect(afterLegacy.rows[0].must_change_password).toBe(beforeLegacy.rows[0].must_change_password);
    expect(emailService.getSentEmails()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify the new cases fail**

Run: `cd server && npx jest src/__tests__/admin.test.js -t "POST /api/admin/users/:id/reset-password" --runInBand`
Expected: FAIL because `POST /api/admin/users/:id/reset-password` is not implemented (likely 404 “Cannot POST…” or route not found).

- [ ] **Step 3: Commit the failing tests**

```bash
cd /Users/yanggee/VibecodeProjects/gmaps
git add server/src/__tests__/admin.test.js
git commit -m "test: add failing cases for admin password reset endpoint"
```

---

### Task 2: Implement the admin password reset endpoint

**Files:**
- Modify: `server/src/routes/admin.js`

- [ ] **Step 1: Add required imports**

At the top of `server/src/routes/admin.js`, add:

```js
const bcrypt = require('bcryptjs');
const { sendTempPasswordEmail } = require('../services/email');
```

(Keep existing imports, including `crypto`.)

- [ ] **Step 2: Add the reset-password route**

Append this route before `module.exports = router;` in `server/src/routes/admin.js`:

```js
// POST /api/admin/users/:id/reset-password — reset a demo-managed account:
// email a temporary password, force password change on next login, and revoke
// all sessions. Email is sent before mutating state so a delivery failure does
// not leave the account inaccessible.
router.post('/users/:id/reset-password', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(404).json({ error: 'Account not found or not managed' });
  }

  let user;
  try {
    user = await getUserIfDemoManaged(id);
  } catch (error) {
    console.error('Admin reset-password lookup error:', error);
    return res.status(500).json({ error: 'Failed to reset password' });
  }

  if (!user) {
    return res.status(404).json({ error: 'Account not found or not managed' });
  }

  const tempPassword = crypto.randomBytes(8).toString('base64url') + '!A1';
  let passwordHash;
  try {
    passwordHash = await bcrypt.hash(tempPassword, 10);
  } catch (error) {
    console.error('Admin reset-password hash error:', error);
    return res.status(500).json({ error: 'Failed to reset password' });
  }

  try {
    await sendTempPasswordEmail(user.email, tempPassword);
  } catch (error) {
    console.error('Admin reset-password email error:', error.message);
    return res.status(500).json({ error: 'Failed to send temporary password email' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE users SET password_hash = $1, must_change_password = true WHERE id = $2',
      [passwordHash, id]
    );
    await client.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    await client.query('COMMIT');
    return res.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Admin reset-password error:', error);
    return res.status(500).json({ error: 'Failed to reset password' });
  } finally {
    client.release();
  }
});
```

- [ ] **Step 3: Run the reset-password tests to verify they pass**

Run: `cd server && npx jest src/__tests__/admin.test.js -t "POST /api/admin/users/:id/reset-password" --runInBand`
Expected: PASS (2 tests).

- [ ] **Step 4: Commit**

```bash
cd /Users/yanggee/VibecodeProjects/gmaps
git add server/src/routes/admin.js
git commit -m "feat: add admin endpoint to reset demo user passwords"
```

---

### Task 3: Ensure email-send failure does not corrupt account state

**Files:**
- Modify: `server/src/__tests__/admin.test.js`

- [ ] **Step 1: Add a failing/pinning test for email-send failure rollback**

Inside `describe('POST /api/admin/users/:id/reset-password', ...)` in `server/src/__tests__/admin.test.js`, add:

```js
  it('returns 500 and leaves credentials/sessions unchanged when temp-password email send fails', async () => {
    const id = await insertFixtureUser(RESET_EMAIL, 'gmaps-admin-test-reset@example.com');
    await pool.query(
      `INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, 'admin-test-reset-session-fail', NOW() + INTERVAL '1 hour')`,
      [id]
    );
    const before = await pool.query(
      'SELECT password_hash, must_change_password FROM users WHERE id = $1',
      [id]
    );

    const spy = jest
      .spyOn(emailService, 'sendTempPasswordEmail')
      .mockRejectedValueOnce(new Error('send failed'));

    let res;
    try {
      res = await request(app)
        .post(`/api/admin/users/${id}/reset-password`)
        .set('Authorization', `Bearer ${ADMIN}`);
    } finally {
      spy.mockRestore();
    }

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to send temporary password email' });

    const after = await pool.query(
      'SELECT password_hash, must_change_password FROM users WHERE id = $1',
      [id]
    );
    expect(after.rows[0].password_hash).toBe(before.rows[0].password_hash);
    expect(after.rows[0].must_change_password).toBe(before.rows[0].must_change_password);

    const sessions = await pool.query('SELECT id FROM sessions WHERE user_id = $1', [id]);
    expect(sessions.rows.length).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run the test to verify behavior**

Run: `cd server && npx jest src/__tests__/admin.test.js -t "email send fails" --runInBand`
Expected: PASS with the Task 2 implementation (email sent before mutation). If it fails, adjust the endpoint so it returns 500 on send failure without updating the user or deleting sessions, then re-run until PASS.

- [ ] **Step 3: Run all admin tests**

Run: `cd server && npx jest src/__tests__/admin.test.js --runInBand`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/yanggee/VibecodeProjects/gmaps
git add server/src/__tests__/admin.test.js server/src/routes/admin.js
git commit -m "test: ensure admin reset leaves account intact on email failure"
```

(If Task 2 already satisfied this without code changes, commit the test-only change; if endpoint adjustment was needed, include `admin.js`.)

---

### Task 4: Add Reset password action to the admin console UI

**Files:**
- Modify: `server/public/admin.html`

- [ ] **Step 1: Update Users table action cell to include Reset password**

In `server/public/admin.html`, replace the existing action cell rendering in `loadUsers()`:

```js
        const actionTd = document.createElement('td');
        if (canManage) {
          const delBtn = document.createElement('button');
          delBtn.className = 'btn-sm danger';
          delBtn.textContent = 'Delete';
          delBtn.addEventListener('click', () => deleteUser(u.id, `${u.firstname || ''} ${u.lastname || ''}`.trim() || u.email));
          actionTd.appendChild(delBtn);
        } else {
          actionTd.textContent = '—';
          actionTd.className = 'muted';
        }
        tr.appendChild(actionTd);
```

with:

```js
        const actionTd = document.createElement('td');
        if (canManage) {
          const resetBtn = document.createElement('button');
          resetBtn.className = 'btn-sm';
          resetBtn.textContent = 'Reset password';
          resetBtn.style.marginRight = '8px';
          resetBtn.addEventListener('click', () => resetUser(u.id, `${u.firstname || ''} ${u.lastname || ''}`.trim() || u.email, resetBtn));
          actionTd.appendChild(resetBtn);

          const delBtn = document.createElement('button');
          delBtn.className = 'btn-sm danger';
          delBtn.textContent = 'Delete';
          delBtn.addEventListener('click', () => deleteUser(u.id, `${u.firstname || ''} ${u.lastname || ''}`.trim() || u.email));
          actionTd.appendChild(delBtn);
        } else {
          actionTd.textContent = '—';
          actionTd.className = 'muted';
        }
        tr.appendChild(actionTd);
```

- [ ] **Step 2: Add `resetUser` function**

Add this function near `deleteUser(...)` in `server/public/admin.html`:

```js
  async function resetUser(id, label, btn) {
    const token = sessionStorage.getItem('gmaps_admin_token');
    const confirmed = window.confirm(
      `Reset password for ${label || 'this account'}?\n\nThey will be emailed a temporary password and signed out everywhere. Proceed?`
    );
    if (!confirmed) return;

    const original = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Resetting…';
    }
    try {
      const res = await fetch(`/api/admin/users/${id}/reset-password`, {
        method: 'POST',
        headers: authHeaders(token),
      });
      if (res.status === 401) { return handle401(); }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body.error || 'Failed to reset password.');
        return;
      }
      alert(`Temporary password emailed to ${label || 'the user'}. They must change it on next login.`);
    } catch (err) {
      alert('Failed to reset password: ' + err.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = original || 'Reset password';
      }
    }
  }
```

- [ ] **Step 3: Manual UI verification**

Run server locally if available (or rely on deployed admin page after push), open `/admin`, enter `ADMIN_TOKEN`, go to Users tab, and verify:
- Each demo-managed user row shows **Reset password** and **Delete**.
- Clicking **Reset password** shows Proceed/Cancel confirm; Cancel does nothing.
- Proceed calls the API and shows success/error feedback; button disables while in-flight.

- [ ] **Step 4: Commit**

```bash
cd /Users/yanggee/VibecodeProjects/gmaps
git add server/public/admin.html
git commit -m "feat: add admin console action to reset user passwords"
```

---

### Task 5: Verification and integration checks

**Files:**
- Verify: `server/src/routes/admin.js`, `server/src/__tests__/admin.test.js`, `server/public/admin.html`

- [ ] **Step 1: Run focused admin tests**

Run: `cd server && npx jest src/__tests__/admin.test.js --runInBand`
Expected: PASS.

- [ ] **Step 2: Run broader server tests for regressions**

Run: `cd server && npx jest --runInBand`
Expected: PASS (or document any pre-existing/environment-specific failures unrelated to this change).

- [ ] **Step 3: Sanity-check endpoint behavior (optional, if local env configured)**

With a valid `ADMIN_TOKEN` and a demo-managed test user id:
- `POST /api/admin/users/:id/reset-password` returns `200 {"ok":true}` and sends temp password email (or records in test/dev behavior as configured).
- User’s `must_change_password` becomes true and prior sessions are invalidated.

- [ ] **Step 4: Final commit (if any fixes from verification)**

```bash
cd /Users/yanggee/VibecodeProjects/gmaps
git add -A
git commit -m "fix: address verification issues in admin password reset" # only if needed
```

---

## Notes for Implementers

- **Scoping:** Must only reset demo-managed accounts (same rules as list/delete). Never operate on legacy/system accounts surfaced as unmanaged.
- **Email safety:** Do not change password or revoke sessions if temp-password email delivery fails.
- **No schema changes:** Reuse existing `users.password_hash`, `users.must_change_password`, and `sessions`.
- **Consistency:** Reuse registration’s temp-password generation shape and `sendTempPasswordEmail`; rely on existing login/setup-password flow for forced password change.
- **DRY/YAGNI:** No reset-link flow, no public forgot-password endpoint, no new tables. Keep changes minimal and aligned with existing admin patterns.