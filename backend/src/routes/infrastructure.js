// /var/www/backupvault/backend/src/routes/infrastructure.js
// New routes for S3 config, Remote DR config, storage monitor, health checks
// Add to server.js: app.use('/api', require('./routes/infrastructure'));

const express       = require('express');
const { execSync }  = require('child_process');
const router        = express.Router();
const db            = require('../db/connection');
const s3Service     = require('../services/s3Service');
const remoteSync    = require('../services/remoteSync');
const storageMonitor = require('../services/storageMonitor');

// ── MIDDLEWARE: verify JWT (reuse from api.js pattern) ────────────────────────
const jwt = require('jsonwebtoken');
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'super_secure_backupvault_token_key');
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ═══════════════════════════════════════════════════════════════
// S3 CONFIGURATION & TESTING
// ═══════════════════════════════════════════════════════════════

// POST /api/destinations/s3/test — test S3 credentials without saving
router.post('/destinations/s3/test', auth, async (req, res) => {
  try {
    const { bucket, region, access_key, secret_key, prefix, storage_class } = req.body;
    if (!bucket || !access_key || !secret_key) {
      return res.status(400).json({ error: 'bucket, access_key and secret_key are required' });
    }
    const result = await s3Service.testS3Connection({ bucket, region, access_key, secret_key, prefix, storage_class });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/destinations/s3/save — save S3 destination with connectivity check
router.post('/destinations/s3/save', auth, async (req, res) => {
  try {
    const { id, name, bucket, region = 'ap-south-1', access_key, secret_key, prefix = 'db-backups/', storage_class = 'STANDARD_IA' } = req.body;

    // Test first
    const test = await s3Service.testS3Connection({ bucket, region, access_key, secret_key });

    const config = {
      bucket, region, access_key, secret_key, prefix, storage_class,
      status:     test.success ? 'connected' : test.status,
      last_check: new Date().toISOString(),
      last_error: test.error || null,
      latency_ms: test.latency_ms,
    };

    if (id) {
      await db.query(
        'UPDATE backup_destinations SET name=?, config=?, is_active=? WHERE id=?',
        [name, JSON.stringify(config), test.success ? 1 : 0, id]
      );
      res.json({ id, saved: true, connection: test });
    } else {
      const [r] = await db.pool.execute(
        'INSERT INTO backup_destinations (name, dest_type, config, is_active) VALUES (?,?,?,?)',
        [name || `AWS S3 — ${bucket}`, 'aws_s3', JSON.stringify(config), test.success ? 1 : 0]
      );
      res.json({ id: r.insertId, saved: true, connection: test });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/destinations/s3/status — live status of all S3 destinations
router.get('/destinations/s3/status', auth, async (req, res) => {
  try {
    const results = await s3Service.checkAllS3Destinations();
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/destinations/s3/:id/sync — trigger manual S3 sync
router.post('/destinations/s3/:id/sync', auth, async (req, res) => {
  try {
    const dest = await db.queryOne('SELECT * FROM backup_destinations WHERE id=? AND dest_type="aws_s3"', [req.params.id]);
    if (!dest) return res.status(404).json({ error: 'S3 destination not found' });

    const config   = typeof dest.config === 'string' ? JSON.parse(dest.config) : dest.config;
    const localDir = req.body.local_dir || process.env.PRIMARY_MOUNT || '/primary-db-backup';
    const result   = await s3Service.syncDirToS3(localDir, config, req.body.dry_run || false);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// REMOTE ONSITE DR (192.168.12.243)
// ═══════════════════════════════════════════════════════════════

// POST /api/destinations/remote/test — test SSH to DR server
router.post('/destinations/remote/test', auth, async (req, res) => {
  try {
    const { host, port = 22, user = 'root', password, path: remotePath = '/backups/remote' } = req.body;
    if (!host || !password) return res.status(400).json({ error: 'host and password are required' });
    const result = await remoteSync.testRemoteConnection({ host, port, user, password, path: remotePath });

    // If connected, also get disk stats
    if (result.success) {
      result.disk = await remoteSync.getRemoteDiskStats({ host, port, user, password, path: remotePath });
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/destinations/remote/save — save remote DR destination
router.post('/destinations/remote/save', auth, async (req, res) => {
  try {
    const { id, name, host = '192.168.12.243', port = 22, user = 'root', password, path: remotePath = '/backups/remote' } = req.body;
    if (!password) return res.status(400).json({ error: 'SSH password is required' });

    const test = await remoteSync.testRemoteConnection({ host, port, user, password, path: remotePath });
    let disk   = null;
    if (test.success) disk = await remoteSync.getRemoteDiskStats({ host, port, user, password, path: remotePath });

    const config = {
      host, port, user, password, path: remotePath,
      status:     test.success ? 'connected' : test.status,
      last_check: new Date().toISOString(),
      last_error: test.error || null,
      disk,
    };

    if (id) {
      await db.query(
        'UPDATE backup_destinations SET name=?, config=?, is_active=? WHERE id=?',
        [name, JSON.stringify(config), test.success ? 1 : 0, id]
      );
      res.json({ id, saved: true, connection: test, disk });
    } else {
      const [r] = await db.pool.execute(
        'INSERT INTO backup_destinations (name, dest_type, config, is_active) VALUES (?,?,?,?)',
        [name || `Remote Onsite DR — ${host}`, 'remote_sftp', JSON.stringify(config), test.success ? 1 : 0]
      );
      res.json({ id: r.insertId, saved: true, connection: test, disk });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/destinations/remote/status — live check all SFTP destinations
router.get('/destinations/remote/status', auth, async (req, res) => {
  try {
    const results = await remoteSync.checkAllRemoteDestinations();
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// STORAGE MONITORING
// ═══════════════════════════════════════════════════════════════

// GET /api/storage/monitor — check all local mounts
router.get('/storage/monitor', auth, async (req, res) => {
  try {
    const result = await storageMonitor.runChecks();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/storage/directories — per-directory breakdown on primary mount
router.get('/storage/directories', auth, async (req, res) => {
  try {
    const mountPath = req.query.mount || process.env.PRIMARY_MOUNT || '/primary-db-backup';
    const stats     = await storageMonitor.getDirectoryStats(mountPath);
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/storage/test-alert — manually trigger a test alert email
router.post('/storage/test-alert', auth, async (req, res) => {
  try {
    await storageMonitor.sendStorageAlert({
      location:   'Test Alert — Primary DC (NFS)',
      path:       '/primary-db-backup',
      usedPct:    87,
      usedHuman:  '394G',
      totalHuman: '482G',
      freeHuman:  '64G',
      level:      'warn',
    });
    res.json({ sent: true, message: 'Test alert email dispatched to all users' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// FULL INFRASTRUCTURE HEALTH
// ═══════════════════════════════════════════════════════════════

// GET /api/infra/health — all destinations + storage in one call
router.get('/infra/health', auth, async (req, res) => {
  try {
    const [storage, s3, remote] = await Promise.allSettled([
      storageMonitor.runChecks(),
      s3Service.checkAllS3Destinations(),
      remoteSync.checkAllRemoteDestinations(),
    ]);

    res.json({
      storage: storage.status === 'fulfilled' ? storage.value : { error: storage.reason?.message },
      s3:      s3.status      === 'fulfilled' ? s3.value      : { error: s3.reason?.message },
      remote:  remote.status  === 'fulfilled' ? remote.value  : { error: remote.reason?.message },
      checked_at: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

// ── S3 FILE BROWSER ───────────────────────────────────────────────────────────

// GET /api/s3/:destId/list?prefix=db-backups/
router.get('/s3/:destId/list', auth, async (req, res) => {
  try {
    const dest = await db.queryOne(
      "SELECT * FROM backup_destinations WHERE id=? AND dest_type='aws_s3'",
      [req.params.destId]
    );
    if (!dest) return res.status(404).json({ error: 'S3 destination not found' });
    const config = typeof dest.config === 'string' ? JSON.parse(dest.config) : dest.config;
    const { bucket, region, access_key, secret_key, prefix: basePrefix = '' } = config;
    if (!region) return res.status(400).json({ error: 'Region not set in S3 destination config. Edit in Destinations.' });
    if (!bucket || !access_key || !secret_key)
      return res.status(400).json({ error: 'S3 not fully configured. Set bucket, access_key, secret_key in Destinations.', code: 'NOT_CONFIGURED' });

    const queryPrefix = req.query.prefix !== undefined ? req.query.prefix : basePrefix;

    const env = { ...process.env, AWS_ACCESS_KEY_ID: access_key, AWS_SECRET_ACCESS_KEY: secret_key, AWS_DEFAULT_REGION: region };

    // Use aws s3api list-objects-v2 with delimiter for folder-style browsing
    const delimiter = '/';
    let cmd = `aws s3api list-objects-v2 --bucket "${bucket}" --delimiter "${delimiter}"`;
    if (queryPrefix) cmd += ` --prefix "${queryPrefix}"`;
    cmd += ` --region ${region} --output json 2>&1`;

    let out;
    try {
      out = execSync(cmd, { env, timeout: 20000, maxBuffer: 10*1024*1024 }).toString();
    } catch (e) {
      const msg = e.message + (e.stdout||'') + (e.stderr||'');
      if (msg.includes('NoSuchBucket'))   return res.status(404).json({ error: `Bucket "${bucket}" not found`, code: 'NO_BUCKET' });
      if (msg.includes('AccessDenied') || msg.includes('InvalidAccess'))
        return res.status(401).json({ error: 'S3 access denied. Check IAM permissions.', code: 'ACCESS_DENIED' });
      if (msg.includes('aws: command not found') || msg.includes('not found'))
        return res.status(503).json({ error: 'AWS CLI not installed. Run: pip3 install awscli --break-system-packages', code: 'NO_AWSCLI' });
      return res.status(500).json({ error: msg.split('\n')[0].substring(0, 300), code: 'S3_ERROR' });
    }

    let result;
    try { result = JSON.parse(out); }
    catch { return res.status(500).json({ error: 'Failed to parse S3 response', raw: out.substring(0, 200) }); }

    // Common prefixes = "folders"
    const folders = (result.CommonPrefixes || []).map(cp => ({
      type:     'folder',
      key:      cp.Prefix,
      name:     cp.Prefix.replace(queryPrefix, '').replace(/\/$/, ''),
      prefix:   cp.Prefix,
    }));

    // Objects = files
    const files = (result.Contents || [])
      .filter(obj => obj.Key !== queryPrefix) // skip the folder placeholder
      .map(obj => {
        const name = obj.Key.replace(queryPrefix, '');
        const sz   = obj.Size;
        const mb   = sz / 1024 / 1024;
        return {
          type:         'file',
          key:          obj.Key,
          name:         name,
          size:         sz,
          sizeHuman:    mb >= 1024 ? `${(mb/1024).toFixed(2)} GB` : `${mb.toFixed(2)} MB`,
          lastModified: obj.LastModified,
          etag:         obj.ETag?.replace(/"/g,''),
          storageClass: obj.StorageClass,
        };
      })
      .sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified)); // newest first

    // Bucket-level disk usage (only at root)
    let bucketStats = null;
    if (!queryPrefix || queryPrefix === basePrefix) {
      try {
        const du = execSync(
          `aws s3 ls s3://${bucket}/ --recursive --human-readable --summarize --region ${region} 2>/dev/null | tail -2`,
          { env, timeout: 30000 }
        ).toString();
        const match = du.match(/Total Size:\s+(\S+)\s+(\S+)/);
        const cnt   = du.match(/Total Objects:\s+(\d+)/);
        if (match) bucketStats = { size: `${match[1]} ${match[2]}`, objects: cnt ? parseInt(cnt[1]) : null };
      } catch {}
    }

    res.json({
      bucket, region, prefix: queryPrefix, basePrefix,
      folders: folders.sort((a,b) => a.name.localeCompare(b.name)),
      files,
      truncated: result.IsTruncated || false,
      total: folders.length + files.length,
      bucketStats,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/s3/:destId/presign?key=path/to/file — generate presigned download URL
router.get('/s3/:destId/presign', auth, async (req, res) => {
  try {
    const dest = await db.queryOne("SELECT * FROM backup_destinations WHERE id=? AND dest_type='aws_s3'", [req.params.destId]);
    if (!dest) return res.status(404).json({ error: 'S3 destination not found' });
    const config = typeof dest.config === 'string' ? JSON.parse(dest.config) : dest.config;
    const { bucket, region, access_key, secret_key } = config;
    const key = req.query.key;
    if (!key) return res.status(400).json({ error: 'key parameter required' });

    const env = { ...process.env, AWS_ACCESS_KEY_ID: access_key, AWS_SECRET_ACCESS_KEY: secret_key, AWS_DEFAULT_REGION: region };
    const url = execSync(
      `aws s3 presign "s3://${bucket}/${key}" --expires-in 3600 --region ${region}`,
      { env, timeout: 8000 }
    ).toString().trim();

    res.json({ url, expires_in: 3600, key });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/s3/destinations — list all active S3 destinations
router.get('/s3/destinations', auth, async (req, res) => {
  try {
    const dests = await db.query("SELECT * FROM backup_destinations WHERE dest_type='aws_s3' AND is_active=1");
    res.json(dests.map(d => {
      const c = typeof d.config === 'string' ? JSON.parse(d.config) : d.config;
      return { id: d.id, name: d.name, bucket: c.bucket, region: c.region, prefix: c.prefix, status: c.status };
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/s3/:destId/folder-stats?prefix=folder/
// Returns file count + total size for a folder without downloading files
router.get('/s3/:destId/folder-stats', auth, async (req, res) => {
  try {
    const dest   = await db.queryOne("SELECT * FROM backup_destinations WHERE id=? AND dest_type='aws_s3'", [req.params.destId]);
    if (!dest) return res.status(404).json({ error: 'Not found' });
    const config = typeof dest.config==='string' ? JSON.parse(dest.config) : dest.config;
    const { bucket, region, access_key, secret_key } = config;
    const prefix = req.query.prefix || '';
    const env    = { ...process.env, AWS_ACCESS_KEY_ID: access_key, AWS_SECRET_ACCESS_KEY: secret_key, AWS_DEFAULT_REGION: region };

    const out = execSync(
      `aws s3 ls s3://${bucket}/${prefix} --recursive --human-readable --summarize --region ${region} 2>/dev/null | tail -3`,
      { env, timeout: 30000 }
    ).toString();

    const sizeMatch = out.match(/Total Size:\s+(\S+)\s+(\S+)/);
    const cntMatch  = out.match(/Total Objects:\s+(\d+)/);
    res.json({
      prefix,
      totalSize:    sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2]}` : '0 B',
      totalObjects: cntMatch  ? parseInt(cntMatch[1]) : 0,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
