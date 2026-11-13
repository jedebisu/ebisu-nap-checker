const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const OTP_TTL_MINUTES = 5;
const LOCKOUT_TIERS = [5, 10, 30, 60];
const BCRYPT_COST = 10;

/**
 * Generate a random 6-digit OTP string.
 */
function generateOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Hash an OTP code with bcrypt.
 */
async function hashOtp(code) {
  const salt = await bcrypt.genSalt(BCRYPT_COST);
  return bcrypt.hash(code, salt);
}

/**
 * Compare a plain-text OTP against a stored bcrypt hash.
 */
async function verifyOtp(input, storedHash) {
  return bcrypt.compare(input, storedHash);
}

/**
 * Check whether a registration row is currently locked out.
 * @param {{ locked_until: string|null }} row - the registrations row
 * @returns {{ locked: boolean, minutesLeft: number }}
 */
function checkLockout(row) {
  if (!row.locked_until) {
    return { locked: false, minutesLeft: 0 };
  }
  const now = new Date();
  const lockedUntil = new Date(row.locked_until);
  if (now < lockedUntil) {
    const minutesLeft = Math.ceil((lockedUntil - now) / 60000);
    return { locked: true, minutesLeft };
  }
  return { locked: false, minutesLeft: 0 };
}

/**
 * Compute lockout minutes for the NEXT wrong attempt given current failCount.
 * Tiers: attempt 6 → tier 0 (5 min), 7 → tier 1 (10 min), 8 → tier 2 (30 min), 9+ → tier 3 (60 min).
 * @param {number} failCount - current otp_fail_count (before this attempt)
 * @returns {number} lockout minutes (0 = no lockout)
 */
function escalate(failCount) {
  const newCount = failCount + 1;
  if (newCount < 6) {
    return 0;
  }
  const tier = Math.min(newCount - 6, LOCKOUT_TIERS.length - 1);
  return LOCKOUT_TIERS[tier];
}

module.exports = {
  generateOtp,
  hashOtp,
  verifyOtp,
  checkLockout,
  escalate,
  OTP_TTL_MINUTES,
  LOCKOUT_TIERS,
  BCRYPT_COST,
};
