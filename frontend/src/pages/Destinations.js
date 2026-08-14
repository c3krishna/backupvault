// src/pages/Destinations.js
import React, { useState, useEffect, useCallback } from 'react';
import { destinationsAPI, infraAPI, regionsAPI } from '../services/api';
import { Btn, Badge, Modal, Field, Dot, Card, ProgressBar, toast } from '../components/UI';

function cfgOf(d) { try { return typeof d.config==='string' ? JSON.parse(d.config) : (d.config||{}); } catch { return {}; } }

function ConnBadge({ status, active }) {
  if (!status || status==='connected' || active) return <Badge type="connected"><Dot color="green"/> Connected</Badge>;
  if (status==='misconfigured') return <Badge type="warn">Not configured</Badge>;
  if (status==='auth_failed')   return <Badge type="failed">Auth failed</Badge>;
  if (status==='bucket_not_found') return <Badge type="failed">Bucket not found</Badge>;
  if (status==='sshpass_missing')  return <Badge type="warn">sshpass missing</Badge>;
  if (status==='aws_cli_missing')  return <Badge type="warn">aws CLI missing</Badge>;
  if (status==='no_route')         return <Badge type="failed">No route</Badge>;
  if (status==='timeout')          return <Badge type="warn">Timeout</Badge>;
  return <Badge type={active?'connected':'failed'}>{active?'Active':'Inactive'}</Badge>;
}

function TestResult({ res, bucket, host }) {
  if (!res) return null;
  const ok = res.success;
  return (
    <div style={{ padding:'10px 14px', borderRadius:8, marginBottom:14,
      background: ok?'var(--bv-green-dim)':'var(--bv-red-dim)', border:`1px solid ${ok?'var(--bv-green)':'var(--bv-red)'}` }}>
      <div style={{ fontSize:12, fontWeight:600, color: ok?'var(--bv-green)':'var(--bv-red)' }}>
        {ok ? `✓ Connected${bucket?' to s3://'+bucket:''}${host?' to '+host:''} (${res.latency_ms}ms)` : `✗ ${res.status}: ${res.error}`}
      </div>
      {!ok && res.status==='aws_cli_missing' && <div style={{ fontSize:11, color:'var(--bv-amber)', marginTop:5, fontFamily:'monospace' }}>Fix: pip3 install awscli --break-system-packages</div>}
      {!ok && res.status==='sshpass_missing' && <div style={{ fontSize:11, color:'var(--bv-amber)', marginTop:5, fontFamily:'monospace' }}>Fix: apt-get install -y sshpass</div>}
      {!ok && res.status==='auth_failed'     && <div style={{ fontSize:11, color:'var(--bv-amber)', marginTop:5 }}>Check credentials. Ensure IAM has s3:PutObject, s3:GetObject, s3:ListBucket.</div>}
      {!ok && res.status==='no_route'        && <div style={{ fontSize:11, color:'var(--bv-amber)', marginTop:5 }}>Cannot reach server. Check network/VPN/firewall.</div>}
      {res.disk && <div style={{ fontSize:11, color:'var(--bv-txt2)', marginTop:4 }}>Remote disk: {res.disk.used}/{res.disk.size} · {res.disk.avail} free</div>}
    </div>
  );
}

// ── S3 FORM ──────────────────────────────────────────────────────────────────
function S3Form({ dest, dests, onSaved, onClose }) {
  const ex = dest ? cfgOf(dest) : {};
  const [f, setF] = useState({ name: dest?.name||'AWS S3 Backup (Mumbai)',
    bucket: ex.bucket||'', region: ex.region||'ap-south-1',
    access_key: ex.access_key||'', secret_key: ex.secret_key||'',
    prefix: ex.prefix||'db-backups/', storage_class: ex.storage_class||'STANDARD_IA' });
  const [testing, setTesting] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [testRes, setTestRes] = useState(null);

  async function test() { setTesting(true); setTestRes(null); try { setTestRes(await infraAPI.testS3(f)); } catch(e){ setTestRes({success:false,status:'error',error:e.message}); } finally { setTesting(false); } }
  async function save(e) {
    e.preventDefault(); setSaving(true);
    try { const r = await infraAPI.saveS3({...f, id:dest?.id}); toast(r.connection?.success ? 'S3 destination saved & connected' : `Saved (${r.connection?.status})`); onSaved(); }
    catch(e){ toast(e.message,'error'); } finally{ setSaving(false); }
  }

  return (
    <form onSubmit={save}>
      <Field label="Destination name" required>
        <input value={f.name} onChange={e=>setF(p=>({...p,name:e.target.value}))} style={{width:'100%'}} required/>
      </Field>
      <div style={{background:'var(--bv-bg3)',border:'1px solid var(--bv-bd)',borderRadius:8,padding:'12px 14px',marginBottom:14}}>
        <div style={{fontSize:10,fontWeight:600,color:'var(--bv-txt2)',marginBottom:10,letterSpacing:'.07em',textTransform:'uppercase'}}>AWS credentials</div>
        <Field label="S3 bucket name" required hint="e.g. worktual-db-backups">
          <input value={f.bucket} onChange={e=>setF(p=>({...p,bucket:e.target.value}))} placeholder="worktual-db-backups" style={{width:'100%'}} required/>
        </Field>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0 14px'}}>
          <Field label="Access Key ID" required>
            <input value={f.access_key} onChange={e=>setF(p=>({...p,access_key:e.target.value}))} placeholder="AKIA..." style={{width:'100%',fontFamily:'monospace',fontSize:12}} required/>
          </Field>
          <Field label="Secret Access Key" required>
            <input type="password" value={f.secret_key} onChange={e=>setF(p=>({...p,secret_key:e.target.value}))} style={{width:'100%'}} required/>
          </Field>
          <Field label="Region">
            <select value={f.region} onChange={e=>setF(p=>({...p,region:e.target.value}))} style={{width:'100%'}}>
              {['ap-south-1','ap-south-2','us-east-1','us-west-2','eu-west-1','ap-southeast-1'].map(r=><option key={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Storage class">
            <select value={f.storage_class} onChange={e=>setF(p=>({...p,storage_class:e.target.value}))} style={{width:'100%'}}>
              {['STANDARD','STANDARD_IA','ONEZONE_IA','GLACIER','DEEP_ARCHIVE'].map(s=><option key={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Key prefix" hint="Folder path inside bucket">
          <input value={f.prefix} onChange={e=>setF(p=>({...p,prefix:e.target.value}))} placeholder="db-backups/" style={{width:'100%',fontFamily:'monospace'}}/>
        </Field>
      </div>
      <TestResult res={testRes} bucket={f.bucket}/>
      <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
        <Btn variant="ghost" type="button" loading={testing} icon="plug" onClick={test}>Test Connection</Btn>
        <div style={{display:'flex',gap:8}}>
          <Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" loading={saving}>Save S3 Destination</Btn>
        </div>
      </div>
    </form>
  );
}

// ── DYNAMIC REGIONS HOOK ──────────────────────────────────────────────────────
function useRegions(provider) {
  const [regions, setRegions] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    regionsAPI.list(provider)
      .then(list => setRegions(list || []))
      .catch(() => setRegions([]))
      .finally(() => setLoading(false));
  }, [provider]);
  return { regions, loading };
}

// ── REGION SELECT COMPONENT ───────────────────────────────────────────────────
function RegionSelect({ provider, value, onChange, required }) {
  const { regions, loading } = useRegions(provider);
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ width:'100%' }} required={required}>
      {loading && <option value="">Loading regions...</option>}
      {!loading && !value && <option value="">Select region...</option>}
      {regions.map(r => (
        <option key={r.region_code} value={r.region_code}>
          {r.region_code} — {r.region_name}{r.city ? ` (${r.city})` : ''}
        </option>
      ))}
    </select>
  );
}

// ── REMOTE DR FORM ────────────────────────────────────────────────────────────
function RemoteForm({ dest, onSaved, onClose }) {
  const ex = dest ? cfgOf(dest) : {};
  const [f, setF] = useState({ name: dest?.name||'Remote Onsite DR',
    host: ex.host||'192.168.12.243', port: ex.port||22,
    user: ex.user||'root', password: ex.password||'',
    path: ex.path||'/backups/remote' });
  const [testing, setTesting] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [testRes, setTestRes] = useState(null);

  async function test() { setTesting(true); setTestRes(null); try { setTestRes(await infraAPI.testRemote(f)); } catch(e){ setTestRes({success:false,status:'error',error:e.message}); } finally { setTesting(false); } }
  async function save(e) {
    e.preventDefault(); setSaving(true);
    try { const r = await infraAPI.saveRemote({...f, id:dest?.id}); toast(r.connection?.success ? `Remote DR connected to ${f.host}` : `Saved (${r.connection?.status})`); onSaved(); }
    catch(e){ toast(e.message,'error'); } finally{ setSaving(false); }
  }

  return (
    <form onSubmit={save}>
      <Field label="Destination name" required>
        <input value={f.name} onChange={e=>setF(p=>({...p,name:e.target.value}))} style={{width:'100%'}} required/>
      </Field>
      <div style={{background:'var(--bv-bg3)',border:'1px solid var(--bv-bd)',borderRadius:8,padding:'12px 14px',marginBottom:14}}>
        <div style={{fontSize:10,fontWeight:600,color:'var(--bv-txt2)',marginBottom:10,letterSpacing:'.07em',textTransform:'uppercase'}}>SSH / rsync connection</div>
        <div style={{display:'grid',gridTemplateColumns:'1.6fr 1fr',gap:'0 14px'}}>
          <Field label="Host IP" required hint="Onsite DR server">
            <input value={f.host} onChange={e=>setF(p=>({...p,host:e.target.value}))} placeholder="192.168.12.243" style={{width:'100%',fontFamily:'monospace'}} required/>
          </Field>
          <Field label="SSH Port">
            <input type="number" value={f.port} onChange={e=>setF(p=>({...p,port:parseInt(e.target.value)}))} style={{width:'100%'}} min={1} max={65535}/>
          </Field>
          <Field label="SSH Username">
            <input value={f.user} onChange={e=>setF(p=>({...p,user:e.target.value}))} placeholder="root" style={{width:'100%'}}/>
          </Field>
          <Field label="SSH Password" required>
            <input type="password" value={f.password} onChange={e=>setF(p=>({...p,password:e.target.value}))} style={{width:'100%'}} required/>
          </Field>
        </div>
        <Field label="Remote backup path">
          <input value={f.path} onChange={e=>setF(p=>({...p,path:e.target.value}))} placeholder="/backups/remote" style={{width:'100%',fontFamily:'monospace'}}/>
        </Field>
      </div>
      <TestResult res={testRes} host={f.host}/>
      <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
        <Btn variant="ghost" type="button" loading={testing} icon="plug" onClick={test}>Test SSH</Btn>
        <div style={{display:'flex',gap:8}}>
          <Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" loading={saving}>Save Remote DR</Btn>
        </div>
      </div>
    </form>
  );
}

// ── LOCAL NFS FORM ────────────────────────────────────────────────────────────
function LocalForm({ dest, onSaved, onClose }) {
  const ex = dest ? cfgOf(dest) : {};
  const [f, setF] = useState({ name: dest?.name||'Primary DB (Local NFS)', path: ex.path||'/primary-db-backup' });
  const [saving, setSaving] = useState(false);
  async function save(e) {
    e.preventDefault(); setSaving(true);
    try {
      const config = { path: f.path, status:'connected', last_check: new Date().toISOString() };
      if (dest) await destinationsAPI.update(dest.id, { name:f.name, dest_type:'local', config, is_active:1 });
      else await destinationsAPI.create({ name:f.name, dest_type:'local', config });
      toast('Local destination saved'); onSaved();
    } catch(e){ toast(e.message,'error'); } finally{ setSaving(false); }
  }
  return (
    <form onSubmit={save}>
      <Field label="Name" required><input value={f.name} onChange={e=>setF(p=>({...p,name:e.target.value}))} style={{width:'100%'}} required/></Field>
      <Field label="Local mount path" hint="NFS mount point or local directory" required>
        <input value={f.path} onChange={e=>setF(p=>({...p,path:e.target.value}))} placeholder="/primary-db-backup" style={{width:'100%',fontFamily:'monospace'}} required/>
      </Field>
      <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
        <Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" loading={saving}>Save</Btn>
      </div>
    </form>
  );
}

// ── OCI FORM ─────────────────────────────────────────────────────────────────
function OCIForm({ dest, onSaved, onClose }) {
  const ex = dest ? cfgOf(dest) : {};
  const [f, setF] = useState({
    name:               dest?.name||'OCI Encrypted Backup',
    namespace:          ex.namespace||'',
    region:             ex.region||'ap-mumbai-1',
    bucket:             ex.bucket||'',
    access_key:         ex.access_key||'',
    secret_key:         ex.secret_key||'',
    prefix:             ex.prefix||'',
    storage_class:      ex.storage_class||'STANDARD',
    encryption_enabled: dest?.encryption_enabled||ex.encryption_enabled||false,
  });
  const [saving,  setSaving]  = useState(false);
  const [testing, setTesting] = useState(false);
  const [testRes, setTestRes] = useState(null);

  async function test(e) {
    e.preventDefault(); setTesting(true); setTestRes(null);
    try {
      const config = { namespace:f.namespace, region:f.region, bucket:f.bucket,
        access_key:f.access_key, secret_key:f.secret_key, prefix:f.prefix,
        storage_class:f.storage_class };
      // Use direct config test endpoint (works without saved dest id)
      const token = localStorage.getItem('bv_token');
      const res = await fetch('/api/oci/test-config', {
        method:'POST',
        headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' },
        body: JSON.stringify(config)
      }).then(r=>r.json());
      setTestRes(res);
    } catch(e){ setTestRes({ success:false, error:e.message }); }
    finally{ setTesting(false); }
  }

  async function save(e) {
    e.preventDefault(); setSaving(true);
    try {
      const config = { namespace:f.namespace, region:f.region, bucket:f.bucket,
        access_key:f.access_key, secret_key:f.secret_key, prefix:f.prefix,
        storage_class:f.storage_class, encryption_enabled:f.encryption_enabled,
        status:'connected', endpoint:`https://${f.namespace}.compat.objectstorage.${f.region}.oraclecloud.com` };
      const payload = { name:f.name, dest_type:'oci_object',
        encryption_enabled:f.encryption_enabled?1:0, config };
      if (dest) await destinationsAPI.update(dest.id, payload);
      else await destinationsAPI.create(payload);
      toast('OCI destination saved'); onSaved();
    } catch(e){ toast(e.message,'error'); } finally{ setSaving(false); }
  }

  const setC = (k,v) => setF(p=>({...p,[k]:v}));

  return (
    <form onSubmit={save}>
      <Field label="Display name" required>
        <input value={f.name} onChange={e=>setC('name',e.target.value)} style={{width:'100%'}} required/>
      </Field>

      <div style={{padding:'10px 12px',background:'var(--bv-bg3)',borderRadius:8,marginBottom:12,border:'1px solid var(--bv-bd)'}}>
        <div style={{fontSize:11,fontWeight:600,color:'var(--bv-txt2)',marginBottom:10,display:'flex',alignItems:'center',gap:7}}>
          <i className="ti ti-cloud" style={{color:'#c74634',fontSize:14}}/>
          Oracle Cloud Infrastructure — Object Storage
          <span style={{fontSize:10,padding:'1px 7px',borderRadius:8,background:'var(--bv-green-bg)',color:'var(--bv-green)'}}>S3-Compatible API</span>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0 12px'}}>
          <Field label="Tenancy Namespace" required hint="OCI Console → User menu → Tenancy">
            <input value={f.namespace} onChange={e=>setC('namespace',e.target.value)}
              placeholder="abc123xyz" style={{width:'100%',fontFamily:'monospace'}} required/>
          </Field>
          <Field label="Region" required hint="Loaded from DB — manage in Settings → Cloud Regions">
            <RegionSelect provider="oci" value={f.region}
              onChange={v => setC('region', v)} required/>
          </Field>
        </div>
        <Field label="Bucket Name" required hint="Create this bucket in OCI Console first">
          <input value={f.bucket} onChange={e=>setC('bucket',e.target.value)}
            placeholder="worktual-backup-encrypted" style={{width:'100%',fontFamily:'monospace'}} required/>
        </Field>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0 12px'}}>
          <Field label="Access Key" required hint="OCI → User → Customer Secret Keys">
            <input value={f.access_key} onChange={e=>setC('access_key',e.target.value)}
              placeholder="Access Key ID" style={{width:'100%',fontFamily:'monospace'}} required/>
          </Field>
          <Field label="Secret Key" required>
            <input type="password" value={f.secret_key} onChange={e=>setC('secret_key',e.target.value)}
              placeholder="Secret Key" style={{width:'100%'}} required/>
          </Field>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0 12px'}}>
          <Field label="Object Prefix" hint="Optional folder prefix">
            <input value={f.prefix} onChange={e=>setC('prefix',e.target.value)}
              placeholder="worktual-backups/" style={{width:'100%',fontFamily:'monospace'}}/>
          </Field>
          <Field label="Storage Class">
            <select value={f.storage_class} onChange={e=>setC('storage_class',e.target.value)} style={{width:'100%'}}>
              <option value="STANDARD">STANDARD (Hot — frequent access)</option>
              <option value="INFREQUENT_ACCESS">INFREQUENT_ACCESS (Cheaper)</option>
              <option value="ARCHIVE">ARCHIVE (Cheapest — slow restore)</option>
            </select>
          </Field>
        </div>
        {f.namespace && f.region && (
          <div style={{fontSize:10,color:'var(--bv-txt3)',padding:'5px 8px',background:'var(--bv-bg2)',borderRadius:5,fontFamily:'monospace',marginTop:4}}>
            Endpoint: https://{f.namespace}.compat.objectstorage.{f.region}.oraclecloud.com
          </div>
        )}
      </div>

      {/* Encryption */}
      <div style={{padding:'10px 12px',background:'var(--bv-green-bg)',border:'1px solid var(--bv-green)',borderRadius:8,marginBottom:12}}>
        <div style={{fontWeight:600,color:'var(--bv-green)',marginBottom:8,display:'flex',alignItems:'center',gap:6,fontSize:12}}>
          <i className="ti ti-shield-lock" style={{fontSize:14}}/>
          AES-256-GCM Client-Side Encryption
        </div>
        <label style={{display:'flex',alignItems:'flex-start',gap:8,cursor:'pointer',fontSize:11,color:'var(--bv-txt2)'}}>
          <input type="checkbox" checked={!!f.encryption_enabled}
            onChange={e=>setC('encryption_enabled',e.target.checked)} style={{marginTop:2}}/>
          <span>
            <strong>Encrypt files before upload</strong> — files are encrypted on BackupVault server before
            sending to OCI. Even if OCI is compromised, backup files cannot be read without your key.
          </span>
        </label>
        {f.encryption_enabled && (
          <div style={{marginTop:8,padding:'7px 10px',background:'var(--bv-amber-bg)',border:'1px solid var(--bv-amber)',borderRadius:6,fontSize:10,color:'var(--bv-amber)'}}>
            <i className="ti ti-alert-triangle" style={{marginRight:5}}/>
            <strong>Ensure BACKUP_ENCRYPTION_KEY is set in /var/www/backupvault/backend/.env</strong>
            <br/>Generate key: <code style={{fontFamily:'monospace'}}>node -e "require('./src/services/ociService').generateEncryptionKey()"</code>
          </div>
        )}
      </div>

      {/* OCI Setup guide */}
      <div style={{padding:'9px 12px',background:'var(--bv-bg3)',borderRadius:7,fontSize:10,color:'var(--bv-txt3)',marginBottom:12,lineHeight:1.6}}>
        <strong style={{color:'var(--bv-txt2)'}}>OCI Setup (5 min):</strong>
        OCI Console → Identity → Users → &lt;your-user&gt; → Customer Secret Keys → Generate Secret Key → Copy Access + Secret Key.
        Namespace: OCI Console → top-right → Tenancy name.
      </div>

      {testRes && (
        <div style={{padding:'7px 12px',borderRadius:7,marginBottom:10,fontSize:11,
          background:testRes.success?'var(--bv-green-bg)':'var(--bv-red-bg)',
          border:`1px solid ${testRes.success?'var(--bv-green)':'var(--bv-red)'}`,
          color:testRes.success?'var(--bv-green)':'var(--bv-red)'}}>
          {testRes.success ? '✓ OCI connected successfully' : `✗ ${testRes.error}`}
        </div>
      )}

      <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
        <Btn variant="ghost" type="button" loading={testing} icon="plug" onClick={test}>Test OCI Connection</Btn>
        <div style={{display:'flex',gap:8}}>
          <Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" loading={saving}>Save OCI Destination</Btn>
        </div>
      </div>
    </form>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
export default function Destinations() {
  const [dests, setDests]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(null);
  const [editD,   setEditD]   = useState(null);
  const [testing, setTesting] = useState(null);

  const load = useCallback(async () => {
    try { setDests(await destinationsAPI.list()); } catch(e){ toast(e.message,'error'); } finally{ setLoading(false); }
  }, []);
  useEffect(()=>{ load(); },[load]);

  function openAdd(type){
    setEditD(null);
    // Map dest_type → modal key
    const modalKey = type==='aws_s3'?'s3':type==='remote_sftp'?'remote':type==='oci_object'?'oci':type==='local'?'local':type;
    setModal(modalKey);
  }
  function openEdit(d){ setEditD(d); setModal(d.dest_type==='aws_s3'?'s3':d.dest_type==='remote_sftp'?'remote':d.dest_type==='oci_object'?'oci':'local'); }
  function onSaved(){ setModal(null); setEditD(null); load(); }

  async function deactivate(id){ if(!window.confirm('Deactivate?')) return; try{ await destinationsAPI.remove(id); toast('Deactivated'); load(); } catch(e){ toast(e.message,'error'); } }

  const typeLabel = { local:'Local NFS', remote_sftp:'Remote Onsite DR (192.168.12.243)', aws_s3:'AWS S3 Cloud Backup', oci_object:'OCI Object Storage (Encrypted)' };
  const typeIcon  = { local:'server', remote_sftp:'building', aws_s3:'brand-aws', oci_object:'cloud' };
  const typeBg    = { local:'#2a3a1a', remote_sftp:'#1a2a3a', aws_s3:'var(--bv-amber-bg)', oci_object:'#3a1a1a' };
  const typeColor = { local:'#6ee84a', remote_sftp:'#5aaef8', aws_s3:'#f8a84a', oci_object:'#c74634' };
  const groups    = { local:[], remote_sftp:[], aws_s3:[], oci_object:[] };
  dests.forEach(d => (groups[d.dest_type]||[]).push(d));

  const Sec = ({ type, label, tip }) => (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{width:28,height:28,borderRadius:7,background:typeBg[type],display:'flex',alignItems:'center',justifyContent:'center'}}>
            <i className={`ti ti-${typeIcon[type]}`} style={{fontSize:14,color:typeColor[type]}}/>
          </div>
          <div>
            <div style={{fontSize:12,fontWeight:500,color:'var(--bv-txt)'}}>{label}</div>
            <div style={{fontSize:10,color:'var(--bv-txt3)'}}>{tip}</div>
          </div>
        </div>
        <Btn variant="ghost" size="sm" icon="plus" onClick={()=>openAdd(type)}>Add</Btn>
      </div>
      {groups[type].length === 0
        ? <div style={{padding:'16px',border:'1px dashed var(--bv-bd)',borderRadius:8,textAlign:'center',fontSize:12,color:'var(--bv-txt3)'}}>
            No {label} configured — click Add to set up
          </div>
        : groups[type].map(d => {
            const cfg = cfgOf(d);
            const pathStr = d.dest_type==='aws_s3' ? `s3://${cfg.bucket||'?'}/${cfg.prefix||''}` : d.dest_type==='oci_object' ? `oci://${cfg.namespace||'?'}.compat.objectstorage.${cfg.region||'?'}.oraclecloud.com/${cfg.bucket||'?'}` : d.dest_type==='remote_sftp' ? `${cfg.host}:${cfg.port||22} → ${cfg.path}` : cfg.path;
            return (
              <div key={d.id} style={{background:'var(--bv-bg3)',border:`1px solid ${d.is_active?'var(--bv-bd)':'var(--bv-red-border)'}`,borderRadius:12,padding:14,display:'flex',gap:12,marginBottom:8}}>
                <div style={{width:36,height:36,borderRadius:9,background:typeBg[d.dest_type],display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                  <i className={`ti ti-${typeIcon[d.dest_type]}`} style={{fontSize:18,color:typeColor[d.dest_type]}}/>
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3}}>
                    <span style={{fontSize:13,fontWeight:500,color:'var(--bv-txt)'}}>{d.name}</span>
                    <ConnBadge status={cfg.status} active={d.is_active}/>
                    {cfg.latency_ms && d.is_active && <span style={{fontSize:10,color:'var(--bv-txt3)',fontFamily:'monospace'}}>{cfg.latency_ms}ms</span>}
                  </div>
                  <div style={{fontSize:11,fontFamily:'monospace',color:'var(--bv-cyan)',marginBottom:2}}>{pathStr}</div>
                  {cfg.last_check && <div style={{fontSize:10,color:'var(--bv-txt3)'}}>Checked: {new Date(cfg.last_check).toLocaleTimeString()}</div>}
                  {!d.is_active && cfg.last_error && (
                    <div style={{marginTop:5,padding:'4px 8px',background:'var(--bv-red-bg)',border:'1px solid var(--bv-red-border)',borderRadius:5,fontSize:11,color:'var(--bv-red)'}}>✗ {cfg.last_error}</div>
                  )}
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:5,flexShrink:0}}>
                  <Btn variant="ghost" size="sm" icon="edit" onClick={()=>openEdit(d)}>Edit</Btn>
                  {d.dest_type==='remote_sftp' && d.is_active && <Btn variant="ghost" size="sm" icon="folder" onClick={()=>window.location.href='/remote'}>Browse</Btn>}
                  {d.dest_type==='oci_object' && d.is_active && <Btn variant="ghost" size="sm" icon="cloud" onClick={()=>window.location.href='/oci-storage'}>Browse</Btn>}
                  <Btn variant="danger" size="sm" onClick={()=>deactivate(d.id)}>Remove</Btn>
                </div>
              </div>
            );
          })
      }
    </div>
  );

  return (
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <div style={{padding:'18px 24px 14px',borderBottom:'1px solid var(--bv-bd)',background:'var(--bv-bg2)',display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexShrink:0}}>
        <div>
          <div style={{fontSize:20,fontWeight:500,color:'var(--bv-txt)'}}>Destinations</div>
          <div style={{fontSize:12,color:'var(--bv-txt2)',marginTop:3}}>{dests.filter(d=>d.is_active).length} active · {dests.filter(d=>!d.is_active).length} inactive</div>
        </div>
        <Btn variant="ghost" icon="refresh" onClick={load}>Refresh</Btn>
      </div>
      <div style={{flex:1,overflowY:'auto',padding:'20px 24px',display:'flex',flexDirection:'column',gap:20}}>
        {loading ? <div style={{color:'var(--bv-txt3)',textAlign:'center',padding:40}}>Loading...</div> : (
          <>
            <Sec type="local"       label="Local NFS"              tip="Primary DB · NFS mount"/>
            <Sec type="remote_sftp" label="Remote Onsite DR"          tip="192.168.12.243 · rsync over SSH"/>
            <Sec type="aws_s3"      label="AWS S3 Cloud Backup"     tip="Mumbai ap-south-1 · STANDARD_IA"/>
            <Sec type="oci_object"  label="OCI Object Storage"      tip="Oracle Cloud · AES-256-GCM Encrypted"/>
          </>
        )}
      </div>
      <Modal open={modal==='s3'}     onClose={()=>setModal(null)} title={editD?'Edit AWS S3':'Configure AWS S3 Backup'}         width={560}><S3Form     dest={editD} onSaved={onSaved} onClose={()=>setModal(null)}/></Modal>
      <Modal open={modal==='remote'} onClose={()=>setModal(null)} title={editD?'Edit Remote DR':'Configure Remote Onsite DR'}      width={520}><RemoteForm dest={editD} onSaved={onSaved} onClose={()=>setModal(null)}/></Modal>
      <Modal open={modal==='local'}  onClose={()=>setModal(null)} title={editD?'Edit Local NFS':'Add Local NFS'}                   width={440}><LocalForm  dest={editD} onSaved={onSaved} onClose={()=>setModal(null)}/></Modal>
      <Modal open={modal==='oci'}    onClose={()=>setModal(null)} title={editD?'Edit OCI Storage':'Configure OCI Object Storage'} width={580}><OCIForm    dest={editD} onSaved={onSaved} onClose={()=>setModal(null)}/></Modal>
    </div>
  );
}
