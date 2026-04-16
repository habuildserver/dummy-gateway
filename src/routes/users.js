const { Router } = require('express');
const axios = require('axios');
const config = require('../config');

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { data } = await axios.get(`${config.usersServiceUrl}/users`);
    res.json(data);
  } catch {
    res.status(502).json({ error: 'Users service unavailable' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { data } = await axios.post(`${config.usersServiceUrl}/users`, req.body);
    res.status(201).json(data);
  } catch {
    res.status(502).json({ error: 'Users service unavailable' });
  }
});

module.exports = router;
