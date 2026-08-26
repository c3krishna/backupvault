'use strict';
// Incremental backup script status — reads logs written by scripts_for_incremental_backup/

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const SCRIPT_DIR = process.env.INCREMENTAL_SCRIPTS_DIR
  || path.join(__dirname, '..', '..', '..', 'scripts_for_incremental_backup');

const JOBS = [
  {
    id: 'ccaas', name: 'CCAAS', script: 'ccaas_db_sync.sh',
    logFile: '/var/log/ccaas-incremental.log',
    srcDir: '/home/incremental_backup/ccaas', srcFile: 'ccaas2023-full.sql.gz',
    destHost: 'root@192.168.12.243', destDir: '/home/worktual/ccaas',
    lockFile: '/tmp/ccaas_db_sync.lock',
  },
  {
    id: 'ccaas_ai', name: 'CCAAS AI', script: 'ccaas_ai_db_sync.sh',
    logFile: '/var/log/ccaas_ai-incremental.log',
    srcDir: '/home/incremental_backup/ccaas_ai', srcFile: 'ccaas_ai-full.sql.gz',
    destHost: 'root@192.168.12.243', destDir: '/home/worktual/ccaas_ai',
    lockFile: '/tmp/ccaas_ai_db_sync.lock',
  },
  {
    id: 'ai_worktual_crm', name: 'AI Worktual CRM', script: 'ai_worktual_crm_db_sync.sh',
    logFile: '/var/log/ai_worktual_crm-incremental.log',
    srcDir: '/home/incremental_backup/ai_worktual_crm', srcFile: 'ai_worktual_crm-full.sql.gz',
    destHost: 'root@192.168.12.243', destDir: '/home/worktual/ai_worktual_crm',
    lockFile: '/tmp/ai_worktual_crm_db_sync.lock',
  },
  {
    id: 'unifiedring', name: 'Unifiedring', script: 'unifiedring_db_sync.sh',
    logFile: '/var/log/unifiedring-incremental.log',
    srcDir: '/home/incremental_backup/unifiedring', srcFile: 'unifiedring-full.sql.gz',
    destHost: 'root@192.168.12.243', destDir: '/home/worktual/unifiedring',
    lockFile: '/tmp/unifiedring_db_sync.lock',
  },
  {
    id: 'marketing_automation', name: 'Marketing Automation', script: 'marketing_automation_db_sync.sh',
    logFile: '/var/log/marketing_automation-incremental.log',
    srcDir: '/home/incremental_backup/marketing_automation', srcFile: 'marketing_automation-full.sql.gz',
    destHost: 'root@192.168.12.243', destDir: '/home/worktual/marketing_automation',
    lockFile: '/tmp/marketing_automation_db_sync.lock',
  },
  {
    id: 'audracare', name: 'Audracare', script: 'audracare_db_sync.sh',
    logFile: '/var/log/audracare-incremental.log',
    srcDir: '/home/incremental_backup/audracare', srcFile: 'caretakemgt-full.sql.gz',
    destHost: 'root@192.168.12.243', destDir: '/home/worktual/audracare',
    lockFile: '/tmp/audracare_db_sync.lock',
  },
  {
    id: 'whatsappcampaign', name: 'Whatsappcampaign', script: 'whatsappcampaign_db_sync.sh',
    logFile: '/var/log/whatsappcampaign-incremental.log',
    srcDir: '/home/incremental_backup/whatsappcampaign', srcFile: 'whatsappcampaign-full.sql.gz',
    destHost: 'root@192.168.12.243', destDir: '/home/worktual/whatsappcampaign',
    lockFile: '/tmp/whatsappcampaign_db_sync.lock',
  },
];

function jobById(id) {
  return JOBS.find((j) => j.id === id) || null;
}

function lockHeld(lockFile) {
  try {
    if (!fs.existsSync(lockFile)) return { held: false };
    const pid = parseInt(fs.readFileSync(lockFile, 'utf8').trim(), 10);
    if (!pid) return { held: false };
    try { process.kill(pid, 0); return { held: true, pid }; }
    catch { return { held: false, stale: true, pid }; }
  } catch {
    return { held: false };
  }
}

function sourceInfo(job) {
  const filePath = path.join(job.srcDir, job.srcFile);
  try {
    const st = fs.statSync(filePath);
    return { present: true, path: filePath, size: st.size, mtime: st.mtime.toISOString() };
  } catch {
    return { present: false, path: filePath, size: null, mtime: null };
  }
}

function parseLog(text) {
  const lines = String(text || '').split(/\r?\n/).filter(Boolean);
  let lastSuccess = null;
  let lastError = null;
  let lastLine = lines[lines.length - 1] || null;
  const tsRe = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/;
  for (const line of lines) {
    const m = tsRe.exec(line);
    const ts = m ? m[1] : null;
    if (line.includes('SUCCESS:')) lastSuccess = { ts, line };
    if (line.includes('ERROR:')) lastError = { ts, line };
  }
  return { lastSuccess, lastError, lastLine, lineCount: lines.length };
}

function deriveStatus({ logExists, parsed, lock }) {
  if (lock.held) return 'running';
  if (!logExists) return 'never';
  const s = parsed.lastSuccess;
  const e = parsed.lastError;
  if (!s && !e) return 'unknown';
  if (s && e) {
    if (s.ts && e.ts) return s.ts >= e.ts ? 'success' : 'failed';
    return 'unknown';
  }
  if (s) return 'success';
  return 'failed';
}

async function tailFile(filePath, maxLines = 200) {
  const raw = await fsp.readFile(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const start = Math.max(0, lines.length - maxLines);
  return { text: lines.slice(start).join('\n'), totalLines: lines.length };
}

async function listJobs() {
  const out = [];
  for (const job of JOBS) {
    const lock = lockHeld(job.lockFile);
    const source = sourceInfo(job);
    let logExists = false;
    let logMtime = null;
    let parsed = { lastSuccess: null, lastError: null, lastLine: null, lineCount: 0 };
    try {
      const st = fs.statSync(job.logFile);
      logExists = true;
      logMtime = st.mtime.toISOString();
      const raw = fs.readFileSync(job.logFile, 'utf8');
      parsed = parseLog(raw);
    } catch {}
    const status = deriveStatus({ logExists, parsed, lock });
    out.push({
      id: job.id,
      name: job.name,
      script: job.script,
      scriptPath: path.join(SCRIPT_DIR, job.script),
      logFile: job.logFile,
      destHost: job.destHost,
      destDir: job.destDir,
      srcDir: job.srcDir,
      srcFile: job.srcFile,
      status,
      executed: status === 'success' || status === 'failed' || status === 'running',
      lastSuccessAt: parsed.lastSuccess?.ts || null,
      lastErrorAt: parsed.lastError?.ts || null,
      lastLine: parsed.lastLine,
      logMtime,
      logExists,
      lock,
      source,
    });
  }
  return out;
}

async function getLog(id, tail = 200) {
  const job = jobById(id);
  if (!job) return null;
  try {
    const { text, totalLines } = await tailFile(job.logFile, tail);
    return { id: job.id, logFile: job.logFile, totalLines, text, exists: true };
  } catch {
    return { id: job.id, logFile: job.logFile, totalLines: 0, text: '', exists: false };
  }
}

function runAllowed() {
  return String(process.env.INCREMENTAL_ALLOW_RUN || '') === 'true';
}

function runJob(id) {
  const job = jobById(id);
  if (!job) return Promise.reject(new Error('Unknown job'));
  if (!runAllowed()) return Promise.reject(new Error('Script run from UI is disabled. Set INCREMENTAL_ALLOW_RUN=true to enable.'));
  const scriptPath = path.join(SCRIPT_DIR, job.script);
  if (!fs.existsSync(scriptPath)) return Promise.reject(new Error('Script not found: ' + scriptPath));
  return new Promise((resolve, reject) => {
    const proc = spawn('bash', [scriptPath], { detached: true, stdio: 'ignore' });
    proc.on('error', reject);
    proc.unref();
    resolve({ pid: proc.pid, script: scriptPath });
  });
}

module.exports = { JOBS, SCRIPT_DIR, listJobs, getLog, runJob, runAllowed, jobById };
