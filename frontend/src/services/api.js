// src/services/api.js
const BASE = '/api';
const tok = () => localStorage.getItem('bv_token');

async function r(method, path, body) {
  const h = { 'Content-Type': 'application/json' };
  if (tok()) h['Authorization'] = `Bearer ${tok()}`;
  const res = await fetch(`${BASE}${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) { localStorage.clear(); window.location.href = '/login'; return; }
  const d = await res.json();
  if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
  return d;
}

export const authAPI = {
  login:    (email, password)         => r('POST', '/auth/login',  { email, password }),
  register: (name, email, password)   => r('POST', '/auth/register', { name, email, password }),
  forgot:   (email)                   => r('POST', '/auth/forgot-password', { email }),
  reset:    (email, otp, newPassword) => r('POST', '/auth/reset-password-with-otp', { email, otp, newPassword }),
};

export const dashboardAPI = {
  stats:      ()          => r('GET', '/dashboard/stats'),
  calendar:   (days = 35) => r('GET', `/dashboard/calendar?days=${days}`),
  recentRuns: ()          => r('GET', '/dashboard/recent-runs'),
};

export const targetsAPI = {
  list:   ()         => r('GET',    '/targets'),
  create: (d)        => r('POST',   '/targets', d),
  update: (id, d)    => r('PUT',    `/targets/${id}`, d),
  remove: (id)       => r('DELETE', `/targets/${id}`),
  test:   (id)       => r('POST',   `/targets/${id}/test`),
};

export const jobsAPI = {
  list:   ()         => r('GET',    '/jobs'),
  create: (d)        => r('POST',   '/jobs', d),
  update: (id, d)    => r('PUT',    `/jobs/${id}`, d),
  remove: (id)       => r('DELETE', `/jobs/${id}`),
  toggle: (id)       => r('POST',   `/jobs/${id}/toggle`),
};

export const backupAPI = {
  trigger:    (target_id, job_id, backup_type) => r('POST', '/backup/trigger',     { target_id, job_id, backup_type }),
  triggerAll: (backup_type = 'full')            => r('POST', '/backup/trigger-all', { backup_type }),
};

export const runsAPI = {
  list: (f = {}) => { const q = new URLSearchParams(f).toString(); return r('GET', `/runs${q ? '?' + q : ''}`); },
  get:  (id)     => r('GET', `/runs/${id}`),
  logs: (id)     => r('GET', `/runs/${id}/logs`),
};

export const destinationsAPI = {
  list:   ()         => r('GET',    '/destinations'),
  create: (d)        => r('POST',   '/destinations', d),
  update: (id, d)    => r('PUT',    `/destinations/${id}`, d),
  remove: (id)       => r('DELETE', `/destinations/${id}`),
};

export const storageAPI = {
  stats:        () => r('GET', '/storage/stats'),
  primaryMount: () => r('GET', '/fs/primary-mount'),
};

export const infraAPI = {
  health:      ()       => r('GET',  '/infra/health'),
  monitor:     ()       => r('GET',  '/storage/monitor'),
  directories: (mount)  => r('GET',  `/storage/directories${mount ? '?mount=' + mount : ''}`),
  testAlert:   ()       => r('POST', '/storage/test-alert', {}),
  testS3:      (d)      => r('POST', '/destinations/s3/test', d),
  saveS3:      (d)      => r('POST', '/destinations/s3/save', d),
  testRemote:  (d)      => r('POST', '/destinations/remote/test', d),
  saveRemote:  (d)      => r('POST', '/destinations/remote/save', d),
  s3Status:    ()       => r('GET',  '/destinations/s3/status'),
  remoteStatus:()       => r('GET',  '/destinations/remote/status'),
};

export const sftpAPI = {
  list:     (destId, path = '/')         => r('GET',  `/sftp/${destId}/list?path=${encodeURIComponent(path)}`),
  download: (destId, filePath)           => `${BASE}/sftp/${destId}/download?path=${encodeURIComponent(filePath)}&token=${tok()}`,
  stat:     (destId, filePath)           => r('GET',  `/sftp/${destId}/stat?path=${encodeURIComponent(filePath)}`),
};

export const usersAPI = {
  list:           ()              => r('GET',    '/users'),
  create:         (d)             => r('POST',   '/users', d),
  update:         (id, d)         => r('PUT',    `/users/${id}`, d),
  remove:         (id)            => r('DELETE', `/users/${id}`),
  changePassword: (id, d)         => r('PUT',    `/users/${id}/password`, d),
};

export const twoFAAPI = {
  setup:   ()        => r('POST', '/auth/2fa/setup'),
  verify:  (code)    => r('POST', '/auth/2fa/verify',  { code }),
  disable: (password)=> r('POST', '/auth/2fa/disable', { password }),
  status:  ()        => r('GET',  '/auth/2fa/status'),
};

export const settingsAPI = { get: () => r('GET', '/settings') };

export const preferencesAPI = {
  // Load all preferences from DB
  getAll: () => r('GET', '/preferences'),
  // Update one or many preferences in DB: { theme: 'light', sidebar_collapsed: 'true' }
  update: (updates) => r('PUT', '/preferences', updates),
  // Get single preference value
  get: (key) => r('GET', `/preferences/${key}`),
};

export const s3BrowserAPI = {
  destinations:  ()                => r('GET', '/s3/destinations'),
  list:          (destId, prefix)  => r('GET', `/s3/${destId}/list?prefix=${encodeURIComponent(prefix||'')}`),
  presign:       (destId, key)     => r('GET', `/s3/${destId}/presign?key=${encodeURIComponent(key)}`),
  folderStats:   (destId, prefix)  => r('GET', `/s3/${destId}/folder-stats?prefix=${encodeURIComponent(prefix||'')}`),
};

export const nfsAPI = {
  list:     ()   => r('GET',    '/nfs'),
  create:   (d)  => r('POST',   '/nfs', d),
  update:   (id,d) => r('PUT',  `/nfs/${id}`, d),
  remove:   (id) => r('DELETE', `/nfs/${id}`),
  check:    (id) => r('GET',    `/nfs/${id}/check`),
  checkAll: ()   => r('GET',    '/nfs/check-all'),
};

export const incrementalAPI = {
  jobs:   ()            => r('GET',  '/incremental/jobs'),
  log:    (id, tail=200)=> r('GET',  `/incremental/jobs/${id}/log?tail=${tail}`),
  run:    (id)          => r('POST', `/incremental/jobs/${id}/run`),
  runAll: ()            => r('POST', '/incremental/jobs/run-all'),
};

// Coerce MySQL decimal/int strings to JS numbers
function numFields(obj) {
  const NUM = ['cpu_pct','mem_pct','disk_pct','load_avg_1','load_avg_5','load_avg_15',
    'connections','queries_ps','slow_queries','db_size_mb','uptime_sec',
    'mem_total_mb','mem_used_mb','inode_pct','disk_pct',
    'threads_connected','threads_running','threads_cached','qps',
    'slave_lag_sec','innodb_bp_hit_pct','pg_connections','pg_active_queries','pg_cache_hit_pct'];
  const out = { ...obj };
  NUM.forEach(k => { if (out[k] != null) out[k] = parseFloat(out[k]); });
  return out;
}

export const monitoringAPI = {
  // Physical server grouped (unique host:port with all DBs listed)
  serversGrouped:  async ()   => {
    const g = await r('GET','/monitoring/servers/grouped');
    const out={};
    for (const [env,list] of Object.entries(g||{}))
      out[env] = list.map(numFields);
    return out;
  },
  serverHistory:   async (id,mins) => {
    const rows = await r('GET', `/monitoring/servers/${id}/history?minutes=${mins||180}`);
    return (rows||[]).map(numFields);
  },
  serverCollect:   async (id) => numFields(await r('POST', `/monitoring/servers/${id}/collect`)),
  serverCollectAll:()         => r('POST', '/monitoring/servers/collect-all'),
  serversList:     ()         => r('GET',  '/monitoring/servers/crud'),
  serverAdd:       (d)        => r('POST', '/monitoring/servers', d),
  serverUpdate:    (id,d)     => r('PUT',  `/monitoring/servers/${id}`, d),
  serverRemove:    (id)       => r('DELETE',`/monitoring/servers/${id}`),
  nfsHistory:      (id,mins)  => r('GET',  `/monitoring/nfs/${id}/history?minutes=${mins||60}`),
};

export const maintenanceAPI = {
  cloudRetention: () => r('GET', '/cloud-retention'),
  runCloudRetention: (body) => r('POST', '/cloud-retention/run', body || {}),
};

export const ociAPI = {
  list:        (id, prefix) => r('GET',  `/oci/${id}/list?prefix=${encodeURIComponent(prefix||'')}`),
  folderStats: (id, prefix) => r('GET',  `/oci/${id}/folder-stats?prefix=${encodeURIComponent(prefix||'')}`),
  presign:     (id, key)    => r('GET',  `/oci/${id}/presign?key=${encodeURIComponent(key)}`),
  test:        (id)         => r('POST', `/oci/${id}/test`),
  generateKey: ()           => r('POST', '/oci/generate-key'),
  audit:       ()           => r('GET',  '/oci/audit'),
};

export const regionsAPI = {
  list:   (provider) => r('GET',    `/regions${provider ? '?provider='+provider : ''}`),
  add:    (data)     => r('POST',   '/regions', data),
  remove: (id)       => r('DELETE', `/regions/${id}`),
};
