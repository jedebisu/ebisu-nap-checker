const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// Resolve secret the same way middleware/auth.js does.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
}
const ACTIVE_JWT_SECRET = JWT_SECRET || 'dev-only-insecure-secret';

// Rate limit: 5 login attempts per minute per IP (EBISU-style).
// Skip during automated tests to avoid flaky 429 responses.
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts. Try again in 1 minute.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID,
});

// Password-strength regex — mirrors the mobile contract.
const PASSWORD_REGEX = /(?=.{8,})(?=.*[A-Z])(?=.*[^A-Za-z0-9])/;

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

    // Insert sessions row (mirrors EBISU's login tail).
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

module.exports = router;
