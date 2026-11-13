const express = require('express');
const crypto = require('crypto');
const { pool } = require('../config/database');

const router = express.Router();

const DEFAULT_MAX_USES = 10;

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

module.exports = router;
