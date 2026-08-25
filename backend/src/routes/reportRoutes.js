'use strict';
/**
 * Mount alongside the query routes:
 *   app.use('/api/reports', require('./routes/reportRoutes'));
 *
 * Report result sets are cached by the same store the query pages use, so
 * GET /api/query/:executionId/page/:n and .../export.csv work unchanged.
 */

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/reportController');

// ─── ADJUST: your existing auth middleware ──────────────────────────────────
const authenticate = require('./auth');
// ────────────────────────────────────────────────────────────────────────────

router.use(authenticate);
router.use(express.json({ limit: '64kb' }));

router.get('/', ctrl.list);
router.get('/runs', ctrl.runs);
router.get('/mail-test', ctrl.mailTest);
router.post('/:key/run', ctrl.run);
router.post('/:key/email', ctrl.email);

module.exports = router;
