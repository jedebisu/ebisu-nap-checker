// OTP creation, hashing and lookup. Codes are stored hashed (sha256) — a
// database leak must not reveal usable OTPs. Expiry is enforced by the caller
// comparing expires_at against now.
const crypto = require('crypto');

const OTP_TTL_MINUTES = 5; // design spec: codes live 5 minutes
const MAX_ATTEMPTS = 5; // after 5 wrong tries the code is dead

function hashOtp(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function generateOtp() {
  // 6 digits, zero-padded (crypto.randomInt is uniform, unlike Math.random).
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

// Store a fresh code for the user. Any previous unused codes for this user
// are marked used so only the newest code can ever verify.
async function issueOtp(pool, userId) {
  const code = generateOtp();
  await pool.query(
    `UPDATE otp_codes SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL`,
    [userId]
  );
  await pool.query(
    `INSERT INTO otp_codes (user_id, code_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '${OTP_TTL_MINUTES} minutes')`,
    [userId, hashOtp(code)]
  );
  return code;
}

// The newest unused code row for a user, or null.
async function latestOtp(pool, userId) {
  const { rows } = await pool.query(
    `SELECT * FROM otp_codes
     WHERE user_id = $1 AND used_at IS NULL
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

module.exports = { OTP_TTL_MINUTES, MAX_ATTEMPTS, hashOtp, generateOtp, issueOtp, latestOtp };
