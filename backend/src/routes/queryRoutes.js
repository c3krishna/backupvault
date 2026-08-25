'use strict';
/**
 * BackupVault :: Query Execution routes
 *
 * Mount in your app entrypoint:
 *   const queryRoutes = require('./routes/queryRoutes');
 *   app.use('/api/query', queryRoutes);
 */

const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/queryController');
const queryService = require('../services/queryService');

// ─── ADJUST: your existing auth middleware ──────────────────────────────────
const authenticate = require('./auth');
// ────────────────────────────────────────────────────────────────────────────

// Lightweight per-user throttle: 30 executions / minute. Prevents someone
// hammering a production replica with expensive scans.
const buckets = new Map();
function throttle(req, res, next) {
  const key = req.user?.id || req.ip;
  const now = Date.now();
  const b = buckets.get(key) || { count: 0, reset: now + 60000 };
  if (now > b.reset) { b.count = 0; b.reset = now + 60000; }
  b.count += 1;
  buckets.set(key, b);
  if (b.count > 30) {
    return res.status(429).json({ success: false, message: 'Too many queries. Wait a minute and try again.' });
  }
  next();
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k);
}, 60000).unref();

router.use(authenticate);

router.get('/connections', ctrl.listConnections);
router.post('/execute', throttle, express.json({ limit: '256kb' }), ctrl.execute);
router.get('/history', ctrl.history);
router.get('/:executionId/page/:page', ctrl.getPage);
router.get('/:executionId/export.csv', ctrl.exportCsv);

// Start the cache sweeper once, when the routes are mounted.
queryService.startCacheSweeper();

module.exports = router;
