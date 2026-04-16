process.env.API_KEY = 'test-key';
const request = require('supertest');
const app = require('../src/index');

let server;
beforeAll(() => { server = app.listen(0); });
afterAll(() => new Promise(resolve => server.close(resolve)));

describe('auth middleware', () => {
  it('returns 401 when X-API-Key header is missing', async () => {
    const res = await request(server).get('/health');
    expect(res.status).toBe(401);
  });

  it('returns 401 when X-API-Key is wrong', async () => {
    const res = await request(server).get('/health').set('X-API-Key', 'wrong');
    expect(res.status).toBe(401);
  });

  it('passes through with correct X-API-Key', async () => {
    const res = await request(server).get('/health').set('X-API-Key', 'test-key');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
