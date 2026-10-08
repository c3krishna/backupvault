// /var/www/backupvault/backend/src/services/scheduler.js
// Extended scheduler with storage monitoring + destination health checks

const cron           = require('node-cron');
const notifier       = require('./notifier');
const db             = require('../db/connection');
const storageMonitor = require('./storageMonitor');
const s3Service      = require('./s3Service');
const remoteSync     = require('./remoteSync');

class Scheduler {
  constructor() {
    this.tasks   = new Map();
    this.engine  = null;
    this.systemTasks = [];
  }

  setEngine(engine) {
    this.engine = engine;
  }

  // ── LOAD BACKUP JOBS FROM DB ─────────────────────────────────────────────────
  async loadAndSchedule() {
    const jobs = await db.query(
      'SELECT bj.*, bt.name as target_name FROM backup_jobs bj JOIN backup_targets bt ON bj.target_id=bt.id WHERE bj.is_scheduled=1 AND bj.is_active=1'
    );
    for (const job of jobs) {
      this.scheduleJob(job);
    }
    console.log(`[Scheduler] Loaded ${jobs.length} scheduled backup jobs`);

    // Check OCI destinations on startup
  try {
    const ociService = require('./ociService');
    await ociService.checkAllOCIDestinations();
  } catch(e) { console.log('[OCI] No OCI destinations or check failed:', e.message); }

  // Start system monitoring tasks
    this.startSystemTasks();
  }

  scheduleJob(job) {
    if (!job.schedule_cron || !cron.validate(job.schedule_cron)) {
      console.warn(`[Scheduler] Invalid cron for job ${job.id}: ${job.schedule_cron}`);
      return;
    }
    if (this.tasks.has(job.id)) this.tasks.get(job.id).stop();

    const task = cron.schedule(job.schedule_cron, async () => {
      console.log(`[Scheduler] Triggering job: ${job.name}`);
      try {
        await this.engine.runBackup(job.id, job.target_id, job.backup_type, 'scheduled');
      } catch (err) {
        console.error(`[Scheduler] Job ${job.id} error:`, err.message);
      }
    });
    this.tasks.set(job.id, task);
    console.log(`[Scheduler] Scheduled "${job.name}" → ${job.schedule_cron}`);
  }

  unscheduleJob(jobId) {
    if (this.tasks.has(jobId)) {
      this.tasks.get(jobId).stop();
      this.tasks.delete(jobId);
    }
  }

  // ── SYSTEM MONITORING TASKS ──────────────────────────────────────────────────
  startSystemTasks() {

    // 1. Storage monitor — every 30 minutes
    const storageTask = cron.schedule('*/30 * * * *', async () => {
      console.log('[Scheduler] Running storage health check...');
      try {
        await storageMonitor.runChecks();
      } catch (err) {
        console.error('[Scheduler] Storage check error:', err.message);
      }
    });
    this.systemTasks.push(storageTask);
    console.log('[Scheduler] Storage monitor → every 30 min');

    // 2. S3 connectivity check — every 15 minutes
    const s3Task = cron.schedule('*/15 * * * *', async () => {
      console.log('[Scheduler] Running S3 health check...');
      try {
        await s3Service.checkAllS3Destinations();
      } catch (err) {
        console.error('[Scheduler] S3 check error:', err.message);
      }
    });
    this.systemTasks.push(s3Task);
    console.log('[Scheduler] S3 health check → every 15 min');

    // 3. Remote DR connectivity check — every 15 minutes
    const remoteTask = cron.schedule('*/15 * * * *', async () => {
      console.log('[Scheduler] Running Remote DR health check...');
      try {
        await remoteSync.checkAllRemoteDestinations();
      } catch (err) {
        console.error('[Scheduler] Remote check error:', err.message);
      }
    });
    this.systemTasks.push(remoteTask);
    console.log('[Scheduler] Remote DR health check → every 15 min');

    // 3b. NFS live disk check — every minute (feeds NFS menu + monitoring graphs)
    const nfsTask = cron.schedule('* * * * *', async () => {
      try {
        const nfsRoutes = require('../routes/nfs');
        const results = await nfsRoutes.checkAllLive();
        console.log(`[Scheduler] NFS live check — ${results.length} servers`);
      } catch (err) {
        console.error('[Scheduler] NFS check error:', err.message);
      }
    });
    this.systemTasks.push(nfsTask);
    console.log('[Scheduler] NFS live check → every 60s');

    // 3c. Incremental rsync scripts on db-backup (10.180.0.90) — every 4 hours
    const incCron = process.env.INCREMENTAL_CRON || '0 */4 * * *';
    const incTz = process.env.INCREMENTAL_TZ || 'Asia/Kolkata';
    if (cron.validate(incCron)) {
      const incTask = cron.schedule(incCron, () => {
        console.log('[Scheduler] Incremental 4h sync cycle...');
        try {
          const incremental = require('./incrementalService');
          const r = incremental.startCycleInBackground('scheduled');
          if (r.skipped) console.log('[Scheduler] Incremental cycle skipped:', r.reason);
        } catch (err) {
          console.error('[Scheduler] Incremental error:', err.message);
        }
      }, { timezone: incTz });
      this.systemTasks.push(incTask);
      console.log(`[Scheduler] Incremental sync → ${incCron} (${incTz}) via SSH`);
    } else {
      console.warn(`[Scheduler] Invalid INCREMENTAL_CRON: ${incCron}`);
    }

    // 3d. Cloud retention — purge AWS S3 + OCI objects older than CLOUD_RETENTION_DAYS
    // Default: keep last 30 days; run daily 06:30 Asia/Kolkata
    const cloudRetCron = process.env.CLOUD_RETENTION_CRON || '30 6 * * *';
    const cloudRetTz = process.env.CLOUD_RETENTION_TZ || process.env.INCREMENTAL_TZ || 'Asia/Kolkata';
    if (cron.validate(cloudRetCron)) {
      const cloudRetTask = cron.schedule(cloudRetCron, async () => {
        console.log('[Scheduler] Cloud retention purge (S3 + OCI)...');
        try {
          const cloudRetention = require('./cloudRetention');
          const summary = await cloudRetention.runCloudRetention();
          console.log(
            `[Scheduler] Cloud retention done — deleted=${summary.deleted || 0} expired=${summary.expired || 0}`
          );
        } catch (err) {
          console.error('[Scheduler] Cloud retention error:', err.message);
        }
      }, { timezone: cloudRetTz });
      this.systemTasks.push(cloudRetTask);
      console.log(`[Scheduler] Cloud retention → ${cloudRetCron} (${cloudRetTz}) keep ${process.env.CLOUD_RETENTION_DAYS || 30}d`);
    } else {
      console.warn(`[Scheduler] Invalid CLOUD_RETENTION_CRON: ${cloudRetCron}`);
    }

    // 4. Run initial checks immediately at startup (after 10s delay)
    setTimeout(async () => {
      console.log('[Scheduler] Running startup health checks...');
      try {
        await storageMonitor.runChecks();
        await s3Service.checkAllS3Destinations();
        await remoteSync.checkAllRemoteDestinations();
        try {
          const nfsRoutes = require('../routes/nfs');
          await nfsRoutes.checkAllLive();
        } catch (nfsErr) {
          console.error('[Scheduler] Startup NFS check error:', nfsErr.message);
        }
        console.log('[Scheduler] Startup health checks complete');
      } catch (err) {
        console.error('[Scheduler] Startup check error:', err.message);
      }
    }, 10000);
  }

  stopAll() {
    this.tasks.forEach(t => t.stop());
    this.systemTasks.forEach(t => t.stop());
    this.tasks.clear();
    this.systemTasks = [];
  }
}

// Daily summary email at 09:00 IST (03:30 UTC)
cron.schedule('30 3 * * *', async () => {
  console.log('[Scheduler] Sending daily summary email...');
  try { await notifier.sendDailySummary(); }
  catch (e) { console.error('[Scheduler] Daily summary failed:', e.message); }
}, { timezone: 'UTC' });


// Physical server monitoring — collect every 5 minutes (direct function call, no HTTP)
cron.schedule('*/5 * * * *', async () => {
  try {
    const monitoringRoute = require('../routes/monitoring');
    // Call the internal collect function directly (avoid HTTP overhead)
    const servers = await db.query(
      'SELECT * FROM db_servers WHERE is_active=1 AND monitoring_enabled=1'
    );
    if (!servers.length) {
      console.log('[Monitor] No servers configured for monitoring yet');
      return;
    }
    console.log(`[Monitor] Collecting metrics for ${servers.length} servers...`);
    // Use the route module's internal collect via a lightweight self-request
    const http    = require('http');
    const jwt     = require('jsonwebtoken');
    const token   = jwt.sign(
      { id:0, name:'scheduler', role:'super_admin' },
      process.env.JWT_SECRET||'super_secure_backupvault_token_key',
      { expiresIn:'10m' }
    );
    const postData = '';
    const options  = {
      hostname: '127.0.0.1',
      port:     parseInt(process.env.PORT||4100),
      path:     '/api/monitoring/servers/collect-all',
      method:   'POST',
      headers:  {
        Authorization:   `Bearer ${token}`,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(postData),
      }
    };
    const req = http.request(options, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          console.log(`[Monitor] Collected ${result.collected||0} servers at ${new Date().toISOString()}`);
        } catch {}
      });
    });
    req.on('error', e => console.error('[Monitor] HTTP collect error:', e.message));
    req.write(postData);
    req.end();
  } catch(e) { console.error('[Monitor] Scheduler error:', e.message); }
}, { timezone: 'UTC' });

module.exports = new Scheduler();
