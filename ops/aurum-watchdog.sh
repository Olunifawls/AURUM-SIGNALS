#!/usr/bin/env bash
# AURUM backend health watchdog (L2-INC-6). 3 consecutive /api/health failures ->
# restart the backend container + Telegram admin alert. Additive safety net atop
# Docker's restart:unless-stopped policy. Installed at /usr/local/bin/ on the VPS.
set -uo pipefail
STATE=/run/aurum-watchdog.fails
ENV_FILE=/root/aurum/.env
HEALTH_URL="https://aurum.mcnifglobal.com/api/proxy/api/health"
fails=$(cat "$STATE" 2>/dev/null || echo 0)
if curl -fsS -m 20 "$HEALTH_URL" >/dev/null 2>&1; then
  echo 0 > "$STATE"; exit 0
fi
fails=$((fails + 1)); echo "$fails" > "$STATE"
logger -t aurum-watchdog "backend health check FAILED ($fails/3)"
if [ "$fails" -ge 3 ]; then
  logger -t aurum-watchdog "restarting aurum-backend-1 after $fails failures"
  docker restart aurum-backend-1 >/dev/null 2>&1
  TOKEN=$(grep '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
  CHAT=$(grep '^TELEGRAM_CHAT_ID=' "$ENV_FILE" | cut -d= -f2-)
  if [ -n "$TOKEN" ] && [ -n "$CHAT" ]; then
    curl -s -m 15 "https://api.telegram.org/bot${TOKEN}/sendMessage" \
      -d chat_id="${CHAT}" \
      --data-urlencode "text=⚠️ AURUM watchdog: backend health failed ${fails}× — restarted aurum-backend-1 on $(hostname)." >/dev/null
  fi
  echo 0 > "$STATE"
fi
