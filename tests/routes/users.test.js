process.env.API_KEY = 'test-key';
jest.mock('axios');
const request = require('supertest');
const axios = require('axios');
const app = require('../../src/index');
const KEY = 'test-key';

describe('GET /users', () => {
  it('proxies to users service', async () => {
    axios.get.mockResolvedValue({ data: [{ id: '1', name: 'Alice' }] });
    const res = await request(app).get('/users').set('X-API-Key', KEY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: '1', name: 'Alice' }]);
  });

  it('returns 502 when users service is down', async () => {
    axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await request(app).get('/users').set('X-API-Key', KEY);
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Users service unavailable');
  });
});

describe('POST /users', () => {
  it('proxies POST and returns 201', async () => {
    axios.post.mockResolvedValue({ data: { id: '2', name: 'Bob' } });
    const res = await request(app)
      .post('/users')
      .set('X-API-Key', KEY)
      .send({ name: 'Bob', email: 'bob@example.com' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Bob');
  });
});
