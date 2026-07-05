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
