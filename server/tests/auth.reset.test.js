// The heart of the onboarding flow: verifying the OTP emails a temporary
// password valid 24 hours; logging in with it returns a reset token only;
// the reset token is single-use and the new password must follow the rules.
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

process.env.JWT_SECRET = 'test-secret';

const app = require('../src/app');
const { runMigrations } = require('../src/config/migrate');

const TEST_URL = process.env.TEST_DATABASE_URL || 'postgres://localhost:5432/napcheck_test';
const pool = new Pool({ connectionString: TEST_URL });

const EMAIL = 'ana@test.com';
let outbox;

beforeAll(async () => {
  await runMigrations(pool);
  outbox = fs.mkdtempSync(path.join(os.tmpdir(), 'napcheck-reset-'));
  process.env.MAIL_OUTBOX_DIR = outbox;
  delete process.env.SMTP_HOST;
  delete process.env.MAIL_FROM;
});

beforeEach(async () => {
  await pool.query('TRUNCATE users, otp_codes, invite_codes RESTART IDENTITY CASCADE');
  for (const f of fs.readdirSync(outbox)) fs.unlinkSync(path.join(outbox, f));
  await pool.query("INSERT INTO invite_codes (code, max_uses) VALUES ('INVTEST1', 10)");
});

afterAll(async () => {
  await pool.end();
  fs.rmSync(outbox, { recursive: true, force: true });
});

function emailWith(phrase) {
  const file = fs
    .readdirSync(outbox)
    .map((f) => ({ f, text: fs.readFileSync(path.join(outbox, f), 'utf8') }))
    .find((m) => m.text.includes(phrase));
  if (!file) throw new Error(`No email containing "${phrase}" in outbox`);
  return file.text;
}

// Runs register -> OTP -> verify and returns the temp password from the email.
async function registerAndVerify() {
  const reg = await request(app).post('/api/auth/register').send({
    first_name: 'Ana',
    last_name: 'Reyes',
    email: EMAIL,
    phone: '09170000002',
    invite_code: 'INVTEST1',
  });
  expect(reg.status).toBe(201);

  const code = emailWith('verification code').match(/\b(\d{6})\b/)[1];
  const verify = await request(app).post('/api/auth/verify-otp').send({ email: EMAIL, code });
  expect(verify.status).toBe(200);

  return emailWith('Temporary password').match(/Temporary password: (\S+)/)[1];
}

test('verify-otp sets pending_first_login, 24h expiry and emails a temp password', async () => {
  const tempPassword = await registerAndVerify();
  expect(tempPassword).toHaveLength(14);

  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [EMAIL]);
  expect(rows[0].status).toBe('pending_first_login');
  expect(rows[0].password_hash).toBeTruthy();

  const hoursLeft = (new Date(rows[0].temp_password_expires_at) - Date.now()) / 36e5;
  expect(hoursLeft).toBeGreaterThan(23.5);
  expect(hoursLeft).toBeLessThanOrEqual(24);
});

test('login with temp password returns must_reset + password_reset scoped token', async () => {
  const tempPassword = await registerAndVerify();
  const res = await request(app).post('/api/auth/login').send({ email: EMAIL, password: tempPassword });

  expect(res.status).toBe(200);
  expect(res.body.must_reset).toBe(true);
  expect(res.body.token).toBeUndefined();

  const decoded = jwt.verify(res.body.reset_token, 'test-secret');
  expect(decoded.scope).toBe('password_reset');
});

test('reset rejects a weak password with the reason', async () => {
  const tempPassword = await registerAndVerify();
  const login = await request(app).post('/api/auth/login').send({ email: EMAIL, password: tempPassword });

  const res = await request(app)
    .post('/api/auth/reset-password')
    .send({ reset_token: login.body.reset_token, new_password: 'weak' });
  expect(res.status).toBe(400);
  expect(res.body.reason).toBe('length');
});

test('reset with a valid password activates the account and returns an app token', async () => {
  const tempPassword = await registerAndVerify();
  const login = await request(app).post('/api/auth/login').send({ email: EMAIL, password: tempPassword });

  const res = await request(app)
    .post('/api/auth/reset-password')
    .send({ reset_token: login.body.reset_token, new_password: 'GoodPass1!' });

  expect(res.status).toBe(200);
  expect(res.body.must_reset).toBe(false);
  expect(jwt.verify(res.body.token, 'test-secret').scope).toBe('app');

  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [EMAIL]);
  expect(rows[0].status).toBe('active');
  expect(rows[0].temp_password_expires_at).toBeNull();
});

test('a reset token cannot be used twice', async () => {
  const tempPassword = await registerAndVerify();
  const login = await request(app).post('/api/auth/login').send({ email: EMAIL, password: tempPassword });

  const first = await request(app)
    .post('/api/auth/reset-password')
    .send({ reset_token: login.body.reset_token, new_password: 'GoodPass1!' });
  expect(first.status).toBe(200);

  const again = await request(app)
    .post('/api/auth/reset-password')
    .send({ reset_token: login.body.reset_token, new_password: 'OtherPass2@' });
  expect(again.status).toBe(401);
  expect(again.body.error).toBe('RESET_TOKEN_INVALID');
});

test('login with the new password returns an app token directly', async () => {
  const tempPassword = await registerAndVerify();
  const login = await request(app).post('/api/auth/login').send({ email: EMAIL, password: tempPassword });
  await request(app)
    .post('/api/auth/reset-password')
    .send({ reset_token: login.body.reset_token, new_password: 'GoodPass1!' });

  const res = await request(app).post('/api/auth/login').send({ email: EMAIL, password: 'GoodPass1!' });
  expect(res.status).toBe(200);
  expect(res.body.must_reset).toBe(false);
  expect(jwt.verify(res.body.token, 'test-secret').scope).toBe('app');
});

test('wrong password is rejected generically', async () => {
  await registerAndVerify();
  const res = await request(app).post('/api/auth/login').send({ email: EMAIL, password: 'nope' });
  expect(res.status).toBe(401);
  expect(res.body.error).toBe('INVALID_CREDENTIALS');
});
