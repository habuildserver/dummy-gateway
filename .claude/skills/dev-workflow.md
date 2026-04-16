# dev-workflow

```bash
npm install
cp .env.example .env
# Edit .env: set API_KEY, USERS_SERVICE_URL, NOTIFICATIONS_SERVICE_URL
npm start

# Health check (replace <key> with your API_KEY value)
curl -H "X-API-Key: <key>" http://localhost:3000/health
```
