// backend/src/routes/monitoring.js
// Physical server monitoring — grouped by host:port, deep MySQL/PostgreSQL metrics
// SAFE: all reads only — /proc/*, SHOW STATUS, SHOW SLAVE STATUS — no writes, no locks

const express      = require('express');
const router       = express.Router();
const { execSync } = require('child_process');
const db           = require('../db/connection');
const jwt          = require('jsonwebtoken');
const JWT_SECRET   = process.env.JWT_SECRET || 'super_secure_backupvault_token_key';

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

function ssh(host, port, user) {
  return `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 -o BatchMode=yes ` +
         `-o PasswordAuthentication=no -p ${port||22} ${user||'root'}@${host}`;
}

function run(cmd, timeout=10000) {
  try { return execSync(cmd, { timeout, maxBuffer:4*1024*1024 }).toString().trim(); }
  catch { return null; }
}

// ── SSH SYSTEM METRICS (safe: /proc read-only) ────────────────────────────────
function collectSSH(host, sshPort, sshUser) {
  const s = ssh(host, sshPort, sshUser);
  const snap = {};

  // CPU — two /proc/stat samples 600ms apart
  const c1 = run(`${s} "cat /proc/stat && sleep 0.6 && cat /proc/stat" 2>/dev/null`, 12000);
  if (c1) {
    const lines = c1.split('\n').filter(l => l.startsWith('cpu '));
    if (lines.length >= 2) {
      const p1 = lines[0].replace(/^cpu\s+/,'').split(' ').map(Number);
      const p2 = lines[1].replace(/^cpu\s+/,'').split(' ').map(Number);
      const t1=p1.reduce((a,b)=>a+b,0), t2=p2.reduce((a,b)=>a+b,0);
      const i1=p1[3]+(p1[4]||0), i2=p2[3]+(p2[4]||0);
      snap.cpu_pct = t2>t1 ? Math.round((1-(i2-i1)/(t2-t1))*10000)/100 : 0;
    }
  }

  // Load average
  const load = run(`${s} "cat /proc/loadavg" 2>/dev/null`);
  if (load) {
    const p = load.split(' ');
    snap.load_avg_1  = parseFloat(p[0]);
    snap.load_avg_5  = parseFloat(p[1]);
    snap.load_avg_15 = parseFloat(p[2]);
  }

  // Memory
  const mem = run(`${s} "cat /proc/meminfo" 2>/dev/null`);
  if (mem) {
    const v = k => parseInt((mem.match(new RegExp(k+':\\s+(\\d+)'))||[])[1]||0);
    const total=v('MemTotal'), free=v('MemFree'), buf=v('Buffers'), cach=v('\\bCached');
    const used = total - free - buf - cach;
    snap.mem_total_mb = Math.round(total/1024);
    snap.mem_used_mb  = Math.round(used/1024);
    snap.mem_pct      = total>0 ? Math.round(used/total*10000)/100 : 0;
  }

  // Disk (data dir)
  for (const dir of ['/var/lib/mysql','/var/lib/postgresql','/var/lib/pgsql','/data','/']) {
    const df = run(`${s} "df -h ${dir} 2>/dev/null | tail -1" 2>/dev/null`);
    if (df && df.includes('%')) {
      const p=df.replace(/\s+/g,' ').split(' ');
      snap.disk_total=p[1]; snap.disk_used=p[2]; snap.disk_avail=p[3];
      snap.disk_pct=parseInt(p[4])||0; break;
    }
  }

  // Top processes (ps aux — safe read-only)
  const ps = run(`${s} "ps aux --sort=-%cpu --no-headers | head -10" 2>/dev/null`);
  if (ps) {
    snap.process_list = ps.split('\n').filter(Boolean).map(l => {
      const p=l.replace(/\s+/g,' ').split(' ');
      return { user:p[0], pid:p[1], cpu:parseFloat(p[2]), mem:parseFloat(p[3]),
               command:(p.slice(10)||[]).join(' ').substring(0,80) };
    });
  }
  return snap;
}

// ── MYSQL METRICS (SHOW commands — read-only, safe on slave) ─────────────────
function collectMySQL(host, port, user, password) {
  const pw   = password ? `-p'${(password+'').replace(/'/g,"'\\''")}'` : '';
  const base = `mysql -h${host} -P${port||3306} -u${user||'root'} ${pw} --connect-timeout=5 --batch --skip-column-names -e`;
  const snap = {};

  // All key status vars in ONE query (efficient)
  // SHOW GLOBAL STATUS works with any MySQL user (no special privilege needed)
  const statusOut = run(`${base} "SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected','Threads_running','Threads_cached','Questions','Slow_queries','Uptime','Innodb_buffer_pool_reads','Innodb_buffer_pool_read_requests','Com_select','Com_insert','Com_update','Com_delete','Bytes_sent','Bytes_received','Connections','Aborted_connects','Table_locks_waited')" 2>/dev/null`);
  if (statusOut) {
    const m={};
    statusOut.split('\n').forEach(l => { const [k,v]=l.split('\t'); if(k) m[k]=v; });
    const g=k=>parseInt(m[k]||0);
    snap.threads_connected = g('Threads_connected');
    snap.threads_running   = g('Threads_running');
    snap.threads_cached    = g('Threads_cached');
    snap.questions_total   = g('Questions');
    snap.slow_queries      = g('Slow_queries');
    snap.uptime_sec        = g('Uptime');
    snap.table_locks_waited= g('Table_locks_waited');
    snap.aborted_connects  = g('Aborted_connects');
    snap.bytes_sent        = g('Bytes_sent');
    snap.bytes_received    = g('Bytes_received');
    snap.dml_select        = g('Com_select');
    snap.dml_insert        = g('Com_insert');
    snap.dml_update        = g('Com_update');
    snap.dml_delete        = g('Com_delete');
    const bpR=g('Innodb_buffer_pool_reads'), bpReq=g('Innodb_buffer_pool_read_requests');
    snap.innodb_bp_reads   = bpR;
    snap.innodb_bp_hit_pct = bpReq>0 ? Math.round((1-bpR/bpReq)*10000)/100 : 100;
    snap.qps = snap.uptime_sec>0 ? Math.round(snap.questions_total/snap.uptime_sec*100)/100 : 0;
  }

  // Replication status — SAFE on slave, shows health
  const slave = run(`${base} "SHOW SLAVE STATUS\\G" 2>/dev/null`);
  // Handle both old (Slave_IO_Running) and new MySQL 8+ (Replica_IO_Running) naming
  const isReplica = slave && (slave.includes('Slave_IO_Running') || slave.includes('Replica_IO_Running'));
  if (isReplica) {
    const sv = k => {
      // Try both MySQL < 8.0.22 and >= 8.0.22 field names
      const patterns = [k, k.replace('Slave_','Replica_').replace('Master_','Source_')];
      for (const p of patterns) {
        const m = (slave.match(new RegExp(p+':\\s*(.+)'))||[])[1]?.trim();
        if (m !== undefined) return m;
      }
      return undefined;
    };
    const ioOk  = sv('Slave_IO_Running')||sv('Replica_IO_Running');
    const sqlOk = sv('Slave_SQL_Running')||sv('Replica_SQL_Running');
    snap.slave_running     = ioOk==='Yes' && sqlOk==='Yes' ? 1 : 0;
    snap.slave_io_running  = ioOk;
    snap.slave_sql_running = sqlOk;
    snap.slave_lag_sec     = parseInt(sv('Seconds_Behind_Master')||sv('Seconds_Behind_Source'))||0;
    snap.master_host       = sv('Master_Host')||sv('Source_Host');
    snap.slave_error       = sv('Last_Error')||sv('Last_Errno')||null;
  }

  // Active queries (INFORMATION_SCHEMA.PROCESSLIST — read-only)
  const proc = run(`${base} "SELECT ID,USER,HOST,DB,COMMAND,TIME,STATE,LEFT(INFO,100) FROM information_schema.PROCESSLIST WHERE COMMAND<>'Sleep' ORDER BY TIME DESC LIMIT 20" 2>/dev/null`);
  if (proc) {
    snap.mysql_processes = proc.split('\n').filter(Boolean).map(l => {
      const p=l.split('\t');
      return { id:p[0], user:p[1], host:p[2], db:p[3], command:p[4],
               time:parseInt(p[5]||0), state:p[6], info:p[7] };
    });
  }

  // DB sizes for all databases on this MySQL instance
  const sizes = run(`${base} "SELECT table_schema,ROUND(SUM(data_length+index_length)/1024/1024,1) FROM information_schema.tables GROUP BY table_schema ORDER BY 2 DESC" 2>/dev/null`);
  if (sizes) {
    snap.db_sizes = sizes.split('\n').filter(Boolean).map(l => {
      const [name,mb]=l.split('\t');
      return { name, size_mb:parseFloat(mb)||0 };
    }).filter(d=>!['information_schema','performance_schema','mysql','sys'].includes(d.name));
  }

  return snap;
}

// ── POSTGRESQL METRICS (read-only queries) ────────────────────────────────────
function collectPostgreSQL(host, port, user, password, dbname) {
  const pw   = password ? `PGPASSWORD='${(password+'').replace(/'/g,"'\\''")}'` : '';
  const base = `${pw} psql -h${host} -p${port||5432} -U${user} -d${dbname||'postgres'} -t -A -c`;
  const snap = {};

  // Connections by state
  const conn = run(`${base} "SELECT state,count(*) FROM pg_stat_activity GROUP BY state" 2>/dev/null`);
  if (conn) {
    let total=0,active=0,idle=0;
    conn.split('\n').filter(Boolean).forEach(l=>{
      const p=l.split('|'); const n=parseInt(p[1])||0;
      total+=n; if(p[0]==='active') active=n; if(p[0]==='idle') idle=n;
    });
    snap.pg_connections=total; snap.pg_active_queries=active; snap.pg_idle_conns=idle;
  }

  // Cache hit ratio
  const cache = run(`${base} "SELECT ROUND(blks_hit::numeric/(nullif(blks_hit+blks_read,0))*100,2) FROM pg_stat_database WHERE datname='${dbname}'" 2>/dev/null`);
  if (cache) snap.pg_cache_hit_pct = parseFloat(cache)||null;

  // Is replica + lag in seconds
  const rep = run(`${base} "SELECT pg_is_in_recovery(),CASE WHEN pg_is_in_recovery() THEN COALESCE(EXTRACT(EPOCH FROM (now()-pg_last_xact_replay_timestamp()))::int,0) ELSE NULL END" 2>/dev/null`);
  if (rep) {
    const p=rep.split('|');
    snap.pg_is_replica  = p[0]==='t';
    snap.pg_replica_lag = p[1]!=='' ? parseInt(p[1]) : null;
  }

  // Active long-running queries
  const procs = run(`${base} "SELECT pid,usename,EXTRACT(EPOCH FROM(now()-query_start))::int AS sec,state,LEFT(query,100) FROM pg_stat_activity WHERE state<>'idle' AND query_start IS NOT NULL ORDER BY sec DESC LIMIT 10" 2>/dev/null`);
  if (procs) {
    snap.pg_processes = procs.split('\n').filter(Boolean).map(l=>{
      const p=l.split('|'); return { pid:p[0],user:p[1],time:parseInt(p[2]),state:p[3],query:p[4] };
    });
  }

  // DB sizes
  const sizes = run(`${base} "SELECT datname,ROUND(pg_database_size(datname)/1024.0/1024.0,1) FROM pg_database WHERE datname NOT IN('template0','template1') ORDER BY 2 DESC" 2>/dev/null`);
  if (sizes) {
    snap.db_sizes = sizes.split('\n').filter(Boolean).map(l=>{
      const p=l.split('|'); return { name:p[0], size_mb:parseFloat(p[1])||0 };
    });
  }

  return snap;
}

// ── COLLECT ALL METRICS FOR ONE PHYSICAL SERVER ───────────────────────────────
async function collectServer(server) {
  const snap = { server_id:server.id, status:'ok' };

  // SSH system metrics (zero DB impact)
  if (server.ssh_user) {
    try { Object.assign(snap, collectSSH(server.host, server.ssh_port||22, server.ssh_user)); }
    catch(e) { snap.ssh_error=e.message; }
  }

  // DB-specific deep metrics
  try {
    if (server.db_type==='mysql') {
      // If db_servers has no credentials, fall back to first matching backup_target credentials
      let dbUser = server.db_user, dbPass = server.db_password;
      if (!dbUser) {
        const t = await db.queryOne(
          'SELECT username,password FROM backup_targets WHERE host=? AND port=? AND is_active=1 LIMIT 1',
          [server.host, server.port]
        );
        if (t) { dbUser = t.username; dbPass = t.password; }
      }
      Object.assign(snap, collectMySQL(server.host, server.port, dbUser, dbPass));
    } else if (server.db_type==='postgresql') {
      const t = await db.queryOne(
        'SELECT database_name,username,password FROM backup_targets WHERE host=? AND port=? AND is_active=1 LIMIT 1',
        [server.host, server.port]
      );
      if (t) Object.assign(snap, collectPostgreSQL(server.host, server.port,
        server.db_user||t.username, server.db_password||t.password, t.database_name));
    }
  } catch(e) { snap.status='error'; snap.error_msg=e.message; }

  // Determine health status
  if (!snap.cpu_pct && !snap.threads_connected && !snap.pg_connections) {
    snap.status = 'offline';
  } else if (
    snap.cpu_pct>85 || snap.mem_pct>90 || snap.disk_pct>85 ||
    snap.slave_running===0 || (snap.slave_lag_sec!=null && snap.slave_lag_sec>30)
  ) {
    snap.status = 'warn';
  } else if (
    snap.cpu_pct>95 || snap.disk_pct>95 ||
    (snap.slave_lag_sec!=null && snap.slave_lag_sec>300)
  ) {
    snap.status = 'critical';
  }

  return snap;
}

async function saveSnapshot(snap) {
  const [r] = await db.pool.execute(
    `INSERT INTO db_server_snapshots
     (server_id,cpu_pct,load_avg_1,load_avg_5,load_avg_15,mem_total_mb,mem_used_mb,mem_pct,
      disk_pct,disk_used,disk_total,threads_connected,threads_running,threads_cached,
      questions_total,slow_queries,innodb_bp_reads,innodb_bp_hit_pct,qps,uptime_sec,
      slave_running,slave_lag_sec,slave_io_running,slave_sql_running,master_host,
      pg_connections,pg_active_queries,pg_cache_hit_pct,process_list,status,error_msg)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [snap.server_id,
     snap.cpu_pct||null,snap.load_avg_1||null,snap.load_avg_5||null,snap.load_avg_15||null,
     snap.mem_total_mb||null,snap.mem_used_mb||null,snap.mem_pct||null,
     snap.disk_pct||null,snap.disk_used||null,snap.disk_total||null,
     snap.threads_connected!=null?snap.threads_connected:null,
     snap.threads_running!=null?snap.threads_running:null,
     snap.threads_cached||null,snap.questions_total||null,snap.slow_queries||null,
     snap.innodb_bp_reads||null,snap.innodb_bp_hit_pct||null,snap.qps||null,snap.uptime_sec||null,
     snap.slave_running!=null?snap.slave_running:null,
     snap.slave_lag_sec!=null?snap.slave_lag_sec:null,
     snap.slave_io_running||null,snap.slave_sql_running||null,snap.master_host||null,
     snap.pg_connections!=null?snap.pg_connections:null,
     snap.pg_active_queries!=null?snap.pg_active_queries:null,
     snap.pg_cache_hit_pct||null,
     snap.process_list?JSON.stringify(snap.process_list):null,
     snap.status,snap.error_msg||null]
  );
  await db.query('UPDATE db_servers SET last_check=NOW(),last_status=?,last_error=? WHERE id=?',
    [snap.status,snap.error_msg||null,snap.server_id]);
  return r.insertId;
}

// ── ROUTES ────────────────────────────────────────────────────────────────────

router.get('/monitoring/servers/grouped', auth, async (req,res) => {
  try {
    const rows = await db.query(`
      SELECT s.id,s.name,s.host,s.port,s.db_type,s.environment,
        s.vip_host,s.ha_role,s.ha_group,s.ssh_user,s.monitoring_enabled,s.last_status,
        CAST(n.cpu_pct         AS FLOAT)  cpu_pct,
        CAST(n.mem_pct         AS FLOAT)  mem_pct,
        CAST(n.disk_pct        AS SIGNED) disk_pct,
        CAST(n.load_avg_1      AS FLOAT)  load_avg_1,
        CAST(n.load_avg_5      AS FLOAT)  load_avg_5,
        CAST(n.load_avg_15     AS FLOAT)  load_avg_15,
        CAST(n.threads_connected AS SIGNED) threads_connected,
        CAST(n.threads_running   AS SIGNED) threads_running,
        CAST(n.threads_cached    AS SIGNED) threads_cached,
        CAST(n.slow_queries      AS SIGNED) slow_queries,
        CAST(n.innodb_bp_hit_pct AS FLOAT)  innodb_bp_hit_pct,
        CAST(n.qps               AS FLOAT)  qps,
        CAST(n.slave_running     AS SIGNED) slave_running,
        CAST(n.slave_lag_sec     AS SIGNED) slave_lag_sec,
        n.slave_io_running,n.slave_sql_running,n.master_host,
        CAST(n.pg_connections    AS SIGNED) pg_connections,
        CAST(n.pg_active_queries AS SIGNED) pg_active_queries,
        CAST(n.pg_cache_hit_pct  AS FLOAT)  pg_cache_hit_pct,
        n.disk_used,n.disk_total,n.snapshot_at,n.process_list,n.error_msg
      FROM db_servers s
      LEFT JOIN db_server_snapshots n ON n.server_id=s.id
        AND n.snapshot_at=(SELECT MAX(snapshot_at) FROM db_server_snapshots WHERE server_id=s.id)
      WHERE s.is_active=1
      ORDER BY FIELD(s.environment,'live','pre_production','qa','development','other'),s.db_type,s.host`);

    const groups={};
    for (const r of rows) {
      const dbs = await db.query(
        'SELECT id,name,database_name FROM backup_targets WHERE host=? AND port=? AND is_active=1 ORDER BY name',
        [r.host,r.port]
      );
      r.databases    = dbs;
      r.process_list = r.process_list
        ? (typeof r.process_list==='string'?JSON.parse(r.process_list):r.process_list) : [];
      const env = r.environment||'other';
      if (!groups[env]) groups[env]=[];
      groups[env].push(r);
    }
    res.json(groups);
  } catch(e) { res.status(500).json({ error:e.message }); }
});

router.get('/monitoring/servers/:id/history', auth, async (req,res) => {
  try {
    const mins=parseInt(req.query.minutes)||60;
    const rows = await db.query(
      `SELECT snapshot_at,
        CAST(cpu_pct AS FLOAT) cpu_pct,CAST(mem_pct AS FLOAT) mem_pct,
        CAST(disk_pct AS SIGNED) disk_pct,
        CAST(threads_connected AS SIGNED) threads_connected,
        CAST(threads_running AS SIGNED) threads_running,
        CAST(COALESCE(threads_connected, pg_connections) AS SIGNED) connections,
        CAST(pg_connections AS SIGNED) pg_connections,
        CAST(pg_active_queries AS SIGNED) pg_active_queries,
        CAST(qps AS FLOAT) qps,
        CAST(slave_lag_sec AS SIGNED) slave_lag_sec,
        CAST(innodb_bp_hit_pct AS FLOAT) innodb_bp_hit_pct
       FROM db_server_snapshots
       WHERE server_id=? AND snapshot_at>=DATE_SUB(NOW(),INTERVAL ? MINUTE)
       ORDER BY snapshot_at ASC`,
      [req.params.id,mins]);
    res.json(rows);
  } catch(e) { res.status(500).json({ error:e.message }); }
});

router.post('/monitoring/servers/:id/collect', auth, async (req,res) => {
  try {
    const server = await db.queryOne('SELECT * FROM db_servers WHERE id=? AND is_active=1',[req.params.id]);
    if (!server) return res.status(404).json({ error:'Server not found' });
    const snap = await collectServer(server);
    await saveSnapshot(snap);
    res.json(snap);
  } catch(e) { res.status(500).json({ error:e.message }); }
});

router.post('/monitoring/servers/collect-all', auth, async (req,res) => {
  try {
    const servers = await db.query('SELECT * FROM db_servers WHERE is_active=1 AND monitoring_enabled=1');
    const results=[];
    for (const s of servers) {
      const snap=await collectServer(s);
      await saveSnapshot(snap);
      results.push({ id:s.id,name:s.name,host:s.host,status:snap.status,
        cpu:snap.cpu_pct,mem:snap.mem_pct,lag:snap.slave_lag_sec });
    }
    res.json({ collected:results.length,results });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

router.get('/monitoring/servers/crud', auth, async (req,res) => {
  try { res.json(await db.query('SELECT * FROM db_servers WHERE is_active=1 ORDER BY environment,db_type,host')); }
  catch(e) { res.status(500).json({ error:e.message }); }
});

router.post('/monitoring/servers', auth, async (req,res) => {
  try {
    const{name,host,port,db_type,environment,vip_host,ha_role,ha_group,ssh_user,ssh_port,db_user,db_password,description}=req.body;
    const[r]=await db.pool.execute(
      'INSERT INTO db_servers(name,host,port,db_type,environment,vip_host,ha_role,ha_group,ssh_user,ssh_port,db_user,db_password,description)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [name,host,port||3306,db_type||'mysql',environment||'live',vip_host||null,ha_role||'slave',ha_group||null,ssh_user||'root',ssh_port||22,db_user||null,db_password||null,description||null]
    );
    res.status(201).json({ id:r.insertId });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

router.put('/monitoring/servers/:id', auth, async (req,res) => {
  try {
    const{name,host,port,db_type,environment,vip_host,ha_role,ha_group,ssh_user,ssh_port,db_user,db_password,description,monitoring_enabled}=req.body;
    await db.query(
      'UPDATE db_servers SET name=?,host=?,port=?,db_type=?,environment=?,vip_host=?,ha_role=?,ha_group=?,ssh_user=?,ssh_port=?,db_user=?,db_password=?,description=?,monitoring_enabled=? WHERE id=?',
      [name,host,port,db_type,environment,vip_host||null,ha_role,ha_group||null,ssh_user,ssh_port||22,db_user,db_password,description,monitoring_enabled?1:0,req.params.id]
    );
    res.json({ message:'Updated' });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

router.delete('/monitoring/servers/:id', auth, async (req,res) => {
  try {
    await db.query('UPDATE db_servers SET is_active=0 WHERE id=?',[req.params.id]);
    res.json({ message:'Removed' });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// NFS history for wave graph
router.get('/monitoring/nfs/:id/history', auth, async (req,res) => {
  try {
    const mins=parseInt(req.query.minutes)||60;
    const rows=await db.query(
      'SELECT snapshot_at,CAST(disk_pct AS SIGNED) disk_pct,CAST(inode_pct AS SIGNED) inode_pct,status FROM nfs_monitoring_snapshots WHERE server_id=? AND snapshot_at>=DATE_SUB(NOW(),INTERVAL ? MINUTE) ORDER BY snapshot_at ASC',
      [req.params.id,mins]);
    res.json(rows);
  } catch(e) { res.status(500).json({ error:e.message }); }
});

module.exports = router;
