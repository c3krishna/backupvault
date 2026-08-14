// backend/src/services/notifier.js
// Email notifications: backup failure, daily summary, storage alerts

const nodemailer = require('nodemailer');
const db         = require('../db/connection');

function getMailer() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'mail.worktual.tech',
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls:    { rejectUnauthorized: false },
  });
}

function fmtBytes(b) {
  if (!b || b === 0) return '0 B';
  const u = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(Math.max(b,1)) / Math.log(1024));
  return (b / Math.pow(1024, i)).toFixed(1) + ' ' + u[i];
}

async function getAdminEmails() {
  try {
    const users = await db.query(
      "SELECT email FROM users WHERE is_active=1 AND role IN ('super_admin','admin')"
    );
    return users.map(u => u.email).filter(Boolean);
  } catch { return []; }
}

async function logNotification(type, subject, recipients, detail = null) {
  try {
    await db.pool.execute(
      'INSERT INTO backup_notifications (type, subject, recipients, details) VALUES (?,?,?,?)',
      [type, subject, recipients.join(','), detail]
    );
  } catch {}
}

// ── BACKUP FAILURE NOTIFICATION ───────────────────────────────────────────────
async function sendBackupFailure(runId, targetName, dbType, errorMessage) {
  const recipients = await getAdminEmails();
  if (!recipients.length) return;

  const subject = `[BackupVault] ⚠ Backup FAILED — ${targetName}`;
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#c92a2a;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
        <h2 style="margin:0;font-size:18px">⚠ Backup Job Failed</h2>
      </div>
      <div style="background:#f8f9fb;padding:20px;border:1px solid #dee2e6;border-radius:0 0 8px 8px">
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:6px 0;color:#868e96;width:130px">Target</td>
              <td style="padding:6px 0;font-weight:600">${targetName}</td></tr>
          <tr><td style="padding:6px 0;color:#868e96">DB Type</td>
              <td style="padding:6px 0">${dbType?.toUpperCase()}</td></tr>
          <tr><td style="padding:6px 0;color:#868e96">Run ID</td>
              <td style="padding:6px 0;font-family:monospace">#${runId}</td></tr>
          <tr><td style="padding:6px 0;color:#868e96">Time</td>
              <td style="padding:6px 0">${new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}</td></tr>
          <tr><td style="padding:6px 0;color:#868e96">Error</td>
              <td style="padding:6px 0;color:#c92a2a;font-family:monospace;font-size:12px">${errorMessage?.substring(0,300)}</td></tr>
        </table>
        <div style="margin-top:16px;padding:10px 14px;background:#fff3cd;border-radius:6px;font-size:13px">
          Action required: Check Live Logs in BackupVault for full details.
        </div>
        <a href="${process.env.APP_URL||'https://backupvault.worktual.tech'}/live-logs"
           style="display:inline-block;margin-top:14px;padding:8px 16px;background:#1864ab;color:#fff;
           border-radius:6px;text-decoration:none;font-size:13px">View Live Logs →</a>
      </div>
      <p style="font-size:11px;color:#adb5bd;margin-top:12px;text-align:center">
        BackupVault · Worktual Innovations · Chennai
      </p>
    </div>`;

  try {
    await getMailer().sendMail({ from:`"BackupVault" <${process.env.SMTP_USER}>`, to:recipients, subject, html });
    await logNotification('backup_failed', subject, recipients, `runId=${runId} target=${targetName} error=${errorMessage?.substring(0,200)}`);
    console.log(`[Notifier] Failure email sent for run #${runId} to ${recipients.join(',')}`);
  } catch (e) {
    console.error('[Notifier] Failed to send failure email:', e.message);
  }
}

// ── DAILY SUMMARY EMAIL ───────────────────────────────────────────────────────
async function sendDailySummary() {
  const recipients = await getAdminEmails();
  if (!recipients.length) {
    console.log('[Notifier] No admin emails — skipping daily summary');
    return;
  }

  // Gather today's stats
  const today  = new Date().toISOString().split('T')[0];
  const [runs] = await Promise.all([
    db.query(`SELECT br.*, bt.name target_name, bt.db_type
              FROM backup_runs br JOIN backup_targets bt ON br.target_id=bt.id
              WHERE DATE(br.started_at)=? ORDER BY br.started_at DESC`, [today]),
  ]).catch(() => [[]]);

  const total   = runs.length;
  const success = runs.filter(r => r.status==='success').length;
  const failed  = runs.filter(r => r.status==='failed').length;
  const partial = runs.filter(r => r.status==='partial').length;
  const totalBytes = runs.reduce((s,r) => s+(r.file_size_bytes||0), 0);
  const successRate = total > 0 ? Math.round(success/total*100) : 100;
  const statusColor = failed > 0 ? '#c92a2a' : partial > 0 ? '#e67700' : '#2b8a3e';
  const statusText  = failed > 0 ? `⚠ ${failed} FAILED` : partial > 0 ? `⚠ ${partial} PARTIAL` : '✓ ALL SUCCESS';

  const runRows = runs.slice(0,15).map(r => {
    const dur = r.completed_at
      ? Math.round((new Date(r.completed_at)-new Date(r.started_at))/1000)+'s' : '—';
    const sc  = r.status==='success'?'#2b8a3e':r.status==='failed'?'#c92a2a':'#e67700';
    return `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #dee2e6">${r.target_name}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #dee2e6">${r.db_type?.toUpperCase()}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #dee2e6">${r.backup_type}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #dee2e6;color:${sc};font-weight:600">${r.status.toUpperCase()}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #dee2e6">${fmtBytes(r.file_size_bytes)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #dee2e6">${dur}</td>
    </tr>`;
  }).join('');

  const subject = `[BackupVault] Daily Summary ${today} — ${statusText}`;
  const html = `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto">
      <div style="background:#1864ab;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
        <h2 style="margin:0;font-size:18px">📊 BackupVault Daily Summary</h2>
        <p style="margin:4px 0 0;font-size:13px;opacity:.85">${today} · Worktual Innovations</p>
      </div>
      <div style="background:#f8f9fb;padding:20px;border:1px solid #dee2e6">
        <!-- KPI row -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">
          ${[
            ['Total Runs',    total,                  '#1864ab'],
            ['Successful',    success,                '#2b8a3e'],
            ['Failed',        failed,                 failed>0?'#c92a2a':'#868e96'],
            ['Success Rate',  successRate+'%',        statusColor],
          ].map(([l,v,c])=>`
          <div style="background:#fff;border:1px solid #dee2e6;border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:11px;color:#868e96;margin-bottom:4px">${l}</div>
            <div style="font-size:22px;font-weight:700;color:${c}">${v}</div>
          </div>`).join('')}
        </div>
        <div style="background:#fff;border:1px solid #dee2e6;border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px">
          <strong>Total data backed up today:</strong> <span style="color:#1864ab;font-size:16px;font-weight:700">${fmtBytes(totalBytes)}</span>
          &nbsp;&nbsp;·&nbsp;&nbsp;<strong>Status:</strong> <span style="color:${statusColor};font-weight:700">${statusText}</span>
        </div>
        <!-- Run table -->
        ${total > 0 ? `
        <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #dee2e6;border-radius:8px;overflow:hidden">
          <thead><tr style="background:#e9ecef">
            <th style="padding:8px 10px;text-align:left;font-size:11px;color:#495057">TARGET</th>
            <th style="padding:8px 10px;text-align:left;font-size:11px;color:#495057">TYPE</th>
            <th style="padding:8px 10px;text-align:left;font-size:11px;color:#495057">MODE</th>
            <th style="padding:8px 10px;text-align:left;font-size:11px;color:#495057">STATUS</th>
            <th style="padding:8px 10px;text-align:left;font-size:11px;color:#495057">SIZE</th>
            <th style="padding:8px 10px;text-align:left;font-size:11px;color:#495057">DURATION</th>
          </tr></thead>
          <tbody>${runRows}</tbody>
        </table>` : '<p style="color:#868e96;text-align:center">No backup runs today.</p>'}
        <a href="${process.env.APP_URL||'https://backupvault.worktual.tech'}/dashboard"
           style="display:inline-block;margin-top:16px;padding:8px 16px;background:#1864ab;color:#fff;
           border-radius:6px;text-decoration:none;font-size:13px">Open Dashboard →</a>
      </div>
      <p style="font-size:11px;color:#adb5bd;margin-top:12px;text-align:center">
        BackupVault · Worktual Innovations · Chennai · Daily report at 09:00 IST
      </p>
    </div>`;

  try {
    await getMailer().sendMail({ from:`"BackupVault" <${process.env.SMTP_USER}>`, to:recipients, subject, html });
    await logNotification('daily_summary', subject, recipients, `total=${total} success=${success} failed=${failed} bytes=${totalBytes}`);
    console.log(`[Notifier] Daily summary sent to ${recipients.join(',')}`);
  } catch (e) {
    console.error('[Notifier] Failed to send daily summary:', e.message);
  }
}

// ── STORAGE ALERT ─────────────────────────────────────────────────────────────
async function sendStorageAlert(location, path, usedPct, level='warn') {
  const recipients = await getAdminEmails();
  if (!recipients.length) return;
  const col  = level==='critical' ? '#c92a2a' : '#e67700';
  const icon = level==='critical' ? '🚨' : '⚠';
  const subject = `[BackupVault] ${icon} Storage ${level==='critical'?'CRITICAL':'Warning'} — ${location} at ${usedPct}%`;
  const html = `
    <div style="font-family:sans-serif;max-width:500px">
      <div style="background:${col};color:#fff;padding:14px 18px;border-radius:8px 8px 0 0">
        <h2 style="margin:0">${icon} Storage ${level==='critical'?'Critical':'Warning'}</h2>
      </div>
      <div style="background:#f8f9fb;padding:18px;border:1px solid #dee2e6;border-radius:0 0 8px 8px">
        <p><strong>${location}</strong> (<code>${path}</code>) is at <strong style="color:${col};font-size:18px">${usedPct}%</strong></p>
        ${level==='critical'
          ? '<p style="color:#c92a2a">⚠ Critical threshold exceeded. New backups may fail. Immediate action required.</p>'
          : '<p style="color:#e67700">Rule 2: Move backups older than 50 days to Secondary DC to free space.</p>'}
        <a href="${process.env.APP_URL||'https://backupvault.worktual.tech'}/primary-dc"
           style="display:inline-block;margin-top:12px;padding:8px 14px;background:#1864ab;color:#fff;border-radius:6px;text-decoration:none;font-size:13px">
          View Storage →</a>
      </div>
    </div>`;
  try {
    await getMailer().sendMail({ from:`"BackupVault" <${process.env.SMTP_USER}>`, to:recipients, subject, html });
    await logNotification(level==='critical'?'storage_critical':'storage_warn', subject, recipients);
    console.log(`[Notifier] Storage ${level} alert sent: ${location} ${usedPct}%`);
  } catch (e) {
    console.error('[Notifier] Storage alert email failed:', e.message);
  }
}

module.exports = { sendBackupFailure, sendDailySummary, sendStorageAlert };
