// This suite performs many logins from 127.0.0.1; raise the per-IP login
// rate limit so it doesn't trip. The dedicated auth.rate-limit.test.js
// exercises the real 5/min default. Must be set before ../server is loaded.
process.env.AUTH_LOGIN_RATE_LIMIT_MAX = '1000';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-jwt-secret';

const request = require('supertest');
const { app, pool } = require('../server');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Resolve the same secret the middleware uses.
const ACTIVE_JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';

// Unique suffix per test run to avoid email collisions between runs.
const _runSuffix = Date.now() + '-' + Math.random().toString(36).slice(2, 8);

// Helper: insert a test user with optional must_change_password flag
const insertTestUser = async (email, mustChangePassword = false) => {
  const client = await pool.connect();
  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('TestPass1!', salt);
    const uniqueEmail = `${email.split('@')[0]}+${_runSuffix}@${email.split('@')[1]}`;
    await client.query(
      `INSERT INTO users (firstname, lastname, email, password_hash, must_change_password, is_active, role) ` +
      `VALUES ('Test', 'User', $1, $2, $3, true, 'user')`,
      [uniqueEmail, hashedPassword, mustChangePassword]
    );
    // Await inside the try so the client is not returned to the pool
    // while this query is still in flight.
    return await client.query(
      `SELECT id FROM users WHERE email = $1`,
      [uniqueEmail]
    );
  } finally {
    client.release();
  }
};

// Helper: clean up test users created in this run
const cleanupTestUsers = async () => {
  const client = await pool.connect();
  try {
    await client.query(
      `DELETE FROM sessions WHERE user_id IN (
        SELECT id FROM users WHERE email LIKE '%@test.com' AND email LIKE '%' || $1 || '%'
      )`,
      [_runSuffix]
    );
    await client.query(
      `DELETE FROM users WHERE email LIKE '%@test.com' AND email LIKE '%' || $1 || '%'`,
      [_runSuffix]
    );
  } finally {
    client.release();
  }
};

describe('Auth Endpoints', () => {
  beforeAll(async () => {
    // Ensure seeded demo users exist (use ON CONFLICT DO NOTHING to avoid duplicates).
    const client = await pool.connect();
    try {
      const salt1 = await bcrypt.genSalt(10);
      const hash1 = await bcrypt.hash('DemoPass1!', salt1);
      await client.query(
        `INSERT INTO users (firstname, lastname, email, password_hash, must_change_password, is_active, role) ` +
        `VALUES ('Demo', 'One', 'demo1@ebisudps.com', $1, false, true, 'user')` +
        `ON CONFLICT (email) DO NOTHING`,
        [hash1]
      );

      const salt2 = await bcrypt.genSalt(10);
      const hash2 = await bcrypt.hash('DemoPass2!', salt2);
      await client.query(
        `INSERT INTO users (firstname, lastname, email, password_hash, must_change_password, is_active, role) ` +
        `VALUES ('Demo', 'Two', 'demo2@ebisudps.com', $1, false, true, 'user')` +
        `ON CONFLICT (email) DO NOTHING`,
        [hash2]
      );
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await cleanupTestUsers();
    await pool.end();
  }, 15000);

  describe('POST /api/auth/login', () => {
    it('should return 401 for wrong password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'demo1@ebisudps.com', password: 'WrongPass!' });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid credentials' });
    });

    it('should return 401 for unknown email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'unknown@test.com', password: 'TestPass1!' });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid credentials' });
    });

    it('should return 401 for inactive user', async () => {
      const client = await pool.connect();
      try {
        const userResult = await client.query(
          `SELECT id FROM users WHERE email = 'demo1@ebisudps.com'`
        );
        const userId = userResult.rows[0].id;

        // Deactivate user for this test.
        await client.query(
          `UPDATE users SET is_active = false WHERE id = $1`,
          [userId]
        );

        const res = await request(app)
          .post('/api/auth/login')
          .send({ email: 'demo1@ebisudps.com', password: 'DemoPass1!' });
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: 'Invalid credentials' });
      } finally {
        // Restore is_active so subsequent tests aren't affected.
        try {
          await client.query(
            `UPDATE users SET is_active = true WHERE email = 'demo1@ebisudps.com'`
          );
        } finally {
          // Return the client to the pool; without this the suite leaks a
          // checked-out client and the pool never drains.
          client.release();
        }
      }
    });

    it('should return token and user info for valid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'demo1@ebisudps.com', password: 'DemoPass1!' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user).toHaveProperty('id');
      expect(res.body.user.email).toBe('demo1@ebisudps.com');
      expect(res.body.user.must_change_password).toBe(false);
    });

    it('should return must_change_password=true for user with must_change_password flag', async () => {
      const userResult = await insertTestUser('temp-mcp@test.com', true);
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: userResult.rows[0].email ? userResult.rows[0].email : `${userResult.rows[0].id}@placeholder`, password: 'TestPass1!' });

      // Re-fetch using the actual email we inserted.
      const lookup = await pool.query(`SELECT email FROM users WHERE id = $1`, [userResult.rows[0].id]);
      const actualEmail = lookup.rows[0].email;

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: actualEmail, password: 'TestPass1!' });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.user.must_change_password).toBe(true);

      // The login route must persist a sessions row for the issued token.
      const sessionResult = await pool.query(
        `SELECT user_id, expires_at FROM sessions WHERE token = $1`,
        [loginRes.body.token]
      );
      expect(sessionResult.rows).toHaveLength(1);
      expect(sessionResult.rows[0].user_id).toBe(userResult.rows[0].id);
      const expiresAt = new Date(sessionResult.rows[0].expires_at).getTime();
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      expect(expiresAt).toBeGreaterThan(now + 29 * dayMs);
      expect(expiresAt).toBeLessThan(now + 31 * dayMs);
      // No explicit cleanup needed: cleanupTestUsers() deletes sessions whose
      // user_id belongs to a suffixed temp user from this run.
    });
  });

  describe('POST /api/auth/logout', () => {
    it('deletes the session row for the issued token', async () => {
      const userResult = await insertTestUser('logout@test.com', false);
      const lookup = await pool.query(`SELECT email FROM users WHERE id = $1`, [userResult.rows[0].id]);
      const email = lookup.rows[0].email;

      const login = await request(app)
        .post('/api/auth/login')
        .send({ email, password: 'TestPass1!' });
      expect(login.status).toBe(200);
      const token = login.body.token;

      const before = await pool.query('SELECT COUNT(*)::int AS n FROM sessions WHERE token = $1', [token]);
      expect(before.rows[0].n).toBe(1);

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });

      const after = await pool.query('SELECT COUNT(*)::int AS n FROM sessions WHERE token = $1', [token]);
      expect(after.rows[0].n).toBe(0);
    });

    it('returns 401 for a garbage token', async () => {
      const res = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', 'Bearer not-a-real-token');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/setup-password', () => {
    let token;
    let userId;
    let userEmail;

    beforeAll(async () => {
      const userResult = await insertTestUser('temp-setup@test.com', true);
      userId = userResult.rows[0].id;
      // Look up the actual (suffixed) email.
      const emailResult = await pool.query(`SELECT email FROM users WHERE id = $1`, [userId]);
      userEmail = emailResult.rows[0].email;

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: userEmail, password: 'TestPass1!' });
      token = res.body.token;
    });

    it('should return 401 for missing token', async () => {
      const res = await request(app)
        .post('/api/auth/setup-password')
        .send({ password: 'GoodPass1!' });
      expect(res.status).toBe(401);
    });

    it('should return 400 for weak password (too short)', async () => {
      const res = await request(app)
        .post('/api/auth/setup-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: 'weak' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/must be at least 8 characters long/);
    });

    it('should return 400 for password without uppercase', async () => {
      const res = await request(app)
        .post('/api/auth/setup-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: 'goodpass1!' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/must contain at least one uppercase letter/);
    });

    it('should return 400 for password without special character', async () => {
      const res = await request(app)
        .post('/api/auth/setup-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: 'GoodPass1' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/must contain at least one special character/);
    });

    it('should return 200 and set password for valid password', async () => {
      const res = await request(app)
        .post('/api/auth/setup-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: 'GoodPass1!' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it('should allow login after password setup', async () => {
      const client = await pool.connect();
      try {
        const user = await client.query(
          `SELECT password_hash, must_change_password FROM users WHERE id = $1`,
          [userId]
        );
        expect(user.rows[0].must_change_password).toBe(false);
        const res = await request(app)
          .post('/api/auth/login')
          .send({ email: userEmail, password: 'GoodPass1!' });
        expect(res.status).toBe(200);
        expect(res.body.user.must_change_password).toBe(false);
      } finally {
        client.release();
      }
    });

    it('should accept token from setup-password in authenticateToken', async () => {
      // Re-login to get fresh token after password change
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: userEmail, password: 'GoodPass1!' });
      const freshToken = res.body.token;

      const resp = await request(app)
        .get('/api/naps/stats/summary')
        .set('Authorization', `Bearer ${freshToken}`);
      expect(resp.status).toBe(200);
    });
  });
});
