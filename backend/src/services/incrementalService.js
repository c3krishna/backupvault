'use strict';
// Incremental backup — scripts live on db-backup (10.180.0.90).
// BackupVault SSHes in as root (key auth) to read logs and run the wrappers.
// Each wrapper rsyncs a staged .sql.gz from local staging to Remote Onsite.

const path = require('path');
const { spawn, execFileSync } = require('child_process');

const SSH_HOST = process.env.INCREMENTAL_SSH_HOST || '10.180.0.90';
const SSH_USER = process.env.INCREMENTAL_SSH_USER || 'root';
const SCRIPT_DIR = process.env.INCREMENTAL_SCRIPTS_DIR
  || '/usr/local/src/scripts_for_incremental_backup';
const CRON = process.env.INCREMENTAL_CRON || '0 */4 * * *';
const TZ = process.env.INCREMENTAL_TZ || 'Asia/Kolkata';
const JOB_TIMEOUT_MS = parseInt(process.env.INCREMENTAL_JOB_TIMEOUT_MS || String(3 * 60 * 60 * 1000), 10);

const SSH_OPTS = [
  '-o', 'BatchMode=yes',
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'ConnectTimeout=8',
];

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

let cycleRunning = false;
let lastCycle = { startedAt: null, finishedAt: null, trigger: null, results: null, error: null };

function sshTarget() {
  return `${SSH_USER}@${SSH_HOST}`;
}

function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function jobById(id) {
  return JOBS.find((j) => j.id === id) || null;
}

function runAllowed() {
  const v = String(process.env.INCREMENTAL_ALLOW_RUN || 'true').toLowerCase();
  return v !== 'false' && v !== '0';
}

function sshExec(remoteCmd, timeoutMs = 20000) {
  return execFileSync('ssh', SSH_OPTS.concat([sshTarget(), remoteCmd]), {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function sshPython(code, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ssh', SSH_OPTS.concat([sshTarget(), 'python3', '-']), {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const t = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`SSH to ${sshTarget()} timed out`));
    }, timeoutMs);
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('error', (err) => { clearTimeout(t); reject(err); });
    proc.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) resolve(stdout);
      else reject(new Error((stderr || stdout || `ssh exited ${code}`).trim()));
    });
    proc.stdin.end(code);
  });
}

function parseLog(text) {
  const lines = String(text || '').split(/\r?\n/).filter(Boolean);
  let lastSuccess = null;
  let lastError = null;
  const lastLine = lines[lines.length - 1] || null;
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

function nextFourHourSlot(timeZone) {
  const cand = new Date(Date.now() + 1000);
  cand.setSeconds(0, 0);
  for (let i = 0; i < 60 * 5; i++) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(cand).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value])
    );
    if (Number(parts.minute) === 0 && Number(parts.hour) % 4 === 0) return cand.toISOString();
    cand.setMinutes(cand.getMinutes() + 1);
  }
  return null;
}

function probeHost() {
  try {
    return sshExec('echo ok', 8000).trim() === 'ok';
  } catch (e) {
    return false;
  }
}

function getMeta(extra = {}) {
  return {
    sshUser: SSH_USER,
    sshHost: SSH_HOST,
    sshTarget: sshTarget(),
    scriptsDir: SCRIPT_DIR,
    cron: CRON,
    timezone: TZ,
    cronLabel: 'every 4 hours',
    nextRunAt: CRON === '0 */4 * * *' ? nextFourHourSlot(TZ) : null,
    runEnabled: runAllowed(),
    cycleRunning,
    lastCycle,
    ...extra,
  };
}

async function collectRemoteStatus() {
  const payload = JOBS.map((j) => ({
    id: j.id,
    logFile: j.logFile,
    srcPath: path.posix.join(j.srcDir, j.srcFile),
    lockFile: j.lockFile,
  }));
  const code = `
import json, os, time
jobs = json.loads(${JSON.stringify(JSON.stringify(payload))})
out = []
for j in jobs:
    lock = {"held": False, "pid": None, "stale": False}
    try:
        with open(j["lockFile"]) as f:
            raw = f.read().strip()
        pid = int(raw) if raw else 0
        if pid:
            try:
                os.kill(pid, 0)
                lock = {"held": True, "pid": pid, "stale": False}
            except OSError:
                lock = {"held": False, "pid": pid, "stale": True}
    except Exception:
        pass
    source = {"present": False, "path": j["srcPath"], "size": None, "mtime": None}
    try:
        st = os.stat(j["srcPath"])
        source = {
            "present": True,
            "path": j["srcPath"],
            "size": st.st_size,
            "mtime": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(st.st_mtime)),
        }
    except Exception:
        pass
    log_exists = False
    log_mtime = None
    log_text = ""
    try:
        st = os.stat(j["logFile"])
        log_exists = True
        log_mtime = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(st.st_mtime))
        with open(j["logFile"], errors="replace") as f:
            log_text = f.read()
    except Exception:
        pass
    out.append({
        "id": j["id"],
        "lock": lock,
        "source": source,
        "logExists": log_exists,
        "logMtime": log_mtime,
        "logText": log_text,
    })
print(json.dumps(out))
`;
  const raw = await sshPython(code);
  return JSON.parse(raw);
}

function decorateJob(job, remote) {
  const lock = remote?.lock || { held: false };
  const source = remote?.source || {
    present: false,
    path: path.posix.join(job.srcDir, job.srcFile),
    size: null,
    mtime: null,
  };
  const parsed = parseLog(remote?.logText || '');
  const logExists = !!remote?.logExists;
  const status = deriveStatus({ logExists, parsed, lock });
  return {
    id: job.id,
    name: job.name,
    script: job.script,
    scriptPath: path.posix.join(SCRIPT_DIR, job.script),
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
    logMtime: remote?.logMtime || null,
    logExists,
    lock,
    source,
  };
}

async function listJobs() {
  const hostReachable = probeHost();
  if (!hostReachable) {
    return {
      jobs: JOBS.map((job) => decorateJob(job, null)),
      meta: getMeta({ hostReachable: false, hostError: `Cannot SSH to ${sshTarget()} (BatchMode / key auth)` }),
    };
  }
  try {
    const remote = await collectRemoteStatus();
    const byId = Object.fromEntries(remote.map((r) => [r.id, r]));
    return {
      jobs: JOBS.map((job) => decorateJob(job, byId[job.id])),
      meta: getMeta({ hostReachable: true }),
    };
  } catch (e) {
    return {
      jobs: JOBS.map((job) => decorateJob(job, null)),
      meta: getMeta({ hostReachable: true, hostError: e.message }),
    };
  }
}

async function getLog(id, tail = 200) {
  const job = jobById(id);
  if (!job) return null;
  const n = Math.min(Math.max(parseInt(tail, 10) || 200, 1), 2000);
  const cmd = `if [ -f ${shQuote(job.logFile)} ]; then wc -l < ${shQuote(job.logFile)}; echo '---BV---'; tail -n ${n} ${shQuote(job.logFile)}; else echo MISSING; fi`;
  try {
    const text = sshExec(cmd, 20000);
    const trimmed = text.replace(/\r/g, '');
    if (trimmed.trim() === 'MISSING') {
      return { id: job.id, logFile: job.logFile, totalLines: 0, text: '', exists: false };
    }
    const sep = '\n---BV---\n';
    const idx = trimmed.indexOf(sep);
    if (idx === -1) {
      return { id: job.id, logFile: job.logFile, totalLines: 0, text: trimmed, exists: true };
    }
    const totalLines = parseInt(trimmed.slice(0, idx).trim(), 10) || 0;
    return { id: job.id, logFile: job.logFile, totalLines, text: trimmed.slice(idx + sep.length), exists: true };
  } catch (e) {
    return { id: job.id, logFile: job.logFile, totalLines: 0, text: '', exists: false, error: e.message };
  }
}

function sshRunScript(scriptPath, { wait }) {
  const remote = `bash ${shQuote(scriptPath)}`;
  if (!wait) {
    const background = `nohup ${remote} >/dev/null 2>&1 & echo $!`;
    return new Promise((resolve, reject) => {
      const proc = spawn('ssh', SSH_OPTS.concat([sshTarget(), background]), { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d) => { stdout += d; });
      proc.stderr.on('data', (d) => { stderr += d; });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code !== 0) return reject(new Error((stderr || stdout || `ssh exited ${code}`).trim()));
        resolve({ host: sshTarget(), script: scriptPath, pid: parseInt(stdout.trim(), 10) || null, detached: true });
      });
    });
  }
  return new Promise((resolve, reject) => {
    const proc = spawn('ssh', SSH_OPTS.concat([sshTarget(), remote]), { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const t = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Job timed out after ${JOB_TIMEOUT_MS}ms: ${scriptPath}`));
    }, JOB_TIMEOUT_MS);
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('error', (err) => { clearTimeout(t); reject(err); });
    proc.on('close', (code) => {
      clearTimeout(t);
      resolve({ host: sshTarget(), script: scriptPath, exitCode: code, stdout, stderr });
    });
  });
}

function runJob(id, { wait = false, fromScheduler = false } = {}) {
  const job = jobById(id);
  if (!job) return Promise.reject(new Error('Unknown job'));
  if (!fromScheduler && !runAllowed()) {
    return Promise.reject(new Error('Script run from UI is disabled. Set INCREMENTAL_ALLOW_RUN=true to enable.'));
  }
  const scriptPath = path.posix.join(SCRIPT_DIR, job.script);
  return sshRunScript(scriptPath, { wait });
}

async function runCycle(trigger) {
  const results = [];
  try {
    for (const job of JOBS) {
      console.log(`[Incremental] ${trigger}: starting ${job.id} on ${sshTarget()}`);
      try {
        const r = await runJob(job.id, { wait: true, fromScheduler: true });
        const entry = {
          id: job.id,
          ok: r.exitCode === 0 || r.exitCode === 2,
          exitCode: r.exitCode,
        };
        results.push(entry);
        console.log(`[Incremental] ${job.id} exit=${r.exitCode ?? 'detached'}`);
      } catch (e) {
        results.push({ id: job.id, ok: false, error: e.message });
        console.error(`[Incremental] ${job.id} error: ${e.message}`);
      }
    }
    lastCycle = { ...lastCycle, finishedAt: new Date().toISOString(), results, error: null };
    return { skipped: false, results };
  } catch (e) {
    lastCycle = { ...lastCycle, finishedAt: new Date().toISOString(), results, error: e.message };
    throw e;
  } finally {
    cycleRunning = false;
  }
}

function startCycleInBackground(trigger) {
  if (cycleRunning) return { skipped: true, reason: 'A sync cycle is already running' };
  cycleRunning = true;
  lastCycle = { startedAt: new Date().toISOString(), finishedAt: null, trigger, results: null, error: null };
  runCycle(trigger).catch((e) => {
    console.error('[Incremental] cycle error:', e.message);
  });
  return { skipped: false, started: true, trigger, host: sshTarget() };
}

function runAllJobs(opts = {}) {
  return startCycleInBackground(opts.trigger || 'scheduled');
}

module.exports = {
  JOBS,
  SCRIPT_DIR,
  CRON,
  TZ,
  listJobs,
  getLog,
  runJob,
  runAllowed,
  runAllJobs,
  startCycleInBackground,
  jobById,
  getMeta,
  probeHost,
};
