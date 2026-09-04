// backend/src/services/ociService.js
// OCI Object Storage — Native Node.js HTTPS with AWS Signature V4
// AES-256-GCM client-side encryption (streaming — no memory limit)

const https  = require('https');
const path   = require('path');
const fs     = require('fs-extra');
const crypto = require('crypto');
const { execSync, execFileSync } = require('child_process');

// ── ENCRYPTION CONFIG ─────────────────────────────────────────
const ALGORITHM = 'aes-256-gcm';
const KEY_SIZE  = 32;
const IV_SIZE   = 16;
const TAG_SIZE  = 16;
const ENC_EXT   = '.enc';

function getEncryptionKey() {
  const key = process.env.BACKUP_ENCRYPTION_KEY;
  if (!key) return null;
  const buf = Buffer.from(key, 'hex');
  if (buf.length !== KEY_SIZE) {
    console.error('[OCI] BACKUP_ENCRYPTION_KEY wrong length');
    return null;
  }
  return buf;
}

// ── ENCRYPT FILE (streaming — handles any file size) ──────────
// Format: [16B IV][16B GCM Tag][ciphertext]
// Uses tmp file for ciphertext, then prepends IV+tag atomically
async function encryptFile(inputPath, outputPath) {
  const key = getEncryptionKey();
  if (!key) throw new Error('BACKUP_ENCRYPTION_KEY not set in .env');

  const iv         = crypto.randomBytes(IV_SIZE);
  const cipher     = crypto.createCipheriv(ALGORITHM, key, iv);
  const cipherPath = outputPath + '.cipher';

  // Step 1: Stream encrypt to temp ciphertext file
  await new Promise((resolve, reject) => {
    const input  = fs.createReadStream(inputPath);
    const output = fs.createWriteStream(cipherPath);
    input.pipe(cipher).pipe(output);
    output.on('finish', resolve);
    output.on('error', reject);
    input.on('error', reject);
    cipher.on('error', reject);
  });

  // Step 2: Get GCM auth tag (available after cipher stream finishes)
  const tag = cipher.getAuthTag();

  // Step 3: Write final file = [IV][TAG][ciphertext] using streams
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(outputPath);
    out.write(iv);
    out.write(tag);
    const cipherStream = fs.createReadStream(cipherPath);
    cipherStream.pipe(out, { end: true });
    out.on('finish', resolve);
    out.on('error', reject);
    cipherStream.on('error', reject);
  });

  // Cleanup temp cipher file
  await fs.remove(cipherPath).catch(() => {});

  const origSize = fs.statSync(inputPath).size;
  const encSize  = fs.statSync(outputPath).size;
  return { origSize, encSize, iv: iv.toString('hex') };
}

// ── DECRYPT FILE ─────────────────────────────────────────────
async function decryptFile(inputPath, outputPath) {
  const key = getEncryptionKey();
  if (!key) throw new Error('BACKUP_ENCRYPTION_KEY not set');

  const encrypted = await fs.readFile(inputPath);
  if (encrypted.length < IV_SIZE + TAG_SIZE)
    throw new Error('Encrypted file too small — corrupted');

  const iv         = encrypted.slice(0, IV_SIZE);
  const tag        = encrypted.slice(IV_SIZE, IV_SIZE + TAG_SIZE);
  const ciphertext = encrypted.slice(IV_SIZE + TAG_SIZE);
  const decipher   = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted  = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  await fs.writeFile(outputPath, decrypted);
  return { size: decrypted.length };
}

// ── AWS SIGNATURE V4 ─────────────────────────────────────────
function hmac256(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}
function sha256hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}
function sha256fileHex(filePath) {
  return new Promise((resolve, reject) => {
    const hash   = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', d => hash.update(d));
    stream.on('end',  () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// ── NATIVE HTTPS PUT (no aws cli — no chunked encoding) ───────
async function uploadViaHttps(filePath, host, bucket, key, accessKey, secretKey, region, logFn, runId) {
  const fileSize = fs.statSync(filePath).size;
  const fileHash = await sha256fileHex(filePath);

  const now      = new Date();
  const amzDate  = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp= amzDate.slice(0, 8);
  const reqPath  = '/' + bucket + '/' + key;

  const headers = {
    'content-length':        String(fileSize),
    'content-type':          'application/octet-stream',
    'host':                  host,
    'x-amz-content-sha256':  fileHash,
    'x-amz-date':            amzDate,
  };

  const sortedKeys    = Object.keys(headers).sort();
  const signedHeaders = sortedKeys.join(';');
  const canonHeaders  = sortedKeys.map(k => k + ':' + headers[k]).join('\n') + '\n';
  const canonReq      = 'PUT\n' + reqPath + '\n\n' + canonHeaders + '\n' + signedHeaders + '\n' + fileHash;

  const credScope = dateStamp + '/' + region + '/s3/aws4_request';
  const strToSign = 'AWS4-HMAC-SHA256\n' + amzDate + '\n' + credScope + '\n' + sha256hex(canonReq);

  const kDate    = hmac256('AWS4' + secretKey, dateStamp);
  const kRegion  = hmac256(kDate, region);
  const kService = hmac256(kRegion, 's3');
  const kSigning = hmac256(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(strToSign).digest('hex');

  const auth = 'AWS4-HMAC-SHA256 Credential=' + accessKey + '/' + credScope
             + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;

  // Progress tracking
  let uploaded = 0;
  let lastPct  = 0;

  return new Promise((resolve, reject) => {
    // Set socket timeout — if no data for 5 min, abort
    const req = https.request({
      hostname: host,
      port:     443,
      path:     reqPath,
      method:   'PUT',
      timeout:  600000, // 10 min total timeout
      headers: {
        'Content-Length':        String(fileSize),
        'Content-Type':          'application/octet-stream',
        'Host':                  host,
        'x-amz-content-sha256':  fileHash,
        'x-amz-date':            amzDate,
        'Authorization':          auth,
      },
    }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, size: fileSize });
        } else {
          reject(new Error('OCI HTTP ' + res.statusCode + ': ' + body.substring(0, 400)));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('OCI upload timed out after 10 minutes'));
    });
    req.on('error', reject);

    // Stream file with progress tracking
    const fileStream = fs.createReadStream(filePath);
    fileStream.on('data', async chunk => {
      uploaded += chunk.length;
      const pct = Math.floor((uploaded / fileSize) * 100);
      if (pct >= lastPct + 25 && logFn && runId) {
        lastPct = Math.floor(pct / 25) * 25;
        try { await logFn(runId, 'INFO', 'OCI upload progress: ' + pct + '% (' + (uploaded/1024/1024).toFixed(1) + ' MB / ' + (fileSize/1024/1024).toFixed(1) + ' MB)'); } catch {}
      }
    });
    fileStream.on('error', reject);
    fileStream.pipe(req);
  });
}

// ── CONFIG PARSER ─────────────────────────────────────────────
function parseConfig(dest) {
  const config = typeof dest.config === 'string'
    ? JSON.parse(dest.config) : (dest.config || {});
  const { namespace, region, access_key, secret_key, bucket, prefix = '' } = config;
  if (!namespace || !region || !access_key || !secret_key || !bucket)
    throw new Error('OCI config missing fields: namespace, region, access_key, secret_key, bucket');
  const host     = namespace + '.compat.objectstorage.' + region + '.oraclecloud.com';
  const endpoint = 'https://' + host;
  return { namespace, region, access_key, secret_key, bucket, prefix, host, endpoint, config };
}

function maskKey(k) {
  if (!k || k.length < 8) return '****';
  return k.substring(0, 4) + '****' + k.slice(-4);
}

function ociAwsEnv(parsed) {
  return {
    ...process.env,
    AWS_ACCESS_KEY_ID:                 parsed.config.access_key,
    AWS_SECRET_ACCESS_KEY:             parsed.config.secret_key,
    AWS_DEFAULT_REGION:                parsed.config.region,
    AWS_REQUEST_CHECKSUM_CALCULATION:  'when_required',
    AWS_RESPONSE_CHECKSUM_VALIDATION:  'when_required',
    AWS_PAGER:                         '',
  };
}

function buildOciKey(localFilePath, filename) {
  try {
    const parts = localFilePath.split('/');
    const bkIdx = parts.indexOf('Backup_DB');
    if (bkIdx > 0) {
      return parts[bkIdx - 1] + '/Backup_DB/' + parts[bkIdx + 1] + '/' + filename;
    }
  } catch {}
  return filename;
}

// ── TEST CONNECTION ───────────────────────────────────────────
async function testOciConnection(config) {
  try {
    const parsed = parseConfig({ config });
    const env = {
      ...process.env,
      AWS_ACCESS_KEY_ID:     parsed.config.access_key,
      AWS_SECRET_ACCESS_KEY: parsed.config.secret_key,
      AWS_DEFAULT_REGION:    parsed.config.region,
    };
    execSync(
      'aws s3api head-bucket --bucket "' + parsed.bucket +
      '" --endpoint-url "' + parsed.endpoint +
      '" --region "' + parsed.config.region + '"',
      { env, timeout: 15000 }
    );
    return { success: true, status: 'connected', error: null };
  } catch(e) {
    return { success: false, status: 'failed', error: e.message.substring(0, 200) };
  }
}

// ── MAIN UPLOAD ───────────────────────────────────────────────
async function uploadToOCI(runId, localFilePath, dest, logFn) {
  const { host, endpoint, bucket, config } = parseConfig(dest);
  const filename   = path.basename(localFilePath);
  const encEnabled = dest.encryption_enabled || config.encryption_enabled || false;
  const keyAvail   = !!getEncryptionKey();
  const baseKey    = buildOciKey(localFilePath, filename);
  let   ociKey     = baseKey;
  let   uploadPath = localFilePath;
  let   tmpEncPath = null;
  let   tmpCipherPath = null;

  await logFn(runId, 'INFO', '--- Uploading to OCI Object Storage: ' + dest.name + ' ---');
  await logFn(runId, 'INFO', 'Bucket: ' + bucket + ' | Region: ' + config.region + ' | Namespace: ' + config.namespace);
  await logFn(runId, 'INFO', 'Encryption: ' + (encEnabled && keyAvail ? 'AES-256-GCM client-side ENABLED' : encEnabled && !keyAvail ? 'KEY MISSING — uploading unencrypted' : 'disabled'));

  try {
    if (encEnabled && keyAvail) {
      tmpEncPath = localFilePath + ENC_EXT;
      await logFn(runId, 'INFO', 'Encrypting file with AES-256-GCM (streaming)...');
      const encResult = await encryptFile(localFilePath, tmpEncPath);
      await logFn(runId, 'INFO',
        'Encrypted: ' + (encResult.origSize/1024/1024).toFixed(1) + ' MB → ' +
        (encResult.encSize/1024/1024).toFixed(1) + ' MB [streaming complete]'
      );
      uploadPath = tmpEncPath;
      ociKey     = baseKey + ENC_EXT;
    } else if (encEnabled && !keyAvail) {
      await logFn(runId, 'WARN', 'BACKUP_ENCRYPTION_KEY not set in .env — uploading without encryption');
    }

    await logFn(runId, 'INFO', 'Uploading: oci://' + bucket + '/' + ociKey);
    await logFn(runId, 'INFO', 'Host: ' + host + ' | AccessKey: ' + maskKey(config.access_key));

    const result = await uploadViaHttps(
      uploadPath, host, bucket, ociKey,
      config.access_key, config.secret_key, config.region,
      logFn, runId
    );

    const sizeMB = (fs.statSync(uploadPath).size / 1024 / 1024).toFixed(1);
    await logFn(runId, 'SUCCESS',
      'OCI upload complete: oci://' + bucket + '/' + ociKey +
      ' (' + sizeMB + ' MB)' + (encEnabled && keyAvail ? ' [AES-256-GCM encrypted]' : '')
    );

    // Audit log
    try {
      const db = require('../db/connection');
      const localStat = fs.statSync(localFilePath);
      await db.pool.execute(
        'INSERT INTO encryption_audit (run_id,dest_id,action,file_name,file_size,encrypted_size,status) VALUES (?,?,?,?,?,?,?)',
        [runId, dest.id, encEnabled && keyAvail ? 'encrypt+upload' : 'upload',
         filename, localStat.size, fs.statSync(uploadPath).size, 'success']
      );
    } catch {}

    return 'oci://' + bucket + '/' + ociKey;

  } finally {
    // Always clean up temp files
    if (tmpEncPath) {
      try { await fs.remove(tmpEncPath); } catch {}
    }
    // Clean up any lingering cipher temp file
    const cipherTmp = localFilePath + ENC_EXT + '.cipher';
    try { if (await fs.pathExists(cipherTmp)) await fs.remove(cipherTmp); } catch {}
  }
}

// ── LIST BUCKET ──────────────────────────────────────────────
async function listOCIBucket(config, prefix) {
  const parsed = parseConfig({ config });
  const pfx = prefix || '';
  if (/["\\\n;|&$`]/.test(pfx)) throw new Error('Invalid prefix');
  const args = [
    's3api', 'list-objects-v2',
    '--bucket', parsed.bucket,
    '--delimiter', '/',
    '--endpoint-url', parsed.endpoint,
    '--region', parsed.config.region,
    '--output', 'json',
  ];
  if (pfx) args.push('--prefix', pfx);
  const out = execFileSync('aws', args, {
    env: ociAwsEnv(parsed),
    timeout: 30000,
    maxBuffer: 10 * 1024 * 1024,
  }).toString();
  return JSON.parse(out);
}

// ── FOLDER STATS (size, file count, newest LastModified) ─────
async function folderStatsOCI(config, prefix) {
  const parsed = parseConfig({ config });
  const pfx = String(prefix || '');
  if (/["\\\n;|&$`]/.test(pfx)) throw new Error('Invalid prefix');

  const env = ociAwsEnv(parsed);
  let continuation = null;
  let totalSize = 0;
  let totalObjects = 0;
  let lastModified = null;
  let storageClass = 'STANDARD';

  do {
    const args = [
      's3api', 'list-objects-v2',
      '--bucket', parsed.bucket,
      '--endpoint-url', parsed.endpoint,
      '--region', parsed.config.region,
      '--output', 'json',
      '--max-keys', '1000',
    ];
    if (pfx) args.push('--prefix', pfx);
    if (continuation) args.push('--continuation-token', continuation);

    const out = JSON.parse(execFileSync('aws', args, {
      env,
      timeout: 45000,
      maxBuffer: 20 * 1024 * 1024,
    }).toString() || '{}');

    for (const obj of (out.Contents || [])) {
      if (!obj || obj.Key === pfx) continue;
      totalObjects += 1;
      totalSize += Number(obj.Size) || 0;
      if (obj.LastModified && (!lastModified || new Date(obj.LastModified) > new Date(lastModified))) {
        lastModified = obj.LastModified;
        storageClass = obj.StorageClass || storageClass;
      }
    }
    continuation = out.IsTruncated ? (out.NextContinuationToken || null) : null;
  } while (continuation);

  return { prefix: pfx, totalSize, totalObjects, lastModified, storageClass };
}

// ── PRESIGN URL ──────────────────────────────────────────────
async function presignOCI(config, ociKey, expiresIn) {
  const parsed = parseConfig({ config });
  const env = {
    ...process.env,
    AWS_ACCESS_KEY_ID:     parsed.config.access_key,
    AWS_SECRET_ACCESS_KEY: parsed.config.secret_key,
    AWS_DEFAULT_REGION:    parsed.config.region,
  };
  return execSync(
    'aws s3 presign "s3://' + parsed.bucket + '/' + ociKey + '"' +
    ' --expires-in ' + (expiresIn || 3600) +
    ' --endpoint-url "' + parsed.endpoint +
    '" --region "' + parsed.config.region + '"',
    { env, timeout: 15000 }
  ).toString().trim();
}

// ── CHECK ALL OCI DESTINATIONS ────────────────────────────────
async function checkAllOCIDestinations() {
  const db    = require('../db/connection');
  const dests = await db.query("SELECT * FROM backup_destinations WHERE dest_type='oci_object' AND is_active=1");
  const results = [];
  for (const dest of dests) {
    const config = typeof dest.config === 'string' ? JSON.parse(dest.config) : dest.config;
    const test   = await testOciConnection(config);
    await db.query("UPDATE backup_destinations SET config=JSON_SET(config,'$.status',?) WHERE id=?",
      [test.status, dest.id]);
    results.push({ ...dest, ...test });
    console.log('[OCI] "' + dest.name + '" → ' + test.status);
  }
  return results;
}

// ── GENERATE ENCRYPTION KEY ───────────────────────────────────
function generateEncryptionKey() {
  const key = crypto.randomBytes(KEY_SIZE).toString('hex');
  console.log('\n=== BackupVault AES-256-GCM Encryption Key ===');
  console.log('Add this line to /var/www/backupvault/backend/.env:');
  console.log('BACKUP_ENCRYPTION_KEY=' + key);
  console.log('\nKEEP THIS KEY SAFE — without it encrypted backups cannot be restored.\n');
  return key;
}

// ── DOWNLOAD FROM OCI ─────────────────────────────────────────
async function downloadFromOCI(destId, ociKey, localOutputPath, decrypt) {
  const db     = require('../db/connection');
  const dest   = await db.queryOne('SELECT * FROM backup_destinations WHERE id=?', [destId]);
  const parsed = parseConfig(dest);
  const env = {
    ...process.env,
    AWS_ACCESS_KEY_ID:     parsed.config.access_key,
    AWS_SECRET_ACCESS_KEY: parsed.config.secret_key,
    AWS_DEFAULT_REGION:    parsed.config.region,
  };
  const tmpPath = localOutputPath + '.download';
  execSync(
    'aws s3 cp "s3://' + parsed.bucket + '/' + ociKey + '" "' + tmpPath + '"' +
    ' --endpoint-url "' + parsed.endpoint + '" --region "' + parsed.config.region + '"',
    { env, timeout: 600000 }
  );
  if (decrypt || ociKey.endsWith(ENC_EXT)) {
    await decryptFile(tmpPath, localOutputPath);
    await fs.remove(tmpPath);
  } else {
    await fs.move(tmpPath, localOutputPath);
  }
  return { path: localOutputPath, size: fs.statSync(localOutputPath).size };
}

module.exports = {
  uploadToOCI,
  downloadFromOCI,
  listOCIBucket,
  folderStatsOCI,
  presignOCI,
  testOciConnection,
  checkAllOCIDestinations,
  encryptFile,
  decryptFile,
  generateEncryptionKey,
  maskKey,
};
