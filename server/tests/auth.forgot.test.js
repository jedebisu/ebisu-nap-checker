// Forgot-password must never reveal whether an email exists: the response is
// identical for known and unknown addresses. Only ACTIVE accounts get a new
// temp password; pending accounts are left alone.
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

const EMAIL = 'forgot@test.com';
let outbox;

beforeAll(async () => {
  await runMigrations(pool);
  outbox = fs.mkdtempSync(path.join(os.tmpdir(), 'napcheck-forgot-'));
  process.env.MAIL_OUTBOX_DIR = outbox;
  delete process.env.SMTP_HOST;
  delete process.env.MAIL_FROM;
});

beforeEach(async () => {
  await pool.query('TRUNCATE users, otp_codes, invite_codes RESTART IDENTITY CASCADE');
  for (const f of fs.readdirSync(outbox)) fs.unlinkSync(path.join(outbox, f));
  await pool.query("INSERT INTO invite_codes (code, max_uses) VALUES ('INVFGT01', 10)");
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

// Full onboarding: register → verify → reset → active account.
async function createActiveUser() {
  await request(app).post('/api/auth/register').send({
    first_name: 'Carlo',
    last_name: 'Lim',
    email: EMAIL,
    phone: '09170000004',
    invite_code: 'INVFGT01',
  });
  const code = emailWith('verification code').match(/\b(\d{6})\b/)[1];
  await request(app).post('/api/auth/verify-otp').send({ email: EMAIL, code });
  const temp = emailWith('Temporary password').match(/Temporary password: (\S+)/)[1];
  const login = await request(app).post('/api/auth/login').send({ email: EMAIL, password: temp });
  await request(app)
    .post('/api/auth/reset-password')
    .send({ reset_token: login.body.reset_token, new_password: 'GoodPass1!' });
}

function outboxCount() {
  return fs.readdirSync(outbox).length;
}

test('active account gets a new temp password email and re-enters the 24h flow', async () => {
  await createActiveUser();
  const before = outboxCount();

  const res = await request(app).post('/api/auth/forgot').send({ email: EMAIL });
  expect(res.status).toBe(200);

  expect(outboxCount()).toBe(before + 1);
  expect(emailWith('Temporary password')).toContain(EMAIL);

  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [EMAIL]);
  expect(rows[0].status).toBe('pending_first_login');
  expect(new Date(rows[0].temp_password_expires_at)).toBeInstanceOf(Date);
});

test('unknown email returns the same 200 answer and sends nothing', async () => {
  const known = await request(app).post('/api/auth/forgot').send({ email: EMAIL });
  const unknown = await request(app).post('/api/auth/forgot').send({ email: 'ghost@nowhere.com' });

  expect(unknown.status).toBe(known.status);
  expect(unknown.body).toEqual(known.body);
  expect(outboxCount()).toBe(0);
});

test('pending_otp account is left untouched and gets no email', async () => {
  await request(app).post('/api/auth/register').send({
    first_name: 'Carlo',
    last_name: 'Lim',
    email: EMAIL,
    phone: '09170000004',
    invite_code: 'INVFGT01',
  });
  const before = outboxCount();

  const res = await request(app).post('/api/auth/forgot').send({ email: EMAIL });
  expect(res.status).toBe(200);
  expect(outboxCount()).toBe(before);

  const { rows } = await pool.query('SELECT status FROM users WHERE email = $1', [EMAIL]);
  expect(rows[0].status).toBe('pending_otp');
});
