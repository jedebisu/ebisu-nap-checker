// Migrations must be idempotent: running them twice must never fail and must
// always leave all three account tables in place.
const { Pool } = require('pg');
const { runMigrations } = require('../src/config/migrate');

const TEST_URL =
  process.env.TEST_DATABASE_URL ||
  'postgres://localhost:5432/napcheck_test';

const pool = new Pool({ connectionString: TEST_URL });

afterAll(() => pool.end());

test('migrations create users, otp_codes and invite_codes (twice, idempotently)', async () => {
  await runMigrations(pool);
  await runMigrations(pool); // second run must not throw

  const res = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('users', 'otp_codes', 'invite_codes')
    ORDER BY table_name
  `);
  expect(res.rows.map((r) => r.table_name)).toEqual([
    'invite_codes',
    'otp_codes',
    'users',
  ]);
});
