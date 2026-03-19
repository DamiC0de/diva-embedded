#!/bin/bash
# Diva Watchdog — Story 1.1
# Surveille tous les services, redemarre si crash, logue en JSON structure
# Process bash independant — survit au crash de Node/Python

set -uo pipefail

WATCHDOG_LOG="/var/log/diva-watchdog.log"
MAX_RETRIES=3
CHECK_TIMEOUT=5

# Service definitions: name|port|check_mode
# check_mode: http = curl /health, systemd = systemctl only, port = check port listening
declare -a SERVICES=(
  "diva-server|3002|port"
  "diva-audio|8883|http"
  "diva-memory|9002|http"
  "intent-router|8882|http"
  "npu-stt|8881|http"
  "npu-embeddings|0|systemd"
  "piper-tts|8880|http"
  "rkllama|8080|port"
)

# Track retry counts per service
declare -A RETRY_COUNTS

log_json() {
  local level="$1" target="$2" msg="$3" data="${4:-\{\}}"
  local ts
  ts=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
  printf '{"ts":"%s","level":"%s","service":"diva-watchdog","target":"%s","msg":"%s","data":%s}\n' \
    "$ts" "$level" "$target" "$msg" "$data" >> "$WATCHDOG_LOG"
}

check_service() {
  local name="$1" port="$2" mode="$3"

  # Always check systemd first
  if ! systemctl is-active --quiet "${name}.service" 2>/dev/null; then
    return 1
  fi

  case "$mode" in
    http)
      if ! curl -sf --max-time "$CHECK_TIMEOUT" "http://127.0.0.1:${port}/health" > /dev/null 2>&1; then
        return 1
      fi
      ;;
    port)
      if ! ss -tlnp | grep -q ":${port} " 2>/dev/null; then
        return 1
      fi
      ;;
    systemd)
      # systemd check already done above
      ;;
  esac

  return 0
}

restart_service() {
  local name="$1"
  local count="${RETRY_COUNTS[$name]:-0}"

  if (( count >= MAX_RETRIES )); then
    log_json "error" "$name" "Max retries exceeded — service unrecoverable" "{\"retries\":$count}"
    return 1
  fi

  RETRY_COUNTS[$name]=$((count + 1))
  log_json "warn" "$name" "Service down — restarting" "{\"attempt\":$((count + 1)),\"maxRetries\":$MAX_RETRIES}"

  systemctl restart "${name}.service" 2>/dev/null
  sleep 5

  return 0
}

check_hardware() {
  # Temperature
  local temp_file="/sys/class/thermal/thermal_zone0/temp"
  if [[ -f "$temp_file" ]]; then
    local temp_mc temp_c
    temp_mc=$(cat "$temp_file")
    temp_c=$((temp_mc / 1000))

    if (( temp_c >= 85 )); then
      log_json "error" "hardware" "Critical temperature" "{\"tempC\":$temp_c}"
    elif (( temp_c >= 75 )); then
      log_json "warn" "hardware" "High temperature" "{\"tempC\":$temp_c}"
    fi
  fi

  # Disk usage
  local disk_pct
  disk_pct=$(df /opt/diva-embedded --output=pcent 2>/dev/null | tail -1 | tr -d ' %')
  if [[ -n "$disk_pct" ]] && (( disk_pct >= 80 )); then
    log_json "warn" "hardware" "Disk usage high" "{\"usedPct\":$disk_pct}"
    find /var/log -name "diva-*.log.*" -mtime +30 -delete 2>/dev/null || true
  fi

  # RAM usage
  local ram_pct
  ram_pct=$(free | awk '/Mem:/ {printf "%.0f", $3/$2 * 100}')
  if (( ram_pct >= 85 )); then
    log_json "warn" "hardware" "RAM usage high" "{\"usedPct\":$ram_pct}"
  fi
}

run_checks() {
  local all_ok=true

  for entry in "${SERVICES[@]}"; do
    IFS='|' read -r name port mode <<< "$entry"

    if check_service "$name" "$port" "$mode"; then
      # Healthy — reset retry counter
      RETRY_COUNTS[$name]=0
    else
      all_ok=false
      log_json "warn" "$name" "Health check failed" "{\"port\":\"$port\",\"mode\":\"$mode\"}"
      restart_service "$name" || true
    fi
  done

  # Hardware checks every cycle
  check_hardware
}

# Rotate log if > 10MB
rotate_log() {
  if [[ -f "$WATCHDOG_LOG" ]]; then
    local size
    size=$(stat -f%z "$WATCHDOG_LOG" 2>/dev/null || stat -c%s "$WATCHDOG_LOG" 2>/dev/null || echo 0)
    if (( size > 10485760 )); then
      mv "$WATCHDOG_LOG" "${WATCHDOG_LOG}.1"
      log_json "info" "watchdog" "Log rotated" "{}"
    fi
  fi
}

# Main
log_json "info" "watchdog" "Watchdog started" "{\"services\":${#SERVICES[@]},\"checkIntervalS\":30}"

cycle=0
while true; do
  run_checks

  # Rotate log every 100 cycles (~50 min)
  cycle=$((cycle + 1))
  if (( cycle % 100 == 0 )); then
    rotate_log
  fi

  sleep 30
done
