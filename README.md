# CentralFolio

A self-hosted portfolio and dividend tracking app. Connect brokerage accounts through [SnapTrade](https://snaptrade.com), see all your holdings in one place, forecast dividend income, review transactions, rebalance toward target allocations, prepare Canadian capital-gains reporting, and get alerted when something needs attention.

## Features

- **Dashboard** — total value, profit, passive income and an annualised **money-weighted return (XIRR)** across every connected brokerage, with allocation and holdings-breakdown widgets, a performance chart with benchmark overlay, and risk metrics. XIRR accounts for the size and timing of each contribution; where there is too little history to annualise, the tile falls back to a plainly-labelled simple return.
- **Holdings** — a single aggregated table (by symbol) with cost basis, current value, dividends, yield, and total profit; switchable *My holdings / Dividends / Returns* views, search, and sortable columns.
- **Compare portfolios** — put every symbol across several portfolios into one matrix: which portfolios hold it, at what size and weight, and which don't. A gap offers a buy into any trading-enabled account in the target portfolio. Filter to gaps, symbols common to all, or symbols only one portfolio owns. Amounts are converted into a single base currency, so mixed-currency portfolios total correctly.
- **Dividend tracker** — three sub-views:
  - *Forecast* — projected annual/monthly/daily income and yield.
  - *Calendar* — month grid of upcoming payouts with a 12-month forecast chart, plus a list view.
  - *Database* — cached dividend metadata with a manual per-symbol lookup tool.
- **Watchlist** — track candidates you don't own yet. Price, trailing yield, dividend growth (DGR) and growth streak are pulled from Yahoo when you add a symbol; AI ratings appear once the rating job has analysed it. Set **buy criteria** per symbol (price at or below, yield at or above, minimum rating, minimum growth streak) and the table shows whether they're met, plus how far price sits from your target.
- **Transactions** — a ledger with *Trades / Incomes / Cash / All* tabs, buy/sell totals by currency, per-trade unrealised profit, search, and CSV export. **Add transactions by hand or import a broker CSV** for activity the connection never supplied — trades predating the connection, or transfers reported without a cost base. These feed the tax report and performance history alongside synced data.
- **Tax & T5008** — per-disposition slip data and a Schedule 3 roll-up for non-registered accounts, in CAD at each trade's own exchange rate, with superficial losses identified; carrying charges and interest expense (Schedule 4, line 22100); CSV export; and a **tax-loss harvesting** view of which holdings could offset this year's realised gains. See [Tax reporting](#tax-reporting).
- **Rebalancing** — define target allocations per portfolio and get suggested buy-only or full-rebalance trades; execute them where trading is enabled.
- **Alerts** — get told when something needs attention instead of having to go looking. See [Alerts](#alerts).
- **Custom portfolios** — group accounts from multiple brokerage connections into named, colour-labelled portfolios.
- **Brokerage connections** — account ↔ portfolio link cards with last-sync time, on-demand sync, and connect/disconnect.
- **Trading** — place buy/sell orders directly from holdings (where the brokerage supports it).
- **Performance history** — the value curve is reconstructed by replaying transactions against price history, and anchored to **nightly snapshots** of what each account was actually worth. Snapshots are independent of the transaction ledger, so the curve holds even where the broker never reported an activity. They accumulate from first run; earlier dates stay reconstructed.
- **Background jobs** — automatic dividend, holdings, transaction and price-history refresh, nightly portfolio snapshots, alert evaluation, and optional AI stock ratings — each on its own configurable schedule (**Settings → Scheduler**).
- **API tokens** — issue revocable, non-browser tokens (**Settings → Brokerage Connections → Security**) for scripts and other API clients, separate from your login session.
- **Live log viewer** — tail the running server's logs from the browser (**Settings → Logs**), with level filtering, search, and pause/autoscroll.

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
| `ANTHROPIC_API_KEY` | — | Optional. Enables AI stock ratings (used by the watchlist and the rating-downgrade alert). Can be set in **Settings → Keys & Providers** instead. |

## Dividend data

Dividend metadata (frequency, ex-date, amount per share) is fetched automatically and cached in the local database. Results are cached for up to 7 days (24h for symbols with no dividend data). You can toggle automatic background sync and run manual per-symbol lookups in **Settings → Keys & Providers** and the **Dividend Tracker → Database** tab.

## Alerts

Rules are evaluated in the background and surface under **Settings → Alerts**, with a read/unread history. When a webhook is configured (**Settings → Keys & Providers**) each batch is also pushed there as a single Discord-compatible message.

| Rule | Fires when |
|---|---|
| Dividend cut | A holding paid less last complete year than the year before |
| Dividend due soon | A forecast payout lands inside your window |
| Allocation drift | A holding strays past your band from its rebalancing target |
| AI rating downgrade | The stock rating gets worse since the last check |
| Watchlist target hit | A watched symbol meets every buy criterion you set on it |

**All rules start disabled** — this app can reach an external service, and turning that on is your decision. Enable what you want and set its thresholds in Settings.

Each situation notifies **once**. A dividend cut alerts on the year it happened, not on every run for as long as the cut remains true; drift is bucketed to whole percentage points so daily wobble around your threshold stays quiet. **Preview** evaluates every rule — including ones you haven't enabled — without sending or recording anything, so you can see what a rule would say before switching it on.

## Tax reporting

**The tax features assume a Canadian resident filing in CAD.** Amounts convert at each trade's own exchange rate, capital gains use the 50% inclusion rate, and the superficial-loss rule uses the CRA's 30-days-either-side window. They will not produce correct figures under another country's rules.

Cost base is pooled the way CRA requires: across *all* your non-registered accounts, and across the CAD and USD listings of the same security (so a Norbert's Gambit reads as a currency conversion rather than a disposition at zero cost). Registered accounts are excluded from dispositions — no T5008 is issued for them and including them would overstate taxable gains.

**Tax-loss harvesting** shows which non-registered holdings sit at a loss, how much of this year's realised gain each would offset, and what the superficial-loss rule would do to it:

- **Clear** — no purchase in the last 30 days.
- **At risk** — bought within 30 days, so that portion of the loss is denied and rolled into the cost base instead of claimed now. A DRIP is called out by name, since it fires inside the window without any decision from you.
- **Denied** — repurchased inside an RRSP/TFSA. A registered account has no cost base to absorb the denied loss, so it is forfeited outright rather than deferred. These are excluded from the harvestable total but still listed, so you can see why.

The 30-day window counts purchases in **any** of your accounts, registered ones included. Setting an optional marginal rate estimates the tax saved; without it the report stops at the taxable-income reduction.

Where a disposition has no recorded purchase, the report says so rather than reporting the whole proceeds as a gain — enter the missing trade under **Transactions → Add transaction** to correct it.

> These are estimates from your own cached data, not tax advice. Check them against your broker's slips before filing.

## Security

CentralFolio is single-user and protected by a password (bcrypt-hashed) with a JWT session secret, both stored in the local SQLite database. **No secrets ever leave your server.**

On login the session token is set as an `httpOnly`, `SameSite=Strict` cookie (`secure` when served over HTTPS), so it is not readable by injected scripts. `requireAuth` accepts the token from either that cookie or an `Authorization: Bearer` header, and `POST /auth/logout` clears the cookie. The bundled frontend still keeps a copy in `localStorage` for the bearer flow; a future hardening step is to drop the `localStorage` copy entirely and rely on the cookie alone.

For scripts and other non-browser clients, issue a long-lived **API token** under **Settings → Brokerage Connections → Security** instead of sharing your login session — send it as `Authorization: Bearer cf_...`. Tokens are shown once at creation and stored only as a SHA-256 hash; revoke one anytime from the same panel to invalidate it immediately.

The database and credentials live under the mounted `./data` volume and must **never** be committed to source control: `snaptrade.db` and its WAL sidecars (`snaptrade.db-shm`, `snaptrade.db-wal`), `user-credentials.json`, and `.env`. These hold SnapTrade API keys, the password hash, and the JWT secret. Do not place `DATA_DIR` inside a cloud-synced folder (Dropbox, Nextcloud, iCloud, etc.) — the database holds plaintext secrets that would then be replicated to that service.

### Single-instance deployment

CentralFolio is designed to run as **a single process**. Login rate-limiting and short-lived SSE auth tickets are held in memory, not in the database, so:

- Running more than one replica (e.g. scaling the container horizontally) will split this state and break rate-limiting and live-update tickets.
- A restart resets the in-memory login rate-limit counters.

For the intended single-user, single-container setup this is fine. If you ever need multiple instances, these stores must be moved to the shared SQLite database first.
