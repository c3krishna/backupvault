'use strict';
/**
 * BackupVault :: Query Execution Service
 * --------------------------------------
 * Runs read-only ad-hoc SQL / stored procedures against registered target
 * databases, caches the full result set on disk, and serves it back page by
 * page so a page-2 click never re-executes the query.
 *
 * Design notes:
 *   - Row cap is enforced DURING the fetch (mysql2 stream / PG cursor), so a
 *     50-million-row SELECT never lands in Node's heap.
 *   - Every statement is masked (string literals + comments blanked) before
 *     validation, so a `;` or `DROP` inside a string can't fool the parser.
 *   - Cache files are the source of truth; PM2 cluster mode and restarts are
 *     therefore safe. An in-process memo just avoids re-reading hot files.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

// pg is loaded on first PostgreSQL use, not at import time — BackupVault
// restores PostgreSQL through the psql CLI, so the driver may not be
// installed. A missing pg must not break MySQL/MariaDB targets.
let PgClientCtor = null;
function getPgClient() {
  if (!PgClientCtor) {
    try {
      PgClientCtor = require('pg').Client;
    } catch (_) {
      throw new QueryError(
        'PostgreSQL targets need the "pg" package. Run: npm install pg',
        'CONFIG', 500
      );
    }
  }
  return PgClientCtor;
}

// ─── ADJUST: your existing BackupVault app DB pool ──────────────────────────
// Must expose .query(sql, params) -> [rows, fields]  (mysql2/promise style).
const __bvPool = require('../db/connection');
// BackupVault's pool wrapper resolves to rows directly; mysql2 resolves to
// [rows, fields]. Normalise so this service can destructure either shape.
const __bvNormalise = (r) => (Array.isArray(r) && Array.isArray(r[0]) ? r : [r || [], []]);
const appDb = { query: async (sql, params) => __bvNormalise(await __bvPool.query(sql, params)) };
// ────────────────────────────────────────────────────────────────────────────

const CACHE_DIR      = process.env.QUERY_CACHE_DIR || '/var/www/backupvault/backend/tmp/query-results';
const CACHE_TTL_MS   = Number(process.env.QUERY_CACHE_TTL_MIN || 15) * 60 * 1000;
const MAX_ROWS       = Number(process.env.QUERY_MAX_ROWS      || 50000);
const QUERY_TIMEOUT  = Number(process.env.QUERY_TIMEOUT_MS    || 30000);
const CONNECT_TIMEOUT = 10000;
const DEFAULT_PAGE_SIZE = 20;
const ALLOWED_PAGE_SIZES = [20, 50, 100];

const ALLOWED_STATEMENTS = new Set(['SELECT', 'WITH', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'CALL']);

// Things a SELECT can still do that we never want.
const DENY_PATTERNS = [
  { re: /\binto\s+(outfile|dumpfile)\b/i,  msg: 'SELECT ... INTO OUTFILE/DUMPFILE is not permitted' },
  { re: /\bload_file\s*\(/i,               msg: 'LOAD_FILE() is not permitted' },
  { re: /\bpg_read_(file|binary_file)\s*\(/i, msg: 'pg_read_file() is not permitted' },
  { re: /\bpg_ls_dir\s*\(/i,               msg: 'pg_ls_dir() is not permitted' },
  { re: /\blo_(import|export)\s*\(/i,      msg: 'Large-object import/export is not permitted' },
  { re: /\bcopy\b[\s\S]*\bto\s+program\b/i, msg: 'COPY ... TO PROGRAM is not permitted' },
  { re: /\binto\s+(dumpfile)\b/i,          msg: 'SELECT ... INTO DUMPFILE is not permitted' },
];

class QueryError extends Error {
  constructor(message, code = 'BLOCKED', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   1. SQL sanitising / validation
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Blank out string literals and strip comments, preserving overall shape.
 * The result is ONLY used for validation — the original SQL is what executes.
 */
function maskSql(sql) {
  let out = '';
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const c = sql[i];
    const c2 = sql[i + 1];

    // Quoted string / identifier -> blank the contents, keep the quotes
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      out += q;
      i++;
      while (i < n) {
        if (sql[i] === '\\' && q !== '`') { out += '  '; i += 2; continue; }
        if (sql[i] === q) {
          if (sql[i + 1] === q) { out += '  '; i += 2; continue; }  // '' escape
          break;
        }
        out += ' ';
        i++;
      }
      out += q;
      i++;
      continue;
    }

    // Dollar-quoted string (PostgreSQL):  $tag$ ... $tag$
    if (c === '$') {
      const m = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end === -1 ? n : end + tag.length;
        out += ' '.repeat(stop - i);
        i = stop;
        continue;
      }
    }

    // -- line comment  /  # line comment (MySQL)
    if ((c === '-' && c2 === '-') || c === '#') {
      while (i < n && sql[i] !== '\n') { out += ' '; i++; }
      continue;
    }

    // /* block comment */
    if (c === '/' && c2 === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += ' '.repeat(stop - i);
      i = stop;
      continue;
    }

    out += c;
    i++;
  }
  return out;
}

/**
 * Validate and normalise a submitted statement.
 * @returns {{ sql: string, type: string, procedureName: string|null }}
 */
function validateSql(rawSql, { environment, allowedProcedures = [] }) {
  if (typeof rawSql !== 'string' || !rawSql.trim()) {
    throw new QueryError('Enter a statement to run.');
  }
  if (rawSql.length > 200000) {
    throw new QueryError('Statement is too long (200 KB limit).');
  }

  const masked = maskSql(rawSql);

  // Multiple statements: split the MASKED text so semicolons inside strings
  // and comments are already gone.
  const parts = masked.split(';').filter((p) => p.trim().length > 0);
  if (parts.length > 1) {
    throw new QueryError('Run one statement at a time. Multiple statements separated by ";" are blocked.');
  }

  const keywordMatch = /^\s*([A-Za-z_]+)/.exec(masked);
  if (!keywordMatch) throw new QueryError('Could not identify the statement type.');
  const type = keywordMatch[1].toUpperCase();

  if (!ALLOWED_STATEMENTS.has(type)) {
    throw new QueryError(
      `${type} is not allowed here. Permitted: ${[...ALLOWED_STATEMENTS].join(', ')}.`
    );
  }

  for (const { re, msg } of DENY_PATTERNS) {
    if (re.test(masked)) throw new QueryError(msg);
  }

  // A WITH ... clause must still end in a SELECT, not an INSERT/UPDATE/DELETE
  if (type === 'WITH' && /\b(insert|update|delete|merge)\b/i.test(masked)) {
    throw new QueryError('Data-modifying CTEs are not permitted.');
  }

  let procedureName = null;
  if (type === 'CALL') {
    const m = /^\s*call\s+([`"\w.]+)/i.exec(masked);
    procedureName = m ? m[1].replace(/[`"]/g, '') : null;
    if (!procedureName) throw new QueryError('Could not read the procedure name from the CALL statement.');

    if (environment === 'LIVE') {
      const short = procedureName.split('.').pop().toLowerCase();
      const ok = allowedProcedures.some(
        (p) => p.toLowerCase() === procedureName.toLowerCase() || p.toLowerCase() === short
      );
      if (!ok) {
        throw new QueryError(
          `"${procedureName}" is not on the LIVE stored-procedure allowlist. Add it under Settings → Query allowlist first.`
        );
      }
    }
  }

  // Strip a single trailing semicolon for execution
  const sql = rawSql.trim().replace(/;\s*$/, '');
  return { sql, type, procedureName };
}

/* ══════════════════════════════════════════════════════════════════════════
   2. Credential handling (AES-256-GCM, same [IV][TAG][data] layout the
      BackupVault engine already uses for OCI objects)
   ══════════════════════════════════════════════════════════════════════════ */

function getKey() {
  const hex = process.env.QUERY_ENCRYPTION_KEY || process.env.BACKUP_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new QueryError('QUERY_ENCRYPTION_KEY (64 hex chars) is not set in .env', 'CONFIG', 500);
  }
  return Buffer.from(hex, 'hex');
}

function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

function decryptSecret(b64) {
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/**
 * The registry falls back to the backup credential when query_pass_enc is
 * NULL, and that column is not GCM ciphertext. Rather than fail with a
 * confusing crypto error, fall through to the raw value — but only when the
 * operator has explicitly opted in.
 */
function resolveSecret(stored, targetName) {
  try {
    return decryptSecret(stored);
  } catch (err) {
    if (String(process.env.QUERY_ALLOW_PLAINTEXT_CRED) === 'true') {
      console.warn(`[queryService] "${targetName}" is using an unencrypted credential. ` +
                   'Set query_pass_enc via encryptSecret() before enabling this on production.');
      return stored;
    }
    throw new QueryError(
      `The credential for "${targetName}" is not encrypted with QUERY_ENCRYPTION_KEY. ` +
      'Set query_pass_enc via encryptSecret(), or set QUERY_ALLOW_PLAINTEXT_CRED=true for QA testing.',
      'CONFIG', 400
    );
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   3. Connection registry lookup
   ══════════════════════════════════════════════════════════════════════════ */

/* ── Connection registry ─────────────────────────────────────────────────────
 * ONE SELECT defines where query targets come from. It must yield exactly
 * these aliases: id, name, environment, db_engine, host, port, db_name,
 * query_enabled, query_user, query_pass_enc.
 *
 * Everything else in this file consumes the aliases, never the raw columns,
 * so an arbitrary join is fine — adapt the SQL, not the code.
 *
 * Confirm your columns first:   SHOW CREATE TABLE backup_targets\G
 * ────────────────────────────────────────────────────────────────────────── */
const REGISTRY_SQL = `
  SELECT bt.id                                       AS id,
         bt.name                                     AS name,
         CASE WHEN bt.environment IN ('live','pre_production')
              THEN 'LIVE' ELSE 'QA' END              AS environment,
         bt.environment                              AS env_label,
         bt.db_type                                  AS db_engine,
         COALESCE(bt.query_host, bt.host)            AS host,
         COALESCE(bt.query_port, bt.port)            AS port,
         bt.database_name                            AS db_name,
         bt.query_enabled                            AS query_enabled,
         COALESCE(bt.query_user, bt.username)        AS query_user,
         COALESCE(bt.query_pass_enc, bt.password)    AS query_pass_enc
    FROM backup_targets bt
   WHERE bt.is_active = 1
     AND bt.db_type IN ('mysql','postgresql')
`;

/* Notes on the mapping:
 *  - environment has five values; the dashboard toggle has two. 'live' and
 *    'pre_production' are gated as LIVE (pre-prod usually holds a copy of
 *    production data). Move 'pre_production' to the ELSE branch if yours does
 *    not. The raw value still travels as env_label so the dropdown can show it.
 *  - redis targets are excluded — nothing here can query them.
 *  - query_pass_enc falls back to the backup `password`. See resolveSecret():
 *    that only works with QUERY_ALLOW_PLAINTEXT_CRED=true, and is meant for a
 *    quick QA test, not production.
 */

/** Tolerates 'MySQL', 'MARIADB', 'POSTGRESQL', 'pg', etc. */
function normaliseEngine(raw) {
  const v = String(raw || '').toLowerCase();
  if (v.includes('postgres') || v === 'pg' || v === 'psql') return 'postgres';
  if (v.includes('maria')) return 'mariadb';
  return 'mysql';
}

async function getConnectionMeta(connectionId) {
  const [rows] = await appDb.query(
    `SELECT * FROM (${REGISTRY_SQL}) r WHERE r.id = ?`,
    [connectionId]
  );
  const c = rows[0];
  if (!c) throw new QueryError('Unknown connection.', 'NOT_FOUND', 404);
  if (!c.query_enabled) throw new QueryError(`Query execution is disabled for "${c.name}".`, 'DISABLED', 403);
  if (!c.query_user || !c.query_pass_enc) {
    throw new QueryError(`No read-only query credential configured for "${c.name}".`, 'CONFIG', 400);
  }

  return {
    id: c.id,
    name: c.name,
    environment: c.environment,
    envLabel: c.env_label,
    engine: normaliseEngine(c.db_engine),              // mysql | mariadb | postgres
    host: c.host,                                      // replica IP when query_host is set
    port: c.port,
    defaultDatabase: c.db_name,
    user: c.query_user,
    password: resolveSecret(c.query_pass_enc, c.name),
  };
}

async function getConnectionByName(name) {
  const [rows] = await appDb.query(
    `SELECT r.id FROM (${REGISTRY_SQL}) r WHERE r.name = ? LIMIT 1`, [name]);
  if (!rows[0]) throw new QueryError(`No registered connection named "${name}".`, 'NOT_FOUND', 404);
  return getConnectionMeta(rows[0].id);
}

async function listConnections(environment) {
  const params = [];
  let where = 'r.query_enabled = 1';
  if (environment) { where += ' AND r.environment = ?'; params.push(environment); }

  const [rows] = await appDb.query(
    `SELECT r.id, r.name, r.environment, r.env_label, r.db_engine, r.db_name, r.host
       FROM (${REGISTRY_SQL}) r
      WHERE ${where}
      ORDER BY r.environment, r.name`,
    params
  );
  return rows.map((r) => ({ ...r, db_engine: normaliseEngine(r.db_engine) }));
}

async function getAllowedProcedures(connectionId) {
  const [rows] = await appDb.query(
    'SELECT procedure_name FROM query_sp_allowlist WHERE connection_id = ?',
    [connectionId]
  );
  return rows.map((r) => r.procedure_name);
}

/* ══════════════════════════════════════════════════════════════════════════
   4. Executors
   ══════════════════════════════════════════════════════════════════════════ */

function normaliseValue(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().replace('T', ' ').replace('Z', '');
  if (Buffer.isBuffer(v)) return `0x${v.toString('hex').slice(0, 128)}`;
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

function normaliseRows(rows, columns) {
  return rows.map((r) => columns.map((c) => normaliseValue(r[c])));
}

function withDeadline(promise, ms, onTimeout) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { onTimeout && onTimeout(); } catch (_) { /* ignore */ }
      reject(new QueryError(`Query exceeded the ${ms / 1000}s time limit and was cancelled.`, 'TIMEOUT', 408));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------- MySQL ----
async function runMysql(meta, sql, type, database, params = []) {
  const conn = await mysql.createConnection({
    host: meta.host,
    port: meta.port || 3306,
    user: meta.user,
    password: meta.password,
    database: database || meta.defaultDatabase || undefined,
    multipleStatements: false,      // hard stop on stacked SQL
    connectTimeout: CONNECT_TIMEOUT,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    rowsAsArray: false,
  });

  const softSet = async (stmt) => { try { await conn.query(stmt); } catch (_) { /* not supported */ } };
  await softSet('SET SESSION TRANSACTION READ ONLY');
  await softSet(`SET SESSION MAX_EXECUTION_TIME=${QUERY_TIMEOUT}`);              // MySQL 8
  await softSet(`SET SESSION max_statement_time=${Math.ceil(QUERY_TIMEOUT / 1000)}`); // MariaDB

  try {
    if (type === 'CALL') {
      // A procedure's result set cannot be streamed reliably (multi result
      // sets + OK packets), so it is buffered. Protected by the LIVE
      // allowlist, the server-side timeout and the post-fetch row cap.
      const exec = conn.query(sql, params).then(([result]) => result);
      const result = await withDeadline(exec, QUERY_TIMEOUT, () => conn.destroy());

      let rows = [];
      if (Array.isArray(result) && Array.isArray(result[0])) {
        rows = result.find((s) => Array.isArray(s) && s.length) || [];
      } else if (Array.isArray(result)) {
        rows = result;
      }
      const truncated = rows.length > MAX_ROWS;
      if (truncated) rows = rows.slice(0, MAX_ROWS);
      const columns = rows.length ? Object.keys(rows[0]) : [];
      return { columns, rows: normaliseRows(rows, columns), truncated };
    }

    // Streamed path — the row cap is applied while rows arrive.
    const rows = [];
    let truncated = false;
    let fieldNames = null;

    const query = conn.connection.query(sql, params);
    query.on('fields', (fields) => {
      if (!fieldNames && Array.isArray(fields)) fieldNames = fields.map((f) => f.name);
    });

    const consume = (async () => {
      const stream = query.stream({ highWaterMark: 512 });
      for await (const row of stream) {
        if (rows.length >= MAX_ROWS) { truncated = true; stream.destroy(); break; }
        rows.push(row);
      }
    })();

    await withDeadline(consume, QUERY_TIMEOUT, () => conn.destroy());

    const columns = rows.length ? Object.keys(rows[0]) : (fieldNames || []);
    return { columns, rows: normaliseRows(rows, columns), truncated };
  } finally {
    try { await conn.end(); } catch (_) { try { conn.destroy(); } catch (_) {} }
  }
}

// ----------------------------------------------------------- PostgreSQL ----
async function runPostgres(meta, sql, type, database, params = []) {
  const PgClient = getPgClient();
  const client = new PgClient({
    host: meta.host,
    port: meta.port || 5432,
    user: meta.user,
    password: meta.password,
    database: database || meta.defaultDatabase,
    connectionTimeoutMillis: CONNECT_TIMEOUT,
    statement_timeout: QUERY_TIMEOUT,
    application_name: 'backupvault-query',
  });

  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${QUERY_TIMEOUT}`);

    // SHOW / EXPLAIN / CALL can't sit behind a cursor — they return small or
    // non-tabular output, so run them directly.
    const cursorable = ['SELECT', 'WITH'].includes(type);

    let fields = [];
    let rows = [];
    let truncated = false;

    if (cursorable) {
      const cur = `bv_${crypto.randomBytes(6).toString('hex')}`;
      await client.query({ text: `DECLARE ${cur} NO SCROLL CURSOR FOR ${sql}`, values: params });
      const res = await withDeadline(
        client.query(`FETCH FORWARD ${MAX_ROWS + 1} FROM ${cur}`),
        QUERY_TIMEOUT,
        () => client.end().catch(() => {})
      );
      fields = res.fields || [];
      rows = res.rows;
      truncated = rows.length > MAX_ROWS;
      if (truncated) rows = rows.slice(0, MAX_ROWS);
      await client.query(`CLOSE ${cur}`);
    } else {
      const res = await withDeadline(client.query({ text: sql, values: params }), QUERY_TIMEOUT, () => client.end().catch(() => {}));
      const out = Array.isArray(res) ? res.find((r) => r.rows && r.rows.length) || res[0] : res;
      fields = (out && out.fields) || [];
      rows = (out && out.rows) || [];
      truncated = rows.length > MAX_ROWS;
      if (truncated) rows = rows.slice(0, MAX_ROWS);
    }

    await client.query('COMMIT');

    const columns = fields.length ? fields.map((f) => f.name) : (rows.length ? Object.keys(rows[0]) : []);
    return { columns, rows: normaliseRows(rows, columns), truncated };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    try { await client.end(); } catch (_) {}
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   5. Result cache
   ══════════════════════════════════════════════════════════════════════════ */

const memo = new Map();  // executionId -> { payload, expires }

const isValidExecutionId = (id) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);

function cachePath(executionId) {
  if (!isValidExecutionId(executionId)) throw new QueryError('Invalid result id.', 'NOT_FOUND', 404);
  return path.join(CACHE_DIR, `${executionId}.json`);
}

async function writeCache(executionId, payload) {
  await fsp.mkdir(CACHE_DIR, { recursive: true, mode: 0o700 });
  await fsp.writeFile(cachePath(executionId), JSON.stringify(payload), { mode: 0o600 });
  memo.set(executionId, { payload, expires: Date.now() + 60000 });
}

async function readCache(executionId) {
  const hit = memo.get(executionId);
  if (hit && hit.expires > Date.now()) return hit.payload;

  let raw;
  try {
    raw = await fsp.readFile(cachePath(executionId), 'utf8');
  } catch (_) {
    throw new QueryError('These results have expired. Run the query again.', 'EXPIRED', 410);
  }
  const payload = JSON.parse(raw);
  memo.set(executionId, { payload, expires: Date.now() + 60000 });
  return payload;
}

function startCacheSweeper() {
  const sweep = async () => {
    try {
      await fsp.mkdir(CACHE_DIR, { recursive: true, mode: 0o700 });
      const files = await fsp.readdir(CACHE_DIR);
      const cutoff = Date.now() - CACHE_TTL_MS;
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const p = path.join(CACHE_DIR, f);
        const st = await fsp.stat(p).catch(() => null);
        if (st && st.mtimeMs < cutoff) await fsp.unlink(p).catch(() => {});
      }
      for (const [k, v] of memo) if (v.expires < Date.now()) memo.delete(k);
    } catch (err) {
      console.error('[queryService] cache sweep failed:', err.message);
    }
  };
  sweep();
  const t = setInterval(sweep, 5 * 60 * 1000);
  if (t.unref) t.unref();
}

/* ══════════════════════════════════════════════════════════════════════════
   6. Public API
   ══════════════════════════════════════════════════════════════════════════ */

async function audit(fields) {
  try {
    await appDb.query(
      `INSERT INTO query_audit
         (execution_id, user_id, username, connection_id, connection_name, environment,
          db_engine, database_name, statement_type, sql_text, status, client_ip)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [fields.executionId, fields.userId, fields.username, fields.connectionId, fields.connectionName,
       fields.environment, fields.engine, fields.database, fields.type, fields.sql, 'RUNNING', fields.clientIp]
    );
  } catch (err) {
    console.error('[queryService] audit insert failed:', err.message);
  }
}

async function auditFinish(executionId, patch) {
  try {
    await appDb.query(
      `UPDATE query_audit
          SET status = ?, error_text = ?, row_count = ?, truncated = ?, duration_ms = ?,
              finished_at = CURRENT_TIMESTAMP
        WHERE execution_id = ?`,
      [patch.status, patch.error || null, patch.rowCount || 0, patch.truncated ? 1 : 0,
       patch.durationMs || 0, executionId]
    );
  } catch (err) {
    console.error('[queryService] audit update failed:', err.message);
  }
}

/**
 * Execute a statement and cache the full result set.
 */
async function execute({ connectionId, sql, database, user, clientIp, pageSize = DEFAULT_PAGE_SIZE }) {
  const executionId = crypto.randomUUID();
  const meta = await getConnectionMeta(connectionId);

  // RBAC
  if (meta.environment === 'LIVE' && !user.canQueryLive) {
    throw new QueryError('You do not have permission to run queries against LIVE.', 'FORBIDDEN', 403);
  }
  if (meta.environment === 'QA' && !(user.canQueryQa || user.canQueryLive)) {
    throw new QueryError('You do not have permission to run queries.', 'FORBIDDEN', 403);
  }

  const allowedProcedures = await getAllowedProcedures(connectionId);
  let parsed;
  try {
    parsed = validateSql(sql, { environment: meta.environment, allowedProcedures });
  } catch (err) {
    await audit({
      executionId, userId: user.id, username: user.username, connectionId,
      connectionName: meta.name, environment: meta.environment, engine: meta.engine,
      database: database || meta.defaultDatabase, type: null, sql, clientIp,
    });
    await auditFinish(executionId, { status: 'BLOCKED', error: err.message });
    throw err;
  }

  await audit({
    executionId, userId: user.id, username: user.username, connectionId,
    connectionName: meta.name, environment: meta.environment, engine: meta.engine,
    database: database || meta.defaultDatabase, type: parsed.type, sql: parsed.sql, clientIp,
  });

  const started = Date.now();
  let result;
  try {
    result = meta.engine === 'postgres'
      ? await runPostgres(meta, parsed.sql, parsed.type, database)
      : await runMysql(meta, parsed.sql, parsed.type, database);
  } catch (err) {
    const status = err.code === 'TIMEOUT' ? 'TIMEOUT' : 'ERROR';
    await auditFinish(executionId, { status, error: err.message, durationMs: Date.now() - started });
    if (err instanceof QueryError) throw err;
    throw new QueryError(err.sqlMessage || err.message, 'DB_ERROR', 400);
  }

  const durationMs = Date.now() - started;
  const size = ALLOWED_PAGE_SIZES.includes(Number(pageSize)) ? Number(pageSize) : DEFAULT_PAGE_SIZE;

  const payload = {
    meta: {
      executionId,
      userId: user.id,
      connectionId,
      connectionName: meta.name,
      environment: meta.environment,
      engine: meta.engine,
      database: database || meta.defaultDatabase,
      statementType: parsed.type,
      sql: parsed.sql,
      totalRows: result.rows.length,
      truncated: result.truncated,
      durationMs,
      maxRows: MAX_ROWS,
      expiresAt: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
    },
    columns: result.columns,
    rows: result.rows,
  };

  await writeCache(executionId, payload);
  await auditFinish(executionId, {
    status: 'SUCCESS', rowCount: result.rows.length, truncated: result.truncated, durationMs,
  });

  return {
    ...payload.meta,
    columns: result.columns,
    page: 1,
    pageSize: size,
    totalPages: Math.max(1, Math.ceil(result.rows.length / size)),
    rows: result.rows.slice(0, size),
  };
}

/**
 * Serve one page from the cached result set.
 */
async function getPage({ executionId, page = 1, pageSize = DEFAULT_PAGE_SIZE, user }) {
  const payload = await readCache(executionId);

  if (payload.meta.userId !== user.id && !user.isAdmin) {
    throw new QueryError('These results belong to another user.', 'FORBIDDEN', 403);
  }

  const size = ALLOWED_PAGE_SIZES.includes(Number(pageSize)) ? Number(pageSize) : DEFAULT_PAGE_SIZE;
  const total = payload.rows.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const start = (p - 1) * size;

  return {
    ...payload.meta,
    columns: payload.columns,
    page: p,
    pageSize: size,
    totalPages,
    rows: payload.rows.slice(start, start + size),
  };
}

function toCsvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // Neutralise spreadsheet formula injection
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Stream the cached result set out as CSV.
 */
async function streamCsv({ executionId, user, res }) {
  const payload = await readCache(executionId);
  if (payload.meta.userId !== user.id && !user.isAdmin) {
    throw new QueryError('These results belong to another user.', 'FORBIDDEN', 403);
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="query-${executionId.slice(0, 8)}.csv"`);
  res.write('\uFEFF');                                    // BOM for Excel
  res.write(payload.columns.map(toCsvCell).join(',') + '\r\n');

  const CHUNK = 1000;
  for (let i = 0; i < payload.rows.length; i += CHUNK) {
    const lines = payload.rows
      .slice(i, i + CHUNK)
      .map((row) => row.map(toCsvCell).join(','))
      .join('\r\n');
    if (!res.write(lines + '\r\n')) {
      await new Promise((resolve) => res.once('drain', resolve));
    }
  }
  res.end();
}

/**
 * Low-level execution used by the report engine. SQL comes from server-side
 * report definitions (never from a browser), values are always bound.
 */
async function runOnConnection({ connectionRef, sql, params = [], database }) {
  const meta = /^\d+$/.test(String(connectionRef))
    ? await getConnectionMeta(connectionRef)
    : await getConnectionByName(connectionRef);

  const parsed = validateSql(sql, { environment: 'REPORT', allowedProcedures: [] });
  const started = Date.now();

  const result = meta.engine === 'postgres'
    ? await runPostgres(meta, parsed.sql, parsed.type, database, params)
    : await runMysql(meta, parsed.sql, parsed.type, database, params);

  return { ...result, durationMs: Date.now() - started, connection: meta.name, engine: meta.engine };
}

async function getHistory({ user, limit = 25 }) {
  const [rows] = await appDb.query(
    `SELECT execution_id, connection_name, environment, database_name, statement_type,
            LEFT(sql_text, 300) AS sql_preview, status, row_count, duration_ms, created_at
       FROM query_audit
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT ?`,
    [user.id, Number(limit)]
  );
  return rows;
}

module.exports = {
  execute,
  getPage,
  streamCsv,
  runOnConnection,
  getConnectionMeta,
  getConnectionByName,
  writeCache,
  readCache,
  toCsvCell,
  listConnections,
  getAllowedProcedures,
  getHistory,
  startCacheSweeper,
  encryptSecret,
  decryptSecret,
  validateSql,
  maskSql,
  QueryError,
  constants: { MAX_ROWS, QUERY_TIMEOUT, CACHE_TTL_MS, ALLOWED_PAGE_SIZES, DEFAULT_PAGE_SIZE },
};
