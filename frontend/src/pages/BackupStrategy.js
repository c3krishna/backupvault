// frontend/src/pages/BackupStrategy.js
// Compact card-based layout — no overflow, no clipping

export default function BackupStrategy() {

  const clr = {
    blue:   { bg:'var(--bv-blue-dim)',   bd:'var(--bv-blue)',   tx:'var(--bv-blue)'   },
    green:  { bg:'var(--bv-green-dim)',  bd:'var(--bv-green)',  tx:'var(--bv-green)'  },
    amber:  { bg:'var(--bv-amber-bg)',   bd:'var(--bv-amber)',  tx:'var(--bv-amber)'  },
    red:    { bg:'var(--bv-red-bg)',     bd:'var(--bv-red)',    tx:'var(--bv-red)'    },
    cyan:   { bg:'var(--bv-cyan-bg)',    bd:'var(--bv-cyan)',   tx:'var(--bv-cyan)'   },
    purple: { bg:'var(--bv-purple-bg)', bd:'var(--bv-purple)', tx:'var(--bv-purple)' },
  };

  const Card = ({ icon, title, lines = [], color = 'blue' }) => {
    const c = clr[color] || clr.blue;
    return (
      <div style={{ background: c.bg, border: `1.5px solid ${c.bd}`, borderRadius: 10, padding: '10px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: lines.length ? 6 : 0 }}>
          <i className={`ti ti-${icon}`} style={{ fontSize: 16, color: c.tx, flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: c.tx }}>{title}</span>
        </div>
        {lines.map((l, i) => (
          <div key={i} style={{ fontSize: 11, color: 'var(--bv-txt2)', paddingLeft: 24, lineHeight: 1.7,
            position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, color: c.tx }}>·</span>{l}
          </div>
        ))}
      </div>
    );
  };

  const Arrow = ({ label, color = 'var(--bv-bd2)' }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0 4px 18px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ width: 2, height: 20, background: color }} />
        <div style={{ width: 0, height: 0, borderLeft: '5px solid transparent',
          borderRight: '5px solid transparent', borderTop: `7px solid ${color}` }} />
      </div>
      {label && <span style={{ fontSize: 10.5, color: 'var(--bv-txt3)', fontStyle: 'italic' }}>{label}</span>}
    </div>
  );

  const Step = ({ n, title, bg, children }) => (
    <div style={{ border: '1px solid var(--bv-bd)', borderRadius: 12, marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 16px', background: bg || 'var(--bv-bg3)',
        borderRadius: '12px 12px 0 0', borderBottom: '1px solid var(--bv-bd)' }}>
        <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--bv-accent)',
          color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center',
          justifyContent: 'center', flexShrink: 0 }}>{n}</div>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--bv-txt)' }}>{title}</span>
      </div>
      <div style={{ padding: 14, background: 'var(--bv-card)', borderRadius: '0 0 12px 12px',
        display: 'flex', flexDirection: 'column', gap: 8 }}>
        {children}
      </div>
    </div>
  );

  const SeqItem = ({ n, icon, title, detail, color = 'blue' }) => {
    const c = clr[color] || clr.blue;
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '8px 12px', background: c.bg, border: `1px solid ${c.bd}`, borderRadius: 8 }}>
        <div style={{ width: 22, height: 22, borderRadius: '50%', background: c.tx, color: '#fff',
          fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center',
          justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>{n}</div>
        <i className={`ti ti-${icon}`} style={{ fontSize: 15, color: c.tx, flexShrink: 0, marginTop: 3 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: c.tx }}>{title}</div>
          {detail && <div style={{ fontSize: 11, color: 'var(--bv-txt2)', marginTop: 2, lineHeight: 1.5 }}>{detail}</div>}
        </div>
      </div>
    );
  };

  const InfoBox = ({ children, color = 'blue' }) => {
    const c = clr[color] || clr.blue;
    return (
      <div style={{ padding: '9px 13px', background: c.bg, border: `1px solid ${c.bd}`,
        borderRadius: 8, fontSize: 11.5, color: 'var(--bv-txt)', lineHeight: 1.7 }}>
        {children}
      </div>
    );
  };

  const RuleRow = ({ n, text, tag, tagColor = 'blue' }) => {
    const c = clr[tagColor] || clr.blue;
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 0',
        borderBottom: '1px solid var(--bv-bd)' }}>
        <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--bv-blue-dim)',
          color: 'var(--bv-blue)', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center',
          justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>{n}</div>
        <div style={{ flex: 1, fontSize: 11.5, color: 'var(--bv-txt2)', lineHeight: 1.5 }}>{text}</div>
        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
          background: c.bg, color: c.tx, flexShrink: 0 }}>{tag}</span>
      </div>
    );
  };

  const TierCard = ({ icon, title, policy, detail, color }) => {
    const c = clr[color] || clr.blue;
    return (
      <div style={{ border: '1px solid var(--bv-bd)', borderRadius: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px',
          background: c.bg, borderBottom: `1px solid ${c.bd}` }}>
          <i className={`ti ti-${icon}`} style={{ fontSize: 16, color: c.tx }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: c.tx }}>{title}</span>
        </div>
        <div style={{ padding: '9px 12px', background: 'var(--bv-card)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--bv-txt)', marginBottom: 4 }}>{policy}</div>
          <div style={{ fontSize: 11, color: 'var(--bv-txt2)', lineHeight: 1.5 }}>{detail}</div>
        </div>
      </div>
    );
  };

  const DBServer = ({ name, type, addr }) => {
    const ico = { MySQL: 'M', PostgreSQL: 'P', Redis: 'R' };
    const bg  = { MySQL: '#1e3a1e', PostgreSQL: '#1a2550', Redis: '#3d1a10' };
    const col = { MySQL: '#4ec94e', PostgreSQL: '#7ca8f8', Redis: '#f85149' };
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 12px',
        background: 'var(--bv-blue-dim)', border: '1px solid var(--bv-blue)', borderRadius: 8 }}>
        <div style={{ width: 22, height: 22, borderRadius: 5, background: bg[type], color: col[type],
          fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center',
          justifyContent: 'center', flexShrink: 0 }}>{ico[type]}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--bv-blue)' }}>{name} ({type})</div>
          <div style={{ fontSize: 10, color: 'var(--bv-txt3)', fontFamily: 'monospace' }}>{addr}</div>
        </div>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--bv-green)' }} />
      </div>
    );
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div style={{ padding: '14px 22px 12px', borderBottom: '1px solid var(--bv-bd)',
        background: 'var(--bv-bg2)', flexShrink: 0 }}>
        <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--bv-txt)' }}>
          <i className="ti ti-sitemap" style={{ marginRight: 9, color: 'var(--bv-blue)' }} />
          Backup Strategy & Flow
        </div>
        <div style={{ fontSize: 12, color: 'var(--bv-txt2)', marginTop: 3 }}>
          End-to-end backup pipeline — from live DB servers to multi-tier disaster recovery
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '16px 22px' }}>

        {/* ── Pipeline overview (compact vertical list) ── */}
        <div style={{ border: '1px solid var(--bv-bd)', borderRadius: 12, marginBottom: 12 }}>
          <div style={{ padding: '9px 16px', background: 'var(--bv-bg3)',
            borderBottom: '1px solid var(--bv-bd)', fontSize: 11, fontWeight: 600,
            color: 'var(--bv-txt2)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
            Complete backup pipeline overview
          </div>
          <div style={{ padding: '12px 16px', background: 'var(--bv-card)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[
              { icon: 'database',      label: '5 Live DB Servers',               sub: 'MySQL · PostgreSQL · Redis',                 color: 'blue'   },
              null,
              { icon: 'device-floppy', label: 'Primary DB (NFS)',                 sub: '10.180.0.90 · /primary-db-backup · 482G',    color: 'green'  },
              null,
              { icon: 'server-2',      label: 'Secondary DB',                     sub: '10.180.0.130 · /secondary-db-backup · 2TB',  color: 'cyan'   },
              null,
              { icon: 'building',      label: 'Remote Onsite DR (192.168.12.243)', sub: '/backups/remote · 1TB pool',                 color: 'amber'  },
              null,
              { icon: 'brand-aws',     label: 'AWS S3 (ap-south-1 Mumbai)',        sub: 's3://worktual-db-backups · STANDARD_IA',     color: 'purple' },
              null,
              { icon: 'cloud',         label: 'OCI Object Storage (Mumbai)',       sub: 'AES-256-GCM Encrypted · Oracle Cloud',       color: 'red'    },
            ].map((item, i) => item ? (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
                background: clr[item.color].bg, border: `1.5px solid ${clr[item.color].bd}`, borderRadius: 9 }}>
                <i className={`ti ti-${item.icon}`} style={{ fontSize: 18, color: clr[item.color].tx, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: clr[item.color].tx }}>{item.label}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--bv-txt3)' }}>{item.sub}</div>
                </div>
              </div>
            ) : (
              <Arrow key={i}/>
            ))}
          </div>
        </div>

        {/* ── STEP 1 ── */}
        <Step n="1" title="Daily Scheduled Backup — 03:00 IST (Rule 1)" bg="var(--bv-blue-dim)">
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--bv-txt3)',
            textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 2 }}>Source — 5 live DB servers</div>
          <DBServer name="DB-Node-1" type="MySQL"      addr="10.180.0.201:3306" />
          <DBServer name="DB-Node-2" type="MySQL"      addr="10.180.0.202:3306" />
          <DBServer name="DB-Node-3" type="PostgreSQL" addr="10.180.0.203:5432" />
          <DBServer name="DB-Node-4" type="PostgreSQL" addr="10.180.0.204:5432" />
          <DBServer name="DB-Node-5" type="Redis"      addr="10.180.0.205:6379" />
          <Arrow label='mysqldump | gzip → .sql.gz' color="var(--bv-blue)" />
          <Card icon="terminal-2" title='bash -c "mysqldump ... | gzip > file.sql.gz"' color="blue"
            lines={[
              '--single-transaction · --routines · --triggers · --events',
              'gzip -t integrity check — rejects if output < 1 KB',
              'PostgreSQL: pg_dump -Fc   ·   Redis: BGSAVE + RDB copy',
            ]} />
          <Arrow label="stored in structured path" color="var(--bv-green)" />
          <Card icon="device-floppy" title="Primary DB — /primary-db-backup/<db>/Backup_DB/<YYYYMMDD>/" color="green"
            lines={[
              '482G NFS pool on 10.180.0.90',
              'Cron: 0 3 * * *  (every night at 03:00 IST)',
              'All 5 DB servers backed up each night',
            ]} />
          <InfoBox color="blue">
            <strong>Filename format:</strong>&nbsp;
            <code style={{ fontFamily: 'monospace', color: 'var(--bv-cyan)', fontSize: 11 }}>
              mysql_worktual_crm_full_2026-06-27_03-00-00.sql.gz
            </code>
          </InfoBox>
        </Step>

        {/* ── STEP 2 ── */}
        <Step n="2" title="Primary DB 80% Threshold — Rule 2 (Currently Active at 87%)" bg="var(--bv-amber-bg)">
          <Card icon="chart-bar" title="Disk monitor — checks every 30 minutes" color="amber"
            lines={[
              'Runs df on /primary-db-backup every 30 min',
              'Alert at 80% → email admins + dashboard badge',
              'New dumps are blocked at 90% until space is freed',
            ]} />
          <Arrow label="≥ 80% detected" color="var(--bv-amber)" />
          <Card icon="bell" title="Admin notification sent immediately" color="amber"
            lines={[
              'Email to all users in the users table',
              'Dashboard: Rule 2 badge turns Active on Primary DB tile',
            ]} />
          <Arrow label="admin manually runs copy sequence" color="var(--bv-txt3)" />

          <div style={{ background: 'var(--bv-bg3)', border: '1px solid var(--bv-bd)',
            borderRadius: 9, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--bv-txt2)',
              textTransform: 'uppercase', letterSpacing: '.07em' }}>
              Copy → Verify → Delete sequence
            </div>
            <SeqItem n="①" icon="search" color="amber" title="Find files older than 50 days"
              detail="Locate date folders in /primary-db-backup/<db>/Backup_DB/ older than 50 days" />
            <SeqItem n="②" icon="server-2" color="cyan" title="Copy to Secondary DB (10.180.0.130)"
              detail="rsync --checksum to /secondary-db-backup/ — preserves db/Backup_DB/YYYYMMDD/ structure" />
            <SeqItem n="③" icon="check" color="green" title="Verify copy integrity"
              detail="File size match + gzip -t + md5sum comparison on both sides" />
            <SeqItem n="④" icon="trash" color="red" title="Delete from Primary DB (only if ③ passed)"
              detail="rm -rf old date folder · logged with timestamp · Primary DB space freed" />
          </div>

          <InfoBox color="red">
            <i className="ti ti-shield-lock" style={{ marginRight: 6, color: 'var(--bv-red)' }} />
            <strong>Safety:</strong> Files are <strong>never</strong> deleted from Primary DB unless Secondary DB
            copy passes both size and checksum verification. Copy failure → file stays + error logged.
          </InfoBox>
        </Step>

        {/* ── STEP 3 ── */}
        <Step n="3" title="Incremental Backup → Remote Onsite DR (192.168.12.243) — Rule 3 (Scripts)" bg="var(--bv-green-dim)">
          <Card icon="terminal-2" title="scripts_for_incremental_backup/ — 7 per-DB rsync wrappers" color="green"
            lines={[
              'Not a second mysqldump — rsync of a staged .sql.gz to Remote, then md5 verify',
              'Logs: /var/log/<db>-incremental.log  ·  SUCCESS line means the script finished',
              'Status and log tail: Incremental Backup menu in this portal',
            ]} />
          <Arrow label="rsync -avz --checksum over SSH · port 22" color="var(--bv-green)" />
          <Card icon="building" title="Remote Onsite DR — 192.168.12.243:/home/worktual/<db>/" color="amber"
            lines={[
              'ccaas, ccaas_ai, ai_worktual_crm, unifiedring, marketing_automation, audracare, whatsappcampaign',
              'Lock files in /tmp/<db>_db_sync.lock — exit 2 if already running',
              'On-demand full dumps still rsync to /backups/remote via BackupVault engine',
            ]} />
          <InfoBox color="green">
            <strong>Portal:</strong> Open <em>Incremental Backup</em> to see whether each script last succeeded
            and to read the log. Missing log = not executed yet on this host.
          </InfoBox>
        </Step>

        {/* ── STEP 4 ── */}
        <Step n="4" title="On-Demand Backup from Dashboard — Rule 4 (Manual trigger)" bg="var(--bv-blue-bg)">
          <Card icon="player-play" title="Dashboard → Start Backup button" color="blue"
            lines={[
              'Select target: single DB server OR All Targets at once',
              'Select type: Full Backup (dumps). Incremental rsync is the Incremental Backup menu',
              'Live progress shown in WebSocket log panel (Live Logs page)',
            ]} />
          <Arrow label="transfers to all active destinations in parallel" color="var(--bv-blue)" />
          <SeqItem n="①" icon="device-floppy" color="green" title="Primary DB — always included"
            detail="/primary-db-backup/<db>/Backup_DB/<date>/ — first and always active" />
          <SeqItem n="②" icon="building" color="amber" title="Remote Onsite — rsync via SSH"
            detail="rsync to 192.168.12.243:/backups/remote/ — same structure, SSH + sshpass" />
          <SeqItem n="③" icon="brand-aws" color="purple" title="AWS S3 — only if enabled in Destinations"
            detail="aws s3 cp to s3://worktual-db-backups/ — skipped if destination not configured or inactive" />
        </Step>

        {/* ── STEP 5 ── */}
        <Step n="5" title="AWS S3 Cloud Backup — ap-south-1 Mumbai (On-Demand + Lifecycle)" bg="var(--bv-purple-bg)">
          <Card icon="brand-aws" title="S3 STANDARD_IA — s3://worktual-db-backups/" color="purple"
            lines={[
              'Region: ap-south-1 (Mumbai) · Storage class: STANDARD_IA',
              'Infrequent access pricing · immediate restore available',
              'Triggered by on-demand backup (Rule 4) or scheduled jobs with S3 destination',
            ]} />
          <Arrow label="automatic S3 lifecycle policy after 90 days" color="var(--bv-txt3)" />
          <Card icon="snowflake" title="S3 Glacier Deep Archive — auto after 90 days" color="cyan"
            lines={[
              'Long-term cold storage · lowest cost per GB',
              'Restore time: 12h (Glacier) or 48h (Deep Archive)',
              'Lifecycle rule configured in S3 bucket — no manual action needed',
            ]} />
        </Step>

        {/* ── STEP 6 ── */}
        <Step n="6" title="Retention Policy by Storage Tier" bg="var(--bv-bg3)">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <TierCard icon="device-floppy" title="Primary DB"    color="green"
              policy="Latest 50 days"
              detail="Older files moved to Secondary DB when disk > 80%. Auto-cleanup after verified copy."/>
            <TierCard icon="server-2"      title="Secondary DB"  color="cyan"
              policy="Long-term archive"
              detail="Manual copies from Primary DB (Rule 2). No auto-delete. Kept indefinitely."/>
            <TierCard icon="building"      title="Remote Onsite" color="amber"
              policy="Mirror + incremental scripts"
              detail="Full dumps rsync after each BackupVault run. Per-DB incremental scripts sync staged files to /home/worktual/<db>/."/>
            <TierCard icon="brand-aws"     title="AWS S3"        color="purple"
              policy="90 days → Glacier"
              detail="STANDARD_IA for 90 days, then auto-transitioned to Glacier Deep Archive."/>
          </div>
        </Step>

        {/* ── STEP 7 ── */}
        <Step n="7" title="Monitoring & Notifications — Rules 5 & 6" bg="var(--bv-bg3)">
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--bv-txt3)',
            textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 2 }}>
            Automated monitoring (Rule 5)
          </div>
          <RuleRow n="5a" text="Every 60s: live df on NFS servers. Every 30 min: Primary/Secondary disk — alert at 80%, block new dumps at 90%" tag="Auto" tagColor="blue"/>
          <RuleRow n="5b" text="Every 15 min: test AWS S3 connectivity — auto-deactivate destination if bucket unreachable or credentials fail" tag="Auto" tagColor="blue"/>
          <RuleRow n="5c" text="DB server reachability check before each backup — skip and log if server offline" tag="Auto" tagColor="blue"/>

          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--bv-txt3)',
            textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 2, marginTop: 6 }}>
            Email notifications (Rule 6)
          </div>
          <RuleRow n="6a" text="Immediate email when any backup job fails or transfer errors — sent to all users in the users table" tag="Email" tagColor="red"/>
          <RuleRow n="6b" text="Email when Primary DB or Remote Onsite disk exceeds 80% threshold (triggers Rule 2 action)" tag="Email" tagColor="amber"/>
          <RuleRow n="6c" text="Daily summary email at 09:00 IST — total runs, success rate, GB transferred, failed jobs list" tag="Email" tagColor="green"/>
        </Step>

      </div>
    </div>
  );
}
