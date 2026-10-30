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
  minute. See [Watchdog](#watchdog) below.
- **Certificate renewal**: the certbot deploy hook
  `/etc/letsencrypt/renewal-hooks/deploy/restart-aurum-nginx.sh` restarts nginx after
  every renewal, so the renewed certificate is actually served.
- **Non-root deploy user**: `deploy` (groups `docker`, `sudo`), key-only SSH. A
  deploy-owned copy of the stack lives at `/opt/aurum` (same Compose project name
  `aurum`, so it manages the same containers). Verified `deploy` can run
  `docker compose ps` and control containers.

## Watchdog
Three independent checks, each with its own state file in `/run/aurum-watchdog/`
(tmpfs, so a reboot resets the counter and alert timers):

| Check | Test | On failure | State file |
|---|---|---|---|
| Backend | `docker exec aurum-backend-1` runs node's fetch on `http://localhost:3001/api/health` with a 10s timeout. Healthy = HTTP 200 and JSON with `ts`. | 3 consecutive failures: restart `aurum-backend-1` + Telegram alert | `backend.fails` |
| Public | `https://aurum.mcnifglobal.com/login` is HTTP 200 over a valid certificate (no `-k`, no redirects followed) | Telegram alert, at most once per hour. Never restarts. | `public.last_alert` |
| Certificate | Certificate served on 443 expires within 14 days | Telegram alert, at most once per day. Never restarts. | `cert.last_alert` |

**Only the backend check may restart anything.** It runs inside the container so
that nothing in front of the backend can fail it. The old check went through the
public site: when the certificate expired on 3 Oct (renewed on disk, nginx never
restarted), every check failed and a healthy backend was restarted 9,123 times in 4
weeks. It also counted the login redirect (HTTP 307) as healthy, so it could not see
a dead backend. The certbot deploy hook above fixes that expiry's cause.

An alert timer only starts once Telegram accepts the message, so a Telegram outage
retries next cycle. If the certificate cannot be read at all, the check logs that and
does not alert; the public check covers an unreachable site. A healthy run logs
nothing.

Test without restarting or alerting. A dry run prints each result, logs what it would
do, and keeps its state in `/run/aurum-watchdog.dry-run/`, so it cannot affect the
live counter or alert timers:
```
WATCHDOG_DRY_RUN=1 /usr/local/bin/aurum-watchdog.sh
```
Logs: `journalctl -t aurum-watchdog -n 50`

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
