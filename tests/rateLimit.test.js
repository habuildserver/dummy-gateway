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

  it('rejects the 101st request in a window with 429 + Retry-After', async () => {
    const now = () => 1_700_000_000_000;
    const app = makeApp({ limit: 100, windowMs: 60_000, now });

    for (let i = 0; i < 100; i++) {
      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
    }

    const res = await request(app).get('/test');
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'Too Many Requests' });
    expect(res.headers['retry-after']).toMatch(/^\d+$/);
    const seconds = Number(res.headers['retry-after']);
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(60);
  });

  it('allows requests again after the window slides past', async () => {
    let t = 1_700_000_000_000;
    const now = () => t;
    const app = makeApp({ limit: 100, windowMs: 60_000, now });

    for (let i = 0; i < 100; i++) {
      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
    }

    let res = await request(app).get('/test');
    expect(res.status).toBe(429);

    t += 60_001; // advance past the window

    res = await request(app).get('/test');
    expect(res.status).toBe(200);
  });
});
