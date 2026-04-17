process.env.API_KEY = 'test-key';
// Use a short window for tests so fake-timer advancement is small
process.env.RATE_LIMIT_WINDOW_MS = '60000';
process.env.RATE_LIMIT_MAX = '100';

const request = require('supertest');

// Load the store reset helper before loading the app so we can isolate tests
const { _resetStore } = require('../src/middleware/rateLimit');
const app = require('../src/index');

let server;

beforeAll(() => {
  jest.useFakeTimers();
  server = app.listen(0);
});

afterAll(() => {
  jest.useRealTimers();
  return new Promise(resolve => server.close(resolve));
});

beforeEach(() => {
  _resetStore();
  // Reset clock to a fixed point so each test starts fresh
  jest.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
});

describe('rate limiting middleware', () => {
  it('allows a normal request through', async () => {
    const res = await request(server)
      .get('/health')
      .set('X-API-Key', 'test-key');

    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBe('100');
    expect(res.headers['x-ratelimit-remaining']).toBe('99');
  });

  it('rejects the 101st request in the same window with HTTP 429', async () => {
    // Send 100 requests (all should succeed)
    for (let i = 0; i < 100; i++) {
      const res = await request(server)
        .get('/health')
        .set('X-API-Key', 'test-key');
      expect(res.status).toBe(200);
    }

    // The 101st request must be rejected
    const res = await request(server)
      .get('/health')
      .set('X-API-Key', 'test-key');

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'Too Many Requests' });
    expect(res.headers['retry-after']).toBeDefined();
    expect(parseInt(res.headers['retry-after'], 10)).toBeGreaterThan(0);
    expect(res.headers['x-ratelimit-remaining']).toBe('0');
  });

  it('allows requests again after the window resets', async () => {
    // Fill the window to the limit
    for (let i = 0; i < 100; i++) {
      await request(server)
        .get('/health')
        .set('X-API-Key', 'test-key');
    }

    // Confirm we are now rate-limited
    const before = await request(server)
      .get('/health')
      .set('X-API-Key', 'test-key');
    expect(before.status).toBe(429);

    // Advance time past the full window (60 seconds + 1 ms)
    jest.advanceTimersByTime(60001);

    // Should be allowed again
    const after = await request(server)
      .get('/health')
      .set('X-API-Key', 'test-key');
    expect(after.status).toBe(200);
    expect(after.headers['x-ratelimit-remaining']).toBe('99');
  });
});
