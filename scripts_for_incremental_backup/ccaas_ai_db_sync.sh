#!/bin/bash
#
# CCAAS AI Incremental Backup Sync Script
# ---------------------------------------
# Syncs a fixed-name gzip SQL dump from local staging to remote server via rsync,
# then verifies integrity with MD5 checksum.
#
# Requires: SSH key access to DST_HOST, write access to LOG_FILE.
# Exit codes: 0 success, 1 failure, 2 already running, 3 missing source file.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=db_sync_lib.sh
source "$SCRIPT_DIR/db_sync_lib.sh"

DB_NAME="ccaas_ai"
SRC_DIR="/home/incremental_backup/ccaas_ai"
SRC_FILENAME="ccaas_ai-full.sql.gz"
TARGET_FILENAME="ccaas_ai-full.sql.gz"
DST_HOST="root@192.168.12.243"
DST_DIR="/home/worktual/ccaas_ai"
LOG_FILE="/var/log/ccaas_ai-incremental.log"
LOCK_FILE="/tmp/ccaas_ai_db_sync.lock"

acquire_lock "$LOCK_FILE"
run_sync
