// Account authentication routes: register, OTP verify/resend, login, reset,
// forgot-password. Each handler stays small; shared helpers live below.
const express = require('express');
const { issueOtp, latestOtp } = require('../services/otp');
const { hashPassword } = require('../services/passwords');
const { sendMail } = require('../services/mailer');

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

module.exports = router;
module.exports.findUserByEmail = findUserByEmail;
module.exports.requireFields = requireFields;
module.exports.latestOtp = latestOtp;
module.exports.RESEND_COOLDOWN_SECONDS = RESEND_COOLDOWN_SECONDS;
