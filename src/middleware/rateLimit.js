const config = require('../config');

// Map of IP address -> array of request timestamps (ms) within the current window
const store = new Map();

function rateLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = config.rateLimitWindowMs;
  const max = config.rateLimitMax;

  // Retrieve or initialise the timestamp list for this IP
  let timestamps = store.get(ip) || [];

  // Prune timestamps outside the current window (sliding window)
  const windowStart = now - windowMs;
  timestamps = timestamps.filter(ts => ts > windowStart);

  if (timestamps.length >= max) {
    // Oldest timestamp in window; window resets after windowMs from that point
    const oldest = timestamps[0];
    const retryAfterMs = oldest + windowMs - now;
    const retryAfterSecs = Math.ceil(retryAfterMs / 1000);

    res.set('Retry-After', String(retryAfterSecs));
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', '0');
    return res.status(429).json({ error: 'Too Many Requests' });
  }

  // Record this request and continue
  timestamps.push(now);
  store.set(ip, timestamps);

  res.set('X-RateLimit-Limit', String(max));
  res.set('X-RateLimit-Remaining', String(max - timestamps.length));

  next();
}

// Exported for test isolation only — do not call in production code
function _resetStore() {
  store.clear();
}

module.exports = { rateLimit, _resetStore };
