function createRateLimiter({ windowMs, max, now = Date.now, sweepEvery = 1000 }) {
  const state = new Map();

  function middleware(req, res, next) {
    const ip = req.ip || 'unknown';
    const t = now();
    const timestamps = state.get(ip) || [];

    if (timestamps.length >= max) {
      const oldest = timestamps[0];
      const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - t) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too many requests' });
    }

    timestamps.push(t);
    state.set(ip, timestamps);
    next();
  }

  middleware._state = state;
  return middleware;
}

module.exports = createRateLimiter;
