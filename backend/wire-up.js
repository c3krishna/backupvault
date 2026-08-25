#!/usr/bin/env node
'use strict';
/**
 * BackupVault :: wire-up
 *
 * Detects this install's DB pool and auth middleware, patches the four
 * Query/Reports files to point at them, and re-enables the mount in
 * server.js behind a try/catch.
 *
 * Run from the backend root:   node wire-up.js
 * Preview without writing:     node wire-up.js --dry
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const DRY = process.argv.includes('--dry');

const log = (...a) => console.log(...a);
const ok = (s) => `  \x1b[32m✓\x1b[0m ${s}`;
const bad = (s) => `  \x1b[31m✗\x1b[0m ${s}`;

function tryRequire(p) {
  try { return { ok: true, mod: require(p) }; }
  catch (e) { return { ok: false, err: e.message }; }
}

function relFrom(fromFile, toFile) {
  let r = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, '/').replace(/\.js$/, '');
  if (!r.startsWith('.')) r = './' + r;
  return r;
}

function walkJs(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walkJs(p, out); }
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/* ── 1. locate a mysql2/promise pool ─────────────────────────────────────── */
function findDb() {
  const candidates = [];
  for (const sub of ['db', 'config', 'lib', 'database']) {
    const d = path.join(SRC, sub);
    if (fs.existsSync(d)) {
      for (const f of fs.readdirSync(d)) if (f.endsWith('.js')) candidates.push(path.join(d, f));
    }
  }
  for (const f of walkJs(SRC)) {
    if (/\b(db|pool|mysql|database|connection)\b/i.test(path.basename(f)) && !candidates.includes(f)) {
      candidates.push(f);
    }
  }

  for (const file of candidates) {
    const r = tryRequire(file);
    if (!r.ok || !r.mod) continue;
    const m = r.mod;
    if (typeof m.query === 'function') return { file, accessor: '' };
    for (const k of Object.keys(m)) {
      if (m[k] && typeof m[k].query === 'function') return { file, accessor: '.' + k };
    }
  }
  return null;
}

/* ── 2. locate the auth middleware ───────────────────────────────────────── */
function findAuth() {
  const hits = walkJs(SRC).filter((f) => {
    if (/queryRoutes|reportRoutes|queryController|reportController/.test(f)) return false;
    return /jwt\.verify|jsonwebtoken/.test(fs.readFileSync(f, 'utf8'));
  });

  const preferred = ['authenticate', 'verifyToken', 'requireAuth', 'authMiddleware',
                     'protect', 'auth', 'checkAuth', 'verifyJWT', 'isAuthenticated'];

  for (const file of hits) {
    const r = tryRequire(file);
    if (!r.ok || !r.mod) continue;
    const m = r.mod;
    if (typeof m === 'function' && m.length >= 2) return { file, name: null };
    for (const n of preferred) if (typeof m[n] === 'function') return { file, name: n };
    for (const k of Object.keys(m)) {
      if (typeof m[k] === 'function' && m[k].length === 3) return { file, name: k };
    }
  }
  return { file: null, candidates: hits };
}

/* ── 3. patch ────────────────────────────────────────────────────────────── */
function patch(file, re, replacement, label) {
  if (!fs.existsSync(file)) { log(bad(`${path.relative(ROOT, file)} — not found`)); return false; }
  const src = fs.readFileSync(file, 'utf8');
  if (!re.test(src)) { log(bad(`${path.relative(ROOT, file)} — no import line matched`)); return false; }
  const out = src.replace(re, replacement);
  if (out === src) { log(ok(`${path.relative(ROOT, file)} — already correct`)); return true; }
  if (!DRY) fs.writeFileSync(file, out);
  log(ok(`${path.relative(ROOT, file)} → ${label}`));
  return true;
}

/* ── main ────────────────────────────────────────────────────────────────── */
log('\nBackupVault wire-up' + (DRY ? '  (dry run)' : '') + '\n');

const db = findDb();
if (!db) {
  log(bad('No module exporting a .query() pool found under src/.'));
  log('    Check src/db/connection.js — it must export a mysql2/promise pool.');
  process.exit(1);
}
log(ok(`DB pool: ${path.relative(ROOT, db.file)}${db.accessor || ''}`));

const auth = findAuth();
if (!auth.file) {
  log(bad('No auth middleware found.'));
  if (auth.candidates.length) log('    Files using jwt: ' + auth.candidates.map((f) => path.relative(ROOT, f)).join(', '));
  log('    Patch the auth import in queryRoutes.js/reportRoutes.js by hand.');
} else {
  log(ok(`Auth: ${path.relative(ROOT, auth.file)}` + (auth.name ? ` → ${auth.name}()` : ' → default export')));
}

log('\nPatching:');

const svc = ['src/services/queryService.js', 'src/services/reportService.js'].map((f) => path.join(ROOT, f));
for (const f of svc) {
  patch(f, /const appDb = require\('[^']+'\)[^;]*;/,
        `const appDb = require('${relFrom(f, db.file)}')${db.accessor};`,
        `appDb = ${relFrom(f, db.file)}${db.accessor}`);
}

if (auth.file) {
  const routes = ['src/routes/queryRoutes.js', 'src/routes/reportRoutes.js'].map((f) => path.join(ROOT, f));
  for (const f of routes) {
    const rel = relFrom(f, auth.file);
    const line = auth.name
      ? `const { ${auth.name}: authenticate } = require('${rel}');`
      : `const authenticate = require('${rel}');`;
    patch(f, /const \{ authenticate \} = require\('[^']+'\);/, line, rel);
  }
}

/* ── 4. server.js mount ──────────────────────────────────────────────────── */
const serverFile = path.join(SRC, 'server.js');
let server = fs.readFileSync(serverFile, 'utf8');

server = server.replace(/^.*app\.use\('\/api\/(query|reports)'.*$\n?/gm, '');
server = server.replace(/\n*\/\/ ── Query Execution \+ Reports[\s\S]*?\n\}\n/g, '\n');

const block = `
// ── Query Execution + Reports ───────────────────────────────────────────────
// Isolated: a fault here must never stop backup scheduling.
try {
  app.use('/api/query',   require('./routes/queryRoutes'));
  app.use('/api/reports', require('./routes/reportRoutes'));
  console.log('[BackupVault] Query/Reports mounted');
} catch (err) {
  console.error('[BackupVault] Query/Reports DISABLED:', err.message);
}
`;

const lastMount = [...server.matchAll(/^app\.use\('\/api.*$/gm)].pop();
if (lastMount) {
  const at = lastMount.index + lastMount[0].length;
  server = server.slice(0, at) + '\n' + block + server.slice(at);
  if (!DRY) fs.writeFileSync(serverFile, server);
  log(ok('src/server.js — mount block inserted'));
} else {
  log(bad('src/server.js — no app.use(\'/api...\') line found; add the mount manually'));
}

/* ── 5. verify the route modules actually load ───────────────────────────── */
log('\nVerifying:');
for (const r of ['./src/routes/queryRoutes', './src/routes/reportRoutes']) {
  const res = tryRequire(path.join(ROOT, r));
  log(res.ok ? ok(`${r} loads`) : bad(`${r} — ${res.err}`));
}

log(DRY ? '\nDry run — nothing written.\n' : '\nNow run:  pm2 restart backupvault && pm2 logs backupvault --lines 20\n');
process.exit(0);
