// JWT handling. Two token scopes exist and must never be interchangeable:
//   app            — a normal logged-in session (7 days)
//   password_reset — short-lived, only authorizes POST /api/auth/reset-password
// Both carry the user's token_version. Changing the password (or logging out)
// bumps that version, which kills every token issued before it — a stolen
// token stops working the moment the owner changes their password.
const jwt = require('jsonwebtoken');
const pool = require('../config/database');

function secret() {
  return process.env.JWT_SECRET || 'dev-only-insecure-secret';
}

function signAuthToken(user) {
  return jwt.sign(
    { sub: user.id, scope: 'app', ver: user.token_version || 0 },
    secret(),
    { expiresIn: '7d' }
  );
}

function signResetToken(user) {
  return jwt.sign(
    { sub: user.id, scope: 'password_reset', ver: user.token_version || 0 },
    secret(),
    { expiresIn: '15m' }
  );
}

function unauthorized(res) {
  return res.status(401).json({ error: 'AUTH_REQUIRED' });
}

// Express middleware: requires a valid app-scoped Bearer token whose user is
// still active and whose token_version still matches the database. The extra
// lookup is one primary-key read per request and is what makes logout and
// password changes actually revoke access.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return unauthorized(res);

  let payload;
  try {
    payload = jwt.verify(token, secret());
  } catch {
    return unauthorized(res);
  }
  if (payload.scope !== 'app') return unauthorized(res);

  try {
    const { rows } = await pool.query(
      'SELECT status, token_version FROM users WHERE id = $1',
      [payload.sub]
    );
    const user = rows[0];
    if (!user || user.status !== 'active' || (payload.ver || 0) !== user.token_version) {
      return unauthorized(res);
    }
  } catch (err) {
    console.error('auth lookup failed:', err);
    return res.status(503).json({ error: 'AUTH_UNAVAILABLE' });
  }

  req.userId = payload.sub;
  next();
}

module.exports = { signAuthToken, signResetToken, requireAuth };
