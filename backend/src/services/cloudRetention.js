// backend/src/services/cloudRetention.js
// Keep last N days of backup objects on AWS S3 + OCI; purge older ones.
// Only deletes backup-like keys (Backup_DB paths / dump extensions).

'use strict';

const { execFileSync } = require('child_process');
const db = require('../db/connection');

const DEFAULT_DAYS = 30;
const BATCH = 900; // delete-objects limit is 1000

function retentionDays() {
  const n = parseInt(process.env.CLOUD_RETENTION_DAYS || String(DEFAULT_DAYS), 10);
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_DAYS;
}

function isEnabled() {
  const v = String(process.env.CLOUD_RETENTION_ENABLED || 'true').toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no' && v !== 'off';
}

function isDryRun() {
  const v = String(process.env.CLOUD_RETENTION_DRY_RUN || 'false').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function cutoffDate(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

/** Only purge dump objects — never touch unrelated bucket files (e.g. .drawio). */
function isBackupObjectKey(key) {
  if (!key || typeof key !== 'string') return false;
  if (key.endsWith('/')) return false;
  if (key.includes('/Backup_DB/')) return true;
  return /\.(sql\.gz|sql\.gz\.enc|dump|dump\.enc|rdb|rdb\.enc)$/i.test(key);
}

function awsEnv(accessKey, secretKey, region) {
  return {
    ...process.env,
    AWS_ACCESS_KEY_ID: accessKey,
    AWS_SECRET_ACCESS_KEY: secretKey,
    AWS_DEFAULT_REGION: region,
    AWS_PAGER: '',
    AWS_REQUEST_CHECKSUM_CALCULATION: 'when_required',
    AWS_RESPONSE_CHECKSUM_VALIDATION: 'when_required',
  };
}

function listAllObjects(bucket, region, env, endpointUrl) {
  const objects = [];
  let token = null;
  do {
    const args = [
      's3api', 'list-objects-v2',
      '--bucket', bucket,
      '--region', region,
      '--output', 'json',
      '--max-keys', '1000',
    ];
    if (endpointUrl) args.push('--endpoint-url', endpointUrl);
    if (token) args.push('--continuation-token', token);

    const out = JSON.parse(execFileSync('aws', args, {
      env,
      timeout: 120000,
      maxBuffer: 32 * 1024 * 1024,
    }).toString() || '{}');

    for (const obj of (out.Contents || [])) {
      if (obj && obj.Key) objects.push(obj);
    }
    token = out.IsTruncated ? (out.NextContinuationToken || null) : null;
  } while (token);
  return objects;
}

function deleteKeys(bucket, region, env, keys, endpointUrl) {
  if (!keys.length) return { deleted: 0, errors: 0 };
  let deleted = 0;
  let errors = 0;

  for (let i = 0; i < keys.length; i += BATCH) {
    const chunk = keys.slice(i, i + BATCH);
    const payload = JSON.stringify({
      Objects: chunk.map((Key) => ({ Key })),
      Quiet: true,
    });
    const args = [
      's3api', 'delete-objects',
      '--bucket', bucket,
      '--region', region,
      '--delete', payload,
      '--output', 'json',
    ];
    if (endpointUrl) args.push('--endpoint-url', endpointUrl);

    try {
      const out = JSON.parse(execFileSync('aws', args, {
        env,
        timeout: 180000,
        maxBuffer: 16 * 1024 * 1024,
      }).toString() || '{}');
      deleted += (out.Deleted || []).length || chunk.length;
      errors += (out.Errors || []).length;
      if ((out.Errors || []).length) {
        console.warn('[CloudRetention] delete errors:', JSON.stringify(out.Errors.slice(0, 5)));
      }
    } catch (err) {
      errors += chunk.length;
      console.error('[CloudRetention] delete-objects failed:', err.message);
    }
  }
  return { deleted, errors };
}

function selectExpired(objects, cutoff) {
  const expired = [];
  let scanned = 0;
  let kept = 0;
  for (const obj of objects) {
    scanned += 1;
    if (!isBackupObjectKey(obj.Key)) continue;
    const modified = obj.LastModified ? new Date(obj.LastModified) : null;
    if (!modified || Number.isNaN(modified.getTime())) continue;
    if (modified < cutoff) expired.push(obj.Key);
    else kept += 1;
  }
  return { expired, scanned, kept };
}

async function purgeS3Destination(dest, cutoff, dryRun) {
  const config = typeof dest.config === 'string' ? JSON.parse(dest.config) : dest.config;
  const bucket = config.bucket;
  const region = config.region || process.env.AWS_DEFAULT_REGION || 'eu-west-2';
  if (!bucket || !config.access_key || !config.secret_key) {
    return { provider: 'aws_s3', id: dest.id, name: dest.name, skipped: true, reason: 'missing config' };
  }

  const env = awsEnv(config.access_key, config.secret_key, region);
  const objects = listAllObjects(bucket, region, env, null);
  const { expired, scanned, kept } = selectExpired(objects, cutoff);

  console.log(`[CloudRetention] S3 "${dest.name}" s3://${bucket} scanned=${scanned} keep=${kept} purge=${expired.length}${dryRun ? ' (dry-run)' : ''}`);

  if (dryRun || !expired.length) {
    return {
      provider: 'aws_s3', id: dest.id, name: dest.name, bucket,
      scanned, kept, expired: expired.length, deleted: 0, errors: 0, dryRun,
      sample: expired.slice(0, 5),
    };
  }

  const { deleted, errors } = deleteKeys(bucket, region, env, expired, null);
  return {
    provider: 'aws_s3', id: dest.id, name: dest.name, bucket,
    scanned, kept, expired: expired.length, deleted, errors, dryRun: false,
  };
}

async function purgeOciDestination(dest, cutoff, dryRun) {
  const config = typeof dest.config === 'string' ? JSON.parse(dest.config) : dest.config;
  const { namespace, region, access_key, secret_key, bucket } = config;
  if (!namespace || !region || !access_key || !secret_key || !bucket) {
    return { provider: 'oci_object', id: dest.id, name: dest.name, skipped: true, reason: 'missing config' };
  }

  const endpoint = `https://${namespace}.compat.objectstorage.${region}.oraclecloud.com`;
  const env = awsEnv(access_key, secret_key, region);
  const objects = listAllObjects(bucket, region, env, endpoint);
  const { expired, scanned, kept } = selectExpired(objects, cutoff);

  console.log(`[CloudRetention] OCI "${dest.name}" oci://${bucket} scanned=${scanned} keep=${kept} purge=${expired.length}${dryRun ? ' (dry-run)' : ''}`);

  if (dryRun || !expired.length) {
    return {
      provider: 'oci_object', id: dest.id, name: dest.name, bucket,
      scanned, kept, expired: expired.length, deleted: 0, errors: 0, dryRun,
      sample: expired.slice(0, 5),
    };
  }

  const { deleted, errors } = deleteKeys(bucket, region, env, expired, endpoint);
  return {
    provider: 'oci_object', id: dest.id, name: dest.name, bucket,
    scanned, kept, expired: expired.length, deleted, errors, dryRun: false,
  };
}

/**
 * Purge AWS S3 + OCI backup objects older than CLOUD_RETENTION_DAYS (default 30).
 */
async function runCloudRetention(options = {}) {
  const days = options.days != null ? options.days : retentionDays();
  const dryRun = options.dryRun != null ? options.dryRun : isDryRun();
  const enabled = options.force === true ? true : isEnabled();

  if (!enabled) {
    console.log('[CloudRetention] Disabled (CLOUD_RETENTION_ENABLED=false)');
    return { enabled: false, days, dryRun, results: [] };
  }

  const cutoff = cutoffDate(days);
  console.log(`[CloudRetention] Start — keep last ${days} days (cutoff UTC ${cutoff.toISOString()})${dryRun ? ' DRY-RUN' : ''}`);

  const results = [];
  const s3Dests = await db.query(
    "SELECT * FROM backup_destinations WHERE dest_type IN ('aws_s3','s3') AND is_active=1"
  );
  for (const dest of s3Dests) {
    try {
      results.push(await purgeS3Destination(dest, cutoff, dryRun));
    } catch (err) {
      console.error(`[CloudRetention] S3 "${dest.name}" failed:`, err.message);
      results.push({ provider: 'aws_s3', id: dest.id, name: dest.name, error: err.message });
    }
  }

  const ociDests = await db.query(
    "SELECT * FROM backup_destinations WHERE dest_type IN ('oci_object','oci') AND is_active=1"
  );
  for (const dest of ociDests) {
    try {
      results.push(await purgeOciDestination(dest, cutoff, dryRun));
    } catch (err) {
      console.error(`[CloudRetention] OCI "${dest.name}" failed:`, err.message);
      results.push({ provider: 'oci_object', id: dest.id, name: dest.name, error: err.message });
    }
  }

  const summary = {
    enabled: true,
    days,
    dryRun,
    cutoff: cutoff.toISOString(),
    deleted: results.reduce((n, r) => n + (r.deleted || 0), 0),
    expired: results.reduce((n, r) => n + (r.expired || 0), 0),
    errors: results.reduce((n, r) => n + (r.errors || 0), 0),
    results,
    finishedAt: new Date().toISOString(),
  };

  console.log(`[CloudRetention] Done — expired=${summary.expired} deleted=${summary.deleted} errors=${summary.errors}`);

  try {
    await db.pool.execute(
      'INSERT INTO activity_events (event_type,source,target_name,status,message,detail,run_id) VALUES (?,?,?,?,?,?,?)',
      [
        'cloud_retention',
        'scheduler',
        'AWS S3 + OCI',
        summary.errors ? 'warning' : 'success',
        dryRun
          ? `Cloud retention dry-run: ${summary.expired} object(s) older than ${days}d`
          : `Cloud retention: deleted ${summary.deleted} object(s) older than ${days}d`,
        JSON.stringify({
          dryRun,
          cutoff: summary.cutoff,
          deleted: summary.deleted,
          expired: summary.expired,
          errors: summary.errors,
          destinations: results.map((r) => ({
            provider: r.provider,
            name: r.name,
            deleted: r.deleted,
            expired: r.expired,
            error: r.error || null,
          })),
        }),
        null,
      ]
    );
  } catch (err) {
    console.warn('[CloudRetention] activity_events insert skipped:', err.message);
  }

  return summary;
}

module.exports = {
  runCloudRetention,
  retentionDays,
  isEnabled,
  isDryRun,
  isBackupObjectKey,
};
