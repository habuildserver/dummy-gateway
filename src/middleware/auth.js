const config = require('../config');

function authMiddleware(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== config.apiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = authMiddleware;
