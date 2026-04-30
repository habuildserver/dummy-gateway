function createRateLimiter(_options) {
  // _options will be { limit, windowMs, now } — destructured and used in Task 3.
  return function rateLimit(_req, _res, next) {
    return next();
  };
}

module.exports = createRateLimiter;
