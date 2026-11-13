const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  console.error('WARNING: JWT_SECRET not set; using an insecure development secret');
}
const ACTIVE_JWT_SECRET = JWT_SECRET || 'dev-only-insecure-secret';

// Authenticate a request carrying a Bearer JWT. Verifies the token, checks
// that a live session exists, and loads the user row. The users table has no
// employee_id column; name is derived client-side from firstname || lastname.
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    // Verify JWT
    const decoded = jwt.verify(token, ACTIVE_JWT_SECRET);

    // Check if session exists and is valid
    const sessionResult = await pool.query(
      'SELECT * FROM sessions WHERE token = $1 AND expires_at > NOW()',
      [token]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(401).json({ error: 'Session expired' });
    }

    // Get user info — demo-adapted: no employee_id; compute name from
    // firstname and lastname so downstream code that expects req.user.name works.
    const userResult = await pool.query(
      `SELECT id, firstname, lastname, email, must_change_password, is_active, role,
              firstname || ' ' || lastname AS name
       FROM users WHERE id = $1`,
      [decoded.userId]
    );

    if (userResult.rows.length === 0 || !userResult.rows[0].is_active) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    req.user = userResult.rows[0];
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

// Middleware to require admin role on the authenticated user.
const requireAdmin = (req, res, next) => {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Require the static ADMIN_TOKEN bearer — used by the admin console instead of
// full JWT/session flow for internal tooling.
const requireAdminToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return res.status(500).json({ error: 'ADMIN_TOKEN not configured' });
  }
  if (!token || token !== expected) {
    return res.status(401).json({ error: 'Admin token required' });
  }
  next();
};

module.exports = { authenticateToken, requireAdmin, requireAdminToken };
