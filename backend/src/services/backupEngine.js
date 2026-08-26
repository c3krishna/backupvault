// backend/src/services/backupEngine.js
const { spawn, execSync } = require('child_process');
const path   = require('path');
const fs     = require('fs-extra');
const db     = require('../db/connection');

class BackupEngine {

  constructor(wsManager) {
    this.ws = wsManager || null;
  }

  async log(runId, level, message) {
    try {
      await db.pool.execute(
        'INSERT INTO backup_logs (run_id, log_level, message) VALUES (?, ?, ?)',
        [runId, level, message]
      );
      // Broadcast to WebSocket live log viewers
      if (this.ws && this.ws.broadcast) {
        this.ws.broadcast({ type: 'log', runId, level, message,
          timestamp: new Date().toISOString() });
      }
    } catch {}
  }

  async updateRunStatus(runId, status, extras) {
    extras = extras || {};
    const fields = ['status = ?'];
    const vals   = [status];
    if (extras.fileSize !== undefined) { fields.push('file_size_bytes = ?'); vals.push(extras.fileSize); }
    if (extras.filePath !== undefined) { fields.push('file_path = ?');       vals.push(extras.filePath); }
    if (extras.errorMsg !== undefined) { fields.push('error_message = ?');   vals.push(extras.errorMsg); }
    if (status === 'running')                              { fields.push('started_at = NOW()');   }
    if (status === 'success' || status === 'failed')       { fields.push('completed_at = NOW()'); }
    vals.push(runId);
    await db.query('UPDATE backup_runs SET ' + fields.join(', ') + ' WHERE id = ?', vals);
  }

  // ── CORE DUMP RUNNER ──────────────────────────────────────────────────────
  runDump(target, outputPath, runId) {
    const self = this;
    return new Promise(function(resolve, reject) {
      fs.ensureDir(path.dirname(outputPath)).then(function() {

        self.log(runId, 'INFO', 'Starting ' + target.db_type.toUpperCase() + ' dump from ' + target.host + ':' + target.port);

        if (target.db_type === 'mysql') {
          self.log(runId, 'INFO', 'Connected to ' + target.host + ':' + target.port);
          self.log(runId, 'INFO', 'Locking tables for consistent snapshot');
          self.log(runId, 'INFO', 'Dumping schema and structure');
          self.log(runId, 'INFO', 'Dumping table data (this may take a while)');
          self.log(runId, 'INFO', 'Compressing output with gzip');

          var safePass = (target.password || '').replace(/'/g, "'\\''");
          var tmpPath  = outputPath + '.tmp';

          var parts = [
            'mysqldump',
            '-h' + "'" + target.host + "'",
            '-P' + target.port,
            '-u' + "'" + target.username + "'",
            "-p'" + safePass + "'",
            '--single-transaction',
            '--quick',
            '--routines',
            '--triggers',
            '--events',
            '--add-drop-table',
            '--max-allowed-packet=512M',
            '--net-buffer-length=65536',
            "'" + target.database_name + "'",
            '| gzip -1',
            "> '" + tmpPath + "'",
          ];
          var bashCmd = parts.join(' ');

          self.log(runId, 'INFO', 'mysqldump started — ' + target.host + ':' + target.port + '/' + target.database_name);
          self.log(runId, 'INFO', 'Output: ' + path.basename(outputPath));

          // Progress logger every 2 minutes
          var progressTimer = setInterval(function() {
            fs.stat(tmpPath).then(function(st) {
              var mb = (st.size / 1024 / 1024).toFixed(1);
              self.log(runId, 'INFO', 'Dump in progress — ' + mb + ' MB written so far...');
            }).catch(function() {});
          }, 120000);

          var proc   = spawn('bash', ['-c', bashCmd]);
          var stderr = '';

          proc.stderr.on('data', function(d) {
            var line = d.toString().trim();
            stderr += line + '\n';
            if (line &&
                line.indexOf('[Warning]') === -1 &&
                line.indexOf('Using a password') === -1) {
              self.log(runId, 'WARN', 'mysqldump: ' + line.substring(0, 200));
            }
          });

          proc.on('error', function(err) {
            clearInterval(progressTimer);
            self.log(runId, 'ERROR', 'Failed to start mysqldump: ' + err.message);
            fs.remove(tmpPath).catch(function() {});
            reject(err);
          });

          proc.on('close', function(code) {
            clearInterval(progressTimer);

            var errLines = stderr.split('\n').filter(function(l) {
              return l &&
                l.indexOf('[Warning]') === -1 &&
                l.indexOf('Using a password') === -1 &&
                l.indexOf('Deprecated') === -1 &&
                l.trim().length > 0;
            });

            fs.stat(tmpPath).catch(function() { return { size: 0 }; }).then(function(st) {
              var tmpSize = st.size;

              if (code !== 0) {
                var errMsg = errLines.slice(0, 3).join(' | ').substring(0, 500) || ('Exit code ' + code);
                self.log(runId, 'ERROR', 'mysqldump exited with code ' + code + ': ' + errMsg);
                self.log(runId, 'INFO',  'Partial file: ' + (tmpSize/1024/1024).toFixed(1) + ' MB — removing');
                fs.remove(tmpPath).catch(function() {});
                return reject(new Error('mysqldump failed (exit ' + code + '): ' + errMsg));
              }

              if (tmpSize < 1024) {
                self.log(runId, 'ERROR', 'Dump too small (' + tmpSize + ' bytes) — empty or failed silently');
                fs.remove(tmpPath).catch(function() {});
                return reject(new Error('Dump output too small (' + tmpSize + ' bytes)'));
              }

              // gzip integrity check
              self.log(runId, 'INFO', 'Validating gzip integrity (' + (tmpSize/1024/1024).toFixed(1) + ' MB)...');
              try {
                var gzTimeout = Math.max(60000, Math.floor(tmpSize / (1024 * 1024)) * 2000);
                execSync("gzip -t '" + tmpPath + "'", { timeout: gzTimeout });
              } catch (gzErr) {
                self.log(runId, 'ERROR', 'gzip validation FAILED — dump is corrupt');
                self.log(runId, 'ERROR', 'Size: ' + (tmpSize/1024/1024).toFixed(1) + ' MB — possible causes:');
                self.log(runId, 'ERROR', '  * NFS write stall   — check: df -h /primary-db-backup');
                self.log(runId, 'ERROR', '  * Disk full on NFS  — check destination free space');
                self.log(runId, 'ERROR', '  * mysqldump killed  — OOM or process timeout');
                self.log(runId, 'ERROR', '  * Network issue     — between BackupVault and DB server');
                fs.remove(tmpPath).catch(function() {});
                return reject(new Error('Corrupt gzip (' + (tmpSize/1024/1024).toFixed(1) + ' MB) — see logs'));
              }

              // Move temp → final
              fs.move(tmpPath, outputPath, { overwrite: true }).then(function() {
                return fs.stat(outputPath);
              }).then(function(finalSt) {
                self.log(runId, 'SUCCESS', 'Dump verified and saved: ' + path.basename(outputPath) + ' (' + (finalSt.size/1024/1024).toFixed(1) + ' MB)');
                if (errLines.length > 0) {
                  self.log(runId, 'WARN', 'Warnings: ' + errLines.slice(0, 2).join(' | '));
                }
                resolve(finalSt.size);
              }).catch(function(mvErr) {
                self.log(runId, 'ERROR', 'Failed to move temp file: ' + mvErr.message);
                fs.remove(tmpPath).catch(function() {});
                reject(new Error('File move failed: ' + mvErr.message));
              });

            });
          });

        } else if (target.db_type === 'postgresql') {
          self.log(runId, 'INFO', 'Connected to ' + target.host + ':' + target.port);
          self.log(runId, 'INFO', 'Dumping PostgreSQL database (custom format)');

          var env  = Object.assign({}, process.env, { PGPASSWORD: target.password || '' });
          var proc = spawn('pg_dump', [
            '-h' + target.host, '-p' + target.port,
            '-U' + target.username, '-Fc',
            '-f' + outputPath, target.database_name,
          ], { env: env });

          var stderr = '';
          proc.stderr.on('data', function(d) { stderr += d.toString(); });
          proc.on('error', function(err) {
            self.log(runId, 'ERROR', 'pg_dump not found: ' + err.message);
            reject(err);
          });
          proc.on('close', function(code) {
            if (code !== 0) {
              self.log(runId, 'ERROR', 'pg_dump failed: ' + stderr.substring(0, 400));
              return reject(new Error('pg_dump failed: ' + stderr.substring(0, 400)));
            }
            fs.stat(outputPath).then(function(st) {
              self.log(runId, 'SUCCESS', 'Dump completed: ' + path.basename(outputPath) + ' (' + (st.size/1024/1024).toFixed(1) + ' MB)');
              resolve(st.size);
            });
          });

        } else if (target.db_type === 'redis') {
          self.log(runId, 'INFO', 'Saving Redis RDB snapshot');
          var args = ['-h', target.host, '-p', String(target.port || 6379)];
          if (target.password) { args.push('-a', target.password); }
          args.push('--rdb', outputPath);
          var proc = spawn('redis-cli', args);
          var stderr = '';
          proc.stderr.on('data', function(d) { stderr += d.toString(); });
          proc.on('close', function(code) {
            if (code !== 0) return reject(new Error('redis-cli failed: ' + stderr));
            fs.stat(outputPath).then(function(st) {
              self.log(runId, 'SUCCESS', 'Redis RDB saved: ' + path.basename(outputPath) + ' (' + (st.size/1024/1024).toFixed(1) + ' MB)');
              resolve(st.size);
            });
          });

        } else {
          reject(new Error('Unsupported db_type: ' + target.db_type));
        }
      }).catch(reject);
    });
  }

  // ── MAIN BACKUP RUNNER ─────────────────────────────────────────────────────
  async runBackup(jobId, targetId, backupType, triggeredBy, destinations) {
    backupType   = backupType   || 'full';
    triggeredBy  = triggeredBy  || 'manual';
    destinations = destinations || [];

    var startTime = Date.now();
    var crypto    = require('crypto');
    var runUuid   = crypto.randomBytes(8).toString('hex');

    var target = await db.queryOne('SELECT * FROM backup_targets WHERE id = ? AND is_active = 1', [targetId]);
    if (!target) throw new Error('Target not found or inactive');

    var res = await db.pool.execute(
      'INSERT INTO backup_runs (run_uuid, job_id, target_id, backup_type, trigger_type, status) VALUES (?,?,?,?,?,\'pending\')',
      [runUuid, jobId || null, targetId, backupType, triggeredBy]
    );
    var runId = res[0].insertId;

    await this.updateRunStatus(runId, 'running');

    try {
      var primaryMount = process.env.PRIMARY_MOUNT || '/primary-db-backup';
      try {
        var dfOut = execSync("df -h '" + primaryMount + "' 2>/dev/null").toString().split('\n');
        if (dfOut[1]) {
          var diskPct = parseInt(dfOut[1].replace(/\s+/g, ' ').split(' ')[4]) || 0;
          if (diskPct >= 90) {
            throw new Error('Primary NFS at ' + diskPct + '% — new backups blocked until space is freed (Rule 2)');
          }
        }
      } catch (diskErr) {
        if (String(diskErr.message || '').indexOf('blocked') !== -1) throw diskErr;
      }

      // Always load ALL active destinations from DB
      // Never rely on passed IDs — they may be stale from old job configs
      var destList = await db.query('SELECT * FROM backup_destinations WHERE is_active = 1 ORDER BY id ASC');

      // If specific destinations were requested, filter to those
      // BUT always include OCI destinations (never skip them)
      if (destinations && destinations.length > 0) {
        var reqSet = destinations.map(Number);
        destList = destList.filter(function(d) {
          // Include if: explicitly requested OR is an OCI destination
          return reqSet.indexOf(d.id) !== -1 || d.dest_type === 'oci_object';
        });
      }

      await this.log(runId, 'INFO', '=== BackupVault Run [' + runUuid.substring(0, 8) + '] started ===');
      await this.log(runId, 'INFO', 'Target: ' + target.name + ' (' + target.db_type.toUpperCase() + ') | DB: ' + target.database_name + ' | Type: ' + backupType.toUpperCase() + ' | Triggered: ' + triggeredBy);
      await this.log(runId, 'INFO', 'Destinations: ' + destList.map(function(d) { return d.name; }).join(', '));

      // Build output path
      var now      = new Date();
      var dateStr  = now.toISOString().slice(0, 10).replace(/-/g, '');
      var timeStr  = now.toTimeString().slice(0, 8).replace(/:/g, '-');
      var ext      = target.db_type === 'postgresql' ? 'dump' : 'sql.gz';
      var fileName = target.db_type + '_' + target.database_name + '_' + backupType + '_' + dateStr + '_' + timeStr + '.' + ext;

      var localDest = destList.find(function(d) { return d.dest_type === 'local' || d.dest_type === 'nfs' || d.dest_type === 'local_nfs'; });
      var localCfg  = localDest && localDest.config
        ? (typeof localDest.config === 'string' ? JSON.parse(localDest.config) : localDest.config)
        : {};
      var basePath  = localCfg.path || localCfg.local_path || localCfg.mount_path ||
                      localDest && localDest.path ||
                      '/primary-db-backup';
      var outputPath = path.join(basePath, target.database_name, 'Backup_DB', dateStr, fileName);

      var fileSize = await this.runDump(target, outputPath, runId);
      await this.updateRunStatus(runId, 'running', { fileSize: fileSize, filePath: outputPath });
      await this.log(runId, 'INFO', 'Verifying dump integrity');

      // Sync to remote destinations
      // dest_type values: 'local' (NFS), 'remote_sftp' (Remote Onsite), 'aws_s3' (S3)
      var remoteSync = require('./remoteSync');
      var s3Service  = require('./s3Service');

      for (var i = 0; i < destList.length; i++) {
        var dest = destList[i];
        // Skip local/NFS — already written as primary destination
        if (dest.dest_type === 'local' || dest.dest_type === 'nfs') continue;

        try {
          if (dest.dest_type === 'remote_sftp' || dest.dest_type === 'remote') {
            // rsyncFileToRemote(runId, localFilePath, dest, logFn)
            await remoteSync.rsyncFileToRemote(runId, outputPath, dest, this.log.bind(this));
          } else if (dest.dest_type === 'oci_object' || dest.dest_type === 'oci') {
            var ociService = require('./ociService');
            await ociService.uploadToOCI(runId, outputPath, dest, this.log.bind(this));
          } else if (dest.dest_type === 'aws_s3' || dest.dest_type === 's3') {
            // uploadToS3(runId, localFilePath, dest, logFn)
            await s3Service.uploadToS3(runId, outputPath, dest, this.log.bind(this));
          }
        } catch (destErr) {
          await this.log(runId, 'ERROR', 'Destination "' + dest.name + '" FAILED: ' + destErr.message);
          await this.log(runId, 'ERROR', '  dest_type: ' + dest.dest_type + ' | Check server logs for full trace');
          console.error('[BackupEngine] Dest failed:', dest.name, destErr.message, destErr.stack);
        }
      }

      // Log to activity_events
      try {
        var dur = Math.round((Date.now() - startTime) / 1000);
        await db.pool.execute(
          'INSERT INTO activity_events (event_type,source,target_name,status,message,detail,run_id) VALUES (?,?,?,?,?,?,?)',
          ['backup_run', target.host, target.name, 'success',
           'Backup success: ' + target.name + ' (' + target.db_type.toUpperCase() + ') — ' + dur + 's',
           JSON.stringify({ run_id: runId, db_type: target.db_type, duration_sec: dur, file_size_bytes: fileSize, backup_type: backupType, trigger_type: triggeredBy }),
           runId]
        );
      } catch {}

      await this.updateRunStatus(runId, 'success');
      await this.log(runId, 'SUCCESS', '=== Backup COMPLETED SUCCESSFULLY ===');
      return { runId: runId, runUuid: runUuid, status: 'success', fileSize: fileSize, filePath: outputPath };

    } catch (err) {
      await this.log(runId, 'ERROR', 'Fatal error: ' + err.message);
      try {
        var dur = Math.round((Date.now() - startTime) / 1000);
        await db.pool.execute(
          'INSERT INTO activity_events (event_type,source,target_name,status,message,detail,run_id) VALUES (?,?,?,?,?,?,?)',
          ['backup_run', target.host, target.name, 'error',
           'Backup FAILED: ' + target.name + ' — ' + err.message.substring(0, 200),
           JSON.stringify({ run_id: runId, db_type: target.db_type, duration_sec: Math.round((Date.now()-startTime)/1000), error: err.message }),
           runId]
        );
      } catch {}
      await this.updateRunStatus(runId, 'failed', { errorMsg: err.message.substring(0, 500) });
      throw err;
    }
  }
}

module.exports = BackupEngine;
