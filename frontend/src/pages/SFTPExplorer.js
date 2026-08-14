// src/pages/SFTPExplorer.js
import { useState, useEffect, useCallback } from 'react';
import { destinationsAPI } from '../services/api';
import { Btn, Badge, Spinner, toast } from '../components/UI';
import { format } from 'date-fns';

const BASE = '/api';
const tok  = () => localStorage.getItem('bv_token');

function fmtBytes(b) {
  if (!b || b <= 0) return '—';
  const u = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return (b / Math.pow(1024,i)).toFixed(1) + ' ' + u[i];
}

function FileIcon({ item }) {
  if (item.type === 'directory') return <i className="ti ti-folder" style={{ fontSize:16, color:'var(--bv-amber)' }}/>;
  const name = (item.name||'').toLowerCase();
  if (name.endsWith('.gz') || name.endsWith('.sql') || name.endsWith('.rdb') || name.endsWith('.dump'))
    return <i className="ti ti-file-zip" style={{ fontSize:16, color:'var(--bv-cyan)' }}/>;
  return <i className="ti ti-file" style={{ fontSize:16, color:'var(--bv-txt2)' }}/>;
}

export default function SFTPExplorer() {
  const [dests,       setDests]       = useState([]);
  const [selDest,     setSelDest]     = useState(null);
  const [path,        setPath]        = useState('/');
  const [history,     setHistory]     = useState([]);
  const [items,       setItems]       = useState([]);
  const [diskStats,   setDiskStats]   = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [errorCode,   setErrorCode]   = useState(null);
  const [filter,      setFilter]      = useState('');
  const [selFile,     setSelFile]     = useState(null);
  const [downloading, setDownloading] = useState(null);

  // Load SFTP destinations
  useEffect(() => {
    destinationsAPI.list().then(all => {
      const remote = all.filter(d => d.dest_type === 'remote_sftp');
      setDests(remote);
      if (remote.length > 0) {
        const active = remote.find(d => d.is_active) || remote[0];
        setSelDest(active);
        // Start from root so user can navigate to actual backup path
        const cfg = typeof active.config === 'string' ? JSON.parse(active.config) : active.config;
        setPath(cfg.path || '/');
      }
    }).catch(console.error);
  }, []);

  const browse = useCallback(async (destId, browsePath) => {
    setLoading(true); setError(null); setErrorCode(null); setSelFile(null);
    try {
      const res = await fetch(
        `${BASE}/sftp/${destId}/list?path=${encodeURIComponent(browsePath)}`,
        { headers: { Authorization: `Bearer ${tok()}` } }
      );
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || `HTTP ${res.status}`);
        setErrorCode(json.code || null);
        setItems([]);
        return;
      }
      setItems(json.items || []);
      setDiskStats(json.diskStats || null);
      setPath(browsePath);
    } catch (e) {
      setError(e.message);
      setItems([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (selDest) {
      const cfg = typeof selDest.config === 'string' ? JSON.parse(selDest.config) : selDest.config;
      const startPath = cfg.path || '/';
      browse(selDest.id, startPath);
    }
  }, [selDest, browse]);

  function navigateTo(newPath) {
    setHistory(h => [...h, path]);
    browse(selDest.id, newPath);
  }

  function handleItem(item) {
    if (item.type === 'directory') {
      navigateTo(item.path);
    } else {
      setSelFile(item);
    }
  }

  function goBack() {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory(h => h.slice(0,-1));
    browse(selDest.id, prev);
  }

  function goHome() {
    const cfg = typeof selDest.config === 'string' ? JSON.parse(selDest.config) : selDest.config;
    const root = cfg.path || '/';
    setHistory([]);
    browse(selDest.id, root);
  }

  function navigateBreadcrumb(segments, idx) {
    const target = '/' + segments.slice(0, idx + 1).join('/');
    setHistory(h => h.slice(0, idx));
    browse(selDest.id, target);
  }

  async function handleDownload(item) {
    setDownloading(item.path);
    try {
      const url = `${BASE}/sftp/${selDest.id}/download?path=${encodeURIComponent(item.path)}&token=${tok()}`;
      const a = document.createElement('a');
      a.href = url; a.download = item.name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
      toast(`Downloading ${item.name}`);
    } catch (e) { toast(e.message, 'error'); }
    finally { setTimeout(() => setDownloading(null), 3000); }
  }

  const visible = items.filter(i => !filter || i.name.toLowerCase().includes(filter.toLowerCase()));
  const breadcrumbs = path.split('/').filter(Boolean);
  const cfg = selDest ? (typeof selDest.config === 'string' ? JSON.parse(selDest.config) : selDest.config) : {};
  const pct = diskStats ? parseInt(diskStats.usePercent) : 0;
  const barColor = pct >= 90 ? 'var(--bv-red)' : pct >= 80 ? 'var(--bv-amber)' : 'var(--bv-green)';

  // ── NO DESTINATION CONFIGURED ──────────────────────────────
  if (dests.length === 0) {
    return (
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <Header cfg={{}} dests={[]} selDest={null} setSelDest={setSelDest} onRefresh={null}/>
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:12, color:'var(--bv-txt3)' }}>
          <i className="ti ti-server-off" style={{ fontSize:52, color:'var(--bv-bd2)' }}/>
          <div style={{ fontSize:16, fontWeight:500, color:'var(--bv-txt2)' }}>No remote destinations configured</div>
          <div style={{ fontSize:13 }}>Go to <a href="/destinations" style={{ color:'var(--bv-blue)' }}>Destinations</a> → Add Remote Onsite DR → enter SSH credentials → Save</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <Header cfg={cfg} dests={dests} selDest={selDest} setSelDest={setSelDest}
        onRefresh={() => selDest && browse(selDest.id, path)}/>

      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>

        {/* Main panel */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

          {/* Toolbar */}
          <div style={{ padding:'9px 16px', borderBottom:'1px solid var(--bv-bd)', background:'var(--bv-bg2)',
            display:'flex', alignItems:'center', gap:10, flexShrink:0, flexWrap:'wrap' }}>

            <button onClick={goBack} disabled={history.length===0} title="Go back"
              style={{ background:'none', border:'1px solid var(--bv-bd2)', color: history.length?'var(--bv-blue)':'var(--bv-bd2)',
                borderRadius:6, padding:'4px 8px', cursor: history.length?'pointer':'not-allowed', fontSize:13 }}>
              <i className="ti ti-arrow-left"/>
            </button>
            <button onClick={goHome} title="Go to backup root"
              style={{ background:'none', border:'none', color:'var(--bv-blue)', cursor:'pointer', fontSize:15, padding:'2px 4px' }}>
              <i className="ti ti-home"/>
            </button>

            {/* Breadcrumb */}
            <div style={{ display:'flex', alignItems:'center', gap:3, flex:1, flexWrap:'wrap' }}>
              {breadcrumbs.map((seg, i) => (
                <span key={i} style={{ display:'flex', alignItems:'center', gap:3 }}>
                  <span style={{ color:'var(--bv-bd2)', fontSize:12 }}>/</span>
                  <button onClick={() => navigateBreadcrumb(breadcrumbs, i)} style={{
                    background:'none', border:'none', cursor:'pointer', fontSize:12, padding:'2px 5px',
                    color: i===breadcrumbs.length-1 ? 'var(--bv-txt)' : 'var(--bv-blue)',
                    fontFamily:'monospace', borderRadius:4,
                    fontWeight: i===breadcrumbs.length-1 ? 500 : 400,
                  }}>{seg}</button>
                </span>
              ))}
            </div>

            <input value={filter} onChange={e=>setFilter(e.target.value)}
              placeholder="Filter files..."
              style={{ fontSize:12, padding:'5px 10px', background:'var(--bv-bg4)',
                border:'1px solid var(--bv-bd2)', color:'var(--bv-txt)', borderRadius:8, width:180 }}/>
          </div>

          {/* Disk stats */}
          {diskStats && (
            <div style={{ padding:'7px 16px', background:'var(--bv-bg)', borderBottom:'1px solid var(--bv-bg4)',
              display:'flex', alignItems:'center', gap:14, flexShrink:0 }}>
              <span style={{ fontSize:11, color:'var(--bv-txt2)', whiteSpace:'nowrap' }}>
                <i className="ti ti-server-2" style={{ marginRight:5, color:'var(--bv-cyan)' }}/>{cfg.host}
              </span>
              <div style={{ flex:1, display:'flex', alignItems:'center', gap:8 }}>
                <div style={{ flex:1, height:5, background:'var(--bv-bg4)', borderRadius:3, overflow:'hidden' }}>
                  <div style={{ height:'100%', width:diskStats.usePercent, background:barColor, borderRadius:3 }}/>
                </div>
                <span style={{ fontSize:11, color:barColor, fontWeight:600, whiteSpace:'nowrap' }}>{diskStats.usePercent} used</span>
                <span style={{ fontSize:11, color:'var(--bv-txt3)', whiteSpace:'nowrap' }}>{diskStats.used}/{diskStats.size} · {diskStats.avail} free</span>
              </div>
            </div>
          )}

          {/* Error state */}
          {error && (
            <div style={{ margin:16, padding:'14px 16px', background:'var(--bv-red-dim)',
              border:'1px solid var(--bv-red)', borderRadius:10, color:'var(--bv-red)', fontSize:13 }}>
              <i className="ti ti-alert-triangle" style={{ marginRight:8 }}/>
              {error}
              {errorCode === 'SSHPASS_MISSING' && (
                <div style={{ marginTop:8, fontFamily:'monospace', fontSize:11, color:'var(--bv-amber)',
                  background:'var(--bv-amber-dim)', padding:'6px 10px', borderRadius:6 }}>
                  Fix on server: <strong>apt-get install -y sshpass</strong><br/>
                  Then: <strong>pm2 restart backupvault</strong>
                </div>
              )}
              {errorCode === 'AUTH_FAILED' && (
                <div style={{ marginTop:8, fontSize:11, color:'var(--bv-amber)' }}>
                  SSH credentials rejected. Go to <a href="/destinations" style={{ color:'var(--bv-blue)' }}>Destinations</a> → edit Remote Onsite → update password.
                </div>
              )}
              {errorCode === 'UNREACHABLE' && (
                <div style={{ marginTop:8, fontSize:11, color:'var(--bv-amber)' }}>
                  Cannot reach {cfg.host}. Check server is online and port {cfg.port||22} is accessible.
                </div>
              )}
              {!errorCode && error.includes('404') && (
                <div style={{ marginTop:8, fontSize:11, color:'var(--bv-amber)' }}>
                  SFTP route not registered in backend. Add to <code style={{ fontFamily:'monospace' }}>server.js</code>:<br/>
                  <code style={{ fontFamily:'monospace', background:'var(--bv-amber-dim)', padding:'4px 8px', borderRadius:4, display:'inline-block', marginTop:4 }}>
                    app.use('/api/sftp', require('./routes/sftp'));
                  </code>
                </div>
              )}
            </div>
          )}

          {/* File table */}
          <div style={{ flex:1, overflowY:'auto' }}>
            {loading ? (
              <div style={{ display:'flex', justifyContent:'center', alignItems:'center', padding:60, gap:12, color:'var(--bv-txt3)' }}>
                <Spinner size={28}/> Connecting to {cfg.host}...
              </div>
            ) : !error && (
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead style={{ position:'sticky', top:0, background:'var(--bv-bg2)', zIndex:1 }}>
                  <tr>
                    {['Name','Size','Modified','Type',''].map(h=>(
                      <th key={h} style={{ textAlign:'left', fontSize:10, fontWeight:600, color:'var(--bv-txt3)',
                        letterSpacing:'.07em', textTransform:'uppercase', padding:'8px 14px',
                        borderBottom:'1px solid var(--bv-bd)', whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign:'center', padding:48, color:'var(--bv-txt3)', fontSize:13 }}>
                      {filter ? `No files matching "${filter}"` : 'Empty directory'}
                    </td></tr>
                  ) : visible.map(item => {
                    const isSel = selFile?.path === item.path;
                    return (
                      <tr key={item.path} onClick={() => handleItem(item)}
                        style={{ cursor:'pointer', background: isSel?'var(--bv-blue-dim)':'' }}
                        onMouseEnter={e=>{ if(!isSel) e.currentTarget.style.background='var(--bv-bg3)'; }}
                        onMouseLeave={e=>{ if(!isSel) e.currentTarget.style.background=''; }}>
                        <td style={{ padding:'9px 14px', borderBottom:'1px solid var(--bv-bg4)' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:9 }}>
                            <FileIcon item={item}/>
                            <span style={{ fontSize:12, fontFamily: item.type==='file'?'monospace':'inherit',
                              color: item.type==='directory'?'var(--bv-amber)':'var(--bv-txt)' }}>
                              {item.name}
                            </span>
                          </div>
                        </td>
                        <td style={{ padding:'9px 14px', borderBottom:'1px solid var(--bv-bg4)',
                          fontSize:12, color:'var(--bv-txt3)', whiteSpace:'nowrap' }}>
                          {item.type==='directory' ? '—' : fmtBytes(item.size)}
                        </td>
                        <td style={{ padding:'9px 14px', borderBottom:'1px solid var(--bv-bg4)',
                          fontSize:11, color:'var(--bv-txt3)', whiteSpace:'nowrap' }}>
                          {item.modified || '—'}
                        </td>
                        <td style={{ padding:'9px 14px', borderBottom:'1px solid var(--bv-bg4)' }}>
                          {item.type==='directory'
                            ? <Badge type="default" small>DIR</Badge>
                            : <Badge type="info" small>FILE</Badge>}
                        </td>
                        <td style={{ padding:'9px 14px', borderBottom:'1px solid var(--bv-bg4)' }}>
                          {item.type==='file' && (
                            <button onClick={e=>{ e.stopPropagation(); handleDownload(item); }}
                              disabled={downloading===item.path}
                              style={{ background:'none', border:'1px solid var(--bv-bd2)', color:'var(--bv-blue)',
                                borderRadius:6, padding:'3px 10px', fontSize:11, cursor:'pointer',
                                display:'flex', alignItems:'center', gap:4 }}>
                              <i className={`ti ${downloading===item.path?'ti-loader':'ti-download'}`} style={{ fontSize:12 }}/>
                              {downloading===item.path ? 'Downloading...' : 'Download'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Status bar */}
          <div style={{ padding:'5px 14px', borderTop:'1px solid var(--bv-bd)', background:'var(--bv-bg)',
            display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--bv-txt3)', flexShrink:0 }}>
            <span>{visible.length} items{filter ? ` (filtered from ${items.length})` : ''}</span>
            <span>{items.filter(i=>i.type==='file').length} files · {items.filter(i=>i.type==='directory').length} dirs</span>
          </div>
        </div>

        {/* File detail sidebar */}
        {selFile && (
          <div style={{ width:250, flexShrink:0, borderLeft:'1px solid var(--bv-bd)', background:'var(--bv-bg)',
            display:'flex', flexDirection:'column' }}>
            <div style={{ padding:'12px 14px', borderBottom:'1px solid var(--bv-bd)',
              display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:12, fontWeight:500, color:'var(--bv-txt)' }}>File info</span>
              <button onClick={()=>setSelFile(null)} style={{ background:'none', border:'none',
                color:'var(--bv-txt3)', fontSize:18, cursor:'pointer', lineHeight:1 }}>×</button>
            </div>
            <div style={{ padding:14, flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:12 }}>
              <div style={{ padding:'10px 12px', background:'var(--bv-bg2)', border:'1px solid var(--bv-bd)',
                borderRadius:8, textAlign:'center' }}>
                <i className="ti ti-file-zip" style={{ fontSize:34, color:'var(--bv-cyan)', display:'block', marginBottom:8 }}/>
                <div style={{ fontSize:11, fontFamily:'monospace', color:'var(--bv-txt)', wordBreak:'break-all' }}>
                  {selFile.name}
                </div>
              </div>
              {[
                ['Size',     fmtBytes(selFile.size)],
                ['Modified', selFile.modified||'—'],
                ['Type',     (selFile.ext||'file').toUpperCase()],
                ['Path',     selFile.path],
              ].map(([k,v])=>(
                <div key={k}>
                  <div style={{ fontSize:10, color:'var(--bv-txt3)', letterSpacing:'.06em',
                    textTransform:'uppercase', marginBottom:3 }}>{k}</div>
                  <div style={{ fontSize:11, color:'var(--bv-txt2)',
                    fontFamily: k==='Path'?'monospace':'inherit', wordBreak:'break-all' }}>{v}</div>
                </div>
              ))}
              <button onClick={()=>handleDownload(selFile)}
                disabled={downloading===selFile.path}
                style={{ width:'100%', padding:'8px', background:'var(--bv-accent)', color:'#fff',
                  border:'none', borderRadius:8, fontSize:13, cursor:'pointer', fontWeight:500,
                  display:'flex', alignItems:'center', justifyContent:'center', gap:6, marginTop:'auto' }}>
                <i className="ti ti-download" style={{ fontSize:15 }}/>
                Download file
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── PAGE HEADER COMPONENT ─────────────────────────────────────
function Header({ cfg, dests, selDest, setSelDest, onRefresh }) {
  return (
    <div style={{ padding:'18px 24px 14px', borderBottom:'1px solid var(--bv-bd)', background:'var(--bv-bg2)',
      display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexShrink:0 }}>
      <div>
        <div style={{ fontSize:20, fontWeight:500, color:'var(--bv-txt)' }}>Remote File Explorer</div>
        <div style={{ fontSize:12, color:'var(--bv-txt2)', marginTop:3 }}>
          Browse backup files on Remote Onsite DR server via SFTP
          {cfg.host && <> · <span style={{ color:'var(--bv-cyan)', fontFamily:'monospace' }}>{cfg.host}</span></>}
          {cfg.path && <> · root: <span style={{ color:'var(--bv-green)', fontFamily:'monospace' }}>{cfg.path}</span></>}
        </div>
      </div>
      <div style={{ display:'flex', gap:8 }}>
        {dests.length > 1 && (
          <select value={selDest?.id||''} onChange={e=>{
            const d = dests.find(x=>String(x.id)===e.target.value);
            if(d) setSelDest(d);
          }} style={{ background:'var(--bv-bg4)', border:'1px solid var(--bv-bd2)', color:'var(--bv-txt)',
            borderRadius:8, padding:'6px 10px', fontSize:12 }}>
            {dests.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        {onRefresh && (
          <button onClick={onRefresh} style={{ display:'flex', alignItems:'center', gap:5,
            padding:'6px 13px', borderRadius:8, border:'1px solid var(--bv-bd2)',
            background:'var(--bv-bg4)', color:'var(--bv-txt)', fontSize:12, cursor:'pointer' }}>
            <i className="ti ti-refresh"/> Refresh
          </button>
        )}
      </div>
    </div>
  );
}
