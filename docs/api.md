# AURUM SIGNALS — API Contract (INC-8, frozen for INC-9)

Base URL: `http://<host>:3001`

**Analysis tool. Not financial advice. Past performance does not guarantee future results. Personal use only.**

## Authentication

- **Public** endpoints require no auth.
- **Protected** endpoints require header `X-Admin-Token: <ADMIN_API_TOKEN>` (value lives only in the gitignored `.env`). Missing/wrong token → `401 Unauthorized`. The guard fails closed: if the server has no `ADMIN_API_TOKEN` configured, all protected requests are rejected.

All timestamps are ISO-8601 UTC strings. Numeric DB values (Postgres `numeric`) are returned as JSON **numbers** by the read API (coerced), except within raw signal rows where some remain strings — see each shape.

---

## Public read endpoints (GET, no auth)

### `GET /health`
Liveness probe (INC-0). Response:
```json
{ "status": "ok", "ts": "2026-07-05T12:00:00.000Z" }
```

### `GET /api/health`
Per-timeframe last successful ingestion, last FX time, per-source error counts, and the stale flag. `stale = true` when the 15min feed has had no ingestion within `staleThresholdMinutes` **during market hours**.
```json
{
  "ts": "2026-07-05T12:00:00.000Z",
  "marketOpen": false,
  "stale": false,
  "staleThresholdMinutes": 15,
  "timeframes": {
    "15min": { "lastIngestionTs": "2026-07-05T08:30:00+00:00" },
    "1h":    { "lastIngestionTs": "2026-07-05T08:00:00+00:00" },
    "4h":    { "lastIngestionTs": "2026-07-05T04:00:00+00:00" },
    "1day":  { "lastIngestionTs": "2026-07-05T00:00:00+00:00" }
  },
  "fx": { "lastTs": "2026-07-05T05:06:00+00:00" },
  "sources": {
    "twelvedata": { "consecutiveErrors": 0, "circuitOpen": false },
    "goldapi":    { "consecutiveErrors": 0, "circuitOpen": false }
  }
}
```

### `GET /api/signals?status=&limit=`
Signal history, newest first.
- Query `status` (optional): one of `OPEN|HIT_TP|HIT_SL|EXPIRED|INVALIDATED`.
- Query `limit` (optional): default `50`, max `200`.
- Response: JSON **array** of signal objects (empty `[]` when none). Each object:
```json
{
  "id": "uuid",
  "created_at": "2026-07-05T00:00:00+00:00",
  "symbol": "XAU/USD",
  "timeframe": "4h",
  "direction": "BUY",
  "entry_price": "2341.2000",
  "stop_loss": "2332.8000",
  "take_profit": "2358.0000",
  "rr_ratio": "2.00",
  "confluence_score": 5,
  "confluence_max": 6,
  "track": "core",
  "status": "OPEN",
  "resolved_at": null,
  "resolved_price": null,
  "pips_result": null,
  "suggested_lots": "0.02",
  "risk_amount_ccy": "13.40",
  "sizing_note": "Your size: 0.02 lots (risking ~£13.44 ≈ 0.67% of account)",
  "tp_structure_capped": null,
  "factors": { "F1_trend_higher": { "pass": true }, "...": "..." },
  "notes": null
}
```

### `GET /api/signals/active`
Current `OPEN` signals only. Same object shape as above; array.

### `GET /api/performance`
`performance_daily` rollups + headline stats **over `track='core'` ONLY**, plus a separate `experimental` block for `track='experimental'`. Headline, `daily`, and `experimental` are recomputed from the `signals` table via the **same INC-4 pure functions** the tracker uses (`computePerformanceDaily`, `maxLosingStreak`) so they cannot diverge. The core headline NEVER includes experimental signals. Zero-state returns empty `daily` and zero/null headline (not an error).
```json
{
  "daily": [
    {
      "day": "2026-07-05",
      "signals_generated": 2,
      "wins": 1, "losses": 1, "expired": 0,
      "win_rate": 50.0,
      "avg_rr_achieved": 0.5,
      "cumulative_r": 1.0
    }
  ],
  "headline": {
    "total_signals": 0,
    "resolved": 0,
    "wins": 0, "losses": 0, "expired": 0,
    "win_rate": null,
    "avg_r_per_trade": null,
    "cumulative_r": 0,
    "max_losing_streak": 0
  },
  "experimental": {
    "total_signals": 0,
    "resolved": 0,
    "wins": 0, "losses": 0, "expired": 0,
    "win_rate": null,
    "avg_r_per_trade": null,
    "cumulative_r": 0,
    "max_losing_streak": 0
  },
  "note": "Results use data-feed prices, before spread and slippage."
}
```
`daily` and `headline` are core-only; `experimental` carries the same measured stats for the 15min experimental track.

### `GET /api/market/snapshot`
Latest price + latest indicator snapshot per timeframe + latest FX + freshness.
```json
{
  "symbol": "XAU/USD",
  "price": { "value": 4174.99, "ts": "2026-07-05T08:30:00+00:00" },
  "indicators": {
    "15min": { "timeframe": "15min", "ts": "...", "rsi_14": "46.10", "macd": "-0.00283", "ema_20": "4174.94", "ema_200": "4155.61", "atr_14": "0.25", "nearest_support": "4160.15", "nearest_resistance": "4176.23", "...": "..." },
    "1h": { "...": "..." }, "4h": { "...": "..." }, "1day": { "...": "..." }
  },
  "fx": { "pair": "GBP/USD", "rate": 1.33535, "ts": "2026-07-05T05:06:00+00:00" },
  "dataAsOf": "2026-07-05T08:30:00+00:00",
  "note": "Results use data-feed prices, before spread and slippage."
}
```
Any timeframe with no snapshot yet is `null`.

### `GET /api/sizing/tier-status` (public read)
```json
{ "resolved_count": 0, "cumulative_r": 0, "tier2_unlocked": false, "progress": "0/50" }
```

### `GET /api/settings` (public read, non-sensitive)
Current money-management settings.
```json
{ "account_size": 2000, "account_ccy": "GBP", "risk_pct": 1.0, "current_tier": 1 }
```

---

## Public calculator (POST, no auth)

### `POST /api/sizing/calculate`
Pure, read-only position-size calculator (no DB writes). Kept public. Enforces the 3.0% hard ceiling (→ `400`).
- Body: `{ account_size, account_ccy?, risk_pct, entry, stop, take_profit?, gbp_usd_rate }`
- Response: `{ suggested_lots, risk_amount_ccy, reward_amount_ccy, too_small, sizing_note }`

---

## Protected endpoints (POST, require `X-Admin-Token`)

All are state-changing / credit-consuming / Telegram / settings triggers. Missing or wrong token → `401`.

| Method & path | Purpose | Body / params |
|---|---|---|
| `POST /api/ingest/seed` | Run the startup seed (Twelve Data) | — |
| `POST /api/ingest/timeframe/:tf` | Ingest one timeframe (`15min\|1h\|4h\|1day`) | path `:tf` |
| `POST /api/ingest/fx` | Ingest GBP/USD FX | — |
| `POST /api/indicators/compute/:tf` | Recompute indicator snapshot | path `:tf` |
| `POST /api/signals/evaluate/:tf` | Evaluate the signal engine | path `:tf` |
| `POST /api/track/run` | Resolve OPEN signals + rebuild `performance_daily` | — |
| `POST /api/alerts/test` | Send a Telegram test alert | `{ "type"?: "signal"\|"resolution"\|"admin" }` |
| `POST /api/settings/risk-pct` | Update `user_settings.risk_pct` (tier-enforced) | `{ "risk_pct": number, "acknowledgment"?: string }` |
| `POST /api/settings/account` | Update `account_size` + `account_ccy` (validates `>0` and `GBP`/`USD`) | `{ "account_size": number, "account_ccy": "GBP"\|"USD" }` |

Representative success responses:
- `/api/ingest/seed` → `{ "ok": true, "health": { ... } }`
- `/api/signals/evaluate/:tf` → `{ "timeframe": "1h", "evaluated": true, "fired": false, "reason": "trend_factors_disagree", "track": "core" }`
- `/api/track/run` → `{ "openBefore": 0, "resolved": 0, "performanceDays": 0, "resolutions": [] }`
- `/api/settings/risk-pct` → `{ "ok": true, "tier": 1, "risk_pct": 1.5 }`
- `/api/settings/account` → `{ "ok": true, "account_size": 5000, "account_ccy": "USD" }`

---

## Notes
- INC-8 exposes/documents/protects only; no engine, sizing, tracker, or alert logic changed.
- `GET /api/health` (INC-8) replaces and formalizes the INC-1 `/api/health`; it is DB-backed for last-ingestion (persistent across restarts).
- This contract is FROZEN for INC-9 (dashboard).
