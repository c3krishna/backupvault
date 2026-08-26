'use strict';
// Idempotent schema for query/reports/NFS snapshots. Safe to run on every boot.

const db = require('./connection');

const STATEMENTS = [
  `ALTER TABLE backup_targets ADD COLUMN environment VARCHAR(32) NOT NULL DEFAULT 'qa'`,
  `ALTER TABLE backup_targets ADD COLUMN query_enabled TINYINT(1) NOT NULL DEFAULT 1`,
  `ALTER TABLE backup_targets ADD COLUMN query_host VARCHAR(255) NULL DEFAULT NULL`,
  `ALTER TABLE backup_targets ADD COLUMN query_port INT(11) NULL DEFAULT NULL`,
  `ALTER TABLE backup_targets ADD COLUMN query_user VARCHAR(128) NULL DEFAULT NULL`,
  `ALTER TABLE backup_targets ADD COLUMN query_pass_enc TEXT NULL DEFAULT NULL`,
  `UPDATE backup_targets SET query_enabled = 1 WHERE is_active = 1 AND db_type IN ('mysql','postgresql')`,
  `CREATE TABLE IF NOT EXISTS query_audit (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS query_sp_allowlist (
    id              INT(11)      NOT NULL AUTO_INCREMENT,
    connection_id   INT(11)      NOT NULL,
    procedure_name  VARCHAR(191) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_sp (connection_id, procedure_name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS report_runs (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS nfs_monitoring_snapshots (
    id          BIGINT      NOT NULL AUTO_INCREMENT,
    server_id   INT(11)     NOT NULL,
    disk_pct    INT(11)     NULL,
    inode_pct   INT(11)     NULL,
    status      VARCHAR(32) NULL,
    snapshot_at TIMESTAMP   NULL DEFAULT CURRENT_TIMESTAMP(),
    PRIMARY KEY (id),
    KEY idx_nfs_snap (server_id, snapshot_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

async function ensureSchema() {
  for (const sql of STATEMENTS) {
    try {
      await db.pool.query(sql);
    } catch (e) {
      const dup = e.code === 'ER_DUP_FIELDNAME' || e.errno === 1060
        || /Duplicate column/i.test(e.message);
      if (!dup) console.warn('[schema]', e.message.split('\n')[0]);
    }
  }
  console.log('[schema] Query/NFS tables ensured');
}

module.exports = { ensureSchema };
