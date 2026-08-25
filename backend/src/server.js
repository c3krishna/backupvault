// backend/src/server.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express     = require('express');
const http        = require('http');
const cors        = require('cors');
const wsManager   = require('./services/wsManager');
const BackupEngine = require('./services/backupEngine');
const scheduler   = require('./services/scheduler');
const apiRoutes   = require('./routes/api');
const fsRoutes    = require('./routes/fs');
const authRoutes  = require('./routes/auth');
const infraRoutes = require('./routes/infrastructure');
const sftpRoutes  = require('./routes/sftp');
const secondaryFs = require('./routes/secondaryfs');
const nfsRoutes        = require('./routes/nfs');
const monitoringRoutes = require('./routes/monitoring');

console.log('[BackupVault] DB:', process.env.DB_USER, '@', process.env.DB_HOST, '/', process.env.DB_NAME);

const app    = express();
const server = http.createServer(app);

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

wsManager.attach(server);

const engine = new BackupEngine(wsManager);
scheduler.setEngine(engine);

app.use('/api', apiRoutes(engine));
app.use('/api', fsRoutes);
app.use('/api', authRoutes);
app.use('/api', infraRoutes);
app.use('/api/sftp', sftpRoutes);
app.use('/api', secondaryFs);
app.use('/api', nfsRoutes);
app.use('/api', monitoringRoutes);

// ── Query Execution + Reports ───────────────────────────────────────────────
// Isolated: a fault here must never stop backup scheduling.
try {
  app.use('/api/query',   require('./routes/queryRoutes'));
  app.use('/api/reports', require('./routes/reportRoutes'));
  console.log('[BackupVault] Query/Reports mounted');
} catch (err) {
  console.error('[BackupVault] Query/Reports DISABLED:', err.message);
}





app.get('/health', (req, res) => res.json({
  status: 'ok', time: new Date(),
  db_user: process.env.DB_USER, version: '1.0.0',
  uptime: Math.floor(process.uptime())
}));

const PORT = process.env.PORT || 4100;
server.listen(PORT, async () => {
  console.log(`[BackupVault] Running on :${PORT}`);
  try { await scheduler.loadAndSchedule(); }
  catch (err) { console.warn('[Scheduler] Could not load jobs:', err.message); }
});
