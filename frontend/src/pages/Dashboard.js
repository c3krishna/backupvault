// frontend/src/pages/Dashboard.js
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { dashboardAPI, backupAPI, targetsAPI, storageAPI, infraAPI, destinationsAPI, monitoringAPI, nfsAPI } from '../services/api';
import { StatCard, Card, Badge, Btn, Spinner, toast } from '../components/UI';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { format, subDays, parseISO } from 'date-fns';

const C = {
  bg:    'var(--bv-bg)', bg2: 'var(--bv-bg2)', bg3: 'var(--bv-bg3)',
  bd:    'var(--bv-bd)', bd2: 'var(--bv-bd2)',
  txt:   'var(--bv-txt)', txt2: 'var(--bv-txt2)', txt3: 'var(--bv-txt3)',
  blue:  'var(--bv-blue)', green: 'var(--bv-green)', red: 'var(--bv-red)',
  amber: 'var(--bv-amber)', cyan: 'var(--bv-cyan)', purple: 'var(--bv-purple)',
  blueBg:'var(--bv-blue-dim)', greenBg:'var(--bv-green-dim)', redBg:'var(--bv-red-dim)',
  amberBg:'var(--bv-amber-bg)',
};

function fmtBytes(b) {
  if (!b || b===0) return '0 B';
  const u=['B','KB','MB','GB','TB'];
  const i=Math.floor(Math.log(b)/Math.log(1024));
  return (b/Math.pow(1024,i)).toFixed(1)+' '+u[i];
}

function CalendarGrid({ data }) {
  const today = new Date();
  const cells = [];
  for (let i=34; i>=0; i--) {
    const d   = subDays(today, i);
    const key = format(d,'yyyy-MM-dd');
    const day = data.find(r=>r.date===key);
    cells.push({ date:d, day, key, isToday:i===0 });
  }
  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:0,marginBottom:4}}>
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>(
          <div key={d} style={{textAlign:'center',fontSize:10,color:C.txt3,fontWeight:500,padding:'4px 0',textTransform:'uppercase',letterSpacing:'.04em'}}>{d}</div>
        ))}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:1,background:C.bd}}>
        {cells.map(({date,day,key,isToday})=>(
          <div key={key} style={{background:isToday?C.blueBg:C.bg3,minHeight:48,padding:'4px 6px'}}>
            <div style={{fontSize:10,color:isToday?C.blue:C.txt3,fontWeight:500}}>{format(date,'d')}</div>
            {day && (
              <div style={{display:'flex',gap:2,marginTop:3,flexWrap:'wrap'}}>
                {day.success>0 && <span style={{width:5,height:5,borderRadius:'50%',background:C.green}} title={`${day.success} success`}/>}
                {day.partial>0 && <span style={{width:5,height:5,borderRadius:'50%',background:C.purple}} title={`${day.partial} partial`}/>}
                {day.failed>0  && <span style={{width:5,height:5,borderRadius:'50%',background:C.red}} title={`${day.failed} failed`}/>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SBar({ pct, height=6 }) {
  const col = pct>=90?C.red:pct>=80?C.amber:C.green;
  return (
    <div style={{width:'100%',height,background:C.bg3,borderRadius:height/2,overflow:'hidden',margin:'4px 0'}}>
      <div style={{height:'100%',width:`${pct}%`,background:col,borderRadius:height/2}}/>
    </div>
  );
}

function RuleTag({ type, children }) {
  const styles = {
    auto:   { bg:C.blueBg,   color:C.blue  },
    alert:  { bg:C.redBg,    color:C.red   },
    manual: { bg:C.amberBg,  color:C.amber },
    ok:     { bg:C.greenBg,  color:C.green },
    pro:    { bg:'var(--bv-purple-bg)',  color:C.purple},
  };
  const s = styles[type]||styles.ok;
  return (
    <span style={{display:'inline-flex',alignItems:'center',gap:3,fontSize:10,padding:'2px 7px',borderRadius:10,fontWeight:500,background:s.bg,color:s.color,whiteSpace:'nowrap'}}>
      {children}
    </span>
  );
}

export default function Dashboard() {
  const [stats,      setStats]      = useState(null);
  const [calendar,   setCalendar]   = useState([]);
  const [recent,     setRecent]     = useState([]);
  const [targets,    setTargets]    = useState([]);
  const [storStats,  setStorStats]  = useState(null);
  const [infraData,  setInfraData]  = useState(null);
  const [ociDest,    setOciDest]    = useState({});
  const [monGroups,  setMonGroups]  = useState({});
  const [nfsServers, setNfsServers] = useState([]);
  const [healthAt,   setHealthAt]   = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [trigTarget, setTrigTarget] = useState('all');
  const [trigType,   setTrigType]   = useState('full');
  const [triggering, setTriggering] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const [s,c,r,t] = await Promise.all([
        dashboardAPI.stats(), dashboardAPI.calendar(35),
        dashboardAPI.recentRuns(), targetsAPI.list(),
      ]);
      setStats(s); setCalendar(c); setRecent(r.slice(0,8)); setTargets(t);
      // Load storage + infra in background (non-blocking)
      storageAPI.stats().then(setStorStats).catch(()=>{});
      infraAPI.health().then(h => { setInfraData(h); setHealthAt(h?.checked_at || new Date().toISOString()); }).catch(()=>{});
      destinationsAPI.list().then(list => {
        const oci = (list||[]).find(d => d.dest_type==='oci_object' && d.is_active);
        if (oci) setOciDest(oci);
      }).catch(()=>{});
      monitoringAPI.serversGrouped().then(setMonGroups).catch(()=>{});
      nfsAPI.list().then(setNfsServers).catch(()=>{});
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(()=>{ load(); const t=setInterval(load,30000); return ()=>clearInterval(t); },[load]);

  async function handleTrigger() {
    setTriggering(true);
    try {
      if (trigTarget==='all') { await backupAPI.triggerAll(trigType); toast('Backup initiated for all targets'); }
      else { await backupAPI.trigger(parseInt(trigTarget), undefined, trigType); toast('Backup initiated'); }
      setTimeout(load, 2000);
    } catch(e) { toast(e.message,'error'); }
    finally { setTriggering(false); }
  }

  const chartData = Array.from({length:14},(_,i)=>{
    const d     = format(subDays(new Date(),13-i),'yyyy-MM-dd');
    const found = calendar.find(r=>r.date===d);
    return { date:format(parseISO(d),'MMM d'), success:found?.success||0, partial:found?.partial||0, failed:found?.failed||0 };
  });

  function exportRecent() {
    const header = ['id','target','status','backup_type','started_at','file_size_bytes'];
    const lines = [header.join(',')].concat(
      (recent||[]).map(r => [r.id, r.target_name, r.status, r.backup_type, r.started_at, r.file_size_bytes]
        .map(v => `"${String(v??'').replace(/"/g,'""')}"`).join(','))
    );
    const blob = new Blob([lines.join('\n')], { type:'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `backupvault-recent-${format(new Date(),'yyyy-MM-dd')}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const today    = stats?.today?.[0] || {};
  const storage  = storStats?.byTarget || [];
  const primary  = infraData?.storage?.primary || {};
  const remote   = infraData?.remote || [];
  const s3List   = infraData?.s3 || [];

  // diskPct = real NFS volume % (used for 80% alerts and sidebar badge)
  // backupPct = actual backup files % (shown as informational)
  const primaryPct    = parseInt(primary?.diskPct || primary?.usedPct || 0);
  const primaryBkPct  = parseInt(primary?.backupPct || primaryPct);
  const secondary     = infraData?.storage?.secondary || {};
  const secondaryPct  = parseInt(secondary?.diskPct || secondary?.usedPct || 0);
  const remoteData  = remote[0] || {};
  const remotePct   = parseInt(remoteData?.disk?.usePercent) || 0;
  const s3Data      = s3List[0] || {};
  const ociData     = ociDest || {};
  const nfsOffline  = nfsServers.filter(s => s.status==='offline').length;
  const nfsCrit     = nfsServers.filter(s => s.status==='critical').length;
  const nfsWarn     = nfsServers.filter(s => s.status==='warn').length;
  const monServers  = Object.values(monGroups||{}).flat();
  const systemsOk   = (today.failed||0)===0 && nfsCrit===0 && nfsOffline===0 && primaryPct<90;
  const lastSyncLabel = healthAt
    ? format(new Date(healthAt), 'HH:mm:ss')
    : (nfsServers.find(s=>s.last_check)?.last_check ? format(new Date(nfsServers.find(s=>s.last_check).last_check), 'HH:mm:ss') : '—');
  function monForTarget(t) {
    return monServers.find(s => String(s.host)===String(t.host) && Number(s.port)===Number(t.port));
  }

  const sel = { fontSize:12, padding:'6px 10px', background:C.bg3, border:`1px solid ${C.bd2}`, color:C.txt, borderRadius:8 };
  const th  = { textAlign:'left',fontSize:10,color:C.txt3,fontWeight:600,letterSpacing:'.07em',textTransform:'uppercase',padding:'6px 10px',borderBottom:`1px solid ${C.bd}` };
  const td  = (extra={}) => ({ padding:'8px 10px',fontSize:12,borderBottom:`1px solid ${C.bd}`,color:C.txt,...extra });

  return (
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>

      {/* Header */}
      <div style={{padding:'14px 22px 12px',borderBottom:`1px solid ${C.bd}`,background:C.bg2,flexShrink:0,display:'flex',alignItems:'flex-start',justifyContent:'space-between'}}>
        <div>
          <div style={{fontSize:20,fontWeight:500,color:C.txt}}>Dashboard</div>
          <div style={{fontSize:12,color:C.txt2,marginTop:3}}>
            Multi-tier protection · Live DB servers → Primary DB → Secondary → Remote → AWS S3 ·{' '}
            <span style={{color:systemsOk?C.green:C.amber,fontWeight:500}}>
              {systemsOk ? 'All systems healthy' : [
                today.failed>0 && `${today.failed} backup fail`,
                nfsCrit>0 && `${nfsCrit} NFS critical`,
                nfsOffline>0 && `${nfsOffline} NFS offline`,
                primaryPct>=90 && `Primary ${primaryPct}%`,
                nfsWarn>0 && `${nfsWarn} NFS warn`,
              ].filter(Boolean).join(' · ') || 'Check monitoring'}
            </span>
          </div>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          <span style={{fontSize:11,color:C.txt3}}>Last check: {lastSyncLabel}</span>
          <Btn variant="ghost" icon="refresh" size="sm" onClick={load}>Refresh</Btn>
          <Btn variant="ghost" icon="download" size="sm" onClick={exportRecent}>Export</Btn>
          <Btn variant="primary" icon="player-play" loading={triggering} onClick={handleTrigger} size="sm">Run all backups</Btn>
        </div>
      </div>

      <div style={{flex:1,overflowY:'auto',padding:'16px 22px',display:'flex',flexDirection:'column',gap:14}}>

        {/* Initiate backup banner */}
        <div style={{background:`linear-gradient(135deg,${C.bg3} 0%,${C.blueBg} 100%)`,border:`1px solid var(--bv-blue-bg)`,borderRadius:12,padding:'14px 18px',display:'flex',alignItems:'center',gap:14}}>
          <div style={{width:42,height:42,background:'var(--bv-blue-bg)',borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
            <i className="ti ti-database-backup" style={{fontSize:22,color:C.blue}}/>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:14,fontWeight:500,color:C.txt,marginBottom:2}}>Initiate Backup</div>
            <div style={{fontSize:12,color:C.txt2}}>Rule 4 — On-demand full dump: stored to Primary DB + Remote Onsite + S3 (if enabled). Incremental rsync lives under Incremental Backup.</div>
          </div>
          <div style={{display:'flex',gap:8,flexShrink:0,flexWrap:'wrap'}}>
            <select value={trigTarget} onChange={e=>setTrigTarget(e.target.value)} style={sel}>
              <option value="all">All Targets</option>
              {targets.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select value={trigType} onChange={e=>setTrigType(e.target.value)} style={sel}>
              <option value="full">Full Backup</option>
            </select>
            <Btn variant="primary" icon="player-play" loading={triggering} onClick={handleTrigger}>Start Backup</Btn>
          </div>
        </div>

        {/* KPI Row */}
        {loading ? <div style={{display:'flex',justifyContent:'center',padding:40}}><Spinner/></div> : (
          <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:10}}>
            <StatCard label="Live DB servers"  value={stats?.targets||0}            sub={monServers.length?`${monServers.filter(s=>s.last_status==='ok'||s.last_status==='online').length} monitored`:'Configured targets'}      accent="blue"   color="blue"/>
            <StatCard label="Today's runs"     value={today.total_runs||0}          sub={`${today.success||0} success · ${today.failed||0} fail`} color="green" accent="green"/>
            <StatCard label="Backup failures"  value={today.failed||0}              sub="Last 30 days"       color={today.failed>0?'red':'white'} accent="red"/>
            <StatCard label="Primary DB (NFS)" value={primaryPct?`${primaryPct}%`:'—'} sub={`${primary?.diskUsedHuman||primary?.usedHuman||'—'} / ${primary?.totalHuman||'—'} · backup: ${primaryBkPct}%`} color={primaryPct>=80?'amber':'white'} accent="amber"/>
            <StatCard label="Data backed up"   value={fmtBytes(today.total_bytes)}  sub="All destinations"   accent="blue"/>
            <StatCard label="Remote Onsite"    value={remotePct?`${remotePct}%`:(remoteData?.disk?.usePercent||'—')} sub={`${remoteData?.disk?.used||'—'} / ${remoteData?.disk?.size||'—'} · 192.168.12.243`} color={remotePct>=80?'amber':'white'} accent="cyan"/>
            <StatCard label="AWS S3 stored"    value={s3Data?.bucketSize||'—'} sub={s3Data?.objectCount ? `${s3Data.objectCount.toLocaleString()} objects · ${s3Data.region||''}` : 'STANDARD_IA'} color={s3Data?.status==='connected'?'white':'amber'} accent="purple"/>
          </div>
        )}

        {/* Calendar + 14-day chart */}
        <div style={{display:'grid',gridTemplateColumns:'1.4fr 1fr',gap:14}}>
          <Card title="Backup Calendar — Last 35 Days" action={
            <div style={{display:'flex',gap:12,fontSize:11,color:C.txt2}}>
              {[['var(--bv-green)','Success'],['var(--bv-purple)','Partial'],['var(--bv-red)','Failed']].map(([c,l])=>(
                <span key={l} style={{display:'flex',alignItems:'center',gap:4}}>
                  <span style={{width:7,height:7,borderRadius:'50%',background:c,display:'inline-block'}}/>
                  {l}
                </span>
              ))}
            </div>
          }>
            <CalendarGrid data={calendar}/>
          </Card>

          <Card title="14-Day Run History">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{top:0,right:0,left:-20,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
                <XAxis dataKey="date" tick={{fill:C.txt3,fontSize:9}} tickLine={false}/>
                <YAxis tick={{fill:C.txt3,fontSize:9}} tickLine={false} axisLine={false} allowDecimals={false}/>
                <Tooltip contentStyle={{background:C.bg3,border:`1px solid ${C.bd}`,borderRadius:6,fontSize:11}}/>
                <Bar dataKey="success" stackId="a" fill={C.green} name="Success"/>
                <Bar dataKey="partial" stackId="a" fill={C.purple} name="Partial"/>
                <Bar dataKey="failed"  stackId="a" fill={C.red} name="Failed" radius={[3,3,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>

        {/* Storage tiers + DB monitoring + Alerts */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14}}>

          {/* Storage tiers */}
          <Card title="Storage tier health" action={<RuleTag type="ok">Rule 5 — monitor</RuleTag>}>
            {/* Primary DB */}
            <div style={{border:`1px solid ${primaryPct>=80?'var(--bv-red-border)':C.bd}`,borderRadius:8,padding:'10px 12px',marginBottom:8}}>
              <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:6}}>
                <i className="ti ti-device-floppy" style={{fontSize:15,color:C.blue}}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:500,color:C.txt}}>Primary DB (NFS)</div>
                  <div style={{fontSize:10,color:C.cyan,fontFamily:'monospace'}}>/primary-db-backup · 10.180.0.90</div>
                </div>
                <RuleTag type={primaryPct>=80?'alert':'ok'}>{primaryPct>=80?`⚠ Disk ${primaryPct}%`:'Healthy'}</RuleTag>
              </div>
              <SBar pct={primaryPct}/>
              <div style={{fontSize:10,color:C.txt3}}>{primary?.usedHuman||'—'} used · {primary?.freeHuman||'—'} free · {primary?.usedPct||'—'}</div>
              {primaryPct>=80 && <div style={{marginTop:6,fontSize:11,color:C.amber,background:C.amberBg,padding:'4px 8px',borderRadius:5}}>
                Rule 2: Move data older than 50 days to Secondary DB
              </div>}
            </div>

            {/* Secondary DB */}
            <div style={{border:`1px solid ${secondaryPct>=80?'var(--bv-amber)':C.bd}`,borderRadius:8,padding:'10px 12px',marginBottom:8,background:'var(--bv-green-dim)22'}}>
              <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:5}}>
                <i className="ti ti-server-2" style={{fontSize:15,color:C.cyan}}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:500,color:C.txt}}>Secondary DB (rsync mirror)</div>
                  <div style={{fontSize:10,color:C.cyan,fontFamily:'monospace'}}>/secondary-db-backup · 10.180.0.130</div>
                </div>
                <RuleTag type={secondaryPct>=80?'alert':'ok'}>{secondaryPct?`${secondaryPct}%`:'—'}</RuleTag>
              </div>
              <SBar pct={secondaryPct||0}/>
              <div style={{fontSize:10,color:C.txt3}}>{secondary?.diskUsedHuman||secondary?.usedHuman||'—'} used · {secondary?.freeHuman||'—'} free · Rule 2: manual when Primary {'>'} 80%</div>
            </div>

            {/* Remote Onsite */}
            <div style={{border:`1px solid ${C.bd}`,borderRadius:8,padding:'10px 12px',marginBottom:8}}>
              <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:5}}>
                <i className="ti ti-building" style={{fontSize:15,color:C.amber}}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:500,color:C.txt}}>Remote Onsite (rsync/SFTP)</div>
                  <div style={{fontSize:10,color:C.cyan,fontFamily:'monospace'}}>192.168.12.243 · /backups/remote</div>
                </div>
                <RuleTag type="auto">Rule 3</RuleTag>
              </div>
              <SBar pct={remotePct}/>
              <div style={{fontSize:10,color:C.txt3}}>{remotePct?`${remotePct}% used`:'Usage unknown'} · Incremental scripts + on-demand rsync</div>
            </div>

            {/* S3 */}
            <div style={{border:`1px solid ${C.bd}`,borderRadius:8,padding:'10px 12px',marginBottom:8}}>
              <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:4}}>
                <i className="ti ti-brand-aws" style={{fontSize:15,color:C.purple}}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:500,color:C.txt}}>AWS S3 (eu-west-2)</div>
                  <div style={{fontSize:10,color:C.cyan,fontFamily:'monospace'}}>s3://worktual-db-backup · STANDARD_IA</div>
                </div>
                <span style={{fontSize:11,color:s3Data?.status==='connected'?C.green:C.txt3}}>
                  {s3Data?.status==='connected'?'● Connected':'○ Check config'}
                </span>
              </div>
              <div style={{fontSize:10,color:C.txt3}}>Rule 4: on-demand backup target · Lifecycle → Glacier 90 days</div>
            </div>

            {/* OCI Encrypted */}
            <div style={{border:`1px solid ${'c74634'}`,borderRadius:8,padding:'10px 12px',background:'#4a0a0008'}}>
              <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:4}}>
                <i className="ti ti-cloud" style={{fontSize:15,color:'#c74634'}}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:500,color:C.txt,display:'flex',alignItems:'center',gap:6}}>
                    OCI Object Storage
                    <span style={{fontSize:10,padding:'1px 6px',borderRadius:6,background:'var(--bv-green-bg)',color:'var(--bv-green)',border:'1px solid var(--bv-green)',fontWeight:600}}>
                      🔐 AES-256-GCM
                    </span>
                  </div>
                  <div style={{fontSize:10,color:C.cyan,fontFamily:'monospace'}}>worktual-db-backup-oci · ap-mumbai-1</div>
                </div>
                <span style={{fontSize:11,color:ociData?.status==='connected'?C.green:C.txt3}}>
                  {ociData?.status==='connected'?'● Connected':'○ Check config'}
                </span>
              </div>
              <div style={{fontSize:10,color:C.txt3}}>Rule 5: encrypted upload · Client-side AES-256-GCM · Namespace: bm2eggyrlaqu</div>
            </div>
          </Card>

          {/* Primary DB recent files */}
          <Card title="Primary DB — recent backups" action={
            <button onClick={()=>navigate('/primary-dc')} style={{background:'none',border:'none',color:C.blue,fontSize:11,cursor:'pointer'}}>View all →</button>
          }>
            <div style={{fontSize:10,color:C.txt3,marginBottom:8,fontFamily:'monospace'}}>/primary-db-backup/&lt;db&gt;/Backup_DB/&lt;YYYYMMDD&gt;/</div>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <tbody>
                {recent.map((r,i)=>{
                  const dur = r.completed_at ? Math.round((new Date(r.completed_at)-new Date(r.started_at))/1000)+'s' : '—';
                  return (
                    <tr key={r.id} onClick={()=>navigate('/history')} style={{cursor:'pointer'}}
                      onMouseEnter={e=>e.currentTarget.style.background=C.bg3}
                      onMouseLeave={e=>e.currentTarget.style.background=''}>
                      <td style={{padding:'6px 6px',borderBottom:`1px solid ${C.bd}`,width:20}}>
                        <i className="ti ti-file-zip" style={{fontSize:13,color:r.status==='success'?C.cyan:C.red}}/>
                      </td>
                      <td style={{padding:'6px 4px',borderBottom:`1px solid ${C.bd}`}}>
                        <div style={{fontSize:11,fontWeight:500,color:C.txt}}>{r.target_name}</div>
                        <div style={{fontSize:10,color:C.txt3,fontFamily:'monospace',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:140}}>
                          {r.db_type}_{r.backup_type}_{format(new Date(r.started_at),'yyyy-MM-dd_HH-mm')}.sql.gz
                        </div>
                      </td>
                      <td style={{padding:'6px 4px',borderBottom:`1px solid ${C.bd}`,textAlign:'right'}}>
                        {i===0 && <span style={{fontSize:9,background:C.blueBg,color:C.blue,padding:'1px 5px',borderRadius:3,display:'block',marginBottom:2}}>LATEST</span>}
                        <div style={{fontSize:10,color:C.txt2}}>{fmtBytes(r.file_size_bytes)}</div>
                        <div style={{fontSize:10,color:C.txt3}}>{format(new Date(r.started_at),'HH:mm')}</div>
                      </td>
                      <td style={{padding:'6px 4px',borderBottom:`1px solid ${C.bd}`}}>
                        <Badge type={r.status} small>{r.status?.slice(0,4).toUpperCase()}</Badge>
                      </td>
                    </tr>
                  );
                })}
                {recent.length===0 && <tr><td colSpan={4} style={{textAlign:'center',padding:24,color:C.txt3,fontSize:12}}>No runs yet — click Run all backups</td></tr>}
              </tbody>
            </table>

            {/* Quick backup */}
            <div style={{marginTop:12,paddingTop:10,borderTop:`1px solid ${C.bd}`}}>
              <div style={{fontSize:10,color:C.txt3,marginBottom:6}}>Quick backup — select target</div>
              <div style={{display:'flex',gap:6}}>
                <select value={trigTarget} onChange={e=>setTrigTarget(e.target.value)} style={{...sel,flex:1,fontSize:11}}>
                  <option value="all">All Targets</option>
                  {targets.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <Btn variant="primary" size="sm" icon="player-play" loading={triggering} onClick={handleTrigger}>Backup now</Btn>
              </div>
            </div>
          </Card>

          {/* 7 Rules + Alerts */}
          <div style={{display:'flex',flexDirection:'column',gap:10}}>

            {/* Active alerts - Rule 2 + 6 */}
            <Card title="Active alerts" action={<RuleTag type="alert">Rules 2 · 6</RuleTag>}>
              {primaryPct>=80 && (
                <div style={{display:'flex',gap:8,padding:'8px 10px',borderRadius:7,background:C.amberBg,border:`1px solid #5a3a10`,marginBottom:6}}>
                  <i className="ti ti-alert-triangle" style={{color:C.amber,fontSize:15,flexShrink:0,marginTop:1}}/>
                  <div style={{flex:1,fontSize:11.5,color:C.txt}}>
                    <strong>Primary DB NFS disk at {primaryPct}%</strong> — Rule 2 triggered<br/>
                    <span style={{fontSize:10,color:C.txt2}}>Move {'>'} 50 days old data to Secondary DB (10.180.0.130)</span>
                  </div>
                </div>
              )}
              {today.failed>0 && (
                <div style={{display:'flex',gap:8,padding:'8px 10px',borderRadius:7,background:C.redBg,border:`1px solid var(--bv-red-border)`,marginBottom:6}}>
                  <i className="ti ti-x" style={{color:C.red,fontSize:15,flexShrink:0,marginTop:1}}/>
                  <div style={{flex:1,fontSize:11.5,color:C.txt}}>
                    <strong>{today.failed} backup{today.failed>1?'s':''} failed today</strong><br/>
                    <span style={{fontSize:10,color:C.txt2}}>Rule 6: Email notifications sent to all admins</span>
                  </div>
                </div>
              )}
              <div style={{display:'flex',gap:8,padding:'8px 10px',borderRadius:7,background:C.greenBg,border:`1px solid #1a5c28`}}>
                <i className="ti ti-check" style={{color:C.green,fontSize:15,flexShrink:0,marginTop:1}}/>
                <div style={{flex:1,fontSize:11.5,color:C.txt}}>
                  {today.total_runs||0} runs today · {today.success||0} succeeded<br/>
                  <span style={{fontSize:10,color:C.txt2}}>{fmtBytes(today.total_bytes)} transferred across all destinations</span>
                </div>
              </div>
            </Card>

            {/* 7 Rules summary */}
            <Card title="Backup rules">
              {[
                ['1','Daily scheduled 03:00 IST: all DBs → Primary DB','auto'],
                ['2','Primary DB >80%: notify admin, move old data → Secondary','alert'],
                ['3','Incremental rsync scripts → Remote Onsite (Incremental Backup menu)','auto'],
                ['4','On-demand from dashboard → Primary + Remote + S3','manual'],
                ['5','Monitor: all DB servers, Remote Onsite disk, S3 usage','ok'],
                ['6','Email notification on backup failure → all admin users','ok'],
                ['7','CEO dashboard: infrastructure flow + storage tiers','pro'],
              ].map(([n,desc,type])=>(
                <div key={n} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',borderBottom:`1px solid ${C.bd}`}}>
                  <div style={{width:18,height:18,borderRadius:'50%',background:type==='pro'?'var(--bv-purple-bg)':type==='alert'?C.redBg:C.blueBg,color:type==='pro'?C.purple:type==='alert'?C.red:C.blue,fontSize:10,fontWeight:500,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    {n}
                  </div>
                  <div style={{flex:1,fontSize:11,color:C.txt2}}>{desc}</div>
                  <RuleTag type={type}>{type==='auto'?'Auto':type==='alert'?'Active':type==='manual'?'Ready':type==='pro'?'This':type==='ok'?'ON':'—'}</RuleTag>
                </div>
              ))}
            </Card>
          </div>
        </div>

        {/* DB utilization + storage breakdown */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>

          {/* DB server utilization */}
          <Card title="DB server utilization" action={<RuleTag type="ok">Rule 5</RuleTag>}>
            {targets.filter(t=>t.is_active).map(t=>{
              const bkp = storage.find(s=>s.name===t.name);
              const mon = monForTarget(t);
              const st  = mon?.last_status;
              const dot = st==='critical'?'var(--bv-red)':st==='warn'?'var(--bv-amber)':st==='offline'?'var(--bv-red)':C.green;
              return (
                <div key={t.id} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 0',borderBottom:`1px solid ${C.bd}`}}>
                  <div style={{
                    width:22,height:22,borderRadius:5,display:'flex',alignItems:'center',justifyContent:'center',
                    fontSize:10,fontWeight:700,flexShrink:0,
                    background:t.db_type==='mysql'?'#1e3a1e':t.db_type==='postgresql'?'#1a2550':'#3d1a10',
                    color:t.db_type==='mysql'?'#4ec94e':t.db_type==='postgresql'?'#7ca8f8':'var(--bv-red)',
                  }}>{t.db_type==='mysql'?'M':t.db_type==='postgresql'?'P':'R'}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:500,color:C.txt,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.name}</div>
                    <div style={{fontSize:10,color:C.txt3,fontFamily:'monospace'}}>{t.host}:{t.port}</div>
                  </div>
                  <div style={{textAlign:'right',flexShrink:0}}>
                    <div style={{fontSize:11,color:C.txt2}}>{bkp?fmtBytes(bkp.total_bytes):'0 B'}</div>
                    <div style={{fontSize:10,color:C.txt3}}>{bkp?.run_count||0} runs/30d</div>
                  </div>
                  <div style={{width:6,height:6,borderRadius:'50%',background:dot,flexShrink:0}}/>
                </div>
              );
            })}
            {targets.length===0 && <div style={{textAlign:'center',padding:24,color:C.txt3,fontSize:12}}>No DB targets configured</div>}
          </Card>

          {/* Per-target storage breakdown chart */}
          <Card title="Backup size per target — 30 days" action={<button onClick={()=>navigate('/aws-s3')} style={{background:'none',border:'none',color:C.blue,fontSize:11,cursor:'pointer'}}>Storage →</button>}>
            {storage.length>0 ? (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={storage.map(r=>({name:r.name.length>12?r.name.substring(0,10)+'…':r.name,mb:Math.round((r.total_bytes||0)/1024/1024)}))} margin={{top:0,right:0,left:-20,bottom:0}}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
                    <XAxis dataKey="name" tick={{fill:C.txt3,fontSize:9}} tickLine={false}/>
                    <YAxis tick={{fill:C.txt3,fontSize:9}} tickLine={false} axisLine={false} unit=" MB"/>
                    <Tooltip contentStyle={{background:C.bg3,border:`1px solid ${C.bd}`,borderRadius:6,fontSize:11}} formatter={v=>v+' MB'}/>
                    <Bar dataKey="mb" fill="#2a78d6" name="Size MB" radius={[3,3,0,0]} barSize={28}/>
                  </BarChart>
                </ResponsiveContainer>
                <div style={{marginTop:10}}>
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <thead><tr>
                      {['Target','Type','Runs','Size','Last run','Status'].map(h=><th key={h} style={th}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {storage.slice(0,5).map(r=>(
                        <tr key={r.name} onMouseEnter={e=>e.currentTarget.style.background=C.bg3} onMouseLeave={e=>e.currentTarget.style.background=''}>
                          <td style={td()}><strong>{r.name}</strong></td>
                          <td style={td()}><Badge type={r.db_type} small>{r.db_type?.toUpperCase()}</Badge></td>
                          <td style={td({color:C.txt2})}>{r.run_count||0}</td>
                          <td style={td({color:C.txt2})}>{fmtBytes(r.total_bytes)}</td>
                          <td style={td({color:C.txt2,fontSize:11})}>{r.last_run?format(new Date(r.last_run),'dd MMM HH:mm'):'—'}</td>
                          <td style={td()}>{r.last_status?<Badge type={r.last_status} small>{r.last_status?.toUpperCase()}</Badge>:<span style={{color:C.txt3}}>—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div style={{textAlign:'center',padding:40,color:C.txt3,fontSize:12}}>
                <i className="ti ti-chart-bar-off" style={{fontSize:36,display:'block',marginBottom:10}}/>
                No backup data yet. Run your first backup to see storage analytics.
              </div>
            )}
          </Card>
        </div>

      </div>
    </div>
  );
}
