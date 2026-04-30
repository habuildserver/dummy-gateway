function createRateLimiter({ limit, windowMs, now = Date.now }) {
  const buckets = new Map();
  return function rateLimit(req, res, next) {
    const ip = req.ip;
    const t = now();
    const cutoff = t - windowMs;
    const prev = buckets.get(ip) || [];
    const recent = prev.filter((ts) => ts > cutoff);
    if (recent.length >= limit) {
      const oldest = recent[0];
      const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - t) / 1000));
      res.set('Retry-After', String(retryAfter));
      buckets.set(ip, recent);
      return res.status(429).json({ error: 'Too Many Requests' });
    }
    recent.push(t);
    buckets.set(ip, recent);
    return next();
  };
}

module.exports = createRateLimiter;
