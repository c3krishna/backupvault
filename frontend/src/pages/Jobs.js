// src/pages/Jobs.js
import { useState, useEffect, useCallback } from 'react';
import { jobsAPI, targetsAPI, destinationsAPI, backupAPI } from '../services/api';
import { Btn, Badge, DbIcon, Modal, Field, CronBadge, Toggle, toast } from '../components/UI';

const PRESETS = [
  { label:'Daily at 03:00',    cron:'0 3 * * *' },
  { label:'Daily at 01:00',    cron:'0 1 * * *' },
  { label:'Every 6 hours',     cron:'0 */6 * * *' },
  { label:'Every hour',        cron:'0 * * * *' },
  { label:'Weekly (Sun 02:00)',cron:'0 2 * * 0' },
  { label:'Monthly (1st 03:00)',cron:'0 3 1 * *' },
  { label:'Custom',            cron:'custom' },
];

function CronBuilder({ value, onChange }) {
  const preset = PRESETS.find(p => p.cron === value) || PRESETS[PRESETS.length-1];
  const [custom, setCustom] = useState(preset.cron==='custom' ? value : value);

  function selectPreset(cron) {
    if (cron === 'custom') return;
    onChange(cron); setCustom(cron);
  }

  return (
    <div>
      <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:10}}>
        {PRESETS.map(p => (
          <button key={p.cron} type="button" onClick={() => selectPreset(p.cron)} style={{
            padding:'4px 10px', borderRadius:6, fontSize:11, cursor:'pointer', fontFamily:'inherit',
            background: value===p.cron || (p.cron==='custom' && !PRESETS.find(x=>x.cron===value&&x.cron!=='custom')) ? 'var(--bv-blue-dim)' : 'var(--bv-bg4)',
            color: value===p.cron ? 'var(--bv-blue)' : 'var(--bv-txt2)',
            border:`1px solid ${value===p.cron ? 'var(--bv-blue)' : 'var(--bv-bd2)'}`,
          }}>{p.label}</button>
        ))}
      </div>
      <div style={{display:'flex',gap:8,alignItems:'center'}}>
        <input value={custom} onChange={e => { setCustom(e.target.value); onChange(e.target.value); }}
          placeholder="0 3 * * *" style={{fontFamily:'monospace',flex:1}}/>
        <a href="https://crontab.guru" target="_blank" rel="noreferrer"
          style={{fontSize:11,color:'var(--bv-blue)',whiteSpace:'nowrap'}}>crontab.guru ↗</a>
      </div>
    </div>
  );
}

const EMPTY = { name:'', target_id:'', backup_type:'full', schedule_cron:'0 3 * * *', is_scheduled:true, retention_days:30, destinations:[] };

export default function Jobs() {
  const [jobs,    setJobs]    = useState([]);
  const [targets, setTargets] = useState([]);
  const [dests,   setDests]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(null);
  const [form,    setForm]    = useState(EMPTY);
  const [saving,  setSaving]  = useState(false);
  const [running, setRunning] = useState(null);

  const load = useCallback(async () => {
    try { const [j,t,d] = await Promise.all([jobsAPI.list(), targetsAPI.list(), destinationsAPI.list()]); setJobs(j); setTargets(t); setDests(d); }
    catch(e){ toast(e.message,'error'); } finally{ setLoading(false); }
  }, []);
  useEffect(()=>{ load(); },[load]);

  function openAdd() { setForm({...EMPTY, destinations: dests.filter(d=>d.is_active).map(d=>d.id)}); setModal('add'); }
  function openEdit(j) {
    let destIds = [];
    try { destIds = JSON.parse(j.destinations||'[]'); } catch{}
    setForm({...j, destinations: Array.isArray(destIds)?destIds:[]}); setModal('edit');
  }

  async function handleSave(e) {
    e.preventDefault(); setSaving(true);
    try {
      if (modal==='add') await jobsAPI.create(form);
      else await jobsAPI.update(form.id, form);
      toast(modal==='add'?'Job created':'Job updated'); setModal(null); load();
    } catch(e){ toast(e.message,'error'); } finally{ setSaving(false); }
  }

  async function handleToggle(id){ try{ await jobsAPI.toggle(id); load(); } catch(e){ toast(e.message,'error'); } }
  async function handleRemove(id,name){ if(!window.confirm(`Remove "${name}"?`)) return; try{ await jobsAPI.remove(id); toast('Job removed'); load(); } catch(e){ toast(e.message,'error'); } }
  async function handleRun(job){ setRunning(job.id); try{ await backupAPI.trigger(job.target_id,job.id,job.backup_type); toast(`"${job.name}" started`); } catch(e){ toast(e.message,'error'); } finally{ setRunning(null); } }

  function toggleDest(id){ setForm(p=>({ ...p, destinations: p.destinations.includes(id) ? p.destinations.filter(d=>d!==id) : [...p.destinations,id] })); }

  const destIcon  = { local:'ti-server', remote_sftp:'ti-building', aws_s3:'ti-brand-aws' };
  const destColor = { local:'#6ee84a', remote_sftp:'#5aaef8', aws_s3:'#f8a84a' };
  const destBg    = { local:'#2a3a1a', remote_sftp:'#1a2a3a', aws_s3:'var(--bv-amber-bg)' };

  return (
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <div style={{padding:'18px 24px 14px',borderBottom:'1px solid var(--bv-bd)',background:'var(--bv-bg2)',display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexShrink:0}}>
        <div>
          <div style={{fontSize:20,fontWeight:500,color:'var(--bv-txt)'}}>Backup Jobs & Scheduling</div>
          <div style={{fontSize:12,color:'var(--bv-txt2)',marginTop:3}}>{jobs.filter(j=>j.is_active).length} tasks · {jobs.filter(j=>j.is_scheduled).length} scheduled</div>
        </div>
        <Btn variant="primary" icon="plus" onClick={openAdd}>+ Create Task</Btn>
      </div>

      <div style={{flex:1,overflowY:'auto',padding:'20px 24px'}}>
        <div style={{background:'var(--bv-bg2)',border:'1px solid var(--bv-bd)',borderRadius:12,overflow:'hidden'}}>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead>
              <tr style={{borderBottom:'1px solid var(--bv-bd)'}}>
                {['Task name','DB Target','Mode','Schedule','Retention','Destinations','State','Actions'].map(h=>(
                  <th key={h} style={{textAlign:'left',fontSize:10,fontWeight:600,color:'var(--bv-txt3)',letterSpacing:'.07em',textTransform:'uppercase',padding:'10px 14px',whiteSpace:'nowrap'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={8} style={{textAlign:'center',padding:40,color:'var(--bv-txt3)'}}>Loading...</td></tr>
              : jobs.length===0 ? <tr><td colSpan={8} style={{textAlign:'center',padding:40,color:'var(--bv-txt3)'}}>No jobs configured. Create your first backup task.</td></tr>
              : jobs.map(job=>{
                  let destIds=[]; try{ destIds=JSON.parse(job.destinations||'[]'); } catch{}
                  const jobDests = dests.filter(d=>destIds.includes(d.id));
                  return (
                    <tr key={job.id} onMouseEnter={e=>e.currentTarget.style.background='var(--bv-bg3)'} onMouseLeave={e=>e.currentTarget.style.background=''}>
                      <td style={{padding:'11px 14px',borderBottom:'1px solid var(--bv-bg4)',fontSize:13,fontWeight:500,color:'var(--bv-txt)'}}>{job.name}</td>
                      <td style={{padding:'11px 14px',borderBottom:'1px solid var(--bv-bg4)'}}>
                        <div style={{display:'flex',alignItems:'center',gap:7}}>
                          <DbIcon type={job.db_type} size={22}/>
                          <span style={{fontSize:12,color:'var(--bv-txt2)'}}>{job.target_name}</span>
                        </div>
                      </td>
                      <td style={{padding:'11px 14px',borderBottom:'1px solid var(--bv-bg4)'}}><Badge type={job.backup_type}>{job.backup_type?.toUpperCase()}</Badge></td>
                      <td style={{padding:'11px 14px',borderBottom:'1px solid var(--bv-bg4)'}}><CronBadge expr={job.schedule_cron||'—'}/></td>
                      <td style={{padding:'11px 14px',borderBottom:'1px solid var(--bv-bg4)',fontSize:12,color:'var(--bv-txt2)',whiteSpace:'nowrap'}}>{job.retention_days}d</td>
                      <td style={{padding:'11px 14px',borderBottom:'1px solid var(--bv-bg4)'}}>
                        <div style={{display:'flex',gap:4}}>
                          {jobDests.map(d=>(
                            <div key={d.id} title={d.name} style={{width:20,height:20,borderRadius:4,background:destBg[d.dest_type],display:'flex',alignItems:'center',justifyContent:'center',opacity:d.is_active?1:.4}}>
                              <i className={`ti ${destIcon[d.dest_type]}`} style={{fontSize:11,color:destColor[d.dest_type]}}/>
                            </div>
                          ))}
                          {jobDests.length===0 && <span style={{fontSize:11,color:'var(--bv-txt3)'}}>—</span>}
                        </div>
                      </td>
                      <td style={{padding:'11px 14px',borderBottom:'1px solid var(--bv-bg4)'}}>
                        <div style={{display:'flex',alignItems:'center',gap:7}}>
                          <Toggle value={!!job.is_scheduled} onChange={()=>handleToggle(job.id)}/>
                          <Badge type={job.is_scheduled?'automated':'pending'}>{job.is_scheduled?'Auto':'Paused'}</Badge>
                        </div>
                      </td>
                      <td style={{padding:'11px 14px',borderBottom:'1px solid var(--bv-bg4)'}}>
                        <div style={{display:'flex',gap:5}}>
                          <Btn variant="success" size="sm" icon="player-play" loading={running===job.id} onClick={()=>handleRun(job)}>Run</Btn>
                          <Btn variant="ghost" size="sm" icon="edit" onClick={()=>openEdit(job)}>Edit</Btn>
                          <Btn variant="danger" size="sm" icon="x" onClick={()=>handleRemove(job.id,job.name)}/>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={!!modal} onClose={()=>setModal(null)} title={modal==='add'?'Create Backup Task':'Edit Backup Task'} width={600}>
        <form onSubmit={handleSave}>
          <Field label="Task name" required>
            <input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} placeholder="MySQL Daily Full" style={{width:'100%'}} required/>
          </Field>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0 14px'}}>
            <Field label="Database target" required>
              <select value={form.target_id} onChange={e=>setForm(p=>({...p,target_id:e.target.value}))} style={{width:'100%'}} required>
                <option value="">— Select target —</option>
                {targets.filter(t=>t.is_active).map(t=><option key={t.id} value={t.id}>{t.name} ({t.db_type})</option>)}
              </select>
            </Field>
            <Field label="Backup type">
              <select value={form.backup_type} onChange={e=>setForm(p=>({...p,backup_type:e.target.value}))} style={{width:'100%'}}>
                <option value="full">Full</option>
                <option value="incremental">Incremental</option>
                <option value="differential">Differential</option>
              </select>
            </Field>
          </div>

          <Field label="Schedule" hint="When this job runs automatically">
            <CronBuilder value={form.schedule_cron} onChange={v=>setForm(p=>({...p,schedule_cron:v}))}/>
          </Field>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0 14px'}}>
            <Field label="Retention days" hint="Delete backups older than this">
              <input type="number" value={form.retention_days} onChange={e=>setForm(p=>({...p,retention_days:parseInt(e.target.value)}))} style={{width:'100%'}} min={1} max={365}/>
            </Field>
          </div>

          <Field label="Backup destinations" hint="Where to send this backup">
            <div style={{display:'flex',flexDirection:'column',gap:6,marginTop:4}}>
              {dests.map(d=>(
                <label key={d.id} style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',padding:'7px 10px',borderRadius:7,background:form.destinations.includes(d.id)?'var(--bv-blue-dim)':'var(--bv-bg4)',border:`1px solid ${form.destinations.includes(d.id)?'var(--bv-blue)':'var(--bv-bd)'}`}}>
                  <input type="checkbox" checked={form.destinations.includes(d.id)} onChange={()=>toggleDest(d.id)} style={{accentColor:'var(--bv-blue)'}}/>
                  <div style={{width:22,height:22,borderRadius:5,background:destBg[d.dest_type],display:'flex',alignItems:'center',justifyContent:'center'}}>
                    <i className={`ti ${destIcon[d.dest_type]}`} style={{fontSize:12,color:destColor[d.dest_type]}}/>
                  </div>
                  <span style={{fontSize:12,color:'var(--bv-txt)'}}>{d.name}</span>
                  {!d.is_active && <Badge type="warn" small>Inactive</Badge>}
                </label>
              ))}
              {dests.length===0 && <div style={{color:'var(--bv-txt3)',fontSize:12}}>No destinations configured — add in Destinations page first</div>}
            </div>
          </Field>

          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16}}>
            <Toggle value={form.is_scheduled} onChange={v=>setForm(p=>({...p,is_scheduled:v}))}/>
            <label style={{fontSize:12,cursor:'pointer',color:'var(--bv-txt2)'}}>Enable auto-schedule (runs at cron time)</label>
          </div>

          <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
            <Btn variant="ghost" type="button" onClick={()=>setModal(null)}>Cancel</Btn>
            <Btn variant="primary" loading={saving}>{modal==='add'?'Create Task':'Save Changes'}</Btn>
          </div>
        </form>
      </Modal>
    </div>
  );
}
