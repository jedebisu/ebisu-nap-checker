// Regressions for the issues found in the pre-publish review:
//  - the admin page is used from a browser, so it must accept real form posts
//  - anything a user can influence must be escaped in the admin HTML
//  - an app token must die when the password changes or the user logs out
//  - the 5-attempt OTP limit and the invite max_uses limit must hold even when
//    requests arrive at the same moment (read-then-write would overshoot)
//  - forgot-password must not be usable as an email bomb
process.env.JWT_SECRET = 'test-secret';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { Pool } = require('pg');

const app = require('../src/app');
const { runMigrations } = require('../src/config/migrate');
const { hashPassword } = require('../src/services/passwords');
const { signAuthToken } = require('../src/services/tokens');
const { issueOtp, MAX_ATTEMPTS } = require('../src/services/otp');

const TEST_URL = process.env.TEST_DATABASE_URL || 'postgres://localhost:5432/napcheck_test';
const pool = new Pool({ connectionString: TEST_URL });

const ADMIN_PASSWORD = 'admin-pass-123';
let outbox;

beforeAll(async () => {
  await runMigrations(pool);
  outbox = fs.mkdtempSync(path.join(os.tmpdir(), 'napcheck-hard-'));
  process.env.MAIL_OUTBOX_DIR = outbox;
  delete process.env.SMTP_HOST;
  delete process.env.MAIL_FROM;
});

beforeEach(async () => {
  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
  await pool.query('TRUNCATE users, otp_codes, invite_codes RESTART IDENTITY CASCADE');
  for (const f of fs.readdirSync(outbox)) fs.unlinkSync(path.join(outbox, f));
});

afterEach(() => {
  delete global.fetch;
});

afterAll(async () => {
  await pool.end();
  fs.rmSync(outbox, { recursive: true, force: true });
  delete process.env.ADMIN_PASSWORD;
});

async function makeUser({ status = 'active', tokenVersion = 0, email = 'user@test.com' } = {}) {
  const hash = await hashPassword('GoodPass1!');
  const { rows } = await pool.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, status, token_version)
     VALUES ('Test', 'User', $1, '09170000010', $2, $3, $4)
     RETURNING *`,
    [email, hash, status, tokenVersion]
  );
  return rows[0];
}

async function loginToken(email = 'user@test.com', password = 'GoodPass1!') {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.token;
}

async function adminCookie() {
  const res = await request(app).post('/admin/login').type('form').send({ password: ADMIN_PASSWORD });
  expect(res.status).toBe(302);
  return res.headers['set-cookie'].find((c) => c.startsWith('admin_session=')).split(';')[0];
}

// ---------------------------------------------------------------------------
// Admin page: it is an HTML page, so it must work with HTML form posts.
// ---------------------------------------------------------------------------

test('the admin login form works like a browser (form post, redirect, cookie)', async () => {
  const res = await request(app).post('/admin/login').type('form').send({ password: ADMIN_PASSWORD });
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('/admin');

  const cookie = res.headers['set-cookie'].find((c) => c.startsWith('admin_session=')).split(';')[0];
  const page = await request(app).get('/admin').set('Cookie', cookie);
  expect(page.status).toBe(200);
  expect(page.text).toMatch(/Invite codes/);
});

test('a wrong admin password keeps the visitor on the HTML login form', async () => {
  const res = await request(app).post('/admin/login').type('form').send({ password: 'nope' });
  expect(res.status).toBe(401);
  expect(res.headers['content-type']).toMatch(/text\/html/);
  expect(res.text).toMatch(/wrong/i);
});

test('the generate-code form redirects back to the page and persists the code', async () => {
  const cookie = await adminCookie();
  const res = await request(app)
    .post('/admin/api/invite-codes')
    .set('Cookie', cookie)
    .type('form')
    .send({ max_uses: '2' });

  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('/admin');

  const { rows } = await pool.query('SELECT * FROM invite_codes');
  expect(rows).toHaveLength(1);
  expect(rows[0].max_uses).toBe(2);
});

test('an unauthenticated form post is sent back to the login page, not into JSON', async () => {
  const res = await request(app)
    .post('/admin/api/invite-codes')
    .type('form')
    .send({ max_uses: '1' });
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('/admin');
  expect((await pool.query('SELECT * FROM invite_codes')).rows).toHaveLength(0);
});

test('values a registrant can influence are HTML-escaped in the admin page', async () => {
  const hostile = '<script>alert(1)</script>';
  await pool.query(
    "INSERT INTO invite_codes (code, max_uses, uses, last_used_by) VALUES ('ABCD2345', 1, 1, $1)",
    [hostile]
  );

  const cookie = await adminCookie();
  const page = await request(app).get('/admin').set('Cookie', cookie);

  expect(page.status).toBe(200);
  expect(page.text).not.toMatch(/<script>alert\(1\)<\/script>/);
  expect(page.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('registration refuses an email address containing markup', async () => {
  await pool.query("INSERT INTO invite_codes (code, max_uses) VALUES ('INVHARD1', 5)");
  const res = await request(app).post('/api/auth/register').send({
    first_name: 'A',
    last_name: 'B',
    email: '<script>x</script>@a.co',
    phone: '0917',
    invite_code: 'INVHARD1',
  });

  expect(res.status).toBe(400);
  expect((await pool.query('SELECT * FROM users')).rows).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Session invalidation
// ---------------------------------------------------------------------------

test('logging out kills the token it was called with', async () => {
  await makeUser();
  const token = await loginToken();

  const out = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
  expect(out.status).toBe(200);

  const again = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
  expect(again.status).toBe(401);
});

test('a password change invalidates app tokens issued before it', async () => {
  const user = await makeUser();
  const oldToken = await loginToken();

  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ nap_report_date: '2026-11-10' }),
  }));

  const before = await request(app)
    .get('/api/naps/stats/summary')
    .set('Authorization', `Bearer ${oldToken}`);
  expect(before.status).toBe(200);

  await request(app).post('/api/auth/forgot').send({ email: user.email });

  const after = await request(app)
    .get('/api/naps/stats/summary')
    .set('Authorization', `Bearer ${oldToken}`);
  expect(after.status).toBe(401);
});

test('an app token for an account that is not active is refused', async () => {
  const user = await makeUser({ status: 'pending_first_login', tokenVersion: 0 });
  const token = signAuthToken(user);

  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) }));
  const res = await request(app).get('/api/naps/stats/summary').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(401);
});

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

test('parallel wrong guesses cannot exceed the attempt limit', async () => {
  const { rows } = await pool.query(
    `INSERT INTO users (first_name, last_name, email, phone, status)
     VALUES ('Otp', 'User', 'otp@test.com', '09170000011', 'pending_otp') RETURNING id`
  );
  const userId = rows[0].id;
  const code = await issueOtp(pool, userId);
  const wrong = code === '000000' ? '111111' : '000000';

  const guesses = Array.from({ length: 20 }, () =>
    request(app).post('/api/auth/verify-otp').send({ email: 'otp@test.com', code: wrong })
  );
  const results = await Promise.all(guesses);
  results.forEach((res) => expect(res.status).toBe(400));

  const otp = (await pool.query('SELECT * FROM otp_codes WHERE user_id = $1', [userId])).rows[0];
  expect(otp.attempts).toBe(MAX_ATTEMPTS);

  const correct = await request(app)
    .post('/api/auth/verify-otp')
    .send({ email: 'otp@test.com', code });
  expect(correct.body.error).toBe('OTP_LOCKED');
});

test('a one-use invite code can only register one account when hit twice at once', async () => {
  await pool.query("INSERT INTO invite_codes (code, max_uses) VALUES ('INVRACE1', 1)");
  const body = (email) => ({
    first_name: 'A',
    last_name: 'B',
    email,
    phone: '0917',
    invite_code: 'INVRACE1',
  });

  const [first, second] = await Promise.all([
    request(app).post('/api/auth/register').send(body('race1@test.com')),
    request(app).post('/api/auth/register').send(body('race2@test.com')),
  ]);

  expect([first.status, second.status].sort()).toEqual([201, 400]);
  const invite = (await pool.query("SELECT * FROM invite_codes WHERE code = 'INVRACE1'")).rows[0];
  expect(invite.uses).toBe(1);
});

// ---------------------------------------------------------------------------
// Forgot-password throttle
// ---------------------------------------------------------------------------

test('forgot-password sends at most one email per minute', async () => {
  const user = await makeUser();

  const first = await request(app).post('/api/auth/forgot').send({ email: user.email });
  expect(first.status).toBe(200);
  expect(fs.readdirSync(outbox)).toHaveLength(1);

  const second = await request(app).post('/api/auth/forgot').send({ email: user.email });
  expect(second.status).toBe(200);
  expect(second.body).toEqual(first.body);
  expect(fs.readdirSync(outbox)).toHaveLength(1);

  await pool.query(
    "UPDATE users SET last_temp_password_sent_at = NOW() - INTERVAL '2 minutes' WHERE id = $1",
    [user.id]
  );
  const third = await request(app).post('/api/auth/forgot').send({ email: user.email });
  expect(third.status).toBe(200);
  expect(fs.readdirSync(outbox)).toHaveLength(2);
});
