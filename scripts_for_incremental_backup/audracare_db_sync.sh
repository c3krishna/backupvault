#!/bin/bash
#
# Audracare Incremental Backup Sync Script
# ----------------------------------------
# Syncs a fixed-name gzip SQL dump from local staging to remote server via rsync,
# then verifies integrity with MD5 checksum.
#
# Source file uses caretakemgt-full.sql.gz in the audracare staging directory.
#
# Requires: SSH key access to DST_HOST, write access to LOG_FILE.
# Exit codes: 0 success, 1 failure, 2 already running, 3 missing source file.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=db_sync_lib.sh
source "$SCRIPT_DIR/db_sync_lib.sh"

DB_NAME="audracare"
SRC_DIR="/home/incremental_backup/audracare"
SRC_FILENAME="caretakemgt-full.sql.gz"
TARGET_FILENAME="caretakemgt-full.sql.gz"
DST_HOST="root@192.168.12.243"
DST_DIR="/home/worktual/audracare"
LOG_FILE="/var/log/audracare-incremental.log"
LOCK_FILE="/tmp/audracare_db_sync.lock"

acquire_lock "$LOCK_FILE"
run_sync
