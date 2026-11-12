// The app never talks to the Render API directly: these proxies require an
// app-scoped JWT and pass the request through read-only. No network in tests —
// global fetch is mocked.
process.env.JWT_SECRET = 'test-secret';
process.env.RENDER_API_URL = 'https://upstream.test';

const request = require('supertest');
const app = require('../src/app');
const { signAuthToken, signResetToken } = require('../src/services/tokens');

const appToken = signAuthToken({ id: 7 });
const resetToken = signResetToken({ id: 7, token_version: 0 });

const stats = {
  total_naps: '55000',
  full_naps: '1000',
  warning_naps: '2000',
  available_naps: '52000',
  last_data_update: '2026-11-10T02:00:00Z',
  nap_report_date: '2026-11-10',
};

const nearest = {
  count: 1,
  radius_km: '1',
  naps: [
    {
      nap_id: 'NAP-0001',
      dp_nap_lat: '10.3',
      dp_nap_long: '123.9',
      marker_color: 'green',
      distance_km: 0.4,
    },
  ],
};

afterEach(() => {
  delete global.fetch;
});

function mockFetch(impl) {
  global.fetch = jest.fn(impl);
}

test('no token is rejected', async () => {
  mockFetch(async () => ({ ok: true, json: async () => stats }));
  const res = await request(app).get('/api/naps/stats/summary');
  expect(res.status).toBe(401);
});

test('a password_reset token cannot access NAP data', async () => {
  mockFetch(async () => ({ ok: true, json: async () => stats }));
  const res = await request(app)
    .get('/api/naps/stats/summary')
    .set('Authorization', `Bearer ${resetToken}`);
  expect(res.status).toBe(401);
});

test('stats are forwarded from the upstream API', async () => {
  mockFetch(async () => ({ ok: true, json: async () => stats }));
  const res = await request(app)
    .get('/api/naps/stats/summary')
    .set('Authorization', `Bearer ${appToken}`);

  expect(res.status).toBe(200);
  expect(res.body.nap_report_date).toBe('2026-11-10');
  const [url] = global.fetch.mock.calls[0];
  expect(url).toBe('https://upstream.test/api/naps/stats/summary');
});

test('nearest forwards lat/lng/radius/limit and returns naps', async () => {
  mockFetch(async () => ({ ok: true, json: async () => nearest }));
  const res = await request(app)
    .get('/api/naps/nearest?lat=10.3&lng=123.9&radius=2&limit=50')
    .set('Authorization', `Bearer ${appToken}`);

  expect(res.status).toBe(200);
  expect(res.body.naps[0].nap_id).toBe('NAP-0001');
  const [url] = global.fetch.mock.calls[0];
  expect(url).toContain('/api/naps/nearest?');
  expect(url).toContain('lat=10.3');
  expect(url).toContain('radius=2');
});

test('search forwards the query string', async () => {
  mockFetch(async () => ({ ok: true, json: async () => ({ count: 0, naps: [] }) }));
  const res = await request(app)
    .get('/api/naps/search?q=Cebu&limit=10')
    .set('Authorization', `Bearer ${appToken}`);

  expect(res.status).toBe(200);
  expect(global.fetch.mock.calls[0][0]).toContain('q=Cebu');
});

test('a single NAP detail is proxied', async () => {
  mockFetch(async () => ({ ok: true, json: async () => ({ nap_id: 'NAP-0001' }) }));
  const res = await request(app)
    .get('/api/naps/NAP-0001')
    .set('Authorization', `Bearer ${appToken}`);

  expect(res.status).toBe(200);
  expect(res.body.nap_id).toBe('NAP-0001');
  expect(global.fetch.mock.calls[0][0]).toBe('https://upstream.test/api/naps/NAP-0001');
});

test('upstream failure becomes a 502', async () => {
  mockFetch(async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }));
  const res = await request(app)
    .get('/api/naps/stats/summary')
    .set('Authorization', `Bearer ${appToken}`);
  expect(res.status).toBe(502);
  expect(res.body.error).toBe('NAP_SERVICE_UNAVAILABLE');
});

test('upstream network error becomes a 502', async () => {
  mockFetch(async () => {
    throw new Error('ECONNREFUSED');
  });
  const res = await request(app)
    .get('/api/naps/nearest?lat=1&lng=2')
    .set('Authorization', `Bearer ${appToken}`);
  expect(res.status).toBe(502);
});
