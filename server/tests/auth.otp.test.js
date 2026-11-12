// OTP verification enforces the spec rules: 5 wrong attempts locks the code,
// expired codes are rejected, and a resend is throttled to once per minute.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { Pool } = require('pg');
const app = require('../src/app');
const { runMigrations } = require('../src/config/migrate');
const { issueOtp, latestOtp, OTP_TTL_MINUTES, MAX_ATTEMPTS } =
  require('../src/services/otp');
const { hashOtp } = require('../src/services/otp');

const TEST_URL = process.env.TEST_DATABASE_URL || 'postgres://localhost:5432/napcheck_test';
const pool = new Pool({ connectionString: TEST_URL });

let outbox;

beforeAll(async () => {
  await runMigrations(pool);
  outbox = fs.mkdtempSync(path.join(os.tmpdir(), 'napcheck-otp-'));
  process.env.MAIL_OUTBOX_DIR = outbox;
  delete process.env.SMTP_HOST;
  delete process.env.MAIL_FROM;
});

beforeEach(async () => {
  await pool.query('TRUNCATE users, otp_codes RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await pool.end();
  fs.rmSync(outbox, { recursive: true, force: true });
});

async function insertUser() {
  const res = await pool.query(
    "INSERT INTO users (first_name, last_name, email, phone, status) VALUES ($1,$2,$3,$4,'pending_otp') RETURNING id",
    ['Ana', 'Reyes', 'ana@test.com', '09170000001']
  );
  return res.rows[0].id;
}

async function validOTP(userId) {
  const code = await issueOtp(pool, userId);
  return code; // plain text for entry below
}

test('wrong code increments attempts; 5th wrong is locked', async () => {
  const userId = await insertUser();
  const correctCode = await validOTP(userId);

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ email: 'ana@test.com', code: '000000' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('OTP_INVALID');
  }

  // The correct code should now be rejected as LOCKED.
  const locked = await request(app)
    .post('/api/auth/verify-otp')
    .send({ email: 'ana@test.com', code: correctCode });
  expect(locked.status).toBe(400);
  expect(locked.body.error).toBe('OTP_LOCKED');
});

test('expired code is rejected immediately', async () => {
  const userId = await insertUser();
  const code = await validOTP(userId);
  // Backdate the OTP so it expired before we even start checking.
  await pool.query(
    `UPDATE otp_codes SET expires_at = NOW() - INTERVAL '1 hour'
     WHERE user_id = $1 AND used_at IS NULL`,
    [userId]
  );

  const res = await request(app)
    .post('/api/auth/verify-otp')
    .send({ email: 'ana@test.com', code });
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('OTP_EXPIRED');
});

test('correct code verifies and marks it used', async () => {
  const userId = await insertUser();
  const code = await validOTP(userId);

  const res = await request(app)
    .post('/api/auth/verify-otp')
    .send({ email: 'ana@test.com', code });
  expect(res.status).toBe(200);
  expect(res.body.message).toMatch(/verified/i);

  const row = await latestOtp(pool, userId);
  expect(row).toBeNull(); // marked used
});

test('resend inside cooldown returns 429', async () => {
  const userId = await insertUser();
  await validOTP(userId);

  const res = await request(app).post('/api/auth/resend-otp').send({
    email: 'ana@test.com',
  });
  expect(res.status).toBe(429);
  expect(res.body.error).toBe('OTP_RESEND_COOLDOWN');
});

test('after cooldown a fresh code is issued and emailed', async () => {
  const userId = await insertUser();
  await validOTP(userId);

  // Force time forward by backdating the existing OTP's created_at.
  await pool.query(
    `UPDATE otp_codes SET created_at = NOW() - INTERVAL '61 seconds'
     WHERE user_id = $1`,
    [userId]
  );

  const countBefore = (await pool.query('SELECT COUNT(*) FROM otp_codes')).rows[0].count;
  const res = await request(app).post('/api/auth/resend-otp').send({
    email: 'ana@test.com',
  });
  expect(res.status).toBe(200);

  const countAfter = (await pool.query('SELECT COUNT(*) FROM otp_codes')).rows[0].count;
  expect(countAfter - countBefore).toBe(1);

  const files = fs.readdirSync(outbox);
  expect(files.length).toBeGreaterThan(0);
  const content = fs.readFileSync(path.join(outbox, files[files.length - 1]), 'utf8');
  expect(content).toMatch(/\b\d{6}\b/);
});
