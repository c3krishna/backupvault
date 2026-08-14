// src/pages/History.js
import { useState, useEffect, useCallback, useRef } from 'react';
import { runsAPI, targetsAPI } from '../services/api';
import { Badge, Btn, DestIcons, toast } from '../components/UI';
import { useWS, useWSMessages } from '../context/WSContext';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';

// Safe date formatter — never throws on null/invalid dates
function safeDate(val, fallback) {
  if (!val) return fallback || '—';
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return fallback || '—';
    return d;
  } catch { return fallback || '—'; }
}
function safeFmt(val, fmt, fallback) {
  if (!val) return fallback || '—';
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return fallback || '—';
    return format(d, fmt);
  } catch { return fallback || '—'; }
}


function fmtBytes(b) {
  if (!b || b === 0) return '0 B';
  const u = ['B','KB','MB','GB'];
  const i = Math.floor(Math.log(Math.max(b,1)) / Math.log(1024));
  return (b / Math.pow(1024, i)).toFixed(1) + ' ' + u[i];
}

// ── RUN HISTORY ──────────────────────────────────────────────────────────────
export function HistoryPage() {
  const [runs,    setRuns]    = useState([]);
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ date:'', target_id:'', status:'' });
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const f = {};
      if (filters.date)      f.date      = filters.date;
      if (filters.target_id) f.target_id = filters.target_id;
      if (filters.status)    f.status    = filters.status;
      const [r, t] = await Promise.all([runsAPI.list({ ...f, limit:100 }), targetsAPI.list()]);
      setRuns(r); setTargets(t);
    } catch(e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const counts = {
    total:   runs.length,
    success: runs.filter(r=>r.status==='success').length,
    failed:  runs.filter(r=>r.status==='failed').length,
    partial: runs.filter(r=>r.status==='partial').length,
    running: runs.filter(r=>r.status==='running').length,
  };

  const pill = (bg, color, text) => (
    <span style={{ fontSize:11, fontWeight:700, padding:'4px 12px', borderRadius:20, background:bg, color }}>{text}</span>
  );

  const th = { textAlign:'left', fontSize:10, fontWeight:600, color:'var(--bv-txt3)',
    letterSpacing:'.07em', textTransform:'uppercase', padding:'8px 12px',
    borderBottom:'1px solid var(--bv-bd)', whiteSpace:'nowrap' };
  const td = (extra={}) => ({ padding:'9px 12px', borderBottom:'1px solid var(--bv-bg4)', fontSize:12, color:'var(--bv-txt)', ...extra });

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'18px 24px 14px', borderBottom:'1px solid var(--bv-bd)', background:'var(--bv-bg2)',
        display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexShrink:0 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:500, color:'var(--bv-txt)' }}>Run History</div>
          <div style={{ fontSize:12, color:'var(--bv-txt2)', marginTop:3 }}>
            {counts.total} runs · <span style={{ color:'var(--bv-green)' }}>
              {counts.total > 0 ? Math.round(counts.success/counts.total*100) : 100}% success rate
            </span>
          </div>
        </div>
        <Btn variant="ghost" icon="refresh" onClick={load}>Refresh</Btn>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'20px 24px', display:'flex', flexDirection:'column', gap:14 }}>
        {/* Filters */}
        <div style={{ background:'var(--bv-bg2)', border:'1px solid var(--bv-bd)', borderRadius:12,
          padding:'12px 16px', display:'flex', gap:12, flexWrap:'wrap', alignItems:'center' }}>
          <span style={{ fontSize:11, color:'var(--bv-txt3)', fontWeight:600 }}>Filter by date</span>
          <input type="date" value={filters.date}
            onChange={e=>setFilters(p=>({...p,date:e.target.value}))}
            style={{ fontSize:12, background:'var(--bv-bg4)', border:'1px solid var(--bv-bd2)',
              color:'var(--bv-txt)', borderRadius:8, padding:'6px 10px' }}/>
          <span style={{ fontSize:11, color:'var(--bv-txt3)', fontWeight:600 }}>Target</span>
          <select value={filters.target_id}
            onChange={e=>setFilters(p=>({...p,target_id:e.target.value}))}
            style={{ fontSize:12, background:'var(--bv-bg4)', border:'1px solid var(--bv-bd2)',
              color:'var(--bv-txt)', borderRadius:8, padding:'6px 10px' }}>
            <option value="">All Targets</option>
            {targets.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <span style={{ fontSize:11, color:'var(--bv-txt3)', fontWeight:600 }}>Status</span>
          <select value={filters.status}
            onChange={e=>setFilters(p=>({...p,status:e.target.value}))}
            style={{ fontSize:12, background:'var(--bv-bg4)', border:'1px solid var(--bv-bd2)',
              color:'var(--bv-txt)', borderRadius:8, padding:'6px 10px' }}>
            <option value="">All Statuses</option>
            {['success','failed','partial','running','pending'].map(s=><option key={s} value={s}>{s}</option>)}
          </select>
          <Btn variant="ghost" size="sm" onClick={()=>setFilters({date:'',target_id:'',status:''})}>Clear</Btn>
        </div>

        {/* Summary pills */}
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          {pill('var(--bv-bg4)','var(--bv-txt)', `TOTAL: ${counts.total}`)}
          {pill('var(--bv-green-bg)','var(--bv-green)', `SUCCESS: ${counts.success}`)}
          {pill('var(--bv-red-bg)','var(--bv-red)', `FAILED: ${counts.failed}`)}
          {pill('var(--bv-purple-bg)','var(--bv-purple)', `PARTIAL: ${counts.partial}`)}
          {pill('var(--bv-blue-dim)','var(--bv-blue)', `RUNNING: ${counts.running}`)}
        </div>

        {/* Table */}
        <div style={{ background:'var(--bv-bg2)', border:'1px solid var(--bv-bd)', borderRadius:12, overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr>{['#','Target','DB','Type','Status','Destinations','Size','Started At','Duration','Logs'].map(h=>(
                <th key={h} style={th}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {loading
                ? <tr><td colSpan={10} style={{ textAlign:'center', padding:40, color:'var(--bv-txt3)' }}>Loading...</td></tr>
                : runs.length === 0
                ? <tr><td colSpan={10} style={{ textAlign:'center', padding:40, color:'var(--bv-txt3)' }}>No runs found</td></tr>
                : runs.map(r => {
                    const dur = r.completed_at
                      ? (() => {
              try {
                const ms = new Date(r.completed_at) - new Date(r.started_at);
                return isNaN(ms) ? '—' : Math.round(ms/1000)+'s';
              } catch { return '—'; }
            })() : '—';
                    return (
                      <tr key={r.id}
                        onMouseEnter={e=>e.currentTarget.style.background='var(--bv-bg3)'}
                        onMouseLeave={e=>e.currentTarget.style.background=''}>
                        <td style={td({ color:'var(--bv-txt3)', fontFamily:'monospace' })}>#{r.id}</td>
                        <td style={td()}><strong>{r.target_name}</strong></td>
                        <td style={td()}><Badge type={r.db_type} small>{r.db_type?.toUpperCase()}</Badge></td>
                        <td style={td({ color:'var(--bv-txt2)' })}>{r.backup_type}</td>
                        <td style={td()}><Badge type={r.status}>{r.status?.toUpperCase()}</Badge></td>
                        <td style={td()}><DestIcons transfers={r.transfers}/></td>
                        <td style={td({ color:'var(--bv-txt2)' })}>{fmtBytes(r.file_size_bytes)}</td>
                        <td style={td({ fontSize:11, color:'var(--bv-txt2)', whiteSpace:'nowrap' })}>
                          {safeFmt(r.started_at,'dd MMM, hh:mm a','—')}
                        </td>
                        <td style={td({ color:'var(--bv-txt2)' })}>{dur}</td>
                        <td style={td()}>
                          <Btn variant="ghost" size="sm"
                            onClick={()=>navigate(`/live-logs?run=${r.id}`)}>Logs</Btn>
                        </td>
                      </tr>
                    );
                  })
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── LIVE LOGS ─────────────────────────────────────────────────────────────────
function levelColor(l) {
  return { INFO:'var(--bv-blue)', SUCCESS:'var(--bv-green)', WARN:'var(--bv-amber)', ERROR:'var(--bv-red)', DEBUG:'var(--bv-txt3)' }[l]||'var(--bv-txt2)';
}

export function LiveLogsPage() {
  const [recentRuns, setRecentRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const [logs,        setLogs]        = useState([]);
  const [liveLines,   setLiveLines]   = useState([]);
  const [filter,      setFilter]      = useState('');
  const [autoScroll,  setAutoScroll]  = useState(true);
  const [levelFilter, setLevelFilter] = useState('ALL');
  const logRef = useRef(null);
  const [params]  = useSearchParams();

  const onWsMessage = useCallback(msg => {
    if (msg.type==='log' && selectedRun && msg.runId===selectedRun.id) {
      setLiveLines(p=>[...p, { log_level:msg.level, message:msg.message, logged_at:msg.time }]);
    }
    if (msg.type==='run_started') loadRecent();
  }, [selectedRun]);

  const { connected } = useWS();
  useWSMessages(onWsMessage);

  const loadRecent = useCallback(async () => {
    try { setRecentRuns(await runsAPI.list({ limit:10 })); } catch {}
  }, []);

  async function selectRun(run) {
    setSelectedRun(run); setLiveLines([]);
    try { setLogs(await runsAPI.logs(run.id)); } catch(e){ toast(e.message,'error'); }
  }

  useEffect(() => { loadRecent(); }, [loadRecent]);

  useEffect(() => {
    const runId = params.get('run');
    if (runId && recentRuns.length > 0) {
      const r = recentRuns.find(r=>String(r.id)===runId);
      if (r) selectRun(r);
    }
  }, [params, recentRuns]);

  useEffect(() => {
    if (autoScroll && logRef.current)
      logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs, liveLines, autoScroll]);

  const allLines = [...logs, ...liveLines];
  const visible  = allLines.filter(l => {
    if (levelFilter!=='ALL' && l.log_level!==levelFilter) return false;
    if (filter && !l.message.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });
  const counts = { INFO:0, SUCCESS:0, WARN:0, ERROR:0 };
  allLines.forEach(l=>{ if(counts[l.log_level]!==undefined) counts[l.log_level]++; });

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'18px 24px 14px', borderBottom:'1px solid var(--bv-bd)', background:'var(--bv-bg2)', flexShrink:0 }}>
        <div style={{ fontSize:20, fontWeight:500, color:'var(--bv-txt)' }}>Live Log Viewer</div>
        <div style={{ fontSize:12, color:'var(--bv-txt2)', marginTop:3 }}>
          Real-time backup logs via WebSocket ·{' '}
          <span style={{ color: connected ? 'var(--bv-green)' : 'var(--bv-red)' }}>
            {connected ? '● Connected' : '○ Reconnecting...'}
          </span>
        </div>
      </div>

      <div style={{ flex:1, display:'flex', gap:12, padding:'14px 24px', overflow:'hidden', minHeight:0 }}>
        {/* Run list */}
        <div style={{ width:210, flexShrink:0, display:'flex', flexDirection:'column', gap:5, overflowY:'auto' }}>
          <div style={{ fontSize:10, fontWeight:600, color:'var(--bv-txt3)', letterSpacing:'.1em',
            textTransform:'uppercase', padding:'2px 4px', marginBottom:4 }}>Recent runs</div>
          {recentRuns.map(r=>(
            <div key={r.id} onClick={()=>selectRun(r)} style={{
              background: selectedRun?.id===r.id ? 'var(--bv-bg3)' : 'var(--bv-bg2)',
              border:`1px solid ${selectedRun?.id===r.id ? 'var(--bv-blue)' : 'var(--bv-bd)'}`,
              borderRadius:8, padding:'9px 12px', cursor:'pointer',
            }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:3 }}>
                <span style={{ fontSize:11, fontWeight:600, color:'var(--bv-txt)' }}>#{r.id}</span>
                <Badge type={r.status} small>{r.status?.toUpperCase()}</Badge>
              </div>
              <div style={{ fontSize:12, fontWeight:500, color:'var(--bv-txt)' }}>{r.target_name}</div>
              <div style={{ fontSize:10, color:'var(--bv-txt3)', marginTop:2 }}>
                {safeFmt(r.started_at,'hh:mm a','—')} · {r.backup_type}
              </div>
            </div>
          ))}
          {recentRuns.length===0 && <div style={{ color:'var(--bv-txt3)', fontSize:12, padding:8 }}>No recent runs</div>}
        </div>

        {/* Log panel */}
        <div style={{ flex:1, background:'var(--bv-bg2)', border:'1px solid var(--bv-bd)', borderRadius:12,
          display:'flex', flexDirection:'column', minHeight:0 }}>

          {/* Panel header */}
          <div style={{ padding:'10px 16px', borderBottom:'1px solid var(--bv-bd)', display:'flex',
            alignItems:'center', gap:10, flexShrink:0, flexWrap:'wrap' }}>
            {selectedRun ? (
              <>
                <span style={{ fontSize:14, fontWeight:500, color:'var(--bv-txt)', flex:1 }}>{selectedRun.target_name}</span>
                <span style={{ fontSize:11, color:'var(--bv-txt3)' }}>{selectedRun.backup_type} · {selectedRun.trigger_type}</span>
                <Badge type={selectedRun.status}>{selectedRun.status?.toUpperCase()}</Badge>
              </>
            ) : (
              <span style={{ fontSize:13, color:'var(--bv-txt3)' }}>Select a run from the left panel</span>
            )}
            <input value={filter} onChange={e=>setFilter(e.target.value)}
              placeholder="Filter logs..."
              style={{ width:170, fontSize:12, background:'var(--bv-bg4)',
                border:'1px solid var(--bv-bd2)', color:'var(--bv-txt)', borderRadius:8, padding:'5px 10px' }}/>
            <select value={levelFilter} onChange={e=>setLevelFilter(e.target.value)}
              style={{ fontSize:12, background:'var(--bv-bg4)', border:'1px solid var(--bv-bd2)',
                color:'var(--bv-txt)', borderRadius:8, padding:'5px 8px' }}>
              {['ALL','INFO','SUCCESS','WARN','ERROR'].map(l=><option key={l}>{l}</option>)}
            </select>
            <label style={{ display:'flex', alignItems:'center', gap:5, fontSize:12,
              color:'var(--bv-txt2)', cursor:'pointer' }}>
              <input type="checkbox" checked={autoScroll}
                onChange={e=>setAutoScroll(e.target.checked)}
                style={{ accentColor:'var(--bv-blue)' }}/>
              Auto-scroll
            </label>
            <Btn variant="ghost" size="sm" icon="refresh"
              onClick={()=>selectedRun && selectRun(selectedRun)}>Reload</Btn>
          </div>

          {/* Log body */}
          <div ref={logRef} style={{ flex:1, overflowY:'auto', padding:'10px 16px',
            fontFamily:"'Consolas','Monaco',monospace", fontSize:11.5, lineHeight:1.7 }}>
            {visible.map((l,i)=>(
              <div key={i} style={{ display:'flex', gap:12 }}>
                <span style={{ color:'var(--bv-txt3)', flexShrink:0, width:52 }}>
                  {safeFmt(l.logged_at,'HH:mm:ss','--:--:--')}
                </span>
                <span style={{ flexShrink:0, width:72, color:levelColor(l.log_level), fontWeight:600 }}>
                  [{l.log_level}]
                </span>
                <span style={{ color: l.log_level==='SUCCESS'?'var(--bv-green)':l.log_level==='ERROR'?'var(--bv-red)':'var(--bv-txt)', flex:1 }}>
                  {l.message}
                </span>
              </div>
            ))}
            {!selectedRun && (
              <div style={{ color:'var(--bv-txt3)', textAlign:'center', padding:40 }}>
                Select a run to view logs
              </div>
            )}
            {selectedRun && visible.length===0 && (
              <div style={{ color:'var(--bv-txt3)', textAlign:'center', padding:32 }}>
                No log lines match filter
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{ padding:'6px 16px', borderTop:'1px solid var(--bv-bd)', display:'flex',
            justifyContent:'space-between', fontSize:11, color:'var(--bv-txt3)', flexShrink:0 }}>
            <span>{visible.length} lines shown ({allLines.length} total)</span>
            <span>
              <span style={{ color:'var(--bv-blue)', marginRight:10 }}>INFO: {counts.INFO}</span>
              <span style={{ color:'var(--bv-green)', marginRight:10 }}>SUCCESS: {counts.SUCCESS}</span>
              <span style={{ color:'var(--bv-amber)', marginRight:10 }}>WARN: {counts.WARN}</span>
              <span style={{ color:'var(--bv-red)' }}>ERROR: {counts.ERROR}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
