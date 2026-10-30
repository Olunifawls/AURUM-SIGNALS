#!/usr/bin/env bash
# AURUM watchdog (L2-INC-6). Runs every minute from aurum-watchdog.timer. Installed
# at /usr/local/bin/ on the VPS. Three independent checks, each with its own state:
#
#   1. Backend: GET /api/health from INSIDE the container. 3 consecutive failures ->
#      restart aurum-backend-1 + Telegram alert. The ONLY check that may restart.
#   2. Public: https://aurum.mcnifglobal.com/login must be HTTP 200 over a valid
#      certificate. Failure -> Telegram alert, at most once per hour.
#   3. Certificate: served cert expires within 14 days -> Telegram alert, at most
#      once per day.
#
# Check 1 must never go through the public site: on 3 Oct an expired certificate
# made every check fail and a healthy backend was restarted 9,123 times.
#
# WATCHDOG_DRY_RUN=1 logs each restart or alert instead of doing it, and keeps its
# state apart so a dry run cannot touch the live counters or alert timers.
set -uo pipefail

ENV_FILE="${ENV_FILE:-/root/aurum/.env}"
BACKEND_CONTAINER="${BACKEND_CONTAINER:-aurum-backend-1}"
PUBLIC_URL="${PUBLIC_URL:-https://aurum.mcnifglobal.com/login}"
CERT_HOST="${CERT_HOST:-aurum.mcnifglobal.com}"
CERT_PORT="${CERT_PORT:-443}"
DRY_RUN="${WATCHDOG_DRY_RUN:-0}"

BACKEND_FAIL_LIMIT=3
PUBLIC_ALERT_EVERY=3600
CERT_ALERT_EVERY=86400
CERT_WARN_SECONDS=$((14 * 86400))

STATE_DIR="${STATE_DIR:-/run/aurum-watchdog}"
[ "$DRY_RUN" = "1" ] && STATE_DIR="${STATE_DIR}.dry-run"
mkdir -p "$STATE_DIR"
BACKEND_STATE="$STATE_DIR/backend.fails"
PUBLIC_STATE="$STATE_DIR/public.last_alert"
CERT_STATE="$STATE_DIR/cert.last_alert"

# Exits 0 only on HTTP 200 with a JSON body that has "ts". Single quotes are
# deliberate: this is JavaScript for the container, not for this shell.
# shellcheck disable=SC2016
HEALTH_JS='
fetch("http://localhost:3001/api/health", { signal: AbortSignal.timeout(10000) })
  .then(async (r) => {
    const body = await r.json();
    process.exit(r.status === 200 && body && body.ts ? 0 : 1);
  })
  .catch(() => process.exit(1));
'

log() {
  logger -t aurum-watchdog "$1"
  [ "$DRY_RUN" = "1" ] && echo "$1"
  return 0
}

# Read a state file as a number; missing or corrupt reads as 0.
read_number() {
  local value
  value=$(cat "$1" 2>/dev/null || true)
  case "$value" in
    '' | *[!0-9]*) echo 0 ;;
    *) echo "$value" ;;
  esac
}

# Returns 0 if Telegram accepted the message (or a dry run would have sent it).
send_telegram() {
  local text="$1" token chat
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY RUN: would send Telegram: $text"
    return 0
  fi
  token=$(grep '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
  chat=$(grep '^TELEGRAM_CHAT_ID=' "$ENV_FILE" | cut -d= -f2-)
  if [ -z "$token" ] || [ -z "$chat" ]; then
    log "Telegram not configured; alert not sent"
    return 1
  fi
  if ! curl -fs -m 15 "https://api.telegram.org/bot${token}/sendMessage" \
    -d chat_id="${chat}" \
    --data-urlencode "text=${text}" >/dev/null; then
    log "Telegram send failed"
    return 1
  fi
}

# Alert at most once per `every` seconds. The timer only starts on a successful
# send, so a Telegram outage retries next cycle rather than losing the alert.
alert_throttled() {
  local state="$1" every="$2" text="$3" now last
  now=$(date +%s)
  last=$(read_number "$state")
  if [ $((now - last)) -lt "$every" ]; then
    log "alert suppressed, sent within the last ${every}s: $text"
    return 0
  fi
  send_telegram "$text" && echo "$now" >"$state"
}

check_backend() {
  local fails
  if timeout -k 5 20 docker exec "$BACKEND_CONTAINER" node -e "$HEALTH_JS" >/dev/null 2>&1; then
    echo 0 >"$BACKEND_STATE"
    [ "$DRY_RUN" = "1" ] && log "backend check OK"
    return 0
  fi

  fails=$(($(read_number "$BACKEND_STATE") + 1))
  echo "$fails" >"$BACKEND_STATE"
  log "backend health check FAILED ($fails/$BACKEND_FAIL_LIMIT)"
  [ "$fails" -lt "$BACKEND_FAIL_LIMIT" ] && return 0

  echo 0 >"$BACKEND_STATE"
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY RUN: would restart $BACKEND_CONTAINER after $fails failures"
    send_telegram "⚠️ AURUM watchdog: backend health failed ${fails}× — restarted ${BACKEND_CONTAINER} on $(hostname)."
    return 0
  fi

  log "restarting $BACKEND_CONTAINER after $fails failures"
  if timeout -k 5 60 docker restart "$BACKEND_CONTAINER" >/dev/null 2>&1; then
    send_telegram "⚠️ AURUM watchdog: backend health failed ${fails}× — restarted ${BACKEND_CONTAINER} on $(hostname)."
  else
    log "restart of $BACKEND_CONTAINER FAILED"
    send_telegram "🔴 AURUM watchdog: backend health failed ${fails}× and restarting ${BACKEND_CONTAINER} FAILED on $(hostname)."
  fi
}

check_public() {
  local code rc
  # No -k: a bad certificate must fail. No -L: a redirect is not a 200.
  code=$(curl -sS -o /dev/null -w '%{http_code}' -m 20 "$PUBLIC_URL" 2>/dev/null)
  rc=$?
  if [ "$rc" -eq 0 ] && [ "$code" = "200" ]; then
    [ "$DRY_RUN" = "1" ] && log "public check OK"
    return 0
  fi
  log "public check FAILED: $PUBLIC_URL HTTP $code, curl exit $rc"
  alert_throttled "$PUBLIC_STATE" "$PUBLIC_ALERT_EVERY" \
    "⚠️ AURUM watchdog: $PUBLIC_URL failed (HTTP $code, curl exit $rc). Backend not restarted."
}

check_cert() {
  local pem not_after
  pem=$(timeout -k 5 20 openssl s_client -connect "${CERT_HOST}:${CERT_PORT}" -servername "$CERT_HOST" </dev/null 2>/dev/null |
    openssl x509 2>/dev/null)
  if [ -z "$pem" ]; then
    # Not an expiry finding, and the public check alerts if the site is unreachable.
    log "certificate check could not read a certificate from ${CERT_HOST}:${CERT_PORT}"
    return 0
  fi
  if printf '%s\n' "$pem" | openssl x509 -noout -checkend "$CERT_WARN_SECONDS" >/dev/null 2>&1; then
    [ "$DRY_RUN" = "1" ] && log "certificate check OK"
    return 0
  fi
  not_after=$(printf '%s\n' "$pem" | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2-)
  log "certificate for $CERT_HOST expires within 14 days: $not_after"
  alert_throttled "$CERT_STATE" "$CERT_ALERT_EVERY" \
    "⚠️ AURUM watchdog: certificate for $CERT_HOST expires within 14 days ($not_after)."
}

# Independent on purpose: a failure in one must not stop the others running.
check_backend
check_public
check_cert
exit 0
