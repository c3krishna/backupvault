// frontend/src/components/Sidebar.js
// Mobile-responsive: collapses to icon-only on small screens, hamburger toggle
import { NavLink, useNavigate } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { destinationsAPI, infraAPI } from '../services/api';
import { Dot } from './UI';

const BREAKPOINT = 768; // px — below this, sidebar starts collapsed

export default function Sidebar({ wsConnected }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // collapsed = icon-only mode; mobileOpen = overlay open on mobile
  const [collapsed,   setCollapsed]   = useState(() => window.innerWidth < BREAKPOINT);
  const [mobileOpen,  setMobileOpen]  = useState(false);
  const [isMobile,    setIsMobile]    = useState(() => window.innerWidth < BREAKPOINT);
  const [destInfo,    setDestInfo]    = useState({ s3:null, remote:null, primaryPct:null });
  const [nfsBadge,    setNfsBadge]    = useState(null); // { text, color } for NFS servers badge

  // Responsive listener
  useEffect(() => {
    function onResize() {
      const mobile = window.innerWidth < BREAKPOINT;
      setIsMobile(mobile);
      if (!mobile) setMobileOpen(false); // close overlay when going wide
      if (mobile)  setCollapsed(true);   // auto-collapse on mobile
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Close mobile overlay on route change
  useEffect(() => { setMobileOpen(false); }, [navigate]);

  // Load destination status
  const loadDests = useCallback(async () => {
    try {
      const [dests, health] = await Promise.allSettled([
        destinationsAPI.list(),
        infraAPI.health(),
      ]);
      const destList  = dests.status==='fulfilled'  ? dests.value  : [];
      const s3        = destList.find(d => d.dest_type==='aws_s3'      && d.is_active);
      const oci       = destList.find(d => d.dest_type==='oci_object');
      const remote    = destList.find(d => d.dest_type==='remote_sftp' && d.is_active);
      const primary   = health.status==='fulfilled' ? health.value?.storage?.primary : null;
      const primaryPct = primary?.diskPct ?? primary?.usedPct ?? null;
      setDestInfo({ s3, oci, remote, primaryPct });
      // NFS badge: count warn/critical servers
      try {
        const nfsServers = await fetch('/api/nfs', { headers:{ Authorization:`Bearer ${localStorage.getItem('bv_token')}` }}).then(r=>r.json());
        if (Array.isArray(nfsServers) && nfsServers.length > 0) {
          const critical = nfsServers.filter(s=>s.status==='critical').length;
          const warn     = nfsServers.filter(s=>s.status==='warn').length;
          const offline  = nfsServers.filter(s=>s.status==='offline'||!s.status).length;
          if      (critical>0) setNfsBadge({ text:`${critical}!`, color:'red'   });
          else if (offline>0)  setNfsBadge({ text:`${offline}`, color:'red'    });
          else if (warn>0)     setNfsBadge({ text:`${warn}⚠`,  color:'amber'  });
          else                 setNfsBadge({ text:`${nfsServers.length}`, color:'green' });
        }
      } catch {}
    } catch {}
  }, []);

  useEffect(() => {
    loadDests();
    const t = setInterval(loadDests, 60000);
    return () => clearInterval(t);
  }, [loadDests]);

  // Whether sidebar should show labels (wide mode) or icons only
  const showLabels = isMobile ? mobileOpen : !collapsed;
  const sidebarWidth = showLabels ? 198 : 52;

  function navItem(to, icon, label, badge) {
    return (
      <NavLink key={to} to={to}
        onClick={() => isMobile && setMobileOpen(false)}
        style={({ isActive }) => ({
          display:'flex', alignItems:'center', gap: showLabels ? 9 : 0,
          justifyContent: showLabels ? 'flex-start' : 'center',
          padding: showLabels ? '7px 12px' : '10px 0',
          margin: showLabels ? '1px 6px' : '1px 4px',
          borderRadius: 8, fontSize:12.5, textDecoration:'none',
          transition:'all .15s', userSelect:'none',
          color: isActive ? 'var(--bv-blue)' : 'var(--bv-txt2)',
          background: isActive ? 'var(--bv-blue-dim)' : 'transparent',
          position:'relative',
        })}
        title={!showLabels ? label : ''}>
        {({ isActive }) => (
          <>
            <i className={`ti ti-${icon}`} style={{
              fontSize:16, width:16, flexShrink:0, textAlign:'center',
              color: isActive ? 'var(--bv-blue)' : 'var(--bv-txt3)',
            }}/>
            {showLabels && <span style={{ flex:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{label}</span>}
            {badge && showLabels && (
              <span style={{
                fontSize:10, padding:'1px 6px', borderRadius:10, fontWeight:600,
                background: badge.color==='red'?'var(--bv-red-bg)':badge.color==='amber'?'var(--bv-amber-bg)':'var(--bv-green-bg)',
                color: badge.color==='red'?'var(--bv-red)':badge.color==='amber'?'var(--bv-amber)':'var(--bv-green)',
              }}>{badge.text}</span>
            )}
            {badge && !showLabels && (
              <span style={{
                position:'absolute', top:4, right:4, width:7, height:7, borderRadius:'50%',
                background: badge.color==='red'?'var(--bv-red)':badge.color==='amber'?'var(--bv-amber)':'var(--bv-green)',
              }}/>
            )}
          </>
        )}
      </NavLink>
    );
  }

  function sectionLabel(text) {
    if (!showLabels) return (
      <div style={{ height:1, background:'var(--bv-bd)', margin:'6px 8px' }}/>
    );
    return (
      <div style={{
        padding:'10px 14px 3px', fontSize:10, color:'var(--bv-txt3)',
        letterSpacing:'.1em', textTransform:'uppercase', fontWeight:600,
      }}>{text}</div>
    );
  }

  const primaryBadge = destInfo.primaryPct != null ? {
    text: `${destInfo.primaryPct}%`,
    color: destInfo.primaryPct>=90?'red':destInfo.primaryPct>=80?'amber':'green',
  } : null;

  const SidebarContent = () => (
    <>
      {/* Logo / toggle */}
      <div style={{
        padding: showLabels ? '14px 14px 12px' : '14px 0',
        borderBottom:'1px solid var(--bv-bd)',
        display:'flex', alignItems:'center',
        justifyContent: showLabels ? 'space-between' : 'center',
        flexShrink:0,
      }}>
        {showLabels ? (
          <div style={{ display:'flex', alignItems:'center', gap:9 }}>
            <div style={{
              width:32, height:32,
              background:'linear-gradient(135deg,var(--bv-accent),var(--bv-accent-dark))',
              borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center',
              fontWeight:700, fontSize:13, color:'#fff', flexShrink:0,
            }}>BV</div>
            <div>
              <div style={{ fontSize:13, fontWeight:500, color:'var(--bv-txt)', lineHeight:1.3 }}>BackupVault</div>
              <div style={{ fontSize:10, color:'var(--bv-cyan)', fontWeight:500 }}>Infrastructure</div>
            </div>
          </div>
        ) : (
          <div style={{
            width:32, height:32,
            background:'linear-gradient(135deg,var(--bv-accent),var(--bv-accent-dark))',
            borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center',
            fontWeight:700, fontSize:12, color:'#fff',
          }}>BV</div>
        )}
        {!isMobile && (
          <button
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{
              background:'none', border:'none', color:'var(--bv-txt3)',
              cursor:'pointer', padding:'4px', borderRadius:6,
              display:'flex', alignItems:'center',
            }}>
            <i className={`ti ti-chevron-${collapsed?'right':'left'}`} style={{ fontSize:15 }}/>
          </button>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex:1, overflowY:'auto', overflowX:'hidden', padding:'4px 0' }}>
        {sectionLabel('Overview')}
        {navItem('/dashboard',  'layout-dashboard', 'Dashboard')}
        {navItem('/targets',    'database',         'DB Servers',   { text:'5', color:'green' })}
        {navItem('/nfs-servers', 'server-bolt',      'NFS Servers',  nfsBadge)}
        {navItem('/monitoring',  'activity',         'Monitoring')}
        {navItem('/jobs',       'list-check',       'Backup Jobs')}
        {navItem('/history',    'history',          'Run History')}
        {navItem('/live-logs',  'terminal-2',       'Live Logs')}
        {navItem('/restore',    'database-import',  'Restore DB')}
        {navItem('/activity',   'activity',         'Activity')}

        {sectionLabel('Storage Tiers')}
        {navItem('/primary-dc', 'device-floppy',   'Primary DB',    primaryBadge)}
        {navItem('/secondary',  'server-2',        'Secondary DB')}
        {navItem('/remote',     'building',        'Remote Onsite', destInfo.remote ? { text:'ON', color:'green' } : null)}
        {navItem('/aws-s3',     'brand-aws',       'AWS S3',        destInfo.s3  ? { text:'ON', color:'green' } : null)}
        {navItem('/oci-storage', 'cloud',           'OCI Storage',   destInfo.oci ? { text:'ON', color:'cyan'  } : null)}

        {sectionLabel('System')}
        {navItem('/destinations','server-2',       'Destinations')}
        {navItem('/cloud-regions','map',           'Cloud Regions')}
        {navItem('/users',       'users',          'Users')}
        {navItem('/strategy',    'sitemap',        'Backup Strategy')}
        {navItem('/settings',    'settings',       'Settings')}
      </nav>

      {/* Footer */}
      <div style={{ borderTop:'1px solid var(--bv-bd)', padding:'8px 4px 4px', flexShrink:0 }}>
        <button
          onClick={() => { logout(); navigate('/login'); }}
          style={{
            display:'flex', alignItems:'center', gap: showLabels ? 9 : 0,
            justifyContent: showLabels ? 'flex-start' : 'center',
            padding: showLabels ? '7px 12px' : '9px 0',
            margin: showLabels ? '1px 6px' : '1px 4px',
            borderRadius:8, background:'none', border:'none',
            color:'var(--bv-red)', fontSize:12, width: showLabels ? 'calc(100% - 12px)' : '100%',
            cursor:'pointer',
          }}
          title={!showLabels ? 'Exit Vault' : ''}
          onMouseEnter={e => e.currentTarget.style.background='var(--bv-red-bg)'}
          onMouseLeave={e => e.currentTarget.style.background='none'}>
          <i className="ti ti-logout" style={{ fontSize:15, width:16, textAlign:'center', flexShrink:0 }}/>
          {showLabels && 'Exit Vault'}
        </button>

        {showLabels && (
          <div style={{ padding:'5px 14px 6px', fontSize:10, display:'flex', alignItems:'center', gap:6 }}>
            <Dot color={wsConnected?'green':'red'} pulse={wsConnected}/>
            <span style={{ color: wsConnected?'var(--bv-green)':'var(--bv-red)', fontSize:10, whiteSpace:'nowrap' }}>
              {wsConnected ? 'Live Connected' : 'Reconnecting…'}
            </span>
          </div>
        )}
        {!showLabels && (
          <div style={{ display:'flex', justifyContent:'center', padding:'4px 0 6px' }}>
            <Dot color={wsConnected?'green':'red'} pulse={wsConnected}/>
          </div>
        )}
        {showLabels && user && (
          <div style={{ padding:'0 14px 8px', fontSize:10, color:'var(--bv-txt3)',
            whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            {user.name} · {user.role_label||user.role} · v1.0.0
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      {/* Mobile hamburger button (shown only on mobile, outside sidebar) */}
      {isMobile && (
        <button
          onClick={() => setMobileOpen(o => !o)}
          style={{
            position:'fixed', top:10, left:10, zIndex:3000,
            width:38, height:38, borderRadius:8,
            background:'var(--bv-bg2)', border:'1px solid var(--bv-bd)',
            color:'var(--bv-txt)', cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center', fontSize:18,
            boxShadow:'0 2px 8px var(--bv-shadow)',
          }}
          title="Toggle menu">
          <i className={`ti ti-${mobileOpen ? 'x' : 'menu-2'}`}/>
        </button>
      )}

      {/* Mobile overlay backdrop */}
      {isMobile && mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{
            position:'fixed', inset:0, zIndex:2000,
            background:'rgba(0,0,0,0.55)', backdropFilter:'blur(2px)',
          }}
        />
      )}

      {/* Sidebar */}
      <div style={{
        width: isMobile ? (mobileOpen ? 198 : 0) : sidebarWidth,
        flexShrink:0,
        position: isMobile ? 'fixed' : 'relative',
        left: isMobile ? (mobileOpen ? 0 : -200) : 'auto',
        top: isMobile ? 0 : 'auto',
        height: isMobile ? '100vh' : '100%',
        zIndex: isMobile ? 2100 : 'auto',
        background:'var(--bv-sidebar)',
        borderRight:'1px solid var(--bv-bd)',
        display:'flex', flexDirection:'column',
        overflow:'hidden',
        transition:'width .2s ease, left .2s ease',
        boxShadow: isMobile && mobileOpen ? '4px 0 24px var(--bv-shadow)' : 'none',
      }}>
        <SidebarContent/>
      </div>
    </>
  );
}
