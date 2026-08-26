'use strict';

const express = require('express');
const router = express.Router();
const { auth, requireRole } = require('./auth');
const incremental = require('../services/incrementalService');

router.use(auth);

router.get('/incremental/jobs', async (req, res) => {
  try {
    const { jobs, meta } = await incremental.listJobs();
    res.json({ jobs, runEnabled: meta.runEnabled, ...meta });
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

router.post('/incremental/jobs/run-all', requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const started = incremental.startCycleInBackground('manual');
    if (started.skipped) return res.status(409).json({ error: started.reason });
    res.json({ success: true, ...started });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/incremental/jobs/:id/run', requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const started = await incremental.runJob(req.params.id, { wait: false });
    res.json({ success: true, ...started });
  } catch (e) {
    const status = /disabled|Unknown|not found/i.test(e.message) ? 400 : 500;
    res.status(status).json({ error: e.message });
  }
});

module.exports = router;
