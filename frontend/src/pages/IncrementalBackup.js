import { useCallback, useEffect, useState } from 'react';
import { incrementalAPI } from '../services/api';
import { Btn, Spinner, toast } from '../components/UI';

const STATUS = {
  success: { color: 'var(--bv-green)', bg: 'var(--bv-green-bg)', label: 'Executed — success' },
  failed:  { color: 'var(--bv-red)',   bg: 'var(--bv-red-bg)',    label: 'Executed — failed' },
  running: { color: 'var(--bv-amber)', bg: 'var(--bv-amber-bg)',  label: 'Running (lock held)' },
  never:   { color: 'var(--bv-txt3)',  bg: 'var(--bv-bg4)',       label: 'Never executed / log not found' },
  unknown: { color: 'var(--bv-txt2)',  bg: 'var(--bv-bg3)',       label: 'Log present — no SUCCESS/ERROR' },
};

function fmtBytes(b) {
  if (!b) return '—';
  const u = ['B','KB','MB','GB','TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return (b / Math.pow(1024, i)).toFixed(1) + ' ' + u[i];
}

export default function IncrementalBackup() {
  const [jobs, setJobs] = useState([]);
  const [runEnabled, setRunEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(null);
  const [log, setLog] = useState(null);
  const [logBusy, setLogBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await incrementalAPI.jobs();
      setJobs(d.jobs || []);
      setRunEnabled(!!d.runEnabled);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  async function openLog(job) {
    setSel(job.id);
    setLogBusy(true);
    try { setLog(await incrementalAPI.log(job.id, 250)); }
    catch (e) { toast(e.message, 'error'); setLog({ text: '', exists: false, logFile: job.logFile }); }
    finally { setLogBusy(false); }
  }

  const selected = jobs.find(j => j.id === sel);

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'14px 22px 12px', borderBottom:'1px solid var(--bv-bd)', background:'var(--bv-bg2)', flexShrink:0,
        display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div>
          <div style={{ fontSize:20, fontWeight:500, color:'var(--bv-txt)', display:'flex', alignItems:'center', gap:9 }}>
            <i className="ti ti-layers-difference" style={{ color:'var(--bv-blue)', fontSize:22 }}/>
            Incremental Backup
          </div>
          <div style={{ fontSize:12, color:'var(--bv-txt2)', marginTop:3 }}>
            Rule 3 — rsync + MD5 of staged dumps via scripts_for_incremental_backup · status from /var/log/*-incremental.log
          </div>
        </div>
        <Btn variant="ghost" icon="refresh" onClick={load}>Refresh</Btn>
      </div>

      <div style={{ flex:1, overflow:'hidden', display:'flex' }}>
        <div style={{ flex:1.4, overflowY:'auto', padding:'16px 18px' }}>
          {loading ? <div style={{ display:'flex', justifyContent:'center', padding:40 }}><Spinner/></div> : (
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  {['Database','Status','Last success','Source file','Remote','Log'].map(h => (
                    <th key={h} style={{ textAlign:'left', fontSize:10, color:'var(--bv-txt3)', letterSpacing:'.06em',
                      textTransform:'uppercase', padding:'6px 8px', borderBottom:'1px solid var(--bv-bd)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobs.map(j => {
                  const st = STATUS[j.status] || STATUS.unknown;
                  return (
                    <tr key={j.id} onClick={() => openLog(j)}
                      style={{ cursor:'pointer', background: sel===j.id ? 'var(--bv-blue-dim)' : 'transparent' }}
                      onMouseEnter={e => { if (sel!==j.id) e.currentTarget.style.background='var(--bv-bg3)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = sel===j.id ? 'var(--bv-blue-dim)' : 'transparent'; }}>
                      <td style={{ padding:'10px 8px', borderBottom:'1px solid var(--bv-bd)' }}>
                        <div style={{ fontSize:13, fontWeight:500, color:'var(--bv-txt)' }}>{j.name}</div>
                        <div style={{ fontSize:10, color:'var(--bv-txt3)', fontFamily:'monospace' }}>{j.script}</div>
                      </td>
                      <td style={{ padding:'10px 8px', borderBottom:'1px solid var(--bv-bd)' }}>
                        <span style={{ fontSize:11, padding:'2px 8px', borderRadius:10, fontWeight:600,
                          background:st.bg, color:st.color }}>{st.label}</span>
                      </td>
                      <td style={{ padding:'10px 8px', borderBottom:'1px solid var(--bv-bd)', fontSize:11, color:'var(--bv-txt2)' }}>
                        {j.lastSuccessAt || '—'}
                      </td>
                      <td style={{ padding:'10px 8px', borderBottom:'1px solid var(--bv-bd)', fontSize:11 }}>
                        <span style={{ color: j.source?.present ? 'var(--bv-green)' : 'var(--bv-amber)' }}>
                          {j.source?.present ? fmtBytes(j.source.size) : 'missing'}
                        </span>
                      </td>
                      <td style={{ padding:'10px 8px', borderBottom:'1px solid var(--bv-bd)', fontSize:10, color:'var(--bv-cyan)', fontFamily:'monospace' }}>
                        {j.destHost}:{j.destDir}
                      </td>
                      <td style={{ padding:'10px 8px', borderBottom:'1px solid var(--bv-bd)', fontSize:10, color:'var(--bv-txt3)' }}>
                        {j.logExists ? 'present' : 'not found'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {!runEnabled && (
            <div style={{ marginTop:12, fontSize:11, color:'var(--bv-txt3)' }}>
              Script run from the UI is off (logs only). Set INCREMENTAL_ALLOW_RUN=true on the backend to enable.
            </div>
          )}
        </div>

        <div style={{ flex:1, borderLeft:'1px solid var(--bv-bd)', display:'flex', flexDirection:'column', minWidth:0, background:'var(--bv-bg2)' }}>
          <div style={{ padding:'12px 14px', borderBottom:'1px solid var(--bv-bd)', fontSize:12, color:'var(--bv-txt2)' }}>
            {selected ? (
              <>
                <strong style={{ color:'var(--bv-txt)' }}>{selected.name}</strong>
                <span style={{ marginLeft:8, fontFamily:'monospace', color:'var(--bv-cyan)', fontSize:11 }}>{selected.logFile}</span>
                {selected.lastLine && <div style={{ marginTop:4, fontSize:11, color:'var(--bv-txt3)' }}>{selected.lastLine}</div>}
              </>
            ) : 'Select a database to view its incremental log'}
          </div>
          <div style={{ flex:1, overflow:'auto', padding:12, fontFamily:'ui-monospace,monospace', fontSize:11, lineHeight:1.55, color:'var(--bv-txt2)', whiteSpace:'pre-wrap' }}>
            {logBusy ? <Spinner/> : !sel ? null : !log?.exists ? (
              <span style={{ color:'var(--bv-amber)' }}>Log not found — script has not run on this host, or the log path is not readable.</span>
            ) : (log.text || '').split('\n').map((line, i) => {
              const col = line.includes('SUCCESS:') ? 'var(--bv-green)'
                : line.includes('ERROR:') ? 'var(--bv-red)'
                : line.includes('INFO:') ? 'var(--bv-txt2)' : 'var(--bv-txt3)';
              return <div key={i} style={{ color: col }}>{line}</div>;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
