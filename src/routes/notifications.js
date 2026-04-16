const { Router } = require('express');
const axios = require('axios');
const config = require('../config');

const router = Router();

router.post('/send', async (req, res) => {
  try {
    const { data } = await axios.post(`${config.notificationsServiceUrl}/send`, req.body);
    res.json(data);
  } catch {
    res.status(502).json({ error: 'Notifications service unavailable' });
  }
});

module.exports = router;
