// frontend/src/pages/Auth.js
// No useAuth dependency in TOTP — updates window.location directly after session set

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// ── SHARED UI ─────────────────────────────────────────────────────────────────
function AuthBox({ children }) {
  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center',
      justifyContent:'center', background:'var(--bv-bg)', padding:16 }}>
      <div style={{ width:'100%', maxWidth:420, background:'var(--bv-bg2)',
        border:'1px solid var(--bv-bd)', borderRadius:14,
        boxShadow:'0 8px 40px rgba(0,0,0,0.3)' }}>
        <div style={{ padding:'22px 28px 18px', textAlign:'center',
          borderBottom:'1px solid var(--bv-bd)' }}>
          <div style={{ width:50, height:50,
            background:'linear-gradient(135deg,#1864ab,#0d4a80)',
            borderRadius:12, display:'flex', alignItems:'center',
            justifyContent:'center', margin:'0 auto 12px',
            fontSize:18, fontWeight:700, color:'#fff' }}>BV</div>
          <div style={{ fontSize:19, fontWeight:600, color:'var(--bv-txt)' }}>BackupVault</div>
          <div style={{ fontSize:12, color:'var(--bv-cyan)', marginTop:4 }}>
            Infrastructure · Worktual Innovations
          </div>
        </div>
        <div style={{ padding:'22px 28px 28px' }}>{children}</div>
      </div>
    </div>
  );
}

const iStyle = {
  display:'block', width:'100%', padding:'10px 12px',
  background:'var(--bv-input)', border:'1px solid var(--bv-bd2)',
  color:'var(--bv-txt)', borderRadius:8, fontSize:13,
  outline:'none', boxSizing:'border-box', fontFamily:'inherit',
  marginBottom:14,
};

function Err({ m }) {
  if (!m) return null;
  return (
    <div style={{ padding:'8px 12px', background:'var(--bv-red-bg)',
      border:'1px solid var(--bv-red)', borderRadius:7, fontSize:12,
      color:'var(--bv-red)', marginBottom:14,
      display:'flex', alignItems:'center', gap:8 }}>
      <i className="ti ti-alert-circle" style={{ fontSize:14 }}/>{m}
    </div>
  );
}

function Ok({ m }) {
  if (!m) return null;
  return (
    <div style={{ padding:'8px 12px', background:'var(--bv-green-bg)',
      border:'1px solid var(--bv-green)', borderRadius:7, fontSize:12,
      color:'var(--bv-green)', marginBottom:14,
      display:'flex', alignItems:'center', gap:8 }}>
      <i className="ti ti-circle-check" style={{ fontSize:14 }}/>{m}
    </div>
  );
}

function Btn({ loading, disabled, children, onClick, type = 'submit' }) {
  const dis = loading || disabled;
  return (
    <button type={type} onClick={onClick} disabled={dis}
      style={{ width:'100%', padding:'10px 0', border:'none', borderRadius:9,
        background: dis ? 'var(--bv-bd2)' : 'var(--bv-accent)',
        color:'#fff', fontSize:13.5, fontWeight:600,
        cursor: dis ? 'not-allowed' : 'pointer',
        display:'flex', alignItems:'center', justifyContent:'center',
        gap:8, marginBottom:12, transition:'background .15s' }}>
      {loading
        ? <><i className="ti ti-loader"
            style={{ animation:'bvspin .7s linear infinite', fontSize:15 }}/> Please wait...</>
        : children}
    </button>
  );
}

function Lbl({ children }) {
  return (
    <div style={{ fontSize:11.5, fontWeight:600, color:'var(--bv-txt2)',
      marginBottom:5, letterSpacing:'.02em' }}>{children}</div>
  );
}

// ── SESSION HELPER ────────────────────────────────────────────────────────────
// Writes session to localStorage then does a HARD redirect so AuthContext
// re-initialises from scratch — this avoids any stale React state issues
function applySessionAndRedirect(data) {
  if (!data || !data.token) throw new Error('Invalid server response — no token received');
  localStorage.setItem('bv_token', data.token);
  localStorage.setItem('bv_user',  JSON.stringify(data.user || {}));
  if (data.preferences && data.preferences.theme) {
    localStorage.setItem('bv_theme', data.preferences.theme);
  }
  // Hard redirect — forces AuthContext to re-read localStorage from scratch
  // This is the most reliable way across all React Router / Context setups
  window.location.href = '/dashboard';
}

// ── POST JSON HELPER ─────────────────────────────────────────────────────────
async function postJSON(url, body) {
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  let data;
  try { data = await res.json(); }
  catch { throw new Error('Server returned invalid response'); }
  if (!res.ok) throw new Error(data.error || data.message || `Server error ${res.status}`);
  return data;
}

// ── LOGIN PAGE ────────────────────────────────────────────────────────────────
export function LoginPage() {
  const navigate = useNavigate();

  const [view,    setView]   = useState('login'); // login | totp | forgot | otp
  const [email,   setEmail]  = useState('');
  const [pass,    setPass]   = useState('');
  const [code,    setCode]   = useState('');
  const [forgot,  setForgot] = useState('');
  const [otp,     setOtp]    = useState({ code:'', pass:'', confirm:'' });
  const [busy,    setBusy]   = useState(false);
  const [err,     setErr]    = useState('');
  const [ok,      setOk]     = useState('');
  const [showPw,  setShowPw] = useState(false);

  function go(v) { setView(v); setErr(''); setOk(''); setCode(''); }

  // ── Step 1: email + password ───────────────────────────────────────────
  async function handleLogin(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const data = await postJSON('/api/auth/login', {
        email: email.trim(), password: pass,
      });
      if (data.requires_2fa) {
        // Don't navigate — just switch view within same component
        go('totp');
        return;
      }
      // Direct login (no 2FA) — apply and redirect
      applySessionAndRedirect(data);
    } catch(e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  // ── Step 2: TOTP code ─────────────────────────────────────────────────
  async function handleTotp(e) {
    e.preventDefault();
    const clean = code.replace(/[\s\-]/g, '');
    if (clean.length < 6) { setErr('Enter the full 6-digit code'); return; }
    setErr(''); setBusy(true);
    try {
      const data = await postJSON('/api/auth/login', {
        email:     email.trim(),
        password:  pass,
        totp_code: clean,
      });
      // Apply session and hard-redirect — no loginWithToken needed
      applySessionAndRedirect(data);
    } catch(e) {
      setErr(e.message);
      setCode('');
    } finally { setBusy(false); }
  }

  // ── Forgot password ───────────────────────────────────────────────────
  async function handleForgot(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      await postJSON('/api/auth/forgot-password', { email: forgot.trim() });
      setOk('OTP sent to your email.'); setView('otp');
    } catch(e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  // ── Reset password ────────────────────────────────────────────────────
  async function handleReset(e) {
    e.preventDefault();
    if (otp.pass !== otp.confirm) { setErr('Passwords do not match'); return; }
    if (otp.pass.length < 8)      { setErr('Minimum 8 characters'); return; }
    setErr(''); setBusy(true);
    try {
      await postJSON('/api/auth/reset-password-with-otp', {
        email: forgot, otp: otp.code, newPassword: otp.pass,
      });
      setOk('Password reset. Please sign in.'); go('login');
    } catch(e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  // ── TOTP SCREEN ───────────────────────────────────────────────────────
  if (view === 'totp') return (
    <AuthBox>
      <div style={{ textAlign:'center', marginBottom:22 }}>
        <div style={{ fontSize:44, marginBottom:12 }}>🔐</div>
        <div style={{ fontSize:16, fontWeight:600, color:'var(--bv-txt)', marginBottom:8 }}>
          Two-Factor Authentication
        </div>
        <div style={{ fontSize:12, color:'var(--bv-txt2)', lineHeight:1.7 }}>
          Open <strong>Google Authenticator</strong><br/>
          Enter the 6-digit code for<br/>
          <span style={{ color:'var(--bv-cyan)', fontWeight:600 }}>{email}</span>
        </div>
      </div>
      <form onSubmit={handleTotp}>
        <Lbl>6-digit code</Lbl>
        <input
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g,'').slice(0,6))}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          maxLength={6}
          autoFocus
          style={{ ...iStyle, textAlign:'center', fontSize:32,
            letterSpacing:14, fontFamily:'monospace', fontWeight:700,
            padding:'12px 0' }}
        />
        <Err m={err}/>
        <Btn loading={busy} disabled={code.length < 6}>
          <i className="ti ti-shield-check" style={{ fontSize:16 }}/> Verify & Sign In
        </Btn>
        <div style={{ padding:'9px 13px', background:'var(--bv-amber-bg)',
          border:'1px solid var(--bv-amber)', borderRadius:8,
          fontSize:11.5, color:'var(--bv-txt)', marginBottom:12, lineHeight:1.7 }}>
          <div style={{ fontWeight:600, color:'var(--bv-amber)', marginBottom:4 }}>
            <i className="ti ti-key" style={{ marginRight:5 }}/>No phone? Use a backup code
          </div>
          <div style={{ color:'var(--bv-txt2)' }}>
            1. Find your saved backup codes (given when you set up 2FA)<br/>
            2. Type one code above — format:
            <code style={{ color:'var(--bv-cyan)', fontFamily:'monospace',
              marginLeft:5 }}>XXXX-XXXX</code><br/>
            3. Each backup code works <strong>only once</strong>
          </div>
        </div>
        <button type="button" onClick={() => go('login')}
          style={{ background:'none', border:'none', color:'var(--bv-blue)',
            fontSize:12, width:'100%', textAlign:'center',
            cursor:'pointer', padding:'4px 0' }}>
          <i className="ti ti-arrow-left" style={{ marginRight:5 }}/>Back to sign in
        </button>
      </form>
    </AuthBox>
  );

  // ── FORGOT SCREEN ─────────────────────────────────────────────────────
  if (view === 'forgot') return (
    <AuthBox>
      <div style={{ marginBottom:18 }}>
        <div style={{ fontSize:16, fontWeight:600, color:'var(--bv-txt)', marginBottom:4 }}>
          Forgot password
        </div>
        <div style={{ fontSize:12, color:'var(--bv-txt2)' }}>
          We'll send a one-time reset code to your email
        </div>
      </div>
      <form onSubmit={handleForgot}>
        <Lbl>Email address</Lbl>
        <input type="email" value={forgot}
          onChange={e => setForgot(e.target.value)}
          placeholder="you@worktual.tech"
          style={iStyle} required autoFocus/>
        <Err m={err}/><Ok m={ok}/>
        <Btn loading={busy}>Send Reset Code</Btn>
        <button type="button" onClick={() => go('login')}
          style={{ background:'none', border:'none', color:'var(--bv-blue)',
            fontSize:12, width:'100%', textAlign:'center', cursor:'pointer' }}>
          <i className="ti ti-arrow-left" style={{ marginRight:5 }}/>Back to sign in
        </button>
      </form>
    </AuthBox>
  );

  // ── OTP RESET SCREEN ──────────────────────────────────────────────────
  if (view === 'otp') return (
    <AuthBox>
      <div style={{ marginBottom:18 }}>
        <div style={{ fontSize:16, fontWeight:600, color:'var(--bv-txt)', marginBottom:4 }}>
          Reset your password
        </div>
        <div style={{ fontSize:12, color:'var(--bv-txt2)' }}>
          Code sent to <strong style={{ color:'var(--bv-cyan)' }}>{forgot}</strong>
        </div>
      </div>
      <form onSubmit={handleReset}>
        <Lbl>Reset code (from email)</Lbl>
        <input value={otp.code} maxLength={6} autoFocus required
          onChange={e => setOtp(p => ({...p, code:e.target.value}))}
          placeholder="123456"
          style={{ ...iStyle, textAlign:'center', fontFamily:'monospace',
            fontSize:20, letterSpacing:6 }}/>
        <Lbl>New password</Lbl>
        <input type="password" value={otp.pass} required minLength={8}
          onChange={e => setOtp(p => ({...p, pass:e.target.value}))}
          placeholder="At least 8 characters" style={iStyle}/>
        <Lbl>Confirm password</Lbl>
        <input type="password" value={otp.confirm} required
          onChange={e => setOtp(p => ({...p, confirm:e.target.value}))}
          placeholder="Repeat password" style={iStyle}/>
        <Err m={err}/><Ok m={ok}/>
        <Btn loading={busy}>Reset Password</Btn>
        <button type="button" onClick={() => go('login')}
          style={{ background:'none', border:'none', color:'var(--bv-blue)',
            fontSize:12, width:'100%', textAlign:'center', cursor:'pointer' }}>
          <i className="ti ti-arrow-left" style={{ marginRight:5 }}/>Back to sign in
        </button>
      </form>
    </AuthBox>
  );

  // ── MAIN LOGIN SCREEN ─────────────────────────────────────────────────
  return (
    <AuthBox>
      <div style={{ fontSize:15.5, fontWeight:600,
        color:'var(--bv-txt)', marginBottom:20 }}>
        Sign in to your account
      </div>
      <form onSubmit={handleLogin}>
        <Lbl>Email address</Lbl>
        <input type="email" value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="admin@worktual.tech"
          style={iStyle} required autoFocus/>

        <Lbl>Password</Lbl>
        <div style={{ position:'relative', marginBottom:14 }}>
          <input type={showPw ? 'text' : 'password'}
            value={pass}
            onChange={e => setPass(e.target.value)}
            style={{ ...iStyle, marginBottom:0, paddingRight:42 }}
            required/>
          <button type="button" onClick={() => setShowPw(v => !v)}
            style={{ position:'absolute', right:10, top:'50%',
              transform:'translateY(-50%)', background:'none',
              border:'none', color:'var(--bv-txt3)',
              cursor:'pointer', padding:0, lineHeight:1 }}>
            <i className={`ti ti-${showPw ? 'eye-off' : 'eye'}`}
              style={{ fontSize:17 }}/>
          </button>
        </div>

        <Err m={err}/>
        <Btn loading={busy}>
          <i className="ti ti-login" style={{ fontSize:16 }}/> Sign In
        </Btn>
      </form>

      <button type="button" onClick={() => go('forgot')}
        style={{ background:'none', border:'none', color:'var(--bv-blue)',
          fontSize:12, cursor:'pointer', padding:'0 0 14px', display:'block' }}>
        Forgot password?
      </button>

      <div style={{ padding:'9px 12px', background:'var(--bv-bg3)',
        borderRadius:8, fontSize:11, color:'var(--bv-txt3)', lineHeight:1.7 }}>
        <i className="ti ti-shield-lock"
          style={{ marginRight:6, color:'var(--bv-blue)' }}/>
        If 2FA is enabled, you'll be prompted for your Google Authenticator
        code after your password.
      </div>

      <div style={{ marginTop:16, paddingTop:14,
        borderTop:'1px solid var(--bv-bd)',
        fontSize:11, color:'var(--bv-txt3)', textAlign:'center' }}>
        <i className="ti ti-lock" style={{ marginRight:5 }}/>
        Invite-only. Contact your administrator for access.
      </div>
    </AuthBox>
  );
}

export function RegisterPage() {
  const navigate = useNavigate();
  useEffect(() => { navigate('/login', { replace:true }); }, [navigate]);
  return null;
}
