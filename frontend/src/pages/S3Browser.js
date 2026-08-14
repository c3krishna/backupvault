// frontend/src/pages/S3Browser.js
// AWS S3 bucket browser — real files, folder stats, presigned download, newest first

import { useState, useEffect, useCallback, useRef } from 'react';
import { s3BrowserAPI } from '../services/api';
import { Spinner, toast } from '../components/UI';

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
}

const SC_MAP = {
  STANDARD:             { bg:'var(--bv-blue-dim)',   tx:'var(--bv-blue)',   lbl:'STANDARD'     },
  STANDARD_IA:          { bg:'var(--bv-cyan-bg)',    tx:'var(--bv-cyan)',   lbl:'STANDARD-IA'  },
  ONEZONE_IA:           { bg:'var(--bv-cyan-bg)',    tx:'var(--bv-cyan)',   lbl:'ONEZONE-IA'   },
  GLACIER:              { bg:'var(--bv-purple-bg)',  tx:'var(--bv-purple)', lbl:'GLACIER'       },
  GLACIER_IR:           { bg:'var(--bv-purple-bg)',  tx:'var(--bv-purple)', lbl:'GLACIER-IR'   },
  DEEP_ARCHIVE:         { bg:'var(--bv-purple-bg)',  tx:'var(--bv-purple)', lbl:'DEEP-ARCHIVE' },
  INTELLIGENT_TIERING:  { bg:'var(--bv-amber-bg)',   tx:'var(--bv-amber)',  lbl:'INT-TIER'     },
};

function SCBadge({ cls }) {
  const s = SC_MAP[cls] || SC_MAP.STANDARD_IA;
  return <span style={{fontSize:9,padding:'2px 6px',borderRadius:6,fontWeight:600,background:s.bg,color:s.tx,flexShrink:0}}>{s.lbl}</span>;
}

function FileIcon({ item }) {
  if (item.type==='folder') return <i className="ti ti-folder-filled" style={{fontSize:15,color:'var(--bv-amber)',flexShrink:0}}/>;
  const n = (item.name||'').toLowerCase();
  if (n.endsWith('.sql.gz')||n.endsWith('.gz')) return <i className="ti ti-file-zip" style={{fontSize:15,color:'var(--bv-cyan)',flexShrink:0}}/>;
  if (n.endsWith('.sql'))  return <i className="ti ti-file-code"  style={{fontSize:15,color:'var(--bv-blue)',flexShrink:0}}/>;
  if (n.endsWith('.rdb'))  return <i className="ti ti-database"   style={{fontSize:15,color:'var(--bv-red)',flexShrink:0}}/>;
  return <i className="ti ti-file" style={{fontSize:15,color:'var(--bv-txt3)',flexShrink:0}}/>;
}

export default function S3Browser() {
  const [dests,       setDests]       = useState([]);
  const [selDest,     setSelDest]     = useState(null);
  const [prefix,      setPrefix]      = useState('');
  const [history,     setHistory]     = useState([]);
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [errorCode,   setErrorCode]   = useState(null);
  const [filter,      setFilter]      = useState('');
  const [selFile,     setSelFile]     = useState(null);
  const [downloading, setDownloading] = useState(null);
  const [folderStats, setFolderStats] = useState({}); // key=prefix → {totalSize, totalObjects}
  const statsTimer = useRef({});

  // Load S3 destinations on mount
  useEffect(() => {
    s3BrowserAPI.destinations()
      .then(list => {
        setDests(list);
        if (list.length > 0) { setSelDest(list[0]); }
      })
      .catch(e => setError(e.message));
  }, []);

  const browse = useCallback(async (destId, browsePrefix) => {
    setLoading(true); setError(null); setErrorCode(null); setSelFile(null);
    try {
      const res = await s3BrowserAPI.list(destId, browsePrefix);
      setData(res);
      setPrefix(browsePrefix);
      // Lazy-load folder stats in background for visible folders
      if (res.folders?.length > 0) {
        res.folders.forEach(f => {
          if (!folderStats[f.prefix]) {
            clearTimeout(statsTimer.current[f.prefix]);
            statsTimer.current[f.prefix] = setTimeout(async () => {
              try {
                const stats = await s3BrowserAPI.folderStats(destId, f.prefix);
                setFolderStats(p => ({ ...p, [f.prefix]: stats }));
              } catch {}
            }, 300 + Math.random()*200); // stagger requests
          }
        });
      }
    } catch (e) {
      setError(e.message);
      setErrorCode(e.code);
      setData(null);
    } finally { setLoading(false); }
  }, [folderStats]);

  useEffect(() => {
    if (selDest) { setFolderStats({}); browse(selDest.id, ''); }
  }, [selDest]); // eslint-disable-line

  function navigateFolder(folder) { setHistory(h=>[...h,prefix]); browse(selDest.id, folder.prefix); }
  function goBack()  { if (!history.length) return; const p=history[history.length-1]; setHistory(h=>h.slice(0,-1)); browse(selDest.id,p); }
  function goRoot()  { setHistory([]); browse(selDest.id, ''); }

  function navCrumb(idx) {
    const segs = prefix.split('/').filter(Boolean);
    const tgt  = segs.slice(0,idx+1).join('/') + '/';
    setHistory(h => h.slice(0,idx));
    browse(selDest.id, tgt);
  }

  async function handleDownload(file) {
    setDownloading(file.key);
    try {
      const { url } = await s3BrowserAPI.presign(selDest.id, file.key);
      const a = document.createElement('a');
      a.href=url; a.target='_blank'; a.rel='noopener noreferrer'; a.download=file.name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      toast(`Download started — link valid for 1 hour`);
    } catch(e) { toast(e.message,'error'); }
    finally { setTimeout(()=>setDownloading(null),3000); }
  }

  const crumbs  = prefix ? prefix.split('/').filter(Boolean) : [];
  const visible = [
    ...(data?.folders||[]),
    ...(data?.files||[]),
  ].filter(item => !filter || item.name.toLowerCase().includes(filter.toLowerCase()));

  const totalFilesShown  = (data?.files||[]).length;
  const totalFolders     = (data?.folders||[]).length;

  // ── NO S3 CONFIGURED ───────────────────────────────────────────────────────
  if (!loading && dests.length===0 && !error) return (
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <PageHeader dests={[]} selDest={null} onDest={()=>{}} onRefresh={null}
        filter="" setFilter={()=>{}} goBack={goBack} canBack={false}/>
      <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',
        flexDirection:'column',gap:14,color:'var(--bv-txt3)'}}>
        <i className="ti ti-brand-aws" style={{fontSize:56,color:'var(--bv-amber)'}}/>
        <div style={{fontSize:17,fontWeight:500,color:'var(--bv-txt2)'}}>AWS S3 not configured</div>
        <div style={{fontSize:13,textAlign:'center',lineHeight:1.8,maxWidth:400}}>
          Go to <a href="/destinations" style={{color:'var(--bv-blue)'}}>Destinations</a> → Add AWS S3 →<br/>
          Enter bucket, region, access key, secret key → Save
        </div>
      </div>
    </div>
  );

  return (
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>

      {/* Header */}
      <PageHeader dests={dests} selDest={selDest} onDest={d=>{setSelDest(d);setHistory([]);}}
        onRefresh={()=>selDest&&browse(selDest.id,prefix)}
        filter={filter} setFilter={setFilter}
        goBack={goBack} canBack={history.length>0}/>

      {/* Bucket summary bar */}
      {data?.bucketStats && (
        <div style={{padding:'6px 18px',background:'var(--bv-bg2)',borderBottom:'1px solid var(--bv-bd)',
          display:'flex',alignItems:'center',gap:20,flexShrink:0,flexWrap:'wrap'}}>
          <span style={{fontSize:11,display:'flex',alignItems:'center',gap:6}}>
            <i className="ti ti-brand-aws" style={{color:'var(--bv-amber)',fontSize:14}}/>
            <strong style={{color:'var(--bv-txt2)',fontFamily:'monospace'}}>s3://{data.bucket}</strong>
          </span>
          <span style={{fontSize:11,color:'var(--bv-txt3)'}}>Total: <strong style={{color:'var(--bv-txt2)'}}>{data.bucketStats.size}</strong></span>
          {data.bucketStats.objects!=null && <span style={{fontSize:11,color:'var(--bv-txt3)'}}>Objects: <strong style={{color:'var(--bv-txt2)'}}>{data.bucketStats.objects?.toLocaleString()}</strong></span>}
          <span style={{fontSize:11,color:'var(--bv-txt3)'}}>Region: <strong style={{color:'var(--bv-cyan)',fontFamily:'monospace'}}>{data.region}</strong></span>
          {data.truncated && <span style={{fontSize:10,color:'var(--bv-amber)'}}>⚠ Results truncated at 500</span>}
        </div>
      )}

      {/* Breadcrumb */}
      <div style={{padding:'7px 18px',borderBottom:'1px solid var(--bv-bd)',background:'var(--bv-bg2)',
        display:'flex',alignItems:'center',gap:4,flexShrink:0,flexWrap:'wrap',minHeight:36}}>
        <button onClick={goRoot} title="Bucket root"
          style={{background:'none',border:'none',color:'var(--bv-amber)',cursor:'pointer',fontSize:16,padding:'2px 4px',display:'flex',alignItems:'center'}}>
          <i className="ti ti-brand-aws"/>
        </button>
        {crumbs.map((seg,i)=>(
          <span key={i} style={{display:'flex',alignItems:'center',gap:4}}>
            <span style={{color:'var(--bv-bd2)',fontSize:12,flexShrink:0}}>/</span>
            <button onClick={()=>navCrumb(i)} style={{background:'none',border:'none',cursor:'pointer',
              fontSize:12,padding:'2px 5px',fontFamily:'monospace',borderRadius:4,
              color:i===crumbs.length-1?'var(--bv-txt)':'var(--bv-blue)',
              fontWeight:i===crumbs.length-1?500:400}}>{seg}</button>
          </span>
        ))}
        <div style={{flex:1}}/>
        <span style={{fontSize:11,color:'var(--bv-txt3)'}}>
          {totalFolders} folders · {totalFilesShown} files
        </span>
      </div>

      {/* Error */}
      {error && (
        <div style={{margin:14,padding:'12px 16px',background:'var(--bv-red-dim)',
          border:'1px solid var(--bv-red)',borderRadius:10,fontSize:13,color:'var(--bv-red)'}}>
          <i className="ti ti-alert-triangle" style={{marginRight:8}}/>
          {error}
          {error.includes('execSync')||error.includes('not defined') ? (
            <div style={{marginTop:7,fontSize:11,color:'var(--bv-txt2)'}}>
              Restart backend: <code style={{fontFamily:'monospace'}}>pm2 restart backupvault</code>
            </div>
          ) : error.includes('awscli')||error.includes('aws: command') ? (
            <div style={{marginTop:7,fontFamily:'monospace',fontSize:11,color:'var(--bv-amber)',
              background:'var(--bv-bg3)',padding:'5px 9px',borderRadius:5}}>
              pip3 install awscli --break-system-packages && pm2 restart backupvault
            </div>
          ) : null}
        </div>
      )}

      {/* Main area */}
      <div style={{flex:1,display:'flex',overflow:'hidden'}}>
        <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>

          <div style={{flex:1,overflowY:'auto'}}>
            {loading ? (
              <div style={{display:'flex',justifyContent:'center',alignItems:'center',
                padding:60,gap:12,color:'var(--bv-txt3)'}}>
                <Spinner size={26}/> Fetching from S3...
              </div>
            ) : !error && (
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead style={{position:'sticky',top:0,background:'var(--bv-bg2)',zIndex:1}}>
                  <tr>
                    {['Name','Files','Total Size','Last Modified','Storage Class',''].map(h=>(
                      <th key={h} style={{textAlign:'left',fontSize:10,fontWeight:600,color:'var(--bv-txt3)',
                        letterSpacing:'.07em',textTransform:'uppercase',padding:'8px 14px',
                        borderBottom:'1px solid var(--bv-bd)',whiteSpace:'nowrap'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.length===0 ? (
                    <tr><td colSpan={6} style={{textAlign:'center',padding:52,color:'var(--bv-txt3)',fontSize:13}}>
                      {filter?`No items matching "${filter}"`:'Empty — no files here'}
                    </td></tr>
                  ) : visible.map(item => {
                    const isSel = selFile?.key===item.key;
                    const fs    = item.type==='folder' ? folderStats[item.prefix] : null;
                    return (
                      <tr key={item.key}
                        onClick={()=>item.type==='folder'?navigateFolder(item):setSelFile(item)}
                        style={{cursor:'pointer',background:isSel?'var(--bv-blue-dim)':''}}
                        onMouseEnter={e=>{if(!isSel)e.currentTarget.style.background='var(--bv-hover)';}}
                        onMouseLeave={e=>{if(!isSel)e.currentTarget.style.background='';}}>
                        {/* Name */}
                        <td style={{padding:'9px 14px',borderBottom:'1px solid var(--bv-bd)'}}>
                          <div style={{display:'flex',alignItems:'center',gap:9}}>
                            <FileIcon item={item}/>
                            <span style={{fontSize:12,
                              fontFamily:item.type==='file'?'monospace':'inherit',
                              color:item.type==='folder'?'var(--bv-amber)':'var(--bv-txt)'}}>
                              {item.name}{item.type==='folder'?'/':''}
                            </span>
                          </div>
                        </td>
                        {/* Files count */}
                        <td style={{padding:'9px 14px',borderBottom:'1px solid var(--bv-bd)',
                          fontSize:11,color:'var(--bv-txt3)',whiteSpace:'nowrap'}}>
                          {item.type==='folder'
                            ? fs ? <span style={{color:'var(--bv-txt2)',fontWeight:500}}>{fs.totalObjects} files</span>
                              : <span style={{color:'var(--bv-txt3)'}}>—</span>
                            : '—'}
                        </td>
                        {/* Total size */}
                        <td style={{padding:'9px 14px',borderBottom:'1px solid var(--bv-bd)',
                          fontSize:12,color:'var(--bv-txt2)',whiteSpace:'nowrap'}}>
                          {item.type==='folder'
                            ? fs ? <span style={{color:'var(--bv-txt)',fontWeight:500}}>{fs.totalSize}</span>
                              : <span style={{fontSize:10,color:'var(--bv-txt3)'}}>calculating...</span>
                            : item.sizeHuman}
                        </td>
                        {/* Last modified */}
                        <td style={{padding:'9px 14px',borderBottom:'1px solid var(--bv-bd)',
                          fontSize:11,color:'var(--bv-txt3)',whiteSpace:'nowrap'}}>
                          {item.type==='folder'?'—':fmtDate(item.lastModified)}
                        </td>
                        {/* Storage class */}
                        <td style={{padding:'9px 14px',borderBottom:'1px solid var(--bv-bd)'}}>
                          {item.storageClass?<SCBadge cls={item.storageClass}/>:'—'}
                        </td>
                        {/* Download */}
                        <td style={{padding:'9px 14px',borderBottom:'1px solid var(--bv-bd)'}}>
                          {item.type==='file' && (
                            <button onClick={e=>{e.stopPropagation();handleDownload(item);}}
                              disabled={downloading===item.key}
                              style={{background:'none',border:'1px solid var(--bv-bd2)',
                                color:'var(--bv-blue)',borderRadius:6,padding:'3px 9px',
                                fontSize:11,cursor:'pointer',display:'flex',alignItems:'center',gap:4}}>
                              <i className={`ti ${downloading===item.key?'ti-loader':'ti-download'}`} style={{fontSize:11}}/>
                              {downloading===item.key?'…':'Download'}
                            </button>
                          )}
                          {item.type==='folder' && (
                            <span style={{fontSize:10,color:'var(--bv-txt3)'}}>
                              <i className="ti ti-chevron-right"/>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Status bar */}
          <div style={{padding:'5px 14px',borderTop:'1px solid var(--bv-bd)',background:'var(--bv-bg2)',
            display:'flex',justifyContent:'space-between',fontSize:11,color:'var(--bv-txt3)',flexShrink:0}}>
            <span>{visible.length} items{filter?` (filtered)`:''}
              {filter && <button onClick={()=>setFilter('')}
                style={{marginLeft:6,background:'none',border:'none',color:'var(--bv-blue)',cursor:'pointer',fontSize:11}}>
                clear ×</button>}
            </span>
            <span style={{fontFamily:'monospace',fontSize:10}}>
              s3://{data?.bucket||'…'}/{prefix||'(root)'}
            </span>
          </div>
        </div>

        {/* File detail panel */}
        {selFile && (
          <div style={{width:260,flexShrink:0,borderLeft:'1px solid var(--bv-bd)',
            background:'var(--bv-bg2)',display:'flex',flexDirection:'column'}}>
            <div style={{padding:'11px 14px',borderBottom:'1px solid var(--bv-bd)',
              display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontSize:12,fontWeight:500,color:'var(--bv-txt)'}}>File details</span>
              <button onClick={()=>setSelFile(null)} style={{background:'none',border:'none',
                color:'var(--bv-txt3)',fontSize:18,cursor:'pointer',lineHeight:1}}>×</button>
            </div>
            <div style={{padding:14,flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:10}}>
              <div style={{padding:'10px 12px',background:'var(--bv-bg3)',border:'1px solid var(--bv-bd)',
                borderRadius:8,textAlign:'center'}}>
                <FileIcon item={selFile}/>
                <div style={{fontSize:11,fontFamily:'monospace',color:'var(--bv-txt)',
                  wordBreak:'break-all',lineHeight:1.5,marginTop:8}}>{selFile.name}</div>
              </div>
              {[
                ['Size',          selFile.sizeHuman],
                ['Last modified', fmtDate(selFile.lastModified)],
                ['Storage class', selFile.storageClass],
                ['ETag',          selFile.etag ? selFile.etag.substring(0,16)+'…' : null],
                ['S3 key',        selFile.key],
              ].filter(([,v])=>v).map(([k,v])=>(
                <div key={k}>
                  <div style={{fontSize:10,color:'var(--bv-txt3)',letterSpacing:'.06em',textTransform:'uppercase',marginBottom:3}}>{k}</div>
                  <div style={{fontSize:11,color:'var(--bv-txt2)',fontFamily:k==='S3 key'||k==='ETag'?'monospace':'inherit',wordBreak:'break-all'}}>{v}</div>
                </div>
              ))}
              {selFile.storageClass && (
                <div style={{padding:'7px 10px',background:'var(--bv-bg3)',borderRadius:7,fontSize:11,color:'var(--bv-txt2)'}}>
                  {selFile.storageClass==='GLACIER'||selFile.storageClass==='DEEP_ARCHIVE'
                    ? <><i className="ti ti-snowflake" style={{color:'var(--bv-purple)',marginRight:5}}/>Archived — restore required before download</>
                    : <><i className="ti ti-check" style={{color:'var(--bv-green)',marginRight:5}}/>Available for immediate download</>}
                </div>
              )}
              <button onClick={()=>handleDownload(selFile)}
                disabled={downloading===selFile.key}
                style={{width:'100%',padding:'9px',
                  background:selFile.storageClass==='GLACIER'||selFile.storageClass==='DEEP_ARCHIVE'?'var(--bv-purple)':'var(--bv-accent)',
                  color:'#fff',border:'none',borderRadius:8,fontSize:13,cursor:'pointer',fontWeight:500,
                  display:'flex',alignItems:'center',justifyContent:'center',gap:6,marginTop:'auto'}}>
                <i className="ti ti-download" style={{fontSize:15}}/>
                {downloading===selFile.key?'Preparing…':'Generate Download Link'}
              </button>
              <div style={{fontSize:10,color:'var(--bv-txt3)',textAlign:'center'}}>
                Pre-signed URL · valid 1 hour
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PageHeader({dests,selDest,onDest,onRefresh,filter,setFilter,goBack,canBack}) {
  return (
    <div style={{padding:'13px 20px 11px',borderBottom:'1px solid var(--bv-bd)',
      background:'var(--bv-bg2)',flexShrink:0}}>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:20,fontWeight:500,color:'var(--bv-txt)',display:'flex',alignItems:'center',gap:9}}>
            <i className="ti ti-brand-aws" style={{color:'var(--bv-amber)',fontSize:22}}/>
            AWS S3 File Browser
          </div>
          <div style={{fontSize:12,color:'var(--bv-txt2)',marginTop:3}}>
            {selDest
              ? <>Browse <span style={{color:'var(--bv-cyan)',fontFamily:'monospace'}}>s3://{selDest.bucket}</span>
                  <span style={{color:'var(--bv-txt3)'}}> · {selDest.region}</span></>
              : 'No S3 destination configured'}
          </div>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          {dests.length>1 && (
            <select value={selDest?.id||''} onChange={e=>onDest(dests.find(d=>String(d.id)===e.target.value))}
              style={{fontSize:12,padding:'6px 10px',background:'var(--bv-input)',
                border:'1px solid var(--bv-bd2)',color:'var(--bv-txt)',borderRadius:8}}>
              {dests.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
          {canBack && (
            <button onClick={goBack} style={{display:'flex',alignItems:'center',gap:5,padding:'6px 11px',
              border:'1px solid var(--bv-bd2)',background:'var(--bv-input)',color:'var(--bv-txt)',
              borderRadius:8,fontSize:12,cursor:'pointer'}}>
              <i className="ti ti-arrow-left" style={{fontSize:13}}/> Back
            </button>
          )}
          <input value={filter} onChange={e=>setFilter(e.target.value)}
            placeholder="Filter files…"
            style={{fontSize:12,padding:'6px 10px',background:'var(--bv-input)',
              border:'1px solid var(--bv-bd2)',color:'var(--bv-txt)',borderRadius:8,width:170}}/>
          {onRefresh && (
            <button onClick={onRefresh} style={{display:'flex',alignItems:'center',gap:5,padding:'6px 11px',
              border:'1px solid var(--bv-bd2)',background:'var(--bv-input)',color:'var(--bv-txt)',
              borderRadius:8,fontSize:12,cursor:'pointer'}}>
              <i className="ti ti-refresh" style={{fontSize:13}}/> Refresh
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
