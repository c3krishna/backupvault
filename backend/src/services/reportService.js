'use strict';
/**
 * BackupVault :: Report Engine
 * ----------------------------
 * Runs saved, multi-step reports that span more than one database server —
 * something a single SQL statement cannot do.
 *
 * A definition declares its steps; the engine runs each step ONCE and joins
 * the results in Node. The daily call report is the reference case: call rows
 * come from ccaas_ai on one server, DID mappings from telecom on another.
 *
 * Why not the original per-row lookup: the shell version opened a fresh MySQL
 * connection to DB2 for every call row. At 8,000 calls/day that is 8,000
 * connections and handshakes. Here the mapping table is pulled once into a
 * Map and joined in memory — two connections total, and the runtime stops
 * depending on row count.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const queryService = require('../services/queryService');
const mailService = require('../services/mailService');

// ─── ADJUST: your existing BackupVault app DB pool ──────────────────────────
const __bvPool = require('../db/connection');
// BackupVault's pool wrapper resolves to rows directly; mysql2 resolves to
// [rows, fields]. Normalise so this service can destructure either shape.
const __bvNormalise = (r) => (Array.isArray(r) && Array.isArray(r[0]) ? r : [r || [], []]);
const appDb = { query: async (sql, params) => __bvNormalise(await __bvPool.query(sql, params)) };
// ────────────────────────────────────────────────────────────────────────────

const DEFINITIONS_DIR = process.env.REPORT_DEFINITIONS_DIR
  || path.join(__dirname, '..', '..', 'reports');

const { QueryError } = queryService;

/* ══════════════════════════════════════════════════════════════════════════
   1. Definitions
   ══════════════════════════════════════════════════════════════════════════ */

async function listDefinitions() {
  let files = [];
  try {
    files = (await fsp.readdir(DEFINITIONS_DIR)).filter((f) => f.endsWith('.json'));
  } catch (_) {
    return [];
  }
  const defs = [];
  for (const f of files) {
    try {
      const def = JSON.parse(await fsp.readFile(path.join(DEFINITIONS_DIR, f), 'utf8'));
      defs.push({
        key: def.key,
        name: def.name,
        description: def.description || '',
        params: def.params || [],
        email: { to: def.email?.to || [], subject: def.email?.subject || def.name },
        steps: (def.steps || []).map((s) => ({ id: s.id, connection: s.connection, type: s.type || 'rows' })),
      });
    } catch (err) {
      console.error(`[reportService] bad definition ${f}:`, err.message);
    }
  }
  return defs.sort((a, b) => a.name.localeCompare(b.name));
}

async function loadDefinition(key) {
  if (!/^[a-z0-9-_]+$/i.test(String(key))) throw new QueryError('Invalid report key.', 'NOT_FOUND', 404);
  const file = path.join(DEFINITIONS_DIR, `${key}.json`);
  let raw;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch (_) {
    throw new QueryError(`No report definition named "${key}".`, 'NOT_FOUND', 404);
  }
  const def = JSON.parse(raw);
  if (!def.steps || !def.steps.length) throw new QueryError(`Report "${key}" has no steps.`, 'CONFIG', 500);
  return def;
}

/* ══════════════════════════════════════════════════════════════════════════
   2. Parameters
   ══════════════════════════════════════════════════════════════════════════ */

function pad(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function resolveDateToken(token) {
  const d = new Date();
  if (token === 'today') return ymd(d);
  if (token === 'yesterday') { d.setDate(d.getDate() - 1); return ymd(d); }
  const m = /^-(\d+)d$/.exec(String(token));
  if (m) { d.setDate(d.getDate() - Number(m[1])); return ymd(d); }
  return token;
}

/**
 * Build the bound values for a report run. Derived values (fromTs/toTs) are
 * computed here so a definition never has to do date arithmetic in SQL.
 */
function resolveParams(def, supplied = {}) {
  const out = {};
  for (const p of def.params || []) {
    let v = supplied[p.name] !== undefined && supplied[p.name] !== '' ? supplied[p.name] : p.default;

    switch (p.type) {
      case 'date': {
        v = resolveDateToken(v);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new QueryError(`"${p.name}" must be a date (YYYY-MM-DD).`);
        break;
      }
      case 'int': {
        if (v === undefined || v === null || v === '') { v = null; break; }
        if (!/^-?\d+$/.test(String(v))) throw new QueryError(`"${p.name}" must be a whole number.`);
        v = Number(v);
        break;
      }
      default:
        v = v === undefined ? null : String(v);
    }

    if (p.required && (v === null || v === undefined)) throw new QueryError(`"${p.name}" is required.`);
    out[p.name] = v;

    // A date parameter also exposes <name>From / <name>To spanning that day,
    // so range filters stay sargable and can use the index on createdAt.
    if (p.type === 'date') {
      out[`${p.name}From`] = `${v} 00:00:00`;
      const next = new Date(`${v}T00:00:00`);
      next.setDate(next.getDate() + 1);
      out[`${p.name}To`] = `${ymd(next)} 00:00:00`;
      out[`${p.name}Compact`] = v.replace(/-/g, '');
    }
  }
  return out;
}

/** Convert :named placeholders to positional binds for the target engine. */
function bindNamed(sql, values, engine) {
  const params = [];
  let index = 0;
  const text = sql.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, name) => {
    if (!(name in values)) throw new QueryError(`Report references unknown parameter ":${name}".`, 'CONFIG', 500);
    params.push(values[name]);
    index += 1;
    return engine === 'postgres' ? `$${index}` : '?';
  });
  return { text, params };
}

function fillTemplate(str, values) {
  return String(str).replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (m, k) => (k in values ? values[k] : m));
}

/* ══════════════════════════════════════════════════════════════════════════
   3. Execution
   ══════════════════════════════════════════════════════════════════════════ */

function indexOfColumn(columns, name) {
  const i = columns.findIndex((c) => c.toLowerCase() === String(name).toLowerCase());
  if (i === -1) throw new QueryError(`Column "${name}" is not in the step output.`, 'CONFIG', 500);
  return i;
}

async function runReport({ key, params = {}, user, trigger = 'manual' }) {
  const def = await loadDefinition(key);
  const values = resolveParams(def, params);
  const executionId = crypto.randomUUID();
  const started = Date.now();

  const stepResults = {};
  const stepStats = [];

  for (const step of def.steps) {
    const meta = /^\d+$/.test(String(step.connection))
      ? await queryService.getConnectionMeta(step.connection)
      : await queryService.getConnectionByName(step.connection);

    const { text, params: bound } = bindNamed(step.sql, values, meta.engine);
    const res = await queryService.runOnConnection({
      connectionRef: step.connection,
      sql: text,
      params: bound,
      database: step.database,
    });

    if ((step.type || 'rows') === 'lookup') {
      // Pull the whole mapping table once, index it in memory.
      const keyIdx = indexOfColumn(res.columns, step.lookup.keyColumn);
      const valIdx = indexOfColumn(res.columns, step.lookup.valueColumn);
      const map = new Map();
      for (const row of res.rows) {
        const k = row[keyIdx] === null ? '' : String(row[keyIdx]).trim();
        if (k && !map.has(k)) map.set(k, row[valIdx]);   // first match wins, same as LIMIT 1
      }
      stepResults[step.id] = { kind: 'lookup', map };
      stepStats.push({ id: step.id, connection: res.connection, rows: res.rows.length, durationMs: res.durationMs });
    } else {
      stepResults[step.id] = { kind: 'rows', columns: res.columns, rows: res.rows, truncated: res.truncated };
      stepStats.push({
        id: step.id, connection: res.connection, rows: res.rows.length,
        durationMs: res.durationMs, truncated: res.truncated,
      });
    }
  }

  /* ── merge ──────────────────────────────────────────────────────────── */
  const mergeCfg = def.merge || { base: def.steps[0].id, enrich: [] };
  const base = stepResults[mergeCfg.base];
  if (!base || base.kind !== 'rows') throw new QueryError(`Base step "${mergeCfg.base}" produced no rows output.`, 'CONFIG', 500);

  const columns = [...base.columns];
  const enrichers = (mergeCfg.enrich || []).map((e) => {
    const src = stepResults[e.from];
    if (!src || src.kind !== 'lookup') throw new QueryError(`Enrich step "${e.from}" is not a lookup.`, 'CONFIG', 500);
    const idx = indexOfColumn(base.columns, e.matchOn);
    columns.push(e.as);
    return { map: src.map, idx, fallback: e.fallback ?? null };
  });

  const rows = base.rows.map((row) => {
    const out = row.slice();
    for (const e of enrichers) {
      const k = row[e.idx] === null ? '' : String(row[e.idx]).trim();
      out.push(e.map.has(k) ? e.map.get(k) : e.fallback);
    }
    return out;
  });

  const durationMs = Date.now() - started;

  /* ── cache in the same store the query pages read from ──────────────── */
  const meta = {
    executionId,
    userId: user?.id ?? 0,
    kind: 'report',
    reportKey: def.key,
    connectionName: def.name,
    environment: def.environment || 'LIVE',
    engine: 'multi',
    database: null,
    statementType: 'REPORT',
    sql: `-- ${def.name}\n-- steps: ${def.steps.map((s) => `${s.id}@${s.connection}`).join(', ')}`,
    totalRows: rows.length,
    truncated: Boolean(base.truncated),
    durationMs,
    maxRows: queryService.constants.MAX_ROWS,
    params: values,
    steps: stepStats,
    expiresAt: new Date(Date.now() + queryService.constants.CACHE_TTL_MS).toISOString(),
  };

  await queryService.writeCache(executionId, { meta, columns, rows });
  await recordRun({ executionId, def, values, user, trigger, rows: rows.length, durationMs, status: 'SUCCESS' });

  const pageSize = queryService.constants.DEFAULT_PAGE_SIZE;
  return {
    ...meta,
    columns,
    page: 1,
    pageSize,
    totalPages: Math.max(1, Math.ceil(rows.length / pageSize)),
    rows: rows.slice(0, pageSize),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   4. CSV + email
   ══════════════════════════════════════════════════════════════════════════ */

function buildCsv(columns, rows) {
  const cell = queryService.toCsvCell;
  const parts = ['\uFEFF', columns.map(cell).join(','), '\r\n'];
  for (const row of rows) parts.push(row.map(cell).join(','), '\r\n');
  return Buffer.from(parts.join(''), 'utf8');
}

/**
 * Email a previously-run report (or run it fresh) with the CSV attached.
 */
async function emailReport({ executionId, key, params, recipients, user, trigger = 'manual' }) {
  let payload;
  if (executionId) {
    payload = await queryService.readCache(executionId);
    if (payload.meta.userId !== (user?.id ?? 0) && !user?.isAdmin && trigger === 'manual') {
      throw new QueryError('These results belong to another user.', 'FORBIDDEN', 403);
    }
  } else {
    const run = await runReport({ key, params, user, trigger });
    payload = await queryService.readCache(run.executionId);
  }

  const def = await loadDefinition(payload.meta.reportKey || key);
  const values = payload.meta.params || resolveParams(def, params);

  const to = (recipients && recipients.length ? recipients : def.email?.to || [])
    .map((r) => String(r).trim())
    .filter(Boolean);
  if (!to.length) throw new QueryError('Add at least one recipient.', 'CONFIG', 400);

  const filename = fillTemplate(def.email?.attachAs || `${def.key}-{{reportDateCompact}}.csv`, values);
  const subject = fillTemplate(def.email?.subject || def.name, values);
  const csv = buildCsv(payload.columns, payload.rows);

  const bodyValues = {
    ...values,
    rowCount: payload.meta.totalRows.toLocaleString(),
    generatedAt: new Date().toLocaleString(),
  };
  const text = fillTemplate(
    def.email?.body
      || 'Hi,\n\nPlease find attached the {{reportName}} for {{reportDate}}.\n\nRows: {{rowCount}}\nGenerated: {{generatedAt}}\n\nRegards,\nBackupVault Automation',
    { ...bodyValues, reportName: def.name }
  );

  const info = await mailService.sendReport({
    to,
    cc: def.email?.cc || [],
    subject,
    text,
    attachment: { filename, content: csv },
  });

  await appDb.query(
    'UPDATE report_runs SET emailed_to = ?, emailed_at = CURRENT_TIMESTAMP WHERE execution_id = ?',
    [to.join(', '), payload.meta.executionId]
  ).catch(() => {});

  return {
    executionId: payload.meta.executionId,
    to,
    filename,
    bytes: csv.length,
    rowCount: payload.meta.totalRows,
    messageId: info?.messageId || null,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   5. Run history
   ══════════════════════════════════════════════════════════════════════════ */

async function recordRun({ executionId, def, values, user, trigger, rows, durationMs, status, error }) {
  try {
    await appDb.query(
      `INSERT INTO report_runs
         (execution_id, report_key, report_name, params_json, trigger_type,
          user_id, username, row_count, duration_ms, status, error_text)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [executionId, def.key, def.name, JSON.stringify(values), trigger,
       user?.id ?? 0, user?.username ?? 'system', rows || 0, durationMs || 0, status, error || null]
    );
  } catch (err) {
    console.error('[reportService] run log failed:', err.message);
  }
}

async function listRuns({ key, limit = 25 }) {
  const params = [];
  let where = '1=1';
  if (key) { where += ' AND report_key = ?'; params.push(key); }
  params.push(Number(limit));
  const [rows] = await appDb.query(
    `SELECT execution_id, report_key, report_name, trigger_type, username,
            row_count, duration_ms, status, emailed_to, emailed_at, created_at
       FROM report_runs WHERE ${where} ORDER BY id DESC LIMIT ?`,
    params
  );
  return rows;
}

module.exports = {
  listDefinitions,
  loadDefinition,
  runReport,
  emailReport,
  listRuns,
  buildCsv,
  resolveParams,
  DEFINITIONS_DIR,
};
