const express = require('express');
const auth = require('./middleware/auth');
const usersRouter = require('./routes/users');
const notificationsRouter = require('./routes/notifications');
const config = require('./config');

const app = express();
app.use(express.json());
app.use(auth);
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/users', usersRouter);
app.use('/notifications', notificationsRouter);

if (require.main === module) {
  app.listen(config.port, () => console.log(`Gateway on :${config.port}`));
}

module.exports = app;
