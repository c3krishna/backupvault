#!/bin/bash
#
# Unifiedring Incremental Backup Sync Script
# ------------------------------------------
# Syncs a fixed-name gzip SQL dump from local staging to remote server via rsync,
# then verifies integrity with MD5 checksum.
#
# Requires: SSH key access to DST_HOST, write access to LOG_FILE.
# Exit codes: 0 success, 1 failure, 2 already running, 3 missing source file.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=db_sync_lib.sh
source "$SCRIPT_DIR/db_sync_lib.sh"

DB_NAME="unifiedring"
SRC_DIR="/home/incremental_backup/unifiedring"
SRC_FILENAME="unifiedring-full.sql.gz"
TARGET_FILENAME="unifiedring-full.sql.gz"
DST_HOST="root@192.168.12.243"
DST_DIR="/home/worktual/unifiedring"
LOG_FILE="/var/log/unifiedring-incremental.log"
LOCK_FILE="/tmp/unifiedring_db_sync.lock"

acquire_lock "$LOCK_FILE"
run_sync
