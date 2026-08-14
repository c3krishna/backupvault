// src/pages/Targets.js
import { useState, useEffect, useCallback } from 'react';
import { targetsAPI, backupAPI } from '../services/api';
import { Btn, Badge, DbIcon, Modal, Field, Dot, toast } from '../components/UI';

const PORT_MAP = { mysql:3306, postgresql:5432, redis:6379 };
const EMPTY = { name:'', db_type:'mysql', host:'', port:3306, username:'', password:'', database_name:'', description:'' };

export default function Targets() {
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(null);
  const [form,    setForm]    = useState(EMPTY);
  const [saving,  setSaving]  = useState(false);
  const [testing, setTesting] = useState(null);
  const [testRes, setTestRes] = useState({});

  const load = useCallback(async () => {
    try { setTargets(await targetsAPI.list()); } catch(e){ toast(e.message,'error'); } finally{ setLoading(false); }
  }, []);
  useEffect(()=>{ load(); },[load]);

  function openAdd(){ setForm(EMPTY); setModal('add'); }
  function openEdit(t){ setForm({...t}); setModal('edit'); }

  async function handleSave(e) {
    e.preventDefault(); setSaving(true);
    try {
      if (modal==='add') await targetsAPI.create(form);
      else await targetsAPI.update(form.id, form);
      toast(modal==='add'?'Target created':'Target updated'); setModal(null); load();
    } catch(e){ toast(e.message,'error'); } finally{ setSaving(false); }
  }

  async function handleRemove(id,name){ if(!window.confirm(`Deactivate "${name}"?`)) return; try{ await targetsAPI.remove(id); toast('Deactivated'); load(); } catch(e){ toast(e.message,'error'); } }
  async function handleBackup(t){ try{ await backupAPI.trigger(t.id,undefined,'full'); toast(`Backup started for ${t.name}`); } catch(e){ toast(e.message,'error'); } }
  async function handleTest(id){ setTesting(id); setTestRes(p=>({...p,[id]:null})); try{ const r=await targetsAPI.test(id); setTestRes(p=>({...p,[id]:r})); } catch(e){ setTestRes(p=>({...p,[id]:{success:false,message:e.message}})); } finally{ setTesting(null); } }

  const groups = {};
  targets.filter(t=>t.is_active).forEach(t=>{ if(!groups[t.db_type]) groups[t.db_type]=[]; groups[t.db_type].push(t); });
  const typeLabel = { mysql:'MySQL', postgresql:'PostgreSQL', redis:'Redis' };

  return (
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <div style={{padding:'18px 24px 14px',borderBottom:'1px solid var(--bv-bd)',background:'var(--bv-bg2)',display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexShrink:0}}>
        <div>
          <div style={{fontSize:20,fontWeight:500,color:'var(--bv-txt)'}}>DB Servers</div>
          <div style={{fontSize:12,color:'var(--bv-txt2)',marginTop:3}}>{targets.filter(t=>t.is_active).length} active database endpoints · Live DB source nodes</div>
        </div>
        <Btn variant="primary" icon="plus" onClick={openAdd}>+ Add Server</Btn>
      </div>

      <div style={{flex:1,overflowY:'auto',padding:'20px 24px',display:'flex',flexDirection:'column',gap:24}}>
        {loading ? <div style={{color:'var(--bv-txt3)',textAlign:'center',padding:40}}>Loading...</div>
        : Object.keys(groups).length===0 ? (
          <div style={{textAlign:'center',padding:60,color:'var(--bv-txt3)'}}>
            <i className="ti ti-database-off" style={{fontSize:48,display:'block',marginBottom:12}}/>
            No active targets. Add your first database server.
          </div>
        ) : Object.entries(groups).map(([type,items])=>(
          <div key={type}>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12}}>
              <DbIcon type={type} size={26}/>
              <span style={{fontSize:14,fontWeight:500,color:'var(--bv-txt)'}}>{typeLabel[type]||type}</span>
              <span style={{background:'var(--bv-bg4)',color:'var(--bv-txt2)',fontSize:11,padding:'1px 8px',borderRadius:10,border:'1px solid var(--bv-bd)'}}>{items.length}</span>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}>
              {items.map(t=>(
                <div key={t.id} style={{background:'var(--bv-bg3)',border:'1px solid var(--bv-bd)',borderRadius:12,padding:14}}>
                  <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
                    <DbIcon type={t.db_type} size={30}/>
                    <div>
                      <div style={{fontSize:13,fontWeight:500,color:'var(--bv-txt)'}}>{t.name}</div>
                      <div style={{fontSize:11,color:'var(--bv-cyan)',fontFamily:'monospace'}}>{t.host}:{t.port}</div>
                    </div>
                  </div>
                  <div style={{fontSize:11,color:'var(--bv-txt3)',marginBottom:2}}>DB: <span style={{color:'var(--bv-txt2)'}}>{t.database_name}</span></div>
                  <div style={{fontSize:11,color:'var(--bv-txt2)',marginBottom:10}}>{t.description}</div>
                  {testRes[t.id] && (
                    <div style={{fontSize:11,marginBottom:8,color:testRes[t.id].success?'var(--bv-green)':'var(--bv-red)'}}>
                      {testRes[t.id].success ? `✓ Connected (${testRes[t.id].latency_ms}ms)` : `✗ ${testRes[t.id].message}`}
                    </div>
                  )}
                  <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                    <Btn variant="success" size="sm" icon="player-play" onClick={()=>handleBackup(t)}>Backup</Btn>
                    <Btn variant="ghost" size="sm" icon="plug" loading={testing===t.id} onClick={()=>handleTest(t.id)}>Test</Btn>
                    <Btn variant="ghost" size="sm" icon="edit" onClick={()=>openEdit(t)}>Edit</Btn>
                    <Btn variant="danger" size="sm" onClick={()=>handleRemove(t.id,t.name)}>Remove</Btn>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Modal open={!!modal} onClose={()=>setModal(null)} title={modal==='add'?'Add DB Server':'Edit DB Server'} width={520}>
        <form onSubmit={handleSave}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0 14px'}}>
            <Field label="Server name" required>
              <input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} placeholder="CRM MySQL" style={{width:'100%'}} required/>
            </Field>
            <Field label="DB type" required>
              <select value={form.db_type} onChange={e=>setForm(p=>({...p,db_type:e.target.value,port:PORT_MAP[e.target.value]||p.port}))} style={{width:'100%'}}>
                <option value="mysql">MySQL / MariaDB</option>
                <option value="postgresql">PostgreSQL</option>
                <option value="redis">Redis</option>
              </select>
            </Field>
            <Field label="Host / IP" required>
              <input value={form.host} onChange={e=>setForm(p=>({...p,host:e.target.value}))} placeholder="10.180.0.201" style={{width:'100%'}} required/>
            </Field>
            <Field label="Port" required>
              <input type="number" value={form.port} onChange={e=>setForm(p=>({...p,port:parseInt(e.target.value)}))} style={{width:'100%'}} required/>
            </Field>
            <Field label="Username">
              <input value={form.username} onChange={e=>setForm(p=>({...p,username:e.target.value}))} placeholder="backupvault" style={{width:'100%'}}/>
            </Field>
            <Field label="Password">
              <input type="password" value={form.password} onChange={e=>setForm(p=>({...p,password:e.target.value}))} style={{width:'100%'}}/>
            </Field>
            <Field label="Database name">
              <input value={form.database_name} onChange={e=>setForm(p=>({...p,database_name:e.target.value}))} placeholder="worktual_crm" style={{width:'100%'}}/>
            </Field>
          </div>
          <Field label="Description">
            <textarea value={form.description} onChange={e=>setForm(p=>({...p,description:e.target.value}))} rows={2} style={{width:'100%',resize:'vertical'}} placeholder="Brief description"/>
          </Field>
          <Field label="Environment">
            <select value={form.environment||'live'} onChange={e=>setForm(p=>({...p,environment:e.target.value}))} style={{width:'100%'}}>
              <option value="live">Live / Production</option>
              <option value="pre_production">Pre-Production</option>
              <option value="qa">QA / Testing</option>
              <option value="development">Development</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <div style={{padding:'9px 12px',background:'var(--bv-bg3)',borderRadius:8,marginBottom:8,border:'1px solid var(--bv-bd)'}}>
            <div style={{fontSize:11,fontWeight:600,color:'var(--bv-txt2)',marginBottom:8,display:'flex',alignItems:'center',gap:7}}>
              <i className="ti ti-terminal-2" style={{color:'var(--bv-blue)'}}/>SSH Monitoring — key-based auth (CPU · memory · disk · processes)
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 90px',gap:'0 12px'}}>
              <Field label="SSH User" hint="e.g. root">
                <input value={form.ssh_user||''} onChange={e=>setForm(p=>({...p,ssh_user:e.target.value}))} placeholder="root" style={{width:'100%',fontFamily:'monospace'}}/>
              </Field>
              <Field label="SSH Password" hint="Leave blank — keys already deployed">
                <input type="password" value={form.ssh_password||''} onChange={e=>setForm(p=>({...p,ssh_password:e.target.value}))} placeholder="(using key-based auth)" style={{width:'100%',color:'var(--bv-txt3)'}}/>
              </Field>
              <Field label="SSH Port">
                <input type="number" value={form.ssh_port||22} onChange={e=>setForm(p=>({...p,ssh_port:parseInt(e.target.value)||22}))} style={{width:'100%',fontFamily:'monospace'}}/>
              </Field>
            </div>
            <label style={{display:'flex',alignItems:'center',gap:8,fontSize:12,color:'var(--bv-txt2)',cursor:'pointer',marginTop:6}}>
              <input type="checkbox" checked={!!form.monitoring_enabled} onChange={e=>setForm(p=>({...p,monitoring_enabled:e.target.checked}))}/>
              Enable SSH monitoring for this server
            </label>
          </div>
          <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:4}}>
            <Btn variant="ghost" type="button" onClick={()=>setModal(null)}>Cancel</Btn>
            <Btn variant="primary" loading={saving}>{modal==='add'?'Create':'Save Changes'}</Btn>
          </div>
        </form>
      </Modal>
    </div>
  );
}
