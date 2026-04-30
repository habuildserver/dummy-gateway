const express = require('express');
const request = require('supertest');
const createRateLimiter = require('../src/middleware/rateLimit');

function makeApp({ limit, windowMs, now }) {
  const app = express();
  app.use(createRateLimiter({ limit, windowMs, now }));
  app.get('/test', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('rateLimit middleware', () => {
  it('allows a request under the limit through', async () => {
    const now = () => 1_700_000_000_000;
    const app = makeApp({ limit: 100, windowMs: 60_000, now });
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
