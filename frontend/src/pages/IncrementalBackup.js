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

function fmtWhen(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function IncrementalBackup() {
  const [jobs, setJobs] = useState([]);
  const [meta, setMeta] = useState(null);
  const [runEnabled, setRunEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(null);
  const [log, setLog] = useState(null);
  const [logBusy, setLogBusy] = useState(false);
  const [runningId, setRunningId] = useState(null);
  const [runningAll, setRunningAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await incrementalAPI.jobs();
      setJobs(d.jobs || []);
      setRunEnabled(!!d.runEnabled);
      setMeta(d);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  async function openLog(job) {
    setSel(job.id);
    setLogBusy(true);
    try { setLog(await incrementalAPI.log(job.id, 250)); }
    catch (e) { toast(e.message, 'error'); setLog({ text: '', exists: false, logFile: job.logFile }); }
    finally { setLogBusy(false); }
  }

  async function runOne(e, job) {
    e.stopPropagation();
    setRunningId(job.id);
    try {
      await incrementalAPI.run(job.id);
      toast(`Started ${job.name} on ${meta?.sshTarget || 'db-backup'}`, 'success');
      setTimeout(load, 2000);
    } catch (err) { toast(err.message, 'error'); }
    finally { setRunningId(null); }
  }

  async function runAll() {
    setRunningAll(true);
    try {
      await incrementalAPI.runAll();
      toast('4-hour sync cycle started — jobs run one after another on 10.180.0.90', 'success');
      setMeta(m => m ? { ...m, cycleRunning: true } : m);
      setTimeout(load, 2000);
    } catch (err) { toast(err.message, 'error'); }
    finally { setRunningAll(false); }
  }

  const selected = jobs.find(j => j.id === sel);
  const sshOk = meta?.hostReachable === true;
  const cycleBusy = !!meta?.cycleRunning;

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minHeight:0 }}>
      <div style={{ padding:'14px 22px 12px', borderBottom:'1px solid var(--bv-bd)', background:'var(--bv-bg2)', flexShrink:0,
        display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:16 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:500, color:'var(--bv-txt)', display:'flex', alignItems:'center', gap:9 }}>
            <i className="ti ti-layers-difference" style={{ color:'var(--bv-blue)', fontSize:22 }}/>
            Incremental Backup
          </div>
          <div style={{ fontSize:12, color:'var(--bv-txt2)', marginTop:3 }}>
            Rule 3 — first-time full copy of the staged dump to Remote Onsite, then rsync every 4 hours from {meta?.sshTarget || 'root@10.180.0.90'}
          </div>
        </div>
        <div style={{ display:'flex', gap:8, flexShrink:0 }}>
          {runEnabled && (
            <Btn variant="primary" icon="player-play" loading={runningAll || cycleBusy} onClick={runAll}
              disabled={!sshOk}>
              {cycleBusy ? 'Cycle running…' : 'Run all now'}
            </Btn>
          )}
          <Btn variant="ghost" icon="refresh" onClick={load}>Refresh</Btn>
        </div>
      </div>

      <div style={{ padding:'10px 22px', borderBottom:'1px solid var(--bv-bd)', background:'var(--bv-bg)', flexShrink:0,
        display:'flex', flexWrap:'wrap', gap:18, fontSize:12, color:'var(--bv-txt2)' }}>
        <span>
          <strong style={{ color:'var(--bv-txt3)', fontSize:10, letterSpacing:'.06em', textTransform:'uppercase', marginRight:6 }}>Host</strong>
          <span style={{ fontFamily:'monospace', color:'var(--bv-cyan)' }}>{meta?.sshTarget || 'root@10.180.0.90'}</span>
          <span style={{ marginLeft:8, fontSize:11, padding:'2px 8px', borderRadius:10, fontWeight:600,
            background: sshOk ? 'var(--bv-green-bg)' : 'var(--bv-red-bg)',
            color: sshOk ? 'var(--bv-green)' : 'var(--bv-red)' }}>
            {meta == null ? '…' : sshOk ? 'SSH OK' : 'SSH failed'}
          </span>
        </span>
        <span>
          <strong style={{ color:'var(--bv-txt3)', fontSize:10, letterSpacing:'.06em', textTransform:'uppercase', marginRight:6 }}>Schedule</strong>
          every 4 hours · {meta?.timezone || 'Asia/Kolkata'} · next {fmtWhen(meta?.nextRunAt)}
        </span>
        <span>
          <strong style={{ color:'var(--bv-txt3)', fontSize:10, letterSpacing:'.06em', textTransform:'uppercase', marginRight:6 }}>Last cycle</strong>
          {meta?.lastCycle?.startedAt
            ? `${meta.lastCycle.trigger || ''} ${fmtWhen(meta.lastCycle.startedAt)}${meta.lastCycle.finishedAt ? ' → ' + fmtWhen(meta.lastCycle.finishedAt) : ' (in progress)'}`
            : 'none since process start'}
        </span>
        {meta?.hostError && (
          <span style={{ color:'var(--bv-red)' }}>{meta.hostError}</span>
        )}
      </div>

      <div style={{ flex:1, overflow:'hidden', display:'flex', minHeight:0 }}>
        <div style={{ flex:1.4, overflowY:'auto', padding:'16px 18px' }}>
          {loading ? <div style={{ display:'flex', justifyContent:'center', padding:40 }}><Spinner/></div> : (
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  {['Database','Status','Last success','Source file','Remote','Log', runEnabled ? 'Run' : null].filter(Boolean).map(h => (
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
                      {runEnabled && (
                        <td style={{ padding:'10px 8px', borderBottom:'1px solid var(--bv-bd)' }} onClick={e => e.stopPropagation()}>
                          <Btn size="sm" icon="player-play" loading={runningId===j.id} disabled={!sshOk || j.status==='running'}
                            onClick={(e) => runOne(e, j)}>
                            Run
                          </Btn>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {!runEnabled && (
            <div style={{ marginTop:12, fontSize:11, color:'var(--bv-txt3)' }}>
              Script run from the UI is off. Set INCREMENTAL_ALLOW_RUN=true on the backend to enable (scheduled 4-hour runs still fire).
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
            ) : 'Select a database to view its incremental log on 10.180.0.90'}
          </div>
          <div style={{ flex:1, overflow:'auto', padding:12, fontFamily:'ui-monospace,monospace', fontSize:11, lineHeight:1.55, color:'var(--bv-txt2)', whiteSpace:'pre-wrap' }}>
            {logBusy ? <Spinner/> : !sel ? null : !log?.exists ? (
              <span style={{ color:'var(--bv-amber)' }}>
                {log?.error || 'Log not found on 10.180.0.90 — script has not run yet, or the log path is not readable.'}
              </span>
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
