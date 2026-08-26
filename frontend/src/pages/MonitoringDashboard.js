// frontend/src/pages/MonitoringDashboard.js
// Physical server monitoring — grouped by host:port, environments, deep metrics + wave graphs

import { useState, useEffect, useCallback, useRef } from 'react';
import { monitoringAPI, nfsAPI } from '../services/api';
import { Btn, Spinner, Modal, Field, toast } from '../components/UI';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
         CartesianGrid, ReferenceLine } from 'recharts';

const ENV_META = {
  live:           { label:'Live / Production', color:'var(--bv-red)',    bg:'var(--bv-red-bg)',    icon:'activity'    },
  pre_production: { label:'Pre-Production',    color:'var(--bv-amber)',  bg:'var(--bv-amber-bg)',  icon:'test-pipe'   },
  qa:             { label:'QA / Testing',      color:'var(--bv-blue)',   bg:'var(--bv-blue-dim)',  icon:'microscope'  },
  development:    { label:'Development',       color:'var(--bv-green)',  bg:'var(--bv-green-dim)', icon:'code'        },
  other:          { label:'Other',             color:'var(--bv-txt3)',   bg:'var(--bv-bg4)',       icon:'server'      },
};
const DB_COLORS = {
  mysql:      { label:'MySQL',      bg:'#1e3a1e', color:'#4ec94e' },
  postgresql: { label:'PostgreSQL', bg:'#1a2550', color:'#7ca8f8' },
  redis:      { label:'Redis',      bg:'#3d1a10', color:'#f85149' },
};
const NFS_ROLE_META = {
  primary:'device-floppy', secondary:'server-2', remote:'building',
  live:'activity', pre_production:'test-pipe', qa:'microscope', other:'server',
};
const HA_COLORS = { master:'var(--bv-green)', slave:'var(--bv-cyan)', standalone:'var(--bv-txt3)' };
const ENV_ORDER  = ['live','pre_production','qa','development','other'];

// ── MICRO COMPONENTS ──────────────────────────────────────────────────────────
function PctBar({ pct, h=6 }) {
  const p=Math.min(parseFloat(pct)||0,100);
  const c=p>=90?'var(--bv-red)':p>=75?'var(--bv-amber)':'var(--bv-green)';
  return <div style={{width:'100%',height:h,background:'var(--bv-bg4)',borderRadius:h/2,overflow:'hidden'}}>
    <div style={{height:'100%',width:`${p}%`,background:c,borderRadius:h/2,transition:'width .5s'}}/>
  </div>;
}

function KV({ label, value, color, mono, warn, crit, unit='' }) {
  const v = parseFloat(value);
  const col = color || (crit!=null && v>=crit ? 'var(--bv-red)' : warn!=null && v>=warn ? 'var(--bv-amber)' : 'var(--bv-green)');
  return <div style={{textAlign:'center'}}>
    <div style={{fontSize:9,color:'var(--bv-txt3)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:2,whiteSpace:'nowrap'}}>{label}</div>
    <div style={{fontSize:15,fontWeight:600,color:isNaN(v)&&value?'var(--bv-txt2)':col,fontFamily:mono?'monospace':'inherit',lineHeight:1}}>
      {value==null?'—':`${isNaN(v)?value:v}${unit}`}
    </div>
  </div>;
}

function ReplicaBadge({ running, lagSec, ioRunning, sqlRunning }) {
  if (running==null) return null;
  const ok  = running===1;
  const lag = lagSec!=null ? lagSec : null;
  const col = !ok?'var(--bv-red)':lag>30?'var(--bv-amber)':'var(--bv-green)';
  return <div style={{display:'flex',alignItems:'center',gap:6,padding:'3px 9px',
    borderRadius:8,background:ok?'var(--bv-green-bg)':'var(--bv-red-bg)',border:`1px solid ${col}`,fontSize:11}}>
    <i className={`ti ti-${ok?'check':'alert-triangle'}`} style={{color:col,fontSize:13}}/>
    <span style={{color:col,fontWeight:600}}>{ok?'Replication OK':'Replication ERROR'}</span>
    {lag!=null && <span style={{color:col,fontSize:10,marginLeft:4}}>lag {lag}s</span>}
    {!ok && <span style={{fontSize:10,color:'var(--bv-txt3)'}}> IO:{ioRunning} SQL:{sqlRunning}</span>}
  </div>;
}

function WaveGraph({ data, lines, height=70 }) {
  const fmtT = v => { if(!v) return ''; const d=new Date(v); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
  return <ResponsiveContainer width="100%" height={height}>
    <LineChart data={data} margin={{top:2,right:4,bottom:0,left:0}}>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--bv-bd)" vertical={false}/>
      <XAxis dataKey="snapshot_at" hide tickFormatter={fmtT}/>
      <YAxis domain={[0,'auto']} hide/>
      <Tooltip contentStyle={{background:'var(--bv-bg2)',border:'1px solid var(--bv-bd)',borderRadius:6,fontSize:10}}
        labelFormatter={fmtT}/>
      {lines.map(l=>(
        <Line key={l.key} type="monotone" dataKey={l.key} stroke={l.color}
          strokeWidth={1.5} dot={false} activeDot={{r:3}} connectNulls
          name={l.label}/>
      ))}
      {lines.filter(l=>l.ref).map(l=>(
        <ReferenceLine key={l.key+'r'} y={l.ref} stroke={l.color} strokeDasharray="4 2" strokeWidth={1} opacity={0.5}/>
      ))}
    </LineChart>
  </ResponsiveContainer>;
}

// ── SERVER CARD ───────────────────────────────────────────────────────────────
function ServerCard({ server, onCollect, collecting }) {
  const [open,    setOpen]    = useState(false);
  const [history, setHistory] = useState([]);
  const dbc = DB_COLORS[server.db_type]||DB_COLORS.mysql;
  const s   = server;
  const hasData = s.cpu_pct!=null || s.threads_connected!=null || s.pg_connections!=null;

  const loadHist = useCallback(async () => {
    try { setHistory(await monitoringAPI.serverHistory(s.id, 60)); } catch {}
  }, [s.id]);

  useEffect(() => { if (open) loadHist(); }, [open, loadHist]);
  useEffect(() => {
    if (!open) return;
    const t=setInterval(loadHist,60000); return ()=>clearInterval(t);
  }, [open, loadHist]);

  const conns   = s.threads_connected ?? s.pg_connections;
  const running = s.threads_running   ?? s.pg_active_queries;
  const lagSec  = s.slave_lag_sec     ?? s.pg_replica_lag;
  const slaveOk = s.slave_running;

  // Status color for card border
  const borderCol = s.last_status==='critical'?'var(--bv-red)':
                    s.last_status==='warn'?'var(--bv-amber)':'var(--bv-bd)';

  return <div style={{background:'var(--bv-card)',border:`1px solid ${borderCol}`,borderRadius:11,overflow:'hidden',marginBottom:8}}>

    {/* ── HEADER ROW ── */}
    <div style={{display:'flex',alignItems:'center',gap:10,padding:'11px 14px',
      cursor:'pointer',background:open?'var(--bv-hover)':'var(--bv-card)'}}
      onClick={()=>setOpen(o=>!o)}>

      {/* DB type badge */}
      <div style={{width:36,height:36,borderRadius:9,background:dbc.bg,flexShrink:0,
        display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,color:dbc.color}}>
        {dbc.label[0]}
      </div>

      {/* Server info */}
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:'flex',alignItems:'center',gap:7,flexWrap:'wrap'}}>
          <span style={{fontSize:13,fontWeight:500,color:'var(--bv-txt)'}}>{s.name}</span>
          <span style={{fontSize:10,padding:'1px 7px',borderRadius:8,fontWeight:600,background:dbc.bg,color:dbc.color}}>{dbc.label}</span>
          {s.ha_role && <span style={{fontSize:10,padding:'1px 7px',borderRadius:8,fontWeight:600,
            background:'var(--bv-bg3)',color:HA_COLORS[s.ha_role]||'var(--bv-txt3)'}}>
            {s.ha_role.toUpperCase()}
          </span>}
          {s.last_status && <span style={{width:7,height:7,borderRadius:'50%',flexShrink:0,
            background:s.last_status==='critical'?'var(--bv-red)':s.last_status==='warn'?'var(--bv-amber)':'var(--bv-green)',
            boxShadow:s.last_status==='ok'?'0 0 5px var(--bv-green)':'none'}}/>}
        </div>
        <div style={{fontSize:11,color:'var(--bv-txt3)',marginTop:2,display:'flex',gap:10,flexWrap:'wrap'}}>
          <span style={{fontFamily:'monospace',color:'var(--bv-cyan)'}}>{s.host}:{s.port}</span>
          {s.vip_host && <span style={{color:'var(--bv-txt3)'}}>VIP: <span style={{color:'var(--bv-amber)',fontFamily:'monospace'}}>{s.vip_host}</span></span>}
          {s.snapshot_at && <span>Updated {new Date(s.snapshot_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</span>}
        </div>
        {/* Databases on this server */}
        {s.databases?.length > 0 && (
          <div style={{marginTop:4,display:'flex',gap:4,flexWrap:'wrap'}}>
            {s.databases.map(d=>(
              <span key={d.id} style={{fontSize:10,padding:'1px 7px',borderRadius:6,
                background:'var(--bv-bg3)',color:'var(--bv-txt3)',fontFamily:'monospace'}}>{d.database_name}</span>
            ))}
          </div>
        )}
      </div>

      {/* Metrics */}
      {hasData ? (
        <div style={{display:'flex',gap:14,flexShrink:0,alignItems:'center'}}>
          <KV label="CPU"      value={s.cpu_pct!=null?parseFloat(s.cpu_pct).toFixed(1):null} unit="%" warn={75} crit={90}/>
          <KV label="Mem"      value={s.mem_pct!=null?parseFloat(s.mem_pct).toFixed(1):null} unit="%" warn={80} crit={90}/>
          <KV label="Disk"     value={s.disk_pct}                                             unit="%" warn={80} crit={90}/>
          <KV label="Load 1m"  value={s.load_avg_1!=null?parseFloat(s.load_avg_1).toFixed(2):null} warn={4} crit={8} color={null}/>
          {conns!=null && <KV label="Connections" value={conns} color="var(--bv-blue)"/>}
          {running!=null && running>0 && <KV label="Active Qry" value={running} color="var(--bv-amber)"/>}
          {s.qps!=null && <KV label="QPS" value={parseFloat(s.qps).toFixed(1)} color="var(--bv-txt2)"/>}
          {lagSec!=null && <KV label="Lag" value={`${lagSec}s`}
            color={lagSec>30?'var(--bv-amber)':lagSec>300?'var(--bv-red)':'var(--bv-green)'} mono/>}
        </div>
      ) : (
        <div style={{fontSize:11,color:'var(--bv-txt3)',fontStyle:'italic'}}>
          {s.monitoring_enabled ? 'No data yet — click Collect' : 'Monitoring disabled'}
        </div>
      )}

      {/* Actions */}
      <div style={{display:'flex',gap:6,flexShrink:0}} onClick={e=>e.stopPropagation()}>
        <Btn variant="ghost" size="sm" icon="refresh" loading={collecting===s.id}
          onClick={()=>onCollect(s.id)}>Collect</Btn>
        <i className={`ti ti-chevron-${open?'up':'down'}`}
          style={{fontSize:14,color:'var(--bv-txt3)',padding:'4px',alignSelf:'center'}}/>
      </div>
    </div>

    {/* ── EXPANDED DETAIL ── */}
    {open && <div style={{borderTop:'1px solid var(--bv-bd)',padding:14,background:'var(--bv-bg3)',display:'flex',flexDirection:'column',gap:12}}>

      {/* Replication status */}
      <ReplicaBadge running={slaveOk} lagSec={lagSec}
        ioRunning={s.slave_io_running} sqlRunning={s.slave_sql_running}/>

      {/* MySQL deep metrics panel */}
      {s.db_type==='mysql' && (s.threads_connected!=null||s.qps!=null||s.innodb_bp_hit_pct!=null) && (
        <div style={{background:'var(--bv-card)',borderRadius:9,border:'1px solid var(--bv-bd)',overflow:'hidden'}}>
          <div style={{padding:'7px 12px',background:'var(--bv-bg3)',borderBottom:'1px solid var(--bv-bd)',
            fontSize:10,fontWeight:600,color:'var(--bv-txt2)',textTransform:'uppercase',letterSpacing:'.07em',
            display:'flex',alignItems:'center',gap:7}}>
            <i className="ti ti-database" style={{fontSize:12,color:'var(--bv-green)'}}/>
            MySQL Instance Metrics
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:0}}>
            {[
              {label:'Connections',  value:s.threads_connected, col:'var(--bv-blue)',  warn:80, crit:150},
              {label:'Active Qry',   value:s.threads_running,   col:'var(--bv-amber)', warn:10, crit:30},
              {label:'Thread Cache', value:s.threads_cached,    col:'var(--bv-txt2)'},
              {label:'QPS',          value:s.qps!=null?parseFloat(s.qps).toFixed(1):null, col:'var(--bv-cyan)'},
              {label:'Slow Queries', value:s.slow_queries,      col:s.slow_queries>0?'var(--bv-amber)':'var(--bv-txt3)', warn:1},
              {label:'BP Hit %',     value:s.innodb_bp_hit_pct!=null?parseFloat(s.innodb_bp_hit_pct).toFixed(1)+'%':null,
               col:s.innodb_bp_hit_pct!=null&&parseFloat(s.innodb_bp_hit_pct)<90?'var(--bv-amber)':'var(--bv-green)'},
            ].map((m,i)=>(
              <div key={m.label} style={{padding:'10px 14px',borderRight:i<5?'1px solid var(--bv-bd)':'none',textAlign:'center'}}>
                <div style={{fontSize:9,color:'var(--bv-txt3)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:4}}>{m.label}</div>
                <div style={{fontSize:18,fontWeight:600,color:m.value==null?'var(--bv-txt3)':
                  m.crit!=null&&parseFloat(m.value)>=m.crit?'var(--bv-red)':
                  m.warn!=null&&parseFloat(m.value)>=m.warn?'var(--bv-amber)':m.col}}>
                  {m.value==null?'—':m.value}
                </div>
              </div>
            ))}
          </div>
          {s.innodb_bp_hit_pct!=null && parseFloat(s.innodb_bp_hit_pct)<90 && (
            <div style={{padding:'5px 12px',background:'var(--bv-amber-bg)',borderTop:'1px solid var(--bv-amber)',
              fontSize:11,color:'var(--bv-amber)'}}>
              <i className="ti ti-alert-triangle" style={{marginRight:5}}/>
              InnoDB buffer pool hit ratio {parseFloat(s.innodb_bp_hit_pct).toFixed(1)}% — consider increasing innodb_buffer_pool_size
            </div>
          )}
        </div>
      )}

      {/* PostgreSQL deep metrics panel */}
      {s.db_type==='postgresql' && s.pg_connections!=null && (
        <div style={{background:'var(--bv-card)',borderRadius:9,border:'1px solid var(--bv-bd)',overflow:'hidden'}}>
          <div style={{padding:'7px 12px',background:'var(--bv-bg3)',borderBottom:'1px solid var(--bv-bd)',
            fontSize:10,fontWeight:600,color:'var(--bv-txt2)',textTransform:'uppercase',letterSpacing:'.07em',
            display:'flex',alignItems:'center',gap:7}}>
            <i className="ti ti-database" style={{fontSize:12,color:'var(--bv-blue)'}}/>
            PostgreSQL Instance Metrics
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:0}}>
            {[
              {label:'Total Connections', value:s.pg_connections,    col:'var(--bv-blue)'},
              {label:'Active Queries',    value:s.pg_active_queries, col:s.pg_active_queries>5?'var(--bv-amber)':'var(--bv-txt2)'},
              {label:'Cache Hit %',       value:s.pg_cache_hit_pct!=null?parseFloat(s.pg_cache_hit_pct).toFixed(1)+'%':null,
               col:s.pg_cache_hit_pct!=null&&parseFloat(s.pg_cache_hit_pct)<90?'var(--bv-amber)':'var(--bv-green)'},
              {label:'Replica Lag',       value:s.pg_replica_lag!=null?`${s.pg_replica_lag}s`:null,
               col:s.pg_replica_lag>30?'var(--bv-amber)':s.pg_replica_lag>300?'var(--bv-red)':'var(--bv-green)'},
            ].map((m,i)=>(
              <div key={m.label} style={{padding:'10px 14px',borderRight:i<3?'1px solid var(--bv-bd)':'none',textAlign:'center'}}>
                <div style={{fontSize:9,color:'var(--bv-txt3)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:4}}>{m.label}</div>
                <div style={{fontSize:18,fontWeight:600,color:m.value==null?'var(--bv-txt3)':m.col}}>{m.value==null?'—':m.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Wave graphs */}
      {history.length>=1 ? (
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div style={{background:'var(--bv-card)',borderRadius:8,padding:'10px 12px',border:'1px solid var(--bv-bd)'}}>
            <div style={{fontSize:10,color:'var(--bv-txt3)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:6,fontWeight:600}}>CPU & Memory % (60 min)</div>
            <WaveGraph data={history} lines={[
              {key:'cpu_pct',color:'var(--bv-blue)',label:'CPU %',ref:80},
              {key:'mem_pct',color:'var(--bv-purple)',label:'Mem %',ref:85},
            ]}/>
          </div>
          <div style={{background:'var(--bv-card)',borderRadius:8,padding:'10px 12px',border:'1px solid var(--bv-bd)'}}>
            <div style={{fontSize:10,color:'var(--bv-txt3)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:6,fontWeight:600}}>Disk % & Connections</div>
            <WaveGraph data={history} lines={[
              {key:'disk_pct',color:'var(--bv-amber)',label:'Disk %',ref:80},
              {key:'threads_connected',color:'var(--bv-cyan)',label:'Connections'},
            ]}/>
          </div>
          {history.some(h=>h.qps!=null) && (
            <div style={{background:'var(--bv-card)',borderRadius:8,padding:'10px 12px',border:'1px solid var(--bv-bd)'}}>
              <div style={{fontSize:10,color:'var(--bv-txt3)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:6,fontWeight:600}}>QPS — Queries Per Second</div>
              <WaveGraph data={history} lines={[{key:'qps',color:'var(--bv-green)',label:'QPS'}]}/>
            </div>
          )}
          {history.some(h=>h.slave_lag_sec!=null) && (
            <div style={{background:'var(--bv-card)',borderRadius:8,padding:'10px 12px',border:'1px solid var(--bv-bd)'}}>
              <div style={{fontSize:10,color:'var(--bv-txt3)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:6,fontWeight:600}}>Replication Lag (seconds)</div>
              <WaveGraph data={history} lines={[{key:'slave_lag_sec',color:'var(--bv-red)',label:'Lag(s)',ref:30}]}/>
            </div>
          )}
        </div>
      ) : <div style={{textAlign:'center',padding:20,color:'var(--bv-txt3)',fontSize:12}}>
        Wave graphs appear after 2+ data collections (auto every 5 min)
      </div>}

      {/* Load average */}
      {s.load_avg_1!=null && (
        <div style={{display:'flex',gap:16,padding:'7px 12px',background:'var(--bv-card)',borderRadius:8,border:'1px solid var(--bv-bd)',flexWrap:'wrap'}}>
          <span style={{fontSize:11,color:'var(--bv-txt3)',alignSelf:'center'}}>Load avg:</span>
          {[['1m',s.load_avg_1],['5m',s.load_avg_5],['15m',s.load_avg_15]].map(([l,v])=>(
            <span key={l} style={{fontSize:12}}>
              <span style={{fontSize:10,color:'var(--bv-txt3)',marginRight:4}}>{l}</span>
              <strong style={{color:parseFloat(v)>8?'var(--bv-red)':parseFloat(v)>4?'var(--bv-amber)':'var(--bv-txt)'}}>
                {parseFloat(v).toFixed(2)}
              </strong>
            </span>
          ))}
          {s.master_host && <span style={{marginLeft:'auto',fontSize:11,color:'var(--bv-txt3)'}}>
            Master: <span style={{color:'var(--bv-cyan)',fontFamily:'monospace'}}>{s.master_host}</span>
          </span>}
        </div>
      )}

      {/* Active processes */}
      {s.process_list?.length>0 && (
        <div>
          <div style={{fontSize:10,fontWeight:600,color:'var(--bv-txt3)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:6}}>
            Active processes — top by CPU
          </div>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
            <thead><tr>
              {['User','PID','CPU%','Mem%','Command'].map(h=>(
                <th key={h} style={{textAlign:'left',padding:'4px 8px',color:'var(--bv-txt3)',
                  fontWeight:600,borderBottom:'1px solid var(--bv-bd)',fontSize:10,
                  textTransform:'uppercase',letterSpacing:'.05em'}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {s.process_list.slice(0,8).map((p,i)=>(
                <tr key={i} style={{background:i%2?'transparent':'var(--bv-bg3)'}}>
                  <td style={{padding:'4px 8px',color:'var(--bv-txt3)'}}>{p.user}</td>
                  <td style={{padding:'4px 8px',fontFamily:'monospace',color:'var(--bv-txt3)',fontSize:10}}>{p.pid}</td>
                  <td style={{padding:'4px 8px',fontWeight:600,
                    color:parseFloat(p.cpu)>50?'var(--bv-red)':parseFloat(p.cpu)>20?'var(--bv-amber)':'var(--bv-txt)'}}>
                    {parseFloat(p.cpu).toFixed(1)}
                  </td>
                  <td style={{padding:'4px 8px',color:'var(--bv-txt2)'}}>{parseFloat(p.mem).toFixed(1)}</td>
                  <td style={{padding:'4px 8px',fontFamily:'monospace',color:'var(--bv-txt2)',
                    maxWidth:280,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.command}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>}
  </div>;
}

// ── NFS CARD ──────────────────────────────────────────────────────────────────
function NFSCard({ s, onCheck, checking }) {
  const [open, setOpen] = useState(false);
  const [hist, setHist] = useState([]);
  const pct = parseFloat(s.disk_pct)||0;
  const col = pct>=90?'var(--bv-red)':pct>=80?'var(--bv-amber)':'var(--bv-green)';
  const icon = NFS_ROLE_META[s.role]||'server';

  const loadHist = useCallback(async () => {
    try { setHist(await monitoringAPI.nfsHistory(s.id,60)); } catch {}
  }, [s.id]);

  useEffect(()=>{ if(open) loadHist(); },[open,loadHist]);

  return <div style={{background:'var(--bv-card)',border:`1px solid ${pct>=90?'var(--bv-red)':pct>=80?'var(--bv-amber)':'var(--bv-bd)'}`,borderRadius:11,overflow:'hidden',marginBottom:8}}>
    <div style={{display:'flex',alignItems:'center',gap:10,padding:'11px 14px',cursor:'pointer'}} onClick={()=>setOpen(o=>!o)}>
      <div style={{width:36,height:36,borderRadius:9,background:'var(--bv-bg3)',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
        <i className={`ti ti-${icon}`} style={{fontSize:18,color:col}}/>
      </div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:13,fontWeight:500,color:'var(--bv-txt)'}}>{s.name}</div>
        <div style={{fontSize:11,color:'var(--bv-txt3)',marginTop:2}}>
          <span style={{fontFamily:'monospace',color:'var(--bv-cyan)'}}>{s.host}</span>
          <span>:{s.export_path} → {s.mount_point}</span>
        </div>
      </div>
      <div style={{flexShrink:0,minWidth:180}}>
        {s.disk_size ? <>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:2}}>
            <span style={{color:'var(--bv-txt3)'}}>{s.disk_used}/{s.disk_size}</span>
            <strong style={{color:col}}>{pct}%</strong>
          </div>
          <PctBar pct={pct}/>
          {s.inode_pct!=null && <div style={{fontSize:10,color:'var(--bv-txt3)',marginTop:2}}>Inodes: {s.inode_pct}%</div>}
        </> : <span style={{fontSize:11,color:'var(--bv-txt3)',fontStyle:'italic'}}>Not checked</span>}
      </div>
      <div style={{display:'flex',gap:6,flexShrink:0}} onClick={e=>e.stopPropagation()}>
        <Btn variant="ghost" size="sm" icon="refresh" loading={checking===s.id}
          onClick={()=>onCheck(s.id)}>Check</Btn>
        <i className={`ti ti-chevron-${open?'up':'down'}`} style={{fontSize:14,color:'var(--bv-txt3)',padding:4,alignSelf:'center'}}/>
      </div>
    </div>
    {open && hist.length>=1 && (
      <div style={{borderTop:'1px solid var(--bv-bd)',padding:'10px 14px',background:'var(--bv-bg3)'}}>
        <div style={{fontSize:10,color:'var(--bv-txt3)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:6}}>Disk % — 60 min history</div>
        <WaveGraph data={hist} lines={[{key:'disk_pct',color:col,label:'Disk %',ref:80}]}/>
      </div>
    )}
  </div>;
}

// ── MAIN DASHBOARD ────────────────────────────────────────────────────────────
export default function MonitoringDashboard() {
  const [groups,    setGroups]    = useState({});
  const [nfs,       setNfs]       = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [collecting,setCollecting]= useState(null);
  const [checkNfs,  setCheckNfs]  = useState(null);
  const [collAll,   setCollAll]   = useState(false);
  const [tab,       setTab]       = useState('db');
  const [addModal,  setAddModal]  = useState(false);
  const [addForm,   setAddForm]   = useState({name:'',host:'',port:3306,db_type:'mysql',environment:'live',vip_host:'',ha_role:'slave',ssh_user:'root',ssh_port:22,db_user:'',db_password:'',description:''});
  const lastRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [g,n] = await Promise.all([monitoringAPI.serversGrouped(), nfsAPI.list()]);
      setGroups(g||{}); setNfs(n||[]);
      lastRef.current = new Date();
    } catch(e) { toast(e.message,'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(()=>{ load(); },[load]);
  useEffect(()=>{ const t=setInterval(load,60000); return()=>clearInterval(t); },[load]);

  async function handleCollect(id) {
    setCollecting(id);
    try {
      await monitoringAPI.serverCollect(id);
      await load();
      toast('Collected — click server row to see wave graphs');
    }
    catch(e) { toast(e.message,'error'); }
    finally { setCollecting(null); }
  }

  async function handleCollectAll() {
    setCollAll(true);
    try { const r=await monitoringAPI.serverCollectAll(); await load(); toast(`Collected ${r.collected} servers`); }
    catch(e) { toast(e.message,'error'); }
    finally { setCollAll(false); }
  }

  async function handleNfsCheck(id) {
    setCheckNfs(id);
    try { const r=await nfsAPI.check(id); setNfs(p=>p.map(s=>s.id===id?{...s,...r}:s)); toast(`${r.name}: ${r.status}`); }
    catch(e) { toast(e.message,'error'); }
    finally { setCheckNfs(null); }
  }

  async function handleAddServer(e) {
    e.preventDefault();
    try { await monitoringAPI.serverAdd(addForm); toast('Server added'); setAddModal(false); await load(); }
    catch(e) { toast(e.message,'error'); }
  }

  const allServers = Object.values(groups).flat();
  const total  = allServers.length;
  const online = allServers.filter(s=>s.last_status==='ok'||s.last_status==='online'||!s.last_status).length;
  const warn   = allServers.filter(s=>s.last_status==='warn').length;
  const crit   = allServers.filter(s=>s.last_status==='critical').length;
  const lastCollect = allServers.reduce((m,s) => {
    if (!s.snapshot_at) return m;
    const t = new Date(s.snapshot_at);
    return !m || t > m ? t : m;
  }, null);
  const nfsGroups = {};
  nfs.forEach(s=>{ const r=s.role||'other'; if(!nfsGroups[r]) nfsGroups[r]=[]; nfsGroups[r].push(s); });

  return <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
    {/* Header */}
    <div style={{padding:'14px 22px 0',borderBottom:'1px solid var(--bv-bd)',background:'var(--bv-bg2)',flexShrink:0}}>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:12}}>
        <div>
          <div style={{fontSize:20,fontWeight:500,color:'var(--bv-txt)',display:'flex',alignItems:'center',gap:9}}>
            <i className="ti ti-activity" style={{color:'var(--bv-blue)',fontSize:22}}/>
            Server Monitoring
          </div>
          <div style={{fontSize:12,color:'var(--bv-txt2)',marginTop:3,display:'flex',gap:10}}>
            <span>{total} physical DB servers · {nfs.length} NFS servers</span>
            <span style={{color:'var(--bv-green)'}}>{online} OK</span>
            {warn>0&&<span style={{color:'var(--bv-amber)'}}>{warn} warn</span>}
            {crit>0&&<span style={{color:'var(--bv-red)'}}>{crit} critical</span>}
            {lastCollect&&<span style={{color:'var(--bv-txt3)'}}>· last collect {lastCollect.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</span>}
            {lastRef.current&&<span style={{color:'var(--bv-txt3)'}}>· refreshed {lastRef.current.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</span>}
          </div>
        </div>
        <div style={{display:'flex',gap:8}}>
          {tab==='db'&&<Btn variant="ghost" icon="refresh" loading={collAll} onClick={handleCollectAll}>Collect All</Btn>}
          {tab==='nfs'&&<Btn variant="ghost" icon="refresh" loading={!!checkNfs} onClick={async()=>{
            setCheckNfs('all');
            try { setNfs(await nfsAPI.checkAll()); toast('All NFS servers checked'); }
            catch(e){ toast(e.message,'error'); }
            finally { setCheckNfs(null); }
          }}>Check all NFS</Btn>}
          <Btn variant="primary" icon="plus" onClick={()=>setAddModal(true)}>Add Server</Btn>
          <Btn variant="ghost"   icon="refresh" onClick={load}>Refresh</Btn>
        </div>
      </div>
      {/* Tabs */}
      <div style={{display:'flex'}}>
        {[{id:'db',label:`DB Servers (${total})`,icon:'database'},{id:'nfs',label:`NFS Servers (${nfs.length})`,icon:'server-bolt'}].map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:'8px 18px',background:'none',border:'none',cursor:'pointer',
            fontSize:13,fontWeight:tab===t.id?600:400,
            color:tab===t.id?'var(--bv-blue)':'var(--bv-txt3)',
            borderBottom:tab===t.id?'2px solid var(--bv-blue)':'2px solid transparent',
            display:'flex',alignItems:'center',gap:7}}>
            <i className={`ti ti-${t.icon}`} style={{fontSize:14}}/>{t.label}
          </button>
        ))}
      </div>
    </div>

    {/* Body */}
    <div style={{flex:1,overflowY:'auto',padding:'14px 22px'}}>
      {loading ? <div style={{display:'flex',justifyContent:'center',padding:60,gap:12,color:'var(--bv-txt3)'}}><Spinner size={28}/>Loading...</div>
      : tab==='db' ? (
        <>
          {ENV_ORDER.filter(env=>groups[env]?.length).map(env=>{
            const meta=ENV_META[env]||ENV_META.other;
            const servers=groups[env]||[];
            return <div key={env} style={{marginBottom:20}}>
              <div style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',
                background:meta.bg,border:`1px solid ${meta.color}`,borderRadius:9,marginBottom:10}}>
                <i className={`ti ti-${meta.icon}`} style={{fontSize:15,color:meta.color}}/>
                <span style={{fontSize:13,fontWeight:600,color:meta.color}}>{meta.label}</span>
                <span style={{fontSize:11,color:'var(--bv-txt3)'}}>— {servers.length} physical server{servers.length!==1?'s':''}</span>
                <div style={{flex:1}}/>
                <span style={{fontSize:11,color:'var(--bv-txt3)'}}>
                  MySQL: {servers.filter(s=>s.db_type==='mysql').length} · 
                  PostgreSQL: {servers.filter(s=>s.db_type==='postgresql').length}
                </span>
              </div>
              {servers.map(s=><ServerCard key={s.id} server={s} onCollect={handleCollect} collecting={collecting}/>)}
            </div>;
          })}
          {!total&&<div style={{textAlign:'center',padding:60,color:'var(--bv-txt3)'}}>
            <i className="ti ti-database-off" style={{fontSize:52,display:'block',marginBottom:14,color:'var(--bv-bd2)'}}/>
            <div style={{fontSize:15,fontWeight:500,color:'var(--bv-txt2)',marginBottom:6}}>No servers configured</div>
            <Btn variant="primary" icon="plus" onClick={()=>setAddModal(true)}>Add Server</Btn>
          </div>}
        </>
      ) : (
        Object.entries(nfsGroups).map(([role,servers])=>(
          <div key={role} style={{marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:600,color:'var(--bv-txt2)',textTransform:'uppercase',
              letterSpacing:'.07em',marginBottom:8,paddingBottom:5,borderBottom:'1px solid var(--bv-bd)'}}>
              {role.replace('_',' ')} — {servers.length} server{servers.length!==1?'s':''}
            </div>
            {servers.map(s=><NFSCard key={s.id} s={s} onCheck={handleNfsCheck} checking={checkNfs}/>)}
          </div>
        ))
      )}
    </div>

    {/* Add Server Modal */}
    <Modal open={addModal} onClose={()=>setAddModal(false)} title="Add Physical DB Server" width={520}>
      <form onSubmit={handleAddServer} style={{display:'flex',flexDirection:'column',gap:0}}>
        <Field label="Display name" required hint='e.g. "MySQL-Slave-01 (10.180.0.212)"'>
          <input value={addForm.name} onChange={e=>setAddForm(p=>({...p,name:e.target.value}))} style={{width:'100%'}} required placeholder="MySQL-Slave-01 (10.180.0.212)"/>
        </Field>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 90px',gap:'0 12px'}}>
          <Field label="Host / IP (slave, not VIP)" required>
            <input value={addForm.host} onChange={e=>setAddForm(p=>({...p,host:e.target.value}))} style={{width:'100%',fontFamily:'monospace'}} required placeholder="10.180.0.212"/>
          </Field>
          <Field label="DB Type">
            <select value={addForm.db_type} onChange={e=>setAddForm(p=>({...p,db_type:e.target.value}))} style={{width:'100%'}}>
              <option value="mysql">MySQL</option>
              <option value="postgresql">PostgreSQL</option>
              <option value="redis">Redis</option>
            </select>
          </Field>
          <Field label="Port">
            <input type="number" value={addForm.port} onChange={e=>setAddForm(p=>({...p,port:parseInt(e.target.value)}))} style={{width:'100%',fontFamily:'monospace'}}/>
          </Field>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0 12px'}}>
          <Field label="Environment">
            <select value={addForm.environment} onChange={e=>setAddForm(p=>({...p,environment:e.target.value}))} style={{width:'100%'}}>
              <option value="live">Live / Production</option>
              <option value="pre_production">Pre-Production</option>
              <option value="qa">QA</option>
              <option value="development">Development</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="HA Role">
            <select value={addForm.ha_role} onChange={e=>setAddForm(p=>({...p,ha_role:e.target.value}))} style={{width:'100%'}}>
              <option value="slave">Slave (Replica)</option>
              <option value="master">Master</option>
              <option value="standalone">Standalone</option>
            </select>
          </Field>
        </div>
        <Field label="Keepalived VIP (reference only)" hint="The VIP managed by Keepalived — for display only">
          <input value={addForm.vip_host} onChange={e=>setAddForm(p=>({...p,vip_host:e.target.value}))} style={{width:'100%',fontFamily:'monospace'}} placeholder="10.180.0.200 (VIP)"/>
        </Field>
        <div style={{display:'grid',gridTemplateColumns:'1fr 90px 1fr',gap:'0 12px'}}>
          <Field label="SSH User">
            <input value={addForm.ssh_user} onChange={e=>setAddForm(p=>({...p,ssh_user:e.target.value}))} style={{width:'100%',fontFamily:'monospace'}} placeholder="root"/>
          </Field>
          <Field label="SSH Port">
            <input type="number" value={addForm.ssh_port} onChange={e=>setAddForm(p=>({...p,ssh_port:parseInt(e.target.value)}))} style={{width:'100%',fontFamily:'monospace'}}/>
          </Field>
          <Field label="DB User (read-only)" hint="For SHOW STATUS queries">
            <input value={addForm.db_user} onChange={e=>setAddForm(p=>({...p,db_user:e.target.value}))} style={{width:'100%',fontFamily:'monospace'}} placeholder="monitor_user"/>
          </Field>
        </div>
        <Field label="DB Password">
          <input type="password" value={addForm.db_password} onChange={e=>setAddForm(p=>({...p,db_password:e.target.value}))} style={{width:'100%'}}/>
        </Field>
        <div style={{padding:'8px 12px',background:'var(--bv-amber-bg)',border:'1px solid var(--bv-amber)',borderRadius:8,fontSize:11,color:'var(--bv-amber)',marginBottom:12}}>
          <i className="ti ti-shield-check" style={{marginRight:6}}/>
          Monitoring uses SHOW STATUS, SHOW SLAVE STATUS, /proc/* — all read-only. Safe on live slave servers.
        </div>
        <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
          <Btn variant="ghost" type="button" onClick={()=>setAddModal(false)}>Cancel</Btn>
          <Btn variant="primary">Add Server</Btn>
        </div>
      </form>
    </Modal>
  </div>;
}
