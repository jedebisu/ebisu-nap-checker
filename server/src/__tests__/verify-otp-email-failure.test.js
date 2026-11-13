// Regression: if the temp-password email send fails during verify-otp,
// the completion transaction must roll back — no users row, invite not
// consumed, registration row retained so the user can re-verify later.
// The email module is mocked at the boundary the route imports; sendOtpEmail
// records OTPs so the test can drive verify-otp.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-jwt-secret';

const mockOtpLog = [];
const mockSendOtpEmail = jest.fn(async (to, otp) => {
  mockOtpLog.push({ to, otp, type: 'otp' });
});
const mockSendTempPasswordEmail = jest.fn(async () => {
  throw new Error('Resend is down');
});

jest.mock('../services/email', () => ({
  sendOtpEmail: (...args) => mockSendOtpEmail(...args),
  sendTempPasswordEmail: (...args) => mockSendTempPasswordEmail(...args),
  getSentEmails: () => [...mockOtpLog],
  clearSentEmails: () => {
    mockOtpLog.length = 0;
  },
}));

const request = require('supertest');
const crypto = require('crypto');
const { app, pool } = require('../server');

const _runSuffix = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
const mkEmail = (name) => `${name}+${_runSuffix}@test.com`;
const createdCodes = [];

const insertInvite = async ({ maxUses = 5 } = {}) => {
  const code = `GMAPS-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  await pool.query(
    `INSERT INTO invite_codes (code, max_uses, used_count, expires_at) VALUES ($1, $2, 0, NULL)`,
    [code, maxUses]
  );
  createdCodes.push(code);
  return code;
};

beforeEach(() => {
  mockOtpLog.length = 0;
  mockSendTempPasswordEmail.mockClear();
  mockSendTempPasswordEmail.mockImplementation(async () => {
    throw new Error('Resend is down');
  });
});

afterAll(async () => {
  const client = await pool.connect();
  try {
    await client.query(
      `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%' || $1 || '%')`,
      [_runSuffix]
    );
    await client.query(`DELETE FROM users WHERE email LIKE '%' || $1 || '%'`, [_runSuffix]);
    await client.query(`DELETE FROM registrations WHERE email LIKE '%' || $1 || '%'`, [_runSuffix]);
    if (createdCodes.length > 0) {
      await client.query(`DELETE FROM invite_codes WHERE code = ANY($1::text[])`, [createdCodes]);
    }
  } finally {
    client.release();
  }
  await pool.end();
}, 15000);

describe('verify-otp when the temp-password email send fails', () => {
  it('returns 500, creates no user, does not consume the invite, retains the registration — and retry succeeds once email recovers', async () => {
    const code = await insertInvite({ maxUses: 5 });
    const email = mkEmail('email-failure');

    const reg = await request(app).post('/api/auth/register').send({
      firstname: 'Email',
      lastname: 'Failure',
      email,
      phone: '09171234567',
      invite_code: code,
    });
    expect(reg.status).toBe(200);

    const otp = mockOtpLog[mockOtpLog.length - 1].otp;

    // Temp-password send throws → 500 with the documented error body.
    const res = await request(app).post('/api/auth/verify-otp').send({ email, otp });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: 'Failed to send temporary password email. Please try registering again.',
    });

    // No users row created.
    const users = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    expect(users.rows).toHaveLength(0);

    // Invite not consumed.
    const invite = await pool.query('SELECT used_count FROM invite_codes WHERE code = $1', [code]);
    expect(invite.rows[0].used_count).toBe(0);

    // Registration row retained for re-verification.
    const retained = await pool.query('SELECT id FROM registrations WHERE email = $1', [email]);
    expect(retained.rows).toHaveLength(1);

    // Once the email service recovers, the SAME otp completes registration.
    mockSendTempPasswordEmail.mockImplementationOnce(async () => undefined);
    const retry = await request(app).post('/api/auth/verify-otp').send({ email, otp });
    expect(retry.status).toBe(200);

    const created = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    expect(created.rows).toHaveLength(1);
    const inviteAfter = await pool.query('SELECT used_count FROM invite_codes WHERE code = $1', [code]);
    expect(inviteAfter.rows[0].used_count).toBe(1);
    const gone = await pool.query('SELECT id FROM registrations WHERE email = $1', [email]);
    expect(gone.rows).toHaveLength(0);
  });
});
