// src/pages/StoragePages.js
import { useState, useEffect, useCallback } from 'react';
import { storageAPI, destinationsAPI, settingsAPI, usersAPI, authAPI } from '../services/api';
import { Card, StatCard, Badge, Btn, DbIcon, Modal, Field, Toggle, toast } from '../components/UI';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { format } from 'date-fns';

function fmtBytes(b, short) {
  if (!b || b === 0) return '0 B';
  const u = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  const v = (b / Math.pow(1024, i)).toFixed(1);
  return short ? v + ' ' + u[i] : v + ' ' + u[i];
}

// ──────────────────────────────────────────────────────────────────────────────
// STORAGE ANALYTICS
// ──────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────
// SHARED SHELL
// ─────────────────────────────────────────────────────────
function PageShell({ title, sub, action, children }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid var(--bv-bd)', background: 'var(--bv-bg2)', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{title}</div>
          {sub && <div style={{ fontSize: 12, color: 'var(--bv-txt2)', marginTop: 3 }}>{sub}</div>}
        </div>
        {action}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {children}
      </div>
    </div>
  );
}

export function StoragePage() {
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setData(await storageAPI.stats()); }
    catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <PageShell title="Storage Analytics" sub="30-day overview"><div style={{ textAlign: 'center', padding: 60, color: 'var(--bv-txt3)' }}>Loading...</div></PageShell>;

  const totalBytes   = data?.byType?.reduce((a, r) => a + (r.total_bytes || 0), 0) || 0;
  const totalRuns    = data?.byType?.reduce((a, r) => a + (r.run_count || 0), 0) || 0;
  const totalSuccess = data?.byType?.reduce((a, r) => a + (r.success_count || 0), 0) || 0;
  const totalFailed  = data?.byType?.reduce((a, r) => a + (r.fail_count || 0), 0) || 0;
  const avgBytes     = totalRuns > 0 ? totalBytes / totalRuns : 0;
  const successRate  = totalRuns > 0 ? Math.round(totalSuccess / totalRuns * 100) : 100;

  const PIE_COLORS = { mysql: 'var(--bv-orange)', postgresql: 'var(--bv-blue)', redis: 'var(--bv-red)' };

  const trendData = (data?.trend || []).map(r => ({
    date: format(new Date(r.date), 'MMM d'),
    size: Math.round(r.total_bytes / 1024 / 1024),
    runs: r.run_count,
  }));

  const targetData = (data?.byTarget || []).map(r => ({
    name: r.name.length > 14 ? r.name.substring(0, 12) + '…' : r.name,
    size: Math.round((r.total_bytes || 0) / 1024 / 1024),
  }));

  return (
    <PageShell title="Storage Analytics" sub="30-day backup data overview across all targets">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12 }}>
        <StatCard label="Total Data (30D)"  value={fmtBytes(totalBytes)}     sub="all destinations"  accent="blue"   />
        <StatCard label="Total Runs (30D)"  value={totalRuns}                sub="across all targets" color="cyan"   accent="cyan"   />
        <StatCard label="Success Rate"      value={successRate + '%'}        sub="jobs completed OK"  color="green"  accent="green"  />
        <StatCard label="Failed Runs"       value={totalFailed}              sub="need investigation" color={totalFailed > 0 ? 'red' : 'white'} accent="red" />
        <StatCard label="Avg Backup Size"   value={fmtBytes(avgBytes)}       sub="per run average"   accent="purple" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16 }}>
        <Card title="Daily Backup Size — 14 Days" action={<span style={{ fontSize: 11, color: 'var(--bv-txt3)' }}>Successful runs only</span>}>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={trendData} margin={{ left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tick={{ fill: 'var(--bv-txt3)', fontSize: 9 }} tickLine={false} />
              <YAxis tick={{ fill: 'var(--bv-txt3)', fontSize: 9 }} tickLine={false} axisLine={false} unit=" MB" />
              <Tooltip contentStyle={{ background: 'var(--bv-bg3)', border: '1px solid var(--bv-bd)', borderRadius: 6, fontSize: 11 }} />
              <Line type="monotone" dataKey="size" stroke="'var(--bv-blue)'" strokeWidth={1.5} dot={{ fill: 'var(--bv-blue)', r: 3 }} name="Size MB" />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Storage by DB Type">
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={data?.byType || []} dataKey="total_bytes" nameKey="db_type" cx="40%" cy="50%" innerRadius={50} outerRadius={80}>
                {(data?.byType || []).map((e, i) => <Cell key={i} fill={PIE_COLORS[e.db_type] || 'var(--bv-blue)'} />)}
              </Pie>
              <Tooltip formatter={(v) => fmtBytes(v)} contentStyle={{ background: 'var(--bv-bg3)', border: '1px solid var(--bv-bd)', borderRadius: 6, fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {(data?.byType || []).map(r => (
              <div key={r.db_type} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: PIE_COLORS[r.db_type], display: 'inline-block', flexShrink: 0 }} />
                <DbIcon type={r.db_type} size={18} />{r.db_type} — {fmtBytes(r.total_bytes)} · {r.run_count} runs
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Per-Target Breakdown (30 Days)">
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={targetData} margin={{ left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="name" tick={{ fill: 'var(--bv-txt3)', fontSize: 9 }} tickLine={false} />
            <YAxis tick={{ fill: 'var(--bv-txt3)', fontSize: 9 }} tickLine={false} axisLine={false} unit=" MB" />
            <Tooltip contentStyle={{ background: 'var(--bv-bg3)', border: '1px solid var(--bv-bd)', borderRadius: 6, fontSize: 11 }} />
            <Bar dataKey="size" fill="'var(--bv-orange)'" radius={[4,4,0,0]} name="Size MB" />
          </BarChart>
        </ResponsiveContainer>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
          <thead><tr>{['Target','DB Type','Total Runs','Total Size','Last Run','Last Status'].map(h => (
            <th key={h} style={{ textAlign: 'left', fontSize: 10, fontWeight: 600, color: 'var(--bv-txt3)', letterSpacing: '.07em', textTransform: 'uppercase', padding: '6px 12px', borderBottom: '1px solid var(--bv-bd)' }}>{h}</th>
          ))}</tr></thead>
          <tbody>
            {(data?.byTarget || []).map(r => (
              <tr key={r.name}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bv-bg3)'}
                onMouseLeave={e => e.currentTarget.style.background = ''}>
                <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--bv-bd)', fontSize: 12 }}><strong>{r.name}</strong></td>
                <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--bv-bd)' }}><Badge type={r.db_type} small>{r.db_type?.toUpperCase()}</Badge></td>
                <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--bv-bd)', fontSize: 12, color: 'var(--bv-txt2)' }}>{r.run_count || 0}</td>
                <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--bv-bd)', fontSize: 12, color: 'var(--bv-txt2)' }}>{fmtBytes(r.total_bytes)}</td>
                <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--bv-bd)', fontSize: 12, color: 'var(--bv-txt2)' }}>{r.last_run ? format(new Date(r.last_run), 'dd MMM, hh:mm a') : '—'}</td>
                <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--bv-bd)' }}>{r.last_status ? <Badge type={r.last_status}>{r.last_status.toUpperCase()}</Badge> : <span style={{ color: 'var(--bv-txt3)' }}>—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </PageShell>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// PRIMARY DC STORAGE (reads from /api/fs/primary-mount)
// ──────────────────────────────────────────────────────────────────────────────
export function PrimaryDCPage() {
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [expanded, setExpanded] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await storageAPI.primaryMount()); }
    catch(e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const storage  = data?.storage || {};
  const pct      = parseInt(storage.usePercent) || 0;
  const barColor = pct >= 90 ? 'var(--bv-red)' : pct >= 80 ? 'var(--bv-amber)' : 'var(--bv-green)';

  // Flatten all files across all days for a directory, newest first
  function allFiles(folder) {
    return Object.entries(folder.days || {})
      .sort(([a],[b]) => b.localeCompare(a))   // newest date folder first
      .flatMap(([, files]) => files)
      .sort((a,b) => (b.mtime||0)-(a.mtime||0));
  }

  function fmtDayLabel(dateKey) {
    try {
      const d = new Date(dateKey);
      return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
    } catch { return dateKey; }
  }

  return (
    <PageShell
      title={<><i className="ti ti-device-floppy" style={{marginRight:8,color:'var(--bv-blue)'}}/> Primary DB Storage</>}
      sub={<>NFS: <span style={{color:'var(--bv-cyan)',fontFamily:'monospace'}}>{process.env.REACT_APP_PRIMARY_HOST||'10.180.0.90'}:/home</span> → <span style={{color:'var(--bv-green)',fontFamily:'monospace'}}>/primary-db-backup</span></>}
      action={<button onClick={load} style={{display:'flex',alignItems:'center',gap:5,padding:'6px 13px',borderRadius:8,border:'1px solid var(--bv-bd2)',background:'var(--bv-bg4)',color:'var(--bv-txt)',fontSize:12,cursor:'pointer'}}><i className="ti ti-refresh"/> Refresh</button>}
    >
      {/* Storage stats — NFS disk total + backup data breakdown */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12}}>
        <div style={{background:'var(--bv-card)',border:'1px solid var(--bv-bd)',borderRadius:12,padding:'14px 16px'}}>
          <div style={{fontSize:10,color:'var(--bv-txt3)',textTransform:'uppercase',letterSpacing:'.07em',fontWeight:600,marginBottom:6}}>NFS Pool Size</div>
          <div style={{fontSize:24,fontWeight:500,color:'var(--bv-blue)'}}>{storage.size||'—'}</div>
          <div style={{fontSize:11,color:'var(--bv-txt3)',marginTop:2}}>Total NFS volume</div>
        </div>
        <div style={{background:'var(--bv-card)',border:`1px solid ${pct>=80?'var(--bv-amber)':'var(--bv-bd)'}`,borderRadius:12,padding:'14px 16px'}}>
          <div style={{fontSize:10,color:'var(--bv-txt3)',textTransform:'uppercase',letterSpacing:'.07em',fontWeight:600,marginBottom:6}}>NFS Disk Used</div>
          <div style={{fontSize:24,fontWeight:500,color:barColor}}>{storage.used||'—'} <span style={{fontSize:13,fontWeight:400,color:'var(--bv-txt3)'}}>({storage.usePercent})</span></div>
          <div style={{width:'100%',height:6,background:'var(--bv-bg4)',borderRadius:3,overflow:'hidden',marginTop:6,marginBottom:3}}>
            <div style={{height:'100%',width:`${pct}%`,background:barColor,borderRadius:3}}/>
          </div>
          <div style={{fontSize:10,color:'var(--bv-txt3)'}}>Whole NFS · incl system files</div>
        </div>
        <div style={{background:'var(--bv-card)',border:'1px solid var(--bv-bd)',borderRadius:12,padding:'14px 16px'}}>
          <div style={{fontSize:10,color:'var(--bv-txt3)',textTransform:'uppercase',letterSpacing:'.07em',fontWeight:600,marginBottom:6}}>Backup Data Only</div>
          <div style={{fontSize:24,fontWeight:500,color:'var(--bv-cyan)'}}>{storage.backupUsedHuman||storage.used||'—'} <span style={{fontSize:13,fontWeight:400,color:'var(--bv-txt3)'}}>({storage.backupPct||'—'})</span></div>
          <div style={{fontSize:10,color:'var(--bv-txt3)',marginTop:4}}>Files in /primary-db-backup</div>
        </div>
        <div style={{background:'var(--bv-card)',border:'1px solid var(--bv-bd)',borderRadius:12,padding:'14px 16px'}}>
          <div style={{fontSize:10,color:'var(--bv-txt3)',textTransform:'uppercase',letterSpacing:'.07em',fontWeight:600,marginBottom:6}}>Free Space</div>
          <div style={{fontSize:24,fontWeight:500,color:'var(--bv-green)'}}>{storage.avail||'—'}</div>
          <div style={{fontSize:11,color:'var(--bv-txt3)',marginTop:2}}>Available on NFS volume</div>
        </div>
      </div>
      {pct>=80 && (
        <div style={{padding:'9px 14px',background:'var(--bv-amber-bg)',border:'1px solid var(--bv-amber)',borderRadius:8,fontSize:12,color:'var(--bv-amber)'}}>
          <i className="ti ti-alert-triangle" style={{marginRight:7}}/>
          <strong>Rule 2 active:</strong> NFS volume at {storage.usePercent}. Move backups older than 50 days to Secondary DB (10.180.0.130).
          <div style={{fontSize:10,color:'var(--bv-txt3)',marginTop:2}}>Note: NFS % includes all files on the volume, not just backups. Backup data only: {storage.backupPct||'—'}</div>
        </div>
      )}
            {/* Repository tree */}
      <div style={{background:'var(--bv-bg2)',border:'1px solid var(--bv-bd)',borderRadius:12}}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid var(--bv-bd)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <span style={{fontSize:11,fontWeight:600,color:'var(--bv-txt2)',letterSpacing:'.06em',textTransform:'uppercase'}}>
            Repository hierarchy — {(data?.tree||[]).length} databases · sorted by recent activity
          </span>
          <span style={{fontSize:11,color:'var(--bv-txt3)'}}>{(data?.tree||[]).reduce((s,f)=>s+f.totalFiles,0)} total files</span>
        </div>

        {loading ? (
          <div style={{textAlign:'center',padding:40,color:'var(--bv-txt3)'}}>Loading...</div>
        ) : (data?.tree||[]).length === 0 ? (
          <div style={{textAlign:'center',padding:48,color:'var(--bv-txt3)'}}>
            <i className="ti ti-folder-off" style={{fontSize:40,display:'block',marginBottom:12,color:'var(--bv-bd2)'}}/>
            No backup files found in /primary-db-backup
          </div>
        ) : (
          <div>
            {(data?.tree||[]).map(folder => {
              const isOpen   = expanded[folder.id];
              const recent   = folder.recentFile;
              const dayKeys  = Object.keys(folder.days||{}).sort((a,b)=>b.localeCompare(a));

              return (
                <div key={folder.id} style={{borderBottom:'1px solid var(--bv-bg4)'}}>
                  {/* DB folder row */}
                  <div onClick={()=>setExpanded(p=>({...p,[folder.id]:!p[folder.id]}))}
                    style={{display:'flex',alignItems:'center',gap:10,padding:'10px 16px',
                      cursor:'pointer',background:isOpen?'var(--bv-bg3)':'transparent'}}
                    onMouseEnter={e=>{if(!isOpen)e.currentTarget.style.background='var(--bv-bg3)'}}
                    onMouseLeave={e=>{if(!isOpen)e.currentTarget.style.background=''}}>
                    <i className={`ti ti-caret-${isOpen?'down':'right'}`} style={{fontSize:13,color:'var(--bv-txt3)',flexShrink:0}}/>
                    <i className="ti ti-folder-filled" style={{fontSize:16,color:'var(--bv-amber)',flexShrink:0}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:500,color:'var(--bv-txt)'}}>{folder.folderName}</div>
                      {recent && (
                        <div style={{fontSize:10,color:'var(--bv-txt3)',marginTop:1}}>
                          Latest: <span style={{color:'var(--bv-cyan)',fontFamily:'monospace'}}>{recent.filename}</span>
                          {' '}· {recent.size} · {recent.time}
                        </div>
                      )}
                    </div>
                    <div style={{textAlign:'right',flexShrink:0}}>
                      <div style={{fontSize:12,color:'var(--bv-txt2)',fontWeight:500}}>{folder.totalFiles} files</div>
                      {dayKeys.length > 0 && <div style={{fontSize:10,color:'var(--bv-txt3)'}}>{dayKeys.length} days</div>}
                    </div>
                  </div>

                  {/* Expanded: date folders with files */}
                  {isOpen && (
                    <div style={{borderTop:'1px solid var(--bv-bg4)',background:'var(--bv-bg)'}}>
                      {dayKeys.length === 0 ? (
                        <div style={{padding:'10px 32px',color:'var(--bv-txt3)',fontSize:12}}>No backup files found</div>
                      ) : dayKeys.map(dateKey => (
                        <div key={dateKey}>
                          {/* Date header */}
                          <div style={{padding:'6px 32px 4px',background:'var(--bv-bg2)',borderBottom:'1px solid var(--bv-bg4)',
                            display:'flex',alignItems:'center',gap:8}}>
                            <i className="ti ti-calendar" style={{fontSize:12,color:'var(--bv-blue)'}}/>
                            <span style={{fontSize:11,fontWeight:600,color:'var(--bv-blue)'}}>{fmtDayLabel(dateKey)}</span>
                            <span style={{fontSize:10,color:'var(--bv-txt3)'}}>({(folder.days[dateKey]||[]).length} files)</span>
                          </div>
                          {/* Files — newest first */}
                          {(folder.days[dateKey]||[]).map((file,i) => (
                            <div key={file.filename} style={{
                              display:'flex',alignItems:'center',gap:10,
                              padding:'7px 32px 7px 48px',
                              borderBottom:'1px solid var(--bv-bg3)',
                              background: i===0?'rgba(88,166,255,0.04)':'transparent',
                            }}>
                              <i className="ti ti-file-zip" style={{fontSize:13,color: file.status==='Verified'?'var(--bv-cyan)':'var(--bv-red)',flexShrink:0}}/>
                              <span style={{flex:1,fontSize:11,fontFamily:'monospace',color:'var(--bv-txt)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}
                                title={file.filename}>
                                {i===0 && <span style={{fontSize:9,background:'var(--bv-blue-dim)',color:'var(--bv-blue)',padding:'1px 5px',borderRadius:3,marginRight:6,fontFamily:'inherit'}}>LATEST</span>}
                                {file.filename}
                              </span>
                              <span style={{fontSize:11,color:'var(--bv-txt2)',whiteSpace:'nowrap',flexShrink:0}}>{file.size}</span>
                              <span style={{fontSize:10,color:'var(--bv-txt3)',whiteSpace:'nowrap',flexShrink:0}}>{file.time}</span>
                              <span style={{fontSize:10,padding:'1px 6px',borderRadius:10,flexShrink:0,
                                background: file.status==='Verified'?'var(--bv-green-bg)':'var(--bv-red-bg)',
                                color: file.status==='Verified'?'var(--bv-green)':'var(--bv-red)'}}>
                                {file.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PageShell>
  );
}

export function RemotePage() {
  return (
    <PageShell title="OnSite Remote Backup" sub={<>Remote SFTP: <span style={{ color: 'var(--bv-cyan)', fontFamily: 'monospace' }}>192.168.2.10</span> → <span style={{ color: 'var(--bv-green)', fontFamily: 'monospace' }}>/backups/remote</span></>}>
      <Card>
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--bv-txt3)' }}>
          <i className="ti ti-building" style={{ fontSize: 40, display: 'block', marginBottom: 12 }} />
          Remote site volume tree loads via direct SFTP connection.<br />Implement <code style={{ fontFamily: 'monospace', color: 'var(--bv-cyan)' }}>/api/fs/remote-mount</code> in <code style={{ fontFamily: 'monospace' }}>routes/fs.js</code> to enable.
        </div>
      </Card>
    </PageShell>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// DESTINATIONS
// ──────────────────────────────────────────────────────────────────────────────
const DEST_EMPTY = { name: '', dest_type: 'local', config: {}, is_active: true };

const DEST_TYPE_CFG = {
  local:       { icon: 'server',       label: 'Local NFS',         fields: [{ key: 'path', label: 'Local Path', placeholder: '/primary-db-backup' }] },
  remote_sftp: { icon: 'cloud-upload', label: 'Remote SFTP',       fields: [{ key: 'host', label: 'Host' }, { key: 'port', label: 'Port', placeholder: '22' }, { key: 'user', label: 'SSH User' }, { key: 'password', label: 'SSH Password', type: 'password' }, { key: 'path', label: 'Remote Path' }] },
  aws_s3:      { icon: 'brand-aws',    label: 'AWS S3',            fields: [{ key: 'bucket', label: 'Bucket Name' }, { key: 'prefix', label: 'Key Prefix', placeholder: 'db-backups/' }, { key: 'region', label: 'Region', placeholder: 'ap-south-1' }, { key: 'storage_class', label: 'Storage Class', placeholder: 'STANDARD_IA' }] },
};

export function DestinationsPage() {
  const [dests, setDests]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal]   = useState(null);
  const [form, setForm]     = useState(DEST_EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setDests(await destinationsAPI.list()); }
    catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openAdd() { setForm({ ...DEST_EMPTY, config: {} }); setModal('add'); }
  function openEdit(d) { setForm({ ...d, config: typeof d.config === 'string' ? JSON.parse(d.config) : d.config }); setModal('edit'); }

  async function handleSave(e) {
    e.preventDefault(); setSaving(true);
    try {
      if (modal === 'add') await destinationsAPI.create(form);
      else await destinationsAPI.update(form.id, form);
      toast(modal === 'add' ? 'Destination created' : 'Destination updated');
      setModal(null); load();
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  }

  async function handleRemoveDest(id) {
    if (!window.confirm('Deactivate this destination?')) return;
    try { await destinationsAPI.remove(id); toast('Destination deactivated'); load(); }
    catch (e) { toast(e.message, 'error'); }
  }

  const iconBg = { local: 'var(--bv-green-dim)', remote_sftp: 'var(--bv-blue-dim)', aws_s3: 'var(--bv-amber-bg)' };
  const iconColor = { local: 'var(--bv-green)', remote_sftp: 'var(--bv-blue)', aws_s3: 'var(--bv-amber)' };

  return (
    <PageShell title="Destinations" sub={`${dests.length} backup destinations configured`} action={<Btn variant="primary" icon="plus" onClick={openAdd}>Add Destination</Btn>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {dests.map(d => {
          const cfg = DEST_TYPE_CFG[d.dest_type];
          const config = typeof d.config === 'string' ? JSON.parse(d.config) : d.config;
          return (
            <div key={d.id} style={{ background: 'var(--bv-bg3)', border: '1px solid var(--bv-bd)', borderRadius: 12, padding: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: iconBg[d.dest_type], display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <i className={`ti ti-${cfg?.icon}`} style={{ fontSize: 20, color: iconColor[d.dest_type] }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{d.name}</div>
                <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--bv-cyan)', marginBottom: 4 }}>
                  {d.dest_type === 'aws_s3' ? `s3://${config.bucket}/${config.prefix}` : d.dest_type === 'remote_sftp' ? `${config.host}:${config.path}` : config.path}
                </div>
                <div style={{ fontSize: 11, color: 'var(--bv-txt2)' }}>{cfg?.label} · {d.is_active ? 'Active' : 'Inactive'}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                <Badge type={d.is_active ? 'success' : 'pending'}>{d.is_active ? 'Active' : 'Inactive'}</Badge>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Btn variant="ghost" size="sm" icon="edit" onClick={() => openEdit(d)}>Edit</Btn>
                  <Btn variant="danger" size="sm" onClick={() => handleRemoveDest(d.id)}>Deactivate</Btn>
                </div>
              </div>
            </div>
          );
        })}
        {!loading && dests.length === 0 && <div style={{ textAlign: 'center', padding: 60, color: 'var(--bv-txt3)' }}>No destinations configured.</div>}
      </div>

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal === 'add' ? 'Add Destination' : 'Edit Destination'} width={480}>
        <form onSubmit={handleSave}>
          <Field label="Name" required>
            <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Local NFS Store" style={{ width: '100%' }} required />
          </Field>
          <Field label="Type" required>
            <select value={form.dest_type} onChange={e => setForm(p => ({ ...p, dest_type: e.target.value, config: {} }))} style={{ width: '100%' }}>
              <option value="local">Local NFS</option>
              <option value="remote_sftp">Remote SFTP</option>
              <option value="aws_s3">AWS S3</option>
            </select>
          </Field>
          {(DEST_TYPE_CFG[form.dest_type]?.fields || []).map(f => (
            <Field key={f.key} label={f.label}>
              <input
                type={f.type || 'text'}
                value={form.config[f.key] || ''}
                onChange={e => setForm(p => ({ ...p, config: { ...p.config, [f.key]: e.target.value } }))}
                placeholder={f.placeholder}
                style={{ width: '100%' }}
              />
            </Field>
          ))}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <Btn variant="ghost" type="button" onClick={() => setModal(null)}>Cancel</Btn>
            <Btn variant="primary" loading={saving}>{modal === 'add' ? 'Create' : 'Save'}</Btn>
          </div>
        </form>
      </Modal>
    </PageShell>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SETTINGS
// ──────────────────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setInfo(await settingsAPI.get()); }
    catch(e) { toast(e.message,'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function fmtUptime(s) {
    if (!s) return '—';
    const d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60);
    return d>0?`${d}d ${h}h ${m}m`:`${h}h ${m}m`;
  }

  const row = (label, value, hint, mono) => (
    <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',padding:'9px 0',borderBottom:'1px solid var(--bv-bd)'}}>
      <div>
        <div style={{fontSize:13,color:'var(--bv-txt)'}}>{label}</div>
        {hint && <div style={{fontSize:11,color:'var(--bv-txt3)',marginTop:2}}>{hint}</div>}
      </div>
      <div style={{fontSize:12,fontFamily:mono?'monospace':'inherit',color:'var(--bv-cyan)',textAlign:'right',maxWidth:280,wordBreak:'break-all'}}>{value??'—'}</div>
    </div>
  );

  const MiniBar = ({pct,height=6}) => {
    const col=pct>=90?'var(--bv-red)':pct>=80?'var(--bv-amber)':'var(--bv-green)';
    return (
      <div style={{width:'100%',height,background:'var(--bv-bg4)',borderRadius:height/2,overflow:'hidden',margin:'3px 0'}}>
        <div style={{height:'100%',width:`${Math.min(pct,100)}%`,background:col,borderRadius:height/2}}/>
      </div>
    );
  };

  const SecTitle = ({icon,children}) => (
    <div style={{fontSize:11,fontWeight:500,color:'var(--bv-txt2)',letterSpacing:'.06em',textTransform:'uppercase',marginBottom:12,display:'flex',alignItems:'center',gap:7}}>
      <i className={`ti ti-${icon}`} style={{fontSize:16,color:'var(--bv-blue)'}}/>
      {children}
    </div>
  );

  return (
    <PageShell title="Settings" sub="System configuration and server monitoring">
      <Btn variant="ghost" icon="refresh" size="sm" onClick={load} style={{alignSelf:'flex-start'}}>Refresh stats</Btn>

      {loading ? <div style={{textAlign:'center',padding:40,color:'var(--bv-txt3)'}}>Loading server info...</div> : (
        <>
          {/* Row 1: CPU + Memory */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>

            {/* CPU */}
            <Card>
              <SecTitle icon="cpu">CPU</SecTitle>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',marginBottom:8}}>
                <div>
                  <div style={{fontSize:11,color:'var(--bv-txt3)',marginBottom:2}}>Usage</div>
                  <div style={{fontSize:32,fontWeight:500,color:info?.cpu?.usagePct>=80?'var(--bv-amber)':'var(--bv-green)',lineHeight:1}}>
                    {info?.cpu?.usagePct??'—'}{info?.cpu?.usagePct!=null?'%':''}
                  </div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:11,color:'var(--bv-txt3)'}}>Load avg</div>
                  <div style={{fontSize:12,color:'var(--bv-txt2)',fontFamily:'monospace'}}>{(info?.cpu?.loadAvg||[]).join(' / ')}</div>
                </div>
              </div>
              {info?.cpu?.usagePct!=null && <MiniBar pct={info.cpu.usagePct} height={8}/>}
              {row('Model', info?.cpu?.model?.replace(/\s+/g,' '), null, true)}
              {row('Cores', info?.cpu?.cores+' vCPUs')}
              {row('Hostname', info?.hostname)}
              {row('Platform', `${info?.platform} / ${info?.arch}`)}
            </Card>

            {/* Memory */}
            <Card>
              <SecTitle icon="server-2">Memory</SecTitle>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',marginBottom:8}}>
                <div>
                  <div style={{fontSize:11,color:'var(--bv-txt3)',marginBottom:2}}>Used</div>
                  <div style={{fontSize:32,fontWeight:500,color:info?.memory?.usedPct>=80?'var(--bv-amber)':'var(--bv-blue)',lineHeight:1}}>
                    {info?.memory?.usedPct??'—'}{info?.memory?.usedPct!=null?'%':''}
                  </div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:11,color:'var(--bv-txt3)'}}>Used / Total</div>
                  <div style={{fontSize:13,color:'var(--bv-txt2)',fontFamily:'monospace'}}>{info?.memory?.usedHuman} / {info?.memory?.totalHuman}</div>
                  <div style={{fontSize:11,color:'var(--bv-green)'}}>{info?.memory?.freeHuman} free</div>
                </div>
              </div>
              {info?.memory?.usedPct!=null && <MiniBar pct={info.memory.usedPct} height={8}/>}
              {row('Total RAM', info?.memory?.totalHuman)}
              {row('Used', info?.memory?.usedHuman)}
              {row('Free', info?.memory?.freeHuman)}
              {row('Node.js', info?.node_version)}
              {row('Uptime', fmtUptime(info?.uptime_seconds))}
            </Card>
          </div>

          {/* Row 2: Disk */}
          <Card>
            <SecTitle icon="device-floppy">Disk storage — all mount points</SecTitle>
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead><tr>
                  {['Filesystem','Mount','Size','Used','Free','Usage'].map(h=>(
                    <th key={h} style={{textAlign:'left',fontSize:10,color:'var(--bv-txt3)',fontWeight:600,letterSpacing:'.07em',textTransform:'uppercase',padding:'6px 12px',borderBottom:'1px solid var(--bv-bd)',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {(info?.disks||[]).map((d,i)=>{
                    const pct=parseInt(d.usePct)||0;
                    const col=pct>=90?'var(--bv-red)':pct>=80?'var(--bv-amber)':'var(--bv-green)';
                    const isPrimary=d.mount===(info?.primary_mount||'/primary-db-backup');
                    const isSecondary=d.mount===(info?.secondary_mount||'/secondary-db-backup');
                    return (
                      <tr key={i} style={{background:isPrimary?'rgba(88,166,255,0.04)':''}}
                        onMouseEnter={e=>e.currentTarget.style.background='var(--bv-bg3)'}
                        onMouseLeave={e=>e.currentTarget.style.background=isPrimary?'rgba(88,166,255,0.04)':''}>
                        <td style={{padding:'8px 12px',borderBottom:'1px solid var(--bv-bg4)',fontSize:11,fontFamily:'monospace',color:'var(--bv-cyan)'}}>{d.filesystem}</td>
                        <td style={{padding:'8px 12px',borderBottom:'1px solid var(--bv-bg4)',fontSize:12}}>
                          <div style={{display:'flex',alignItems:'center',gap:6}}>
                            <span style={{color:'var(--bv-txt)'}}>{d.mount}</span>
                            {isPrimary   && <span style={{fontSize:9,background:'var(--bv-blue-dim)',color:'var(--bv-blue)',padding:'1px 5px',borderRadius:3}}>PRIMARY DC</span>}
                            {isSecondary && <span style={{fontSize:9,background:'var(--bv-green-dim)',color:'var(--bv-green)',padding:'1px 5px',borderRadius:3}}>SECONDARY DC</span>}
                          </div>
                        </td>
                        <td style={{padding:'8px 12px',borderBottom:'1px solid var(--bv-bg4)',fontSize:12,color:'var(--bv-txt2)'}}>{d.size}</td>
                        <td style={{padding:'8px 12px',borderBottom:'1px solid var(--bv-bg4)',fontSize:12,color:col}}>{d.used}</td>
                        <td style={{padding:'8px 12px',borderBottom:'1px solid var(--bv-bg4)',fontSize:12,color:'var(--bv-green)'}}>{d.avail}</td>
                        <td style={{padding:'8px 12px',borderBottom:'1px solid var(--bv-bg4)',minWidth:120}}>
                          <div style={{display:'flex',alignItems:'center',gap:8}}>
                            <div style={{flex:1,height:6,background:'var(--bv-bg4)',borderRadius:3,overflow:'hidden'}}>
                              <div style={{height:'100%',width:`${pct}%`,background:col,borderRadius:3}}/>
                            </div>
                            <span style={{fontSize:11,color:col,fontWeight:500,minWidth:32,textAlign:'right'}}>{d.usePct}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {(info?.disks||[]).length===0 && <tr><td colSpan={6} style={{textAlign:'center',padding:24,color:'var(--bv-txt3)'}}>No disk info available</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Row 3: Listening ports + PM2 */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>

            {/* Listening ports */}
            <Card>
              <SecTitle icon="network">Listening ports (netstat)</SecTitle>
              <div style={{maxHeight:260,overflowY:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead style={{position:'sticky',top:0,background:'var(--bv-bg2)',zIndex:1}}>
                    <tr>{['Port','Address','Process'].map(h=>(
                      <th key={h} style={{textAlign:'left',fontSize:10,color:'var(--bv-txt3)',fontWeight:600,letterSpacing:'.07em',textTransform:'uppercase',padding:'6px 10px',borderBottom:'1px solid var(--bv-bd)'}}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {(info?.listening||[]).map((p,i)=>{
                      const isBackup=p.port==='4100';
                      const isDb=p.port==='3306'||p.port==='5432'||p.port==='6379';
                      const isWeb=p.port==='80'||p.port==='443';
                      const col=isBackup?'var(--bv-blue)':isDb?'var(--bv-green)':isWeb?'var(--bv-amber)':'var(--bv-txt2)';
                      return (
                        <tr key={i}
                          onMouseEnter={e=>e.currentTarget.style.background='var(--bv-bg3)'}
                          onMouseLeave={e=>e.currentTarget.style.background=''}>
                          <td style={{padding:'7px 10px',borderBottom:'1px solid var(--bv-bg4)'}}>
                            <span style={{fontSize:13,fontFamily:'monospace',fontWeight:500,color:col}}>{p.port}</span>
                            {isBackup && <span style={{fontSize:9,background:'var(--bv-blue-dim)',color:'var(--bv-blue)',padding:'1px 5px',borderRadius:3,marginLeft:5}}>BackupVault</span>}
                            {isDb     && <span style={{fontSize:9,background:'var(--bv-green-dim)',color:'var(--bv-green)',padding:'1px 5px',borderRadius:3,marginLeft:5}}>DB</span>}
                          </td>
                          <td style={{padding:'7px 10px',borderBottom:'1px solid var(--bv-bg4)',fontSize:11,color:'var(--bv-txt3)',fontFamily:'monospace'}}>{p.address}</td>
                          <td style={{padding:'7px 10px',borderBottom:'1px solid var(--bv-bg4)',fontSize:11,color:'var(--bv-txt2)'}}>{p.process}</td>
                        </tr>
                      );
                    })}
                    {(info?.listening||[]).length===0 && <tr><td colSpan={3} style={{textAlign:'center',padding:20,color:'var(--bv-txt3)',fontSize:12}}>No port info (ss/netstat not available)</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* PM2 processes */}
            <Card>
              <SecTitle icon="apps">PM2 processes</SecTitle>
              {(info?.pm2||[]).length > 0 ? (
                <div style={{display:'flex',flexDirection:'column',gap:6}}>
                  {info.pm2.map(p=>{
                    const isOnline=p.status==='online';
                    return (
                      <div key={p.id} style={{background:'var(--bv-bg3)',border:`1px solid ${isOnline?'var(--bv-green-bg)':'var(--bv-red-bg)'}`,borderRadius:8,padding:'9px 12px'}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:5}}>
                          <span style={{width:6,height:6,borderRadius:'50%',background:isOnline?'var(--bv-green)':'var(--bv-red)',flexShrink:0}}/>
                          <span style={{fontSize:13,fontWeight:500,color:'var(--bv-txt)',flex:1}}>{p.name}</span>
                          <span style={{fontSize:11,color:isOnline?'var(--bv-green)':'var(--bv-red)'}}>{p.status}</span>
                          <span style={{fontSize:10,color:'var(--bv-txt3)'}}>#{p.id}</span>
                        </div>
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6}}>
                          <div style={{fontSize:10}}>
                            <div style={{color:'var(--bv-txt3)'}}>CPU</div>
                            <div style={{color:'var(--bv-txt2)',fontFamily:'monospace'}}>{p.cpu??'—'}%</div>
                          </div>
                          <div style={{fontSize:10}}>
                            <div style={{color:'var(--bv-txt3)'}}>Memory</div>
                            <div style={{color:'var(--bv-txt2)',fontFamily:'monospace'}}>{p.memory?Math.round(p.memory/1024/1024)+'MB':'—'}</div>
                          </div>
                          <div style={{fontSize:10}}>
                            <div style={{color:'var(--bv-txt3)'}}>Restarts</div>
                            <div style={{color:p.restarts>5?'var(--bv-amber)':'var(--bv-txt2)',fontFamily:'monospace'}}>{p.restarts??0}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{textAlign:'center',padding:32,color:'var(--bv-txt3)',fontSize:12}}>
                  <i className="ti ti-apps" style={{fontSize:36,display:'block',marginBottom:10,color:'var(--bv-bd2)'}}/>
                  PM2 process list not available
                </div>
              )}
            </Card>
          </div>

          {/* Row 4: App config */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
            <Card>
              <SecTitle icon="settings">Application config</SecTitle>
              {row('Backup temp dir',   info?.backup_dir,    null, true)}
              {row('Primary DB mount',  info?.primary_mount, null, true)}
              {row('Secondary mount',   info?.secondary_mount, null, true)}
              {row('Storage warn at',   info?.storage_warn_pct+'%', 'Email notification threshold')}
              {row('Storage critical',  info?.storage_crit_pct+'%', 'Block new backups threshold')}
              {row('Notification email',info?.notification_email||'(not set)')}
              {row('App version',       info?.version)}
              {row('Timezone',          'Asia/Kolkata (IST +5:30)')}
            </Card>

            <Card>
              <SecTitle icon="world">Nginx config</SecTitle>
              <pre style={{fontFamily:'monospace',fontSize:11,color:'var(--bv-txt2)',background:'var(--bv-bg3)',border:'1px solid var(--bv-bd)',borderRadius:8,padding:12,overflowX:'auto',lineHeight:1.7,margin:0}}>
{`server {
  listen 443 ssl http2;
  server_name backupvault.worktual.tech;
  root /var/www/backupvault/frontend/build;

  location / {
    try_files $uri $uri/ /index.html;
  }
  location /api/ {
    proxy_pass http://127.0.0.1:4100;
  }
  location /ws {
    proxy_pass http://127.0.0.1:4100/ws;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "Upgrade";
  }
}`}
              </pre>
              <div style={{marginTop:10,fontSize:12,color:'var(--bv-txt2)'}}>
                Build frontend: <code style={{fontFamily:'monospace',color:'var(--bv-cyan)'}}>npm run build</code> →
                copy <code style={{fontFamily:'monospace',color:'var(--bv-cyan)'}}>build/</code> to <code style={{fontFamily:'monospace',color:'var(--bv-cyan)'}}>/var/www/backupvault/frontend/build</code>
              </div>
            </Card>
          </div>
        </>
      )}
    </PageShell>
  );
}

export function UsersPage() {
  const [users,    setUsers]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState(null); // 'create'|'edit'|'passwd'|'2fa'
  const [sel,      setSel]      = useState(null);
  const [saving,   setSaving]   = useState(false);
  const [twoFAData,setTwoFAData]= useState(null); // { secret, qr, backupCodes }
  const [totpCode, setTotpCode] = useState('');
  const [form,     setForm]     = useState({ name:'', email:'', password:'', role:'viewer' });
  const [pwForm,   setPwForm]   = useState({ current:'', newPass:'', confirm:'' });
  const [disablePass, setDisablePass] = useState('');
  const me = JSON.parse(localStorage.getItem('bv_user')||'{}');

  const ROLES = {
    super_admin:{ label:'Super Admin', color:'var(--bv-purple)', bg:'var(--bv-purple-bg)' },
    admin:      { label:'Admin',       color:'var(--bv-blue)',   bg:'var(--bv-blue-dim)'  },
    executor:   { label:'Executor',    color:'var(--bv-amber)',  bg:'var(--bv-amber-bg)'  },
    viewer:     { label:'Viewer',      color:'var(--bv-txt3)',   bg:'var(--bv-bg4)'       },
  };
  const PERMS = {
    super_admin: ['Full access','User management','Settings','Run backups','View all'],
    admin:       ['User management (non-super)','Settings','Run backups','View all'],
    executor:    ['Run backups','View dashboard & history','View live logs'],
    viewer:      ['View dashboard','View history','View storage (read-only)'],
  };
  const canManage = ['super_admin','admin'].includes(me.role);

  const load = useCallback(async () => {
    setLoading(true);
    try { setUsers(await usersAPI.list()); }
    catch(e) { toast(e.message,'error'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function handleCreate(e) {
    e.preventDefault(); setSaving(true);
    try {
      const r = await fetch('/api/users', { method:'POST',
        headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${localStorage.getItem('bv_token')}` },
        body: JSON.stringify(form) }).then(r=>r.json());
      if (r.error) throw new Error(r.error);
      toast(r.message); setModal(null);
      setForm({ name:'', email:'', password:'', role:'viewer' }); load();
    } catch(e) { toast(e.message,'error'); } finally { setSaving(false); }
  }

  async function handleRoleChange(userId, newRole) {
    try {
      const r = await fetch(`/api/users/${userId}`, { method:'PUT',
        headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${localStorage.getItem('bv_token')}` },
        body: JSON.stringify({ role: newRole }) }).then(r=>r.json());
      if (r.error) throw new Error(r.error);
      toast('Role updated'); load();
    } catch(e) { toast(e.message,'error'); }
  }

  async function handleToggleActive(user) {
    try {
      const r = await fetch(`/api/users/${user.id}`, { method:'PUT',
        headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${localStorage.getItem('bv_token')}` },
        body: JSON.stringify({ is_active: user.is_active ? 0 : 1 }) }).then(r=>r.json());
      if (r.error) throw new Error(r.error);
      toast(`User ${user.is_active?'deactivated':'activated'}`); load();
    } catch(e) { toast(e.message,'error'); }
  }

  async function handleRemoveUser(userId) {
    if (!window.confirm('Permanently deactivate this user?')) return;
    try {
      const r = await fetch(`/api/users/${userId}`, { method:'DELETE',
        headers:{ Authorization:`Bearer ${localStorage.getItem('bv_token')}` }}).then(r=>r.json());
      if (r.error) throw new Error(r.error);
      toast('User deactivated'); load();
    } catch(e) { toast(e.message,'error'); }
  }

  async function handlePasswordChange(e) {
    e.preventDefault();
    if (pwForm.newPass !== pwForm.confirm) return toast('Passwords do not match','error');
    setSaving(true);
    try {
      const r = await fetch(`/api/users/${sel.id}/password`, { method:'PUT',
        headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${localStorage.getItem('bv_token')}` },
        body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.newPass, adminReset: me.id!==sel.id }) }).then(r=>r.json());
      if (r.error) throw new Error(r.error);
      toast('Password updated'); setModal(null); setPwForm({ current:'', newPass:'', confirm:'' });
    } catch(e) { toast(e.message,'error'); } finally { setSaving(false); }
  }

  async function handleAdminReset2FA(userId, userName) {
    if (!window.confirm(`Reset 2FA for ${userName}? They will need to re-enroll Google Authenticator.`)) return;
    try {
      const r = await fetch(`/api/auth/2fa/admin-reset/${userId}`, { method:'POST',
        headers:{ Authorization:`Bearer ${localStorage.getItem('bv_token')}` }}).then(r=>r.json());
      if (r.error) throw new Error(r.error);
      toast(`2FA reset for ${userName} — they can re-enroll on next login`);
      load();
    } catch(e) { toast(e.message,'error'); }
  }

  async function setup2FA() {
    setSaving(true);
    try {
      const r = await fetch('/api/auth/2fa/setup', { method:'POST',
        headers:{ Authorization:`Bearer ${localStorage.getItem('bv_token')}` }}).then(r=>r.json());
      if (r.error) throw new Error(r.error);
      setTwoFAData(r); setModal('2fa'); setTotpCode('');
    } catch(e) { toast(e.message,'error'); } finally { setSaving(false); }
  }

  async function verify2FA(e) {
    e.preventDefault(); setSaving(true);
    try {
      const r = await fetch('/api/auth/2fa/verify', { method:'POST',
        headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${localStorage.getItem('bv_token')}` },
        body: JSON.stringify({ code: totpCode }) }).then(r=>r.json());
      if (r.error) throw new Error(r.error);
      toast('Google Authenticator enabled!'); setModal(null); setTwoFAData(null); load();
    } catch(e) { toast(e.message,'error'); } finally { setSaving(false); }
  }

  async function disable2FA(e) {
    e.preventDefault(); setSaving(true);
    try {
      const r = await fetch('/api/auth/2fa/disable', { method:'POST',
        headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${localStorage.getItem('bv_token')}` },
        body: JSON.stringify({ password: disablePass }) }).then(r=>r.json());
      if (r.error) throw new Error(r.error);
      toast('2FA disabled'); setModal(null); setDisablePass(''); load();
    } catch(e) { toast(e.message,'error'); } finally { setSaving(false); }
  }

  const RoleBadge = ({ role }) => {
    const r = ROLES[role]||ROLES.viewer;
    return <span style={{ fontSize:11, padding:'2px 9px', borderRadius:10, fontWeight:600, background:r.bg, color:r.color }}>{r.label}</span>;
  };

  const isSelf = u => u?.id === me.id;

  return (
    <PageShell
      title={<><i className="ti ti-users" style={{marginRight:8, color:'var(--bv-blue)'}}/>User Management</>}
      sub="Internal users with role-based access control · Invite-only system"
      action={canManage && <Btn variant="primary" size="sm" icon="user-plus" onClick={()=>{ setForm({name:'',email:'',password:'',role:'viewer'}); setModal('create'); }}>Invite User</Btn>}
    >
      {/* Role permission matrix */}
      <div style={{ border:'1px solid var(--bv-bd)', borderRadius:10, overflow:'hidden' }}>
        <div style={{ padding:'9px 14px', background:'var(--bv-bg3)', fontSize:11, fontWeight:600,
          color:'var(--bv-txt2)', textTransform:'uppercase', letterSpacing:'.06em',
          borderBottom:'1px solid var(--bv-bd)' }}>Role permissions</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:0 }}>
          {Object.entries(ROLES).map(([role, r]) => (
            <div key={role} style={{ padding:'10px 12px',
              borderRight:'1px solid var(--bv-bd)', borderBottom:'1px solid var(--bv-bd)' }}>
              <RoleBadge role={role}/>
              <div style={{ marginTop:7, display:'flex', flexDirection:'column', gap:3 }}>
                {PERMS[role].map(p => (
                  <div key={p} style={{ fontSize:10.5, color:'var(--bv-txt2)', display:'flex', alignItems:'center', gap:5 }}>
                    <i className="ti ti-check" style={{ fontSize:11, color:r.color }}/>
                    {p}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* User list */}
      <div style={{ background:'var(--bv-card)', border:'1px solid var(--bv-bd)', borderRadius:12, overflow:'hidden' }}>
        <div style={{ padding:'9px 14px 9px', background:'var(--bv-bg3)',
          display:'flex', alignItems:'center', justifyContent:'space-between',
          borderBottom:'1px solid var(--bv-bd)' }}>
          <span style={{ fontSize:11, fontWeight:600, color:'var(--bv-txt2)', textTransform:'uppercase', letterSpacing:'.06em' }}>
            {users.filter(u=>u.is_active).length} active users
          </span>
        </div>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead><tr>
            {['User','Role','2FA','Status','Last login','Actions'].map(h=>(
              <th key={h} style={{ textAlign:'left', fontSize:10, fontWeight:600, color:'var(--bv-txt3)',
                letterSpacing:'.07em', textTransform:'uppercase', padding:'8px 14px',
                borderBottom:'1px solid var(--bv-bd)', whiteSpace:'nowrap' }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ textAlign:'center', padding:32, color:'var(--bv-txt3)' }}>Loading...</td></tr>
            ) : users.map(u => (
              <tr key={u.id}
                onMouseEnter={e=>e.currentTarget.style.background='var(--bv-hover)'}
                onMouseLeave={e=>e.currentTarget.style.background=''}>
                <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--bv-bd)' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <div style={{ width:32, height:32, borderRadius:'50%', flexShrink:0,
                      background: ROLES[u.role]?.bg||'var(--bv-bg4)',
                      display:'flex', alignItems:'center', justifyContent:'center',
                      fontSize:12, fontWeight:700, color: ROLES[u.role]?.color||'var(--bv-txt3)' }}>
                      {u.name?.charAt(0)?.toUpperCase()||'?'}
                    </div>
                    <div>
                      <div style={{ fontSize:13, fontWeight:500, color:'var(--bv-txt)' }}>
                        {u.name} {isSelf(u) && <span style={{ fontSize:10, color:'var(--bv-txt3)' }}>(you)</span>}
                      </div>
                      <div style={{ fontSize:11, color:'var(--bv-txt3)' }}>{u.email}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--bv-bd)' }}>
                  {canManage && !isSelf(u) && u.role !== 'super_admin' ? (
                    <select value={u.role} onChange={e=>handleRoleChange(u.id,e.target.value)}
                      style={{ fontSize:11, padding:'4px 8px', borderRadius:6,
                        border:`1px solid ${ROLES[u.role]?.color||'var(--bv-bd2)'}`,
                        background:'var(--bv-card)', color:'var(--bv-txt)', cursor:'pointer' }}>
                      {Object.entries(ROLES).map(([r,d]) => (
                        me.role==='admin' && r==='super_admin' ? null :
                        <option key={r} value={r}>{d.label}</option>
                      ))}
                    </select>
                  ) : <RoleBadge role={u.role}/>}
                </td>
                <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--bv-bd)' }}>
                  {u.totp_enabled && u.totp_verified
                    ? <span style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, color:'var(--bv-green)' }}>
                        <i className="ti ti-shield-check" style={{ fontSize:14 }}/> Active
                      </span>
                    : <span style={{ fontSize:11, color:'var(--bv-txt3)' }}>
                        <i className="ti ti-shield-off" style={{ fontSize:13, marginRight:4 }}/>Off
                      </span>
                  }
                </td>
                <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--bv-bd)' }}>
                  <span style={{ fontSize:11, padding:'2px 8px', borderRadius:10, fontWeight:500,
                    background: u.is_active ? 'var(--bv-green-bg)' : 'var(--bv-red-bg)',
                    color: u.is_active ? 'var(--bv-green)' : 'var(--bv-red)' }}>
                    {u.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--bv-bd)', fontSize:11, color:'var(--bv-txt3)' }}>
                  {u.last_login_at ? new Date(u.last_login_at).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—'}
                </td>
                <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--bv-bd)' }}>
                  <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                    <Btn variant="ghost" size="sm" icon="key" onClick={()=>{ setSel(u); setPwForm({current:'',newPass:'',confirm:''}); setModal('passwd'); }}>Password</Btn>
                    {isSelf(u) ? (
                      u.totp_enabled && u.totp_verified
                        ? <><Btn variant="ghost" size="sm" icon="shield-off" onClick={()=>{ setSel(u); setDisablePass(''); setModal('disable2fa'); }}>Disable 2FA</Btn>
                          <Btn variant="ghost" size="sm" icon="key" onClick={async ()=>{
                            setSel(u);
                            // Load current backup codes
                            try {
                              const r = await fetch('/api/auth/2fa/backup-codes', {
                                headers:{ Authorization:`Bearer ${localStorage.getItem('bv_token')}` }
                              }).then(r=>r.json());
                              if (r.error) throw new Error(r.error);
                              setTwoFAData({ codes: r.codes });
                              setDisablePass('');
                              setModal('viewcodes');
                            } catch(e) { toast(e.message,'error'); }
                          }}>Backup Codes</Btn></>
                        : <Btn variant="success" size="sm" icon="shield-check" onClick={setup2FA}>Setup 2FA</Btn>
                    ) : (canManage && u.totp_enabled && u.totp_verified && (
                      <Btn variant="ghost" size="sm" icon="shield-x" onClick={()=>handleAdminReset2FA(u.id,u.name)}>Reset 2FA</Btn>
                    ))}
                    {canManage && !isSelf(u) && (
                      <>
                        <Btn variant="ghost" size="sm" icon={u.is_active?'user-off':'user-check'} onClick={()=>handleToggleActive(u)}>
                          {u.is_active ? 'Deactivate' : 'Activate'}
                        </Btn>
                        {me.role==='super_admin' && (
                          <Btn variant="danger" size="sm" onClick={()=>handleRemoveUser(u.id)}>Remove</Btn>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* CREATE USER MODAL */}
      <Modal open={modal==='create'} onClose={()=>setModal(null)} title="Invite New User" width={460}>
        <form onSubmit={handleCreate} style={{ display:'flex', flexDirection:'column', gap:0 }}>
          <Field label="Full name" required>
            <input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} placeholder="Krishnakumar" style={{ width:'100%' }} required/>
          </Field>
          <Field label="Email address" required>
            <input type="email" value={form.email} onChange={e=>setForm(p=>({...p,email:e.target.value}))} placeholder="user@worktual.tech" style={{ width:'100%' }} required/>
          </Field>
          <Field label="Temporary password" required hint="User should change this after first login">
            <input type="password" value={form.password} onChange={e=>setForm(p=>({...p,password:e.target.value}))} style={{ width:'100%' }} required minLength={8}/>
          </Field>
          <Field label="Role">
            <select value={form.role} onChange={e=>setForm(p=>({...p,role:e.target.value}))} style={{ width:'100%' }}>
              {Object.entries(ROLES).map(([r,d]) => (
                me.role==='admin' && r==='super_admin' ? null :
                <option key={r} value={r}>{d.label} — {
                  r==='super_admin'?'Full access':r==='admin'?'Manage + run backups':r==='executor'?'Run backups + view':r==='viewer'?'Read-only':''
                }</option>
              ))}
            </select>
          </Field>
          {/* Role description */}
          <div style={{ padding:'9px 12px', background:'var(--bv-bg3)', borderRadius:8, marginBottom:14,
            fontSize:11, color:'var(--bv-txt2)', display:'flex', alignItems:'flex-start', gap:8 }}>
            <i className="ti ti-info-circle" style={{ color:'var(--bv-blue)', fontSize:14, flexShrink:0, marginTop:1 }}/>
            <span>{PERMS[form.role]?.join(' · ')}</span>
          </div>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
            <Btn variant="ghost" type="button" onClick={()=>setModal(null)}>Cancel</Btn>
            <Btn variant="primary" loading={saving}>Create User</Btn>
          </div>
        </form>
      </Modal>

      {/* PASSWORD CHANGE MODAL */}
      <Modal open={modal==='passwd'} onClose={()=>setModal(null)} title={`Change password — ${sel?.name}`} width={420}>
        <form onSubmit={handlePasswordChange} style={{ display:'flex', flexDirection:'column', gap:0 }}>
          {isSelf(sel) && (
            <Field label="Current password" required>
              <input type="password" value={pwForm.current} onChange={e=>setPwForm(p=>({...p,current:e.target.value}))} style={{ width:'100%' }} required/>
            </Field>
          )}
          <Field label="New password" required hint="Minimum 8 characters">
            <input type="password" value={pwForm.newPass} onChange={e=>setPwForm(p=>({...p,newPass:e.target.value}))} style={{ width:'100%' }} required minLength={8}/>
          </Field>
          <Field label="Confirm new password" required>
            <input type="password" value={pwForm.confirm} onChange={e=>setPwForm(p=>({...p,confirm:e.target.value}))} style={{ width:'100%' }} required/>
          </Field>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:4 }}>
            <Btn variant="ghost" type="button" onClick={()=>setModal(null)}>Cancel</Btn>
            <Btn variant="primary" loading={saving}>Update Password</Btn>
          </div>
        </form>
      </Modal>

      {/* 2FA SETUP MODAL */}
      <Modal open={modal==='2fa'} onClose={()=>setModal(null)} title="Setup Google Authenticator" width={480}>
        {twoFAData && (
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div style={{ padding:'10px 13px', background:'var(--bv-blue-dim)', border:'1px solid var(--bv-blue)', borderRadius:8, fontSize:12, color:'var(--bv-txt)' }}>
              <div style={{ fontWeight:600, marginBottom:4, color:'var(--bv-blue)' }}>Setup instructions</div>
              1. Install Google Authenticator on your phone<br/>
              2. Tap + → Scan QR code<br/>
              3. Enter the 6-digit code below to confirm
            </div>
            {/* QR Code */}
            <div style={{ textAlign:'center' }}>
              <img src={twoFAData.qr} alt="Google Authenticator QR code" style={{ width:200, height:200, border:'4px solid var(--bv-bg3)', borderRadius:8 }}/>
              <div style={{ fontSize:10, color:'var(--bv-txt3)', marginTop:6 }}>Scan with Google Authenticator</div>
            </div>
            {/* Manual key */}
            <div style={{ padding:'8px 12px', background:'var(--bv-bg3)', borderRadius:7, textAlign:'center' }}>
              <div style={{ fontSize:10, color:'var(--bv-txt3)', marginBottom:4 }}>Manual entry key (if QR scan fails)</div>
              <code style={{ fontSize:13, fontFamily:'monospace', letterSpacing:2, color:'var(--bv-cyan)', fontWeight:600 }}>
                {twoFAData.secret?.replace(/(.{4})/g,'$1 ').trim()}
              </code>
            </div>
            {/* Backup codes */}
            <div style={{ padding:'10px 12px', background:'var(--bv-amber-bg)', border:'1px solid var(--bv-amber)', borderRadius:8 }}>
              <div style={{ fontSize:11, fontWeight:600, color:'var(--bv-amber)', marginBottom:6 }}>
                <i className="ti ti-key" style={{ marginRight:5 }}/>Save these backup codes — shown only once
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:4 }}>
                {twoFAData.backupCodes?.map(c => (
                  <code key={c} style={{ fontSize:12, fontFamily:'monospace', color:'var(--bv-txt)', background:'var(--bv-card)', padding:'3px 7px', borderRadius:4 }}>{c}</code>
                ))}
              </div>
              <div style={{ fontSize:10, color:'var(--bv-txt3)', marginTop:6 }}>Each code can be used once if you lose your phone</div>
            </div>
            {/* Confirm code */}
            <form onSubmit={verify2FA}>
              <Field label="Enter the 6-digit code from Google Authenticator" required>
                <input value={totpCode} onChange={e=>setTotpCode(e.target.value.replace(/\D/g,'').slice(0,6))}
                  placeholder="000000" maxLength={6}
                  style={{ width:'100%', textAlign:'center', fontSize:24, letterSpacing:8, fontFamily:'monospace', fontWeight:600 }}
                  required autoFocus/>
              </Field>
              <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
                <Btn variant="ghost" type="button" onClick={()=>setModal(null)}>Cancel</Btn>
                <Btn variant="success" loading={saving}>Activate 2FA</Btn>
              </div>
            </form>
          </div>
        )}
      </Modal>

      {/* VIEW BACKUP CODES MODAL */}
      <Modal open={modal==='viewcodes'} onClose={()=>setModal(null)} title="Backup Codes" width={460}>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ padding:'9px 13px', background:'var(--bv-amber-bg)',
            border:'1px solid var(--bv-amber)', borderRadius:8, fontSize:12, color:'var(--bv-txt)' }}>
            <i className="ti ti-key" style={{ marginRight:6, color:'var(--bv-amber)' }}/>
            <strong>Save these codes safely.</strong> Each code works once only.
            Use them if you lose access to your Google Authenticator app.
          </div>
          {twoFAData?.codes?.length > 0 ? (
            <>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
                {twoFAData.codes.map((c,i) => (
                  <div key={i} style={{ padding:'7px 12px', background:'var(--bv-bg3)',
                    border:'1px solid var(--bv-bd)', borderRadius:7,
                    fontFamily:'monospace', fontSize:14, fontWeight:600,
                    color:'var(--bv-txt)', letterSpacing:2, textAlign:'center' }}>{c}</div>
                ))}
              </div>
              <div style={{ fontSize:11, color:'var(--bv-txt3)', textAlign:'center' }}>
                {twoFAData.codes.length} codes remaining
              </div>
              <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
                <Btn variant="ghost" type="button" onClick={()=>{
                  const text = twoFAData.codes.join('\n');
                  navigator.clipboard?.writeText(text);
                  toast('Backup codes copied to clipboard');
                }}>
                  <i className="ti ti-copy" style={{ fontSize:13 }}/> Copy All
                </Btn>
                <Btn variant="ghost" type="button" onClick={()=>{
                  const lines = [
                    'BackupVault 2FA Backup Codes',
                    '================================',
                    'Generated: ' + new Date().toLocaleString('en-IN'),
                    '',
                    'IMPORTANT: Each code can only be used ONCE.',
                    'Use these if you lose access to Google Authenticator.',
                    '',
                    ...twoFAData.codes.map((c,i) => (i+1) + '. ' + c),
                    '',
                    'After using a backup code, re-enroll 2FA from the Users page.',
                  ];
                  try {
                    const blob = new Blob([lines.join('\n')], { type:'text/plain;charset=utf-8' });
                    const url  = URL.createObjectURL(blob);
                    const a    = document.createElement('a');
                    a.href     = url;
                    a.download = 'backupvault-backup-codes.txt';
                    a.style.display = 'none';
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 3000);
                    toast('Backup codes downloaded');
                  } catch(e) { toast('Download failed: ' + e.message, 'error'); }
                }}>
                  <i className="ti ti-download" style={{ fontSize:13 }}/> Download
                </Btn>
              </div>
            </>
          ) : (
            <div style={{ textAlign:'center', padding:24, color:'var(--bv-txt3)' }}>
              No backup codes remaining. Regenerate new ones below.
            </div>
          )}

          {/* Regenerate section */}
          <div style={{ borderTop:'1px solid var(--bv-bd)', paddingTop:12 }}>
            <div style={{ fontSize:12, fontWeight:600, color:'var(--bv-txt2)', marginBottom:8 }}>
              Regenerate backup codes
            </div>
            <div style={{ fontSize:11, color:'var(--bv-txt3)', marginBottom:10 }}>
              Enter your password to generate 10 new codes. Old codes become invalid immediately.
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <input type="password" placeholder="Your password"
                value={disablePass} onChange={e=>setDisablePass(e.target.value)}
                style={{ flex:1 }}/>
              <Btn variant="primary" loading={saving} type="button" onClick={async ()=>{
                if (!disablePass) { toast('Enter your password','error'); return; }
                setSaving(true);
                try {
                  const r = await fetch('/api/auth/2fa/regenerate-backup-codes', {
                    method:'POST',
                    headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${localStorage.getItem('bv_token')}` },
                    body: JSON.stringify({ password: disablePass })
                  }).then(r=>r.json());
                  if (r.error) throw new Error(r.error);
                  setTwoFAData({ codes: r.codes });
                  setDisablePass('');
                  toast('New backup codes generated');
                } catch(e) { toast(e.message,'error'); }
                finally { setSaving(false); }
              }}>Regenerate</Btn>
            </div>
          </div>

          <div style={{ display:'flex', justifyContent:'flex-end' }}>
            <Btn variant="ghost" type="button" onClick={()=>setModal(null)}>Close</Btn>
          </div>
        </div>
      </Modal>

      {/* DISABLE 2FA MODAL */}
      <Modal open={modal==='disable2fa'} onClose={()=>setModal(null)} title="Disable 2FA" width={400}>
        <form onSubmit={disable2FA} style={{ display:'flex', flexDirection:'column', gap:0 }}>
          <div style={{ padding:'9px 13px', background:'var(--bv-red-bg)', border:'1px solid var(--bv-red)', borderRadius:8, fontSize:12, color:'var(--bv-red)', marginBottom:14 }}>
            <i className="ti ti-alert-triangle" style={{ marginRight:6 }}/>
            Disabling 2FA reduces account security. Enter your password to confirm.
          </div>
          <Field label="Your password" required>
            <input type="password" value={disablePass} onChange={e=>setDisablePass(e.target.value)} style={{ width:'100%' }} required autoFocus/>
          </Field>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:4 }}>
            <Btn variant="ghost" type="button" onClick={()=>setModal(null)}>Cancel</Btn>
            <Btn variant="danger" loading={saving}>Disable 2FA</Btn>
          </div>
        </form>
      </Modal>
    </PageShell>
  );
}


export function SecondaryDCPage() {
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [expanded, setExpanded] = useState({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const token = localStorage.getItem('bv_token');
      const res   = await fetch('/api/fs/secondary-mount', { headers:{ Authorization:`Bearer ${token}` } });
      if (res.status === 404) setData({ notConfigured:true });
      else if (res.ok)        setData(await res.json());
      else setError('Failed to load secondary DC data');
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const storage    = data?.storage || {};
  const pct        = parseInt(storage.usePercent) || 0;
  const barColor   = pct>=90?'var(--bv-red)':pct>=80?'var(--bv-amber)':'var(--bv-green)';
  const tree       = data?.tree || [];
  const totalFiles = tree.reduce((s,f) => s+(f.totalFiles||0), 0);
  const hasData    = totalFiles > 0;

  function fmtDate(k) {
    try { return new Date(k).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); }
    catch { return k; }
  }

  return (
    <PageShell
      title="Secondary DB Storage"
      sub={<>Rsync mirror: <span style={{color:'var(--bv-cyan)',fontFamily:'monospace'}}>10.180.0.130</span> → <span style={{color:'var(--bv-green)',fontFamily:'monospace'}}>/secondary-db-backup</span></>}
      action={<button onClick={load} style={{display:'flex',alignItems:'center',gap:5,padding:'6px 13px',borderRadius:8,border:'1px solid var(--bv-bd2)',background:'var(--bv-bg4)',color:'var(--bv-txt)',fontSize:12,cursor:'pointer'}}><i className="ti ti-refresh"/> Refresh</button>}
    >
      {/* Disk stats */}
      {storage.size && (
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}>
          {[
            {icon:'server-2',  label:'Total Pool',            value:storage.size,  color:'var(--bv-cyan)',  bg:'var(--bv-cyan-bg)'},
            {icon:'chart-bar', label:`Used (${storage.usePercent})`, value:storage.used, color:barColor, bg:'var(--bv-bg3)', bar:true},
            {icon:'check',     label:'Free Space',            value:storage.avail, color:'var(--bv-green)', bg:'var(--bv-green-dim)'},
          ].map(({icon,label,value,color,bg,bar}) => (
            <div key={label} style={{background:'var(--bv-card)',border:'1px solid var(--bv-bd)',borderRadius:12,padding:'14px 16px',display:'flex',alignItems:'center',gap:14}}>
              <div style={{width:42,height:42,borderRadius:10,background:bg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                <i className={`ti ti-${icon}`} style={{fontSize:20,color}}/>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:10,color:'var(--bv-txt3)',letterSpacing:'.07em',textTransform:'uppercase',fontWeight:600,marginBottom:4}}>{label}</div>
                <div style={{fontSize:22,fontWeight:500,color}}>{value}</div>
                {bar && <div style={{width:'100%',height:6,background:'var(--bv-bg4)',borderRadius:3,overflow:'hidden',marginTop:5}}>
                  <div style={{height:'100%',width:`${pct}%`,background:barColor,borderRadius:3}}/>
                </div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div style={{background:'var(--bv-card)',border:'1px solid var(--bv-bd)',borderRadius:12,padding:60,textAlign:'center',color:'var(--bv-txt3)'}}>
          <i className="ti ti-loader" style={{fontSize:32,display:'block',marginBottom:10,animation:'bvspin .7s linear infinite'}}/>
          Loading secondary DC...
        </div>
      ) : error ? (
        <div style={{background:'var(--bv-red-dim)',border:'1px solid var(--bv-red)',borderRadius:12,padding:24,color:'var(--bv-red)',fontSize:13}}>
          <i className="ti ti-alert-triangle" style={{marginRight:8}}/>{error}
        </div>
      ) : data?.notConfigured ? (
        <div style={{background:'var(--bv-card)',border:'1px solid var(--bv-bd)',borderRadius:12,padding:48,textAlign:'center',color:'var(--bv-txt3)'}}>
          <i className="ti ti-server-off" style={{fontSize:42,display:'block',marginBottom:14,color:'var(--bv-bd2)'}}/>
          <div style={{fontSize:15,fontWeight:500,color:'var(--bv-txt2)',marginBottom:8}}>Secondary DB not configured</div>
          <div style={{fontSize:12}}>Mount at <code style={{fontFamily:'monospace',color:'var(--bv-cyan)'}}>/secondary-db-backup</code> and restart backend.</div>
        </div>
      ) : !hasData ? (
        <div style={{background:'var(--bv-card)',border:'1px solid var(--bv-bd)',borderRadius:12,padding:48,textAlign:'center',color:'var(--bv-txt3)'}}>
          <i className="ti ti-database-off" style={{fontSize:42,display:'block',marginBottom:14,color:'var(--bv-bd2)'}}/>
          <div style={{fontSize:15,fontWeight:500,color:'var(--bv-txt2)',marginBottom:8}}>No data available</div>
          <div style={{fontSize:12}}>Secondary DB is mounted but contains no backup files yet.<br/>Files appear here after Rule 2 manual copy from Primary DC.</div>
        </div>
      ) : (
        <div style={{background:'var(--bv-card)',border:'1px solid var(--bv-bd)',borderRadius:12,overflow:'hidden'}}>
          {/* Header */}
          <div style={{padding:'12px 16px',borderBottom:'1px solid var(--bv-bd)',display:'flex',alignItems:'center',justifyContent:'space-between',background:'var(--bv-bg3)'}}>
            <span style={{fontSize:11,fontWeight:600,color:'var(--bv-txt2)',letterSpacing:'.06em',textTransform:'uppercase'}}>
              Repository hierarchy · {tree.length} databases · {totalFiles} total files
            </span>
            <div style={{display:'flex',gap:8}}>
              <button onClick={()=>setExpanded(Object.fromEntries(tree.map(f=>[f.id,true])))}
                style={{fontSize:11,padding:'3px 8px',borderRadius:5,border:'1px solid var(--bv-bd2)',background:'var(--bv-bg4)',color:'var(--bv-txt2)',cursor:'pointer'}}>
                Expand all
              </button>
              <button onClick={()=>setExpanded({})}
                style={{fontSize:11,padding:'3px 8px',borderRadius:5,border:'1px solid var(--bv-bd2)',background:'var(--bv-bg4)',color:'var(--bv-txt2)',cursor:'pointer'}}>
                Collapse all
              </button>
            </div>
          </div>

          {/* Tree */}
          {tree.map(folder => {
            const isOpen  = !!expanded[folder.id];
            const recent  = folder.recentFile;
            const dayKeys = Object.keys(folder.days||{}).sort((a,b)=>b.localeCompare(a)); // newest date first

            return (
              <div key={folder.id} style={{borderBottom:'1px solid var(--bv-bd)'}}>
                {/* DB folder row */}
                <div onClick={()=>setExpanded(p=>({...p,[folder.id]:!p[folder.id]}))}
                  style={{display:'flex',alignItems:'center',gap:10,padding:'10px 16px',cursor:'pointer',
                    background:isOpen?'var(--bv-hover)':'var(--bv-card)',transition:'background .12s'}}
                  onMouseEnter={e=>e.currentTarget.style.background='var(--bv-hover)'}
                  onMouseLeave={e=>e.currentTarget.style.background=isOpen?'var(--bv-hover)':'var(--bv-card)'}>
                  <i className={`ti ti-caret-${isOpen?'down':'right'}`} style={{fontSize:13,color:'var(--bv-txt3)',flexShrink:0}}/>
                  <i className="ti ti-folder-filled" style={{fontSize:16,color:'var(--bv-amber)',flexShrink:0}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:500,color:'var(--bv-txt)'}}>{folder.folderName}</div>
                    {recent && (
                      <div style={{fontSize:10,color:'var(--bv-txt3)',marginTop:1}}>
                        Latest: <span style={{color:'var(--bv-cyan)',fontFamily:'monospace'}}>{recent.filename}</span>
                        {' '}· {recent.size} · {recent.time}
                      </div>
                    )}
                  </div>
                  <div style={{textAlign:'right',flexShrink:0}}>
                    <div style={{fontSize:12,color:'var(--bv-txt2)',fontWeight:500}}>{folder.totalFiles} files</div>
                    {dayKeys.length>0 && <div style={{fontSize:10,color:'var(--bv-txt3)'}}>{dayKeys.length} days</div>}
                  </div>
                </div>

                {/* Expanded: date folders + files newest first */}
                {isOpen && (
                  <div style={{borderTop:'1px solid var(--bv-bd)',background:'var(--bv-bg)'}}>
                    {dayKeys.length === 0 ? (
                      <div style={{padding:'10px 48px',color:'var(--bv-txt3)',fontSize:12}}>No backup files found</div>
                    ) : dayKeys.map(dateKey => (
                      <div key={dateKey}>
                        {/* Date header */}
                        <div style={{padding:'6px 32px 4px',background:'var(--bv-bg2)',borderBottom:'1px solid var(--bv-bd)',
                          display:'flex',alignItems:'center',gap:8}}>
                          <i className="ti ti-calendar" style={{fontSize:12,color:'var(--bv-blue)'}}/>
                          <span style={{fontSize:11,fontWeight:600,color:'var(--bv-blue)'}}>{fmtDate(dateKey)}</span>
                          <span style={{fontSize:10,color:'var(--bv-txt3)'}}>({(folder.days[dateKey]||[]).length} files)</span>
                        </div>
                        {/* Files — newest first */}
                        {(folder.days[dateKey]||[]).map((file,i) => (
                          <div key={file.filename} style={{display:'flex',alignItems:'center',gap:10,
                            padding:'7px 32px 7px 52px',borderBottom:'1px solid var(--bv-bg3)',
                            background:i===0?'rgba(88,166,255,0.04)':'transparent'}}>
                            <i className="ti ti-file-zip" style={{fontSize:13,color:file.status==='Verified'?'var(--bv-cyan)':'var(--bv-red)',flexShrink:0}}/>
                            <span style={{flex:1,fontSize:11,fontFamily:'monospace',color:'var(--bv-txt)',
                              overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={file.filename}>
                              {i===0 && <span style={{fontSize:9,background:'var(--bv-blue-dim)',color:'var(--bv-blue)',
                                padding:'1px 5px',borderRadius:3,marginRight:6,fontFamily:'inherit'}}>LATEST</span>}
                              {file.filename}
                            </span>
                            <span style={{fontSize:11,color:'var(--bv-txt2)',whiteSpace:'nowrap',flexShrink:0}}>{file.size}</span>
                            <span style={{fontSize:10,color:'var(--bv-txt3)',whiteSpace:'nowrap',flexShrink:0}}>{file.time}</span>
                            <span style={{fontSize:10,padding:'1px 6px',borderRadius:10,flexShrink:0,
                              background:file.status==='Verified'?'var(--bv-green-bg)':'var(--bv-red-bg)',
                              color:file.status==='Verified'?'var(--bv-green)':'var(--bv-red)'}}>
                              {file.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}

