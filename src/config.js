require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  usersServiceUrl: process.env.USERS_SERVICE_URL || 'http://localhost:3001',
  notificationsServiceUrl: process.env.NOTIFICATIONS_SERVICE_URL || 'http://localhost:3002',
  apiKey: process.env.API_KEY || 'dev-secret',
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
};
