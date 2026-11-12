// The 24-hour rule: a temporary password that was never used to log in makes
// the account expire. The user must register again; the old password is dead.
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { Pool } = require('pg');

process.env.JWT_SECRET = 'test-secret';

const app = require('../src/app');
const { runMigrations } = require('../src/config/migrate');

const TEST_URL = process.env.TEST_DATABASE_URL || 'postgres://localhost:5432/napcheck_test';
const pool = new Pool({ connectionString: TEST_URL });

const EMAIL = 'expired@test.com';
let outbox;

beforeAll(async () => {
  await runMigrations(pool);
  outbox = fs.mkdtempSync(path.join(os.tmpdir(), 'napcheck-exp-'));
  process.env.MAIL_OUTBOX_DIR = outbox;
  delete process.env.SMTP_HOST;
  delete process.env.MAIL_FROM;
});

beforeEach(async () => {
  await pool.query('TRUNCATE users, otp_codes, invite_codes RESTART IDENTITY CASCADE');
  for (const f of fs.readdirSync(outbox)) fs.unlinkSync(path.join(outbox, f));
  await pool.query("INSERT INTO invite_codes (code, max_uses) VALUES ('INVEXP01', 10)");
});

afterAll(async () => {
  await pool.end();
  fs.rmSync(outbox, { recursive: true, force: true });
});

function emailWith(phrase) {
  const match = fs
    .readdirSync(outbox)
    .map((f) => fs.readFileSync(path.join(outbox, f), 'utf8'))
    .find((text) => text.includes(phrase));
  if (!match) throw new Error(`No email containing "${phrase}"`);
  return match;
}

async function registerVerifyAndExpire() {
  await request(app).post('/api/auth/register').send({
    first_name: 'Bea',
    last_name: 'Santos',
    email: EMAIL,
    phone: '09170000003',
    invite_code: 'INVEXP01',
  });
  const code = emailWith('verification code').match(/\b(\d{6})\b/)[1];
  await request(app).post('/api/auth/verify-otp').send({ email: EMAIL, code });
  const tempPassword = emailWith('Temporary password').match(/Temporary password: (\S+)/)[1];

  // Move the deadline into the past by one second.
  await pool.query(
    `UPDATE users SET temp_password_expires_at = NOW() - INTERVAL '1 second'
     WHERE email = $1`,
    [EMAIL]
  );
  return tempPassword;
}

test('login after the 24h window flips the account to expired and refuses', async () => {
  const tempPassword = await registerVerifyAndExpire();

  const res = await request(app).post('/api/auth/login').send({ email: EMAIL, password: tempPassword });
  expect(res.status).toBe(403);
  expect(res.body.error).toBe('ACCOUNT_EXPIRED');

  const { rows } = await pool.query('SELECT status FROM users WHERE email = $1', [EMAIL]);
  expect(rows[0].status).toBe('expired');
});

test('the same temp password never works again', async () => {
  const tempPassword = await registerVerifyAndExpire();
  await request(app).post('/api/auth/login').send({ email: EMAIL, password: tempPassword });

  const again = await request(app).post('/api/auth/login').send({ email: EMAIL, password: tempPassword });
  expect(again.status).toBe(403);
  expect(again.body.error).toBe('ACCOUNT_EXPIRED');
});
