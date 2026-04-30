process.env.API_KEY = 'test-key';
jest.mock('axios');
const request = require('supertest');
const axios = require('axios');
const app = require('../src/index');

let server;
beforeAll(() => { server = app.listen(0); });
afterAll(() => new Promise(resolve => server.close(resolve)));

describe('auth middleware', () => {
  it('returns 401 when X-API-Key header is missing on a protected route', async () => {
    const res = await request(server).get('/users');
    expect(res.status).toBe(401);
  });

  it('returns 401 when X-API-Key is wrong on a protected route', async () => {
    const res = await request(server).get('/users').set('X-API-Key', 'wrong');
    expect(res.status).toBe(401);
  });

  it('passes through with correct X-API-Key', async () => {
    axios.get.mockResolvedValue({ data: [] });
    const res = await request(server).get('/users').set('X-API-Key', 'test-key');
    expect(res.status).toBe(200);
  });
});

describe('/health endpoint', () => {
  it('is publicly accessible without an API key', async () => {
    const res = await request(server).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
