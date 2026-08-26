#!/bin/bash
#
# CCAAS Incremental Backup Sync Script
# --------------------------------------
# Syncs a fixed-name gzip SQL dump from local staging to remote server via rsync,
# then verifies integrity with MD5 checksum.
#
# Source file uses legacy name ccaas2023-full.sql.gz; remote target is ccaas-full.sql.gz.
#
# Requires: SSH key access to DST_HOST, write access to LOG_FILE.
# Exit codes: 0 success, 1 failure, 2 already running, 3 missing source file.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=db_sync_lib.sh
source "$SCRIPT_DIR/db_sync_lib.sh"

DB_NAME="ccaas"
SRC_DIR="/home/incremental_backup/ccaas"
SRC_FILENAME="ccaas2023-full.sql.gz"
TARGET_FILENAME="ccaas-full.sql.gz"
DST_HOST="root@192.168.12.243"
DST_DIR="/home/worktual/ccaas"
LOG_FILE="/var/log/ccaas-incremental.log"
LOCK_FILE="/tmp/ccaas_db_sync.lock"

acquire_lock "$LOCK_FILE"
run_sync
