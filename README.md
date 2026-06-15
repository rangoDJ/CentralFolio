# CentralFolio

A self-hosted portfolio and dividend tracking app. Connect brokerage accounts through [SnapTrade](https://snaptrade.com), see all your holdings in one place, forecast dividend income, review transactions, and rebalance toward target allocations.

## Features

- **Dashboard** — total value, profit, return, and passive income across every connected brokerage, with allocation and holdings-breakdown widgets.
- **Holdings** — a single aggregated table (by symbol) with cost basis, current value, dividends, yield, and total profit; switchable *My holdings / Dividends / Returns* views, search, and sortable columns.
- **Dividend tracker** — three sub-views:
  - *Forecast* — projected annual/monthly/daily income and yield.
  - *Calendar* — month grid of upcoming payouts with a 12-month forecast chart, plus a list view.
  - *Database* — cached dividend metadata with a manual per-symbol lookup tool.
- **Transactions** — a ledger with *Trades / Incomes / Cash / All* tabs, buy/sell totals by currency, per-trade unrealised profit, search, and CSV export.
- **Rebalancing** — define target allocations per portfolio and get suggested buy-only or full-rebalance trades; execute them where trading is enabled.
- **Custom portfolios** — group accounts from multiple brokerage connections into named, colour-labelled portfolios.
- **Brokerage connections** — account ↔ portfolio link cards with last-sync time, on-demand sync, and connect/disconnect.
- **Trading** — place buy/sell orders directly from holdings (where the brokerage supports it).
- **Background jobs** — automatic dividend, holdings, and transaction refresh on a configurable schedule.

## Requirements

- Docker and Docker Compose
- A [SnapTrade](https://snaptrade.com) partner account (free) for brokerage connectivity

## Running

```bash
docker compose up -d   # serves on http://localhost:3000
```

The database is persisted to `./data` on the host (`DATA_DIR=/data` inside the container). A prebuilt image is published at `ghcr.io/rangodj/centralfolio`; `docker compose` pulls it (or builds locally from the `Dockerfile`).

On first visit you'll be prompted to set a password; all later logins use it.

Everything else is done from the web UI: add your SnapTrade API credentials and register under **Settings → Keys & Providers**, then link and manage brokerage accounts under **Settings → Brokerage Connections**.

## Configuration

Set in the `environment:` block of `docker-compose.yml`.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port the server listens on |
| `DATA_DIR` | `/data` | Directory where `snaptrade.db` is stored (mapped to `./data`) |
| `LOG_LEVEL` | `info` | Set to `debug` for verbose output |

## Dividend data

Dividend metadata (frequency, ex-date, amount per share) is fetched automatically and cached in the local database. Results are cached for up to 7 days (24h for symbols with no dividend data). You can toggle automatic background sync and run manual per-symbol lookups in **Settings → Keys & Providers** and the **Dividend Tracker → Database** tab.

## Security

CentralFolio is single-user and protected by a password (bcrypt-hashed) with a JWT session secret, both stored in the local SQLite database. **No secrets ever leave your server.**

The database and credentials live under the mounted `./data` volume and must **never** be committed to source control: `snaptrade.db` and its WAL sidecars (`snaptrade.db-shm`, `snaptrade.db-wal`), `user-credentials.json`, and `.env`. These hold SnapTrade API keys, the password hash, and the JWT secret.
