// backend/src/routes/auth.js
// Roles: super_admin > admin > executor > viewer
// 2FA: Google Authenticator TOTP via speakeasy

const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const jwt      = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const db       = require('../db/connection');

let speakeasy, qrcode;
try { speakeasy = require('speakeasy'); } catch { speakeasy = null; }
try { qrcode    = require('qrcode');   } catch { qrcode    = null; }

const JWT_SECRET = process.env.JWT_SECRET || 'super_secure_backupvault_token_key';

// ── ROLE DEFINITIONS ──────────────────────────────────────────────────────────
const ROLES = {
  super_admin: { label:'Super Admin', level:4, color:'#bc8cff' },
  admin:       { label:'Admin',       level:3, color:'#58a6ff' },
  executor:    { label:'Executor',    level:2, color:'#e3b341' },
  viewer:      { label:'Viewer',      level:1, color:'#8b949e' },
};

// Role permission matrix
const CAN = {
  manageUsers:    ['super_admin'],
  manageSettings: ['super_admin','admin'],
  manageTargets:  ['super_admin','admin'],
  manageJobs:     ['super_admin','admin'],
  manageDestinations: ['super_admin','admin'],
  runBackups:     ['super_admin','admin','executor'],
  viewAll:        ['super_admin','admin','executor','viewer'],
};

function hasRole(userRole, permission) {
  return (CAN[permission] || []).includes(userRole);
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  try {
    const [salt, orig] = stored.split(':');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return hash === orig;
  } catch { return false; }
}

// ── JWT AUTH MIDDLEWARE ───────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Token expired or invalid' }); }
}

// Role guard middleware factory
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role))
      return res.status(403).json({
        error: `Access denied. Required role: ${roles.join(' or ')}. Your role: ${req.user.role}`
      });
    next();
  };
}

// Audit log helper
async function audit(userId, email, eventType, detail, req) {
  try {
    await db.pool.execute(
      'INSERT INTO security_audit (user_id,user_email,event_type,event_detail,ip_address,user_agent) VALUES (?,?,?,?,?,?)',
      [userId||null, email||null, eventType, detail||null,
       req?.ip||req?.connection?.remoteAddress||null,
       req?.headers?.['user-agent']?.substring(0,250)||null]
    );
  } catch {}
}

// Mailer
function getMailer() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mail.worktual.tech',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await db.queryOne('SELECT * FROM users WHERE email=?', [email]);
    if (!user || !user.is_active)
      return res.status(401).json({ error: 'Invalid email or password' });

    if (!verifyPassword(password, user.password_hash))
      return res.status(401).json({ error: 'Invalid email or password' });

    // If 2FA is enabled and verified, require TOTP code
    if (user.totp_enabled && user.totp_verified) {
      const { totp_code } = req.body;
      if (!totp_code) {
        return res.status(200).json({ requires_2fa: true, email });
      }
      // Verify TOTP or backup code
      const valid2fa = speakeasy && speakeasy.totp.verify({
        secret:   user.totp_secret,
        encoding: 'base32',
        token:    totp_code,
        window:   1,
      });
      // Check backup codes
      let usedBackup = false;
      if (!valid2fa && user.totp_backup_codes) {
        try {
          const codes = JSON.parse(user.totp_backup_codes);
          const idx   = codes.indexOf(totp_code.replace(/\s/g,'').toUpperCase());
          if (idx >= 0) {
            codes.splice(idx, 1); // one-time use
            await db.query('UPDATE users SET totp_backup_codes=? WHERE id=?', [JSON.stringify(codes), user.id]);
            usedBackup = true;
          }
        } catch {}
      }
      if (!valid2fa && !usedBackup) {
        await audit(user.id, email, 'login_2fa_fail', 'Invalid TOTP code', req);
        return res.status(401).json({ error: 'Invalid authenticator code', requires_2fa: true, email });
      }
      if (usedBackup) await audit(user.id, email, 'login_backup_code', 'Backup code used', req);
    }

    // Update last login
    await db.query('UPDATE users SET last_login_at=NOW(), last_login_ip=? WHERE id=?',
      [req.ip||'', user.id]);
    await audit(user.id, email, 'login_success', null, req);

    const token = jwt.sign(
      { id:user.id, name:user.name, email:user.email, role:user.role },
      JWT_SECRET, { expiresIn:'24h' }
    );

    // Load preferences
    const prefRows = await db.query('SELECT pref_key, pref_value FROM user_preferences WHERE user_id=?', [user.id]);
    const prefs = { theme: user.theme || 'dark' };
    prefRows.forEach(r => { prefs[r.pref_key] = r.pref_value; });

    res.json({
      success: true, token,
      user: { id:user.id, name:user.name, email:user.email, role:user.role,
        totp_enabled: !!user.totp_enabled,
        role_label: ROLES[user.role]?.label || user.role },
      preferences: prefs,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── FORGOT / RESET PASSWORD ───────────────────────────────────────────────────
router.post('/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const user = await db.queryOne('SELECT id,name FROM users WHERE email=? AND is_active=1', [email]);
    if (!user) return res.json({ success:true, message:'If account exists, OTP dispatched.' });
    const otp = crypto.randomInt(100000, 999999).toString();
    await db.pool.execute('UPDATE users SET otp_code=?,otp_expires_at=DATE_ADD(NOW(),INTERVAL 15 MINUTE) WHERE id=?', [otp, user.id]);
    try {
      await getMailer().sendMail({
        from:`"BackupVault" <${process.env.SMTP_USER}>`, to:email,
        subject:'[BackupVault] Password Reset OTP',
        html:`<p>Your BackupVault OTP: <strong style="font-size:28px;letter-spacing:6px;font-family:monospace">${otp}</strong></p><p>Valid for 15 minutes. Do not share this code.</p>`,
      });
    } catch(mailErr) { console.warn('[Auth] Email send failed:', mailErr.message); }
    res.json({ success:true, message:'If account exists, OTP dispatched.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/auth/reset-password-with-otp', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email||!otp||!newPassword) return res.status(400).json({ error:'All fields required' });
    if (newPassword.length < 8) return res.status(400).json({ error:'Password must be at least 8 characters' });
    const user = await db.queryOne('SELECT id,otp_code FROM users WHERE email=? AND otp_expires_at>=NOW() AND is_active=1', [email]);
    if (!user||user.otp_code!==otp) return res.status(400).json({ error:'Invalid or expired OTP' });
    await db.pool.execute('UPDATE users SET password_hash=?,otp_code=NULL,otp_expires_at=NULL,password_changed_at=NOW() WHERE id=?',
      [hashPassword(newPassword), user.id]);
    await audit(user.id, email, 'password_reset', 'Via OTP', req);
    res.json({ success:true, message:'Password updated. Please log in.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── USER MANAGEMENT (super_admin + admin only) ────────────────────────────────

// GET /api/users
router.get('/users', auth, async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT id,name,email,role,is_active,totp_enabled,totp_verified,
        last_login_at,last_login_ip,created_at,invited_by
       FROM users ORDER BY role DESC, name ASC`
    );
    res.json(rows.map(u => ({ ...u, role_label: ROLES[u.role]?.label||u.role, role_color: ROLES[u.role]?.color||'#8b949e' })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/users — create user (super_admin or admin)
router.post('/users', auth, requireRole('super_admin','admin'), async (req, res) => {
  try {
    const { name, email, password, role='viewer' } = req.body;
    if (!name||!email||!password) return res.status(400).json({ error:'name, email, password required' });
    if (password.length < 8) return res.status(400).json({ error:'Password must be at least 8 characters' });
    // admin cannot create super_admin
    if (req.user.role === 'admin' && role === 'super_admin')
      return res.status(403).json({ error:'Admin cannot create super_admin users' });
    if (!ROLES[role]) return res.status(400).json({ error:`Invalid role. Valid: ${Object.keys(ROLES).join(', ')}` });

    const existing = await db.queryOne('SELECT id FROM users WHERE email=?', [email]);
    if (existing) return res.status(409).json({ error:'Email already registered' });

    const [r] = await db.pool.execute(
      'INSERT INTO users (name,email,password_hash,role,is_active,invited_by,invited_at) VALUES (?,?,?,?,1,?,NOW())',
      [name, email, hashPassword(password), role, req.user.id]
    );
    await audit(req.user.id, req.user.email, 'user_created', `Created ${email} as ${role}`, req);

    // Seed default preferences
    await db.pool.execute('INSERT IGNORE INTO user_preferences (user_id,pref_key,pref_value) VALUES (?,?,?)', [r.insertId,'theme','dark']);

    res.status(201).json({ success:true, id:r.insertId, message:`User "${name}" created as ${ROLES[role].label}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/users/:id — update role / active status (super_admin or admin)
router.put('/users/:id', auth, requireRole('super_admin','admin'), async (req, res) => {
  try {
    const { role, is_active, name } = req.body;
    const target = await db.queryOne('SELECT * FROM users WHERE id=?', [req.params.id]);
    if (!target) return res.status(404).json({ error:'User not found' });

    // Cannot demote/deactivate yourself
    if (String(target.id) === String(req.user.id) && is_active === 0)
      return res.status(400).json({ error:'Cannot deactivate your own account' });

    // admin cannot modify super_admin
    if (req.user.role === 'admin' && target.role === 'super_admin')
      return res.status(403).json({ error:'Admin cannot modify super_admin users' });

    // admin cannot promote to super_admin
    if (req.user.role === 'admin' && role === 'super_admin')
      return res.status(403).json({ error:'Admin cannot assign super_admin role' });

    const fields = []; const vals = [];
    if (name      !== undefined) { fields.push('name=?');      vals.push(name); }
    if (role      !== undefined && ROLES[role]) { fields.push('role=?'); vals.push(role); }
    if (is_active !== undefined) { fields.push('is_active=?'); vals.push(is_active?1:0); }
    if (!fields.length) return res.status(400).json({ error:'Nothing to update' });

    vals.push(req.params.id);
    await db.query(`UPDATE users SET ${fields.join(',')} WHERE id=?`, vals);
    await audit(req.user.id, req.user.email, 'user_updated', `Updated user ${target.email}: ${JSON.stringify(req.body)}`, req);
    res.json({ success:true, message:'User updated' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/users/:id/password — change user's password
router.put('/users/:id/password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword, adminReset } = req.body;
    const isSelf  = String(req.params.id) === String(req.user.id);
    const isAdmin = ['super_admin','admin'].includes(req.user.role);

    if (!isSelf && !isAdmin) return res.status(403).json({ error:'Cannot change another user\'s password' });
    if (newPassword?.length < 8) return res.status(400).json({ error:'Password must be at least 8 characters' });

    const user = await db.queryOne('SELECT * FROM users WHERE id=?', [req.params.id]);
    if (!user) return res.status(404).json({ error:'User not found' });

    // Self-change requires current password; admin reset does not
    if (isSelf && !adminReset) {
      if (!verifyPassword(currentPassword, user.password_hash))
        return res.status(401).json({ error:'Current password incorrect' });
    }

    await db.query('UPDATE users SET password_hash=?,password_changed_at=NOW() WHERE id=?',
      [hashPassword(newPassword), req.params.id]);
    await audit(req.user.id, req.user.email, 'password_changed', `For user ${user.email}`, req);
    res.json({ success:true, message:'Password updated' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/users/:id — deactivate (super_admin only)
router.delete('/users/:id', auth, requireRole('super_admin'), async (req, res) => {
  try {
    if (String(req.params.id) === String(req.user.id))
      return res.status(400).json({ error:'Cannot delete your own account' });
    const user = await db.queryOne('SELECT email FROM users WHERE id=?', [req.params.id]);
    await db.query('UPDATE users SET is_active=0 WHERE id=?', [req.params.id]);
    await audit(req.user.id, req.user.email, 'user_deactivated', `Deactivated ${user?.email}`, req);
    res.json({ success:true, message:'User deactivated' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GOOGLE AUTHENTICATOR 2FA ──────────────────────────────────────────────────

// POST /api/auth/2fa/setup — generate TOTP secret + QR code
router.post('/auth/2fa/setup', auth, async (req, res) => {
  try {
    if (!speakeasy || !qrcode)
      return res.status(503).json({ error:'2FA not available. Run: npm install speakeasy qrcode' });

    const user = await db.queryOne('SELECT id,email,name,totp_enabled,totp_secret FROM users WHERE id=?', [req.user.id]);
    if (!user) return res.status(404).json({ error:'User not found' });

    // Generate new secret
    const secret = speakeasy.generateSecret({
      name:   `BackupVault (${user.email})`,
      issuer: 'BackupVault',
      length: 32,
    });

    // Save secret (not yet verified/enabled)
    await db.query('UPDATE users SET totp_secret=?,totp_enabled=0,totp_verified=0 WHERE id=?',
      [secret.base32, user.id]);

    // Generate QR code as data URL
    const otpauthUrl = speakeasy.otpauthURL({
      secret:   secret.base32,
      label:    encodeURIComponent(`BackupVault:${user.email}`),
      issuer:   'BackupVault',
      encoding: 'base32',
    });
    const qrDataUrl = await qrcode.toDataURL(otpauthUrl);

    // Generate 10 backup codes
    const backupCodes = Array.from({ length:10 }, () =>
      crypto.randomBytes(4).toString('hex').toUpperCase().replace(/(.{4})/, '$1-')
    );
    await db.query('UPDATE users SET totp_backup_codes=? WHERE id=?',
      [JSON.stringify(backupCodes), user.id]);

    res.json({ secret:secret.base32, qr:qrDataUrl, backupCodes, otpauthUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/auth/2fa/verify — confirm first TOTP code to activate 2FA
router.post('/auth/2fa/verify', auth, async (req, res) => {
  try {
    if (!speakeasy) return res.status(503).json({ error:'speakeasy not installed' });
    const { code } = req.body;
    if (!code) return res.status(400).json({ error:'code required' });

    const user = await db.queryOne('SELECT totp_secret FROM users WHERE id=?', [req.user.id]);
    if (!user?.totp_secret) return res.status(400).json({ error:'2FA setup not started. Call /api/auth/2fa/setup first.' });

    const valid = speakeasy.totp.verify({
      secret:   user.totp_secret,
      encoding: 'base32',
      token:    code,
      window:   2,
    });
    if (!valid) return res.status(400).json({ error:'Invalid code. Make sure your phone clock is synced.' });

    await db.query('UPDATE users SET totp_enabled=1,totp_verified=1 WHERE id=?', [req.user.id]);
    await audit(req.user.id, req.user.email, '2fa_enabled', 'Google Authenticator enabled', req);
    res.json({ success:true, message:'Google Authenticator enabled successfully' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/auth/2fa/disable — disable 2FA (requires password confirm)
router.post('/auth/2fa/disable', auth, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error:'Password required to disable 2FA' });
    const user = await db.queryOne('SELECT password_hash FROM users WHERE id=?', [req.user.id]);
    if (!verifyPassword(password, user.password_hash))
      return res.status(401).json({ error:'Incorrect password' });
    await db.query('UPDATE users SET totp_enabled=0,totp_verified=0,totp_secret=NULL,totp_backup_codes=NULL WHERE id=?', [req.user.id]);
    await audit(req.user.id, req.user.email, '2fa_disabled', 'Google Authenticator disabled', req);
    res.json({ success:true, message:'2FA disabled' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/auth/2fa/status
router.get('/auth/2fa/status', auth, async (req, res) => {
  try {
    const user = await db.queryOne('SELECT totp_enabled,totp_verified,totp_backup_codes FROM users WHERE id=?', [req.user.id]);
    let backupCount = 0;
    try { backupCount = JSON.parse(user.totp_backup_codes||'[]').length; } catch {}
    res.json({ totp_enabled:!!user.totp_enabled, totp_verified:!!user.totp_verified, backup_codes_remaining:backupCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── USER PREFERENCES ──────────────────────────────────────────────────────────
router.get('/preferences', auth, async (req, res) => {
  try {
    const rows = await db.query('SELECT pref_key,pref_value FROM user_preferences WHERE user_id=?', [req.user.id]);
    const prefs = { theme:'dark', sidebar_collapsed:'false', dashboard_refresh:'30' };
    rows.forEach(r => { prefs[r.pref_key] = r.pref_value; });
    res.json(prefs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/preferences', auth, async (req, res) => {
  try {
    for (const [key, value] of Object.entries(req.body||{})) {
      await db.pool.execute(
        `INSERT INTO user_preferences (user_id,pref_key,pref_value) VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE pref_value=VALUES(pref_value),updated_at=NOW()`,
        [req.user.id, key, String(value)]
      );
    }
    if (req.body.theme) await db.query('UPDATE users SET theme=? WHERE id=?', [req.body.theme, req.user.id]);
    res.json({ success:true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/preferences/:key', auth, async (req, res) => {
  try {
    const row = await db.queryOne('SELECT pref_value FROM user_preferences WHERE user_id=? AND pref_key=?', [req.user.id, req.params.key]);
    res.json({ key:req.params.key, value:row?.pref_value??null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── EXPORT ────────────────────────────────────────────────────────────────────

// POST /api/auth/2fa/admin-reset/:userId — admin resets another user's 2FA
router.post('/auth/2fa/admin-reset/:userId', auth, requireRole('super_admin','admin'), async (req, res) => {
  try {
    const target = await db.queryOne('SELECT id,email,role FROM users WHERE id=?', [req.params.userId]);
    if (!target) return res.status(404).json({ error:'User not found' });
    // Admin cannot reset super_admin 2FA
    if (req.user.role === 'admin' && target.role === 'super_admin')
      return res.status(403).json({ error:'Admin cannot reset super_admin 2FA' });
    // Cannot reset your own via this route (use /disable)
    if (String(target.id) === String(req.user.id))
      return res.status(400).json({ error:'Use /api/auth/2fa/disable to disable your own 2FA' });

    await db.query(
      'UPDATE users SET totp_enabled=0,totp_verified=0,totp_secret=NULL,totp_backup_codes=NULL WHERE id=?',
      [target.id]
    );
    await audit(req.user.id, req.user.email, '2fa_admin_reset',
      `Admin reset 2FA for ${target.email}`, req);
    res.json({ success:true, message:`2FA cleared for ${target.email}. They can re-enroll on next login.` });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

module.exports = router;
module.exports.auth = auth;
module.exports.requireRole = requireRole;
module.exports.ROLES = ROLES;
module.exports.hasRole = hasRole;
