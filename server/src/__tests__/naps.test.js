process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-jwt-secret';

const request = require('supertest');
const { app, pool } = require('../server');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Resolve the same secret the middleware uses.
const ACTIVE_JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';

// Dedicated user for this file. Do NOT reuse demo1@ebisudps.com — auth tests
// toggle demo1's is_active in parallel workers, which would 401 these
// authenticated requests intermittently.
const NAPS_TEST_EMAIL = 'naps-test@example.com';

// Helper: ensure the dedicated naps test user exists, sign a JWT, insert a sessions row.
const loginNapsTestUser = async () => {
  const client = await pool.connect();
  try {
    // Insert test user if not exists
    const userResult = await client.query(
      `SELECT id FROM users WHERE email = $1`,
      [NAPS_TEST_EMAIL]
    );

    if (userResult.rows.length === 0) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('NapsTest1!', salt);
      await client.query(
        `INSERT INTO users (firstname, lastname, email, password_hash, must_change_password, is_active, role) ` +
        `VALUES ('Naps', 'Test', $1, $2, false, true, 'user')`,
        [NAPS_TEST_EMAIL, hashedPassword]
      );
    }

    const user = await client.query(
      `SELECT id FROM users WHERE email = $1`,
      [NAPS_TEST_EMAIL]
    );

    const token = jwt.sign(
      { userId: user.rows[0].id },
      ACTIVE_JWT_SECRET,
      { expiresIn: '1h' }
    );

    await client.query(
      `INSERT INTO sessions (user_id, token, expires_at) ` +
      `VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [user.rows[0].id, token]
    );

    return token;
  } finally {
    client.release();
  }
};

// Helper: insert 3 fixture NAP rows
const insertTestNAPs = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const testNAPs = [
      {
        nap_id: 'NAP001',
        city_name: 'Cebu City',
        province_name: 'Cebu',
        dp_nap_lat: 10.3129,
        dp_nap_long: 123.8859,
        naps_status: 'GOOD',
        vacant_lines: 5,
        working_lines: 10,
        total_capacity: 15
      },
      {
        nap_id: 'NAP002',
        city_name: 'Cebu City',
        province_name: 'Cebu',
        dp_nap_lat: 10.3130,
        dp_nap_long: 123.8860,
        naps_status: 'FOR REPAIR',
        vacant_lines: 0,
        working_lines: 10,
        total_capacity: 10
      },
      {
        nap_id: 'NAP003',
        city_name: 'Cebu City',
        province_name: 'Cebu',
        dp_nap_lat: 10.3131,
        dp_nap_long: 123.8861,
        naps_status: 'FOR CUT',
        vacant_lines: 15,
        working_lines: 10,
        total_capacity: 25
      }
    ];

    for (const nap of testNAPs) {
      await client.query(
        `INSERT INTO naps (nap_id, city_name, province_name, dp_nap_lat, dp_nap_long, naps_status, vacant_lines, working_lines, total_capacity) ` +
        `VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          nap.nap_id, nap.city_name, nap.province_name,
          nap.dp_nap_lat, nap.dp_nap_long, nap.naps_status,
          nap.vacant_lines, nap.working_lines, nap.total_capacity
        ]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// Helper: clean up test data
const cleanupTestData = async () => {
  const client = await pool.connect();
  try {
    await client.query('DELETE FROM naps WHERE nap_id IN ($1, $2, $3)', ['NAP001', 'NAP002', 'NAP003']);
    await client.query(
      `DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
      [NAPS_TEST_EMAIL]
    );
    await client.query('DELETE FROM users WHERE email = $1', [NAPS_TEST_EMAIL]);
  } finally {
    client.release();
  }
};

// Baseline total_naps captured before fixtures are inserted, so the
// stats assertion holds even when the database already contains a full
// NAP import.
let baselineTotalNaps = 0;

// Test setup — capture baseline, then insert fixtures once before all tests
beforeAll(async () => {
  const token = await loginNapsTestUser();
  const baselineRes = await request(app)
    .get('/api/naps/stats/summary')
    .set('Authorization', `Bearer ${token}`);
  expect(baselineRes.status).toBe(200);
  baselineTotalNaps = baselineRes.body.total_naps;
  expect(typeof baselineTotalNaps).toBe('number');

  await insertTestNAPs();
});

// Test teardown — remove fixtures and the dedicated user after all tests
afterAll(async () => {
  await cleanupTestData();
  await pool.end();
}, 15000);

// Test cases
describe('NAP Endpoints', () => {
  it('should return 401 for unauthenticated GET /api/naps', async () => {
    const res = await request(app).get('/api/naps');
    expect(res.status).toBe(401);
  });

  describe('with authenticated user', () => {
    let token;

    beforeAll(async () => {
      token = await loginNapsTestUser();
    });

    it('should return stats/summary with total_naps increased by 3', async () => {
      const res = await request(app)
        .get('/api/naps/stats/summary')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.total_naps).toBe(baselineTotalNaps + 3);
    });

    it('should return nearest NAPs ordered by distance', async () => {
      const res = await request(app)
        .get('/api/naps/nearest?lat=10.313&lng=123.886')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.naps.length).toBeGreaterThan(0);
      for (let i = 0; i < res.body.naps.length - 1; i++) {
        expect(res.body.naps[i].distance_km).toBeLessThanOrEqual(res.body.naps[i + 1].distance_km);
      }
    });

    it('should filter NAPs by status', async () => {
      const res = await request(app)
        .get('/api/naps/search?q=NAP&status=GOOD')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.naps.length).toBe(1);
      expect(res.body.naps[0].naps_status).toBe('GOOD');
    });
  });
});
