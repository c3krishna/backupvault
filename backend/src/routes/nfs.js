// backend/src/routes/nfs.js
// NFS server CRUD and live disk monitoring via df/nfsstat/showmount

const express    = require('express');
const router     = express.Router();
const { execSync } = require('child_process');
const db         = require('../db/connection');
const jwt        = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secure_backupvault_token_key';

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

function safeExec(cmd, timeout = 8000) {
  try { return execSync(cmd, { timeout, maxBuffer: 2*1024*1024 }).toString().trim(); }
  catch { return null; }
}

// ── LIVE STATS FOR ONE NFS SERVER ─────────────────────────────────────────────
async function getLiveStats(server) {
  const mp    = server.mount_point;
  const host  = server.host;
  const stats = { status:'offline', last_check: new Date() };

  // 1. Check if mount point exists locally
  const exists = safeExec(`test -d '${mp}' && echo yes`);
  if (!exists) {
    stats.status    = 'offline';
    stats.last_error = `Mount point ${mp} not found locally`;
    return stats;
  }

  // 2. Check if it's actually mounted (mounted NFS shows host in /proc/mounts)
  const mounts = safeExec(`cat /proc/mounts 2>/dev/null || mount`) || '';
  const isMounted = mounts.includes(mp) || mounts.includes(host);
  if (!isMounted) {
    stats.status     = 'offline';
    stats.last_error = `${mp} is not mounted`;
    return stats;
  }

  // 3. df -h for disk usage
  const dfOut = safeExec(`df -h '${mp}' 2>/dev/null`);
  if (dfOut) {
    const lines = dfOut.split('\n');
    if (lines[1]) {
      const p          = lines[1].replace(/\s+/g,' ').split(' ');
      stats.disk_size  = p[1];
      stats.disk_used  = p[2];
      stats.disk_avail = p[3];
      stats.disk_pct   = parseInt(p[4]) || 0;
    }
  }

  // 4. df -i for inode usage
  const dfInode = safeExec(`df -i '${mp}' 2>/dev/null`);
  if (dfInode) {
    const lines = dfInode.split('\n');
    if (lines[1]) {
      const p        = lines[1].replace(/\s+/g,' ').split(' ');
      stats.inode_pct = parseInt(p[4]) || 0;
    }
  }

  // 5. Status based on thresholds
  if (stats.disk_pct >= 95 || stats.inode_pct >= 90) stats.status = 'critical';
  else if (stats.disk_pct >= 80 || stats.inode_pct >= 80) stats.status = 'warn';
  else stats.status = 'online';

  stats.last_error = null;
  return stats;
}

// ── ROUTES ────────────────────────────────────────────────────────────────────

// GET /api/nfs — list all NFS servers
router.get('/nfs', auth, async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM nfs_servers ORDER BY role, name');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/nfs — create NFS server
router.post('/nfs', auth, async (req, res) => {
  try {
    const { name, host, export_path, mount_point, role='other', description='' } = req.body;
    if (!name||!host||!export_path||!mount_point)
      return res.status(400).json({ error: 'name, host, export_path, mount_point required' });
    const [r] = await db.pool.execute(
      'INSERT INTO nfs_servers (name,host,export_path,mount_point,role,description) VALUES (?,?,?,?,?,?)',
      [name, host, export_path, mount_point, role, description]
    );
    res.status(201).json({ id: r.insertId, message: 'NFS server added' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/nfs/:id — update NFS server
router.put('/nfs/:id', auth, async (req, res) => {
  try {
    const { name, host, export_path, mount_point, role, description, is_active } = req.body;
    await db.query(
      'UPDATE nfs_servers SET name=?,host=?,export_path=?,mount_point=?,role=?,description=?,is_active=? WHERE id=?',
      [name, host, export_path, mount_point, role, description, is_active?1:0, req.params.id]
    );
    res.json({ message: 'Updated' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/nfs/:id
router.delete('/nfs/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM nfs_servers WHERE id=?', [req.params.id]);
    res.json({ message: 'Removed' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/nfs/:id/check — live check one NFS server
router.get('/nfs/:id/check', auth, async (req, res) => {
  try {
    const server = await db.queryOne('SELECT * FROM nfs_servers WHERE id=?', [req.params.id]);
    if (!server) return res.status(404).json({ error: 'Not found' });

    const stats = await getLiveStats(server);

    // Save to DB
    await db.query(
      `UPDATE nfs_servers SET status=?,disk_size=?,disk_used=?,disk_avail=?,disk_pct=?,
       inode_pct=?,last_check=NOW(),last_error=? WHERE id=?`,
      [stats.status, stats.disk_size||null, stats.disk_used||null, stats.disk_avail||null,
       stats.disk_pct||null, stats.inode_pct||null, stats.last_error||null, server.id]
    );

    res.json({ ...server, ...stats });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/nfs/check-all — live check all NFS servers
router.get('/nfs/check-all', auth, async (req, res) => {
  try {
    const servers = await db.query('SELECT * FROM nfs_servers WHERE is_active=1');
    const results = [];

    for (const server of servers) {
      const stats = await getLiveStats(server);
      await db.query(
        `UPDATE nfs_servers SET status=?,disk_size=?,disk_used=?,disk_avail=?,disk_pct=?,
         inode_pct=?,last_check=NOW(),last_error=? WHERE id=?`,
        [stats.status, stats.disk_size||null, stats.disk_used||null, stats.disk_avail||null,
         stats.disk_pct||null, stats.inode_pct||null, stats.last_error||null, server.id]
      );
      results.push({ ...server, ...stats });
    }

    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
