// /var/www/backupvault/backend/src/routes/sftp.js
// FIXED: newest files first, starts at configured remote path

const express   = require('express');
const router    = express.Router();
const { execSync } = require('child_process');
const path      = require('path');
const fs        = require('fs');
const jwt       = require('jsonwebtoken');
const db        = require('../db/connection');

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  if (!token) return res.status(401).json({ error:'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET || 'super_secure_backupvault_token_key'); next(); }
  catch { res.status(401).json({ error:'Invalid token' }); }
}

async function getConfig(destId) {
  const dest = await db.queryOne("SELECT * FROM backup_destinations WHERE id=? AND dest_type='remote_sftp'", [destId]);
  if (!dest) throw new Error('Remote destination not found');
  const config = typeof dest.config==='string' ? JSON.parse(dest.config) : dest.config;
  if (!config.host) throw new Error('Host not configured');
  return { dest, config };
}

function ssh(config) {
  const { host, port=22, user='root', password='' } = config;
  const safePass = password.replace(/'/g, "'\\''");
  return `sshpass -p '${safePass}' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=12 -o BatchMode=no -p ${port} ${user}@${host}`;
}

function errCode(msg) {
  if (msg.includes('sshpass') && msg.includes('not found')) return 'SSHPASS_MISSING';
  if (msg.includes('Permission denied') || msg.includes('Authentication')) return 'AUTH_FAILED';
  if (msg.includes('No route') || msg.includes('Connection refused') || msg.includes('timed out')) return 'UNREACHABLE';
  return 'SSH_ERROR';
}

// GET /api/sftp/:destId/list?path=/remote/path
router.get('/:destId/list', auth, async (req, res) => {
  try {
    const { config } = await getConfig(req.params.destId);
    if (!config.password) return res.status(400).json({ error:'SSH password not set. Edit in Destinations.', code:'NO_PASSWORD' });

    // Default to configured path not /
    const remotePath = (req.query.path || config.path || '/backups/remote').replace(/\/+$/,'') || '/';
    const sshCmd     = ssh(config);

    let out;
    try {
      // -lt = sort newest first
      out = execSync(`${sshCmd} "ls -lt --time-style='+%Y-%m-%d %H:%M' '${remotePath}' 2>&1"`,
        { timeout:20000, maxBuffer:20*1024*1024 }).toString();
    } catch(e) {
      const msg = ((e.stdout||'')+(e.stderr||'')+e.message).toString();
      if (msg.includes('No such file') || msg.includes('cannot access'))
        return res.json({ path:remotePath, items:[], diskStats:null, host:config.host, total:0,
          warning:`Path '${remotePath}' does not exist on remote server yet` });
      const code = errCode(msg);
      return res.status(code==='AUTH_FAILED'?401:503).json({ error:msg.split('\n')[0].substring(0,300), code });
    }

    const items = [];
    for (const line of out.split('\n')) {
      if (!line || line.startsWith('total') || line.startsWith('ls:')) continue;
      const m = line.match(/^([dlrwx\-]+)\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(.+)$/);
      if (!m) continue;
      const [, perms, size, date, time, rawName] = m;
      const name = rawName.includes(' -> ') ? rawName.split(' -> ')[0].trim() : rawName.trim();
      if (name==='.'||name==='..') continue;
      const isDir  = perms.startsWith('d');
      const ext    = path.extname(name).toLowerCase();
      const ts     = new Date(`${date}T${time}:00`).getTime();
      items.push({
        name, type: isDir?'directory':'file',
        size: parseInt(size)||0,
        modified: `${date} ${time}`,
        modifiedTs: ts,
        path: `${remotePath}/${name}`.replace('//','/'),
        is_backup: ['.gz','.sql','.rdb','.dump','.bak','.zip'].includes(ext),
        ext: ext||(isDir?'dir':''),
      });
    }

    // Dirs first (newest date dirs first), then files (newest first)
    items.sort((a,b) => {
      if (a.type!==b.type) return a.type==='directory'?-1:1;
      return (b.modifiedTs||0)-(a.modifiedTs||0);
    });

    let diskStats = null;
    try {
      const df = execSync(`${sshCmd} "df -h '${remotePath}' 2>/dev/null"`, {timeout:8000}).toString().split('\n');
      if (df[1]) { const p=df[1].replace(/\s+/g,' ').split(' '); diskStats={size:p[1],used:p[2],avail:p[3],usePercent:p[4]}; }
    } catch {}

    res.json({ path:remotePath, items, diskStats, host:config.host, total:items.length });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// GET /api/sftp/:destId/download?path=/path/file&token=JWT
router.get('/:destId/download', auth, async (req, res) => {
  try {
    const { config } = await getConfig(req.params.destId);
    const { host, port=22, user='root', password='' } = config;
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error:'path required' });
    const filename = path.basename(filePath);
    const tmpFile  = `/tmp/bv_dl_${Date.now()}_${filename}`;
    const safePass = password.replace(/'/g,"'\\''");
    execSync(`rsync -az -e "sshpass -p '${safePass}' ssh -p ${port} -o StrictHostKeyChecking=no" ${user}@${host}:'${filePath}' '${tmpFile}'`, {timeout:300000});
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type','application/octet-stream');
    const stream = fs.createReadStream(tmpFile);
    stream.pipe(res);
    stream.on('close', ()=>{ try{fs.unlinkSync(tmpFile);}catch{} });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

module.exports = router;
