// frontend/src/pages/RestoreDB.js
// Database Restore Wizard — 4 steps
// Step 1: Select DB + Source Tier
// Step 2: Browse & Select Backup File
// Step 3: Configure Target Server
// Step 4: Live Restore Log

import { useState, useEffect, useCallback, useRef } from 'react';
import { destinationsAPI, targetsAPI } from '../services/api';
import { Btn, Spinner, Field, Modal, toast } from '../components/UI';

// ── API helper ────────────────────────────────────────────────
const api = (method, path, body) => {
  const token = localStorage.getItem('bv_token');
  return fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async r => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
    return d;
  });
};

// ── Formatters ────────────────────────────────────────────────
const fmtBytes = b => {
  if (!b || b === 0) return '—';
  const u = ['B','KB','MB','GB','TB'];
  const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), 4);
  return (b / Math.pow(1024, i)).toFixed(1) + ' ' + u[i];
};
const fmtDate = d => {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', {
    day:'2-digit', month:'short', year:'numeric',
    hour:'2-digit', minute:'2-digit'
  });
};

// ── Constants ─────────────────────────────────────────────────
const TIERS = [
  { key:'primary',   label:'Primary DB (NFS)',     icon:'server',    color:'#2b8a3e', bg:'#1a3a1a', desc:'/primary-db-backup · 10.180.0.90 · Fastest' },
  { key:'secondary', label:'Secondary DB (NFS)',   icon:'database',  color:'#0a7e80', bg:'#003a3a', desc:'/secondary-db-backup · 10.180.0.130 · Long-term' },
  { key:'remote',    label:'Remote Onsite DR',     icon:'building',  color:'#e67700', bg:'#3a2000', desc:'192.168.12.243 · /backups/remote' },
  { key:'s3',        label:'AWS S3 Cloud',         icon:'brand-aws', color:'#6741d9', bg:'#2a1040', desc:'s3://worktual-db-backup · eu-west-2' },
  { key:'oci',       label:'OCI Encrypted',        icon:'cloud',     color:'#c74634', bg:'#4a0a00', desc:'worktual-db-backup-oci · ap-mumbai-1 · AES-256' },
];

const STEPS = [
  { label:'Select Database',   icon:'database'         },
  { label:'Select Backup File',icon:'file-zip'         },
  { label:'Target Server',     icon:'server'           },
  { label:'Restore',           icon:'database-import'  },
];

const LOG_COLOR = { INFO:'var(--bv-txt2)', SUCCESS:'#69db7c', ERROR:'#ff6b6b', WARN:'#ffd43b' };

export default function RestoreDB() {
  // ── State ──────────────────────────────────────────────────
  const [step,         setStep]        = useState(0);
  const [dbs,          setDbs]         = useState([]);     // all backup targets
  const [selectedDB,   setSelectedDB]  = useState(null);  // chosen DB target
  const [tier,         setTier]        = useState(null);  // chosen tier
  const [dbSearch,     setDbSearch]    = useState('');
  const [files,        setFiles]       = useState([]);
  const [fileLoading,  setFileLoading] = useState(false);
  const [fileSearch,   setFileSearch]  = useState('');
  const [selectedFile, setSelectedFile]= useState(null);
  const [servers,      setServers]     = useState([]);    // db_servers for quick fill
  const [target, setTarget] = useState({
    host:'', port:3306, user:'root', password:'', db_name:'', create_db:true, drop_existing:false, db_engine:'mariadb'
  });
  const [restoreId,    setRestoreId]   = useState(null);
  const [logs,         setLogs]        = useState([]);
  const [logFilter,    setLogFilter]   = useState('ALL');
  const [status,       setStatus]      = useState('idle'); // idle|running|success|failed
  const [seen,         setSeen]        = useState(0);
  const pollRef        = useRef(null);
  const logEndRef      = useRef(null);
  const restoringRef   = useRef(false);

  // ── Load DB targets & servers ─────────────────────────────
  useEffect(() => {
    targetsAPI.list().then(list => setDbs(list || [])).catch(() => {});
    api('GET', '/db-servers').then(list => setServers(list || [])).catch(() => {});
  }, []);

  // Auto-scroll log
  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior:'smooth' });
  }, [logs]);

  // ── Load files for selected DB + tier ────────────────────
  const loadFiles = useCallback(async (tierKey, dbName) => {
    setFileLoading(true);
    setFiles([]);
    try {
      const list = await api('GET', `/restore/files?tier=${tierKey}&db=${encodeURIComponent(dbName || '')}`);
      setFiles(list || []);
    } catch(e) {
      toast(e.message, 'error');
    } finally {
      setFileLoading(false);
    }
  }, []);

  // ── Poll restore status ───────────────────────────────────
  const startPolling = useCallback((id) => {
    let seenCount = 0;
    pollRef.current = setInterval(async () => {
      try {
        const s = await api('GET', `/restore/status/${id}?seen=${seenCount}`);
        if (s.new_logs?.length) {
          setLogs(prev => [...prev, ...s.new_logs]);
          seenCount += s.new_logs.length;
          setSeen(seenCount);
        }
        if (s.status === 'success') {
          clearInterval(pollRef.current);
          setStatus('success');
        } else if (s.status === 'failed') {
          clearInterval(pollRef.current);
          setStatus('failed');
        }
      } catch {}
    }, 1500);
  }, []);

  useEffect(() => () => clearInterval(pollRef.current), []);

  // ── Step navigation ───────────────────────────────────────
  function goStep1(db) {
    setSelectedDB(db);
    setTarget(p => ({ ...p, db_name: db.db_name || db.name || '' }));
    setStep(1);
  }

  function goStep2(tierKey) {
    const t = TIERS.find(x => x.key === tierKey);
    setTier(t);
    setStep(2);
    loadFiles(tierKey, selectedDB?.db_name || selectedDB?.name);
  }

  function goStep3(file) {
    setSelectedFile(file);
    setStep(3);
  }

  async function startRestore() {
    if (!target.host || !target.db_name) {
      toast('Host and Database Name are required', 'error'); return;
    }
    if (restoringRef.current) return;
    restoringRef.current = true;
    setLogs([]);
    setSeen(0);
    setStatus('running');
    setStep(4);
    try {
      const res = await api('POST', '/restore/run', {
        tier:            tier.key,
        file_path:       selectedFile.path,
        file_key:        selectedFile.key,
        dest_id:         selectedFile.dest_id,
        encrypted:       selectedFile.encrypted,
        target_host:     target.host,
        target_port:     parseInt(target.port) || 3306,
        target_user:     target.user,
        target_password: target.password,
        target_db:       target.db_name,
        create_db:       target.create_db,
        drop_existing:   target.drop_existing,
        db_engine:       target.db_engine || 'mariadb',
      });
      setRestoreId(res.restore_id);
      startPolling(res.restore_id);
    } catch(e) {
      setStatus('failed');
      setLogs([{ level:'ERROR', message: e.message, time: new Date().toISOString() }]);
    }
  }

  function reset() {
    clearInterval(pollRef.current);
    restoringRef.current = false;
    setStep(0); setSelectedDB(null); setTier(null);
    setSelectedFile(null); setFiles([]);
    setLogs([]); setSeen(0); setStatus('idle'); setRestoreId(null);
    setDbSearch(''); setFileSearch('');
    setTarget({ host:'', port:3306, user:'root', password:'', db_name:'', create_db:true, drop_existing:false });
  }

  // ── Filtered lists ────────────────────────────────────────
  const filteredDbs   = dbs.filter(d => !dbSearch || d.name?.toLowerCase().includes(dbSearch.toLowerCase()) || d.db_name?.toLowerCase().includes(dbSearch.toLowerCase()));
  const filteredFiles = files.filter(f => !fileSearch || f.name?.toLowerCase().includes(fileSearch.toLowerCase()));
  const filteredLogs  = logs.filter(l => logFilter === 'ALL' || l.level === logFilter);

  // ── Styles ────────────────────────────────────────────────
  const S = {
    page:   { flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:'var(--bv-bg)' },
    header: { padding:'14px 22px 12px', borderBottom:'1px solid var(--bv-bd)', background:'var(--bv-bg2)', flexShrink:0 },
    body:   { flex:1, overflowY:'auto', padding:'20px 22px' },
    card:   { background:'var(--bv-card)', border:'1px solid var(--bv-bd)', borderRadius:10, overflow:'hidden', marginBottom:16 },
    th:     { display:'flex', alignItems:'center', gap:8, padding:'10px 14px', background:'var(--bv-bg3)', borderBottom:'1px solid var(--bv-bd)', fontSize:12, fontWeight:600, color:'var(--bv-txt2)' },
    row:    (even) => ({ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', borderBottom:'1px solid var(--bv-bd)', background: even ? 'var(--bv-bg3)' : 'var(--bv-card)', cursor:'pointer' }),
  };

  // ── Step indicator ────────────────────────────────────────
  const StepBar = () => (
    <div style={{ display:'flex', alignItems:'center', gap:0, marginTop:12 }}>
      {STEPS.map((s, i) => (
        <div key={i} style={{ display:'flex', alignItems:'center' }}>
          <div style={{
            display:'flex', alignItems:'center', gap:6, padding:'5px 14px',
            borderRadius:20, fontSize:12, fontWeight:500, cursor: i < step ? 'pointer' : 'default',
            background: step === i ? 'var(--bv-blue)' : i < step ? 'var(--bv-green-bg)' : 'var(--bv-bg3)',
            color:      step === i ? '#fff' : i < step ? 'var(--bv-green)' : 'var(--bv-txt3)',
            border:     '1px solid ' + (step === i ? 'var(--bv-blue)' : i < step ? 'var(--bv-green)' : 'var(--bv-bd)'),
          }} onClick={() => { if (i < step && step < 4) setStep(i); }}>
            {i < step
              ? <i className="ti ti-check" style={{ fontSize:11 }}/>
              : <span style={{ fontSize:11, fontWeight:700 }}>{i+1}</span>}
            <i className={'ti ti-' + s.icon} style={{ fontSize:12 }}/>
            {s.label}
          </div>
          {i < STEPS.length - 1 && (
            <div style={{ width:20, height:1, background:'var(--bv-bd)', margin:'0 2px' }}/>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div style={S.page}>

      {/* Header */}
      <div style={S.header}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize:20, fontWeight:500, color:'var(--bv-txt)', display:'flex', alignItems:'center', gap:9 }}>
              <i className="ti ti-database-import" style={{ color:'var(--bv-blue)', fontSize:22 }}/>
              Database Restore
            </div>
            <div style={{ fontSize:12, color:'var(--bv-txt2)', marginTop:2 }}>
              Restore any database from any backup tier to any target server
            </div>
          </div>
          {step > 0 && step < 4 && (
            <Btn variant="ghost" icon="refresh" onClick={reset}>New Restore</Btn>
          )}
        </div>
        <StepBar/>
      </div>

      <div style={S.body}>

        {/* ── STEP 0: SELECT DATABASE ── */}
        {step === 0 && (
          <div>
            <div style={{ fontSize:14, fontWeight:500, color:'var(--bv-txt)', marginBottom:12 }}>
              Select the database to restore:
            </div>
            <input value={dbSearch} onChange={e => setDbSearch(e.target.value)}
              placeholder="Search databases..."
              style={{ width:'100%', maxWidth:340, marginBottom:14, padding:'7px 12px',
                background:'var(--bv-input)', border:'1px solid var(--bv-bd2)',
                color:'var(--bv-txt)', borderRadius:8, fontSize:13 }}/>
            <div style={S.card}>
              <div style={{ ...S.th }}>
                <i className="ti ti-database" style={{ fontSize:14 }}/>
                <span>Database</span>
                <span style={{ marginLeft:'auto', color:'var(--bv-txt3)', fontWeight:400 }}>{filteredDbs.length} databases</span>
              </div>
              {filteredDbs.length === 0 && (
                <div style={{ textAlign:'center', padding:40, color:'var(--bv-txt3)' }}>
                  <i className="ti ti-database-off" style={{ fontSize:32, display:'block', marginBottom:8 }}/>
                  No databases found
                </div>
              )}
              {filteredDbs.map((db, i) => (
                <div key={db.id} style={S.row(i%2===1)}
                  onMouseEnter={e => e.currentTarget.style.background='var(--bv-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = i%2===1?'var(--bv-bg3)':'var(--bv-card)'}
                  onClick={() => goStep1(db)}>
                  <div style={{ width:34, height:34, borderRadius:8, flexShrink:0,
                    background: db.db_type==='postgresql'?'#1a2550':'#1e3a1e',
                    display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <i className="ti ti-database" style={{ fontSize:16, color: db.db_type==='postgresql'?'#7ca8f8':'#4ec94e' }}/>
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontWeight:500, color:'var(--bv-txt)' }}>{db.name}</div>
                    <div style={{ fontSize:11, color:'var(--bv-txt3)', fontFamily:'monospace' }}>
                      {db.db_name || db.name} · {db.host}:{db.port || 3306}
                      <span style={{ marginLeft:8, padding:'1px 6px', borderRadius:4,
                        background: db.db_type==='postgresql'?'var(--bv-blue-dim)':'var(--bv-green-bg)',
                        color: db.db_type==='postgresql'?'var(--bv-blue)':'var(--bv-green)',
                        fontSize:10, fontWeight:600 }}>
                        {(db.db_type||'mysql').toUpperCase()}
                      </span>
                    </div>
                  </div>
                  <i className="ti ti-chevron-right" style={{ fontSize:16, color:'var(--bv-txt3)' }}/>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── STEP 1: SELECT TIER ── */}
        {step === 1 && (
          <div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
              <div>
                <div style={{ fontSize:14, fontWeight:500, color:'var(--bv-txt)' }}>
                  Select backup source for:
                  <span style={{ marginLeft:8, color:'var(--bv-cyan)', fontFamily:'monospace' }}>
                    {selectedDB?.name}
                  </span>
                </div>
                <div style={{ fontSize:11, color:'var(--bv-txt3)', marginTop:2 }}>
                  {selectedDB?.db_name} · {selectedDB?.host}
                </div>
              </div>
              <Btn variant="ghost" size="sm" icon="arrow-left" onClick={() => setStep(0)}>Back</Btn>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:14 }}>
              {TIERS.map(t => (
                <div key={t.key} onClick={() => goStep2(t.key)}
                  style={{ padding:'18px 20px', background:t.bg, border:'2px solid ' + t.color + '44',
                    borderRadius:12, cursor:'pointer', transition:'all .15s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = t.color; e.currentTarget.style.transform='translateY(-2px)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = t.color+'44'; e.currentTarget.style.transform=''; }}>
                  <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:10 }}>
                    <div style={{ width:44, height:44, borderRadius:10, background:'rgba(255,255,255,0.08)',
                      display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <i className={'ti ti-' + t.icon} style={{ fontSize:22, color:t.color }}/>
                    </div>
                    <div>
                      <div style={{ fontSize:14, fontWeight:600, color:'#ffffff' }}>{t.label}</div>
                      {t.key === 'oci' && (
                        <span style={{ fontSize:10, padding:'1px 6px', borderRadius:5,
                          background:'var(--bv-green-bg)', color:'var(--bv-green)', fontWeight:600 }}>
                          🔐 AES-256 Encrypted
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize:11, color:'rgba(255,255,255,0.55)' }}>{t.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── STEP 2: SELECT FILE ── */}
        {step === 2 && (
          <div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
              <div>
                <div style={{ fontSize:14, fontWeight:500, color:'var(--bv-txt)' }}>
                  Select backup file from
                  <span style={{ marginLeft:6, color:tier?.color, fontWeight:600 }}>{tier?.label}</span>
                  <span style={{ marginLeft:8, color:'var(--bv-cyan)', fontFamily:'monospace' }}>
                    ({selectedDB?.name})
                  </span>
                </div>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <input value={fileSearch} onChange={e => setFileSearch(e.target.value)}
                  placeholder="Filter files..."
                  style={{ padding:'5px 10px', background:'var(--bv-input)', border:'1px solid var(--bv-bd2)',
                    color:'var(--bv-txt)', borderRadius:7, fontSize:12, width:200 }}/>
                <Btn variant="ghost" size="sm" icon="arrow-left" onClick={() => setStep(1)}>Back</Btn>
                <Btn variant="ghost" size="sm" icon="refresh"
                  onClick={() => loadFiles(tier.key, selectedDB?.db_name || selectedDB?.name)}>
                  Refresh
                </Btn>
              </div>
            </div>

            {fileLoading ? (
              <div style={{ display:'flex', justifyContent:'center', padding:60, gap:12, color:'var(--bv-txt3)' }}>
                <Spinner size={24}/> Loading backup files from {tier?.label}...
              </div>
            ) : filteredFiles.length === 0 ? (
              <div style={{ textAlign:'center', padding:60, color:'var(--bv-txt3)', background:'var(--bv-card)', borderRadius:10 }}>
                <i className="ti ti-file-off" style={{ fontSize:40, display:'block', marginBottom:12, color:'var(--bv-bd2)' }}/>
                <div style={{ fontSize:14, color:'var(--bv-txt2)', marginBottom:6 }}>No backup files found</div>
                <div style={{ fontSize:12 }}>
                  {fileSearch ? `No files matching "${fileSearch}"` : `No backups for ${selectedDB?.name} in ${tier?.label}`}
                </div>
              </div>
            ) : (
              <div style={S.card}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 100px 160px 130px',
                  padding:'8px 14px', background:'var(--bv-bg3)', borderBottom:'1px solid var(--bv-bd)',
                  fontSize:10, fontWeight:600, color:'var(--bv-txt3)', textTransform:'uppercase', letterSpacing:'.06em' }}>
                  <span>Filename</span><span>Size</span><span>Date</span><span>Action</span>
                </div>
                {filteredFiles.map((f, i) => (
                  <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr 100px 160px 130px',
                    padding:'10px 14px', borderBottom:'1px solid var(--bv-bd)', alignItems:'center',
                    background: i%2===1 ? 'var(--bv-bg3)' : 'var(--bv-card)' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, minWidth:0 }}>
                      <i className="ti ti-file-zip" style={{ color:'var(--bv-blue)', fontSize:16, flexShrink:0 }}/>
                      <div style={{ minWidth:0 }}>
                        <div style={{ fontSize:12, color:'var(--bv-txt)', fontFamily:'monospace',
                          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {f.name}
                        </div>
                        {f.encrypted && (
                          <span style={{ fontSize:10, padding:'1px 5px', borderRadius:4,
                            background:'var(--bv-green-bg)', color:'var(--bv-green)',
                            border:'1px solid var(--bv-green)', fontWeight:600 }}>
                            🔐 AES-256
                          </span>
                        )}
                      </div>
                    </div>
                    <span style={{ fontSize:12, color:'var(--bv-txt2)' }}>{fmtBytes(f.size)}</span>
                    <span style={{ fontSize:11, color:'var(--bv-txt3)' }}>{fmtDate(f.modified)}</span>
                    <Btn variant="primary" size="sm" icon="database-import"
                      onClick={() => goStep3(f)}>
                      Select
                    </Btn>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── STEP 3: TARGET SERVER ── */}
        {step === 3 && (
          <div style={{ maxWidth:580 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
              <div style={{ fontSize:14, fontWeight:500, color:'var(--bv-txt)' }}>Configure restore target:</div>
              <Btn variant="ghost" size="sm" icon="arrow-left" onClick={() => setStep(2)}>Back</Btn>
            </div>

            {/* Selected file summary */}
            <div style={{ padding:'10px 14px', background:'var(--bv-bg3)', border:'1px solid var(--bv-bd)',
              borderRadius:8, marginBottom:16, fontSize:12 }}>
              <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
                <span><b>DB:</b> <span style={{ color:'var(--bv-cyan)', fontFamily:'monospace' }}>{selectedDB?.name}</span></span>
                <span><b>Source:</b> <span style={{ color:tier?.color }}>{tier?.label}</span></span>
                <span><b>File:</b> <span style={{ fontFamily:'monospace', color:'var(--bv-txt)' }}>{selectedFile?.name}</span></span>
                <span><b>Size:</b> {fmtBytes(selectedFile?.size)}</span>
                {selectedFile?.encrypted && <span style={{ color:'var(--bv-green)', fontWeight:600 }}>🔐 Will decrypt automatically</span>}
              </div>
            </div>

            {/* Quick fill from existing servers */}
            {servers.length > 0 && (
              <Field label="Quick fill from existing server (optional)">
                <select onChange={e => {
                  const s = servers.find(x => String(x.id) === e.target.value);
                  if (s) setTarget(p => ({ ...p, host:s.host, port:s.port||3306, user:s.db_user||'root' }));
                }} style={{ width:'100%' }}>
                  <option value="">— Select a server to auto-fill host/port —</option>
                  {servers.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.host}:{s.port||3306})</option>
                  ))}
                </select>
              </Field>
            )}

            <div style={{ display:'grid', gridTemplateColumns:'1fr 130px', gap:'0 12px' }}>
              <Field label="Target Host / IP" required>
                <input value={target.host}
                  onChange={e => setTarget(p => ({...p, host:e.target.value}))}
                  placeholder="10.180.0.xxx or new-server-ip" style={{ width:'100%' }}/>
              </Field>
              <Field label="Port">
                <input type="number" value={target.port}
                  onChange={e => setTarget(p => ({...p, port:e.target.value}))}
                  style={{ width:'100%' }}/>
              </Field>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 12px' }}>
              <Field label="MySQL Username" required>
                <input value={target.user}
                  onChange={e => setTarget(p => ({...p, user:e.target.value}))}
                  placeholder="root" style={{ width:'100%' }}/>
              </Field>
              <Field label="MySQL Password">
                <input type="password" value={target.password}
                  onChange={e => setTarget(p => ({...p, password:e.target.value}))}
                  placeholder="(leave blank if no password)" style={{ width:'100%' }}/>
              </Field>
            </div>

            <Field label="Restore to Database Name" required
              hint="Will be created if it does not exist">
              <input value={target.db_name}
                onChange={e => setTarget(p => ({...p, db_name:e.target.value}))}
                placeholder={selectedDB?.db_name || 'database_name'}
                style={{ width:'100%', fontFamily:'monospace' }}/>
            </Field>

            <Field label="Target DB Engine" hint="Select what's running on the target server">
              <div style={{ display:'flex', gap:10 }}>
                {[
                  { key:'mysql',      label:'MySQL 8.0',    icon:'ti-brand-mysql',    color:'#00758f' },
                  { key:'mariadb',    label:'MariaDB',      icon:'ti-database',       color:'#c0765a' },
                  { key:'postgresql', label:'PostgreSQL',   icon:'ti-database',       color:'#336791' },
                ].map(e => (
                  <div key={e.key} onClick={() => setTarget(p => ({...p, db_engine:e.key}))}
                    style={{ flex:1, padding:'10px 14px', borderRadius:8, cursor:'pointer',
                      border: '2px solid ' + (target.db_engine===e.key ? e.color : 'var(--bv-bd)'),
                      background: target.db_engine===e.key ? e.color+'22' : 'var(--bv-bg3)',
                      display:'flex', alignItems:'center', gap:8, transition:'all .15s' }}>
                    <i className={'ti ' + e.icon} style={{ fontSize:18, color:e.color }}/>
                    <div>
                      <div style={{ fontSize:12, fontWeight:600, color:'var(--bv-txt)' }}>{e.label}</div>
                      {e.key==='mariadb' && (
                        <div style={{ fontSize:10, color:'var(--bv-txt3)' }}>Auto-patches MySQL 8.0 syntax</div>
                      )}
                      {e.key==='mysql' && (
                        <div style={{ fontSize:10, color:'var(--bv-txt3)' }}>Full compatibility</div>
                      )}
                      {e.key==='postgresql' && (
                        <div style={{ fontSize:10, color:'var(--bv-txt3)' }}>pg_restore format</div>
                      )}
                    </div>
                    {target.db_engine===e.key && (
                      <i className="ti ti-check" style={{ marginLeft:'auto', color:e.color, fontSize:14 }}/>
                    )}
                  </div>
                ))}
              </div>
            </Field>

            {/* Options */}
            <div style={{ display:'flex', gap:24, padding:'12px 14px', background:'var(--bv-bg3)',
              border:'1px solid var(--bv-bd)', borderRadius:8, marginBottom:16 }}>
              <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:12 }}>
                <input type="checkbox" checked={target.create_db}
                  onChange={e => setTarget(p => ({...p, create_db:e.target.checked}))}/>
                <span>Create DB if not exists</span>
              </label>
              <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:12 }}>
                <input type="checkbox" checked={target.drop_existing}
                  onChange={e => setTarget(p => ({...p, drop_existing:e.target.checked}))}/>
                <span style={{ color: target.drop_existing ? 'var(--bv-red)' : 'inherit' }}>
                  Drop existing tables first
                </span>
              </label>
            </div>

            {/* DR warning */}
            <div style={{ padding:'10px 14px', background:'var(--bv-amber-bg)', border:'1px solid var(--bv-amber)',
              borderRadius:8, fontSize:11, color:'var(--bv-amber)', marginBottom:16 }}>
              <i className="ti ti-alert-triangle" style={{ marginRight:6 }}/>
              <b>DR Mode:</b> Restoring to a different server. Ensure the target DB engine is running and credentials are correct.
              {target.db_engine === 'mariadb' && (
                <span style={{ display:'block', marginTop:4, color:'var(--bv-cyan)' }}>
                  <i className="ti ti-info-circle" style={{ marginRight:4 }}/>
                  MariaDB mode: MySQL 8.0 collations and syntax will be auto-patched during restore.
                </span>
              )}
            </div>

            <Btn variant="primary" icon="database-import" size="lg"
              disabled={!target.host || !target.db_name}
              onClick={startRestore}>
              Start Restore
            </Btn>
          </div>
        )}

        {/* ── STEP 4: RESTORE LOG ── */}
        {step === 4 && (
          <div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
              <div style={{ display:'flex', alignItems:'center', gap:10, fontSize:15, fontWeight:500 }}>
                {status === 'running'  && <><Spinner size={18}/> <span style={{ color:'var(--bv-blue)' }}>Restoring...</span></>}
                {status === 'success'  && <><i className="ti ti-circle-check" style={{ fontSize:20, color:'var(--bv-green)' }}/><span style={{ color:'var(--bv-green)' }}>Restore Complete</span></>}
                {status === 'failed'   && <><i className="ti ti-circle-x" style={{ fontSize:20, color:'var(--bv-red)' }}/><span style={{ color:'var(--bv-red)' }}>Restore Failed</span></>}
              </div>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                {/* Log filter */}
                {['ALL','INFO','SUCCESS','WARN','ERROR'].map(f => (
                  <button key={f} onClick={() => setLogFilter(f)}
                    style={{ padding:'3px 10px', borderRadius:12, border:'1px solid var(--bv-bd)',
                      background: logFilter===f ? 'var(--bv-blue)' : 'var(--bv-bg3)',
                      color: logFilter===f ? '#fff' : 'var(--bv-txt3)',
                      cursor:'pointer', fontSize:11, fontWeight:600 }}>
                    {f}
                  </button>
                ))}
                {status !== 'running' && (
                  <Btn variant="ghost" size="sm" onClick={reset}>New Restore</Btn>
                )}
              </div>
            </div>

            {/* Terminal log */}
            <div style={{ background:'#0d1117', borderRadius:10, border:'1px solid var(--bv-bd)',
              padding:'12px 16px', fontFamily:'monospace', fontSize:12, lineHeight:1.8,
              minHeight:320, maxHeight:480, overflowY:'auto' }}>
              {filteredLogs.length === 0 && status === 'running' && (
                <div style={{ color:'#555' }}>Waiting for restore to start...</div>
              )}
              {filteredLogs.map((l, i) => (
                <div key={i} style={{ display:'flex', gap:12 }}>
                  <span style={{ color:'#555', flexShrink:0, fontSize:11 }}>
                    {new Date(l.time).toLocaleTimeString('en-IN')}
                  </span>
                  <span style={{ color: LOG_COLOR[l.level] || LOG_COLOR.INFO, fontWeight: l.level==='SUCCESS'||l.level==='ERROR' ? 600 : 400, flexShrink:0 }}>
                    [{l.level}]
                  </span>
                  <span style={{ color: l.level==='SUCCESS'?'#69db7c':l.level==='ERROR'?'#ff6b6b':l.level==='WARN'?'#ffd43b':'#c9d1d9', wordBreak:'break-all' }}>
                    {l.message}
                  </span>
                </div>
              ))}
              {status === 'running' && (
                <div style={{ color:'#555', marginTop:8, display:'flex', alignItems:'center', gap:8 }}>
                  <Spinner size={12}/> Processing...
                </div>
              )}
              <div ref={logEndRef}/>
            </div>

            {/* Success result */}
            {status === 'success' && (
              <div style={{ marginTop:14, padding:'14px 16px', background:'var(--bv-green-bg)',
                border:'1px solid var(--bv-green)', borderRadius:8 }}>
                <div style={{ fontSize:14, fontWeight:600, color:'var(--bv-green)', marginBottom:6 }}>
                  <i className="ti ti-circle-check" style={{ marginRight:8 }}/>
                  Database restored successfully
                </div>
                <div style={{ fontSize:12, color:'var(--bv-txt2)', fontFamily:'monospace' }}>
                  <b>Database:</b> {target.db_name} &nbsp;·&nbsp;
                  <b>Server:</b> {target.host}:{target.port} &nbsp;·&nbsp;
                  <b>Source:</b> {tier?.label} → {selectedFile?.name}
                </div>
              </div>
            )}

            {/* Failed result */}
            {status === 'failed' && (
              <div style={{ marginTop:14, padding:'14px 16px', background:'var(--bv-red-bg)',
                border:'1px solid var(--bv-red)', borderRadius:8 }}>
                <div style={{ fontSize:13, fontWeight:600, color:'var(--bv-red)', marginBottom:4 }}>
                  <i className="ti ti-circle-x" style={{ marginRight:8 }}/>
                  Restore failed — check log above for details
                </div>
                <div style={{ fontSize:12, color:'var(--bv-txt3)' }}>
                  Common causes: MySQL not running on target, wrong credentials, insufficient disk space, corrupt backup file
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
