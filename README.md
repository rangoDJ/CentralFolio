# CentralFolio

A self-hosted portfolio and dividend tracking app. Connect brokerage accounts through [SnapTrade](https://snaptrade.com), see all your holdings in one place, forecast dividend income, review transactions, and rebalance toward target allocations.

## Features

- **Dashboard** — total value, profit, return, and passive income across every connected brokerage, with allocation and holdings-breakdown widgets.
- **Holdings** — a single aggregated table (by symbol) with cost basis, current value, dividends, yield, and total profit; switchable *My holdings / Dividends / Returns* views, search, and sortable columns.
- **Dividend tracker** — three sub-views:
  - *Forecast* — projected annual/monthly/daily income and yield.
  - *Calendar* — month grid of upcoming payouts with a 12-month forecast chart, plus a list view.
  - *Database* — cached dividend metadata with a manual Snowball lookup tool.
- **Transactions** — a ledger with *Trades / Incomes / Cash / All* tabs, buy/sell totals by currency, per-trade unrealised profit, search, and CSV export.
- **Rebalancing** — define target allocations per portfolio and get suggested buy-only or full-rebalance trades; execute them where trading is enabled.
- **Custom portfolios** — group accounts from multiple brokerage connections into named, colour-labelled portfolios.
- **Brokerage connections** — account ↔ portfolio link cards with last-sync time, on-demand sync, and connect/disconnect.
- **Trading** — place buy/sell orders directly from holdings (where the brokerage supports it).
- **Background jobs** — automatic dividend, holdings, and transaction refresh on a configurable schedule.

## Requirements

- Node.js 18, 20, or 22 LTS (prebuilt `better-sqlite3` binaries are available for these)
- A [SnapTrade](https://snaptrade.com) partner account (free) for brokerage connectivity

## Setup

```bash
npm install
```

### First run

Register your SnapTrade user and link a brokerage (one-time):

```bash
npm run register    # creates user-credentials.json (gitignored — do not delete)
npm run login       # prints a Connection Portal URL — open it to link a brokerage
```

Start the server:

```bash
npm start           # http://localhost:3000
```

On first visit you'll be prompted to set a password; all later logins use it.

### Docker

```bash
docker compose up -d   # serves on http://localhost:3000
```

The database is persisted to `./data` on the host (`DATA_DIR=/data` in the container). A prebuilt image is published at `ghcr.io/rangodj/centralfolio`.

## Environment variables

All optional. Set in a `.env` file or the shell before starting.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port the server listens on |
| `DATA_DIR` | project root | Directory where `snaptrade.db` is stored |
| `LOG_LEVEL` | `info` | Set to `debug` for verbose output |

## Dividend data

Dividend metadata (frequency, ex-date, amount per share) is fetched exclusively from **[Snowball Analytics](https://snowball-analytics.com)** and cached in the local database. Lookups are rate-limited to ~3/min; results are cached for up to 7 days (24h for symbols with no dividend data). You can toggle automatic background sync and run manual per-symbol lookups in **Settings → Keys & Providers** and the **Dividend Tracker → Database** tab.

## Security

CentralFolio is single-user and protected by a password (bcrypt-hashed) with a JWT session secret, both stored in the local SQLite database. **No secrets ever leave your server.**

The database and credentials are gitignored and must **never** be committed: `snaptrade.db` and its WAL sidecars (`snaptrade.db-shm`, `snaptrade.db-wal`), `user-credentials.json`, and `.env`. These hold SnapTrade API keys, the password hash, and the JWT secret.

## Project layout

```
CentralFolio/
├── public/                   # Static frontend (HTML, JS, CSS)
│   ├── index.html
│   ├── login.html
│   ├── css/style.css
│   └── js/
│       ├── api.js            # API client
│       ├── app.js            # App logic and event handlers
│       └── ui.js             # DOM rendering helpers
├── src/
│   ├── controllers/          # Express request handlers
│   ├── middleware/           # JWT auth middleware
│   ├── models/               # DB connection, schema, and migrations
│   ├── repositories/         # SQLite data-access layer
│   ├── routes/               # Express routers
│   ├── scripts/              # One-off CLI scripts (register, login, etc.)
│   ├── services/
│   │   ├── snaptrade.ts          # SnapTrade SDK client factory
│   │   ├── holdingsService.ts    # Positions refresh
│   │   ├── transactionService.ts # Transactions refresh
│   │   ├── dividendService.ts    # Snowball dividend fetch + forecast
│   │   ├── rebalanceService.ts   # Rebalance trade computation
│   │   ├── cacheService.ts       # Cache invalidation
│   │   └── schedulerService.ts   # Cron-based background jobs
│   └── server.ts             # Entry point
├── Dockerfile
├── docker-compose.yml
├── snaptrade.db              # SQLite database (gitignored)
└── user-credentials.json     # SnapTrade user secret (gitignored — do not delete)
```

## Scripts

```bash
npm start                # Start the server
npm test                 # Run unit tests (node:test via tsx)
npm run register         # Register SnapTrade user (one-time)
npm run login            # Generate a brokerage connection URL
npm run list-users       # List registered SnapTrade users
```
