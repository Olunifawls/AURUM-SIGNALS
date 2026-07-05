# AURUM SIGNALS

AURUM SIGNALS is a personal gold (XAU/USD) analysis & signal platform: a NestJS 10 backend (ingestion, indicators, confluence signal engine, outcome tracker, position sizing, Telegram alerts, read REST API) and a Next.js 14 dashboard, on Supabase (Postgres 15).

**Analysis tool, not financial advice. Past performance does not guarantee future results. Personal use only.**

## Run locally

Prerequisites: Node 20 LTS, a repo-root `.env` (copy `.env.example` and fill in the values — it is gitignored and never committed).

```bash
npm install            # from the repo root (installs both workspaces)
```

Start the **backend** on `:3001` (loads the repo-root `.env` automatically, from any directory):

```bash
npm run start --workspace=backend      # or: npm run start:dev --workspace=backend  (watch mode)
```

Start the **frontend** on `:3000` (reads the same repo-root `.env` via `env-cmd`; no manual `source` needed):

```bash
npm run dev --workspace=frontend
```

Then open <http://localhost:3000>. The dashboard reads Supabase directly (anon key) and the backend read API through a same-origin proxy, so the backend must be running too.

### View it on your phone (same wifi)

Both dev servers bind to `0.0.0.0` (all interfaces), so a phone on the same network can reach them. Find your Mac's LAN IP and use it in place of `localhost`:

```bash
ipconfig getifaddr en0        # e.g. 192.168.1.42  (use en1 on some Macs)
```

- Dashboard on the phone: `http://<LAN-IP>:3000`
- If you also point the browser at the backend directly, it's `http://<LAN-IP>:3001`. To make the frontend's server-side proxy reach the backend over the LAN, set `BACKEND_URL=http://<LAN-IP>:3001` in `.env` (default `http://localhost:3001` is fine when both run on the Mac).

### Environment / deploy notes

- In Docker/CI/Vercel there is no `.env` file — the app falls back to `process.env` cleanly (no crash).
- `ADMIN_API_TOKEN` and the Supabase service-role key are **server-only** (never `NEXT_PUBLIC_`); settings writes route through the Next.js server-side proxy so the admin token never reaches the browser.

## Deploy (VPS, Docker Compose behind nginx + HTTPS)

Production runs three containers on an internal Docker network — **backend** (`:3001`) and **frontend** (`:3000`) are internal-only; **nginx** is the sole public service (80/443) reverse-proxying `aurum.mcnifglobal.com → frontend:3000`. The always-on backend runs the `@nestjs/schedule` crons. All services use `restart: unless-stopped`.

Secrets live only in `/root/aurum/.env` on the VPS (Compose `env_file`), never in git.

**First-time setup (on the VPS, `/root/aurum`):**
```bash
# 1. Docker Engine + Compose plugin installed; ufw allows only 22/80/443.
# 2. Clone the repo, create /root/aurum/.env with all keys (see .env.example) plus:
#      BACKEND_URL=http://backend:3001
# 3. Bring the stack up (HTTP first):
docker compose up -d --build
# 4. Issue the Let's Encrypt cert (DNS must resolve to this host first):
certbot certonly --webroot -w /root/aurum/certbot-webroot \
  -d aurum.mcnifglobal.com --email fawaleoluwaseun3@gmail.com --agree-tos --non-interactive
# 5. Switch nginx to HTTPS and reload:
cp nginx/https.conf nginx/default.conf
docker compose exec nginx nginx -s reload
```

**Redeploy (one command):**
```bash
cd /root/aurum && git pull && docker compose up -d --build
```

**TLS auto-renewal:** `certbot renew` runs via the system `certbot.timer`; a deploy hook reloads nginx after renewal (`/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh`).

A future broker/execution service would slot in as a 4th internal service on the `aurum` network (no public port) — see the placeholder note in `docker-compose.yml`.
