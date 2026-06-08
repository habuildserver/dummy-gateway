function createRateLimiter({ windowMs, max, now = Date.now, sweepEvery = 1000 }) {
  function middleware(req, res, next) {
    next();
  }
  return middleware;
}

module.exports = createRateLimiter;
