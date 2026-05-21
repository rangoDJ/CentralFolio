# CentralFolio

A self-hosted portfolio and dividend tracking app. Connect brokerage accounts via SnapTrade, track dividend income across all holdings, and chat with an AI assistant that has live access to your portfolio data.

## Features

- **Portfolio dashboard** — holdings, market values, and account balances across all connected brokerages
- **Dividend tracking** — upcoming dividend events, annual income forecast, and a historical database with multi-provider fallback (Yahoo Finance, Tiingo, EODHD, Polygon, Alpha Vantage, Finnhub)
- **Custom portfolios** — group accounts from multiple brokerages into named portfolios with colour labels
- **Trading** — place buy/sell orders directly from the dashboard (where supported by the brokerage)
- **AI assistant** — floating chat panel powered by Claude, OpenAI, Gemini, or any self-hosted OpenAI-compatible model; the assistant has live tool access to your holdings and dividend data
- **Background jobs** — automatic dividend and holdings refresh on a configurable schedule

## Requirements

- Node.js 18 LTS or 20 LTS (recommended — prebuilt `better-sqlite3` binaries are available)
- A [SnapTrade](https://snaptrade.com) partner account (free) for brokerage connectivity
- An API key for at least one AI provider if you want the assistant feature (optional)

## Setup

```bash
npm install
```

### First run

Register your SnapTrade user and link a brokerage. This is a one-time step:

```bash
npm run register    # creates user-credentials.json (gitignored — do not delete)
npm run login       # prints a Connection Portal URL — open in browser to link brokerage
```

Start the server:

```bash
npm start           # http://localhost:3000
```

On first visit you will be prompted to set a password. All subsequent logins use that password.

## Environment variables

All optional. Set in a `.env` file or in the shell before starting.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port the server listens on |
| `DATA_DIR` | project root | Directory where `snaptrade.db` is stored |
| `LOG_LEVEL` | `info` | Set to `debug` for verbose output |

## AI assistant

Configure a provider in **Settings → Keys & Providers → AI Assistant**. All keys are stored in the local database and never leave your server.

| Provider | Model field default | Notes |
|---|---|---|
| Claude (Anthropic) | `claude-sonnet-4-6` | [console.anthropic.com](https://console.anthropic.com) |
| OpenAI (ChatGPT) | `gpt-4o` | [platform.openai.com](https://platform.openai.com) |
| Gemini (Google) | `gemini-2.0-flash` | [aistudio.google.com](https://aistudio.google.com) |
| Self-hosted | *(your model name)* | Any OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, etc.) |

For self-hosted providers, set the **Base URL** to your endpoint (e.g. `http://localhost:11434/v1` for Ollama). The API key field is optional for local setups. Tool use (function calling) requires a model that supports it — Llama 3.1+, Mistral, and Qwen all do.

The assistant has access to five live tools:

- `list_portfolios` — all connected portfolios and their accounts
- `get_holdings` — current positions for a given account
- `get_dividend_metadata` — dividend yield, frequency, and ex-date for any symbol
- `get_all_dividends` — all upcoming dividend events across every portfolio
- `get_dividend_forecast` — projected income for a specific account

## Dividend data providers

Enable providers in **Settings → Keys & Providers → Dividend Data Providers**. Multiple providers are tried in order as fallback.

| Provider | Coverage | Cost |
|---|---|---|
| Yahoo Finance | US & Canadian stocks | Free, no key |
| Tiingo | US stocks | Paid — requires API key |
| EODHD | US & Canadian stocks | Free 20 calls/day — requires API key |
| Polygon.io | Multiple markets | Free tier — requires API key |
| Alpha Vantage | Global stocks | Free tier — requires API key |
| Finnhub | Global stocks | Free tier — requires API key |

## Project layout

```
CentralFolio/
├── public/                   # Static frontend (HTML, JS, CSS)
│   ├── index.html
│   └── js/
│       ├── api.js            # API client
│       ├── app.js            # App logic and event handlers
│       └── ui.js             # DOM rendering helpers
├── src/
│   ├── controllers/          # Express request handlers
│   ├── middleware/           # Auth middleware
│   ├── models/               # Database schema and connection
│   ├── repositories/         # SQLite data access layer
│   ├── routes/               # Express routers
│   ├── scripts/              # One-off CLI scripts (register, login, etc.)
│   ├── services/
│   │   ├── aiService.ts      # AI provider abstraction (Claude / OpenAI / Gemini / self-hosted)
│   │   ├── dividendService.ts
│   │   ├── holdingsService.ts
│   │   ├── schedulerService.ts
│   │   └── snaptrade.ts
│   └── server.ts             # Entry point
├── snaptrade.db              # SQLite database (gitignored)
└── user-credentials.json     # SnapTrade user secret (gitignored — do not delete)
```

## Scripts

```bash
npm start                # Start the server
npm run register         # Register SnapTrade user (one-time)
npm run login            # Generate brokerage connection URL
npm run list-users       # List registered SnapTrade users
```
