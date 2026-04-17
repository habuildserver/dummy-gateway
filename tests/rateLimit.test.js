process.env.API_KEY = 'test-key';
const express = require('express');
const request = require('supertest');
const createRateLimiter = require('../src/middleware/rateLimit');

function createApp(opts) {
  const app = express();
  const limiter = createRateLimiter(opts);
  app.use(limiter);
  app.get('/test', (_req, res) => res.json({ ok: true }));
  return { app, limiter };
}

describe('rate limiting middleware', () => {
  it('allows requests under the limit', async () => {
    const { app, limiter } = createApp({ windowMs: 60000, max: 3 });
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    limiter.destroy();
  });

  it('rejects requests over the limit with 429 and Retry-After', async () => {
    const { app, limiter } = createApp({ windowMs: 60000, max: 3 });
    // Send 3 allowed requests
    for (let i = 0; i < 3; i++) {
      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
    }
    // 4th request should be rejected
    const res = await request(app).get('/test');
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'Rate limit exceeded' });
    expect(res.headers['retry-after']).toBeDefined();
    const retryAfter = parseInt(res.headers['retry-after'], 10);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    limiter.destroy();
  });

  it('resets the window after the time period elapses', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const { app, limiter } = createApp({ windowMs: 60000, max: 3 });
    // Exhaust the limit
    for (let i = 0; i < 3; i++) {
      await request(app).get('/test');
    }
    // Verify blocked
    let res = await request(app).get('/test');
    expect(res.status).toBe(429);
    // Advance time past the window
    jest.advanceTimersByTime(60001);
    // Should be allowed again
    res = await request(app).get('/test');
    expect(res.status).toBe(200);
    limiter.destroy();
    jest.useRealTimers();
  });

  it('returns correct Retry-After seconds', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const { app, limiter } = createApp({ windowMs: 60000, max: 1 });
    await request(app).get('/test'); // uses up the limit
    jest.advanceTimersByTime(30000); // advance 30 seconds
    const res = await request(app).get('/test');
    expect(res.status).toBe(429);
    // Original request was at t=0, window is 60s, we're at t=30s → ~30s remaining
    const retryAfter = parseInt(res.headers['retry-after'], 10);
    expect(retryAfter).toBe(30);
    limiter.destroy();
    jest.useRealTimers();
  });

  it('tracks IPs independently', async () => {
    const app = express();
    app.set('trust proxy', true);
    const limiter = createRateLimiter({ windowMs: 60000, max: 1 });
    app.use(limiter);
    app.get('/test', (_req, res) => res.json({ ok: true }));

    // First IP exhausts limit
    let res = await request(app).get('/test').set('X-Forwarded-For', '1.1.1.1');
    expect(res.status).toBe(200);
    res = await request(app).get('/test').set('X-Forwarded-For', '1.1.1.1');
    expect(res.status).toBe(429);

    // Second IP is unaffected
    res = await request(app).get('/test').set('X-Forwarded-For', '2.2.2.2');
    expect(res.status).toBe(200);
    limiter.destroy();
  });

  it('returns error in standard JSON shape', async () => {
    const { app, limiter } = createApp({ windowMs: 60000, max: 1 });
    await request(app).get('/test');
    const res = await request(app).get('/test');
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'Rate limit exceeded' });
    expect(res.headers['content-type']).toMatch(/json/);
    limiter.destroy();
  });
});
