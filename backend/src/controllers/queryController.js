'use strict';
/**
 * BackupVault :: Query Execution Controller
 */

const queryService = require('../services/queryService');

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0].trim() : req.ip || req.connection?.remoteAddress || '').slice(0, 45);
}

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
  if (err && err.name === 'QueryError' || err instanceof queryService.QueryError) {
    return res.status(err.status || 400).json({ success: false, code: err.code, message: err.message });
  }
  console.error('[queryController]', err);
  return res.status(500).json({ success: false, code: 'INTERNAL', message: 'Query execution failed. Check the BackupVault logs.' });
}

/** GET /api/query/connections?environment=QA */
exports.listConnections = async (req, res) => {
  try {
    const env = req.query.environment;
    if (env && !['LIVE', 'QA'].includes(env)) {
      return res.status(400).json({ success: false, message: 'environment must be LIVE or QA.' });
    }
    const user = currentUser(req);
    let connections = await queryService.listConnections(env);
    if (!user.canQueryLive) connections = connections.filter((c) => c.environment !== 'LIVE');

    res.json({ success: true, connections, limits: queryService.constants });
  } catch (err) { fail(res, err); }
};

/** POST /api/query/execute  { connectionId, sql, database, pageSize, confirmLive } */
exports.execute = async (req, res) => {
  try {
    const { connectionId, sql, database, pageSize, confirmLive } = req.body || {};
    if (!connectionId) return res.status(400).json({ success: false, message: 'Select a target connection.' });

    const user = currentUser(req);
    if (!user.id) return res.status(401).json({ success: false, message: 'Not signed in.' });

    // Second gate for production — the UI sends this only after the confirm dialog
    const connections = await queryService.listConnections(null);
    const target = connections.find((c) => String(c.id) === String(connectionId));
    if (target && target.environment === 'LIVE' && confirmLive !== true) {
      return res.status(428).json({
        success: false, code: 'CONFIRM_REQUIRED',
        message: 'Confirm before running against LIVE.',
      });
    }

    const result = await queryService.execute({
      connectionId, sql, database, pageSize,
      user, clientIp: clientIp(req),
    });
    res.json({ success: true, ...result });
  } catch (err) { fail(res, err); }
};

/** GET /api/query/:executionId/page/:page?size=20 */
exports.getPage = async (req, res) => {
  try {
    const result = await queryService.getPage({
      executionId: req.params.executionId,
      page: req.params.page,
      pageSize: req.query.size,
      user: currentUser(req),
    });
    res.json({ success: true, ...result });
  } catch (err) { fail(res, err); }
};

/** GET /api/query/:executionId/export.csv */
exports.exportCsv = async (req, res) => {
  try {
    await queryService.streamCsv({
      executionId: req.params.executionId,
      user: currentUser(req),
      res,
    });
  } catch (err) {
    if (!res.headersSent) return fail(res, err);
    res.end();
  }
};

/** GET /api/query/history */
exports.history = async (req, res) => {
  try {
    const user = currentUser(req);
    if (!user.id) return res.status(401).json({ success: false, message: 'Not signed in.' });
    const rows = await queryService.getHistory({ user, limit: req.query.limit || 25 });
    res.json({ success: true, history: rows });
  } catch (err) { fail(res, err); }
};
