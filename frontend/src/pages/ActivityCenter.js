// frontend/src/pages/ActivityCenter.js
// Backup execution activity, relief script events, log viewer with actions

import { useState, useEffect, useCallback, useRef } from 'react';
import { Spinner, Btn, Badge, toast } from '../components/UI';

const r = (method, path, body) => {
  const token = localStorage.getItem('bv_token');
  return fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async res => {
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
    return d;
  });
};

// ── META MAPS ─────────────────────────────────────────────────────────────────
const EVENT_META = {
  backup_run:       { icon:'database',      label:'Backup Run',       color:'var(--bv-blue)'   },
  relief_start:     { icon:'player-play',   label:'Relief Started',   color:'var(--bv-amber)'  },
  relief_complete:  { icon:'circle-check',  label:'Relief Complete',  color:'var(--bv-green)'  },
  relief_failed:    { icon:'alert-triangle',label:'Relief Failed',    color:'var(--bv-red)'    },
  ssh_transfer:     { icon:'transfer',      label:'SSH Transfer',     color:'var(--bv-cyan)'   },
  delete_source:    { icon:'trash',         label:'Source Deleted',   color:'var(--bv-red)'    },
  verify_failed:    { icon:'shield-x',      label:'Verify Failed',    color:'var(--bv-red)'    },
  storage_alert:    { icon:'bell',          label:'Storage Alert',    color:'var(--bv-amber)'  },
  storage_event:    { icon:'server-2',      label:'Storage Event',    color:'var(--bv-txt2)'   },
  error:            { icon:'alert-circle',  label:'Error',            color:'var(--bv-red)'    },
};

const STATUS_META = {
  success: { bg:'var(--bv-green-bg)', color:'var(--bv-green)', label:'Success' },
  error:   { bg:'var(--bv-red-bg)',   color:'var(--bv-red)',   label:'Error'   },
  warning: { bg:'var(--bv-amber-bg)', color:'var(--bv-amber)', label:'Warning' },
  running: { bg:'var(--bv-blue-dim)', color:'var(--bv-blue)',  label:'Running' },
  info:    { bg:'var(--bv-bg4)',      color:'var(--bv-txt3)',  label:'Info'    },
};

function fmtBytes(b) {
  if (!b || b===0) return '0 B';
  const u=['B','KB','MB','GB','TB'];
  const i=Math.floor(Math.log(Math.max(b,1))/Math.log(1024));
  return (b/Math.pow(1024,i)).toFixed(1)+' '+u[i];
}

function fmtDuration(s) {
  if (!s) return '—';
  if (s < 60) return `${s}s`;
  return `${Math.floor(s/60)}m ${s%60}s`;
}

function fmtTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-IN',{
    day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'
  });
}

function fmtTimeAgo(ts) {
  if (!ts) return '';
  const secs = Math.floor((Date.now()-new Date(ts))/1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs/60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs/3600)}h ago`;
  return `${Math.floor(secs/86400)}d ago`;
}

// ── STATUS BADGE ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.info;
  return (
    <span style={{ fontSize:10, padding:'2px 8px', borderRadius:10,
      fontWeight:600, background:m.bg, color:m.color, flexShrink:0,
      display:'inline-flex', alignItems:'center', gap:4 }}>
      {status==='running' && <i className="ti ti-loader"
        style={{ animation:'bvspin .7s linear infinite', fontSize:10 }}/>}
      {m.label}
    </span>
  );
}

// ── LOG VIEWER MODAL ──────────────────────────────────────────────────────────
function LogModal({ runId, onClose }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef();

  useEffect(() => {
    r('GET', `/activity/run/${runId}/logs`)
      .then(setData).catch(e => toast(e.message,'error'))
      .finally(() => setLoading(false));
  }, [runId]);

  useEffect(() => {
    if (data) bottomRef.current?.scrollIntoView({ behavior:'smooth' });
  }, [data]);

  const run = data?.run;

  const LOG_COLORS = {
    INFO:    'var(--bv-txt2)',
    SUCCESS: 'var(--bv-green)',
    WARN:    'var(--bv-amber)',
    ERROR:   'var(--bv-red)',
    DEBUG:   'var(--bv-txt3)',
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)',
      zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center',
      padding:24 }} onClick={onClose}>
      <div style={{ width:'100%', maxWidth:800, maxHeight:'85vh',
        background:'var(--bv-bg2)', border:'1px solid var(--bv-bd)',
        borderRadius:12, display:'flex', flexDirection:'column',
        boxShadow:'0 8px 40px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--bv-bd)',
          display:'flex', alignItems:'center', justifyContent:'space-between',
          flexShrink:0 }}>
          <div>
            <div style={{ fontSize:14, fontWeight:600, color:'var(--bv-txt)',
              display:'flex', alignItems:'center', gap:8 }}>
              <i className="ti ti-terminal-2" style={{ color:'var(--bv-blue)' }}/>
              Backup Execution Logs
              {run && <span style={{ fontSize:11, color:'var(--bv-txt3)',
                fontFamily:'monospace' }}>Run #{runId}</span>}
            </div>
            {run && (
              <div style={{ fontSize:11, color:'var(--bv-txt2)', marginTop:3,
                display:'flex', gap:14, flexWrap:'wrap' }}>
                <span>Target: <strong style={{ color:'var(--bv-txt)' }}>{run.target_name}</strong></span>
                <span>Type: <strong>{run.db_type?.toUpperCase()} {run.backup_type}</strong></span>
                <span>Status: <StatusBadge status={run.status}/></span>
                {run.file_size_bytes > 0 &&
                  <span>Size: <strong style={{ color:'var(--bv-cyan)' }}>{fmtBytes(run.file_size_bytes)}</strong></span>}
                {run.started_at &&
                  <span>Started: {fmtTime(run.started_at)}</span>}
                {run.completed_at && run.started_at &&
                  <span>Duration: {fmtDuration(Math.round((new Date(run.completed_at)-new Date(run.started_at))/1000))}</span>}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none',
            color:'var(--bv-txt3)', fontSize:20, cursor:'pointer', lineHeight:1 }}>×</button>
        </div>

        {/* Log output */}
        <div style={{ flex:1, overflow:'auto', padding:'12px 14px',
          background:'#0d1117', fontFamily:'monospace', fontSize:12,
          lineHeight:1.7 }}>
          {loading ? (
            <div style={{ display:'flex', justifyContent:'center', padding:40 }}>
              <Spinner size={24}/>
            </div>
          ) : data?.logs?.length === 0 ? (
            <div style={{ color:'var(--bv-txt3)', textAlign:'center', padding:40 }}>
              No logs found for this run
            </div>
          ) : data?.logs?.map((log, i) => (
            <div key={i} style={{ display:'flex', gap:14, marginBottom:2 }}>
              <span style={{ color:'#555', whiteSpace:'nowrap', flexShrink:0, fontSize:11 }}>
                {new Date(log.created_at).toLocaleTimeString('en-IN',{
                  hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
                })}
              </span>
              <span style={{ color: LOG_COLORS[log.log_level] || LOG_COLORS.INFO,
                fontWeight: log.log_level==='ERROR'||log.log_level==='SUCCESS' ? 600 : 400 }}>
                [{log.log_level}]
              </span>
              <span style={{ color: log.log_level==='ERROR'?'#ff6b6b':
                log.log_level==='SUCCESS'?'#69db7c':
                log.log_level==='WARN'?'#ffd43b':'#c9d1d9',
                wordBreak:'break-word' }}>
                {log.message}
              </span>
            </div>
          ))}
          <div ref={bottomRef}/>
        </div>

        {/* Footer actions */}
        <div style={{ padding:'10px 16px', borderTop:'1px solid var(--bv-bd)',
          display:'flex', justifyContent:'space-between', alignItems:'center',
          flexShrink:0 }}>
          <span style={{ fontSize:11, color:'var(--bv-txt3)' }}>
            {data?.logs?.length || 0} log entries
          </span>
          <div style={{ display:'flex', gap:8 }}>
            <Btn variant="ghost" size="sm" icon="download" onClick={() => {
              const text = data?.logs?.map(l =>
                `${new Date(l.created_at).toISOString()} [${l.log_level}] ${l.message}`
              ).join('\n') || '';
              const blob = new Blob([text], { type:'text/plain' });
              const url  = URL.createObjectURL(blob);
              const a    = document.createElement('a');
              a.href = url; a.download = `backup-run-${runId}.log`;
              a.style.display='none'; document.body.appendChild(a);
              a.click();
              setTimeout(()=>{ URL.revokeObjectURL(url); document.body.removeChild(a); },2000);
            }}>Download Log</Btn>
            <Btn variant="ghost" size="sm" onClick={onClose}>Close</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ACTIVITY EVENT ROW ────────────────────────────────────────────────────────
function EventRow({ ev, onViewLog }) {
  const [expanded, setExpanded] = useState(false);
  const meta = EVENT_META[ev.event_type] || EVENT_META.storage_event;
  const det  = ev.detail;

  return (
    <div style={{ borderBottom:'1px solid var(--bv-bd)' }}>
      {/* Main row */}
      <div style={{ display:'flex', alignItems:'center', gap:12,
        padding:'10px 16px', cursor:'pointer',
        background: expanded ? 'var(--bv-hover)' : 'var(--bv-card)' }}
        onClick={() => setExpanded(e => !e)}
        onMouseEnter={e => { if(!expanded) e.currentTarget.style.background='var(--bv-hover)'; }}
        onMouseLeave={e => { if(!expanded) e.currentTarget.style.background='var(--bv-card)'; }}>

        {/* Event type icon */}
        <div style={{ width:34, height:34, borderRadius:9, flexShrink:0,
          background:'var(--bv-bg3)', display:'flex', alignItems:'center',
          justifyContent:'center' }}>
          <i className={`ti ti-${meta.icon}`} style={{ fontSize:16, color:meta.color }}/>
        </div>

        {/* Message */}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <span style={{ fontSize:12, fontWeight:500, color:'var(--bv-txt)' }}>
              {ev.message}
            </span>
            <StatusBadge status={ev.status}/>
          </div>
          <div style={{ fontSize:11, color:'var(--bv-txt3)', marginTop:2,
            display:'flex', gap:12, flexWrap:'wrap' }}>
            <span style={{ color:meta.color, fontWeight:500 }}>{meta.label}</span>
            {ev.target_name && <span>→ <strong style={{ color:'var(--bv-txt2)' }}>{ev.target_name}</strong></span>}
            {ev.db_type && <span style={{ padding:'1px 6px', borderRadius:5,
              background:'var(--bv-bg4)', color:'var(--bv-txt3)', fontSize:10 }}>
              {ev.db_type.toUpperCase()}</span>}
            {det?.duration_sec && <span><i className="ti ti-clock" style={{ marginRight:3 }}/>{fmtDuration(det.duration_sec)}</span>}
            {det?.file_size_bytes > 0 && <span>{fmtBytes(det.file_size_bytes)}</span>}
            {det?.freed_gb && <span style={{ color:'var(--bv-green)' }}>Freed {det.freed_gb} GB</span>}
            {det?.disk_before_pct && det?.disk_after_pct &&
              <span>Disk: <span style={{ color:'var(--bv-amber)' }}>{det.disk_before_pct}%</span>
              → <span style={{ color:'var(--bv-green)' }}>{det.disk_after_pct}%</span></span>}
          </div>
        </div>

        {/* Timestamp + actions */}
        <div style={{ flexShrink:0, textAlign:'right', display:'flex',
          flexDirection:'column', alignItems:'flex-end', gap:4 }}>
          <span style={{ fontSize:11, color:'var(--bv-txt3)', whiteSpace:'nowrap' }}>
            {fmtTimeAgo(ev.created_at)}
          </span>
          <span style={{ fontSize:10, color:'var(--bv-txt3)', whiteSpace:'nowrap' }}>
            {fmtTime(ev.created_at)}
          </span>
        </div>

        {/* View log button for backup runs */}
        {ev.run_id && (
          <button onClick={e => { e.stopPropagation(); onViewLog(ev.run_id); }}
            style={{ flexShrink:0, background:'var(--bv-blue-dim)', border:'1px solid var(--bv-blue)',
              color:'var(--bv-blue)', borderRadius:6, padding:'4px 10px',
              fontSize:11, cursor:'pointer', display:'flex', alignItems:'center', gap:4,
              fontWeight:500 }}>
            <i className="ti ti-terminal-2" style={{ fontSize:12 }}/> Logs
          </button>
        )}

        <i className={`ti ti-chevron-${expanded?'up':'down'}`}
          style={{ fontSize:13, color:'var(--bv-txt3)', flexShrink:0 }}/>
      </div>

      {/* Expanded detail */}
      {expanded && det && (
        <div style={{ padding:'10px 16px 12px 62px', background:'var(--bv-bg3)',
          borderTop:'1px solid var(--bv-bd)', display:'flex', flexWrap:'wrap', gap:16 }}>
          {ev.source && (
            <div>
              <div style={{ fontSize:10, color:'var(--bv-txt3)', textTransform:'uppercase',
                letterSpacing:'.06em', marginBottom:3 }}>Source</div>
              <code style={{ fontSize:11, color:'var(--bv-cyan)', fontFamily:'monospace' }}>{ev.source}</code>
            </div>
          )}
          {ev.destination && (
            <div>
              <div style={{ fontSize:10, color:'var(--bv-txt3)', textTransform:'uppercase',
                letterSpacing:'.06em', marginBottom:3 }}>Destination</div>
              <code style={{ fontSize:11, color:'var(--bv-amber)', fontFamily:'monospace' }}>{ev.destination}</code>
            </div>
          )}
          {det.moved != null && (
            <div>
              <div style={{ fontSize:10, color:'var(--bv-txt3)', textTransform:'uppercase',
                letterSpacing:'.06em', marginBottom:3 }}>Folders Moved</div>
              <span style={{ fontSize:16, fontWeight:600, color:'var(--bv-green)' }}>{det.moved}</span>
            </div>
          )}
          {det.failed != null && det.failed > 0 && (
            <div>
              <div style={{ fontSize:10, color:'var(--bv-txt3)', textTransform:'uppercase',
                letterSpacing:'.06em', marginBottom:3 }}>Failed</div>
              <span style={{ fontSize:16, fontWeight:600, color:'var(--bv-red)' }}>{det.failed}</span>
            </div>
          )}
          {det.trigger_type && (
            <div>
              <div style={{ fontSize:10, color:'var(--bv-txt3)', textTransform:'uppercase',
                letterSpacing:'.06em', marginBottom:3 }}>Trigger</div>
              <span style={{ fontSize:12, color:'var(--bv-txt2)',
                textTransform:'capitalize' }}>{det.trigger_type}</span>
            </div>
          )}
          {det.backup_type && (
            <div>
              <div style={{ fontSize:10, color:'var(--bv-txt3)', textTransform:'uppercase',
                letterSpacing:'.06em', marginBottom:3 }}>Backup Type</div>
              <span style={{ fontSize:12, color:'var(--bv-txt2)',
                textTransform:'capitalize' }}>{det.backup_type}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
export default function ActivityCenter() {
  const [data,     setData]     = useState({ events:[], total:0, summary:null });
  const [loading,  setLoading]  = useState(true);
  const [logRunId, setLogRunId] = useState(null);
  const [filter,   setFilter]   = useState({ status:'', type:'', search:'' });
  const [page,     setPage]     = useState(1);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [stats,    setStats]    = useState(null);
  const timerRef = useRef();

  const load = useCallback(async (pg=1) => {
    try {
      const params = new URLSearchParams({
        page: pg, limit: 50,
        ...(filter.status && { status: filter.status }),
        ...(filter.type   && { type:   filter.type   }),
        ...(filter.search && { search: filter.search }),
      });
      const [d, s] = await Promise.all([
        r('GET', `/activity?${params}`),
        r('GET', '/activity/stats'),
      ]);
      setData(d); setStats(s); setPage(pg);
    } catch(e) { toast(e.message,'error'); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { setLoading(true); load(1); }, [load]);

  useEffect(() => {
    if (!autoRefresh) { clearInterval(timerRef.current); return; }
    timerRef.current = setInterval(() => load(page), 15000);
    return () => clearInterval(timerRef.current);
  }, [autoRefresh, load, page]);

  const sum = data.summary;

  const kpis = [
    { label:'Today Total',    value:sum?.total||0,       color:'var(--bv-blue)'  },
    { label:'Successful',     value:sum?.success||0,     color:'var(--bv-green)' },
    { label:'Errors',         value:sum?.errors||0,      color:sum?.errors>0?'var(--bv-red)':'var(--bv-txt3)' },
    { label:'Relief Runs',    value:sum?.relief_runs||0, color:'var(--bv-amber)' },
    { label:'Running Now',    value:sum?.running||0,     color:sum?.running>0?'var(--bv-blue)':'var(--bv-txt3)' },
  ];

  const totalPages = Math.ceil(data.total / 50);

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

      {/* Header */}
      <div style={{ padding:'14px 22px 12px', borderBottom:'1px solid var(--bv-bd)',
        background:'var(--bv-bg2)', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'flex-start',
          justifyContent:'space-between', gap:12 }}>
          <div>
            <div style={{ fontSize:20, fontWeight:500, color:'var(--bv-txt)',
              display:'flex', alignItems:'center', gap:9 }}>
              <i className="ti ti-activity" style={{ color:'var(--bv-blue)', fontSize:22 }}/>
              Activity Center
            </div>
            <div style={{ fontSize:12, color:'var(--bv-txt2)', marginTop:3 }}>
              Backup executions · Relief operations · System events · Logs
            </div>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <label style={{ display:'flex', alignItems:'center', gap:6,
              fontSize:12, color:'var(--bv-txt2)', cursor:'pointer' }}>
              <input type="checkbox" checked={autoRefresh}
                onChange={e => setAutoRefresh(e.target.checked)}/>
              Auto-refresh (15s)
            </label>
            <Btn variant="ghost" icon="refresh" onClick={() => load(page)}>Refresh</Btn>
          </div>
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'16px 22px',
        display:'flex', flexDirection:'column', gap:14 }}>

        {/* KPI row */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10 }}>
          {kpis.map(k => (
            <div key={k.label} style={{ background:'var(--bv-card)',
              border:'1px solid var(--bv-bd)', borderTop:`3px solid ${k.color}`,
              borderRadius:10, padding:'11px 14px' }}>
              <div style={{ fontSize:10, color:'var(--bv-txt3)', textTransform:'uppercase',
                letterSpacing:'.07em', marginBottom:5 }}>{k.label}</div>
              <div style={{ fontSize:26, fontWeight:600, color:k.color, lineHeight:1 }}>
                {loading ? '—' : k.value}
              </div>
            </div>
          ))}
        </div>

        {/* Filter bar */}
        <div style={{ background:'var(--bv-card)', border:'1px solid var(--bv-bd)',
          borderRadius:10, padding:'10px 14px',
          display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
          <i className="ti ti-filter" style={{ color:'var(--bv-txt3)', fontSize:15 }}/>

          <input value={filter.search}
            onChange={e => setFilter(p=>({...p,search:e.target.value}))}
            placeholder="Search events…"
            style={{ fontSize:12, padding:'5px 10px', background:'var(--bv-input)',
              border:'1px solid var(--bv-bd2)', color:'var(--bv-txt)',
              borderRadius:7, width:220 }}/>

          <select value={filter.status}
            onChange={e => setFilter(p=>({...p,status:e.target.value}))}
            style={{ fontSize:12, padding:'5px 10px', background:'var(--bv-input)',
              border:'1px solid var(--bv-bd2)', color:'var(--bv-txt)', borderRadius:7 }}>
            <option value="">All statuses</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
            <option value="warning">Warning</option>
            <option value="running">Running</option>
            <option value="info">Info</option>
          </select>

          <select value={filter.type}
            onChange={e => setFilter(p=>({...p,type:e.target.value}))}
            style={{ fontSize:12, padding:'5px 10px', background:'var(--bv-input)',
              border:'1px solid var(--bv-bd2)', color:'var(--bv-txt)', borderRadius:7 }}>
            <option value="">All types</option>
            <option value="backup_run">Backup Runs</option>
            <option value="relief_start">Relief Start</option>
            <option value="relief_complete">Relief Complete</option>
            <option value="ssh_transfer">SSH Transfer</option>
            <option value="delete_source">Source Deleted</option>
            <option value="storage_alert">Storage Alert</option>
          </select>

          {(filter.search||filter.status||filter.type) && (
            <button onClick={() => setFilter({ status:'', type:'', search:'' })}
              style={{ background:'none', border:'1px solid var(--bv-bd2)',
                color:'var(--bv-txt3)', borderRadius:7, padding:'5px 10px',
                fontSize:12, cursor:'pointer' }}>
              Clear ×
            </button>
          )}

          <div style={{ marginLeft:'auto', fontSize:11, color:'var(--bv-txt3)' }}>
            {data.total} events
            {autoRefresh && <span style={{ marginLeft:8, color:'var(--bv-green)' }}>
              <i className="ti ti-circle-dot" style={{ fontSize:10, marginRight:3 }}/>live
            </span>}
          </div>
        </div>

        {/* Event list */}
        <div style={{ background:'var(--bv-card)', border:'1px solid var(--bv-bd)',
          borderRadius:10, overflow:'hidden' }}>

          {/* Table header */}
          <div style={{ padding:'8px 16px', background:'var(--bv-bg3)',
            borderBottom:'1px solid var(--bv-bd)',
            display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:10, fontWeight:600, color:'var(--bv-txt2)',
              textTransform:'uppercase', letterSpacing:'.07em' }}>
              Activity Timeline
            </span>
            {loading && <Spinner size={14}/>}
          </div>

          {loading && data.events.length===0 ? (
            <div style={{ display:'flex', justifyContent:'center',
              padding:60, gap:12, color:'var(--bv-txt3)' }}>
              <Spinner size={26}/> Loading activity...
            </div>
          ) : data.events.length===0 ? (
            <div style={{ textAlign:'center', padding:60, color:'var(--bv-txt3)' }}>
              <i className="ti ti-activity" style={{ fontSize:46, display:'block',
                marginBottom:14, color:'var(--bv-bd2)' }}/>
              <div style={{ fontSize:15, fontWeight:500, color:'var(--bv-txt2)',
                marginBottom:6 }}>No activity yet</div>
              <div style={{ fontSize:13 }}>
                Events appear here when backups run or the relief script executes
              </div>
            </div>
          ) : (
            data.events.map(ev => (
              <EventRow key={ev.id} ev={ev} onViewLog={setLogRunId}/>
            ))
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display:'flex', justifyContent:'center', gap:8 }}>
            <Btn variant="ghost" size="sm" disabled={page<=1}
              onClick={() => load(page-1)}>← Prev</Btn>
            <span style={{ padding:'6px 12px', fontSize:12, color:'var(--bv-txt2)' }}>
              Page {page} of {totalPages}
            </span>
            <Btn variant="ghost" size="sm" disabled={page>=totalPages}
              onClick={() => load(page+1)}>Next →</Btn>
          </div>
        )}

        {/* How relief script sends events */}
        <div style={{ background:'var(--bv-bg3)', border:'1px solid var(--bv-bd)',
          borderRadius:10, padding:'12px 16px' }}>
          <div style={{ fontSize:11, fontWeight:600, color:'var(--bv-txt2)',
            marginBottom:8, display:'flex', alignItems:'center', gap:7 }}>
            <i className="ti ti-terminal-2" style={{ color:'var(--bv-blue)', fontSize:13 }}/>
            Relief Script Integration
          </div>
          <div style={{ fontSize:11, color:'var(--bv-txt3)', lineHeight:1.7 }}>
            The <code style={{ color:'var(--bv-cyan)', fontFamily:'monospace' }}>primary-relief.sh</code> script
            reports every action here via <code style={{ color:'var(--bv-cyan)', fontFamily:'monospace' }}>POST /api/infra/storage-event</code>.
            Store the API token in <code style={{ color:'var(--bv-cyan)', fontFamily:'monospace' }}>/opt/backupvault/.bv_token</code> on the Primary DC server.
          </div>
          <div style={{ marginTop:8, padding:'7px 10px',
            background:'var(--bv-bg2)', borderRadius:7, fontFamily:'monospace',
            fontSize:11, color:'var(--bv-txt2)' }}>
            # Get token and save on Primary DC server (10.180.0.90):<br/>
	  {/*
	  TOKEN=$(curl -s -X POST https://backupvault.worktual.tech/api/auth/login \<br/>
            &nbsp;&nbsp;-d '{"{\"email\":\"admin@worktual.tech\",\"password\":\"Admin@1234\"}'} | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")<br/>
            echo $TOKEN {'>'} /opt/backupvault/.bv_token<br/>
            chmod 600 /opt/backupvault/.bv_token */}
          </div>
        </div>
      </div>

      {/* Log viewer modal */}
      {logRunId && <LogModal runId={logRunId} onClose={() => setLogRunId(null)}/>}
    </div>
  );
}
