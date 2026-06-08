const createRateLimiter = require('../../src/middleware/rateLimit');

function makeReq(ip = '1.1.1.1') {
  return { ip };
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
  };
}

describe('rateLimit middleware', () => {
  it('passes through a single request', () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 100, now: () => 1_000_000 });
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    limiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBeNull();
  });

  it('returns 429 with Retry-After on the 101st request within the window', () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 100, now: () => 1_000_000 });
    const req = makeReq();

    for (let i = 0; i < 100; i++) {
      const res = makeRes();
      const next = jest.fn();
      limiter(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(200);
    }

    const res = makeRes();
    const next = jest.fn();
    limiter(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: 'Too many requests' });
    expect(res.headers['Retry-After']).toBeDefined();
    const retryAfter = parseInt(res.headers['Retry-After'], 10);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it('allows requests again after the window expires', () => {
    let clock = 1_000_000;
    const limiter = createRateLimiter({ windowMs: 60000, max: 100, now: () => clock });
    const req = makeReq();

    for (let i = 0; i < 100; i++) {
      limiter(req, makeRes(), jest.fn());
    }

    const blocked = makeRes();
    limiter(req, blocked, jest.fn());
    expect(blocked.statusCode).toBe(429);

    clock += 60_001;

    const after = makeRes();
    const next = jest.fn();
    limiter(req, after, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(after.statusCode).toBe(200);
  });

  it('tracks IPs independently', () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 100, now: () => 1_000_000 });
    const reqA = makeReq('1.1.1.1');
    const reqB = makeReq('2.2.2.2');

    for (let i = 0; i < 100; i++) {
      limiter(reqA, makeRes(), jest.fn());
    }

    const aBlocked = makeRes();
    limiter(reqA, aBlocked, jest.fn());
    expect(aBlocked.statusCode).toBe(429);

    const bRes = makeRes();
    const bNext = jest.fn();
    limiter(reqB, bRes, bNext);

    expect(bNext).toHaveBeenCalledTimes(1);
    expect(bRes.statusCode).toBe(200);
  });

  it('sweeps idle IPs from internal state', () => {
    let clock = 1_000_000;
    const limiter = createRateLimiter({
      windowMs: 60000,
      max: 100,
      now: () => clock,
      sweepEvery: 3,
    });

    limiter(makeReq('1.1.1.1'), makeRes(), jest.fn());
    limiter(makeReq('2.2.2.2'), makeRes(), jest.fn());
    expect(limiter._state.size).toBe(2);

    clock += 60_001;

    limiter(makeReq('3.3.3.3'), makeRes(), jest.fn());

    expect(limiter._state.has('3.3.3.3')).toBe(true);
    expect(limiter._state.has('1.1.1.1')).toBe(false);
    expect(limiter._state.has('2.2.2.2')).toBe(false);
  });
});
