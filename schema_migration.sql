-- BackupVault Schema — Complete Migration
-- Run this on your MariaDB: mysql -u backupvault -pbackupvault@12 backupvault < schema_migration.sql
-- Safe to run multiple times (all use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 1: EXISTING TABLES (already in your DB — no changes needed)
-- Shown here for reference only. Skip to SECTION 2 for actual changes.
-- ══════════════════════════════════════════════════════════════════════════════

/*
backup_targets      ✓ all columns present
backup_jobs         ✓ all columns present  
backup_runs         ✓ all columns present (trigger_type, run_uuid etc.)
backup_logs         ✓ all columns present
backup_destinations ✓ all columns present
backup_transfers    ✓ all columns present
users               ✓ all columns present (otp_code, otp_expires_at)
daily_backup_summary ✓ VIEW exists
*/

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 2: REQUIRED CHANGES — run these
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 1: backup_jobs.destinations column is TEXT — needs to allow NULL
--         and accept JSON array like [1,2,3]
--         Your current schema: destinations longtext JSON validated
--         STATUS: Already correct ✓
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 2: backup_transfers — add index on run_id for faster log queries
--         (missing index causes slow queries when runs grow to 1000+)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_transfers_run_id
  ON backup_transfers(run_id);

CREATE INDEX IF NOT EXISTS idx_transfers_status
  ON backup_transfers(status);

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 3: backup_runs — add indexes for the dashboard calendar query
--         (GROUP BY DATE(started_at) is slow without index on started_at)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_runs_started_at
  ON backup_runs(started_at);

CREATE INDEX IF NOT EXISTS idx_runs_target_status
  ON backup_runs(target_id, status);

CREATE INDEX IF NOT EXISTS idx_runs_job_id
  ON backup_runs(job_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 4: backup_logs — index on run_id (critical — every log query filters by run_id)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_logs_run_id
  ON backup_logs(run_id);

CREATE INDEX IF NOT EXISTS idx_logs_level
  ON backup_logs(log_level);

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 5: destinations table — this is a SEPARATE table from backup_destinations
--         Your code only uses backup_destinations (not destinations)
--         The destinations table was from original design but is unused now.
--         No change needed — just leave it.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 6: backup_destinations — add latency_ms to config JSON tracking
--         (already stored as JSON in config column — no schema change needed)
--         STATUS: Already correct ✓
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- NEW: storage_alerts table — tracks which alert emails have been sent
--      Prevents sending duplicate 80% alert emails every 30 minutes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS storage_alerts (
  id          INT(11)      NOT NULL AUTO_INCREMENT,
  mount_path  VARCHAR(500) NOT NULL,
  level       ENUM('warn','critical') NOT NULL,
  used_pct    INT(3)       NOT NULL,
  alerted_at  TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP(),
  resolved_at TIMESTAMP    NULL DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_mount_level (mount_path(100), level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- NEW: backup_notifications table — log of all emails sent (failure + storage)
--      Useful for the dashboard alerts panel and audit trail
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS backup_notifications (
  id           INT(11)       NOT NULL AUTO_INCREMENT,
  type         ENUM('backup_failed','storage_warn','storage_critical','daily_summary') NOT NULL,
  run_id       INT(11)       NULL DEFAULT NULL,
  subject      VARCHAR(500)  NOT NULL,
  recipients   TEXT          NOT NULL,
  sent_at      TIMESTAMP     NULL DEFAULT CURRENT_TIMESTAMP(),
  details      TEXT          NULL,
  PRIMARY KEY (id),
  KEY idx_notif_type (type),
  KEY idx_notif_run (run_id),
  KEY idx_notif_sent (sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- NEW: system_settings table — store configurable settings via UI
--      (storage thresholds, notification emails, retention days etc.)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_settings (
  `key`       VARCHAR(100) NOT NULL,
  `value`     TEXT         NOT NULL,
  updated_at  TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP() ON UPDATE CURRENT_TIMESTAMP(),
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Insert defaults (will not overwrite if already set)
INSERT IGNORE INTO system_settings (`key`, `value`) VALUES
  ('storage_warn_pct',    '80'),
  ('storage_crit_pct',    '90'),
  ('auto_cleanup',        'true'),
  ('retention_days',      '30'),
  ('notify_on_failure',   'true'),
  ('notify_on_warn',      'true'),
  ('daily_summary',       'true'),
  ('daily_summary_time',  '09:00'),
  ('max_concurrent_jobs', '3'),
  ('primary_mount',       '/primary-db-backup'),
  ('secondary_mount',     '/secondary-db-backup'),
  ('remote_dr_host',      '192.168.12.243'),
  ('remote_dr_port',      '22'),
  ('remote_dr_user',      'root'),
  ('remote_dr_path',      '/backups/remote');

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 2b: QUERY EXECUTION + REPORTS + NFS SNAPSHOTS
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE backup_targets ADD COLUMN IF NOT EXISTS environment     VARCHAR(32)  NOT NULL DEFAULT 'qa';
ALTER TABLE backup_targets ADD COLUMN IF NOT EXISTS query_enabled   TINYINT(1)   NOT NULL DEFAULT 1;
ALTER TABLE backup_targets ADD COLUMN IF NOT EXISTS query_host      VARCHAR(255) NULL DEFAULT NULL;
ALTER TABLE backup_targets ADD COLUMN IF NOT EXISTS query_port      INT(11)      NULL DEFAULT NULL;
ALTER TABLE backup_targets ADD COLUMN IF NOT EXISTS query_user      VARCHAR(128) NULL DEFAULT NULL;
ALTER TABLE backup_targets ADD COLUMN IF NOT EXISTS query_pass_enc  TEXT         NULL DEFAULT NULL;

UPDATE backup_targets
   SET query_enabled = 1
 WHERE is_active = 1 AND db_type IN ('mysql','postgresql');

CREATE TABLE IF NOT EXISTS query_audit (
  id              BIGINT       NOT NULL AUTO_INCREMENT,
  execution_id    VARCHAR(64)  NOT NULL,
  user_id         INT(11)      NOT NULL,
  username        VARCHAR(191) NULL,
  connection_id   INT(11)      NULL,
  connection_name VARCHAR(191) NULL,
  environment     VARCHAR(16)  NULL,
  db_engine       VARCHAR(32)  NULL,
  database_name   VARCHAR(191) NULL,
  statement_type  VARCHAR(32)  NULL,
  sql_text        MEDIUMTEXT   NULL,
  status          VARCHAR(32)  NOT NULL DEFAULT 'RUNNING',
  client_ip       VARCHAR(45)  NULL,
  error_text      TEXT         NULL,
  row_count       INT(11)      NULL DEFAULT 0,
  truncated       TINYINT(1)   NULL DEFAULT 0,
  duration_ms     INT(11)      NULL DEFAULT 0,
  finished_at     TIMESTAMP    NULL DEFAULT NULL,
  created_at      TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP(),
  PRIMARY KEY (id),
  KEY idx_qa_user (user_id, id),
  KEY idx_qa_exec (execution_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS query_sp_allowlist (
  id              INT(11)      NOT NULL AUTO_INCREMENT,
  connection_id   INT(11)      NOT NULL,
  procedure_name  VARCHAR(191) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sp (connection_id, procedure_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS report_runs (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  execution_id  VARCHAR(64)  NOT NULL,
  report_key    VARCHAR(128) NOT NULL,
  report_name   VARCHAR(255) NULL,
  params_json   TEXT         NULL,
  trigger_type  VARCHAR(32)  NULL,
  user_id       INT(11)      NULL,
  username      VARCHAR(191) NULL,
  row_count     INT(11)      NULL DEFAULT 0,
  duration_ms   INT(11)      NULL DEFAULT 0,
  status        VARCHAR(32)  NULL,
  error_text    TEXT         NULL,
  emailed_to    TEXT         NULL,
  emailed_at    TIMESTAMP    NULL DEFAULT NULL,
  created_at    TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP(),
  PRIMARY KEY (id),
  KEY idx_rr_key (report_key, id),
  KEY idx_rr_exec (execution_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS nfs_monitoring_snapshots (
  id          BIGINT      NOT NULL AUTO_INCREMENT,
  server_id   INT(11)     NOT NULL,
  disk_pct    INT(11)     NULL,
  inode_pct   INT(11)     NULL,
  status      VARCHAR(32) NULL,
  snapshot_at TIMESTAMP   NULL DEFAULT CURRENT_TIMESTAMP(),
  PRIMARY KEY (id),
  KEY idx_nfs_snap (server_id, snapshot_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 3: INSERT DEFAULT DESTINATIONS (if not already configured)
-- ══════════════════════════════════════════════════════════════════════════════
INSERT IGNORE INTO backup_destinations (id, name, dest_type, config, is_active) VALUES
(1, 'Primary DC (Local NFS)',
 'local',
 '{"path":"/primary-db-backup","status":"connected","last_check":null}',
 1),
(2, 'Remote Onsite DR (192.168.12.243)',
 'remote_sftp',
 '{"host":"192.168.12.243","port":22,"user":"root","password":"","path":"/backups/remote","status":"misconfigured"}',
 0),
(3, 'AWS S3 Backup (Mumbai)',
 'aws_s3',
 '{"bucket":"","region":"ap-south-1","access_key":"","secret_key":"","prefix":"db-backups/","storage_class":"STANDARD_IA","status":"misconfigured"}',
 0);

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 4: UPDATE daily_backup_summary VIEW (add file_path tracking)
-- ══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW daily_backup_summary AS
  SELECT
    CAST(br.started_at AS DATE)                                          AS backup_date,
    t.db_type,
    t.name                                                               AS target_name,
    COUNT(0)                                                             AS total_runs,
    SUM(CASE WHEN br.status='success' THEN 1 ELSE 0 END)                AS success_count,
    SUM(CASE WHEN br.status='failed'  THEN 1 ELSE 0 END)                AS failed_count,
    SUM(CASE WHEN br.status='partial' THEN 1 ELSE 0 END)                AS partial_count,
    MAX(br.file_size_bytes)                                              AS largest_backup_bytes,
    SUM(br.file_size_bytes)                                              AS total_bytes,
    MAX(br.completed_at)                                                 AS last_completed,
    (SELECT br2.file_path FROM backup_runs br2
     WHERE br2.target_id=t.id AND br2.status='success'
     ORDER BY br2.started_at DESC LIMIT 1)                              AS latest_file_path
  FROM backup_runs br
  JOIN backup_targets t ON br.target_id=t.id
  GROUP BY CAST(br.started_at AS DATE), t.db_type, t.name;

-- ══════════════════════════════════════════════════════════════════════════════
-- VERIFY — run after migration
-- ══════════════════════════════════════════════════════════════════════════════
-- SHOW TABLES;
-- SHOW INDEX FROM backup_runs;
-- SHOW INDEX FROM backup_logs;
-- SELECT * FROM system_settings;
-- SELECT id,name,dest_type,is_active FROM backup_destinations;
