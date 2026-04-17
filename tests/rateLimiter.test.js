'use strict';

process.env.API_KEY = 'test-key';

const request = require('supertest');
const express = require('express');
const createRateLimiter = require('../src/middleware/rateLimiter');

const LIMIT = 5;
const WINDOW_MS = 1000;

describe('rateLimiter middleware', () => {
  let app;
  let server;
  let rateLimiter;

  beforeEach(done => {
    rateLimiter = createRateLimiter({ limit: LIMIT, windowMs: WINDOW_MS });
    app = express();
    app.use(rateLimiter);
    app.get('/test', (_req, res) => res.json({ ok: true }));
    server = app.listen(0, done);
  });

  afterEach(async () => {
    clearInterval(rateLimiter.cleanup);
    await new Promise(resolve => server.close(resolve));
    jest.useRealTimers();
  });

  it('allows requests under the limit', async () => {
    for (let i = 0; i < LIMIT; i++) {
      const res = await request(server).get('/test');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    }
  });

  it('returns 429 with error body and Retry-After header when limit is exceeded', async () => {
    // Exhaust the limit
    for (let i = 0; i < LIMIT; i++) {
      await request(server).get('/test');
    }

    const res = await request(server).get('/test');
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'Rate limit exceeded' });
    expect(res.headers['retry-after']).toBeDefined();
    const retryAfter = parseInt(res.headers['retry-after'], 10);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(Math.ceil(WINDOW_MS / 1000));
  });

  it('allows requests again after the window resets', async () => {
    jest.useFakeTimers();

    // Exhaust the limit
    for (let i = 0; i < LIMIT; i++) {
      const res = await request(server).get('/test');
      expect(res.status).toBe(200);
    }

    // Next request should be blocked
    const blocked = await request(server).get('/test');
    expect(blocked.status).toBe(429);

    // Advance time past the window so all recorded timestamps expire
    jest.advanceTimersByTime(WINDOW_MS + 100);

    // Should now be allowed again
    const allowed = await request(server).get('/test');
    expect(allowed.status).toBe(200);
    expect(allowed.body).toEqual({ ok: true });
  });
});
