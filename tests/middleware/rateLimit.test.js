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
});
