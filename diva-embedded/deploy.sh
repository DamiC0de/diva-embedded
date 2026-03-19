#!/bin/bash
# Diva Blue-Green Deploy — Story 1.6
# Compile in /opt/diva-next, atomic swap, rollback on failure

set -uo pipefail

CURRENT="/opt/diva-embedded"
NEXT="/opt/diva-next"
PREVIOUS="/opt/diva-previous"
HEALTH_TIMEOUT=60
LOG="/var/log/diva-deploy.log"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [DEPLOY] $1" | tee -a "$LOG"; }

# 1. Prepare next version
log "Starting blue-green deployment..."

if [[ -d "$NEXT" ]]; then
  rm -rf "$NEXT"
fi

log "Copying current to next..."
cp -a "$CURRENT" "$NEXT"

# 2. Build in next (if source changed)
log "Building in next..."
cd "$NEXT"
npm install --production 2>&1 | tail -3 >> "$LOG"
npx tsc 2>&1 | tee -a "$LOG"
if [[ $? -ne 0 ]]; then
  log "ERROR: Build failed — aborting"
  rm -rf "$NEXT"
  exit 1
fi

# 3. Run migrations in next (dry-run with copy of DBs)
log "Build successful"

# 4. Stop current, swap, start
log "Swapping current → previous, next → current..."

systemctl stop diva-server.service 2>/dev/null || true
sleep 2

# Preserve data directory (don't overwrite DBs)
if [[ -d "$CURRENT/data" ]]; then
  cp -a "$CURRENT/data" "$NEXT/data.bak"
  rm -rf "$NEXT/data"
  mv "$CURRENT/data" "$NEXT/data"
fi

# Atomic swap
rm -rf "$PREVIOUS"
mv "$CURRENT" "$PREVIOUS"
mv "$NEXT" "$CURRENT"

# 5. Start and health check
log "Starting new version..."
systemctl start diva-server.service

log "Waiting for health check (${HEALTH_TIMEOUT}s timeout)..."
elapsed=0
while (( elapsed < HEALTH_TIMEOUT )); do
  if systemctl is-active --quiet diva-server.service 2>/dev/null; then
    sleep 3
    if systemctl is-active --quiet diva-server.service 2>/dev/null; then
      log "Health check PASSED — deployment successful!"
      rm -rf "$PREVIOUS"
      exit 0
    fi
  fi
  sleep 5
  elapsed=$((elapsed + 5))
done

# 6. Rollback
log "ERROR: Health check FAILED — rolling back!"
systemctl stop diva-server.service 2>/dev/null || true

# Restore data
if [[ -d "$CURRENT/data" ]]; then
  mv "$CURRENT/data" "$PREVIOUS/data" 2>/dev/null || true
fi

rm -rf "$CURRENT"
mv "$PREVIOUS" "$CURRENT"
systemctl start diva-server.service
log "Rollback complete — running previous version"
exit 1
