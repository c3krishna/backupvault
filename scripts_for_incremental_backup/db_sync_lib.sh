#!/bin/bash
#
# Shared library for incremental DB backup sync scripts.
# Each wrapper sets config vars, then calls acquire_lock and run_sync.
#
# First run (remote file missing or size mismatch): full copy of a stable snapshot.
# Later runs (every 4 hours): incremental rsync — skip if checksum already matches.
# Source is snapshotted before transfer so an in-progress dump cannot change the hash.
#
# Exit codes:
#   0 - success
#   1 - failure after max retries or unrecoverable error
#   2 - already running (lock held)
#   3 - missing source file or directory

MAX_RETRIES="${MAX_RETRIES:-10}"
RETRY_INTERVAL="${RETRY_INTERVAL:-60}"
STABILITY_WAIT="${STABILITY_WAIT:-30}"
export RSYNC_RSH="${RSYNC_RSH:-ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=30}"

BV_LOCK_FILE=""
BV_SNAP_FILE=""

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] - $1" | tee -a "$LOG_FILE"
}

cleanup_sync() {
    [[ -n "${BV_SNAP_FILE:-}" && -f "$BV_SNAP_FILE" ]] && rm -f "$BV_SNAP_FILE"
    [[ -n "${BV_LOCK_FILE:-}" && -f "$BV_LOCK_FILE" ]] && rm -f "$BV_LOCK_FILE"
}

acquire_lock() {
    BV_LOCK_FILE="$1"
    trap cleanup_sync EXIT

    if [[ -f "$BV_LOCK_FILE" ]]; then
        local pid
        pid=$(cat "$BV_LOCK_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            echo "$(date): Already running (PID $pid) — exiting"
            exit 2
        fi
        echo "$(date): Stale lock found — removing"
        rm -f "$BV_LOCK_FILE"
    fi

    echo $$ > "$BV_LOCK_FILE"
}

get_local_hash() {
    md5sum "$1" | awk '{print $1}'
}

get_remote_hash() {
    local remote_path="$DST_DIR/$TARGET_FILENAME"
    local output
    local status

    output=$(ssh -o BatchMode=yes -o ConnectTimeout=15 "$DST_HOST" "md5sum -- '$remote_path' 2>/dev/null" 2>&1)
    status=$?

    if [[ $status -ne 0 ]]; then
        log "ERROR: SSH failed while fetching remote hash: $output"
        return 1
    fi

    if [[ -z "$output" ]]; then
        log "ERROR: Remote file not found or empty hash result: $remote_path"
        return 1
    fi

    echo "$output" | awk '{print $1}'
}

ensure_remote_dir() {
    local output
    local status

    output=$(ssh -o BatchMode=yes -o ConnectTimeout=15 "$DST_HOST" "mkdir -p -- '$DST_DIR'" 2>&1)
    status=$?

    if [[ $status -ne 0 ]]; then
        log "ERROR: Failed to create remote directory $DST_DIR: $output"
        return 1
    fi
}

remote_size() {
    ssh -o BatchMode=yes -o ConnectTimeout=15 "$DST_HOST" \
        "if [ -f '$DST_DIR/$TARGET_FILENAME' ]; then stat -c '%s' -- '$DST_DIR/$TARGET_FILENAME'; else echo 0; fi" \
        2>/dev/null || echo 0
}

wait_for_stable_file() {
    local file="$1"
    local wait_seconds="${2:-$STABILITY_WAIT}"
    local previous_size=-1
    local stable_seconds=0

    while [[ $stable_seconds -lt $wait_seconds ]]; do
        if [[ ! -f "$file" ]]; then
            log "ERROR: Source file disappeared while waiting for stability: $file"
            return 1
        fi

        local current_size
        current_size=$(stat -c '%s' "$file" 2>/dev/null || stat -f '%z' "$file")

        if [[ "$current_size" -eq 0 ]]; then
            log "ERROR: Source file is empty: $file"
            return 1
        fi

        if [[ "$current_size" -eq "$previous_size" ]]; then
            stable_seconds=$((stable_seconds + 1))
        else
            stable_seconds=0
            previous_size=$current_size
        fi

        sleep 1
    done

    log "INFO: Source file stable for ${wait_seconds}s ($previous_size bytes)"
}

find_source_file() {
    find "$SRC_DIR" -maxdepth 1 -type f -name "$SRC_FILENAME" | sort | tail -n1
}

snapshot_source() {
    local file="$1"
    local snap="${file}.bvsnap.$$"
    rm -f "$snap"
    cp -f -- "$file" "$snap" || return 1
    BV_SNAP_FILE="$snap"
}

run_sync() {
    if [[ -z "${SRC_DIR:-}" || -z "${SRC_FILENAME:-}" || -z "${TARGET_FILENAME:-}" || -z "${DST_HOST:-}" || -z "${DST_DIR:-}" || -z "${LOG_FILE:-}" ]]; then
        echo "ERROR: Missing required configuration variables" >&2
        exit 1
    fi

    if [[ ! -d "$SRC_DIR" ]]; then
        log "ERROR: Source directory not found: $SRC_DIR"
        exit 3
    fi

    local file
    file=$(find_source_file)

    if [[ -z "$file" ]]; then
        log "ERROR: No backup file found: $SRC_DIR/$SRC_FILENAME"
        exit 3
    fi

    local filename
    filename=$(basename "$file")
    log "INFO: Found backup $filename"

    if ! wait_for_stable_file "$file"; then
        exit 1
    fi

    log "INFO: Snapshotting source so a dump writer cannot change the file mid-rsync"
    if ! snapshot_source "$file"; then
        log "ERROR: Failed to snapshot $file"
        exit 1
    fi

    local local_hash local_size
    local_hash=$(get_local_hash "$BV_SNAP_FILE")
    local_size=$(stat -c '%s' "$BV_SNAP_FILE")

    if ! ensure_remote_dir; then
        exit 1
    fi

    local dest_size
    dest_size=$(remote_size)
    dest_size=${dest_size//[^0-9]/}
    dest_size=${dest_size:-0}

    local mode="incremental"
    local rsync_flags=(-avz --partial)

    if [[ "$dest_size" -eq 0 ]]; then
        mode="full"
        rsync_flags+=(-W)
        log "INFO: Remote file missing — first-time FULL copy ($local_size bytes) to $DST_HOST:$DST_DIR/$TARGET_FILENAME"
    elif [[ "$dest_size" -ne "$local_size" ]]; then
        mode="full"
        rsync_flags+=(-W)
        log "INFO: Remote size $dest_size != local $local_size — FULL copy (stale or partial dest)"
    else
        rsync_flags+=(--checksum)
        log "INFO: Remote file present ($dest_size bytes) — incremental rsync (skip if checksum matches)"
    fi

    local attempt=1
    while [[ $attempt -le $MAX_RETRIES ]]; do
        log "Starting ${mode} rsync of $filename to $DST_HOST (attempt $attempt/$MAX_RETRIES)..."

        rsync "${rsync_flags[@]}" "$BV_SNAP_FILE" "$DST_HOST:$DST_DIR/$TARGET_FILENAME"
        local rsync_status=$?

        if [[ $rsync_status -ne 0 ]]; then
            log "ERROR: rsync failed with status $rsync_status. Retrying in ${RETRY_INTERVAL}s..."
            sleep "$RETRY_INTERVAL"
            attempt=$((attempt + 1))
            continue
        fi

        local remote_hash
        if ! remote_hash=$(get_remote_hash); then
            log "ERROR: Could not verify remote checksum. Retrying in ${RETRY_INTERVAL}s..."
            sleep "$RETRY_INTERVAL"
            attempt=$((attempt + 1))
            continue
        fi

        if [[ "$local_hash" == "$remote_hash" ]]; then
            log "SUCCESS: ${mode} sync complete and checksum verified ($local_size bytes)."
            exit 0
        fi

        log "ERROR: Hash mismatch (local=$local_hash, remote=$remote_hash). Retrying as full copy in ${RETRY_INTERVAL}s..."
        mode="full"
        rsync_flags=(-avz --partial -W)
        sleep "$RETRY_INTERVAL"
        attempt=$((attempt + 1))
    done

    log "ERROR: Sync failed after $MAX_RETRIES attempts."
    exit 1
}
