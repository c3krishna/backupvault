// frontend/src/pages/OCIBrowser.js
// OCI Object Storage file browser — S3-compatible API with AES-256-GCM encryption support

import { useState, useEffect, useCallback, useRef } from 'react';
import { ociAPI, destinationsAPI } from '../services/api';
import { Spinner, Btn, toast } from '../components/UI';

function fmtBytes(b) {
  if (b == null) return '—';
  if (b === 0) return '0 B';
  const u = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(Math.max(b,1)) / Math.log(1024));
  return (b / Math.pow(1024, i)).toFixed(1) + ' ' + u[i];
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', {
    day:'2-digit', month:'short', year:'numeric',
    hour:'2-digit', minute:'2-digit'
  });
}

export default function OCIBrowser() {
  const [dest,        setDest]       = useState(null);
  const [allDests,    setAllDests]   = useState([]);
  const [prefix,      setPrefix]     = useState('');
  const [items,       setItems]      = useState({ folders:[], files:[] });
  const [loading,     setLoading]    = useState(false);
  const [breadcrumbs, setBreadcrumbs]= useState([]);
  const [filter,      setFilter]     = useState('');
  const [downloading, setDownloading]= useState(null);
  const [totalStats,  setTotalStats] = useState(null);
  const [folderStats, setFolderStats]= useState({});
  const statsTimer = useRef({});

  // Load all OCI destinations
  useEffect(() => {
    destinationsAPI.list().then(list => {
      // Accept both active and inactive OCI destinations (show all, indicate status)
      const ociDests = list.filter(d => d.dest_type === 'oci_object');
      setAllDests(ociDests);
      if (ociDests.length > 0) setDest(ociDests[0]);
    }).catch(e => toast(e.message, 'error'));
  }, []);

  // Load bucket contents when dest or prefix changes
  const load = useCallback(async () => {
    if (!dest) return;
    setLoading(true);
    try {
      const config = typeof dest.config === 'string' ? JSON.parse(dest.config) : dest.config;
      const result = await ociAPI.list(dest.id, prefix);

      const folders = (result.CommonPrefixes || []).map(p => ({
        name: p.Prefix.replace(prefix, '').replace(/\/$/, ''),
        prefix: p.Prefix,
      }));

      const files = (result.Contents || [])
        .filter(f => f.Key !== prefix)
        .map(f => ({
          key:       f.Key,
          name:      f.Key.split('/').pop(),
          size:      f.Size,
          modified:  f.LastModified,
          encrypted: f.Key.endsWith('.enc'),
          storage:   f.StorageClass || 'STANDARD',
        }))
        .sort((a, b) => new Date(b.modified) - new Date(a.modified));

      setItems({ folders, files });
      Object.values(statsTimer.current).forEach(clearTimeout);
      statsTimer.current = {};
      setFolderStats({});

      folders.forEach((folder, idx) => {
        statsTimer.current[folder.prefix] = setTimeout(async () => {
          try {
            const stats = await ociAPI.folderStats(dest.id, folder.prefix);
            setFolderStats(prev => ({ ...prev, [folder.prefix]: stats }));
          } catch { /* keep dashes if a folder cannot be summarised */ }
        }, 120 * idx);
      });

      // Bucket total stats
      if (!prefix && result.Name) {
        setTotalStats({
          bucket: result.Name,
          prefix: config?.prefix || '',
        });
      }

      // Build breadcrumbs
      const parts = prefix.replace(/\/$/, '').split('/').filter(Boolean);
      setBreadcrumbs(parts.reduce((acc, p, i) => {
        acc.push({ label: p, prefix: parts.slice(0, i+1).join('/') + '/' });
        return acc;
      }, []));

    } catch(e) {
      toast(e.message, 'error');
      setItems({ folders:[], files:[] });
    } finally { setLoading(false); }
  }, [dest, prefix]);

  useEffect(() => { load(); }, [load]);

  function navigate(newPrefix) { setPrefix(newPrefix); setFilter(''); }

  async function handleDownload(file) {
    setDownloading(file.key);
    try {
      const res = await ociAPI.presign(dest.id, file.key);
      const a = document.createElement('a');
      a.href = res.url;
      a.download = file.name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => document.body.removeChild(a), 2000);
      toast(file.encrypted
        ? 'Downloading encrypted file — decrypt locally with your AES-256 key'
        : 'Download started');
    } catch(e) { toast(e.message, 'error'); }
    finally { setDownloading(null); }
  }

  const config       = dest ? (typeof dest.config === 'string' ? JSON.parse(dest.config) : dest.config) : {};
  const encEnabled   = dest?.encryption_enabled || config?.encryption_enabled;
  const q            = filter.trim().toLowerCase();
  const filteredFolders = items.folders
    .filter(f => !q || f.name.toLowerCase().includes(q))
    .slice()
    .sort((a, b) => {
      const da = folderStats[a.prefix]?.lastModified;
      const db = folderStats[b.prefix]?.lastModified;
      if (da && db) return new Date(db) - new Date(da);
      if (da) return -1;
      if (db) return 1;
      return a.name.localeCompare(b.name);
    });
  const filteredFiles= items.files.filter(f => !q || f.name.toLowerCase().includes(q));

  if (allDests.length === 0 && !loading) return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'14px 22px', borderBottom:'1px solid var(--bv-bd)', background:'var(--bv-bg2)' }}>
        <div style={{ fontSize:20, fontWeight:500, color:'var(--bv-txt)', display:'flex', alignItems:'center', gap:9 }}>
          <i className="ti ti-cloud" style={{ color:'#c74634', fontSize:22 }}/> OCI Object Storage
        </div>
      </div>
      <div style={{ display:'flex', justifyContent:'center', alignItems:'center', flex:1, flexDirection:'column', gap:14, color:'var(--bv-txt3)' }}>
        <i className="ti ti-cloud-off" style={{ fontSize:52, color:'var(--bv-bd2)' }}/>
        <div style={{ fontSize:16, fontWeight:500, color:'var(--bv-txt2)' }}>No OCI destination configured</div>
        <div style={{ fontSize:13 }}>
          Go to <a href="/destinations" style={{ color:'var(--bv-blue)' }}>Destinations</a> → OCI Object Storage section → Add button
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

      {/* Header */}
      <div style={{ padding:'14px 22px 12px', borderBottom:'1px solid var(--bv-bd)',
        background:'var(--bv-bg2)', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:10 }}>
          <div>
            <div style={{ fontSize:20, fontWeight:500, color:'var(--bv-txt)',
              display:'flex', alignItems:'center', gap:9 }}>
              <i className="ti ti-cloud" style={{ color:'#c74634', fontSize:22 }}/>
              OCI Object Storage
              {encEnabled && (
                <span style={{ fontSize:11, padding:'2px 10px', borderRadius:10,
                  background:'var(--bv-green-bg)', color:'var(--bv-green)',
                  border:'1px solid var(--bv-green)', fontWeight:600,
                  display:'inline-flex', alignItems:'center', gap:5 }}>
                  <i className="ti ti-shield-lock" style={{ fontSize:12 }}/>
                  AES-256-GCM Encrypted
                </span>
              )}
            </div>
            <div style={{ fontSize:12, color:'var(--bv-txt2)', marginTop:3 }}>
              {config.namespace && (
                <span>Namespace: <span style={{ color:'var(--bv-cyan)', fontFamily:'monospace' }}>{config.namespace}</span> · </span>
              )}
              Bucket: <span style={{ color:'var(--bv-cyan)', fontFamily:'monospace' }}>
                oci://{config.bucket}/
              </span>
              {config.region && <span style={{ marginLeft:8 }}>Region: <strong>{config.region}</strong></span>}
            </div>
          </div>

          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            {/* Destination selector */}
            {allDests.length > 1 && (
              <select value={dest?.id || ''} onChange={e => {
                const d = allDests.find(x => String(x.id) === e.target.value);
                setDest(d); setPrefix(''); setFilter('');
              }} style={{ fontSize:12, padding:'5px 10px', background:'var(--bv-input)',
                border:'1px solid var(--bv-bd2)', color:'var(--bv-txt)', borderRadius:7 }}>
                {allDests.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
            <input value={filter} onChange={e => setFilter(e.target.value)}
              placeholder="Filter files..." style={{ fontSize:12, padding:'5px 10px',
                background:'var(--bv-input)', border:'1px solid var(--bv-bd2)',
                color:'var(--bv-txt)', borderRadius:7, width:180 }}/>
            <Btn variant="ghost" icon="refresh" onClick={load}>Refresh</Btn>
          </div>
        </div>

        {/* Breadcrumb */}
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12,
          flexWrap:'wrap', marginTop:4 }}>
          <button onClick={() => navigate('')}
            style={{ background:'none', border:'none', color:'var(--bv-blue)',
              cursor:'pointer', padding:'2px 4px', fontSize:12 }}>
            oci://{config.bucket}/
          </button>
          {breadcrumbs.map((b, i) => (
            <span key={b.prefix} style={{ display:'flex', alignItems:'center', gap:6 }}>
              <i className="ti ti-chevron-right" style={{ fontSize:10, color:'var(--bv-txt3)' }}/>
              <button onClick={() => navigate(b.prefix)}
                style={{ background:'none', border:'none', cursor:'pointer',
                  color: i === breadcrumbs.length-1 ? 'var(--bv-txt)' : 'var(--bv-blue)',
                  fontSize:12, padding:'2px 4px',
                  fontWeight: i === breadcrumbs.length-1 ? 600 : 400 }}>
                {b.label}
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* Encryption info banner */}
      {encEnabled && (
        <div style={{ margin:'12px 22px 0', padding:'10px 14px',
          background:'var(--bv-green-bg)', border:'1px solid var(--bv-green)',
          borderRadius:8, fontSize:11, color:'var(--bv-txt2)',
          display:'flex', alignItems:'center', gap:10 }}>
          <i className="ti ti-shield-lock" style={{ color:'var(--bv-green)', fontSize:18, flexShrink:0 }}/>
          <div>
            <strong style={{ color:'var(--bv-green)' }}>Client-side AES-256-GCM encryption is active.</strong>
            {' '}Files are encrypted before upload — even OCI cannot read them.
            Files with <code style={{ background:'var(--bv-bg3)', padding:'1px 4px', borderRadius:3 }}>.enc</code> extension
            are encrypted and must be decrypted with your <code>BACKUP_ENCRYPTION_KEY</code> to restore.
          </div>
        </div>
      )}

      {/* Content */}
      <div style={{ flex:1, overflowY:'auto', padding:'14px 22px' }}>
        {loading ? (
          <div style={{ display:'flex', justifyContent:'center', padding:60, gap:12, color:'var(--bv-txt3)' }}>
            <Spinner size={26}/> Loading OCI bucket...
          </div>
        ) : (
          <div style={{ background:'var(--bv-card)', border:'1px solid var(--bv-bd)',
            borderRadius:10, overflow:'hidden' }}>

            {/* Table header */}
            <div style={{ display:'grid',
              gridTemplateColumns:'minmax(180px,1fr) 90px 110px 160px 130px 130px',
              padding:'8px 16px', background:'var(--bv-bg3)',
              borderBottom:'1px solid var(--bv-bd)' }}>
              {['Name','Files','Size','Last Modified','Storage Class',''].map((h,i) => (
                <div key={i} style={{ fontSize:10, fontWeight:600, color:'var(--bv-txt3)',
                  textTransform:'uppercase', letterSpacing:'.06em' }}>{h}</div>
              ))}
            </div>

            {/* Back row */}
            {prefix && (
              <div onClick={() => {
                const parts = prefix.replace(/\/$/, '').split('/');
                parts.pop();
                navigate(parts.length ? parts.join('/') + '/' : '');
              }} style={{ display:'grid',
                gridTemplateColumns:'minmax(180px,1fr) 90px 110px 160px 130px 130px',
                padding:'10px 16px', cursor:'pointer', borderBottom:'1px solid var(--bv-bd)',
                background:'var(--bv-card)' }}
                onMouseEnter={e => e.currentTarget.style.background='var(--bv-hover)'}
                onMouseLeave={e => e.currentTarget.style.background='var(--bv-card)'}>
                <div style={{ display:'flex', alignItems:'center', gap:8, color:'var(--bv-blue)', fontSize:13 }}>
                  <i className="ti ti-arrow-up" style={{ fontSize:14 }}/> ../ (back)
                </div>
                <div/><div/><div/><div/><div/>
              </div>
            )}

            {/* Folders — last modified = newest object inside the prefix */}
            {filteredFolders.map((folder, i) => {
              const stats = folderStats[folder.prefix];
              return (
              <div key={folder.prefix} onClick={() => navigate(folder.prefix)}
                style={{ display:'grid',
                  gridTemplateColumns:'minmax(180px,1fr) 90px 110px 160px 130px 130px',
                  padding:'10px 16px', cursor:'pointer',
                  borderBottom:'1px solid var(--bv-bd)',
                  background: i % 2 === 0 ? 'var(--bv-card)' : 'var(--bv-bg3)' }}
                onMouseEnter={e => e.currentTarget.style.background='var(--bv-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = i%2===0?'var(--bv-card)':'var(--bv-bg3)'}>
                <div style={{ display:'flex', alignItems:'center', gap:10, fontSize:13 }}>
                  <i className="ti ti-folder-filled" style={{ color:'var(--bv-amber)', fontSize:18 }}/>
                  <span style={{ color:'var(--bv-txt)', fontWeight:500 }}>{folder.name}/</span>
                </div>
                <div style={{ fontSize:11, color:'var(--bv-txt2)', alignSelf:'center' }}>
                  {stats
                    ? <span style={{ fontWeight:500 }}>{stats.totalObjects} file{stats.totalObjects===1?'':'s'}</span>
                    : <span style={{ color:'var(--bv-txt3)' }}>…</span>}
                </div>
                <div style={{ fontSize:12, color:'var(--bv-txt2)', alignSelf:'center' }}>
                  {stats ? fmtBytes(stats.totalSize) : <span style={{ fontSize:10, color:'var(--bv-txt3)' }}>calculating…</span>}
                </div>
                <div style={{ fontSize:11, color:'var(--bv-txt)', alignSelf:'center', whiteSpace:'nowrap' }}>
                  {stats ? fmtDate(stats.lastModified) : <span style={{ color:'var(--bv-txt3)' }}>—</span>}
                </div>
                <div style={{ alignSelf:'center' }}>
                  {stats?.storageClass ? (
                    <span style={{ fontSize:10, padding:'2px 8px', borderRadius:8,
                      background:'var(--bv-bg4)', color:'var(--bv-txt3)',
                      fontWeight:600, fontFamily:'monospace' }}>
                      {stats.storageClass}
                    </span>
                  ) : (
                    <span style={{ fontSize:11, color:'var(--bv-txt3)' }}>—</span>
                  )}
                </div>
                <div style={{ alignSelf:'center', color:'var(--bv-txt3)' }}>
                  <i className="ti ti-chevron-right" style={{ fontSize:12 }}/>
                </div>
              </div>
              );
            })}

            {/* Files */}
            {filteredFiles.map((file, i) => (
              <div key={file.key}
                style={{ display:'grid',
                  gridTemplateColumns:'minmax(180px,1fr) 90px 110px 160px 130px 130px',
                  padding:'10px 16px',
                  borderBottom: i < filteredFiles.length-1 ? '1px solid var(--bv-bd)' : 'none',
                  background: (filteredFolders.length + i) % 2 === 0 ? 'var(--bv-card)' : 'var(--bv-bg3)' }}>

                {/* Name */}
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <i className="ti ti-file-zip" style={{ color:'var(--bv-blue)', fontSize:16, flexShrink:0 }}/>
                  <div>
                    <div style={{ fontSize:12, color:'var(--bv-txt)', fontFamily:'monospace',
                      wordBreak:'break-all' }}>{file.name}</div>
                    {file.encrypted && (
                      <span style={{ fontSize:10, padding:'1px 6px', borderRadius:6,
                        background:'var(--bv-green-bg)', color:'var(--bv-green)',
                        border:'1px solid var(--bv-green)', fontWeight:600,
                        display:'inline-flex', alignItems:'center', gap:4, marginTop:3 }}>
                        <i className="ti ti-lock" style={{ fontSize:10 }}/> AES-256-GCM
                      </span>
                    )}
                  </div>
                </div>

                {/* Files count (folders only) */}
                <div style={{ fontSize:11, color:'var(--bv-txt3)', alignSelf:'center' }}>—</div>

                {/* Size */}
                <div style={{ fontSize:12, color:'var(--bv-txt2)', alignSelf:'center' }}>
                  {fmtBytes(file.size)}
                </div>

                {/* Date */}
                <div style={{ fontSize:11, color:'var(--bv-txt)', alignSelf:'center', whiteSpace:'nowrap' }}>
                  {fmtDate(file.modified)}
                </div>

                {/* Storage class */}
                <div style={{ alignSelf:'center' }}>
                  <span style={{ fontSize:10, padding:'2px 8px', borderRadius:8,
                    background:'var(--bv-bg4)', color:'var(--bv-txt3)',
                    fontWeight:600, fontFamily:'monospace' }}>
                    {file.storage}
                  </span>
                </div>

                {/* Download */}
                <div style={{ display:'flex', alignItems:'center' }}>
                  <button onClick={() => handleDownload(file)}
                    disabled={downloading === file.key}
                    style={{ fontSize:11, padding:'4px 10px',
                      background: 'var(--bv-blue-dim)', border:'1px solid var(--bv-blue)',
                      color:'var(--bv-blue)', borderRadius:6, cursor:'pointer',
                      display:'flex', alignItems:'center', gap:4, fontWeight:500 }}>
                    {downloading === file.key
                      ? <Spinner size={12}/>
                      : <i className="ti ti-download" style={{ fontSize:12 }}/>}
                    {file.encrypted ? 'Download (.enc)' : 'Download'}
                  </button>
                </div>
              </div>
            ))}

            {/* Empty state */}
            {filteredFolders.length === 0 && filteredFiles.length === 0 && !loading && (
              <div style={{ textAlign:'center', padding:50, color:'var(--bv-txt3)' }}>
                <i className="ti ti-folder-off" style={{ fontSize:40, display:'block',
                  marginBottom:12, color:'var(--bv-bd2)' }}/>
                <div style={{ fontSize:14, color:'var(--bv-txt2)', marginBottom:6 }}>
                  {filter ? `No files matching "${filter}"` : 'Empty folder'}
                </div>
                {!prefix && (
                  <div style={{ fontSize:12 }}>
                    Backups will appear here after the first successful backup run with OCI destination enabled
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Encryption howto */}
        {encEnabled && (
          <div style={{ marginTop:14, padding:'12px 16px', background:'var(--bv-bg3)',
            border:'1px solid var(--bv-bd)', borderRadius:9,
            fontSize:11, color:'var(--bv-txt3)', lineHeight:1.7 }}>
            <div style={{ fontWeight:600, color:'var(--bv-txt2)', marginBottom:6 }}>
              <i className="ti ti-key" style={{ marginRight:6, color:'var(--bv-amber)' }}/>
              How to decrypt a downloaded .enc file:
            </div>
            <code style={{ display:'block', background:'var(--bv-bg2)', padding:'8px 12px',
              borderRadius:6, fontFamily:'monospace', fontSize:11, color:'var(--bv-cyan)',
              marginBottom:4 }}>
              # On BackupVault server (has the key):{'\n'}
              node -e "require('./src/services/ociService').decryptFile('file.sql.gz.enc','file.sql.gz').then(()=>console.log('Decrypted'))"
            </code>
            <div style={{ color:'var(--bv-txt3)', fontSize:10 }}>
              The encryption key is stored in <code>/var/www/backupvault/backend/.env</code> as <code>BACKUP_ENCRYPTION_KEY</code>.
              Keep this key in a secure location separate from the backup files.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
