// The admin page is the only way invite codes are created. It is disabled
// (404) unless ADMIN_PASSWORD is set, and guarded by an httpOnly cookie.
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

process.env.JWT_SECRET = 'test-secret';
const app = require('../src/app');
const { runMigrations } = require('../src/config/migrate');

const TEST_URL = process.env.TEST_DATABASE_URL || 'postgres://localhost:5432/napcheck_test';
const pool = new Pool({ connectionString: TEST_URL });

beforeAll(async () => {
  await runMigrations(pool);
});

beforeEach(async () => {
  await pool.query('TRUNCATE users, otp_codes, invite_codes RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await pool.end();
  delete process.env.ADMIN_PASSWORD;
});

async function adminCookie() {
  process.env.ADMIN_PASSWORD = 'admin-pass-123';
  const res = await request(app).post('/admin/login').send({ password: 'admin-pass-123' });
  expect(res.status).toBe(200);
  const raw = res.headers['set-cookie'].find((c) => c.startsWith('admin_session='));
  return raw.split(';')[0]; // "admin_session=<jwt>"
}

test('admin is disabled when ADMIN_PASSWORD is unset', async () => {
  delete process.env.ADMIN_PASSWORD;
  const page = await request(app).get('/admin');
  expect(page.status).toBe(404);
  const api = await request(app).get('/admin/api/invite-codes');
  expect(api.status).toBe(404);
});

test('wrong admin password is rejected', async () => {
  process.env.ADMIN_PASSWORD = 'admin-pass-123';
  const res = await request(app).post('/admin/login').send({ password: 'nope' });
  expect(res.status).toBe(401);
});

test('login sets an admin_session cookie and the page renders', async () => {
  const cookie = await adminCookie();
  const decoded = jwt.verify(cookie.split('=')[1], 'test-secret');
  expect(decoded.scope).toBe('admin');

  const page = await request(app).get('/admin').set('Cookie', cookie);
  expect(page.status).toBe(200);
  expect(page.text).toMatch(/invite/i);
});

test('generated invite code works end-to-end with register', async () => {
  const cookie = await adminCookie();
  const gen = await request(app)
    .post('/admin/api/invite-codes')
    .set('Cookie', cookie)
    .send({ max_uses: 2 });
  expect(gen.status).toBe(200);
  expect(gen.body.code).toMatch(/^[A-Z0-9]{8}$/);

  const reg = await request(app).post('/api/auth/register').send({
    first_name: 'Dina',
    last_name: 'Cruz',
    email: 'dina@test.com',
    phone: '09170000005',
    invite_code: gen.body.code,
  });
  expect(reg.status).toBe(201);

  const list = await request(app).get('/admin/api/invite-codes').set('Cookie', cookie);
  expect(list.status).toBe(200);
  const row = list.body.codes.find((c) => c.code === gen.body.code);
  expect(row.uses).toBe(1);
  expect(row.max_uses).toBe(2);
  expect(row.last_used_by).toBe('dina@test.com');
});

test('invite-code API refuses requests without the cookie', async () => {
  process.env.ADMIN_PASSWORD = 'admin-pass-123';
  const res = await request(app).get('/admin/api/invite-codes');
  expect(res.status).toBe(401);
});
