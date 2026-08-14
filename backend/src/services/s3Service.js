// /var/www/backupvault/backend/src/services/s3Service.js
// AWS S3 backup service with live connectivity check
// If credentials wrong / bucket unreachable → marks destination as 'disconnected'

const { execSync, spawn } = require('child_process');
const fs   = require('fs-extra');
const path = require('path');
const db   = require('../db/connection');

// ── S3 DESTINATION STATUS TABLE ───────────────────────────────────────────────
// We store status in backup_destinations.config JSON field:
// { bucket, prefix, region, storage_class, access_key, secret_key, status, last_check, last_error }

// ── CREDENTIAL HELPERS ────────────────────────────────────────────────────────
function buildEnv(config) {
  const env = { ...process.env };
  if (config.access_key)  env.AWS_ACCESS_KEY_ID     = config.access_key;
  if (config.secret_key)  env.AWS_SECRET_ACCESS_KEY = config.secret_key;
  if (config.region)      env.AWS_DEFAULT_REGION    = config.region;
  return env;
}

function maskKey(key) {
  if (!key || key.length < 8) return '****';
  return key.substring(0, 4) + '****' + key.slice(-4);
}

// ── TEST S3 CONNECTION ────────────────────────────────────────────────────────
async function testS3Connection(config) {
  const { bucket, region, access_key, secret_key } = config;

  if (!bucket || !access_key || !secret_key) {
    return {
      success: false,
      status: 'misconfigured',
      error: 'Missing bucket, access_key, or secret_key',
      latency_ms: null,
    };
  }

  const env = buildEnv(config);
  const t0  = Date.now();

  try {
    const out = execSync(
      `aws s3 ls s3://${bucket}/ --region ${region} 2>&1`,
      { env, timeout: 12000 }
    ).toString();

    const latency = Date.now() - t0;

    if (out.includes('NoSuchBucket')) {
      return { success: false, status: 'bucket_not_found', error: `Bucket "${bucket}" does not exist`, latency_ms: latency };
    }
    if (out.includes('AccessDenied') || out.includes('InvalidAccessKeyId') || out.includes('SignatureDoesNotMatch')) {
      return { success: false, status: 'auth_failed', error: 'AWS credentials are invalid or lack S3 access', latency_ms: latency };
    }

    // Fetch bucket size summary (non-blocking, best-effort)
    let bucketSize = null, objectCount = null;
    try {
      const sumOut = execSync(
        `aws s3 ls s3://${bucket}/ --recursive --human-readable --summarize --region ${region || 'ap-south-1'} 2>/dev/null | tail -3`,
        { env, timeout: 25000 }
      ).toString();
      const szM  = sumOut.match(/Total Size:\s+(\S+)\s+(\S+)/);
      const ctM  = sumOut.match(/Total Objects:\s+(\d+)/);
      if (szM)  bucketSize   = `${szM[1]} ${szM[2]}`;
      if (ctM)  objectCount  = parseInt(ctM[1]);
    } catch {}

    return { success: true, status: 'connected', error: null, latency_ms: latency, bucketSize, objectCount };

  } catch (err) {
    const msg = err.stderr?.toString() || err.message || 'Unknown error';
    let status = 'unreachable';
    if (msg.includes('InvalidAccessKeyId') || msg.includes('SignatureDoesNotMatch')) status = 'auth_failed';
    if (msg.includes('NoSuchBucket'))       status = 'bucket_not_found';
    if (msg.includes('EndpointResolution') || msg.includes('Could not connect')) status = 'network_error';
    if (msg.includes('ExpiredToken'))       status = 'token_expired';

    return { success: false, status, error: msg.split('\n')[0].substring(0, 200), latency_ms: Date.now() - t0 };
  }
}

// ── UPDATE DESTINATION STATUS IN DB ──────────────────────────────────────────
async function updateDestStatus(destId, testResult, config) {
  const updated = {
    ...config,
    status:     testResult.success ? 'connected' : testResult.status,
    last_check: new Date().toISOString(),
    last_error: testResult.error || null,
    latency_ms: testResult.latency_ms,
    is_active:  testResult.success ? 1 : 0,  // auto-deactivate on failure
  };

  await db.query(
    'UPDATE backup_destinations SET config=?, is_active=? WHERE id=?',
    [JSON.stringify(updated), testResult.success ? 1 : 0, destId]
  );

  return updated;
}

// ── UPLOAD ONE FILE TO S3 ─────────────────────────────────────────────────────
async function uploadToS3(runId, localFilePath, dest, logFn) {
  const config       = typeof dest.config === 'string' ? JSON.parse(dest.config) : dest.config;
  const { bucket, prefix = 'db-backups/', region = 'ap-south-1', storage_class = 'STANDARD_IA' } = config;
  const filename     = path.basename(localFilePath);
  // ── Build S3 key preserving folder structure ───────────────────────────────
  // localFilePath: /primary-db-backup/<db>/Backup_DB/<YYYYMMDD>/<file>.sql.gz
  // S3 key:        <db>/Backup_DB/<YYYYMMDD>/<file>.sql.gz  (prefix optional)
  let s3KeyPath = filename; // fallback: flat
  try {
    const parts = localFilePath.split('/');
    const bkIdx = parts.indexOf('Backup_DB');
    if (bkIdx > 0) {
      const dbName  = parts[bkIdx - 1];
      const dateDir = parts[bkIdx + 1];
      s3KeyPath = dbName + '/Backup_DB/' + dateDir + '/' + filename;
    }
  } catch {}
  // prefix from config is optional extra folder (e.g. 'backups/')
  const cleanPrefix = prefix ? prefix.replace(/\/+$/, '') + '/' : '';
  const s3Key = cleanPrefix + s3KeyPath;
  const s3Uri        = `s3://${bucket}/${s3Key}`;
  const env          = buildEnv(config);

  await logFn(runId, 'INFO', `--- Transferring to: AWS S3 (${dest.name}) ---`);
  await logFn(runId, 'INFO', `Uploading to S3: ${s3Uri}`);
  await logFn(runId, 'INFO', `Storage class: ${storage_class} · Region: ${region}`);

  // First check connectivity
  const test = await testS3Connection(config);
  if (!test.success) {
    await updateDestStatus(dest.id, test, config);
    await logFn(runId, 'ERROR', `S3 connection failed [${test.status}]: ${test.error}`);
    throw new Error(`S3 destination "${dest.name}" is ${test.status}: ${test.error}`);
  }

  return new Promise((resolve, reject) => {
    const args = [
      's3', 'cp', localFilePath, s3Uri,
      '--storage-class', storage_class,
      '--region', region,
      '--no-progress',
    ];

    const proc = spawn('aws', args, { env });
    let stderr = '';

    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.stdout.on('data', async d => {
      const line = d.toString().trim();
      if (line) {
        const pct = line.match(/(\d+)%/)?.[1];
        if (pct && parseInt(pct) % 20 === 0) {
          await logFn(runId, 'INFO', `S3 upload progress: ${pct}%`);
        }
      }
    });

    proc.on('close', async code => {
      if (code === 0) {
        await updateDestStatus(dest.id, { success: true, status: 'connected', error: null, latency_ms: test.latency_ms }, config);
        await logFn(runId, 'SUCCESS', `S3 upload complete → ${s3Uri} [${storage_class}]`);
        resolve(s3Uri);
      } else {
        const errMsg = stderr.split('\n')[0].substring(0, 200);
        const fakeResult = { success: false, status: 'upload_failed', error: errMsg, latency_ms: null };
        await updateDestStatus(dest.id, fakeResult, config);
        await logFn(runId, 'ERROR', `S3 upload failed (exit ${code}): ${errMsg}`);
        reject(new Error(`S3 upload failed: ${errMsg}`));
      }
    });

    proc.on('error', async err => {
      const fakeResult = { success: false, status: 'aws_cli_missing', error: 'aws CLI not found — install with: pip install awscli', latency_ms: null };
      await updateDestStatus(dest.id, fakeResult, config);
      await logFn(runId, 'ERROR', 'aws CLI not installed. Run: pip install awscli --break-system-packages');
      reject(err);
    });
  });
}

// ── SYNC ENTIRE DIRECTORY TO S3 (used by storage monitor) ────────────────────
async function syncDirToS3(localDir, config, dryRun = false) {
  const { bucket, prefix = 'db-backups/', region = 'ap-south-1', storage_class = 'STANDARD_IA' } = config;
  const env = buildEnv(config);
  const s3Uri = `s3://${bucket}/${prefix}`;

  const test = await testS3Connection(config);
  if (!test.success) return { success: false, ...test };

  const cmd = [
    's3', 'sync', localDir, s3Uri,
    '--storage-class', storage_class,
    '--region', region,
    '--no-progress',
    dryRun ? '--dryrun' : '',
  ].filter(Boolean);

  try {
    const out = execSync(`aws ${cmd.join(' ')}`, { env, timeout: 300000, maxBuffer: 10 * 1024 * 1024 });
    return { success: true, output: out.toString().substring(0, 500) };
  } catch (err) {
    return { success: false, status: 'sync_failed', error: err.message.substring(0, 200) };
  }
}

// ── PERIODIC HEALTH CHECK (called by scheduler) ───────────────────────────────
async function checkAllS3Destinations() {
  try {
    const dests = await db.query("SELECT * FROM backup_destinations WHERE dest_type='aws_s3'");
    const results = [];

    for (const dest of dests) {
      const config = typeof dest.config === 'string' ? JSON.parse(dest.config) : dest.config;
      console.log(`[S3] Checking destination "${dest.name}" — bucket: ${config.bucket} key: ${maskKey(config.access_key)}`);

      const test = await testS3Connection(config);
      await updateDestStatus(dest.id, test, config);

      results.push({ id: dest.id, name: dest.name, ...test });

      if (!test.success) {
        console.warn(`[S3] "${dest.name}" is ${test.status}: ${test.error}`);
      } else {
        console.log(`[S3] "${dest.name}" connected (${test.latency_ms}ms)`);
      }
    }

    return results;
  } catch (err) {
    console.error('[S3] checkAllS3Destinations error:', err.message);
    return [];
  }
}

module.exports = { testS3Connection, uploadToS3, syncDirToS3, checkAllS3Destinations, updateDestStatus, maskKey };
