#!/usr/bin/env bash
#
# Memory Loop Launch Script
#
# Builds and starts the Next.js application in production mode.
# Logs all output to a date-stamped log file; only errors go to stderr.
#
# Environment variables:
#   VAULTS_DIR  - Directory containing vaults (default: ./vaults)
#   PORT        - Server port (default: 3000)
#   HOSTNAME    - Bind address (default: 0.0.0.0)
#
# Usage: ./scripts/launch.sh
#

set -euo pipefail

# Resolve project root (parent of scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
NEXTJS_DIR="$PROJECT_ROOT/nextjs"

# Log file location
LOG_DIR="$PROJECT_ROOT/logs"
LOG_FILE="$LOG_DIR/memory-loop-$(date +%Y-%m-%d).log"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Logging helpers
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

log_error() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*"
    echo "$msg" >> "$LOG_FILE"
    echo "$msg" >&2
}

# Next.js uses HOSTNAME (not HOST) for bind address
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
export PORT="${PORT:-3000}"
export NODE_ENV=production

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
log "HOSTNAME: $HOSTNAME"
log "PORT: $PORT"
log "Project root: $PROJECT_ROOT"

# Build Next.js
log "Building Next.js..."
if ! bun run --cwd "$NEXTJS_DIR" build >> "$LOG_FILE" 2>&1; then
    log_error "Next.js build failed. Check $LOG_FILE for details."
    exit 1
fi
log "Next.js build complete"

# Start Next.js (exec replaces shell so signals reach the server directly)
log "Starting Next.js server on $HOSTNAME:$PORT..."
exec bun run --cwd "$NEXTJS_DIR" start >> "$LOG_FILE" 2>&1
