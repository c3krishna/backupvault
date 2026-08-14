// backend/src/routes/secondaryfs.js
const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const { execSync } = require('child_process');
const jwt     = require('jsonwebtoken');

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'super_secure_backupvault_token_key');
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}

function safeRead(p) { try { return fs.readdirSync(p); } catch { return []; } }

function buildFileEntry(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    const sz = stat.size;
    const mb = sz / 1024 / 1024;
    return {
      filename:  path.basename(filePath),
      size:      mb >= 1024 ? `${(mb/1024).toFixed(2)} GB` : `${mb.toFixed(2)} MB`,
      sizeBytes: sz,
      mtime:     stat.mtimeMs,
      time:      stat.mtime.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}),
      status:    sz > 1024 ? 'Verified' : 'Empty',
    };
  } catch { return null; }
}

// GET /api/fs/secondary-mount
router.get('/fs/secondary-mount', auth, (req, res) => {
  const mountPoint = process.env.SECONDARY_MOUNT || '/secondary-db-backup';

  if (!fs.existsSync(mountPoint)) {
    return res.status(404).json({ error: `Secondary DC mount not found: ${mountPoint}` });
  }

  // Disk stats
  let storageStats = { size:'N/A', used:'N/A', avail:'N/A', usePercent:'0%' };
  try {
    const df = execSync(`df -h ${mountPoint}`, { timeout:5000 }).toString().split('\n');
    if (df[1]) {
      const p = df[1].replace(/\s+/g,' ').split(' ');
      storageStats = { size:p[1], used:p[2], avail:p[3], usePercent:p[4] };
    }
  } catch {}

  try {
    const dbDirs = safeRead(mountPoint)
      .filter(n => !n.startsWith('.'))
      .filter(n => { try { return fs.statSync(path.join(mountPoint,n)).isDirectory(); } catch { return false; } });

    const treeData = dbDirs.map(dbName => {
      const dbPath       = path.join(mountPoint, dbName);
      const backupDbPath = path.join(dbPath, 'Backup_DB');

      // ── Structured: db/Backup_DB/YYYYMMDD/ ──────────────────────────────
      if (fs.existsSync(backupDbPath)) {
        const dateFolders = safeRead(backupDbPath)
          .filter(d => !d.startsWith('.'))
          .filter(d => { try { return fs.statSync(path.join(backupDbPath,d)).isDirectory(); } catch { return false; } })
          .sort((a,b) => b.localeCompare(a)); // newest first

        const days = {};
        let totalFiles = 0;
        let latestMtime = 0;

        for (const dateFolder of dateFolders) {
          const dateKey = dateFolder.length===8 && /^\d+$/.test(dateFolder)
            ? `${dateFolder.slice(0,4)}-${dateFolder.slice(4,6)}-${dateFolder.slice(6,8)}`
            : dateFolder;

          const files = safeRead(path.join(backupDbPath, dateFolder))
            .filter(f => !f.startsWith('.'))
            .map(f => buildFileEntry(path.join(backupDbPath, dateFolder, f)))
            .filter(Boolean)
            .sort((a,b) => (b.mtime||0)-(a.mtime||0)); // newest first

          if (files.length > 0) {
            days[dateKey] = files;
            totalFiles   += files.length;
            if ((files[0].mtime||0) > latestMtime) latestMtime = files[0].mtime;
          }
        }

        return {
          id: dbName, folderName: dbName, totalFiles,
          recentFile: Object.values(days)[0]?.[0] || null,
          latestMtime,
          days,
        };
      }

      // ── Flat: db/*.sql.gz ────────────────────────────────────────────────
      const files = safeRead(dbPath)
        .filter(f => /\.(sql\.gz|sql|rdb|dump|bak)$/i.test(f))
        .map(f => buildFileEntry(path.join(dbPath,f)))
        .filter(Boolean)
        .sort((a,b) => (b.mtime||0)-(a.mtime||0));

      const days = {};
      let latestMtime = 0;
      for (const f of files) {
        const d   = new Date(f.mtime);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        if (!days[key]) days[key] = [];
        days[key].push(f);
        if (f.mtime > latestMtime) latestMtime = f.mtime;
      }

      return {
        id: dbName, folderName: dbName, totalFiles: files.length,
        recentFile: files[0] || null, latestMtime,
        days,
      };
    }).filter(d => d.totalFiles > 0);

    // Sort: most recently active DB first
    treeData.sort((a,b) => (b.latestMtime||0)-(a.latestMtime||0));

    res.json({ storage: storageStats, tree: treeData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
