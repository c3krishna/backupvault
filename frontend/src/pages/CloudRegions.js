// frontend/src/pages/CloudRegions.js
// Manage AWS and OCI cloud regions from the dashboard
// Add/remove regions — loaded dynamically in Destination forms

import { useState, useEffect, useCallback } from 'react';
import { regionsAPI } from '../services/api';
import { Btn, Modal, Field, toast, Spinner } from '../components/UI';

const PROVIDER_META = {
  aws: { label:'AWS',             color:'#f8a84a', bg:'#2a1e0a', icon:'brand-aws'  },
  oci: { label:'Oracle Cloud OCI',color:'#c74634', bg:'#2a0a08', icon:'cloud'       },
};

const EMPTY = { provider:'aws', region_code:'', region_name:'', city:'', country:'', sort_order:100 };

export default function CloudRegions() {
  const [regions,  setRegions]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState(false);
  const [form,     setForm]     = useState(EMPTY);
  const [saving,   setSaving]   = useState(false);
  const [filterP,  setFilterP]  = useState('all');
  const [search,   setSearch]   = useState('');

  const load = useCallback(async () => {
    try { setRegions(await regionsAPI.list()); }
    catch(e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSave(e) {
    e.preventDefault(); setSaving(true);
    try {
      await regionsAPI.add(form);
      toast(`Region ${form.region_code} added`);
      setModal(false); setForm(EMPTY); load();
    } catch(e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  }

  async function handleRemove(id, code) {
    if (!window.confirm(`Remove region ${code}?`)) return;
    try { await regionsAPI.remove(id); toast('Region removed'); load(); }
    catch(e) { toast(e.message, 'error'); }
  }

  const filtered = regions.filter(r =>
    (filterP === 'all' || r.provider === filterP) &&
    (!search || r.region_code.includes(search.toLowerCase()) ||
     r.region_name.toLowerCase().includes(search.toLowerCase()) ||
     (r.city||'').toLowerCase().includes(search.toLowerCase()))
  );

  // Group by provider
  const awsRegions = filtered.filter(r => r.provider === 'aws');
  const ociRegions = filtered.filter(r => r.provider === 'oci');

  const RegionRow = ({ r }) => {
    const meta = PROVIDER_META[r.provider] || PROVIDER_META.aws;
    return (
      <div style={{ display:'flex', alignItems:'center', gap:12, padding:'9px 16px',
        borderBottom:'1px solid var(--bv-bd)' }}>
        <div style={{ width:32, height:32, borderRadius:7, background:meta.bg,
          display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          <i className={`ti ti-${meta.icon}`} style={{ fontSize:16, color:meta.color }}/>
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontFamily:'monospace', fontSize:13, fontWeight:600,
              color:'var(--bv-cyan)' }}>{r.region_code}</span>
            <span style={{ fontSize:10, padding:'1px 7px', borderRadius:8,
              background:meta.bg, color:meta.color, fontWeight:600 }}>
              {meta.label}
            </span>
          </div>
          <div style={{ fontSize:11, color:'var(--bv-txt2)', marginTop:2 }}>
            {r.region_name}
            {r.city && <span style={{ color:'var(--bv-txt3)', marginLeft:8 }}>
              <i className="ti ti-map-pin" style={{ fontSize:10, marginRight:3 }}/>
              {r.city}{r.country ? `, ${r.country}` : ''}
            </span>}
          </div>
        </div>
        <Btn variant="danger" size="sm" onClick={() => handleRemove(r.id, r.region_code)}>
          Remove
        </Btn>
      </div>
    );
  };

  const ProviderSection = ({ title, data, meta }) => (
    data.length === 0 ? null : (
      <div style={{ marginBottom:20 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 16px',
          background:meta.bg, border:`1px solid ${meta.color}`,
          borderRadius:9, marginBottom:8 }}>
          <i className={`ti ti-${meta.icon}`} style={{ fontSize:16, color:meta.color }}/>
          <span style={{ fontSize:13, fontWeight:600, color:meta.color }}>{title}</span>
          <span style={{ fontSize:11, color:'var(--bv-txt3)' }}>— {data.length} regions</span>
        </div>
        <div style={{ background:'var(--bv-card)', border:'1px solid var(--bv-bd)',
          borderRadius:10, overflow:'hidden' }}>
          {data.map(r => <RegionRow key={r.id} r={r}/>)}
        </div>
      </div>
    )
  );

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

      {/* Header */}
      <div style={{ padding:'14px 22px 12px', borderBottom:'1px solid var(--bv-bd)',
        background:'var(--bv-bg2)', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize:20, fontWeight:500, color:'var(--bv-txt)',
              display:'flex', alignItems:'center', gap:9 }}>
              <i className="ti ti-map" style={{ color:'var(--bv-blue)', fontSize:22 }}/>
              Cloud Regions
            </div>
            <div style={{ fontSize:12, color:'var(--bv-txt2)', marginTop:3 }}>
              Manage AWS and OCI regions — these populate the region dropdowns in Destinations
            </div>
          </div>
          <Btn variant="primary" icon="plus" onClick={() => { setForm(EMPTY); setModal(true); }}>
            Add Region
          </Btn>
        </div>

        {/* Filters */}
        <div style={{ display:'flex', gap:8, marginTop:12, alignItems:'center' }}>
          {['all','aws','oci'].map(p => (
            <button key={p} onClick={() => setFilterP(p)}
              style={{ padding:'5px 14px', borderRadius:20, border:'1px solid var(--bv-bd)',
                background: filterP===p ? 'var(--bv-blue)' : 'var(--bv-bg3)',
                color: filterP===p ? '#fff' : 'var(--bv-txt2)',
                cursor:'pointer', fontSize:12, fontWeight: filterP===p ? 600 : 400 }}>
              {p === 'all' ? `All (${regions.length})` :
               p === 'aws' ? `AWS (${regions.filter(r=>r.provider==='aws').length})` :
               `OCI (${regions.filter(r=>r.provider==='oci').length})`}
            </button>
          ))}
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search region code or city..."
            style={{ marginLeft:'auto', fontSize:12, padding:'5px 10px',
              background:'var(--bv-input)', border:'1px solid var(--bv-bd2)',
              color:'var(--bv-txt)', borderRadius:7, width:220 }}/>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex:1, overflowY:'auto', padding:'16px 22px' }}>
        {loading ? (
          <div style={{ display:'flex', justifyContent:'center', padding:60, gap:12, color:'var(--bv-txt3)' }}>
            <Spinner size={26}/> Loading regions...
          </div>
        ) : (
          <>
            <ProviderSection title="Amazon Web Services (AWS)"  data={awsRegions} meta={PROVIDER_META.aws}/>
            <ProviderSection title="Oracle Cloud Infrastructure (OCI)" data={ociRegions} meta={PROVIDER_META.oci}/>
          </>
        )}

        {/* Info box */}
        <div style={{ padding:'12px 16px', background:'var(--bv-bg3)',
          border:'1px solid var(--bv-bd)', borderRadius:9, fontSize:11,
          color:'var(--bv-txt3)', lineHeight:1.7 }}>
          <i className="ti ti-info-circle" style={{ marginRight:6, color:'var(--bv-blue)' }}/>
          Changes here immediately reflect in the <strong>Destinations</strong> page region dropdowns.
          No code changes or deployments required. Add any new AWS/OCI region by entering its
          official region code (e.g. <code>eu-west-2</code>, <code>ap-mumbai-1</code>).
        </div>
      </div>

      {/* Add Region Modal */}
      <Modal open={modal} onClose={() => setModal(false)} title="Add Cloud Region" width={480}>
        <form onSubmit={handleSave} style={{ display:'flex', flexDirection:'column', gap:0 }}>

          <Field label="Cloud Provider" required>
            <select value={form.provider}
              onChange={e => setForm(p=>({...p, provider:e.target.value}))}
              style={{ width:'100%' }}>
              <option value="aws">AWS (Amazon Web Services)</option>
              <option value="oci">OCI (Oracle Cloud Infrastructure)</option>
            </select>
          </Field>

          <Field label="Region Code" required
            hint={form.provider==='aws'
              ? 'Official AWS region code e.g. eu-west-2, ap-south-1'
              : 'Official OCI region code e.g. ap-mumbai-1, eu-frankfurt-1'}>
            <input value={form.region_code}
              onChange={e => setForm(p=>({...p, region_code:e.target.value.toLowerCase().trim()}))}
              placeholder={form.provider==='aws' ? 'eu-west-2' : 'ap-mumbai-1'}
              style={{ width:'100%', fontFamily:'monospace' }} required/>
          </Field>

          <Field label="Region Display Name" required hint="Human readable name">
            <input value={form.region_name}
              onChange={e => setForm(p=>({...p, region_name:e.target.value}))}
              placeholder={form.provider==='aws' ? 'Europe (London)' : 'India West (Mumbai)'}
              style={{ width:'100%' }} required/>
          </Field>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 14px' }}>
            <Field label="City" hint="Optional">
              <input value={form.city}
                onChange={e => setForm(p=>({...p, city:e.target.value}))}
                placeholder="London" style={{ width:'100%' }}/>
            </Field>
            <Field label="Country" hint="Optional">
              <input value={form.country}
                onChange={e => setForm(p=>({...p, country:e.target.value}))}
                placeholder="UK" style={{ width:'100%' }}/>
            </Field>
          </div>

          <Field label="Sort Order" hint="Lower = appears first (default: 100)">
            <input type="number" value={form.sort_order}
              onChange={e => setForm(p=>({...p, sort_order:parseInt(e.target.value)||100}))}
              style={{ width:'100%' }}/>
          </Field>

          {/* Preview */}
          {form.region_code && (
            <div style={{ padding:'8px 12px', background:'var(--bv-bg3)',
              borderRadius:7, fontSize:11, color:'var(--bv-txt3)',
              fontFamily:'monospace', marginBottom:12 }}>
              {form.region_code} — {form.region_name || '...'}{form.city ? ` (${form.city})` : ''}
            </div>
          )}

          <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
            <Btn variant="ghost" type="button" onClick={() => setModal(false)}>Cancel</Btn>
            <Btn variant="primary" loading={saving}>Add Region</Btn>
          </div>
        </form>
      </Modal>
    </div>
  );
}
