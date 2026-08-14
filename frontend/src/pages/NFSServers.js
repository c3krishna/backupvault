// frontend/src/pages/NFSServers.js
import { useState, useEffect, useCallback } from 'react';
import { nfsAPI } from '../services/api';
import { Btn, Badge, Modal, Field, toast, Spinner } from '../components/UI';

const ROLES = {
  primary:        { label:'Primary DB',    color:'var(--bv-green)',  bg:'var(--bv-green-dim)',  icon:'device-floppy' },
  secondary:      { label:'Secondary DB',  color:'var(--bv-cyan)',   bg:'var(--bv-cyan-bg)',    icon:'server-2'      },
  remote:         { label:'Remote',        color:'var(--bv-amber)',  bg:'var(--bv-amber-bg)',   icon:'building'      },
  live:           { label:'Live',          color:'var(--bv-red)',    bg:'var(--bv-red-bg)',     icon:'activity'      },
  pre_production: { label:'Pre-Production',color:'var(--bv-amber)',  bg:'var(--bv-amber-bg)',   icon:'test-pipe'     },
  qa:             { label:'QA',            color:'var(--bv-blue)',   bg:'var(--bv-blue-dim)',   icon:'microscope'    },
  other:          { label:'Other',         color:'var(--bv-txt3)',   bg:'var(--bv-bg4)',        icon:'server'        },
};

const STATUS = {
  online:   { color:'var(--bv-green)',  bg:'var(--bv-green-bg)',  dot:'green',  label:'Online'   },
  warn:     { color:'var(--bv-amber)',  bg:'var(--bv-amber-bg)',  dot:'amber',  label:'Warning'  },
  critical: { color:'var(--bv-red)',    bg:'var(--bv-red-bg)',    dot:'red',    label:'Critical' },
  offline:  { color:'var(--bv-red)',    bg:'var(--bv-red-dim)',   dot:'red',    label:'Offline'  },
};

function BarPct({ pct, height = 7 }) {
  const p   = Math.min(pct || 0, 100);
  const col = p >= 90 ? 'var(--bv-red)' : p >= 80 ? 'var(--bv-amber)' : 'var(--bv-green)';
  return (
    <div style={{ width:'100%', height, background:'var(--bv-bg4)', borderRadius:height/2, overflow:'hidden', margin:'3px 0' }}>
      <div style={{ height:'100%', width:`${p}%`, background:col, borderRadius:height/2, transition:'width .4s' }}/>
    </div>
  );
}

function StatusDot({ status }) {
  const s = STATUS[status] || STATUS.offline;
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:11,
      padding:'2px 8px', borderRadius:10, fontWeight:600, background:s.bg, color:s.color }}>
      <span style={{ width:6, height:6, borderRadius:'50%', background:s.color,
        boxShadow: status==='online'?`0 0 5px ${s.color}`:'none', flexShrink:0 }}/>
      {s.label}
    </span>
  );
}

const EMPTY = { name:'', host:'', export_path:'', mount_point:'', role:'primary', description:'' };

export default function NFSServers() {
  const [servers,  setServers]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [checking, setChecking] = useState(false);
  const [checkId,  setCheckId]  = useState(null);
  const [modal,    setModal]    = useState(null);
  const [form,     setForm]     = useState(EMPTY);
  const [saving,   setSaving]   = useState(false);

  const load = useCallback(async () => {
    try { setServers(await nfsAPI.list()); }
    catch(e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh live stats every 60s
  useEffect(() => {
    const t = setInterval(async () => {
      try { setServers(await nfsAPI.list()); } catch {}
    }, 60000);
    return () => clearInterval(t);
  }, []);

  async function checkAll() {
    setChecking(true);
    try { setServers(await nfsAPI.checkAll()); toast('All NFS servers checked'); }
    catch(e) { toast(e.message, 'error'); }
    finally { setChecking(false); }
  }

  async function checkOne(id) {
    setCheckId(id);
    try {
      const res = await nfsAPI.check(id);
      setServers(p => p.map(s => s.id===id ? { ...s, ...res } : s));
      toast(`${res.name}: ${res.status}`);
    } catch(e) { toast(e.message, 'error'); }
    finally { setCheckId(null); }
  }

  async function handleSave(e) {
    e.preventDefault(); setSaving(true);
    try {
      if (modal === 'add') await nfsAPI.create(form);
      else await nfsAPI.update(form.id, form);
      toast(modal==='add' ? 'NFS server added' : 'NFS server updated');
      setModal(null); setForm(EMPTY); load();
    } catch(e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  }

  async function handleRemove(id, name) {
    if (!window.confirm(`Remove "${name}"?`)) return;
    try { await nfsAPI.remove(id); toast('Removed'); load(); }
    catch(e) { toast(e.message, 'error'); }
  }

  function openEdit(s) { setForm({ ...s }); setModal('edit'); }
  function openAdd()   { setForm(EMPTY); setModal('add'); }

  const online   = servers.filter(s => s.status === 'online').length;
  const warn     = servers.filter(s => s.status === 'warn' || s.status === 'critical').length;
  const offline  = servers.filter(s => s.status === 'offline' || !s.status).length;

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

      {/* Header */}
      <div style={{ padding:'14px 22px 12px', borderBottom:'1px solid var(--bv-bd)',
        background:'var(--bv-bg2)', flexShrink:0,
        display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
        <div>
          <div style={{ fontSize:20, fontWeight:500, color:'var(--bv-txt)', display:'flex', alignItems:'center', gap:9 }}>
            <i className="ti ti-server-bolt" style={{ color:'var(--bv-blue)', fontSize:22 }}/>
            NFS Servers
          </div>
          <div style={{ fontSize:12, color:'var(--bv-txt2)', marginTop:3 }}>
            Network file system monitoring ·{' '}
            <span style={{ color:'var(--bv-green)' }}>{online} online</span>
            {warn > 0 && <span style={{ color:'var(--bv-amber)' }}> · {warn} warning</span>}
            {offline > 0 && <span style={{ color:'var(--bv-red)' }}> · {offline} offline</span>}
          </div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <Btn variant="ghost" icon="refresh" loading={checking} onClick={checkAll}>Check all</Btn>
          <Btn variant="primary" icon="plus" onClick={openAdd}>Add NFS Server</Btn>
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'18px 22px', display:'flex', flexDirection:'column', gap:12 }}>

        {/* Summary KPI row */}
        {!loading && servers.length > 0 && (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10 }}>
            {[
              { label:'Total NFS Servers',  value:servers.length,                    color:'var(--bv-blue)',   accent:'var(--bv-blue)'  },
              { label:'Online',             value:online,                             color:'var(--bv-green)', accent:'var(--bv-green)' },
              { label:'Warnings / Critical',value:warn,                              color:warn>0?'var(--bv-amber)':'var(--bv-txt3)', accent:warn>0?'var(--bv-amber)':'var(--bv-bd)' },
              { label:'Offline',            value:offline,                            color:offline>0?'var(--bv-red)':'var(--bv-txt3)', accent:offline>0?'var(--bv-red)':'var(--bv-bd)' },
            ].map(k => (
              <div key={k.label} style={{ background:'var(--bv-card)', border:`1px solid var(--bv-bd)`,
                borderTop:`2.5px solid ${k.accent}`, borderRadius:12, padding:'12px 16px' }}>
                <div style={{ fontSize:10, color:'var(--bv-txt3)', textTransform:'uppercase',
                  letterSpacing:'.07em', fontWeight:600, marginBottom:6 }}>{k.label}</div>
                <div style={{ fontSize:28, fontWeight:500, color:k.color }}>{k.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Server cards */}
        {loading ? (
          <div style={{ display:'flex', justifyContent:'center', padding:60, gap:12, color:'var(--bv-txt3)' }}>
            <Spinner size={28}/> Loading NFS servers...
          </div>
        ) : servers.length === 0 ? (
          <div style={{ textAlign:'center', padding:60, color:'var(--bv-txt3)' }}>
            <i className="ti ti-server-off" style={{ fontSize:52, display:'block', marginBottom:14, color:'var(--bv-bd2)' }}/>
            <div style={{ fontSize:16, fontWeight:500, color:'var(--bv-txt2)', marginBottom:6 }}>No NFS servers configured</div>
            <div style={{ fontSize:13, marginBottom:16 }}>Add your NFS storage servers to monitor disk usage and mount status</div>
            <Btn variant="primary" icon="plus" onClick={openAdd}>Add NFS Server</Btn>
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {servers.map(s => {
              const role   = ROLES[s.role] || ROLES.other;
              const isChecking = checkId === s.id;
              const pct    = s.disk_pct || 0;

              return (
                <div key={s.id} style={{
                  background:'var(--bv-card)', border:`1px solid ${s.status==='critical'?'var(--bv-red)':s.status==='warn'?'var(--bv-amber)':'var(--bv-bd)'}`,
                  borderRadius:12, padding:'16px 18px',
                  transition:'border-color .2s',
                }}>
                  <div style={{ display:'flex', alignItems:'flex-start', gap:14 }}>

                    {/* Role icon */}
                    <div style={{ width:44, height:44, borderRadius:11, background:role.bg,
                      display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      <i className={`ti ti-${role.icon}`} style={{ fontSize:22, color:role.color }}/>
                    </div>

                    {/* Main info */}
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:4, flexWrap:'wrap' }}>
                        <span style={{ fontSize:15, fontWeight:500, color:'var(--bv-txt)' }}>{s.name}</span>
                        <span style={{ fontSize:10, padding:'2px 8px', borderRadius:10, fontWeight:600,
                          background:role.bg, color:role.color }}>{role.label}</span>
                        {s.status && <StatusDot status={s.status}/>}
                        {!s.status && <span style={{ fontSize:11, color:'var(--bv-txt3)' }}>Not checked yet</span>}
                      </div>

                      {/* Paths */}
                      <div style={{ display:'flex', gap:20, flexWrap:'wrap', marginBottom:10 }}>
                        <div style={{ fontSize:11, color:'var(--bv-txt3)' }}>
                          <i className="ti ti-server" style={{ marginRight:5, color:'var(--bv-blue)' }}/>
                          <span style={{ fontFamily:'monospace', color:'var(--bv-cyan)' }}>{s.host}</span>
                          <span style={{ color:'var(--bv-txt3)' }}>:{s.export_path}</span>
                        </div>
                        <div style={{ fontSize:11, color:'var(--bv-txt3)' }}>
                          <i className="ti ti-arrow-right" style={{ marginRight:5 }}/>
                          <span style={{ fontFamily:'monospace', color:'var(--bv-txt2)' }}>{s.mount_point}</span>
                        </div>
                      </div>

                      {/* Disk stats */}
                      {s.disk_size ? (
                        <div>
                          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
                            <div style={{ display:'flex', gap:16, fontSize:12 }}>
                              <span style={{ color:'var(--bv-txt2)' }}>
                                <span style={{ color:'var(--bv-txt3)', fontSize:10, marginRight:4 }}>Total</span>
                                <strong>{s.disk_size}</strong>
                              </span>
                              <span style={{ color:'var(--bv-txt2)' }}>
                                <span style={{ color:'var(--bv-txt3)', fontSize:10, marginRight:4 }}>Used</span>
                                <strong style={{ color:pct>=90?'var(--bv-red)':pct>=80?'var(--bv-amber)':'var(--bv-txt)' }}>
                                  {s.disk_used}
                                </strong>
                              </span>
                              <span style={{ color:'var(--bv-txt2)' }}>
                                <span style={{ color:'var(--bv-txt3)', fontSize:10, marginRight:4 }}>Free</span>
                                <strong style={{ color:'var(--bv-green)' }}>{s.disk_avail}</strong>
                              </span>
                              {s.inode_pct != null && (
                                <span style={{ color:'var(--bv-txt3)', fontSize:11 }}>
                                  Inodes: <span style={{ color:s.inode_pct>=80?'var(--bv-amber)':'var(--bv-txt2)' }}>{s.inode_pct}%</span>
                                </span>
                              )}
                            </div>
                            <span style={{ fontSize:13, fontWeight:600,
                              color:pct>=90?'var(--bv-red)':pct>=80?'var(--bv-amber)':'var(--bv-green)' }}>
                              {pct}%
                            </span>
                          </div>
                          <BarPct pct={pct} height={8}/>
                          {s.last_check && (
                            <div style={{ fontSize:10, color:'var(--bv-txt3)', marginTop:3 }}>
                              Last checked: {new Date(s.last_check).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div style={{ fontSize:12, color:'var(--bv-txt3)', fontStyle:'italic' }}>
                          {s.last_error || 'Click "Check" to fetch live stats'}
                        </div>
                      )}

                      {/* Error message */}
                      {s.status === 'offline' && s.last_error && (
                        <div style={{ marginTop:6, padding:'5px 10px', background:'var(--bv-red-dim)',
                          border:'1px solid var(--bv-red)', borderRadius:6, fontSize:11, color:'var(--bv-red)' }}>
                          <i className="ti ti-alert-triangle" style={{ marginRight:5 }}/>{s.last_error}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div style={{ display:'flex', flexDirection:'column', gap:6, flexShrink:0 }}>
                      <Btn variant="ghost" size="sm" icon="refresh" loading={isChecking}
                        onClick={() => checkOne(s.id)}>Check</Btn>
                      <Btn variant="ghost" size="sm" icon="edit" onClick={() => openEdit(s)}>Edit</Btn>
                      <Btn variant="danger" size="sm" onClick={() => handleRemove(s.id, s.name)}>Remove</Btn>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Info panel */}
        <div style={{ background:'var(--bv-bg3)', border:'1px solid var(--bv-bd)', borderRadius:10, padding:'12px 16px',
          display:'flex', gap:14, flexWrap:'wrap' }}>
          <div style={{ flex:1, minWidth:200 }}>
            <div style={{ fontSize:11, fontWeight:600, color:'var(--bv-txt2)', marginBottom:5 }}>How monitoring works</div>
            <div style={{ fontSize:11, color:'var(--bv-txt3)', lineHeight:1.7 }}>
              Each NFS server is checked by running <code style={{ fontFamily:'monospace', color:'var(--bv-cyan)' }}>df -h</code> on
              the local mount point. The mount must be accessible from the BackupVault server. Stats are
              saved to DB and refreshed every 60 seconds automatically.
            </div>
          </div>
          <div style={{ flex:1, minWidth:200 }}>
            <div style={{ fontSize:11, fontWeight:600, color:'var(--bv-txt2)', marginBottom:5 }}>Threshold alerts</div>
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {[
                ['var(--bv-green)', '< 80%', 'Normal — no action needed'],
                ['var(--bv-amber)', '80–90%', 'Warning — Rule 2 triggers'],
                ['var(--bv-red)',   '> 90%', 'Critical — new backups may fail'],
              ].map(([col, pct, txt]) => (
                <div key={pct} style={{ display:'flex', alignItems:'center', gap:8, fontSize:11 }}>
                  <span style={{ width:8, height:8, borderRadius:'50%', background:col, flexShrink:0 }}/>
                  <strong style={{ color:'var(--bv-txt2)', minWidth:50 }}>{pct}</strong>
                  <span style={{ color:'var(--bv-txt3)' }}>{txt}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Add / Edit Modal */}
      <Modal open={!!modal} onClose={() => { setModal(null); setForm(EMPTY); }}
        title={modal==='add' ? 'Add NFS Server' : 'Edit NFS Server'} width={500}>
        <form onSubmit={handleSave} style={{ display:'flex', flexDirection:'column', gap:0 }}>
          <Field label="Display name" required hint='e.g. "Primary DB (NFS)"'>
            <input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))}
              placeholder="Primary DB (NFS)" style={{ width:'100%' }} required/>
          </Field>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 14px' }}>
            <Field label="Host / IP" required hint="NFS server IP address">
              <input value={form.host} onChange={e=>setForm(p=>({...p,host:e.target.value}))}
                placeholder="10.180.0.90" style={{ width:'100%', fontFamily:'monospace' }} required/>
            </Field>
            <Field label="Role">
              <select value={form.role} onChange={e=>setForm(p=>({...p,role:e.target.value}))} style={{ width:'100%' }}>
                <option value="primary">Primary DB</option>
                <option value="secondary">Secondary DB</option>
                <option value="remote">Remote</option>
                <option value="live">Live / Production</option>
                <option value="pre_production">Pre-Production</option>
                <option value="qa">QA / Testing</option>
                <option value="other">Other</option>
              </select>
            </Field>
          </div>

          <Field label="NFS export path" required hint="Path exported by the NFS server">
            <input value={form.export_path} onChange={e=>setForm(p=>({...p,export_path:e.target.value}))}
              placeholder="/home" style={{ width:'100%', fontFamily:'monospace' }} required/>
          </Field>

          <Field label="Local mount point" required hint="Where it is mounted on this BackupVault server">
            <input value={form.mount_point} onChange={e=>setForm(p=>({...p,mount_point:e.target.value}))}
              placeholder="/primary-db-backup" style={{ width:'100%', fontFamily:'monospace' }} required/>
          </Field>

          <Field label="Description">
            <textarea value={form.description} onChange={e=>setForm(p=>({...p,description:e.target.value}))}
              rows={2} style={{ width:'100%', resize:'vertical' }}
              placeholder="482G pool for daily backups"/>
          </Field>

          {/* Preview */}
          <div style={{ padding:'8px 12px', background:'var(--bv-bg3)', borderRadius:8,
            fontSize:11, color:'var(--bv-txt3)', marginBottom:14, fontFamily:'monospace' }}>
            {form.host||'<host>'}:{form.export_path||'<export>'} → {form.mount_point||'<mount>'}
          </div>

          <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
            <Btn variant="ghost" type="button" onClick={() => { setModal(null); setForm(EMPTY); }}>Cancel</Btn>
            <Btn variant="primary" loading={saving}>{modal==='add' ? 'Add Server' : 'Save Changes'}</Btn>
          </div>
        </form>
      </Modal>
    </div>
  );
}
