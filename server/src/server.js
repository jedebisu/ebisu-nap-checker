require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { pool } = require('./config/database');
const { authenticateToken } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3001;

// Behind proxies: trust the first X-Forwarded-For entry so rate limiting uses
// the real client IP rather than the proxy's address.
app.set('trust proxy', 1);

// --- Security hardening ---
// Hand-rolled security headers (no helmet dependency needed for the demo).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// CORS: only known first-party web origins get browser CORS access.
// Requests without an Origin header (mobile app, curl, server-to-server) pass through.
const ALLOWED_ORIGINS = [];
(process.env.CORS_ORIGINS || '').split(',').forEach((origin) => {
  const trimmed = origin.trim();
  if (trimmed) ALLOWED_ORIGINS.push(trimmed);
});
const VERCEL_ORIGIN_RE = /^https:\/\/[a-z0-9-]+\.vercel\.app$/;

app.use(cors({
  credentials: true,
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowed = ALLOWED_ORIGINS.includes(origin) || VERCEL_ORIGIN_RE.test(origin);
    callback(null, allowed);
  }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting — generous global cap; stricter on writes.
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS' || req.path === '/api/health'
});
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
});
app.use(generalLimiter);
app.use('/api', writeLimiter);

// --- Routes ---
const napsRouter = require('./routes/naps');
app.use('/api/naps', authenticateToken, napsRouter);

// Placeholder health endpoint until routes are wired up in later tasks.
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Export the app so tests can import it without binding a port.
// Only call listen when this file is the main entry point.
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    server.close(async () => {
      console.log('HTTP server closed.');
      await pool.end();
      console.log('Database pool closed.');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { app, pool };
