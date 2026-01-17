#!/usr/bin/env bash
#
# Memory Loop Launch Script
#
# Builds the frontend, then starts the backend server.
# Logs all output to a log file; only errors go to stdout.
#
# Usage: ./scripts/launch.sh
#

set -euo pipefail

# Resolve project root (parent of scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Log file location
LOG_DIR="$PROJECT_ROOT/logs"
LOG_FILE="$LOG_DIR/memory-loop-$(date +%Y-%m-%d).log"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Logging helper
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

log_error() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*"
    echo "$msg" >> "$LOG_FILE"
    echo "$msg" >&2
}

# Set VAULTS_DIR to default if not provided
if [[ -z "${VAULTS_DIR:-}" ]]; then
    export VAULTS_DIR="$PROJECT_ROOT/vaults"
    log "VAULTS_DIR not set, using default: $VAULTS_DIR"
fi

# Create vaults directory if it doesn't exist
if [[ ! -d "$VAULTS_DIR" ]]; then
    log "Creating vaults directory: $VAULTS_DIR"
    mkdir -p "$VAULTS_DIR"
fi

log "Starting Memory Loop..."
log "VAULTS_DIR: $VAULTS_DIR"
log "Project root: $PROJECT_ROOT"

# Build frontend
log "Building frontend..."
cd "$PROJECT_ROOT/frontend"
if ! bun run build >> "$LOG_FILE" 2>&1; then
    log_error "Frontend build failed. Check $LOG_FILE for details."
    exit 1
fi
log "Frontend build complete"

# Start backend
log "Starting backend server..."
cd "$PROJECT_ROOT/backend"

# Run backend, redirect stdout to log
# prevent SIGHUP from killing the server
exec nohup bun run start 2>&1 >> "$LOG_FILE" &

