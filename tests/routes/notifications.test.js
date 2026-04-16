process.env.API_KEY = 'test-key';
jest.mock('axios');
const request = require('supertest');
const axios = require('axios');
const app = require('../../src/index');
const KEY = 'test-key';

describe('POST /notifications/send', () => {
  it('proxies to notifications service', async () => {
    axios.post.mockResolvedValue({ data: { receipt_id: 'abc-123' } });
    const res = await request(app)
      .post('/notifications/send')
      .set('X-API-Key', KEY)
      .send({ user_id: '1', message: 'Hello' });
    expect(res.status).toBe(200);
    expect(res.body.receipt_id).toBe('abc-123');
  });

  it('returns 502 when notifications service is down', async () => {
    axios.post.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await request(app)
      .post('/notifications/send')
      .set('X-API-Key', KEY)
      .send({ user_id: '1', message: 'Hello' });
    expect(res.status).toBe(502);
  });
});
