// JWT handling. Two token scopes exist and must never be interchangeable:
//   app            — a normal logged-in session (7 days)
//   password_reset — short-lived, only authorizes POST /api/auth/reset-password
// Reset tokens carry the user's token_version; changing the password bumps
// that version, which invalidates every outstanding reset token (single-use).
const jwt = require('jsonwebtoken');

function secret() {
  return process.env.JWT_SECRET || 'dev-only-insecure-secret';
}

function signAuthToken(user) {
  return jwt.sign({ sub: user.id, scope: 'app' }, secret(), { expiresIn: '7d' });
}

function signResetToken(user) {
  return jwt.sign(
    { sub: user.id, scope: 'password_reset', ver: user.token_version || 0 },
    secret(),
    { expiresIn: '15m' }
  );
}

// Express middleware: requires a valid app-scoped Bearer token.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'AUTH_REQUIRED' });

  try {
    const payload = jwt.verify(token, secret());
    if (payload.scope !== 'app') return res.status(401).json({ error: 'AUTH_REQUIRED' });
    req.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: 'AUTH_REQUIRED' });
  }
}

module.exports = { signAuthToken, signResetToken, requireAuth };
