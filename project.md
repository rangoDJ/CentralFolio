# Family Portfolio Dashboard — Project Specification

## Overview

A personal, self-hosted trading and portfolio management dashboard for a family, managing **any number of people with any number of Wealthsimple accounts each** through the **SnapTrade API**. The operator (you) is the single user — all trading and monitoring is done on behalf of all family members from one interface.

People and their accounts are configured dynamically (not hardcoded). The UI adapts to however many people and accounts are registered, including their assigned labels (e.g. TFSA, RRSP, Non-Registered Margin).

---

## People & Accounts

- **Any number of people**, each with **any number of brokerage accounts**
- People are identified by a local label (e.g. "Person A", or real names if preferred) and assigned a color from a consistent palette
- Each account has a stable local key mapping, e.g. `"person-a-tfsa"` → SnapTrade `accountId`, along with a human-readable label and account type
- Account types supported: **TFSA**, **RRSP**, **Non-Registered Margin** (and any future types)
- All SnapTrade brokerage connections are under a **single registered SnapTrade user**
- Currencies held: **CAD and USD only**
- All display values normalized to **CAD**

---

## Tech Stack

### Backend (proxy server)
- **Node.js + Express**
- Handles SnapTrade HMAC request signing — keeps `clientSecret` off the frontend
- Fetches and caches the live USD/CAD exchange rate (Bank of Canada primary, fallback to 1.40)
- Refreshes FX rate every 60 seconds
- Thin proxy: forwards requests to SnapTrade, injects auth headers, returns JSON
- **SQLite** (via `better-sqlite3`) for persistent storage of settings, account mappings, and SnapTrade connections
- Secrets (API keys, userSecret) stored encrypted with **AES-256-GCM**
- **Mock mode** toggle for development without live credentials (loads CSV data from `user_data/mock_data/`)
- 15-minute portfolio cache with warmup on startup

### Frontend
- **React 19** SPA with **Vite** build tooling
- **React Router** for client-side navigation
- **TanStack React Query** for data fetching, caching, and background refresh
- **TradingView Lightweight Charts** for live OHLC candles on the Trade page
- **Recharts** for portfolio/dividend analytics charts
- **Sonner** for toast notifications
- Dark/light theme via CSS variables and React context
- No auth layer — personal use only

### Data sources
| Data | Source |
|------|--------|
| Account balances & positions | SnapTrade API |
| Order placement & history | SnapTrade API |
| Live quotes | SnapTrade API |
| USD/CAD FX rate | Bank of Canada API (fallback: 1.40) |
| Dividend schedules & ex-dates | Polygon.io or Alpha Vantage |
| ETF dividend data (XEQT, VFV, etc.) | iShares/Vanguard (cached manually or scraped quarterly) |

---

## Currency Handling

- All values displayed in **CAD** — no toggle, no native-only view
- A single `toCad(amount, currency, fxRates)` utility function is the only place conversion happens
- FX rate is a single shared state, fetched once on load and refreshed every 60 seconds
- **FX impact** is tracked and displayed separately from price movement:
  - FX impact = `shares × nativePrice × (todayRate − yesterdayRate)`
  - Shown as its own column in the holdings table, and blended into total P&L
- USD cash ("USD pocket" inside Wealthsimple accounts) is handled explicitly — converted and summed correctly into buying power
- Dividend payouts in USD are converted at the **rate on the pay date**, not today's rate, so historical income is accurate

---

## Pages

### 1. Overview (home)
- **Total family value** in CAD across all accounts
- **Day P&L** (blended — includes FX movement)
- **Buying power** summed across all accounts
- **TFSA contribution room** across all people
- **Account grid** — grouped by person, showing all of that person's accounts
  - Each card shows: account value, % of that person's portfolio, day change
  - Click any card to drill into that account
- **Top holdings table** — cross-account, with colored dots showing which family members hold each symbol
- **Quick trade panel** — account selector dropdown, symbol, quantity, order type, buy/sell
- **Filter bar** — filter by person and by account type (TFSA / RRSP / Margin), independently

### 2. Trade
- Symbol search at top
- Full-size **TradingView Lightweight Chart** with live candles and timeframe selector
- **Account selector** always prominently displayed — shows "Person Name — Account Type" style labels
- Order ticket: symbol, quantity, order type (market / limit / stop-limit), limit price
- Confirmation step before submission showing full account name + order details
- Open orders panel below the chart

### 3. Holdings
- Flat table of all positions across all accounts, filterable by person and account type
- Columns: symbol, currency badge (CAD / USD), native price, CAD value, day P&L, **FX impact**, dividend yield, holders (colored dots)
- CAD section and USD section separated within the table
- Total row with grand CAD value and total FX impact for the day
- Live FX rate pill in the top bar showing current USD/CAD

### 4. Orders
- Pending and filled orders across all accounts
- Columns: date/time, symbol, account (person + type), side, quantity, price, status
- Filterable by account, person, date range, status

### 5. Dividends & Income
Full Snowball Analytics-style dividend module:

#### Dividend calendar
- Monthly calendar grid — each day shows which symbol pays and which person receives
- Color-coded by person
- Ex-dividend dates shown in amber
- Filterable by person and account type
- Month navigation

#### Upcoming payments list
- Next 30 days of pay dates and ex-dates
- Shows: date, symbol, which person + account type, pay vs ex-div badge, CAD amount, yield

#### Income charts
- **Monthly income bar chart** — received (solid) vs projected (light) for the full year
- **By-account-type bar chart** — TFSA / RRSP / Margin income per person
- All amounts in CAD; USD dividends converted at the historical pay-date rate

#### Dividend analytics (per holding)
- **Yield on cost** — based on your average cost basis, not current price
- **Payout ratio** — from fundamental data
- **Dividend growth** — year-over-year payout change for the last 3 years
- **Consecutive growth years** — streak counter
- **Dividend health score** — composite of yield, payout ratio, growth consistency (Snowball-style)
- **YTM yield chart** — how yield has changed relative to cost basis over time

#### Summary metrics
- Projected annual income (CAD)
- Month-to-date received
- Average yield on cost across all holdings
- DRIP reinvested year-to-date

#### DRIP tracker
- For holdings set to reinvest: extra shares accumulated, compounding effect on future income

#### Annual income goal
- Set a CAD target (e.g. $20,000/year family dividend income)
- Progress bar with projected date to hit the target based on current growth rate

#### Pre/post-tax toggle
- TFSA dividends: tax-free
- RRSP dividends: tax-deferred
- Margin dividends: taxable (15% withholding on eligible US dividends)
- Toggle between gross and net-of-tax income projections

### 6. Performance
- Portfolio value over time — family total and per-person
- Benchmark comparison: S&P 500, TSX, NASDAQ
- Dynamics of returns by year/month (Snowball-style)
- Holdings performance chart — which positions contributed most / least
- Sharpe ratio, TWR (time-weighted return), beta

### 7. Settings
- API key management (SnapTrade client ID + secret)
- Brokerage account sync (OAuth connection flow per account)
- Account label assignment (person name, account type, color)
- Mock mode toggle
- Connection status display per account

---

## Dividend Data Architecture

SnapTrade does not provide dividend schedules. A secondary data layer is required:

```
Polygon.io / Alpha Vantage
  → dividend schedule (ex-date, pay date, amount per share, currency)
  → cached in SQLite DB, refreshed weekly

iShares / Vanguard (for Canadian ETFs: XEQT, VFV, VUN, etc.)
  → manual cache or quarterly scrape
  → these are predictable quarterly distributions

Pay-date FX rate
  → fetched from Bank of Canada historical API for past payments
  → stored alongside each dividend record so historical income is stable
```

---

## Key Design Decisions

**Single operator model** — no per-person login, no role separation. You see everything, you trade everything. The account selector on the trade ticket is the only "who is this for" control, and it always shows the full "Person Name — Account Type" label to prevent mistakes.

**N people, N accounts** — the system makes no assumptions about how many people or accounts exist. All UI adapts dynamically. People and accounts are configured through the Settings page and persisted in SQLite.

**Always-on confirmation** — every order submission requires a confirmation step that shows the full account name. This is non-negotiable given you're trading on behalf of others.

**FX baked in, not hidden** — total return always includes FX movement (blended), but the holdings table always shows the FX impact column so you can see the decomposition. No mode switching needed.

**CAD-first everywhere** — USD holdings show their native price for reference (e.g. "US$213.20 / C$295.10") but every total, chart, and metric uses CAD. The family's financial picture is in CAD.

**Person color system** — each person is assigned a color from a palette (teal, blue, purple, amber, rose, …). Colors are consistent across every page: account cards, holdings dots, dividend calendar pips, chart series. Once you know the colors, you never need to read labels.

---

## SnapTrade Setup

1. Register a developer account at snaptrade.com
2. Create one SnapTrade "user" (yourself)
3. Run the OAuth brokerage connection flow once per account
4. Assign each connected account a person label and account type in Settings
5. All subsequent API calls use your `userId` + `userSecret` + HMAC-signed requests via the backend proxy

---

## Project Structure

```
/
├── backend/
│   ├── server.js          # Express proxy + HMAC signing + cache (441 lines)
│   ├── db.js              # SQLite wrapper — settings, connections, account mappings (134 lines)
│   ├── fx.js              # FX rate fetching + 60s cache (37 lines)
│   ├── configManager.js   # First-time setup, env injection, config.json (75 lines)
│   ├── cryptoUtils.js     # AES-256-GCM encryption for stored secrets (50 lines)
│   ├── snaptrade.js       # SnapTrade API client wrapper + HMAC signing (58 lines)
│   ├── mockDataLoader.js  # Loads mock CSV data from user_data/mock_data/ (68 lines)
│   └── tests/             # Diagnostic/integration scripts for SnapTrade API
│
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Overview.jsx      # Summary metrics, account grid, asset allocation
│   │   │   ├── Trade.jsx         # Chart + order ticket (form complete, submission stubbed)
│   │   │   ├── Holdings.jsx      # Tabbed by account, CAD/USD split, FX impact
│   │   │   ├── Orders.jsx        # STUB — just a heading
│   │   │   ├── Dividends.jsx     # Mock dividend income + 12-month bar chart
│   │   │   ├── Performance.jsx   # Mock GBM chart — no real data
│   │   │   └── Settings.jsx      # API keys, account sync, mock mode toggle
│   │   ├── components/
│   │   │   ├── AccountGrid.jsx       # Fetches + renders AccountCard for each account
│   │   │   ├── AccountCard.jsx       # Account value, day change, allocation %
│   │   │   ├── HoldingsTable.jsx     # Multi-currency table with FX impact + holders dots
│   │   │   ├── Charts.jsx            # AssetAllocationDonut, DividendBarChart, PerformanceAreaChart
│   │   │   ├── PriceChart.jsx        # TradingView Lightweight Charts integration
│   │   │   ├── Layout.jsx            # Sidebar nav, theme toggle, FX pill in header
│   │   │   ├── ErrorBoundary.jsx     # Error handling wrapper
│   │   │   └── ThemeContext.jsx      # Dark/light mode provider
│   │   ├── utils/
│   │   │   ├── currency.js           # toCad() + calculateFxImpact()
│   │   │   └── format.js             # Number/date formatters
│   │   └── App.jsx
│   └── index.html
│
├── user_data/
│   └── mock_data/         # Per-person CSV files for mock mode
│
└── project.md             # This file
```

---

## Current Implementation Status

### Backend — ~70% complete
| Area | Status |
|------|--------|
| Server startup, routing, config | Done |
| SnapTrade OAuth + account sync | Done |
| FX rate caching (Bank of Canada) | Done |
| SQLite DB + AES-256-GCM encryption | Done |
| Mock mode + CSV data loader | Done |
| 15-min portfolio cache + warmup | Done |
| Order placement API | Not started |
| Dividend data layer (Polygon.io) | Not started |
| Buying power calculation | Partial (hardcoded in frontend) |
| Account-to-person assignment API | Partial |

### Frontend — ~45% complete
| Page / Component | Status |
|-----------------|--------|
| Layout, nav, theming | Done |
| Overview — metrics + account grid | Partial (buying power hardcoded, allocation % = 0) |
| Holdings — table + FX impact display | Partial (dayPnL, fxImpact fields are 0 in mock data) |
| Trade — form UI + chart placeholder | Partial (submission is a stub alert, no real quotes) |
| Orders | Stub (heading only) |
| Dividends | Mock data only, no real dividend source |
| Performance | Mock GBM data, no real benchmarks |
| Settings — API keys + account sync | Substantial, mostly wired |
| Person filter bar | Not implemented |
| Colored person dots (holdings, calendar) | Not implemented |
| TFSA contribution room | Not implemented |
| Pre/post-tax dividend toggle | Not implemented |
| DRIP tracker | Not implemented |
| Annual income goal tracker | Not implemented |

---

## Still To Decide

- Whether to show real names for people or keep them anonymized in the UI (configurable in Settings)
- Mobile responsiveness requirements (desktop-first for now, mobile TBD)
- Whether to expose a read-only share link per person so each family member can view their own accounts
- How to handle Wealthsimple's USD cash pocket edge case in buying power calculations
