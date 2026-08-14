// backend/src/routes/fs.js
// Primary DC NFS - shows actual backup data size AND real disk usage separately

const express  = require('express');
const router   = express.Router();
const fs       = require('fs');
const path     = require('path');
const { execSync } = require('child_process');

function safeExec(cmd, timeout=10000) {
  try { return execSync(cmd, { timeout, maxBuffer:10*1024*1024 }).toString().trim(); } catch { return null; }
}
function safeRead(p) { try { return fs.readdirSync(p); } catch { return []; } }
function isDir(p)    { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function isBackup(n) { return /\.(sql\.gz|sql|rdb|dump|bak|gz)$/i.test(n); }

function buildFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    const sz = stat.size;
    const mb = sz/1024/1024;
    return {
      filename:  path.basename(filePath),
      size:      mb>=1024 ? `${(mb/1024).toFixed(2)} GB` : `${mb.toFixed(2)} MB`,
      sizeBytes: sz,
      mtime:     stat.mtimeMs,
      time:      stat.mtime.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}),
      status:    sz>1024 ? 'Verified' : 'Empty/Failed',
    };
  } catch { return null; }
}

// GET /api/fs/primary-mount
router.get('/fs/primary-mount', (req, res) => {
  const mountPoint = process.env.PRIMARY_MOUNT || '/primary-db-backup';

  if (!fs.existsSync(mountPoint)) {
    return res.status(404).json({ error: `Mount point not found: ${mountPoint}` });
  }

  // ── 1. Real NFS disk stats (whole volume via df) ──────────────────────────
  let diskStats   = { size:'N/A', used:'N/A', avail:'N/A', usePercent:'0%' };
  let diskPctNum  = 0;
  try {
    const dfOut = safeExec(`df -h '${mountPoint}'`);
    if (dfOut) {
      const lines = dfOut.split('\n');
      if (lines[1]) {
        const p      = lines[1].replace(/\s+/g,' ').split(' ');
        diskStats    = { size:p[1], used:p[2], avail:p[3], usePercent:p[4] };
        diskPctNum   = parseInt(p[4]) || 0;
      }
    }
  } catch {}

  // ── 2. Actual backup data size (only our backup files via du) ─────────────
  let backupUsedBytes = 0;
  let backupUsedHuman = 'N/A';
  let backupPct       = 0;
  try {
    // du -sb: sum of all backup files recursively
    const duOut = safeExec(`du -sb '${mountPoint}' 2>/dev/null`, 30000);
    if (duOut) {
      backupUsedBytes = parseInt(duOut.split(/\s+/)[0]) || 0;
    }
    // Convert total disk size to bytes for pct calculation
    const sizeStr = diskStats.size || '0';
    const sizeNum = parseFloat(sizeStr.replace(/[^0-9.]/g,''));
    const sizeMult = sizeStr.includes('T') ? 1099511627776
      : sizeStr.includes('G') ? 1073741824
      : sizeStr.includes('M') ? 1048576 : 1;
    const totalDiskBytes = sizeNum * sizeMult;

    if (backupUsedBytes > 0) {
      const mb = backupUsedBytes / 1024 / 1024;
      const gb = mb / 1024;
      const tb = gb / 1024;
      backupUsedHuman = tb >= 1 ? `${tb.toFixed(2)} TB`
        : gb >= 1 ? `${gb.toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
      backupPct = totalDiskBytes > 0
        ? Math.round(backupUsedBytes / totalDiskBytes * 100) : 0;
    }
  } catch {}

  // Combined storage object returned to frontend:
  // usePercent = REAL disk usage (df) — NFS volume occupancy
  // backupUsed = actual backup data stored in our path
  const storageStats = {
    ...diskStats,
    backupUsedHuman,
    backupUsedBytes,
    backupPct: `${backupPct}%`,
    // Clarifying labels for the UI
    diskLabel:   `NFS volume: ${diskStats.used} used of ${diskStats.size} (${diskStats.usePercent})`,
    backupLabel: `Backup data in /primary-db-backup: ${backupUsedHuman} (${backupPct}%)`,
  };

  // ── 3. Directory tree ──────────────────────────────────────────────────────
  try {
    const dbDirs = safeRead(mountPoint)
      .filter(n => !n.startsWith('.'))
      .filter(n => isDir(path.join(mountPoint, n)));

    const treeData = dbDirs.map(dbName => {
      const dbPath       = path.join(mountPoint, dbName);
      const backupDbPath = path.join(dbPath, 'Backup_DB');

      // ── Structured: db/Backup_DB/YYYYMMDD/ ──────────────────────────────
      if (fs.existsSync(backupDbPath)) {
        const dateFolders = safeRead(backupDbPath)
          .filter(d => !d.startsWith('.') && isDir(path.join(backupDbPath,d)))
          .sort((a,b) => b.localeCompare(a)); // newest date first

        const days = {};
        let totalFiles = 0;
        let latestMtime = 0;

        for (const dateFolder of dateFolders) {
          const dfPath  = path.join(backupDbPath, dateFolder);
          const dateKey = /^\d{8}$/.test(dateFolder)
            ? `${dateFolder.slice(0,4)}-${dateFolder.slice(4,6)}-${dateFolder.slice(6,8)}`
            : dateFolder;

          const files = safeRead(dfPath)
            .filter(f => !f.startsWith('.'))
            .map(f => buildFile(path.join(dfPath, f)))
            .filter(Boolean)
            .sort((a,b) => (b.mtime||0) - (a.mtime||0));

          if (files.length > 0) {
            days[dateKey] = files;
            totalFiles   += files.length;
            if ((files[0].mtime||0) > latestMtime) latestMtime = files[0].mtime;
          }
        }

        return {
          id: dbName, folderName: dbName, totalFiles,
          recentFile: Object.values(days)[0]?.[0] || null,
          latestMtime, days,
        };
      }

      // ── Flat structure ────────────────────────────────────────────────────
      const files = safeRead(dbPath)
        .filter(f => isBackup(f))
        .map(f => buildFile(path.join(dbPath,f)))
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
        recentFile: files[0] || null, latestMtime, days,
      };
    }).filter(Boolean);

    // Sort by most recent activity first
    treeData.sort((a,b) => (b.latestMtime||0)-(a.latestMtime||0));

    res.json({ storage: storageStats, tree: treeData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/fs/secondary-mount — re-export from secondaryfs.js
router.get('/fs/secondary-mount', (req, res, next) => next());

module.exports = router;
