'use strict';

const express = require('express');
const router = express.Router();
const { auth, requireRole } = require('./auth');
const incremental = require('../services/incrementalService');

router.use(auth);

router.get('/incremental/jobs', async (req, res) => {
  try {
    res.json({ jobs: await incremental.listJobs(), runEnabled: incremental.runAllowed() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/incremental/jobs/:id/log', async (req, res) => {
  try {
    const tail = parseInt(req.query.tail, 10) || 200;
    const log = await incremental.getLog(req.params.id, tail);
    if (!log) return res.status(404).json({ error: 'Unknown job' });
    res.json(log);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/incremental/jobs/:id/run', requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const started = await incremental.runJob(req.params.id);
    res.json({ success: true, ...started });
  } catch (e) {
    const status = /disabled|Unknown|not found/i.test(e.message) ? 400 : 500;
    res.status(status).json({ error: e.message });
  }
});

module.exports = router;
