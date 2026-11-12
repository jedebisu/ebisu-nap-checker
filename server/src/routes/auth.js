// Account authentication routes: register, OTP verify/resend, login, reset,
// forgot-password, logout. Each handler stays small; shared helpers live below.
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
const { signAuthToken, signResetToken, requireAuth } = require('../services/tokens');

const router = express.Router();

// Deliberately strict: the address ends up in emails, in the admin page and in
// outbox filenames, so "<", ">", "/" and spaces must never get through.
const EMAIL_RE = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

const RESEND_COOLDOWN_SECONDS = 60;
const FORGOT_COOLDOWN_SECONDS = 60;

// Find a user by (lowercased) email or null.
async function findUserByEmail(pool, email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [
    String(email).toLowerCase().trim(),
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
    if (!EMAIL_RE.test(String(email).trim())) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const existing = await findUserByEmail(pool, normalizedEmail);
    if (existing && existing.status === 'active') {
      return res.status(409).json({ error: 'EMAIL_IN_USE' });
    }

    // Claim the invite in one statement: the "uses < max_uses" test and the
    // increment happen together, so two registrations arriving at the same
    // moment cannot both squeeze through the last remaining use.
    const claim = await pool.query(
      `UPDATE invite_codes
          SET uses = uses + 1, last_used_by = $2, last_used_at = NOW()
        WHERE code = $1 AND uses < max_uses
        RETURNING id`,
      [String(invite_code).trim(), normalizedEmail]
    );
    if (claim.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or exhausted invite code' });
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

    await sendMail({
      to: normalizedEmail,
      subject: 'EBISU NAP Checker — your verification code',
      text:
        `Hi ${first_name.trim()},\n\n` +
        `Your verification code is: ${code}\n\n` +
        `It expires in 5 minutes. If you did not request this, ignore this email.\n`,
    }, { pool });

    res.status(201).json({ message: 'Registered. Check your email for the verification code.' });
  } catch (err) {
    // Two identical registrations racing: the unique index decides the winner.
    if (err.code === '23505') {
      return res.status(409).json({ error: 'EMAIL_IN_USE' });
    }
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

    // One statement decides everything: the attempt is counted only while the
    // code is live and under the limit, and a match marks it used in the same
    // step. Twenty simultaneous wrong guesses therefore still stop at the
    // limit, and a verified code can never be replayed.
    const attempt = await pool.query(
      `UPDATE otp_codes
          SET attempts = attempts + 1,
              used_at = CASE WHEN code_hash = $2 THEN NOW() ELSE used_at END
        WHERE id = $1 AND used_at IS NULL AND attempts < $3
        RETURNING attempts, expires_at, (code_hash = $2) AS matched`,
      [otp.id, hashOtp(String(code).trim()), MAX_ATTEMPTS]
    );

    const row = attempt.rows[0];
    if (!row) {
      const { rows } = await pool.query(
        'SELECT attempts, expires_at, used_at FROM otp_codes WHERE id = $1',
        [otp.id]
      );
      const current = rows[0];
      if (current && current.attempts >= MAX_ATTEMPTS) {
        return res.status(400).json({ error: 'OTP_LOCKED' });
      }
      if (current && new Date(current.expires_at) < new Date()) {
        return res.status(400).json({ error: 'OTP_EXPIRED' });
      }
      return res.status(400).json({ error: 'OTP_INVALID' });
    }

    if (!row.matched) return res.status(400).json({ error: 'OTP_INVALID' });
    if (new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ error: 'OTP_EXPIRED' });
    }

    await issueTempPassword(pool, user);
    res.json({ message: 'OTP verified; temporary password sent' });
  } catch (err) {
    console.error('verify-otp failed:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

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
    }, { pool });

    res.json({ message: 'A new verification code was sent.' });
  } catch (err) {
    console.error('resend-otp failed:', err);
    res.status(500).json({ error: 'Resend failed' });
  }
});

// How recently a temporary password was emailed. Throttles /forgot so it
// cannot be used to flood a mailbox or keep invalidating a working password.
function forgotThrottled(user) {
  if (!user.last_temp_password_sent_at) return false;
  return (
    Date.now() - new Date(user.last_temp_password_sent_at).getTime() <
    FORGOT_COOLDOWN_SECONDS * 1000
  );
}

// POST /api/auth/forgot — enumeration-safe. Always answers 200 with the same
// body. Active accounts (and users who still have a live temporary password)
// receive a fresh one; nothing else does.
router.post('/forgot', async (req, res) => {
  try {
    const pool = req.db;
    const { email } = req.body || {};
    const generic = { message: 'If the account exists, a new password was sent.' };
    if (!email) return res.json(generic);

    const user = await findUserByEmail(pool, email);
    const eligible = user && ['active', 'pending_first_login'].includes(user.status);
    if (eligible && !forgotThrottled(user)) {
      await issueTempPassword(pool, user);
    }

    res.json(generic);
  } catch (err) {
    console.error('forgot failed:', err);
    res.status(500).json({ error: 'Request failed' });
  }
});

// Generates a strong temporary password, stores its hash, starts the 24-hour
// login window and emails the plain password. Used by verify-otp and
// forgot-password. Bumping token_version here means any session opened with
// the old password dies immediately.
async function issueTempPassword(pool, user) {
  const tempPassword = generateTempPassword();
  await pool.query(
    `UPDATE users
       SET password_hash = $2, status = 'pending_first_login',
           temp_password_expires_at = NOW() + INTERVAL '24 hours',
           last_temp_password_sent_at = NOW(),
           token_version = token_version + 1,
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
  }, { pool });

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

// POST /api/auth/logout — bumps token_version, so this token (and any other
// token issued before now) stops working. Cheap and effective without a
// server-side session store.
router.post('/logout', requireAuth, async (req, res) => {
  try {
    await req.db.query(
      'UPDATE users SET token_version = token_version + 1, updated_at = NOW() WHERE id = $1',
      [req.userId]
    );
    res.json({ message: 'Logged out' });
  } catch (err) {
    console.error('logout failed:', err);
    res.status(500).json({ error: 'Logout failed' });
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
