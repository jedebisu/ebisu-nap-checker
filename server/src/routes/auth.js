// Account authentication routes: register, OTP verify/resend, login, reset,
// forgot-password. Each handler stays small; shared helpers live below.
const express = require('express');
const jwt = require('jsonwebtoken');
const { issueOtp, latestOtp, hashOtp, MAX_ATTEMPTS } = require('../services/otp');
const {
  hashPassword,
  verifyPassword,
  generateTempPassword,
  validatePassword,
} = require('../services/passwords');
const { sendMail } = require('../services/mailer');
const { signAuthToken, signResetToken } = require('../services/tokens');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RESEND_COOLDOWN_SECONDS = 60;

// Find a user by (lowercased) email or null.
async function findUserByEmail(pool, email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [
    email.toLowerCase(),
  ]);
  return rows[0] || null;
}

function requireFields(body, fields) {
  const missing = fields.filter((f) => !body[f] || !String(body[f]).trim());
  return missing.length ? missing : null;
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const pool = req.db;
    const { first_name, last_name, email, phone, invite_code } = req.body || {};

    const missing = requireFields(req.body || {}, [
      'first_name',
      'last_name',
      'email',
      'phone',
      'invite_code',
    ]);
    if (missing) {
      return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    // Invite code must exist and have uses left.
    const invite = await pool.query(
      'SELECT * FROM invite_codes WHERE code = $1',
      [String(invite_code).trim()]
    );
    if (invite.rows.length === 0 || invite.rows[0].uses >= invite.rows[0].max_uses) {
      return res.status(400).json({ error: 'Invalid or exhausted invite code' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await findUserByEmail(pool, normalizedEmail);

    if (existing && existing.status === 'active') {
      return res.status(409).json({ error: 'EMAIL_IN_USE' });
    }

    // Replace-or-insert: a stale account (pending_otp / pending_first_login /
    // expired) is overwritten so the same email can register again, per spec.
    let userId;
    if (existing) {
      const updated = await pool.query(
        `UPDATE users
           SET first_name = $2, last_name = $3, phone = $4,
               password_hash = NULL, status = 'pending_otp',
               temp_password_expires_at = NULL, updated_at = NOW()
         WHERE id = $1
         RETURNING id`,
        [existing.id, first_name.trim(), last_name.trim(), phone.trim()]
      );
      userId = updated.rows[0].id;
    } else {
      const inserted = await pool.query(
        `INSERT INTO users (first_name, last_name, email, phone, status)
         VALUES ($1, $2, $3, $4, 'pending_otp')
         RETURNING id`,
        [first_name.trim(), last_name.trim(), normalizedEmail, phone.trim()]
      );
      userId = inserted.rows[0].id;
    }

    const code = await issueOtp(pool, userId);

    await pool.query(
      `UPDATE invite_codes
         SET uses = uses + 1, last_used_by = $2, last_used_at = NOW()
       WHERE code = $1`,
      [String(invite_code).trim(), normalizedEmail]
    );

    await sendMail({
      to: normalizedEmail,
      subject: 'EBISU NAP Checker — your verification code',
      text:
        `Hi ${first_name.trim()},\n\n` +
        `Your verification code is: ${code}\n\n` +
        `It expires in 5 minutes. If you did not request this, ignore this email.\n`,
    });

    res.status(201).json({ message: 'Registered. Check your email for the verification code.' });
  } catch (err) {
    console.error('register failed:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/verify-otp — checks the 6-digit code. Lockout wins over
// expiry so a brute-forced code can never be retried, and error codes stay
// generic (OTP_INVALID) when the email is unknown (no account enumeration).
router.post('/verify-otp', async (req, res) => {
  try {
    const pool = req.db;
    const { email, code } = req.body || {};
    if (!email || !code) {
      return res.status(400).json({ error: 'Email and code are required' });
    }

    const user = await findUserByEmail(pool, email);
    // Unknown email: same answer as a wrong code, nothing more to learn.
    const otp = user ? await latestOtp(pool, user.id) : null;
    if (!otp) return res.status(400).json({ error: 'OTP_INVALID' });

    if (otp.attempts >= MAX_ATTEMPTS) {
      return res.status(400).json({ error: 'OTP_LOCKED' });
    }
    if (new Date(otp.expires_at) < new Date()) {
      return res.status(400).json({ error: 'OTP_EXPIRED' });
    }
    if (otp.code_hash !== hashOtp(String(code).trim())) {
      await pool.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
      return res.status(400).json({ error: 'OTP_INVALID' });
    }

    await pool.query('UPDATE otp_codes SET used_at = NOW() WHERE id = $1', [otp.id]);
    await issueTempPassword(pool, user);

    res.json({ message: 'OTP verified; temporary password sent' });
  } catch (err) {
    console.error('verify-otp failed:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// POST /api/auth/forgot — enumeration-safe. Always answers 200 with the same
// body. Only active accounts actually receive a fresh temporary password.
router.post('/forgot', async (req, res) => {
  try {
    const pool = req.db;
    const { email } = req.body || {};
    const generic = { message: 'If the account exists, a new password was sent.' };
    if (!email) return res.json(generic);

    const user = await findUserByEmail(pool, email);
    if (user && user.status === 'active') {
      await issueTempPassword(pool, user);
    }

    res.json(generic);
  } catch (err) {
    console.error('forgot failed:', err);
    res.status(500).json({ error: 'Request failed' });
  }
});

// Generates a strong temporary password, stores its hash, starts the 24-hour
// login window and emails the plain password. Used by verify-otp (Task 7) and
// by forgot-password (Task 9).
async function issueTempPassword(pool, user) {
  const tempPassword = generateTempPassword();
  await pool.query(
    `UPDATE users
       SET password_hash = $2, status = 'pending_first_login',
           temp_password_expires_at = NOW() + INTERVAL '24 hours',
           updated_at = NOW()
     WHERE id = $1`,
    [user.id, await hashPassword(tempPassword)]
  );

  await sendMail({
    to: user.email,
    subject: 'EBISU NAP Checker — your temporary password',
    text:
      `Hi ${user.first_name},\n\n` +
      `Your phone verification succeeded. Temporary password: ${tempPassword}\n\n` +
      `This password is valid for 24 hours. Log in and you will be asked to ` +
      `set your own password.\n\n` +
      `If it expires, register again on the app.\n`,
  });

  return tempPassword;
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const pool = req.db;
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await findUserByEmail(pool, email);
    if (!user) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });

    if (user.status === 'expired') {
      return res.status(403).json({
        error: 'ACCOUNT_EXPIRED',
        message: 'Registration expired. Please register again.',
      });
    }
    if (user.status === 'pending_otp') {
      return res.status(403).json({ error: 'OTP_NOT_VERIFIED' });
    }
    if (user.status === 'pending_first_login') {
      // Task 8 owns the expiry rule; enforced here so it cannot be bypassed.
      if (new Date(user.temp_password_expires_at) < new Date()) {
        await pool.query("UPDATE users SET status = 'expired' WHERE id = $1", [user.id]);
        return res.status(403).json({
          error: 'ACCOUNT_EXPIRED',
          message: 'Registration expired. Please register again.',
        });
      }
      return res.json({ must_reset: true, reset_token: signResetToken(user) });
    }

    res.json({
      token: signAuthToken(user),
      must_reset: false,
      user: publicUser(user),
    });
  } catch (err) {
    console.error('login failed:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/reset-password — consumes a password_reset token exactly once.
router.post('/reset-password', async (req, res) => {
  try {
    const pool = req.db;
    const { reset_token, new_password } = req.body || {};

    let payload;
    try {
      payload = jwt.verify(reset_token, jwtSecret());
    } catch {
      return res.status(401).json({ error: 'RESET_TOKEN_INVALID' });
    }
    if (payload.scope !== 'password_reset') {
      return res.status(401).json({ error: 'RESET_TOKEN_INVALID' });
    }

    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [payload.sub]);
    const user = rows[0];
    if (!user || (payload.ver || 0) !== user.token_version) {
      return res.status(401).json({ error: 'RESET_TOKEN_INVALID' });
    }

    const check = validatePassword(new_password);
    if (!check.valid) {
      return res.status(400).json({ error: 'WEAK_PASSWORD', reason: check.reason });
    }

    const updated = await pool.query(
      `UPDATE users
         SET password_hash = $2, status = 'active',
             temp_password_expires_at = NULL,
             token_version = token_version + 1, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [user.id, await hashPassword(new_password)]
    );

    res.json({
      token: signAuthToken(updated.rows[0]),
      must_reset: false,
      user: publicUser(updated.rows[0]),
    });
  } catch (err) {
    console.error('reset-password failed:', err);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

function publicUser(user) {
  return {
    id: user.id,
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
  };
}

function jwtSecret() {
  return process.env.JWT_SECRET || 'dev-only-insecure-secret';
}

module.exports = router;

// POST /api/auth/resend-otp — a user may ask for a new code at most once a
// minute. Unknown emails get the same 200 answer as known ones.
router.post('/resend-otp', async (req, res) => {
  try {
    const pool = req.db;
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await findUserByEmail(pool, email);
    if (!user) return res.json({ message: 'If the account exists, a new code was sent.' });

    const { rows } = await pool.query(
      `SELECT created_at FROM otp_codes
       WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [user.id]
    );
    const lastSentAt = rows[0]?.created_at;
    if (lastSentAt && Date.now() - new Date(lastSentAt).getTime() < RESEND_COOLDOWN_SECONDS * 1000) {
      return res.status(429).json({ error: 'OTP_RESEND_COOLDOWN' });
    }

    const code = await issueOtp(pool, user.id);
    await sendMail({
      to: user.email,
      subject: 'EBISU NAP Checker — your new verification code',
      text:
        `Your verification code is: ${code}\n\n` +
        `It expires in 5 minutes. If you did not request this, ignore this email.\n`,
    });

    res.json({ message: 'A new verification code was sent.' });
  } catch (err) {
    console.error('resend-otp failed:', err);
    res.status(500).json({ error: 'Resend failed' });
  }
});

module.exports = router;
module.exports.findUserByEmail = findUserByEmail;
module.exports.requireFields = requireFields;
module.exports.latestOtp = latestOtp;
module.exports.RESEND_COOLDOWN_SECONDS = RESEND_COOLDOWN_SECONDS;
