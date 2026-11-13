process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-jwt-secret';

const request = require('supertest');
const { app, pool } = require('../server');

describe('GET /api/health', () => {
  afterAll(async () => {
    await pool.end();
  }, 15000);

  it('returns 200 and ok:true', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
