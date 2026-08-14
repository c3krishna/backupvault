// /var/www/backupvault/backend/src/services/remoteSync.js
// Onsite DR Backup to 192.168.12.243 via rsync over SSH
// Tests connectivity, syncs files, reports status

const { execSync, spawn } = require('child_process');
const path   = require('path');
const db     = require('../db/connection');

// ── TEST SFTP/SSH CONNECTION ──────────────────────────────────────────────────
async function testRemoteConnection(config) {
  const { host, port = 22, user = 'root', password } = config;

  if (!host || !password) {
    return { success: false, status: 'misconfigured', error: 'Missing host or password', latency_ms: null };
  }

  const t0 = Date.now();
  try {
    execSync(
      `sshpass -p "${password}" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 -o BatchMode=no ` +
      `-p ${port} ${user}@${host} "echo bv_ok" 2>&1`,
      { timeout: 12000 }
    );
    return { success: true, status: 'connected', error: null, latency_ms: Date.now() - t0 };
  } catch (err) {
    const msg = err.stdout?.toString() || err.stderr?.toString() || err.message || '';
    let status = 'unreachable';
    if (msg.includes('Permission denied') || msg.includes('Authentication failed')) status = 'auth_failed';
    if (msg.includes('Connection refused'))  status = 'connection_refused';
    if (msg.includes('No route to host'))    status = 'no_route';
    if (msg.includes('timed out'))           status = 'timeout';
    if (msg.includes('sshpass: not found') || msg.includes('No such file')) status = 'sshpass_missing';
    return { success: false, status, error: msg.split('\n')[0].substring(0, 200), latency_ms: Date.now() - t0 };
  }
}

// ── UPDATE DESTINATION STATUS ─────────────────────────────────────────────────
async function updateRemoteStatus(destId, testResult, config) {
  const updated = {
    ...config,
    status:     testResult.success ? 'connected' : testResult.status,
    last_check: new Date().toISOString(),
    last_error: testResult.error || null,
    is_active:  testResult.success ? 1 : 0,
  };
  await db.query(
    'UPDATE backup_destinations SET config=?, is_active=? WHERE id=?',
    [JSON.stringify(updated), testResult.success ? 1 : 0, destId]
  );
  return updated;
}

// ── RSYNC A SINGLE FILE TO REMOTE ────────────────────────────────────────────
async function rsyncFileToRemote(runId, localFilePath, dest, logFn) {
  const config = typeof dest.config === 'string' ? JSON.parse(dest.config) : dest.config;
  const { host = '192.168.12.243', port = 22, user = 'root', password, path: remotePath = '/backups/remote' } = config;
  const filename = path.basename(localFilePath);

  // ── Derive folder structure from local path ───────────────────────────────
  // localFilePath: /primary-db-backup/<db>/Backup_DB/<YYYYMMDD>/<file>.sql.gz
  // remoteDest:    /backups/remote/<db>/Backup_DB/<YYYYMMDD>/<file>.sql.gz
  let remoteDir = remotePath; // fallback: flat copy
  try {
    const parts = localFilePath.split('/');
    // Find 'Backup_DB' in path to extract relative structure
    const bkIdx = parts.indexOf('Backup_DB');
    if (bkIdx > 0) {
      // e.g. parts[bkIdx-1] = 'wtms', parts[bkIdx] = 'Backup_DB', parts[bkIdx+1] = '20260707'
      const dbName  = parts[bkIdx - 1];
      const dateDir = parts[bkIdx + 1];
      remoteDir = remotePath + '/' + dbName + '/Backup_DB/' + dateDir;
    }
  } catch {}

  await logFn(runId, 'INFO', '--- Transferring to: Remote DR Server (' + dest.name + ') ---');
  await logFn(runId, 'INFO', 'Connecting to ' + host + ':' + port + ' as ' + user);

  const test = await testRemoteConnection(config);
  if (!test.success) {
    await updateRemoteStatus(dest.id, test, config);
    await logFn(runId, 'ERROR', 'Remote DR connection failed [' + test.status + ']: ' + test.error);
    if (test.status === 'sshpass_missing') {
      await logFn(runId, 'ERROR', 'Install sshpass: apt-get install -y sshpass');
    }
    throw new Error('Remote DR "' + dest.name + '" unreachable [' + test.status + ']');
  }

  // Create remote directory structure first
  const mkdirCmd = [
    'sshpass', '-p', password,
    'ssh', '-o', 'StrictHostKeyChecking=no',
    '-p', String(port),
    user + '@' + host,
    'mkdir -p "' + remoteDir + '"'
  ].join(' ');
  try {
    require('child_process').execSync(mkdirCmd, { timeout: 15000 });
    await logFn(runId, 'INFO', 'Remote dir ready: ' + host + ':' + remoteDir);
  } catch (mkErr) {
    await logFn(runId, 'WARN', 'mkdir on remote failed — will try rsync anyway: ' + mkErr.message);
  }

  await logFn(runId, 'INFO', 'Uploading ' + filename + ' via rsync → ' + host + ':' + remoteDir + '/');

  return new Promise((resolve, reject) => {
    const args = [
      '-avz', '--progress',
      '-e', 'sshpass -p "' + password + '" ssh -p ' + port + ' -o StrictHostKeyChecking=no',
      localFilePath,
      user + '@' + host + ':' + remoteDir + '/',
    ];

    const proc = spawn('rsync', args);
    let stderr  = '';
    let lastPct = 0;

    proc.stdout.on('data', async function(d) {
      const line = d.toString();
      const m    = line.match(/(\d+)%/);
      if (m && parseInt(m[1]) !== lastPct && parseInt(m[1]) % 25 === 0) {
        lastPct = parseInt(m[1]);
        await logFn(runId, 'INFO', 'rsync progress: ' + m[1] + '%');
      }
    });
    proc.stderr.on('data', function(d) { stderr += d.toString(); });

    proc.on('close', async function(code) {
      if (code === 0) {
        await updateRemoteStatus(dest.id, { success: true, status: 'connected', error: null }, config);
        const remoteFull = host + ':' + remoteDir + '/' + filename;
        await logFn(runId, 'SUCCESS', 'rsync complete → ' + remoteFull);
        resolve(remoteFull);
      } else {
        const errMsg = stderr.split('\n')[0].substring(0, 200);
        await updateRemoteStatus(dest.id, { success: false, status: 'rsync_failed', error: errMsg }, config);
        await logFn(runId, 'ERROR', 'rsync failed (exit ' + code + '): ' + errMsg);
        reject(new Error('rsync to ' + host + ' failed: ' + errMsg));
      }
    });

    proc.on('error', async function(err) {
      await logFn(runId, 'ERROR', 'rsync not found — install: apt-get install rsync');
      reject(err);
    });
  });
}

// ── SYNC ENTIRE LOCAL DIR TO REMOTE ──────────────────────────────────────────
async function syncDirToRemote(localDir, config) {
  const { host = '192.168.12.243', port = 22, user = 'root', password, path: remotePath = '/backups/remote' } = config;

  const test = await testRemoteConnection(config);
  if (!test.success) return { success: false, ...test };

  try {
    const out = execSync(
      `rsync -avz --delete -e "sshpass -p '${password}' ssh -p ${port} -o StrictHostKeyChecking=no" ` +
      `${localDir}/ ${user}@${host}:${remotePath}/`,
      { timeout: 300000, maxBuffer: 10 * 1024 * 1024 }
    ).toString();
    return { success: true, output: out.substring(0, 500) };
  } catch (err) {
    return { success: false, status: 'rsync_failed', error: err.message.substring(0, 200) };
  }
}

// ── GET REMOTE DISK STATS ─────────────────────────────────────────────────────
async function getRemoteDiskStats(config) {
  const { host = '192.168.12.243', port = 22, user = 'root', password, path: remotePath = '/backups/remote' } = config;

  try {
    const out = execSync(
      `sshpass -p "${password}" ssh -o StrictHostKeyChecking=no -p ${port} ${user}@${host} "df -h ${remotePath}"`,
      { timeout: 10000 }
    ).toString().split('\n');

    if (!out[1]) return null;
    const p = out[1].replace(/\s+/g, ' ').split(' ');
    return { size: p[1], used: p[2], avail: p[3], usePercent: p[4] };
  } catch {
    return null;
  }
}

// ── HEALTH CHECK ALL REMOTE DESTINATIONS ─────────────────────────────────────
async function checkAllRemoteDestinations() {
  try {
    const dests = await db.query("SELECT * FROM backup_destinations WHERE dest_type='remote_sftp'");
    const results = [];

    for (const dest of dests) {
      const config = typeof dest.config === 'string' ? JSON.parse(dest.config) : dest.config;
      console.log(`[Remote] Checking "${dest.name}" → ${config.host}:${config.port || 22}`);

      const test = await testRemoteConnection(config);
      await updateRemoteStatus(dest.id, test, config);
      results.push({ id: dest.id, name: dest.name, host: config.host, ...test });

      if (test.success) {
        const disk = await getRemoteDiskStats(config);
        if (disk) {
          console.log(`[Remote] "${dest.name}" disk: ${disk.usePercent} used (${disk.used}/${disk.size})`);
          results[results.length-1].disk = disk; // attach disk stats to result
        }
      } else {
        console.warn(`[Remote] "${dest.name}" [${test.status}]: ${test.error}`);
      }
    }
    return results;
  } catch (err) {
    console.error('[Remote] checkAllRemoteDestinations error:', err.message);
    return [];
  }
}

module.exports = { testRemoteConnection, rsyncFileToRemote, syncDirToRemote, getRemoteDiskStats, checkAllRemoteDestinations, updateRemoteStatus };
