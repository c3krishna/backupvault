// src/components/UI.js
import { useState, useEffect } from 'react';

export function Badge({ type = 'default', children, small }) {
  const s = {
    success:    { background:'var(--bv-green-bg)', color:'var(--bv-green)' },
    failed:     { background:'var(--bv-red-bg)', color:'var(--bv-red)' },
    partial:    { background:'var(--bv-purple-bg)', color:'var(--bv-purple)' },
    running:    { background:'var(--bv-blue-dim)', color:'var(--bv-blue)' },
    pending:    { background:'var(--bv-bg4)', color:'var(--bv-txt2)' },
    automated:  { background:'var(--bv-cyan-bg)', color:'var(--bv-cyan)' },
    warn:       { background:'var(--bv-amber-bg)', color:'var(--bv-amber)' },
    mysql:      { background:'#1e3a1e', color:'#4ec94e', border:'1px solid #2a5c2a' },
    postgresql: { background:'#1a2550', color:'#7ca8f8', border:'1px solid #2a3870' },
    redis:      { background:'#3d1a10', color:'var(--bv-red)', border:'1px solid #602010' },
    full:       { background:'var(--bv-bg4)', color:'var(--bv-txt2)', border:'1px solid var(--bv-bd)' },
    incremental:{ background:'var(--bv-amber-bg)', color:'var(--bv-amber)', border:'1px solid var(--bv-amber-bg)' },
    connected:  { background:'var(--bv-green-bg)', color:'var(--bv-green)' },
    disconnected:{ background:'var(--bv-red-bg)', color:'var(--bv-red)' },
    misconfigured:{ background:'var(--bv-amber-bg)', color:'var(--bv-amber)' },
    info:       { background:'var(--bv-blue-dim)', color:'var(--bv-blue)' },
    default:    { background:'var(--bv-bg4)', color:'var(--bv-txt2)' },
  };
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize: small?10:11,
      fontWeight:600, padding: small?'2px 6px':'3px 8px', borderRadius:20, whiteSpace:'nowrap',
      ...s[type]||s.default }}>
      {children}
    </span>
  );
}

export function Dot({ color='green', pulse }) {
  const c = { green:'var(--bv-green)', red:'var(--bv-red)', amber:'var(--bv-amber)', blue:'var(--bv-blue)', gray:'var(--bv-txt3)', cyan:'var(--bv-cyan)' };
  return <span style={{ display:'inline-block', width:7, height:7, borderRadius:'50%',
    background:c[color]||color, flexShrink:0,
    boxShadow: pulse ? `0 0 6px ${c[color]||color}` : 'none' }} />;
}

export function Btn({ variant='default', size='md', icon, children, loading, ...p }) {
  const base = { display:'inline-flex', alignItems:'center', gap:6, border:'none',
    borderRadius:8, fontWeight:600, fontFamily:'inherit', cursor:'pointer',
    transition:'opacity .15s, background .15s',
    padding: size==='sm'?'5px 10px':'7px 14px', fontSize: size==='sm'?12:13,
    opacity: (loading||p.disabled)?.6:1, pointerEvents:(loading||p.disabled)?'none':'auto' };
  const v = {
    primary: { background:'var(--bv-accent)', color:'#fff' },
    success: { background:'var(--bv-green)', color:'#000' },
    danger:  { background:'var(--bv-red-bg)', color:'var(--bv-red)', border:'1px solid var(--bv-red-border)' },
    ghost:   { background:'var(--bv-bg4)', color:'var(--bv-txt)', border:'1px solid var(--bv-bd2)' },
    default: { background:'var(--bv-bg4)', color:'var(--bv-txt)', border:'1px solid var(--bv-bd2)' },
  };
  return (
    <button style={{...base,...v[variant]||v.default}} {...p}>
      {loading ? <Spinner size={14}/> : icon && <i className={`ti ti-${icon}`} style={{fontSize:15}}/>}
      {children}
    </button>
  );
}

export function Spinner({ size=20 }) {
  return <span style={{ display:'inline-block', width:size, height:size,
    border:`2px solid var(--bv-bd)`, borderTopColor:'var(--bv-blue)', borderRadius:'50%',
    animation:'bvspin .7s linear infinite', flexShrink:0 }}/>;
}

export function Card({ title, action, children, style, noPad }) {
  return (
    <div style={{ background:'var(--bv-card)', border:'1px solid var(--bv-bd)', borderRadius:12, transition:'background .2s',
      padding: noPad ? 0 : 16, ...style }}>
      {title && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
          marginBottom:14, padding: noPad ? '14px 16px 0' : 0 }}>
          <span style={{ fontSize:11, fontWeight:600, color:'var(--bv-txt2)',
            letterSpacing:'.06em', textTransform:'uppercase' }}>{title}</span>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function StatCard({ label, value, sub, color='white', accent='blue' }) {
  const c = { white:'var(--bv-txt)', green:'var(--bv-green)', red:'var(--bv-red)', amber:'var(--bv-amber)',
    blue:'var(--bv-blue)', cyan:'var(--bv-cyan)', purple:'var(--bv-purple)' };
  const a = { blue:'var(--bv-blue)', green:'var(--bv-green)', red:'var(--bv-red)', amber:'var(--bv-amber)',
    cyan:'var(--bv-cyan)', purple:'var(--bv-purple)' };
  return (
    <div style={{ background:'var(--bv-card)', border:'1px solid var(--bv-bd)', borderRadius:12, transition:'background .2s',
      padding:'14px 16px', borderTop:`2.5px solid ${a[accent]||a.blue}` }}>
      <div style={{ fontSize:10, color:'var(--bv-txt3)', letterSpacing:'.08em',
        textTransform:'uppercase', fontWeight:600, marginBottom:8 }}>{label}</div>
      <div style={{ fontSize:26, fontWeight:500, lineHeight:1, color:c[color]||c.white, marginBottom:4 }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:'var(--bv-txt3)' }}>{sub}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, width=480 }) {
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    if (open) document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div style={{ position:'fixed', inset:0, zIndex:2000, background:'rgba(0,0,0,.7)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
      onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={{ background:'var(--bv-card)', border:'1px solid var(--bv-bd)', borderRadius:12, transition:'background .2s',
        width:'100%', maxWidth:width, maxHeight:'90vh', overflow:'auto' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'14px 20px', borderBottom:'1px solid var(--bv-bd)', flexShrink:0 }}>
          <span style={{ fontSize:15, fontWeight:500, color:'var(--bv-txt)' }}>{title}</span>
          <button onClick={onClose} style={{ background:'none', border:'none',
            color:'var(--bv-txt2)', fontSize:22, lineHeight:1, cursor:'pointer' }}>×</button>
        </div>
        <div style={{ padding:20 }}>{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children, required }) {
  return (
    <div style={{ marginBottom:14 }}>
      <label style={{ display:'block', fontSize:12, color:'var(--bv-txt2)',
        fontWeight:600, marginBottom:5 }}>
        {label}{required && <span style={{ color:'var(--bv-red)', marginLeft:3 }}>*</span>}
      </label>
      {children}
      {hint && <div style={{ fontSize:11, color:'var(--bv-txt3)', marginTop:4 }}>{hint}</div>}
    </div>
  );
}

export function Toggle({ value, onChange, disabled }) {
  return (
    <div onClick={() => !disabled && onChange(!value)} style={{
      width:36, height:20, borderRadius:10,
      background: value ? 'var(--bv-accent)' : 'var(--bv-bg5)',
      border:`1px solid ${value ? 'var(--bv-accent)' : 'var(--bv-bd2)'}`,
      position:'relative', cursor: disabled?'not-allowed':'pointer',
      transition:'background .2s', flexShrink:0, opacity: disabled?.5:1
    }}>
      <div style={{ position:'absolute', top:2, width:14, height:14,
        borderRadius:'50%', background:'#fff', transition:'left .2s',
        left: value ? 18 : 2 }}/>
    </div>
  );
}

export function CronBadge({ expr }) {
  return <span style={{ fontFamily:'monospace', fontSize:11, background:'var(--bv-bg4)',
    border:'1px solid var(--bv-bd)', padding:'2px 8px', borderRadius:4,
    color:'var(--bv-cyan)', letterSpacing:'.05em' }}>{expr}</span>;
}

export function DbIcon({ type, size=28 }) {
  const c = {
    mysql:      { bg:'#1e3a1e', color:'#4ec94e', l:'M' },
    postgresql: { bg:'#1a2550', color:'#7ca8f8', l:'P' },
    redis:      { bg:'#3d1a10', color:'var(--bv-red)', l:'R' },
  };
  const x = c[type] || { bg:'var(--bv-bg4)', color:'var(--bv-txt2)', l:'?' };
  return (
    <div style={{ width:size, height:size, borderRadius:size>24?8:6,
      background:x.bg, color:x.color, display:'flex', alignItems:'center',
      justifyContent:'center', fontSize:size>24?13:10, fontWeight:700, flexShrink:0 }}>
      {x.l}
    </div>
  );
}

export function ProgressBar({ pct, height=8 }) {
  const color = pct >= 90 ? 'var(--bv-red)' : pct >= 80 ? 'var(--bv-amber)' : 'var(--bv-green)';
  return (
    <div style={{ width:'100%', height, background:'var(--bv-bg4)', borderRadius:height/2, overflow:'hidden' }}>
      <div style={{ height:'100%', width:`${pct}%`, background:color, borderRadius:height/2, transition:'width .3s' }}/>
    </div>
  );
}

// Toast system
let _setToasts = null;
export function ToastContainer() {
  const [toasts, setToasts] = useState([]);
  _setToasts = setToasts;
  return (
    <div style={{ position:'fixed', bottom:20, right:20, zIndex:9999,
      display:'flex', flexDirection:'column', gap:8, pointerEvents:'none' }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: t.type==='error' ? 'var(--bv-red-bg)' : 'var(--bv-green-bg)',
          border: `1px solid ${t.type==='error' ? 'var(--bv-red)' : 'var(--bv-green)'}`,
          color: t.type==='error' ? 'var(--bv-red)' : 'var(--bv-green)',
          padding:'10px 16px', borderRadius:8, fontSize:13, maxWidth:360,
          pointerEvents:'auto',
        }}>{t.message}</div>
      ))}
    </div>
  );
}
export function toast(message, type='success') {
  if (!_setToasts) return;
  const id = Date.now();
  _setToasts(p => [...p, { id, message, type }]);
  setTimeout(() => _setToasts(p => p.filter(t => t.id !== id)), 3500);
}

// Inject animation
if (typeof document !== 'undefined') {
  const s = document.createElement('style');
  s.textContent = '@keyframes bvspin{to{transform:rotate(360deg)}}';
  document.head.appendChild(s);
}

export function DestIcons({ transfers }) {
  const types = ['local','remote_sftp','aws_s3'];
  const cfg = {
    local:       { bg:'#2a3a1a', color:'#6ee84a', icon:'ti-server' },
    remote_sftp: { bg:'#1a2a3a', color:'#5aaef8', icon:'ti-building' },
    aws_s3:      { bg:'var(--bv-amber-bg)', color:'#f8a84a', icon:'ti-brand-aws' },
  };
  return (
    <div style={{ display:'flex', gap:4 }}>
      {types.map(t => {
        const tr = (transfers||[]).find(x => x.dest_type===t);
        const c  = cfg[t];
        return (
          <div key={t} title={t+(tr?' — '+tr.status:' — not used')} style={{
            width:18, height:18, borderRadius:4,
            background:c.bg, display:'flex', alignItems:'center',
            justifyContent:'center', opacity: tr ? 1 : 0.25,
          }}>
            <i className={`ti ${c.icon}`} style={{ fontSize:10, color:c.color }}/>
          </div>
        );
      })}
    </div>
  );
}
