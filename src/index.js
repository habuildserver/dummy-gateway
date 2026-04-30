const express = require('express');
const auth = require('./middleware/auth');
const createRateLimiter = require('./middleware/rateLimit');
const usersRouter = require('./routes/users');
const notificationsRouter = require('./routes/notifications');
const config = require('./config');

const app = express();
app.use(express.json());

// Public — registered before the rate limiter so load-balancer health
// polls do not consume the per-IP budget, and before auth so no API key
// is required.
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use(createRateLimiter(config.rateLimit));
app.use(auth);
app.use('/users', usersRouter);
app.use('/notifications', notificationsRouter);

if (require.main === module) {
  app.listen(config.port, () => console.log(`Gateway on :${config.port}`));
}

module.exports = app;
