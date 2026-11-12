// Password generation and validation for EBISU NAP Checker.
// Rules (from the design spec): at least 8 characters, with at least one
// uppercase letter, one number and one special character. Temporary passwords
// are deliberately longer (14 chars) and generated server-side so the user
// never picks their first password — they must replace it on first login.
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const SPECIALS = '!@#$%^&*()-_=+[]{}?';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'abcdefghijklmnopqrstuvwxyz'.toUpperCase();
const DIGITS = '0123456789';

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) {
    return { valid: false, reason: 'length' };
  }
  if (!/[A-Z]/.test(pw)) return { valid: false, reason: 'uppercase' };
  if (!/[0-9]/.test(pw)) return { valid: false, reason: 'number' };
  if (!/[^A-Za-z0-9]/.test(pw)) return { valid: false, reason: 'special' };
  return { valid: true };
}

function randomChar(charset) {
  return charset[crypto.randomInt(charset.length)];
}

// One char from each class (so the class guarantee holds), then random fill,
// then a shuffle so the guaranteed chars are not always at the front.
function generateTempPassword() {
  const alphabet = LOWER + UPPER + DIGITS + SPECIALS;
  const chars = [
    randomChar(UPPER),
    randomChar(LOWER),
    randomChar(DIGITS),
    randomChar(SPECIALS),
  ];
  while (chars.length < 14) chars.push(randomChar(alphabet));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

async function hashPassword(pw) {
  return bcrypt.hash(pw, 10);
}

async function verifyPassword(pw, hash) {
  if (!pw || !hash) return false;
  return bcrypt.compare(pw, hash);
}

module.exports = { validatePassword, generateTempPassword, hashPassword, verifyPassword };
