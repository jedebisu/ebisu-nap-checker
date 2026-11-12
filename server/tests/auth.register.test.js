// Registration is invite-coded: no valid invite code, no account. Re-register
// with the email of a non-active account REPLACES it (the design's
// "register again after 24 h expiry" rule); active accounts are protected.
const request = require('supertest');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = require('../src/app');
const { runMigrations } = require('../src/config/migrate');

const TEST_URL =
  process.env.TEST_DATABASE_URL || 'postgres://localhost:5432/napcheck_test';
const pool = new Pool({ connectionString: TEST_URL });

let outbox;
let inviteCode;

beforeAll(async () => {
  await runMigrations(pool);
  outbox = fs.mkdtempSync(path.join(os.tmpdir(), 'napcheck-reg-'));
  process.env.MAIL_OUTBOX_DIR = outbox;
  delete process.env.SMTP_HOST;
  delete process.env.MAIL_FROM;
});

beforeEach(async () => {
  await pool.query('TRUNCATE users, otp_codes, invite_codes RESTART IDENTITY CASCADE');
  const res = await pool.query(
    "INSERT INTO invite_codes (code, max_uses) VALUES ($1, 5) RETURNING code",
    ['INV' + crypto.randomBytes(4).toString('hex').toUpperCase()]
  );
  inviteCode = res.rows[0].code;
});

afterAll(async () => {
  await pool.end();
  fs.rmSync(outbox, { recursive: true, force: true });
});

function outboxFiles() {
  return fs.readdirSync(outbox);
}

function validBody() {
  return {
    first_name: 'Juan',
    last_name: 'Dela Cruz',
    email: 'juan@example.com',
    phone: '09171234567',
    invite_code: inviteCode,
  };
}

test('rejects an unknown invite code', async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ ...validBody(), invite_code: 'NOPE1234' });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/invite/i);
});

test('rejects missing required fields', async () => {
  const { phone, ...noPhone } = validBody();
  const res = await request(app).post('/api/auth/register').send(noPhone);
  expect(res.status).toBe(400);
});

test('valid registration creates pending_otp user, OTP row and email', async () => {
  const res = await request(app).post('/api/auth/register').send(validBody());
  expect(res.status).toBe(201);

  const user = (await pool.query("SELECT * FROM users WHERE email = 'juan@example.com'")).rows[0];
  expect(user.status).toBe('pending_otp');
  expect(user.first_name).toBe('Juan');

  const otps = (await pool.query('SELECT * FROM otp_codes WHERE user_id = $1', [user.id])).rows;
  expect(otps).toHaveLength(1);
  expect(otps[0].used_at).toBeNull();

  const invite = (await pool.query('SELECT * FROM invite_codes WHERE code = $1', [inviteCode])).rows[0];
  expect(invite.uses).toBe(1);
  expect(invite.last_used_by).toBe('juan@example.com');

  const files = outboxFiles();
  expect(files).toHaveLength(1);
  const content = fs.readFileSync(path.join(outbox, files[0]), 'utf8');
  expect(content).toContain('juan@example.com');
  expect(content).toMatch(/\b\d{6}\b/); // a 6-digit code is in the email
});

test('re-registering a stale email replaces the account instead of crashing', async () => {
  const first = await request(app).post('/api/auth/register').send(validBody());
  expect(first.status).toBe(201);

  const again = await request(app)
    .post('/api/auth/register')
    .send({ ...validBody(), first_name: 'Pedro' });
  expect(again.status).toBe(201);

  const users = (await pool.query("SELECT * FROM users WHERE email = 'juan@example.com'")).rows;
  expect(users).toHaveLength(1);
  expect(users[0].first_name).toBe('Pedro');
  expect(users[0].status).toBe('pending_otp');
  const otps = (await pool.query(
    "SELECT * FROM otp_codes WHERE user_id = $1 AND used_at IS NULL", [users[0].id]
  )).rows;
  expect(otps).toHaveLength(1); // fresh unused OTP for the re-registration
});

test('registering with the email of an ACTIVE account is refused', async () => {
  await request(app).post('/api/auth/register').send(validBody());
  const { rows } = await pool.query("SELECT id FROM users WHERE email = 'juan@example.com'");
  await pool.query("UPDATE users SET status = 'active', password_hash = '$2a$10$x' WHERE id = $1", [rows[0].id]);

  const res = await request(app).post('/api/auth/register').send(validBody());
  expect(res.status).toBe(409);
  expect(res.body.error).toBe('EMAIL_IN_USE');
});
