process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-jwt-secret';
process.env.ADMIN_TOKEN = 'test-admin-token-123';

const request = require('supertest');
const { app, pool } = require('../server');
const bcrypt = require('bcryptjs');

const ADMIN = 'test-admin-token-123';
const WRONG = 'definitely-not-the-admin-token';
const LOCKED_EMAIL = 'admin-test-locked@example.com';
const UNLOCK_MISSING_EMAIL = 'admin-test-nobody@example.com';

// Codes generated during this file's tests, tracked for cleanup.
const createdCodes = [];

// Seed a locked user (locked_until in the FUTURE so the lockouts panel shows
// it; the brief asks to verify unlock zeroes the counters regardless).
const seedLockedUser = async () => {
  const client = await pool.connect();
  try {
    // Idempotent: clear any leftovers from a previous interrupted run.
    await client.query('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)', [LOCKED_EMAIL]);
    await client.query('DELETE FROM users WHERE email = $1', [LOCKED_EMAIL]);

    const hash = await bcrypt.hash('AdminTest1!', 10);
    const res = await client.query(
      `INSERT INTO users (firstname, lastname, email, password_hash, must_change_password, is_active, role,
                          otp_fail_count, lockout_tier, locked_until)
       VALUES ('Admin', 'TestLocked', $1, $2, false, true, 'user', 3, 2, NOW() + INTERVAL '1 hour')
       RETURNING id`,
      [LOCKED_EMAIL, hash]
    );
    const userId = res.rows[0].id;
    await client.query(
      `INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, 'admin-test-session-token', NOW() + INTERVAL '1 hour')`,
      [userId]
    );
    return userId;
  } finally {
    client.release();
  }
};

beforeAll(async () => {
  await seedLockedUser();
});

afterAll(async () => {
  const client = await pool.connect();
  try {
    if (createdCodes.length > 0) {
      await client.query('DELETE FROM invite_codes WHERE code = ANY($1)', [createdCodes]);
    }
    await client.query('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)', [LOCKED_EMAIL]);
    await client.query('DELETE FROM users WHERE email = $1', [LOCKED_EMAIL]);
  } finally {
    client.release();
    await pool.end();
  }
}, 15000);

describe('Admin API — auth gate', () => {
  it('returns 401 when no token is provided', async () => {
    const res = await request(app).post('/api/admin/invites').send({ max_uses: 10 });
    expect(res.status).toBe(401);
  });

  it('returns 401 when the wrong token is provided', async () => {
    const res = await request(app)
      .post('/api/admin/invites')
      .set('Authorization', `Bearer ${WRONG}`)
      .send({ max_uses: 10 });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/admin/invites', () => {
  it('creates an invite with default max_uses (10) when not provided', async () => {
    const res = await request(app)
      .post('/api/admin/invites')
      .set('Authorization', `Bearer ${ADMIN}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.code).toMatch(/^GMAPS-[0-9A-F]{8}$/);
    createdCodes.push(res.body.code);

    const db = await pool.query('SELECT max_uses FROM invite_codes WHERE code = $1', [res.body.code]);
    expect(db.rows[0].max_uses).toBe(10);
  });

  it('creates an invite with custom max_uses and optional expires_at', async () => {
    const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const res = await request(app)
      .post('/api/admin/invites')
      .set('Authorization', `Bearer ${ADMIN}`)
      .send({ max_uses: 25, expires_at: expires });
    expect(res.status).toBe(200);
    expect(res.body.code).toMatch(/^GMAPS-[0-9A-F]{8}$/);
    createdCodes.push(res.body.code);

    const db = await pool.query('SELECT max_uses, expires_at FROM invite_codes WHERE code = $1', [res.body.code]);
    expect(db.rows[0].max_uses).toBe(25);
    expect(new Date(db.rows[0].expires_at).toISOString()).toBe(expires);
  });
});

describe('GET /api/admin/invites', () => {
  it('lists invite codes including the ones created by this suite', async () => {
    const res = await request(app)
      .get('/api/admin/invites')
      .set('Authorization', `Bearer ${ADMIN}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const codes = res.body.map((r) => r.code);
    for (const code of createdCodes) {
      expect(codes).toContain(code);
    }
    const sample = res.body.find((r) => r.code === createdCodes[0]);
    expect(sample).toHaveProperty('max_uses');
    expect(sample).toHaveProperty('used_count');
    expect(sample).toHaveProperty('expires_at');
    expect(sample).toHaveProperty('created_at');
    expect(sample).toHaveProperty('id');
  });
});

describe('GET /api/admin/lockouts', () => {
  it('lists users with active lockout or failing OTP', async () => {
    const res = await request(app)
      .get('/api/admin/lockouts')
      .set('Authorization', `Bearer ${ADMIN}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const row = res.body.find((r) => r.email === LOCKED_EMAIL);
    expect(row).toBeDefined();
    expect(row.otp_fail_count).toBe(3);
    expect(row.lockout_tier).toBe(2);
    expect(row.locked_until).toBeTruthy();
  });
});

describe('POST /api/admin/unlock', () => {
  it('zeroes lockout fields and clears sessions for the user', async () => {
    const res = await request(app)
      .post('/api/admin/unlock')
      .set('Authorization', `Bearer ${ADMIN}`)
      .send({ email: LOCKED_EMAIL });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const db = await pool.query(
      'SELECT otp_fail_count, lockout_tier, locked_until FROM users WHERE email = $1',
      [LOCKED_EMAIL]
    );
    expect(db.rows[0].otp_fail_count).toBe(0);
    expect(db.rows[0].lockout_tier).toBe(0);
    expect(db.rows[0].locked_until).toBeNull();

    const sessions = await pool.query(
      'SELECT COUNT(*)::int AS n FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)',
      [LOCKED_EMAIL]
    );
    expect(sessions.rows[0].n).toBe(0);
  });

  it('returns 404 for an unknown email', async () => {
    const res = await request(app)
      .post('/api/admin/unlock')
      .set('Authorization', `Bearer ${ADMIN}`)
      .send({ email: UNLOCK_MISSING_EMAIL });
    expect(res.status).toBe(404);
  });
});
