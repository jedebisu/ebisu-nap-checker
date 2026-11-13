// Focused test for the per-IP login rate limiter (5 attempts/min by default).
// Uses a unique X-Forwarded-For IP so the probe never shares a bucket with
// other tests (the app trusts the first proxy hop) and needs no fixtures:
// failed logins against an unknown email never reach bcrypt or the DB.
// Must be set before ../server is loaded (the limiter reads it at require time).
process.env.AUTH_LOGIN_RATE_LIMIT_MAX = '5';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-jwt-secret';

const request = require('supertest');
const { app, pool } = require('../server');

describe('Login rate limiter', () => {
  afterAll(async () => {
    await pool.end();
  }, 15000);

  it('returns 429 on the 6th rapid failed login from the same IP', async () => {
    const ip = '203.0.113.77'; // TEST-NET-3 (RFC 5737), unique to this probe

    for (let attempt = 1; attempt <= 5; attempt++) {
      const res = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: 'rate-limit-probe@example.com', password: 'WrongPass1!' });
      expect(res.status).toBe(401);
    }

    const sixth = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: 'rate-limit-probe@example.com', password: 'WrongPass1!' });
    expect(sixth.status).toBe(429);
    expect(sixth.body).toEqual({ error: 'Too many login attempts. Try again in 1 minute.' });
  });
});
