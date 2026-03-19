#!/bin/bash
# Diva Backup — Story 4.3
# Daily encrypted backup of all critical data with 30-day rotation.

set -uo pipefail

BACKUP_DIR="/opt/diva-backups"
DATA_DIR="/opt/diva-embedded/data"
DATE=$(date +%Y%m%d-%H%M)
BACKUP_FILE="${BACKUP_DIR}/diva-backup-${DATE}.tar.gz.gpg"
PASSPHRASE_FILE="/opt/diva-watchdog/.backup-key"
RETENTION_DAYS=30
LOG="/var/log/diva-watchdog.log"

log_json() {
  local level="$1" msg="$2" data="${3:-\{\}}"
  local ts
  ts=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
  printf '{"ts":"%s","level":"%s","service":"diva-backup","target":"backup","msg":"%s","data":%s}\n' \
    "$ts" "$level" "$msg" "$data" >> "$LOG"
}

# Ensure directories
mkdir -p "$BACKUP_DIR"

# Generate key if not exists
if [[ ! -f "$PASSPHRASE_FILE" ]]; then
  openssl rand -base64 32 > "$PASSPHRASE_FILE"
  chmod 600 "$PASSPHRASE_FILE"
  log_json "info" "Backup key generated" "{}"
fi

# Create tarball of all critical data
TMPTAR="/tmp/diva-backup-${DATE}.tar.gz"
tar -czf "$TMPTAR" \
  -C "$(dirname "$DATA_DIR")" \
  "$(basename "$DATA_DIR")/diva.db" \
  "$(basename "$DATA_DIR")/diva.db-wal" \
  "$(basename "$DATA_DIR")/diva.db-shm" \
  "$(basename "$DATA_DIR")/diva-medical.db" \
  "$(basename "$DATA_DIR")/audit.db" \
  "$(basename "$DATA_DIR")/personas" \
  "$(basename "$DATA_DIR")/proactive-config.json" \
  2>/dev/null || true

# Encrypt with GPG symmetric
gpg --batch --yes --symmetric --cipher-algo AES256 \
  --passphrase-file "$PASSPHRASE_FILE" \
  --output "$BACKUP_FILE" \
  "$TMPTAR" 2>/dev/null

rm -f "$TMPTAR"

# Check size
if [[ -f "$BACKUP_FILE" ]]; then
  SIZE=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || echo 0)
  log_json "info" "Backup created" "{\"file\":\"$BACKUP_FILE\",\"sizeBytes\":$SIZE}"
else
  log_json "error" "Backup failed" "{}"
  exit 1
fi

# Rotate — delete backups older than retention
DELETED=$(find "$BACKUP_DIR" -name "diva-backup-*.tar.gz.gpg" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
if (( DELETED > 0 )); then
  log_json "info" "Old backups purged" "{\"deleted\":$DELETED,\"retentionDays\":$RETENTION_DAYS}"
fi

exit 0
