const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { sendTempPasswordEmail } = require('../services/email');
const { pool } = require('../config/database');

const router = express.Router();

const DEFAULT_MAX_USES = 10;

// Resolve a user row if they are demo-managed (employee_id LIKE 'gmaps-%')
// when the schema carries the column; otherwise every row is demo-managed.
// Returns null when the id is unknown or not managed — never throws.
const getUserIfDemoManaged = async (id) => {
  const scoped = await hasEmployeeIdColumn();
  const demoAnd = scoped ? `AND employee_id LIKE 'gmaps-%'` : '';
  const result = await pool.query(
    `SELECT id, email FROM users WHERE id = $1 ${demoAnd}`,
    [id]
  );
  return result.rows[0] || null;
};

// POST /api/admin/invites — create a new invite code.
// Body: { max_uses?, expires_at? }. max_uses defaults to 10. expires_at, when
// provided, must be a parseable date/datetime string.
router.post('/invites', async (req, res) => {
  try {
    const { max_uses, expires_at } = req.body || {};

    let uses = DEFAULT_MAX_USES;
    if (max_uses !== undefined && max_uses !== null) {
      const parsed = Number(max_uses);
      if (!Number.isInteger(parsed) || parsed < 1) {
        return res.status(400).json({ error: 'max_uses must be a positive integer' });
      }
      uses = parsed;
    }

    let expiresAt = null;
    if (expires_at !== undefined && expires_at !== null && expires_at !== '') {
      const parsed = new Date(expires_at);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'expires_at must be a valid date/datetime' });
      }
      expiresAt = parsed.toISOString();
    }

    const code = 'GMAPS-' + crypto.randomBytes(4).toString('hex').toUpperCase();

    await pool.query(
      'INSERT INTO invite_codes (code, max_uses, expires_at) VALUES ($1, $2, $3)',
      [code, uses, expiresAt]
    );

    res.json({ code });
  } catch (error) {
    console.error('Create invite error:', error);
    res.status(500).json({ error: 'Failed to create invite code' });
  }
});

// GET /api/admin/invites — list all invite codes, newest first.
router.get('/invites', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, code, max_uses, used_count, expires_at, created_at
       FROM invite_codes
       ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('List invites error:', error);
    res.status(500).json({ error: 'Failed to list invite codes' });
  }
});

// Whether this database carries the production-shaped employee_id column on
// users. Fresh demo databases don't; with no such column no legacy (pre-demo)
// rows can exist, so every row is demo-managed.
const hasEmployeeIdColumn = async () => {
  const result = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'employee_id'`
  );
  return result.rows.length > 0;
};

// GET /api/admin/users — list only demo-created accounts (employee_id LIKE
// 'gmaps-%') for the admin console's Users tab. Legacy selfie-attendance
// accounts are never listed; their count is returned as legacy_count so the
// console can show "N system accounts hidden". `records` counts the user's
// non-expired session rows.
router.get('/users', async (_req, res) => {
  try {
    const scoped = await hasEmployeeIdColumn();
    const demoWhere = scoped ? `u.employee_id LIKE 'gmaps-%'` : 'TRUE';
    const result = await pool.query(
      `SELECT u.id, u.firstname, u.lastname, u.email, u.phone, u.role, u.is_active,
              u.must_change_password, u.created_at,
              COUNT(s.id)::int AS records
       FROM users u
       LEFT JOIN sessions s ON s.user_id = u.id AND s.expires_at > NOW()
       WHERE ${demoWhere}
       GROUP BY u.id
       ORDER BY u.created_at DESC`
    );
    let legacyCount = 0;
    if (scoped) {
      const legacy = await pool.query(
        `SELECT COUNT(*)::int AS n FROM users
         WHERE employee_id IS NULL OR employee_id NOT LIKE 'gmaps-%'`
      );
      legacyCount = legacy.rows[0].n;
    }
    res.json({ users: result.rows, legacy_count: legacyCount });
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// DELETE /api/admin/users/:id — hard-delete a demo account. Scoped to the
// same employee_id LIKE 'gmaps-%' filter as the list endpoint: legacy or
// unknown ids return 404 and are never touched. Approved leave requests
// referencing the account as approver block deletion with 409 and a named
// blocker count; otherwise the row is deleted and DB-level ON DELETE CASCADE
// rules (e.g. sessions) take care of the rest.
router.delete('/users/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(404).json({ error: 'Account not found or not managed' });
    }
    const scoped = await hasEmployeeIdColumn();
    const demoAnd = scoped ? `AND employee_id LIKE 'gmaps-%'` : '';
    const owner = await pool.query(
      `SELECT id FROM users WHERE id = $1 ${demoAnd}`,
      [id]
    );
    if (owner.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found or not managed' });
    }
    // Pre-check approved-by blockers. to_regclass() returns NULL instead of
    // raising when leave_requests doesn't exist on this database.
    const tableCheck = await pool.query(`SELECT to_regclass('public.leave_requests') AS reg`);
    if (tableCheck.rows[0].reg) {
      const blockers = await pool.query(
        'SELECT COUNT(*)::int AS n FROM leave_requests WHERE approved_by = $1',
        [id]
      );
      if (blockers.rows[0].n > 0) {
        return res.status(409).json({
          error: 'Account approved leave requests; deletion blocked.',
          blocking: { leave_requests_approved: blockers.rows[0].n },
        });
      }
    }
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// GET /api/admin/lockouts — registrations currently locked out or with OTP
// failures. OTP lockout state lives on the registrations table (the users row
// is only created after a successful OTP), so this panel targets registrations.
// Ordered by locked_until ASC so the most urgent rows come first; NULL
// locked_until (fail count > 0 but not time-locked) sorts last.
router.get('/lockouts', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT email, firstname, lastname, locked_until, otp_fail_count, lockout_tier
       FROM registrations
       WHERE locked_until > NOW() OR otp_fail_count > 0
       ORDER BY locked_until ASC NULLS LAST`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('List lockouts error:', error);
    res.status(500).json({ error: 'Failed to list locked accounts' });
  }
});

// POST /api/admin/unlock — clear OTP lockout state on the registration row for
// an email and drop that email's sessions (if a matching users row exists —
// registrants who never completed registration have none) so they must log in
// again.
router.post('/unlock', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'email is required' });
    }
    const normalized = email.trim().toLowerCase();

    const updated = await pool.query(
      `UPDATE registrations
       SET otp_fail_count = 0, lockout_tier = 0, locked_until = NULL
       WHERE LOWER(email) = $1
       RETURNING email`,
      [normalized]
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({ error: 'Registration not found' });
    }

    const userResult = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = $1',
      [normalized]
    );
    if (userResult.rows.length > 0) {
      await pool.query('DELETE FROM sessions WHERE user_id = $1', [userResult.rows[0].id]);
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Unlock user error:', error);
    res.status(500).json({ error: 'Failed to unlock user' });
  }
});

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

module.exports = router;
