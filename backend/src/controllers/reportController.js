'use strict';
/**
 * BackupVault :: Report Controller
 */

const reportService = require('../services/reportService');
const queryService = require('../services/queryService');

function currentUser(req) {
  const u = req.user || {};
  // Auth middlewares vary in what they put on req.user — accept the usual names.
  const id = u.id ?? u.userId ?? u.user_id ?? u.uid ?? u.sub ?? (function () {
    for (const k of Object.keys(u)) {
      if (/(^|_)id$|Id$|ID$/.test(k)) {
        const v = u[k];
        if (typeof v === "number" || /^\d+$/.test(String(v))) return Number(v);
      }
    }
    return null;
  })();
  if (process.env.DEBUG_USER) console.log("[req.user keys]", Object.keys(u), JSON.stringify(u));
  const role = String(u.role || u.user_role || u.roleName || '').toLowerCase().replace(/[\s-]/g, '_');
  const isAdmin = Boolean(u.is_admin) || ['admin', 'super_admin', 'superadmin', 'owner'].includes(role);

  return {
    id,
    username: u.username || u.email || u.name || null,
    // Explicit column wins; a super admin implicitly has both.
    canQueryQa: Boolean(u.can_query_qa ?? u.canQueryQa) || isAdmin,
    canQueryLive: Boolean(u.can_query_live ?? u.canQueryLive) || isAdmin,
    isAdmin,
  };
}

function fail(res, err) {
  if (err instanceof queryService.QueryError) {
    return res.status(err.status || 400).json({ success: false, code: err.code, message: err.message });
  }
  console.error('[reportController]', err);
  return res.status(500).json({ success: false, message: err.message || 'Report failed. Check the BackupVault logs.' });
}

/** GET /api/reports */
exports.list = async (req, res) => {
  try {
    res.json({ success: true, reports: await reportService.listDefinitions() });
  } catch (err) { fail(res, err); }
};

/** POST /api/reports/:key/run   { params: {...} } */
exports.run = async (req, res) => {
  try {
    const user = currentUser(req);
    if (!user.id) return res.status(401).json({ success: false, message: 'Not signed in.' });

    const def = await reportService.loadDefinition(req.params.key);
    if ((def.environment || 'LIVE') === 'LIVE' && !user.canQueryLive) {
      return res.status(403).json({ success: false, message: 'You do not have permission to run LIVE reports.' });
    }

    const result = await reportService.runReport({
      key: req.params.key,
      params: (req.body && req.body.params) || {},
      user,
      trigger: 'manual',
    });
    res.json({ success: true, ...result });
  } catch (err) { fail(res, err); }
};

/**
 * POST /api/reports/:key/email
 * { executionId?, params?, recipients?: [] }
 * With executionId it mails the rows already on screen; without, it runs fresh.
 */
exports.email = async (req, res) => {
  try {
    const user = currentUser(req);
    const { executionId, params, recipients } = req.body || {};
    const out = await reportService.emailReport({
      executionId, key: req.params.key, params, recipients, user, trigger: 'manual',
    });
    res.json({ success: true, ...out });
  } catch (err) { fail(res, err); }
};

/** GET /api/reports/runs?key=&limit= */
exports.runs = async (req, res) => {
  try {
    const rows = await reportService.listRuns({ key: req.query.key, limit: req.query.limit || 25 });
    res.json({ success: true, runs: rows });
  } catch (err) { fail(res, err); }
};

/** GET /api/reports/mail-test — verifies SMTP without sending */
exports.mailTest = async (req, res) => {
  try {
    await require('../services/mailService').verify();
    res.json({ success: true, message: 'SMTP connection is good.' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};
