process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-jwt-secret';
process.env.ADMIN_TOKEN = 'test-admin-token-123';

const request = require('supertest');
const { app, pool } = require('../server');
const bcrypt = require('bcryptjs');

const ADMIN = 'test-admin-token-123';
const WRONG = 'definitely-not-the-admin-token';
const LOCKED_EMAIL = 'admin-test-locked@example.com';
const NOUSER_LOCKED_EMAIL = 'admin-test-locked-nouser@example.com';
const UNLOCK_MISSING_EMAIL = 'admin-test-nobody@example.com';

// Admin Users-panel fixtures. The local gmaps_demo database is a fresh demo
// schema with no employee_id column and no leave_requests table (those only
// exist in the production-shaped database this demo converges toward), so the
// panel's scope filter and FK pre-check need both present to be exercised.
// beforeAll adds them additively (nullable column / IF NOT EXISTS table) and
// afterAll deletes every fixture ROW; the additive schema pieces are left in
// place, mirroring migrate.js's additive-convergence philosophy.
const DEMO_EMAIL_1 = 'admin-test-demo1@example.com';
const DEMO_EMAIL_2 = 'admin-test-demo2@example.com';
const DEMO_EMAIL_3 = 'admin-test-demo3@example.com';
const DEMO_EMAIL_4 = 'admin-test-demo4@example.com';
const DEMO_EMAIL_5 = 'admin-test-demo5@example.com';
const LEGACY_EMAIL = 'admin-test-legacy@example.com';
const FIXTURE_EMAILS = [DEMO_EMAIL_1, DEMO_EMAIL_2, DEMO_EMAIL_3, DEMO_EMAIL_4, DEMO_EMAIL_5, LEGACY_EMAIL];
const fixtureUserIds = [];

// Codes generated during this file's tests, tracked for cleanup.
const createdCodes = [];

// Seed a locked REGISTRATION row (locked_until in the FUTURE so the lockouts
// panel shows it; the brief asks to verify unlock zeroes the counters
// regardless). OTP lockout state lives on registrations, not users — users
// rows are only created after a successful OTP. A matching users row +
// session is also created so the unlock test can verify sessions are dropped
// when a user exists.
const seedLockedRegistration = async () => {
  const client = await pool.connect();
  try {
    // Idempotent: clear any leftovers from a previous interrupted run.
    await client.query('DELETE FROM registrations WHERE email = $1', [LOCKED_EMAIL]);
    await client.query('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)', [LOCKED_EMAIL]);
    await client.query('DELETE FROM users WHERE email = $1', [LOCKED_EMAIL]);

    await client.query(
      `INSERT INTO registrations
         (firstname, lastname, email, phone, invite_code_id, otp_hash, otp_expires_at, otp_fail_count, lockout_tier, locked_until)
       VALUES ('Admin', 'TestLocked', $1, '09170000000', NULL, 'seed-hash', NOW() + INTERVAL '1 hour', 3, 2, NOW() + INTERVAL '1 hour')`,
      [LOCKED_EMAIL]
    );

    const hash = await bcrypt.hash('AdminTest1!', 10);
    const res = await client.query(
      `INSERT INTO users (firstname, lastname, email, password_hash, must_change_password, is_active, role)
       VALUES ('Admin', 'TestLocked', $1, $2, false, true, 'user')
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
  await seedLockedRegistration();
  // Additive fixtures for the Users panel: a nullable employee_id column on
  // users (present in the production-shaped DB this demo converges toward)
  // and a minimal leave_requests table whose approved_by references users.id.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_id VARCHAR(100)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leave_requests (
      id SERIAL PRIMARY KEY,
      employee_id VARCHAR(100),
      approved_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
});

afterAll(async () => {
  const client = await pool.connect();
  try {
    if (createdCodes.length > 0) {
      await client.query('DELETE FROM invite_codes WHERE code = ANY($1)', [createdCodes]);
    }
    await client.query('DELETE FROM registrations WHERE email = ANY($1)', [[LOCKED_EMAIL, NOUSER_LOCKED_EMAIL]]);
    await client.query('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)', [LOCKED_EMAIL]);
    await client.query('DELETE FROM users WHERE email = $1', [LOCKED_EMAIL]);
    // Users-panel fixtures: approve-by references must go before the users rows.
    await client.query(
      'DELETE FROM leave_requests WHERE approved_by IN (SELECT id FROM users WHERE email = ANY($1))',
      [FIXTURE_EMAILS]
    );
    await client.query(
      'DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1))',
      [FIXTURE_EMAILS]
    );
    await client.query('DELETE FROM users WHERE email = ANY($1)', [FIXTURE_EMAILS]);
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
  it('lists the locked registration (not users) with active lockout or failing OTP', async () => {
    const res = await request(app)
      .get('/api/admin/lockouts')
      .set('Authorization', `Bearer ${ADMIN}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const row = res.body.find((r) => r.email === LOCKED_EMAIL);
    expect(row).toBeDefined();
    expect(row.firstname).toBe('Admin');
    expect(row.lastname).toBe('TestLocked');
    expect(row.otp_fail_count).toBe(3);
    expect(row.lockout_tier).toBe(2);
    expect(row.locked_until).toBeTruthy();
  });
});

describe('POST /api/admin/unlock', () => {
  it('zeroes lockout fields on the registration and clears sessions for the matching user', async () => {
    const res = await request(app)
      .post('/api/admin/unlock')
      .set('Authorization', `Bearer ${ADMIN}`)
      .send({ email: LOCKED_EMAIL });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const db = await pool.query(
      'SELECT otp_fail_count, lockout_tier, locked_until FROM registrations WHERE email = $1',
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

  it('unlocks a registration with no matching users row (sessions skipped silently)', async () => {
    await pool.query('DELETE FROM registrations WHERE email = $1', [NOUSER_LOCKED_EMAIL]);
    await pool.query(
      `INSERT INTO registrations
         (firstname, lastname, email, phone, invite_code_id, otp_hash, otp_expires_at, otp_fail_count, lockout_tier, locked_until)
       VALUES ('No', 'User', $1, '09170000001', NULL, 'seed-hash', NOW() + INTERVAL '1 hour', 6, 0, NOW() + INTERVAL '30 minutes')`,
      [NOUSER_LOCKED_EMAIL]
    );
    const res = await request(app)
      .post('/api/admin/unlock')
      .set('Authorization', `Bearer ${ADMIN}`)
      .send({ email: NOUSER_LOCKED_EMAIL });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const db = await pool.query(
      'SELECT otp_fail_count, lockout_tier, locked_until FROM registrations WHERE email = $1',
      [NOUSER_LOCKED_EMAIL]
    );
    expect(db.rows[0].otp_fail_count).toBe(0);
    expect(db.rows[0].lockout_tier).toBe(0);
    expect(db.rows[0].locked_until).toBeNull();
    await pool.query('DELETE FROM registrations WHERE email = $1', [NOUSER_LOCKED_EMAIL]);
  });

  it('returns 404 for an unknown email', async () => {
    const res = await request(app)
      .post('/api/admin/unlock')
      .set('Authorization', `Bearer ${ADMIN}`)
      .send({ email: UNLOCK_MISSING_EMAIL });
    expect(res.status).toBe(404);
  });
});

// Insert a fixture user. Demo accounts get a 'gmaps-'-prefixed employee_id
// (what the trg_users_demo_defaults trigger produces on production-shaped
// databases); legacy accounts are inserted with an explicit non-demo
// employee_id, simulating the pre-existing selfie-attendance rows.
const insertFixtureUser = async (email, employeeId) => {
  const hash = await bcrypt.hash('AdminTest1!', 10);
  const res = await pool.query(
    `INSERT INTO users (firstname, lastname, email, password_hash, must_change_password, is_active, role, employee_id)
     VALUES ('Fixture', 'User', $1, $2, false, true, 'user', $3)
     RETURNING id`,
    [email, hash, employeeId]
  );
  fixtureUserIds.push(res.rows[0].id);
  return res.rows[0].id;
};

describe('GET /api/admin/users', () => {
  it('returns only demo-created accounts (employee_id LIKE gmaps-%)', async () => {
    await insertFixtureUser(DEMO_EMAIL_1, 'gmaps-admin-test-demo1@example.com');
    await insertFixtureUser(DEMO_EMAIL_2, 'gmaps-admin-test-demo2@example.com');
    await insertFixtureUser(LEGACY_EMAIL, 'legacy-admin-test-1');

    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${ADMIN}`);
    expect(res.status).toBe(200);

    const emails = res.body.users.map((u) => u.email);
    expect(emails).toContain(DEMO_EMAIL_1);
    expect(emails).toContain(DEMO_EMAIL_2);
    expect(emails).not.toContain(LEGACY_EMAIL);

    // Exactly the gmaps-% rows — no more, no less.
    const expected = await pool.query(
      `SELECT COUNT(*)::int AS n FROM users WHERE employee_id LIKE 'gmaps-%'`
    );
    expect(res.body.users).toHaveLength(expected.rows[0].n);
    expect(res.body.users.filter((u) => [DEMO_EMAIL_1, DEMO_EMAIL_2].includes(u.email))).toHaveLength(2);
    expect(res.body.legacy_count).toBeGreaterThanOrEqual(1);
    const legacyCheck = await pool.query(
      `SELECT COUNT(*)::int AS n FROM users WHERE employee_id IS NULL OR employee_id NOT LIKE 'gmaps-%'`
    );
    expect(res.body.legacy_count).toBe(legacyCheck.rows[0].n);
    for (const user of res.body.users) {
      expect(user).toHaveProperty('records');
    }
  });

  it('includes records count via sessions join', async () => {
    const id = await insertFixtureUser(DEMO_EMAIL_3, 'gmaps-admin-test-demo3@example.com');
    await pool.query(
      `INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, 'admin-test-users-session', NOW() + INTERVAL '1 hour')`,
      [id]
    );

    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${ADMIN}`);
    expect(res.status).toBe(200);
    const row = res.body.users.find((u) => u.email === DEMO_EMAIL_3);
    expect(row).toBeDefined();
    expect(Number(row.records)).toBeGreaterThan(0);
  });
});

describe('DELETE /api/admin/users/:id', () => {
  it('cascades sessions but preserves legacy FK integrity', async () => {
    const id = await insertFixtureUser(DEMO_EMAIL_4, 'gmaps-admin-test-demo4@example.com');
    await pool.query(
      `INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, 'admin-test-delete-session', NOW() + INTERVAL '1 hour')`,
      [id]
    );

    const res = await request(app)
      .delete(`/api/admin/users/${id}`)
      .set('Authorization', `Bearer ${ADMIN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const user = await pool.query('SELECT id FROM users WHERE id = $1', [id]);
    expect(user.rows).toHaveLength(0);
    const sessions = await pool.query('SELECT id FROM sessions WHERE user_id = $1', [id]);
    expect(sessions.rows).toHaveLength(0);
  });

  it('returns 404 for legacy or unknown id', async () => {
    const legacy = await pool.query('SELECT id FROM users WHERE email = $1', [LEGACY_EMAIL]);
    expect(legacy.rows.length).toBeGreaterThan(0);

    const legacyRes = await request(app)
      .delete(`/api/admin/users/${legacy.rows[0].id}`)
      .set('Authorization', `Bearer ${ADMIN}`);
    expect(legacyRes.status).toBe(404);

    const unknownRes = await request(app)
      .delete('/api/admin/users/99999999')
      .set('Authorization', `Bearer ${ADMIN}`);
    expect(unknownRes.status).toBe(404);

    // The legacy row must be untouched.
    const stillThere = await pool.query('SELECT id FROM users WHERE email = $1', [LEGACY_EMAIL]);
    expect(stillThere.rows).toHaveLength(1);
  });

  it('returns 409 when account approved leave requests', async () => {
    const id = await insertFixtureUser(DEMO_EMAIL_5, 'gmaps-admin-test-demo5@example.com');
    await pool.query(
      `INSERT INTO leave_requests (employee_id, approved_by) VALUES ('gmaps-admin-test-lr', $1)`,
      [id]
    );

    const res = await request(app)
      .delete(`/api/admin/users/${id}`)
      .set('Authorization', `Bearer ${ADMIN}`);
    expect(res.status).toBe(409);
    expect(res.body.blocking).toEqual({ leave_requests_approved: 1 });

    // Blocked account must still exist.
    const stillThere = await pool.query('SELECT id FROM users WHERE id = $1', [id]);
    expect(stillThere.rows).toHaveLength(1);
  });
});
