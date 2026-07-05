# L2-INC-6 — Level 2 VPS deploy + hardening (DEMO)

Level 2 runs on the existing VPS (167.233.144.70, `aurum.mcnifglobal.com`) in
**demo mode**, alongside the untouched L1 service. Backend stays internal-only
behind nginx; only nginx is public (80/443).

## Deploy
- Stack lives at `/root/aurum` (Docker Compose: backend + frontend + nginx on the
  `aurum` network). Redeploy = `git pull` + `docker compose up -d --build`.
- After a `--build` that recreates the **frontend**, reload nginx once so it
  re-resolves the new upstream IP: `docker exec aurum-nginx-1 nginx -s reload`
  (a full reboot self-heals — nginx starts fresh). Restarting only the **backend**
  needs no nginx reload (the frontend proxy re-resolves `backend:3001` per request).
- Env: L2 vars added to `/root/aurum/.env` (600 root, **not committed**):
  `TRADING_MODE=demo`, `OANDA_*_DEMO`, `OANDA_ACCOUNT_CCY_DEMO=GBP`,
  `RISK_PER_TRADE_PCT=1.0`, `MAX_OPEN_POSITIONS=2`, `MAX_DAILY_LOSS_PCT=3.0`,
  `MAX_WEEKLY_LOSS_PCT=6.0`, `MAX_TOTAL_DRAWDOWN_PCT=20`, `MAX_SPREAD_POINTS=0.60`,
  `MAX_SLIPPAGE_POINTS=0.50`, `NEWS_BLACKOUT_ENABLED=true`, `AUTO_TRADE_ENABLED=true`.
  **All `OANDA_*_LIVE` left blank. TRADING_MODE is never `live`.**
- Startup reconcile (D7) runs on boot before execution is enabled.

## Hardening
- **fail2ban** (sshd jail), **chrony** (time sync), **unattended-upgrades** — all
  enabled at boot.
- **Watchdog**: `ops/aurum-watchdog.{sh,service,timer}` installed at
  `/usr/local/bin/aurum-watchdog.sh` + `/etc/systemd/system/`. The timer runs every
  minute; after 3 consecutive `/api/health` failures it restarts `aurum-backend-1`
  and sends a Telegram admin alert.
- **Non-root deploy user**: `deploy` (groups `docker`, `sudo`), key-only SSH. A
  deploy-owned copy of the stack lives at `/opt/aurum` (same Compose project name
  `aurum`, so it manages the same containers). Verified `deploy` can run
  `docker compose ps` and control containers.

## What was and was NOT restricted (deliberately conservative — no lockout risk)
- **NOT changed:** `sshd_config` untouched — root SSH key login stays enabled
  (`PermitRootLogin prohibit-password`, the Ubuntu default). Root remains a full
  fallback. Password auth unchanged.
- **Added only:** the `deploy` user, hardening packages, and the watchdog. Nothing
  that could lock anyone out was touched in this increment. Disabling root login is
  intentionally deferred until the `deploy` path has been exercised over time.

## Recovery behaviour
- `docker kill/stop backend` → Docker restart policy and/or the watchdog bring it
  back (watchdog also alerts).
- Full VPS reboot → docker is enabled at boot; all containers + the watchdog timer
  auto-start; startup reconcile re-runs; the public site self-heals to 200.
