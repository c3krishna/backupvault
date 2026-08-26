// backend/src/routes/api.js
const express = require('express');
const router  = express.Router();
const db      = require('../db/connection');
const authModule = require('./auth');
const auth        = authModule.auth || authModule;
const requireRole = authModule.requireRole;

let engine;
router.use((req, res, next) => { req.engine = engine; next(); });

// ── DASHBOARD ────────────────────────────────────────────────────────────────
router.get('/dashboard/stats', async (req, res) => {
  try {
    const todayRows = await db.query(`
      SELECT COUNT(*) total_runs,
        SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) success,
        SUM(CASE WHEN status='failed'  THEN 1 ELSE 0 END) failed,
        SUM(CASE WHEN status='partial' THEN 1 ELSE 0 END) partial,
        SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) running,
        SUM(file_size_bytes) total_bytes
      FROM backup_runs WHERE DATE(started_at)=CURDATE()`);
    const targets = await db.query('SELECT COUNT(*) c FROM backup_targets WHERE is_active=1');
    const jobs    = await db.query('SELECT COUNT(*) c FROM backup_jobs WHERE is_scheduled=1 AND is_active=1');
    res.json({ today: todayRows, targets: targets[0].c, scheduled_jobs: jobs[0].c });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/dashboard/calendar', async (req, res) => {
  try {
    const { days = 35 } = req.query;
    const rows = await db.query(`
      SELECT DATE(started_at) date,
        COUNT(*) total,
        SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) success,
        SUM(CASE WHEN status='failed'  THEN 1 ELSE 0 END) failed,
        SUM(CASE WHEN status='partial' THEN 1 ELSE 0 END) partial,
        SUM(file_size_bytes) total_bytes
      FROM backup_runs
      WHERE started_at>=DATE_SUB(CURDATE(),INTERVAL ? DAY)
      GROUP BY DATE(started_at) ORDER BY date DESC`, [parseInt(days)]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/dashboard/recent-runs', async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT br.*,bt.name target_name,bt.db_type,bj.name job_name
      FROM backup_runs br
      JOIN backup_targets bt ON br.target_id=bt.id
      LEFT JOIN backup_jobs bj ON br.job_id=bj.id
      ORDER BY br.started_at DESC LIMIT 20`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── TARGETS ──────────────────────────────────────────────────────────────────
router.get('/targets', async (req, res) => {
  try { res.json(await db.query('SELECT * FROM backup_targets ORDER BY name')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/targets', auth, requireRole('super_admin','admin'), async (req, res) => {
  try {
    const { name,db_type,host,port,username,password,database_name,description } = req.body;
    const [r] = await db.pool.execute(
      'INSERT INTO backup_targets(name,db_type,host,port,username,password,database_name,description) VALUES(?,?,?,?,?,?,?,?)',
      [name,db_type,host,port,username,password,database_name,description]);
    res.json({ id: r.insertId, message: 'Target created' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/targets/:id', auth, requireRole('super_admin','admin'), async (req, res) => {
  try {
    const { name,db_type,host,port,username,password,database_name,description,is_active } = req.body;
    await db.query('UPDATE backup_targets SET name=?,db_type=?,host=?,port=?,username=?,password=?,database_name=?,description=?,is_active=? WHERE id=?',
      [name,db_type,host,port,username,password,database_name,description,is_active,req.params.id]);
    res.json({ message: 'Updated' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/targets/:id', auth, requireRole('super_admin','admin'), async (req, res) => {
  try { await db.query('UPDATE backup_targets SET is_active=0 WHERE id=?',[req.params.id]); res.json({ message:'Deactivated' }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/targets/:id/test', auth, async (req, res) => {
  try {
    const t = await db.queryOne('SELECT * FROM backup_targets WHERE id=?', [req.params.id]);
    if (!t) return res.status(404).json({ success: false, message: 'Target not found' });
    const t0 = Date.now();
    if (t.db_type === 'mysql') {
      const mysql = require('mysql2/promise');
      const conn = await mysql.createConnection({
        host: t.host, port: t.port || 3306, user: t.username, password: t.password,
        database: t.database_name || undefined, connectTimeout: 8000,
      });
      await conn.query('SELECT 1');
      await conn.end();
    } else if (t.db_type === 'postgresql') {
      const { Client } = require('pg');
      const c = new Client({
        host: t.host, port: t.port || 5432, user: t.username, password: t.password,
        database: t.database_name || 'postgres', connectionTimeoutMillis: 8000,
      });
      await c.connect();
      await c.query('SELECT 1');
      await c.end();
    } else if (t.db_type === 'redis') {
      const { execSync } = require('child_process');
      const out = execSync(
        `redis-cli -h '${t.host}' -p ${t.port || 6379} ping`,
        { timeout: 8000 }
      ).toString().trim();
      if (out !== 'PONG') throw new Error('Redis did not reply PONG');
    } else {
      throw new Error('Unsupported db_type: ' + t.db_type);
    }
    res.json({ success: true, message: 'Connection successful', latency_ms: Date.now() - t0 });
  } catch (e) {
    res.json({ success: false, message: (e.message || 'Connection failed').substring(0, 240) });
  }
});

// ── JOBS ─────────────────────────────────────────────────────────────────────
router.get('/jobs', async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT bj.*,bt.name target_name,bt.db_type,
        (SELECT COUNT(*) FROM backup_runs WHERE job_id=bj.id) run_count,
        (SELECT status FROM backup_runs WHERE job_id=bj.id ORDER BY started_at DESC LIMIT 1) last_status,
        (SELECT started_at FROM backup_runs WHERE job_id=bj.id ORDER BY started_at DESC LIMIT 1) last_run
      FROM backup_jobs bj JOIN backup_targets bt ON bj.target_id=bt.id
      ORDER BY bj.name`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/jobs', auth, requireRole('super_admin','admin'), async (req, res) => {
  try {
    const { name,target_id,backup_type,schedule_cron,is_scheduled,retention_days,destinations } = req.body;
    const [r] = await db.pool.execute(
      'INSERT INTO backup_jobs(name,target_id,backup_type,schedule_cron,is_scheduled,retention_days,destinations) VALUES(?,?,?,?,?,?,?)',
      [name,target_id,backup_type,schedule_cron,is_scheduled?1:0,retention_days,JSON.stringify(destinations)]);
    res.json({ id:r.insertId, message:'Job created' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/jobs/:id', auth, requireRole('super_admin','admin'), async (req, res) => {
  try {
    const { name,backup_type,schedule_cron,is_scheduled,retention_days,destinations,is_active } = req.body;
    await db.query('UPDATE backup_jobs SET name=?,backup_type=?,schedule_cron=?,is_scheduled=?,retention_days=?,destinations=?,is_active=? WHERE id=?',
      [name,backup_type,schedule_cron,is_scheduled?1:0,retention_days,JSON.stringify(destinations),is_active?1:0,req.params.id]);
    res.json({ message:'Job updated' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/jobs/:id', auth, requireRole('super_admin','admin'), async (req, res) => {
  try { await db.query('UPDATE backup_jobs SET is_active=0 WHERE id=?',[req.params.id]); res.json({ message:'Job deactivated' }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/jobs/:id/toggle', async (req, res) => {
  try {
    const job = await db.queryOne('SELECT is_scheduled FROM backup_jobs WHERE id=?',[req.params.id]);
    if (!job) return res.status(404).json({ error:'Not found' });
    const s = job.is_scheduled ? 0 : 1;
    await db.query('UPDATE backup_jobs SET is_scheduled=? WHERE id=?',[s,req.params.id]);
    res.json({ is_scheduled:s });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── BACKUP TRIGGER ────────────────────────────────────────────────────────────
router.post('/backup/trigger', auth, requireRole('super_admin','admin','executor'), async (req, res) => {
  try {
    const { target_id, job_id, backup_type='full' } = req.body;
    if (!target_id) return res.status(400).json({ error:'target_id required' });

    // Pass empty destinations [] so backupEngine loads ALL active from DB
    // This guarantees new destinations (OCI etc) are always included
    engine.runBackup(job_id||null, target_id, backup_type, 'manual', [])
      .then(r => console.log('[API] Backup started: runId=' + (r && r.runId ? r.runId : r)))
      .catch(e => console.error('[API] Backup error:', e.message));
    res.json({ message:'Backup initiated', status:'started' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/backup/trigger-all', auth, requireRole('super_admin','admin','executor'), async (req, res) => {
  try {
    const { backup_type='full' } = req.body;
    const targets = await db.query('SELECT * FROM backup_targets WHERE is_active=1');
    const allDests = await db.query("SELECT id FROM backup_destinations WHERE is_active=1");
    const allDestIds = allDests.map(d => d.id);
    for (const t of targets) {
      const job = await db.queryOne('SELECT * FROM backup_jobs WHERE target_id=? AND is_active=1 LIMIT 1',[t.id]);
      engine.runBackup(job?.id||null, t.id, backup_type, 'manual', allDestIds).catch(e => console.error('[trigger-all] ' + t.name + ':', e.message));
      await new Promise(r => setTimeout(r,300));
    }
    res.json({ message:`Backup initiated for ${targets.length} targets` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── RUNS ─────────────────────────────────────────────────────────────────────
router.get('/runs', async (req, res) => {
  try {
    const { date,target_id,status,limit=50,offset=0 } = req.query;
    let sql = `SELECT br.*,bt.name target_name,bt.db_type,bj.name job_name
               FROM backup_runs br JOIN backup_targets bt ON br.target_id=bt.id
               LEFT JOIN backup_jobs bj ON br.job_id=bj.id WHERE 1=1`;
    const p = [];
    if (date)      { sql+=' AND DATE(br.started_at)=?'; p.push(date); }
    if (target_id) { sql+=' AND br.target_id=?';        p.push(target_id); }
    if (status)    { sql+=' AND br.status=?';           p.push(status); }
    sql+=' ORDER BY br.started_at DESC LIMIT ? OFFSET ?';
    p.push(parseInt(limit), parseInt(offset));
    res.json(await db.query(sql, p));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/runs/:id', async (req, res) => {
  try {
    const run = await db.queryOne(`SELECT br.*,bt.name target_name,bt.db_type,bj.name job_name
      FROM backup_runs br JOIN backup_targets bt ON br.target_id=bt.id
      LEFT JOIN backup_jobs bj ON br.job_id=bj.id WHERE br.id=?`,[req.params.id]);
    if (!run) return res.status(404).json({ error:'Not found' });
    const transfers = await db.query(`SELECT bt.*,bd.name dest_name FROM backup_transfers bt
      JOIN backup_destinations bd ON bt.destination_id=bd.id WHERE bt.run_id=?`,[run.id]);
    res.json({ ...run, transfers });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/runs/:id/logs', async (req, res) => {
  try { res.json(await db.query('SELECT * FROM backup_logs WHERE run_id=? ORDER BY logged_at ASC',[req.params.id])); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DESTINATIONS ──────────────────────────────────────────────────────────────
router.get('/destinations', async (req, res) => {
  try { res.json(await db.query('SELECT * FROM backup_destinations ORDER BY name')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/destinations', async (req, res) => {
  try {
    const { name, dest_type, config, encryption_enabled } = req.body;
    const configToStore = config || {};
    if (encryption_enabled !== undefined) {
      configToStore.encryption_enabled = !!encryption_enabled;
    }
    // Always activate on create
    const [r] = await db.pool.execute(
      'INSERT INTO backup_destinations(name,dest_type,config,is_active) VALUES(?,?,?,1)',
      [name, dest_type, JSON.stringify(configToStore)]
    );
    res.json({ id:r.insertId, message:'Destination created' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/destinations/:id', async (req, res) => {
  try {
    const { name, dest_type, config, is_active, encryption_enabled } = req.body;
    const configToStore = config || {};
    if (encryption_enabled !== undefined) {
      configToStore.encryption_enabled = !!encryption_enabled;
    }
    // For oci_object: always keep active (never allow deactivation via edit form)
    const activeValue = dest_type === 'oci_object' ? 1 : (is_active ? 1 : 0);
    await db.query(
      'UPDATE backup_destinations SET name=?,dest_type=?,config=?,is_active=? WHERE id=?',
      [name, dest_type, JSON.stringify(configToStore), activeValue, req.params.id]
    );
    res.json({ message:'Updated' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/destinations/:id', async (req, res) => {
  try { await db.query('UPDATE backup_destinations SET is_active=0 WHERE id=?',[req.params.id]); res.json({ message:'Deactivated' }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── STORAGE STATS ─────────────────────────────────────────────────────────────
router.get('/storage/stats', async (req, res) => {
  try {
    const byType   = await db.query(`SELECT bt.db_type,COUNT(br.id) run_count,SUM(br.file_size_bytes) total_bytes,AVG(br.file_size_bytes) avg_bytes,SUM(CASE WHEN br.status='success' THEN 1 ELSE 0 END) success_count,SUM(CASE WHEN br.status='failed' THEN 1 ELSE 0 END) fail_count FROM backup_runs br JOIN backup_targets bt ON br.target_id=bt.id WHERE br.started_at>=DATE_SUB(NOW(),INTERVAL 30 DAY) GROUP BY bt.db_type`);
    const byTarget = await db.query(`SELECT bt.name,bt.db_type,COUNT(br.id) run_count,SUM(br.file_size_bytes) total_bytes,MAX(br.started_at) last_run,(SELECT br2.status FROM backup_runs br2 WHERE br2.target_id=bt.id ORDER BY br2.started_at DESC LIMIT 1) last_status FROM backup_targets bt LEFT JOIN backup_runs br ON bt.id=br.target_id AND br.started_at>=DATE_SUB(NOW(),INTERVAL 30 DAY) WHERE bt.is_active=1 GROUP BY bt.id,bt.name,bt.db_type ORDER BY total_bytes DESC`);
    const trend    = await db.query(`SELECT DATE(started_at) date,SUM(file_size_bytes) total_bytes,COUNT(*) run_count FROM backup_runs WHERE started_at>=DATE_SUB(NOW(),INTERVAL 14 DAY) AND status IN ('success','partial') GROUP BY DATE(started_at) ORDER BY date ASC`);
    res.json({ byType, byTarget, trend });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SETTINGS + SERVER MONITORING ──────────────────────────────────────────────
router.get('/settings', async (req, res) => {
  const { execSync } = require('child_process');
  const os = require('os');

  function safeExec(cmd) {
    try { return execSync(cmd, { timeout: 5000 }).toString().trim(); } catch { return null; }
  }

  // ── CPU ────────────────────────────────────────────────────────────────────
  const cpuInfo = os.cpus();
  const cpuModel = cpuInfo[0]?.model || 'Unknown';
  const cpuCores = cpuInfo.length;

  // CPU usage % (1-second sample via /proc/stat)
  let cpuUsagePct = null;
  try {
    const s1 = require('fs').readFileSync('/proc/stat','utf8').split('\n')[0].split(/\s+/).slice(1).map(Number);
    await new Promise(r => setTimeout(r, 200));
    const s2 = require('fs').readFileSync('/proc/stat','utf8').split('\n')[0].split(/\s+/).slice(1).map(Number);
    const idle1 = s1[3]+s1[4], idle2 = s2[3]+s2[4];
    const total1 = s1.reduce((a,b)=>a+b,0), total2 = s2.reduce((a,b)=>a+b,0);
    cpuUsagePct = Math.round((1-(idle2-idle1)/(total2-total1))*100);
  } catch {}

  // ── MEMORY ─────────────────────────────────────────────────────────────────
  const totalMem  = os.totalmem();
  const freeMem   = os.freemem();
  const usedMem   = totalMem - freeMem;
  const memPct    = Math.round(usedMem / totalMem * 100);

  // ── DISK ───────────────────────────────────────────────────────────────────
  const diskLines = (safeExec('df -h') || '').split('\n').slice(1).filter(Boolean);
  const disks = diskLines.map(l => {
    const p = l.replace(/\s+/g,' ').split(' ');
    return { filesystem:p[0], size:p[1], used:p[2], avail:p[3], usePct:p[4], mount:p[5] };
  }).filter(d => d.filesystem && !d.filesystem.startsWith('tmpfs') && !d.filesystem.startsWith('udev')
    && !d.filesystem.startsWith('devtmpfs') && d.mount);

  // ── NETSTAT PROCESSES (listening ports) ────────────────────────────────────
  const ssOut = safeExec('ss -tlnp') || safeExec('netstat -tlnp 2>/dev/null') || '';
  const netLines = ssOut.split('\n').slice(1).filter(l => l.includes('LISTEN') || l.includes('0.0.0.0'));
  const listening = netLines.map(l => {
    const p = l.replace(/\s+/g,' ').trim().split(' ');
    // ss format: State Recv-Q Send-Q Local-Address:Port ...
    const addr = p[3] || p[2] || '';
    const portMatch = addr.match(/:([\d]+)$/);
    const procMatch = l.match(/users:\(\("([^"]+)"/);
    return {
      port:    portMatch?.[1] || '—',
      address: addr,
      process: procMatch?.[1] || (l.includes('4100') ? 'backupvault' : '—'),
    };
  }).filter(n => n.port !== '—').sort((a,b) => parseInt(a.port)-parseInt(b.port));

  // ── PM2 PROCESSES ──────────────────────────────────────────────────────────
  let pm2List = [];
  try {
    const pm2Out = safeExec('pm2 jlist');
    if (pm2Out) {
      pm2List = JSON.parse(pm2Out).map(p => ({
        id:      p.pm_id,
        name:    p.name,
        status:  p.pm2_env?.status,
        cpu:     p.monit?.cpu,
        memory:  p.monit?.memory,
        uptime:  p.pm2_env?.pm_uptime,
        restarts:p.pm2_env?.restart_time,
      }));
    }
  } catch {}

  // ── LOAD AVERAGE ───────────────────────────────────────────────────────────
  const load = os.loadavg().map(l => Math.round(l*100)/100);

  res.json({
    // App config
    backup_dir:          process.env.BACKUP_DIR     || '/var/backups/backupvault',
    primary_mount:       process.env.PRIMARY_MOUNT  || '/primary-db-backup',
    secondary_mount:     process.env.SECONDARY_MOUNT || '/secondary-db-backup',
    timezone:            'Asia/Kolkata',
    retention_default:   30,
    max_concurrent_jobs: 3,
    notification_email:  process.env.NOTIFY_EMAIL   || '',
    storage_warn_pct:    parseInt(process.env.STORAGE_WARN_PCT || '80'),
    storage_crit_pct:    parseInt(process.env.STORAGE_CRIT_PCT || '90'),
    version:             '1.0.0',
    node_version:        process.version,
    uptime_seconds:      Math.floor(process.uptime()),
    hostname:            os.hostname(),
    platform:            os.platform(),
    arch:                os.arch(),
    // Server monitoring
    cpu: { model:cpuModel, cores:cpuCores, usagePct:cpuUsagePct, loadAvg:load },
    memory: {
      totalBytes:totalMem, usedBytes:usedMem, freeBytes:freeMem, usedPct:memPct,
      totalHuman: (totalMem/1024/1024/1024).toFixed(1)+'G',
      usedHuman:  (usedMem/1024/1024/1024).toFixed(1)+'G',
      freeHuman:  (freeMem/1024/1024/1024).toFixed(1)+'G',
    },
    disks,
    listening,
    pm2: pm2List,
  });
});


// ── OCI OBJECT STORAGE ROUTES ─────────────────────────────────────────────────

// POST /api/oci/test-config — test OCI with raw config (no saved dest needed)
router.post('/oci/test-config', auth, async (req, res) => {
  try {
    const { namespace, region, bucket, access_key, secret_key } = req.body;
    if (!namespace || !region || !bucket || !access_key || !secret_key)
      return res.status(400).json({ success:false, error:'All fields required' });
    const ociService = require('../services/ociService');
    const result = await ociService.testOciConnection({ namespace, region, bucket, access_key, secret_key });
    res.json(result);
  } catch(e) { res.json({ success:false, error:e.message }); }
});

// POST /api/oci/generate-key
router.post('/oci/generate-key', auth, async (req, res) => {
  try {
    const key = require('crypto').randomBytes(32).toString('hex');
    res.json({ key, message: 'Add BACKUP_ENCRYPTION_KEY=' + key + ' to your .env file' });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// GET /api/oci/audit
router.get('/oci/audit', auth, async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM encryption_audit ORDER BY created_at DESC LIMIT 100');
    res.json(rows);
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// GET /api/oci/:id/list
router.get('/oci/:id/list', auth, async (req, res) => {
  try {
    const dest = await db.queryOne('SELECT * FROM backup_destinations WHERE id=?', [req.params.id]);
    if (!dest) return res.status(404).json({ error:'Destination not found' });
    const config = typeof dest.config === 'string' ? JSON.parse(dest.config) : dest.config;
    const ociService = require('../services/ociService');
    const result = await ociService.listOCIBucket(config, req.query.prefix || '');
    res.json(result);
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// GET /api/oci/:id/presign
router.get('/oci/:id/presign', auth, async (req, res) => {
  try {
    const dest = await db.queryOne('SELECT * FROM backup_destinations WHERE id=?', [req.params.id]);
    if (!dest) return res.status(404).json({ error:'Destination not found' });
    const config = typeof dest.config === 'string' ? JSON.parse(dest.config) : dest.config;
    const ociService = require('../services/ociService');
    const url = await ociService.presignOCI(config, req.query.key, 3600);
    res.json({ url, expiresIn: 3600 });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// POST /api/oci/:id/test
router.post('/oci/:id/test', auth, async (req, res) => {
  try {
    const dest = await db.queryOne('SELECT * FROM backup_destinations WHERE id=?', [req.params.id]);
    if (!dest) return res.status(404).json({ error:'Destination not found' });
    const config = typeof dest.config === 'string' ? JSON.parse(dest.config) : dest.config;
    const ociService = require('../services/ociService');
    const result = await ociService.testOciConnection(config);
    res.json(result);
  } catch(e) { res.json({ success:false, error:e.message }); }
});

module.exports = (eng) => { engine = eng; return router; };

// ── ACTIVITY CENTER ───────────────────────────────────────────────────────────

// GET /api/activity — paginated activity feed with filters
router.get('/activity', auth, async (req, res) => {
  try {
    const { page=1, limit=50, status, type, search } = req.query;
    const offset = (parseInt(page)-1) * parseInt(limit);
    const where  = ['1=1'];
    const params = [];
    if (status) { where.push('a.status=?'); params.push(status); }
    if (type)   { where.push('a.event_type=?'); params.push(type); }
    if (search) { where.push('(a.message LIKE ? OR a.target_name LIKE ?)');
                  params.push(`%${search}%`,`%${search}%`); }

    const rows = await db.query(
      `SELECT a.*, br.backup_type, br.file_size_bytes,
              bt.name AS db_target_name, bt.db_type
       FROM activity_events a
       LEFT JOIN backup_runs br ON br.id = a.run_id
       LEFT JOIN backup_targets bt ON bt.id = br.target_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    const [total] = await db.query(
      `SELECT COUNT(*) AS cnt FROM activity_events a WHERE ${where.join(' AND ')}`,
      params
    );

    // Also get today's summary
    const [todaySummary] = await db.query(`
      SELECT
        COUNT(*) total,
        SUM(status='success') success,
        SUM(status='error')   errors,
        SUM(status='running') running,
        SUM(event_type='relief_complete') relief_runs,
        SUM(event_type LIKE 'backup%')    backup_runs
      FROM activity_events WHERE DATE(created_at)=CURDATE()`
    );

    res.json({
      events: rows.map(r => ({
        ...r,
        detail: r.detail ? (typeof r.detail==='string' ? JSON.parse(r.detail) : r.detail) : null,
      })),
      total:   total.cnt,
      page:    parseInt(page),
      limit:   parseInt(limit),
      summary: todaySummary,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/activity — log an event (used by relief script, internal services)
router.post('/activity', auth, async (req, res) => {
  try {
    const { event_type, source, destination, target_name,
            status='info', message, detail, run_id } = req.body;
    if (!event_type || !message)
      return res.status(400).json({ error: 'event_type and message required' });
    const [r] = await db.pool.execute(
      `INSERT INTO activity_events
       (event_type,source,destination,target_name,status,message,detail,run_id)
       VALUES (?,?,?,?,?,?,?,?)`,
      [event_type, source||null, destination||null, target_name||null,
       status, message, detail ? JSON.stringify(detail) : null, run_id||null]
    );
    res.status(201).json({ id: r.insertId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/activity/run/:runId/logs — full logs for a specific backup run
router.get('/activity/run/:runId/logs', auth, async (req, res) => {
  try {
    const [run] = await db.query(
      `SELECT br.*, bt.name target_name, bt.db_type, bt.host
       FROM backup_runs br LEFT JOIN backup_targets bt ON bt.id=br.target_id
       WHERE br.id=?`, [req.params.runId]
    );
    const logs = await db.query(
      `SELECT * FROM backup_logs WHERE run_id=? ORDER BY created_at ASC`,
      [req.params.runId]
    );
    res.json({ run, logs });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/activity/stats — 7-day chart data
router.get('/activity/stats', auth, async (req, res) => {
  try {
    const daily = await db.query(`
      SELECT DATE(created_at) date,
        SUM(status='success') success,
        SUM(status='error')   errors,
        SUM(status='warning') warnings,
        COUNT(*) total
      FROM activity_events
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      GROUP BY DATE(created_at) ORDER BY date ASC`
    );
    const byType = await db.query(`
      SELECT event_type, COUNT(*) cnt, SUM(status='error') errors
      FROM activity_events
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      GROUP BY event_type ORDER BY cnt DESC`
    );
    res.json({ daily, byType });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/infra/storage-event — called by relief shell script
router.post('/infra/storage-event', auth, async (req, res) => {
  try {
    const { event, source, dest, moved, failed, freed_gb,
            disk_before_pct, disk_after_pct, target_name, message, detail } = req.body;
    const typeMap = {
      relief_start:    { status:'running', msg:`Storage relief started on ${source}` },
      relief_complete: { status:'success', msg:`Relief done: ${moved} folders moved, ${freed_gb} GB freed. Disk: ${disk_before_pct}% → ${disk_after_pct}%` },
      relief_failed:   { status:'error',   msg:`Relief failed: ${failed} items failed to migrate` },
      ssh_transfer:    { status:'info',    msg:`Transferred ${target_name} to ${dest}` },
      delete_source:   { status:'success', msg:`Deleted from primary: ${target_name}` },
      verify_failed:   { status:'error',   msg:`Verification failed for ${target_name}` },
    };
    const t = typeMap[event] || { status:'info', msg: message || event };
    await db.pool.execute(
      `INSERT INTO activity_events
       (event_type,source,destination,target_name,status,message,detail)
       VALUES (?,?,?,?,?,?,?)`,
      [event||'storage_event', source||null, dest||null, target_name||null,
       t.status, t.msg, JSON.stringify(req.body)]
    );
    res.json({ success:true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── CLOUD REGIONS API ────────────────────────────────────────────────────────

// GET /api/regions?provider=aws|oci — list regions from DB
router.get('/regions', auth, async (req, res) => {
  try {
    const { provider } = req.query;
    const where  = provider ? 'WHERE provider=? AND is_active=1' : 'WHERE is_active=1';
    const params = provider ? [provider] : [];
    const rows   = await db.query(
      `SELECT id, provider, region_code, region_name, city, country
       FROM cloud_regions ${where}
       ORDER BY sort_order ASC, region_name ASC`,
      params
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/regions — add a custom region
router.post('/regions', auth, requireRole('super_admin','admin'), async (req, res) => {
  try {
    const { provider, region_code, region_name, city, country, sort_order } = req.body;
    if (!provider || !region_code || !region_name)
      return res.status(400).json({ error: 'provider, region_code, region_name required' });
    const [r] = await db.pool.execute(
      'INSERT INTO cloud_regions (provider,region_code,region_name,city,country,sort_order) VALUES (?,?,?,?,?,?)',
      [provider, region_code, region_name, city||null, country||null, sort_order||100]
    );
    res.status(201).json({ id: r.insertId, message: 'Region added' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/regions/:id
router.delete('/regions/:id', auth, requireRole('super_admin','admin'), async (req, res) => {
  try {
    await db.query('UPDATE cloud_regions SET is_active=0 WHERE id=?', [req.params.id]);
    res.json({ message: 'Region removed' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── RESTORE API ───────────────────────────────────────────────────────────────
const { execSync: execSyncR, spawn: spawnR } = require('child_process');
const pathR = require('path');
const fsR   = require('fs-extra');
const restoreJobs = {}; // in-memory restore job tracking

// GET /api/restore/files?tier=primary|secondary|remote|s3|oci
router.get('/restore/files', auth, async (req, res) => {
  try {
    const { tier } = req.query;
    let files = [];

    if (tier === 'primary') {
      const base = process.env.PRIMARY_MOUNT || '/primary-db-backup';
      const found = execSyncR(
        'find ' + base + ' -name "*.sql.gz" -type f | sort -r | head -200',
        { timeout: 30000 }
      ).toString().trim().split('\n').filter(Boolean);
      files = found.map(f => ({
        name: pathR.basename(f), path: f, key: null,
        encrypted: false, size: 0, modified: null, tier
      }));

    } else if (tier === 'secondary') {
      const base = process.env.SECONDARY_MOUNT || '/secondary-db-backup';
      const found = execSyncR(
        'find ' + base + ' -name "*.sql.gz" -type f | sort -r | head -200',
        { timeout: 30000 }
      ).toString().trim().split('\n').filter(Boolean);
      files = found.map(f => ({
        name: pathR.basename(f), path: f, key: null,
        encrypted: false, size: 0, modified: null, tier
      }));

    } else if (tier === 'remote') {
      const dest = await db.queryOne("SELECT * FROM backup_destinations WHERE dest_type='remote_sftp' AND is_active=1");
      if (!dest) return res.json([]);
      const cfg  = typeof dest.config === 'string' ? JSON.parse(dest.config) : dest.config;
      const out  = execSyncR(
        'sshpass -p "' + cfg.password + '" ssh -o StrictHostKeyChecking=no -p ' + (cfg.port||22) + ' ' + (cfg.user||'root') + '@' + cfg.host +
        ' "find ' + (cfg.path||'/backups/remote') + ' -name \'*.sql.gz\' -type f | sort -r | head -200"',
        { timeout: 30000 }
      ).toString().trim().split('\n').filter(Boolean);
      files = out.map(f => ({ name: pathR.basename(f), path: f, key: null, encrypted: false, size: 0, modified: null, tier, dest_id: dest.id }));

    } else if (tier === 's3') {
      const dest = await db.queryOne("SELECT * FROM backup_destinations WHERE dest_type='aws_s3' AND is_active=1");
      if (!dest) return res.json([]);
      const cfg  = typeof dest.config === 'string' ? JSON.parse(dest.config) : dest.config;
      const env  = { ...process.env, AWS_ACCESS_KEY_ID: cfg.access_key, AWS_SECRET_ACCESS_KEY: cfg.secret_key, AWS_DEFAULT_REGION: cfg.region||'eu-west-2' };
      const out  = execSyncR(
        'aws s3api list-objects-v2 --bucket "' + cfg.bucket + '" --query "Contents[?ends_with(Key, \'.sql.gz\')] | sort_by(@, &LastModified) | reverse(@) | [0:200]" --output json',
        { env, timeout: 30000 }
      ).toString();
      const items = JSON.parse(out) || [];
      files = items.map(i => ({ name: pathR.basename(i.Key), path: null, key: i.Key, encrypted: false, size: i.Size, modified: i.LastModified, tier, dest_id: dest.id }));

    } else if (tier === 'oci') {
      const dest = await db.queryOne("SELECT * FROM backup_destinations WHERE dest_type='oci_object' AND is_active=1");
      if (!dest) return res.json([]);
      const cfg  = typeof dest.config === 'string' ? JSON.parse(dest.config) : dest.config;
      const env  = { ...process.env, AWS_ACCESS_KEY_ID: cfg.access_key, AWS_SECRET_ACCESS_KEY: cfg.secret_key, AWS_DEFAULT_REGION: cfg.region||'ap-mumbai-1' };
      const endpoint = 'https://' + cfg.namespace + '.compat.objectstorage.' + cfg.region + '.oraclecloud.com';
      const out  = execSyncR(
        'aws s3api list-objects-v2 --bucket "' + cfg.bucket + '" --region "' + cfg.region + '" --endpoint-url "' + endpoint + '" --output json',
        { env, timeout: 30000 }
      ).toString();
      const data  = JSON.parse(out);
      const items = (data.Contents || []).filter(i => i.Key.endsWith('.sql.gz') || i.Key.endsWith('.sql.gz.enc'));
      items.sort((a,b) => new Date(b.LastModified) - new Date(a.LastModified));
      files = items.slice(0,200).map(i => ({
        name: pathR.basename(i.Key), path: null, key: i.Key,
        encrypted: i.Key.endsWith('.enc'), size: i.Size,
        modified: i.LastModified, tier, dest_id: dest.id
      }));
    }

    res.json(files);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/restore/run
router.post('/restore/run', auth, requireRole('super_admin','admin'), async (req, res) => {
  try {
    const { tier, file_path, file_key, dest_id, encrypted,
            target_host, target_port, target_user, target_password,
            target_db, create_db, drop_existing, db_engine = 'mariadb' } = req.body;

    const restore_id = require('crypto').randomBytes(4).toString('hex');
    restoreJobs[restore_id] = { status:'running', logs:[], error:null };

    const addLog = (level, msg) => {
      restoreJobs[restore_id].logs.push({ level, message: msg, time: new Date().toISOString() });
    };

    // Run restore async
    (async () => {
      const tmpDir  = '/tmp/bv_restore_' + restore_id;
      const tmpFile = tmpDir + '/restore.sql.gz';
      const decFile = tmpDir + '/restore.sql';
      await fsR.ensureDir(tmpDir);

      try {
        addLog('INFO', 'Restore started: ' + (file_key || file_path));
        addLog('INFO', 'Target: ' + target_host + ':' + (target_port||3306) + '/' + target_db);

        // ── STEP 1: Download/Copy file ──────────────────────────────────────
        if (tier === 'primary' || tier === 'secondary') {
          addLog('INFO', 'Copying from local NFS: ' + file_path);
          await fsR.copy(file_path, tmpFile);

        } else if (tier === 'remote') {
          const dest = await db.queryOne('SELECT * FROM backup_destinations WHERE id=?', [dest_id]);
          const cfg  = typeof dest.config === 'string' ? JSON.parse(dest.config) : dest.config;
          addLog('INFO', 'Downloading from remote: ' + cfg.host + ':' + file_path);
          execSyncR('sshpass -p "' + cfg.password + '" scp -P ' + (cfg.port||22) + ' -o StrictHostKeyChecking=no ' + (cfg.user||'root') + '@' + cfg.host + ':' + file_path + ' ' + tmpFile, { timeout: 300000 });

        } else if (tier === 's3') {
          const dest = await db.queryOne('SELECT * FROM backup_destinations WHERE id=?', [dest_id]);
          const cfg  = typeof dest.config === 'string' ? JSON.parse(dest.config) : dest.config;
          const env  = { ...process.env, AWS_ACCESS_KEY_ID: cfg.access_key, AWS_SECRET_ACCESS_KEY: cfg.secret_key, AWS_DEFAULT_REGION: cfg.region||'eu-west-2' };
          addLog('INFO', 'Downloading from S3: s3://' + cfg.bucket + '/' + file_key);
          execSyncR('aws s3 cp "s3://' + cfg.bucket + '/' + file_key + '" "' + tmpFile + '"', { env, timeout: 600000 });

        } else if (tier === 'oci') {
          const dest = await db.queryOne('SELECT * FROM backup_destinations WHERE id=?', [dest_id]);
          const cfg  = typeof dest.config === 'string' ? JSON.parse(dest.config) : dest.config;
          const env  = { ...process.env, AWS_ACCESS_KEY_ID: cfg.access_key, AWS_SECRET_ACCESS_KEY: cfg.secret_key, AWS_DEFAULT_REGION: cfg.region };
          const endpoint = 'https://' + cfg.namespace + '.compat.objectstorage.' + cfg.region + '.oraclecloud.com';
          const dlPath = tmpDir + '/restore.enc';
          addLog('INFO', 'Downloading from OCI: oci://' + cfg.bucket + '/' + file_key);
          execSyncR('aws s3 cp "s3://' + cfg.bucket + '/' + file_key + '" "' + dlPath + '" --endpoint-url "' + endpoint + '" --region "' + cfg.region + '"', { env, timeout: 600000 });

          if (encrypted || file_key.endsWith('.enc')) {
            // Auto-detect encryption format:
            // AES-256-CBC (old shell script): file starts with "Salted__"
            // AES-256-GCM (BackupVault engine + new unified script): binary IV header
            const encBuf = await fsR.readFile(dlPath);
            const isCBC  = encBuf.slice(0, 8).toString('ascii') === 'Salted__';

            if (isCBC) {
              // Legacy CBC files (uploaded before unified key migration)
              addLog('WARN', 'Detected legacy AES-256-CBC format — decrypting with openssl...');
              const PASS = process.env.BACKUP_CBC_PASSWORD || 'BV@Worktual2026#SecureBackup!AES256';
              const { execSync: execDecrypt } = require('child_process');
              execDecrypt(
                'openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000' +
                ' -pass "pass:' + PASS + '"' +
                ' -in "' + dlPath + '" -out "' + tmpFile + '"',
                { timeout: 600000 }
              );
              await fsR.remove(dlPath);
              addLog('INFO', 'CBC decryption complete');
            } else {
              // Standard GCM format — BackupVault engine + unified shell script
              addLog('INFO', 'Decrypting AES-256-GCM (unified key)...');
              const ociService = require('../services/ociService');
              await ociService.decryptFile(dlPath, tmpFile);
              await fsR.remove(dlPath);
              addLog('INFO', 'GCM decryption complete');
            }
          } else {
            await fsR.move(dlPath, tmpFile);
          }
        }

        const fileSize = (await fsR.stat(tmpFile)).size;
        addLog('INFO', 'File ready: ' + (fileSize/1024/1024).toFixed(1) + ' MB');

        // ── STEP 2: Verify gzip ─────────────────────────────────────────────
        addLog('INFO', 'Validating gzip integrity...');
        execSyncR('gzip -t "' + tmpFile + '"', { timeout: 120000 });
        addLog('INFO', 'gzip integrity: OK');

        // ── STEP 3: Create database if needed ──────────────────────────────
        // Use defaults-extra-file to pass password safely (avoids shell special char issues)
        const mysqlCfgFile = tmpDir + '/.mypass_cfg';
        if (target_password) {
          require('fs').writeFileSync(mysqlCfgFile,
            '[client]\npassword=' + target_password + '\n', { mode: 0o600 });
        }
        const MYSQL_OPTS = target_password ? '--defaults-extra-file=' + mysqlCfgFile : '';
        const MYSQL = 'mysql ' + MYSQL_OPTS + ' -h' + target_host + ' -P' + (target_port||3306) + ' -u' + target_user;
        if (create_db) {
          addLog('INFO', 'Creating database if not exists: ' + target_db);
          execSyncR(MYSQL + ' -e "CREATE DATABASE IF NOT EXISTS ' + target_db + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci"', { timeout: 30000 });
        }
        if (drop_existing) {
          addLog('WARN', 'Dropping all tables in: ' + target_db);
          execSyncR(MYSQL + ' ' + target_db + ' -e "SET FOREIGN_KEY_CHECKS=0; SET GROUP_CONCAT_MAX_LEN=32768; SET @tbls = (SELECT GROUP_CONCAT(table_name) FROM information_schema.tables WHERE table_schema = DATABASE()); SET @delSQL = IF(@tbls IS NOT NULL, CONCAT(\'DROP TABLE IF EXISTS \', @tbls), \'SELECT 1\'); PREPARE stmt FROM @delSQL; EXECUTE stmt; DEALLOCATE PREPARE stmt; SET FOREIGN_KEY_CHECKS=1;"', { timeout: 60000 });
        }

        // ── STEP 4: Restore ─────────────────────────────────────────────────

        addLog('INFO', 'Restoring database... (this may take several minutes)');
        addLog('INFO', 'Target engine: ' + db_engine.toUpperCase());

        if (db_engine === 'postgresql') {
          // ── PostgreSQL restore via pg_restore ──────────────────────────────
          addLog('INFO', 'Using pg_restore for PostgreSQL target...');
          const pgPass = tmpDir + '/.pgpass';
          if (target_password) {
            require('fs').writeFileSync(pgPass,
              target_host + ':' + (target_port||5432) + ':' + target_db + ':' + target_user + ':' + target_password + '\n',
              { mode: 0o600 }
            );
            process.env.PGPASSFILE = pgPass;
          }
          execSyncR(
            'gunzip -c "' + tmpFile + '" | psql' +
            ' -h ' + target_host +
            ' -p ' + (target_port||5432) +
            ' -U ' + target_user +
            ' -d ' + target_db +
            ' --set ON_ERROR_STOP=off',
            { timeout: 3600000, maxBuffer: 100*1024*1024, env: process.env }
          );
          try { require('fs').unlinkSync(pgPass); } catch {}

        } else if (db_engine === 'mariadb') {
          // ── MariaDB restore with MySQL 8.0 → MariaDB compatibility patches ──
          addLog('INFO', 'Applying MySQL 8.0 → MariaDB compatibility patches...');

          const patchScript = tmpDir + '/patch_dump.py';
          require('fs').writeFileSync(patchScript,
`#!/usr/bin/env python3
import sys, re
for line in sys.stdin.buffer:
    try: s = line.decode('utf-8', errors='replace')
    except:
        sys.stdout.buffer.write(line); continue
    # Collations
    s = s.replace('utf8mb4_0900_ai_ci',    'utf8mb4_general_ci')
    s = s.replace('utf8mb4_0900_bin',       'utf8mb4_bin')
    s = s.replace('utf8mb4_unicode_520_ci', 'utf8mb4_unicode_ci')
    s = s.replace('utf8_unicode_520_ci',    'utf8_unicode_ci')
    s = s.replace('utf8mb4_uca1400_ai_ci',  'utf8mb4_general_ci')
    # Remove MySQL 8.0 ENCRYPTION
    s = re.sub(r" DEFAULT ENCRYPTION='[^']*'", '', s)
    s = re.sub(r" ENCRYPTION='[^']*'", '', s)
    # Fix DELETE FROM table alias (MySQL 8.0 only)
    def fix_del(m):
        tbl,alias,rest = m.group(1),m.group(2),m.group(3)
        return 'DELETE FROM '+tbl+' '+re.sub(r'\\b'+re.escape(alias)+r'\\.(\\w+)',r'\\1',rest)
    s = re.sub(r'(?i)DELETE\\s+FROM\\s+(\\w+)\\s+([a-zA-Z_]\\w*)\\s+(WHERE\\b.*)',fix_del,s)
    # Fix UPDATE table alias
    def fix_upd(m):
        tbl,alias,rest = m.group(1),m.group(2),m.group(3)
        return 'UPDATE '+tbl+' '+re.sub(r'\\b'+re.escape(alias)+r'\\.(\\w+)',r'\\1',rest)
    s = re.sub(r'(?i)UPDATE\\s+(\\w+)\\s+([a-zA-Z_]\\w*)\\s+(SET\\b.*)',fix_upd,s)
    # Remove invisible index syntax
    s = re.sub(r'/\\*!80000 INVISIBLE \\*/', '', s)
    sys.stdout.buffer.write(s.encode('utf-8', errors='replace'))
`);
          execSyncR(
            'gunzip -c "' + tmpFile + '" | python3 "' + patchScript + '" | mysql ' + MYSQL_OPTS +
            ' --force' +
            ' --init-command="SET sql_mode=\'\'; SET FOREIGN_KEY_CHECKS=0; SET UNIQUE_CHECKS=0; SET NAMES utf8mb4;"' +
            ' -h' + target_host + ' -P' + (target_port||3306) + ' -u' + target_user + ' ' + target_db,
            { timeout: 3600000, maxBuffer: 100*1024*1024 }
          );
          try { require('fs').unlinkSync(patchScript); } catch {}

        } else {
          // ── MySQL restore (same version — full compatibility) ───────────────
          addLog('INFO', 'MySQL target — direct restore (full compatibility)...');
          execSyncR(
            'gunzip -c "' + tmpFile + '" | mysql ' + MYSQL_OPTS +
            ' --force' +
            ' --init-command="SET FOREIGN_KEY_CHECKS=0; SET UNIQUE_CHECKS=0; SET NAMES utf8mb4;"' +
            ' -h' + target_host + ' -P' + (target_port||3306) + ' -u' + target_user + ' ' + target_db,
            { timeout: 3600000, maxBuffer: 100*1024*1024 }
          );
        }

        addLog('SUCCESS', 'Database "' + target_db + '" restored successfully on ' + target_host);
        restoreJobs[restore_id].status = 'success';

      } catch(e) {
        addLog('ERROR', 'Restore failed: ' + e.message);
        restoreJobs[restore_id].status  = 'failed';
        restoreJobs[restore_id].error   = e.message;
      } finally {
        await fsR.remove(tmpDir).catch(() => {});
      }
    })();

    res.json({ restore_id, message: 'Restore started' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/restore/status/:id
router.get('/restore/status/:id', auth, async (req, res) => {
  const job = restoreJobs[req.params.id];
  if (!job) return res.status(404).json({ error: 'Restore job not found' });
  const seen = parseInt(req.query.seen || 0);
  res.json({
    status:   job.status,
    error:    job.error,
    new_logs: job.logs.slice(seen),
    total:    job.logs.length,
  });
});
