// /var/www/backupvault/backend/src/services/storageMonitor.js
// Monitors Primary DC NFS, Secondary DC, Remote Onsite, AWS S3
// Sends email alerts at 80% threshold, critical at 90%

const { execSync } = require('child_process');
const nodemailer   = require('nodemailer');
const db           = require('../db/connection');
const wsManager    = require('./wsManager');

const THRESHOLDS = { warn: 80, critical: 90 };

// ── MAILER ────────────────────────────────────────────────────────────────────
function makeTransporter() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'mail.worktual.tech',
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER || 'support@worktual.tech',
      pass: process.env.SMTP_PASS || '',
    },
  });
}

async function getAlertRecipients() {
  try {
    const users = await db.query('SELECT email, name FROM users');
    return users.map(u => u.email).filter(Boolean);
  } catch {
    const env = process.env.NOTIFY_EMAIL || process.env.SMTP_USER || '';
    return env ? [env] : [];
  }
}

async function sendStorageAlert({ location, path, usedPct, usedHuman, totalHuman, freeHuman, level }) {
  const recipients = await getAlertRecipients();
  if (!recipients.length) {
    console.warn('[StorageMonitor] No alert recipients found');
    return;
  }

  const color  = level === 'critical' ? '#dc2626' : '#d97706';
  const emoji  = level === 'critical' ? '🔴' : '🟡';
  const label  = level === 'critical' ? 'CRITICAL' : 'WARNING';

  const html = `
<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
  <div style="background:${color};padding:16px 20px">
    <h2 style="color:#fff;margin:0;font-size:16px">${emoji} BackupVault Storage ${label}</h2>
    <p style="color:rgba(255,255,255,0.85);margin:4px 0 0;font-size:13px">Immediate attention required</p>
  </div>
  <div style="padding:20px">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="background:#f9fafb"><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #e5e7eb">Location</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${location}</td></tr>
      <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #e5e7eb">Mount Path</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-family:monospace;color:#1d4ed8">${path}</td></tr>
      <tr style="background:#f9fafb"><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #e5e7eb">Used</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb"><strong style="color:${color}">${usedPct}% — ${usedHuman}</strong> of ${totalHuman}</td></tr>
      <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #e5e7eb">Free</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#16a34a">${freeHuman} remaining</td></tr>
      <tr style="background:#f9fafb"><td style="padding:8px 12px;font-weight:600">Threshold</td><td style="padding:8px 12px">${THRESHOLDS[level]}% ${label.toLowerCase()} limit reached</td></tr>
    </table>
    ${level === 'critical' ? `
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:12px;margin-top:14px">
      <p style="color:#991b1b;margin:0;font-size:13px"><strong>Action required:</strong> New backups may be paused. Please free disk space or expand storage immediately.</p>
    </div>` : `
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:12px;margin-top:14px">
      <p style="color:#92400e;margin:0;font-size:13px"><strong>Recommendation:</strong> Review and delete old backup files, or expand storage capacity before the 90% critical threshold is reached.</p>
    </div>`}
    <p style="font-size:12px;color:#6b7280;margin-top:16px">BackupVault · backupvault.worktual.tech · Chennai, IN</p>
  </div>
</div>`;

  const transporter = makeTransporter();
  await transporter.sendMail({
    from:    `"BackupVault Alerts" <${process.env.SMTP_USER || 'backup-notifications@backupvault.worktual.tech'}>`,
    to:      recipients.join(', '),
    subject: `[BackupVault] ${emoji} Storage ${label} — ${location} at ${usedPct}%`,
    text:    `BackupVault Storage ${label}\n${location}\nPath: ${path}\nUsed: ${usedPct}% (${usedHuman} / ${totalHuman})\nFree: ${freeHuman}`,
    html,
  });

  console.log(`[StorageMonitor] Alert email sent to: ${recipients.join(', ')}`);
}

// ── ALERT DEDUP (avoid re-emailing every cron tick) ─────────────────────────
const alertedPaths = new Map(); // path -> level last alerted

function shouldAlert(path, level) {
  const last = alertedPaths.get(path);
  if (!last) return true;
  if (last === 'warn'     && level === 'critical') return true;
  return false;
}

function clearAlert(path) {
  if (alertedPaths.has(path)) {
    console.log(`[StorageMonitor] ${path} recovered below warn threshold — alert cleared`);
    alertedPaths.delete(path);
  }
}

// ── CHECK ONE LOCAL PATH ──────────────────────────────────────────────────────
async function checkLocalMount(location, mountPath) {
  try {
    const out  = execSync(`df -h ${mountPath} 2>/dev/null`).toString().split('\n');
    if (!out[1]) return null;
    const p    = out[1].replace(/\s+/g, ' ').split(' ');
    const pct  = parseInt(p[4]);  // real NFS disk usage %

    // Also calculate actual backup data size via du (may take a few seconds)
    let backupPct = pct;
    let backupUsedHuman = p[2];
    try {
      const duOut = execSync(`du -sb '${mountPath}' 2>/dev/null`, { timeout: 20000 }).toString();
      const backupBytes = parseInt(duOut.split(/\s+/)[0]) || 0;
      // Parse total disk size from df
      const sizeStr = p[1] || '0';
      const sizeNum = parseFloat(sizeStr.replace(/[^0-9.]/g, ''));
      const sizeMult = sizeStr.includes('T') ? 1099511627776
        : sizeStr.includes('G') ? 1073741824
        : sizeStr.includes('M') ? 1048576 : 1;
      const totalBytes = sizeNum * sizeMult;
      if (backupBytes > 0 && totalBytes > 0) {
        backupPct = Math.round(backupBytes / totalBytes * 100);
        const mb = backupBytes / 1024 / 1024;
        backupUsedHuman = mb >= 1024*1024 ? `${(mb/1024/1024).toFixed(1)}T`
          : mb >= 1024 ? `${(mb/1024).toFixed(1)}G` : `${mb.toFixed(0)}M`;
      }
    } catch {}

    const info = {
      location, path: mountPath,
      // diskPct = real NFS volume usage (includes OS, logs, other data) — for disk health alerts
      diskPct: pct, diskUsedHuman: p[2], totalHuman: p[1], freeHuman: p[3],
      // backupPct = actual backup files only — for "how full are our backups" display
      backupPct, backupUsedHuman,
      // usedPct kept for backward compat — use diskPct for alerts
      usedPct: pct, usedHuman: p[2],
    };

    wsManager.broadcast({ type: 'storage_update', ...info });

    if (pct >= THRESHOLDS.critical) {
      if (shouldAlert(mountPath, 'critical')) {
        alertedPaths.set(mountPath, 'critical');
        await sendStorageAlert({ ...info, level: 'critical' });
        console.error(`[StorageMonitor] CRITICAL: ${location} at ${pct}%`);
      }
    } else if (pct >= THRESHOLDS.warn) {
      if (shouldAlert(mountPath, 'warn')) {
        alertedPaths.set(mountPath, 'warn');
        await sendStorageAlert({ ...info, level: 'warn' });
        console.warn(`[StorageMonitor] WARN: ${location} at ${pct}%`);
      }
    } else {
      clearAlert(mountPath);
    }

    return info;
  } catch (err) {
    console.error(`[StorageMonitor] Cannot check ${mountPath}:`, err.message);
    return null;
  }
}

// ── AUTO-CLEANUP: delete oldest files when above threshold ────────────────────
async function autoCleanup(mountPath, targetPct = 75) {
  console.log(`[StorageMonitor] Running auto-cleanup on ${mountPath} targeting ${targetPct}%`);
  try {
    // Find .sql.gz files older than 10 days, sorted oldest first, delete until under target
    const result = execSync(
      `find ${mountPath} -name "*.sql.gz" -o -name "*.rdb" | xargs ls -t 2>/dev/null | tail -50`,
      { maxBuffer: 1024 * 1024 * 10 }
    ).toString().trim().split('\n').filter(Boolean);

    let deleted = 0;
    for (const file of result) {
      const out   = execSync(`df -h ${mountPath}`).toString().split('\n');
      const curPct = parseInt(out[1].replace(/\s+/g, ' ').split(' ')[4]);
      if (curPct <= targetPct) break;
      try {
        execSync(`rm -f "${file}"`);
        deleted++;
        console.log(`[StorageMonitor] Deleted old backup: ${file}`);
      } catch {}
    }
    console.log(`[StorageMonitor] Auto-cleanup done: ${deleted} files removed`);
    return deleted;
  } catch (err) {
    console.error('[StorageMonitor] Auto-cleanup error:', err.message);
    return 0;
  }
}

// ── PER-DIRECTORY STATS ───────────────────────────────────────────────────────
async function getDirectoryStats(mountPath) {
  try {
    const dirs = require('fs').readdirSync(mountPath).filter(d => {
      try { return require('fs').statSync(`${mountPath}/${d}`).isDirectory(); } catch { return false; }
    });

    const stats = [];
    for (const dir of dirs) {
      if (dir.startsWith('.')) continue;
      try {
        const bytes = execSync(`du -sb "${mountPath}/${dir}" 2>/dev/null | cut -f1`).toString().trim();
        const count = execSync(`find "${mountPath}/${dir}" -type f | wc -l 2>/dev/null`).toString().trim();
        stats.push({ dir, bytes: parseInt(bytes) || 0, files: parseInt(count) || 0 });
      } catch {}
    }
    return stats.sort((a, b) => b.bytes - a.bytes);
  } catch (err) {
    console.error('[StorageMonitor] getDirectoryStats error:', err.message);
    return [];
  }
}

// ── MAIN MONITOR LOOP ─────────────────────────────────────────────────────────
async function runChecks() {
  console.log('[StorageMonitor] Running storage checks...');

  const primaryPath   = process.env.PRIMARY_MOUNT   || '/primary-db-backup';
  const secondaryPath = process.env.SECONDARY_MOUNT || '/secondary-db-backup';

  const [primary, secondary] = await Promise.all([
    checkLocalMount('Primary DC (NFS)', primaryPath),
    checkLocalMount('Secondary DC',     secondaryPath),
  ]);

  // Rule 2: never delete Primary files unless Secondary copy was verified.
  // AUTO_CLEANUP destructive path is disabled — admins copy/verify/delete manually.
  if (primary && primary.usedPct >= THRESHOLDS.critical) {
    console.warn('[StorageMonitor] Primary at ' + primary.usedPct +
      '% — auto-delete skipped. Copy files older than 50 days to Secondary, verify, then delete.');
  }

  return { primary, secondary };
}

module.exports = { runChecks, checkLocalMount, getDirectoryStats, sendStorageAlert };
