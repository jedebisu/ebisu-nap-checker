// Registration / invitation-key / OTP / lockout suite.
// Uses the shared dev database (gmaps_demo); rows are suffixed per run and
// cleaned up afterwards. The email service is the Task 6 stub — tests inspect
// its module-scoped `sentEmails` log array for the OTPs and temp passwords.
//
// Note on the exhausted-key race group: the invite use is claimed exactly once
// — inside the verify-otp completion transaction
// (`UPDATE invite_codes ... WHERE used_count < max_uses`) — not at register
// time. Claiming at register time would double-count every completed
// registration and burn single-use keys on abandoned OTP attempts. So the
// race test fires two parallel *verify-otp* completions against one
// max_uses:1 key (both registrations were created while used_count was still
// 0); exactly one wins the atomic UPDATE.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-jwt-secret';

const request = require('supertest');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { app, pool } = require('../server');
const emailService = require('../services/email');

const _runSuffix = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
const mkEmail = (name) => `${name}+${_runSuffix}@test.com`;

// Track rows for cleanup.
const createdCodes = [];
const createdEmails = [];

const insertInvite = async ({ maxUses = 5, usedCount = 0, expiresAt = null } = {}) => {
  const code = `GMAPS-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  await pool.query(
    `INSERT INTO invite_codes (code, max_uses, used_count, expires_at) VALUES ($1, $2, $3, $4)`,
    [code, maxUses, usedCount, expiresAt]
  );
  createdCodes.push(code);
  return code;
};

const lastOtpFor = (email) => {
  const otpEmails = emailService.getSentEmails().filter((e) => e.type === 'otp' && e.to === email);
  return otpEmails.length ? otpEmails[otpEmails.length - 1].otp : null;
};

const tempPasswordFor = (email) => {
  const tempEmails = emailService.getSentEmails().filter((e) => e.type === 'temp-password' && e.to === email);
  return tempEmails.length ? tempEmails[tempEmails.length - 1].tempPassword : null;
};

const wrongOtpFor = (email) => (lastOtpFor(email) === '111111' ? '222222' : '111111');

const registerUser = async (email, inviteCode) => {
  createdEmails.push(email);
  return request(app).post('/api/auth/register').send({
    firstname: 'Reg',
    lastname: 'Test',
    email,
    phone: '09171234567',
    invite_code: inviteCode,
  });
};

const verifyOtp = (email, otp) =>
  request(app).post('/api/auth/verify-otp').send({ email, otp });

// Simulate the passage of a lockout window.
const expireLockout = (email) =>
  pool.query(`UPDATE registrations SET locked_until = NOW() - INTERVAL '1 minute' WHERE email = $1`, [email]);

const getRegistration = async (email) => {
  const result = await pool.query(`SELECT * FROM registrations WHERE email = $1`, [email]);
  return result.rows[0] || null;
};

describe('Registration, invitation keys, OTP + lockout', () => {
  beforeEach(() => {
    emailService.clearSentEmails();
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
        await client.query(
          `DELETE FROM invite_codes WHERE code = ANY($1::text[])`,
          [createdCodes]
        );
      }
    } finally {
      client.release();
    }
    await pool.end();
  }, 15000);

  describe('Group 1: register with unknown / exhausted / valid invite key', () => {
    it('returns 400 "Invalid invitation key" for an unknown code', async () => {
      const email = mkEmail('unknown');
      const res = await registerUser(email, 'GMAPS-DEADBEEF');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid invitation key' });
    });

    it('returns 400 "no uses remaining" for an exhausted key', async () => {
      const code = await insertInvite({ maxUses: 1, usedCount: 1 });
      const email = mkEmail('exhausted');
      const res = await registerUser(email, code);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/no uses remaining/i);
    });

    it('returns 400 for an expired key', async () => {
      const code = await insertInvite({ maxUses: 5, expiresAt: new Date(Date.now() - 60 * 1000) });
      const email = mkEmail('expired');
      const res = await registerUser(email, code);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/expired/i);
    });

    it('returns 400 when required fields are missing or email is malformed', async () => {
      const code = await insertInvite({ maxUses: 5 });
      const missing = await request(app).post('/api/auth/register').send({ firstname: 'Only' });
      expect(missing.status).toBe(400);
      const badEmail = await request(app).post('/api/auth/register').send({
        firstname: 'Bad', lastname: 'Email', email: 'not-an-email', phone: '0917', invite_code: code,
      });
      expect(badEmail.status).toBe(400);
      expect(badEmail.body.error).toMatch(/email format/i);
    });

    it('returns 200 and stores a registration row with otp_expires_at ~5 minutes out', async () => {
      const code = await insertInvite({ maxUses: 5 });
      const email = mkEmail('valid');
      const res = await registerUser(email, code);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, message: `OTP sent to ${email}` });

      const reg = await getRegistration(email);
      expect(reg).toBeTruthy();
      expect(reg.otp_fail_count).toBe(0);
      expect(reg.lockout_tier).toBe(0);
      expect(reg.locked_until).toBeNull();
      expect(reg.otp_hash).toBeTruthy();
      expect(reg.otp_hash).not.toMatch(/^\d{6}$/); // stored hashed, not plaintext

      const expiresAt = new Date(reg.otp_expires_at).getTime();
      const now = Date.now();
      expect(expiresAt).toBeGreaterThan(now + 4 * 60 * 1000);
      expect(expiresAt).toBeLessThan(now + 6 * 60 * 1000);

      // OTP was "sent" via the stub.
      expect(lastOtpFor(email)).toMatch(/^\d{6}$/);
    });
  });

  describe('Group 2: wrong-OTP escalation and lockout', () => {
    it('escalates 5 → 10 → 30 → 60 minutes at attempts 6, 7, 8, 9 (cap 60)', async () => {
      const code = await insertInvite({ maxUses: 10 });
      const email = mkEmail('escalation');
      const reg = await registerUser(email, code);
      expect(reg.status).toBe(200);

      // Attempts 1-5: plain 400, no lockout_minutes field.
      for (let attempt = 1; attempt <= 5; attempt++) {
        const res = await verifyOtp(email, wrongOtpFor(email));
        expect(res.status).toBe(400);
        expect(res.body.lockout_minutes).toBeUndefined();
      }

      // Attempt 6 → tier 0 (5 min).
      const sixth = await verifyOtp(email, wrongOtpFor(email));
      expect(sixth.status).toBe(400);
      expect(sixth.body.lockout_minutes).toBe(5);
      let row = await getRegistration(email);
      expect(row.otp_fail_count).toBe(6);
      expect(row.lockout_tier).toBe(0);
      expect(new Date(row.locked_until).getTime()).toBeGreaterThan(Date.now());

      // While locked, a further wrong OTP is refused WITHOUT incrementing the counter.
      const whileLocked = await verifyOtp(email, wrongOtpFor(email));
      expect(whileLocked.status).toBe(400);
      expect(whileLocked.body.lockout_minutes).toBeGreaterThanOrEqual(1);
      row = await getRegistration(email);
      expect(row.otp_fail_count).toBe(6);

      // Attempt 7 → tier 1 (10 min), after the lockout window passes.
      await expireLockout(email);
      const seventh = await verifyOtp(email, wrongOtpFor(email));
      expect(seventh.status).toBe(400);
      expect(seventh.body.lockout_minutes).toBe(10);
      row = await getRegistration(email);
      expect(row.otp_fail_count).toBe(7);
      expect(row.lockout_tier).toBe(1);

      // Attempt 8 → tier 2 (30 min).
      await expireLockout(email);
      const eighth = await verifyOtp(email, wrongOtpFor(email));
      expect(eighth.status).toBe(400);
      expect(eighth.body.lockout_minutes).toBe(30);
      row = await getRegistration(email);
      expect(row.lockout_tier).toBe(2);

      // Attempt 9 → tier 3 (60 min).
      await expireLockout(email);
      const ninth = await verifyOtp(email, wrongOtpFor(email));
      expect(ninth.status).toBe(400);
      expect(ninth.body.lockout_minutes).toBe(60);
      row = await getRegistration(email);
      expect(row.lockout_tier).toBe(3);

      // Attempt 10 → still tier 3 (60 min cap).
      await expireLockout(email);
      const tenth = await verifyOtp(email, wrongOtpFor(email));
      expect(tenth.status).toBe(400);
      expect(tenth.body.lockout_minutes).toBe(60);
      row = await getRegistration(email);
      expect(row.otp_fail_count).toBe(10);
      expect(row.lockout_tier).toBe(3);
    });
  });

  describe('Group 3: correct OTP completes registration', () => {
    it('creates the user, increments invite count, deletes the registration', async () => {
      const code = await insertInvite({ maxUses: 5 });
      const email = mkEmail('complete');
      const reg = await registerUser(email, code);
      expect(reg.status).toBe(200);

      // 2 wrong attempts first — fail counter rolls off on success.
      await verifyOtp(email, wrongOtpFor(email));
      await verifyOtp(email, wrongOtpFor(email));

      const otp = lastOtpFor(email);
      const res = await verifyOtp(email, otp);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, message: `Temporary password sent to ${email}` });

      // User created with must_change_password and a working temp password.
      const userResult = await pool.query(`SELECT * FROM users WHERE email = $1`, [email]);
      expect(userResult.rows).toHaveLength(1);
      const user = userResult.rows[0];
      expect(user.must_change_password).toBe(true);
      const tempPassword = tempPasswordFor(email);
      expect(tempPassword).toBeTruthy();
      expect(await bcrypt.compare(tempPassword, user.password_hash)).toBe(true);

      // Invite key consumed exactly once.
      const inviteResult = await pool.query(`SELECT used_count FROM invite_codes WHERE code = $1`, [code]);
      expect(inviteResult.rows[0].used_count).toBe(1);

      // Registration row deleted.
      expect(await getRegistration(email)).toBeNull();
    });

    it('rejects verify-otp for an unknown email', async () => {
      const res = await verifyOtp(mkEmail('ghost'), '123456');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid or expired/i);
    });
  });

  describe('Group 4: exhausted-key race (parallel requests)', () => {
    it('lets exactly one of two parallel completions win a fresh max_uses:1 key', async () => {
      const code = await insertInvite({ maxUses: 1, usedCount: 0 });
      const email1 = mkEmail('race1');
      const email2 = mkEmail('race2');

      // Both registers succeed while used_count is still 0.
      const reg1 = await registerUser(email1, code);
      const reg2 = await registerUser(email2, code);
      expect(reg1.status).toBe(200);
      expect(reg2.status).toBe(200);

      const otp1 = lastOtpFor(email1);
      const otp2 = lastOtpFor(email2);

      const results = await Promise.all([
        verifyOtp(email1, otp1),
        verifyOtp(email2, otp2),
      ]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 400]);

      const loser = results.find((r) => r.status === 400);
      expect(loser.body.error).toMatch(/no uses remaining/i);

      // Exactly one user created, key fully consumed, at most one registration left.
      const usersResult = await pool.query(
        `SELECT email FROM users WHERE email = ANY($1::text[])`,
        [[email1, email2]]
      );
      expect(usersResult.rows).toHaveLength(1);
      const inviteResult = await pool.query(`SELECT used_count FROM invite_codes WHERE code = $1`, [code]);
      expect(inviteResult.rows[0].used_count).toBe(1);
    });
  });

  describe('Group 5: resend-otp issues a new OTP that replaces the old one', () => {
    it('old code is rejected, new code verifies', async () => {
      const code = await insertInvite({ maxUses: 5 });
      const email = mkEmail('resend');
      const reg = await registerUser(email, code);
      expect(reg.status).toBe(200);
      const oldOtp = lastOtpFor(email);

      const resend = await request(app).post('/api/auth/resend-otp').send({ email });
      expect(resend.status).toBe(200);
      expect(resend.body.ok).toBe(true);

      const newOtp = lastOtpFor(email);
      expect(newOtp).toMatch(/^\d{6}$/);
      // With 1e-6 collision odds the OTPs could be equal; re-request if so.
      if (newOtp === oldOtp) {
        const again = await request(app).post('/api/auth/resend-otp').send({ email });
        expect(again.status).toBe(200);
      }
      const effectiveNewOtp = lastOtpFor(email);

      // Old code no longer works. If a resend happened to re-issue the same
      // OTP, fall back to a definitely-different wrong code instead.
      const staleAttemptOtp = oldOtp !== effectiveNewOtp
        ? oldOtp
        : (effectiveNewOtp === '111111' ? '222222' : '111111');
      const oldAttempt = await verifyOtp(email, staleAttemptOtp);
      expect(oldAttempt.status).toBe(400);

      // A fresh verification with the newest code succeeds.
      const newAttempt = await verifyOtp(email, effectiveNewOtp);
      expect(newAttempt.status).toBe(200);
    });

    it('returns 400 for an unknown email', async () => {
      const res = await request(app).post('/api/auth/resend-otp').send({ email: mkEmail('nobody') });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/no active registration/i);
    });
  });
});
