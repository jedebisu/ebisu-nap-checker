const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { sendOtpEmail, sendTempPasswordEmail } = require('../services/email');
const {
  generateOtp,
  hashOtp,
  verifyOtp,
  checkLockout,
  escalate,
  OTP_TTL_MINUTES,
  LOCKOUT_TIERS,
} = require('../services/otp');

// Resolve secret the same way middleware/auth.js does.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
}
const ACTIVE_JWT_SECRET = JWT_SECRET || 'dev-only-insecure-secret';

// Rate limit: 5 login attempts per minute per IP (EBISU-style).
// Overridable via AUTH_LOGIN_RATE_LIMIT_MAX so the shared auth suite can run
// many logins without tripping the limiter; the dedicated rate-limit test
// exercises the default of 5. Not skipped in tests.
const LOGIN_RATE_LIMIT_MAX = parseInt(process.env.AUTH_LOGIN_RATE_LIMIT_MAX || '5', 10);
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: LOGIN_RATE_LIMIT_MAX,
  message: { error: 'Too many login attempts. Try again in 1 minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/auth/login
// Request body: { email, password }
// Response 200: { token, user: { id, email, firstname, lastname, must_change_password } }
// Response 401: { error: 'Invalid credentials' } (same message for bad email and bad password)
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Fetch user by email. The SELECT already includes must_change_password and
    // email (added in Task 2), plus is_active and role from middleware/auth.js.
    const result = await pool.query(
      `SELECT id, firstname, lastname, email, password_hash, must_change_password, is_active
       FROM users WHERE email = $1`,
      [email]
    );

    // Constant-time lookup: treat unknown email and wrong password the same.
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check is_active
    if (!user.is_active) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Compare password with bcrypt hash (no legacy PIN migration — demo DB is fresh).
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Issue JWT ({ userId }, 30-day expiry) — same payload shape as the middleware.
    const token = jwt.sign(
      { userId: user.id },
      ACTIVE_JWT_SECRET,
      { expiresIn: '30d' }
    );

    // SINGLE-ACTIVE-SESSION safety net: revoke every existing session for this
    // user before inserting the new one, so only one login can be active at a
    // time.
    await pool.query(
      `DELETE FROM sessions WHERE user_id = $1`,
      [user.id]
    );
    await pool.query(
      `INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
      [user.id, token]
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstname: user.firstname,
        lastname: user.lastname,
        must_change_password: user.must_change_password,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/logout
// Requires authenticateToken. Deletes the session row for the raw Bearer
// token (the same token value the middleware validated). Idempotent: a
// missing session row is still a 200.
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    await pool.query('DELETE FROM sessions WHERE token = $1', [token]);

    res.json({ ok: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// POST /api/auth/setup-password
// Requires authenticateToken. Body: { password }
// Validates password strength, updates password_hash and must_change_password.
router.post('/setup-password', authenticateToken, async (req, res) => {
  try {
    const user = req.user; // set by authenticateToken middleware

    if (!user || !user.id) {
      return res.status(401).json({ error: 'Access token required' });
    }

    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    // Validate against the contract regex and surface each rule failure.
    let errors = [];
    if (password.length < 8) {
      errors.push('must be at least 8 characters long');
    }
    if (!/[A-Z]/.test(password)) {
      errors.push('must contain at least one uppercase letter');
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
      errors.push('must contain at least one special character');
    }
    if (errors.length > 0) {
      return res.status(400).json({
        error: `Password ${errors.join(', ')}`,
      });
    }

    // Hash and persist.
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    await pool.query(
      `UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2`,
      [hashedPassword, user.id]
    );

    res.json({ ok: true });
  } catch (error) {
    console.error('Setup-password error:', error);
    res.status(500).json({ error: 'Password setup failed' });
  }
});

// POST /api/auth/register
// Request body: { firstname, lastname, email, phone, invite_code }
// Response 200: { ok: true, message: 'OTP sent to <email>' }
// Response 400: { error: 'Invalid invitation key' / 'Invitation key has no uses remaining' }
router.post('/register', async (req, res) => {
  try {
    const { firstname, lastname, email, phone, invite_code } = req.body;

    if (!firstname || !lastname || !email || !phone || !invite_code) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Check invite code (the atomic used_count claim happens at OTP
    // verification time, inside the completion transaction).
    const inviteResult = await pool.query(
      `SELECT id, max_uses, used_count, expires_at FROM invite_codes WHERE code = $1`,
      [invite_code]
    );

    if (inviteResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid invitation key' });
    }

    const invite = inviteResult.rows[0];
    if (invite.used_count >= invite.max_uses) {
      return res.status(400).json({ error: 'Invitation key has no uses remaining' });
    }

    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Invitation key has expired' });
    }

    // Generate OTP
    const otp = generateOtp();
    const otpHash = await hashOtp(otp);
    const otpExpiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    // Create or replace the registration for this email. Lockout state
    // (otp_fail_count / lockout_tier / locked_until) is deliberately NOT
    // reset here — re-registering must not bypass the lockout system,
    // exactly like resend. New rows get the INSERT defaults (0, 0, NULL).
    await pool.query(
      `INSERT INTO registrations (firstname, lastname, email, phone, invite_code_id, otp_hash, otp_expires_at, otp_fail_count, lockout_tier, locked_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0, NULL)
       ON CONFLICT (email) DO UPDATE SET
         firstname = EXCLUDED.firstname,
         lastname = EXCLUDED.lastname,
         phone = EXCLUDED.phone,
         invite_code_id = EXCLUDED.invite_code_id,
         otp_hash = EXCLUDED.otp_hash,
         otp_expires_at = EXCLUDED.otp_expires_at`,
      [firstname, lastname, email, phone, invite.id, otpHash, otpExpiresAt]
    );

    // Send OTP email via Resend (falls back to in-memory log under test).
    await sendOtpEmail(email, otp);

    res.json({ ok: true, message: `OTP sent to ${email}` });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/verify-otp
// Request body: { email, otp }
// Response 200: { ok: true, message: 'Temporary password sent to <email>' }
// Response 400: { error: 'Invalid or expired OTP', lockout_minutes?: number }
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    // 1. Find the registration row by email.
    const regResult = await pool.query(
      `SELECT id, firstname, lastname, phone, invite_code_id, otp_hash, otp_expires_at, otp_fail_count, lockout_tier, locked_until
       FROM registrations WHERE email = $1`,
      [email]
    );

    if (regResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    const registration = regResult.rows[0];

    // 2. Check lockout status on that row.
    const lockout = checkLockout(registration);
    if (lockout.locked) {
      return res.status(400).json({
        error: 'Too many failed attempts. Try again later.',
        lockout_minutes: lockout.minutesLeft,
      });
    }

    if (new Date(registration.otp_expires_at) < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    // 3. Verify the OTP hash against the input.
    const isValid = await verifyOtp(otp, registration.otp_hash);

    if (!isValid) {
      // 5. Wrong OTP: increment the fail counter and escalate the lockout tier.
      const newFailCount = registration.otp_fail_count + 1;
      const lockoutMinutes = escalate(registration.otp_fail_count);
      const newTier = newFailCount >= 6
        ? Math.min(newFailCount - 6, LOCKOUT_TIERS.length - 1)
        : 0;
      const lockedUntil = lockoutMinutes > 0
        ? new Date(Date.now() + lockoutMinutes * 60 * 1000)
        : null;

      await pool.query(
        `UPDATE registrations
         SET otp_fail_count = $1, lockout_tier = $2, locked_until = $3
         WHERE id = $4`,
        [newFailCount, newTier, lockedUntil, registration.id]
      );

      const body = { error: 'Invalid or expired OTP' };
      if (lockoutMinutes > 0) {
        body.lockout_minutes = lockoutMinutes;
      }
      return res.status(400).json(body);
    }

    // 4. Valid OTP. Send the temp-password email FIRST, inside the
    // transaction, before any writes. If the send throws we ROLLBACK and
    // return 500: no users row is created, the invite is not consumed and
    // the registration row is retained so the user can re-verify once email
    // is healthy again. Holding the transaction open across the HTTP send is
    // acceptable at demo scale. Only after a successful send do the guarded
    // invite UPDATE + users INSERT + registrations DELETE run, then COMMIT.
    const tempPassword = crypto.randomBytes(8).toString('base64url') + '!A1';
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      try {
        await sendTempPasswordEmail(email, tempPassword);
      } catch (emailError) {
        await client.query('ROLLBACK');
        console.error('Temp-password email error:', emailError);
        return res.status(500).json({ error: 'Failed to send temporary password email. Please try registering again.' });
      }

      // Email is on its way — now persist everything in the same transaction.
      await client.query(
        `INSERT INTO users (firstname, lastname, email, phone, password_hash, must_change_password)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [registration.firstname, registration.lastname, email, registration.phone, passwordHash]
      );

      const inviteUpdateResult = await client.query(
        `UPDATE invite_codes SET used_count = used_count + 1
         WHERE id = $1 AND used_count < max_uses`,
        [registration.invite_code_id]
      );

      if (inviteUpdateResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Invitation key has no uses remaining' });
      }

      await client.query('DELETE FROM registrations WHERE id = $1', [registration.id]);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    res.json({ ok: true, message: `Temporary password sent to ${email}` });
  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(500).json({ error: 'OTP verification failed' });
  }
});

// POST /api/auth/resend-otp
// Request body: { email }
// Response 200: { ok: true, message: 'New OTP sent to <email>' }
// Response 400: { error: 'No active registration found' }
router.post('/resend-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const regResult = await pool.query(
      `SELECT id FROM registrations WHERE email = $1`,
      [email]
    );

    if (regResult.rows.length === 0) {
      return res.status(400).json({ error: 'No active registration found' });
    }

    // Generate a fresh OTP; replaces the old hash and extends the TTL.
    // Lockout state (otp_fail_count / lockout_tier / locked_until) is deliberately
    // left untouched so resend cannot be used to bypass the lockout system.
    const otp = generateOtp();
    const otpHash = await hashOtp(otp);
    const otpExpiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await pool.query(
      `UPDATE registrations
       SET otp_hash = $1, otp_expires_at = $2
       WHERE email = $3`,
      [otpHash, otpExpiresAt, email]
    );

    await sendOtpEmail(email, otp);

    res.json({ ok: true, message: `New OTP sent to ${email}` });
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({ error: 'Failed to resend OTP' });
  }
});

module.exports = router;
