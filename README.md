# CentralFolio — Family Portfolio Dashboard

A personal, self-hosted trading and portfolio management dashboard for families managing multiple Wealthsimple brokerage accounts through the **SnapTrade API**. Trade, monitor, and analyze holdings across multiple family members' accounts from a single, unified interface.

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/node.js-18%2B-green.svg)
![React](https://img.shields.io/badge/react-19-blue.svg)

---

## Features

### 📊 Dashboard & Analytics
- **Total family portfolio value** in CAD across all people and accounts
- **Real-time account overview** with day P&L and intraday changes
- **Multi-person account grid** with color-coded family members
- **Holdings table** with FX impact breakdown (USD/CAD) and cross-account visibility
- **Top holdings cross-account view** with colored dots showing which family members hold each symbol
- **Account filtering** by person and account type (TFSA / RRSP / Margin)

### 💱 Multi-Currency Support
- All values displayed in **CAD** with native currency reference (USD)
- **Live USD/CAD exchange rates** fetched from Bank of Canada API
- **FX impact tracking** separated from price movement in holdings table
- Historical dividend conversions using pay-date exchange rates for accurate income tracking

### 🔐 Multi-Account & Multi-Key Support
- **Up to 3 SnapTrade API credential pairs** (supporting multiple SnapTrade developer accounts)
- **Any number of people** with **any number of brokerage accounts each**
- **Auto-detection of existing brokerage connections** on startup (TD, RBC, CIBC, etc.)
- **Connection renaming** — assign custom names to brokerage connections for clarity
- **Hierarchical account selection** grouped by SnapTrade key → Brokerage → Account

### 📈 Trading & Orders
- **Fixed Shares or Fixed Amount toggle** for flexible order entry
- **MARKET and LIMIT order types** with validation
- **Order confirmation** step showing full account name and details before submission
- **Open orders panel** with status tracking
- **Order history** with filtering by account, date range, and status
- **TradingView Lightweight Charts** integration with multiple timeframes

### 💰 Dividend Income Tracking
- **Dividend calendar** with monthly grid showing pay dates and ex-dividend dates
- **Upcoming payments list** for next 30 days
- **Annual income bar chart** (received vs projected)
- **Per-holding analytics**:
  - Yield on cost
  - Payout ratio & dividend growth
  - Health score composite
  - DRIP tracking
- **Tax-aware income projections** (TFSA tax-free, RRSP tax-deferred, Margin taxable)
- **Annual income goal** with progress tracking and projection date

### ⚙️ Administration
- **SnapTrade key management** (add/remove/view credentials)
- **Multi-key OAuth flow** with per-key brokerage connection
- **Account label assignment** (person name, account type, color)
- **Mock mode** for development without live API credentials
- **Settings page** with complete key/connection/account management

---

## Architecture

### Backend
- **Node.js + Express** proxy server with HMAC request signing
- **SQLite** (`better-sqlite3`) for persistent storage:
  - Multi-key credentials (snaptrade_keys table)
  - Connection mappings with custom display names
  - Account metadata and portfolio configuration
- **AES-256-GCM encryption** for sensitive credentials (userSecret)
- **15-minute portfolio cache** with warmup on startup
- **Live FX rate fetching** from Bank of Canada API (60-second refresh)

### Frontend
- **React 19** SPA with **Vite** build tooling
- **TanStack React Query** for data fetching, caching, and background updates
- **TradingView Lightweight Charts** for OHLC candles and technical analysis
- **Recharts** for portfolio and dividend analytics visualizations
- **Sonner** for toast notifications
- **Dark/Light theme** support via CSS variables and React context

### Data Sources
| Data | Source |
|------|--------|
| Account balances & positions | SnapTrade API |
| Order placement & history | SnapTrade API |
| Live quotes | SnapTrade API |
| USD/CAD FX rate | Bank of Canada API |
| Dividend schedules | Polygon.io / Alpha Vantage (future) |
| ETF distributions | iShares/Vanguard (manual cache) |

---

## Prerequisites

- **Node.js** 18.x or higher
- **npm** or **yarn**
- **SnapTrade developer account** (free at [snaptrade.com](https://snaptrade.com))
  - One credential pair for single-key setup
  - Up to three credential pairs for multi-key setup
- **Docker** (optional, for containerized deployment)

---

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/CentralFolio.git
cd CentralFolio
```

### 2. Install Dependencies

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### 3. Set Up SnapTrade Credentials

#### Option A: Single Key (Legacy)

Create a `.env` file in the `backend/` directory:

```env
SNAPTRADE_CLIENT_ID=your_client_id_here
SNAPTRADE_CONSUMER_KEY=your_consumer_key_here
```

#### Option B: Multiple Keys (Recommended)

For up to 3 SnapTrade developer accounts:

```env
SNAPTRADE_CLIENT_ID_1=first_account_client_id
SNAPTRADE_CONSUMER_KEY_1=first_account_consumer_key

SNAPTRADE_CLIENT_ID_2=second_account_client_id
SNAPTRADE_CONSUMER_KEY_2=second_account_consumer_key

SNAPTRADE_CLIENT_ID_3=third_account_client_id
SNAPTRADE_CONSUMER_KEY_3=third_account_consumer_key
```

> **Backward Compatibility:** If only `SNAPTRADE_CLIENT_ID` and `SNAPTRADE_CONSUMER_KEY` are set, the system automatically uses them as Key 1.

### 4. Initialize the Database

The database is automatically initialized on first run. No manual migration needed.

```bash
# Backend will create backend/data/portfolio.db on startup
npm run dev
```

---

## Local Development

### Start Backend Server

```bash
cd backend
npm run dev
```

Server runs on `http://localhost:3000` by default.

### Start Frontend Dev Server

```bash
cd frontend
npm run dev
```

Frontend runs on `http://localhost:5173` by default.

> **Note:** Frontend is configured to proxy API calls to `http://localhost:3000` via Vite's dev server.

---

## Docker Deployment

### Build & Run with Docker Compose

```bash
docker-compose up -d
```

This starts both backend (port 3000) and frontend (port 5173) in containers.

#### Environment Variables for Docker

Create a `.env` file in the project root:

```env
# SnapTrade credentials
SNAPTRADE_CLIENT_ID_1=your_key_1_id
SNAPTRADE_CONSUMER_KEY_1=your_key_1_secret

SNAPTRADE_CLIENT_ID_2=your_key_2_id
SNAPTRADE_CONSUMER_KEY_2=your_key_2_secret

# (Optional) Key 3
SNAPTRADE_CLIENT_ID_3=your_key_3_id
SNAPTRADE_CONSUMER_KEY_3=your_key_3_secret

# Backend
NODE_ENV=production
PORT=3000
```

The docker-compose file automatically passes these to both services.

---

## Configuration

### First-Time Setup

1. **Access the app** at `http://localhost:5173`
2. **Navigate to Settings** (gear icon in top-right)
3. **Add SnapTrade Key** (if not auto-detected from env):
   - Enter Client ID and Consumer Key
   - System auto-registers user and syncs existing connections
4. **Link brokerage accounts**:
   - Click "Connect Brokerage" for the key
   - Select your brokerage (TD, RBC, CIBC, Wealthsimple, etc.)
   - Complete OAuth flow to authorize access
5. **Assign accounts to family members**:
   - Select accounts under "Account Management"
   - Assign each account a person name and account type (TFSA/RRSP/Margin)

### Add Additional Keys

1. **Settings → SnapTrade Keys Management**
2. **Click "Add New Key"** (if < 3 keys)
3. Enter Client ID and Consumer Key for the new account
4. Click "Register" — system auto-syncs existing connections for that key
5. Connect new brokerage accounts as needed

### Rename Brokerage Connections

1. **Settings → Connections**
2. **Click Edit next to a connection** (e.g., "TD Webbroker")
3. **Enter custom name** (e.g., "Mom's TD Account")
4. **Click Save**

All account selectors across the app will reflect the new name.

---

## API Endpoints

All endpoints return JSON and are prefixed with `/api`.

### SnapTrade Key Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/snaptrade-keys` | List all configured keys |
| POST | `/snaptrade-keys` | Add new key (1-3) |
| DELETE | `/snaptrade-keys/:keyIndex` | Remove key and cascade-delete connections |

### Connections

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/connections` | List connections grouped by key |
| PATCH | `/connections/:id` | Rename a connection |
| POST | `/connections/:keyIndex/oauth` | Initiate OAuth for a key |
| DELETE | `/connections/:id` | Delete a connection |

### Accounts

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/accounts?grouped=true` | Get accounts grouped by key/brokerage |
| GET | `/accounts` | Get flat list of all accounts |
| POST | `/brokerage-accounts/select` | Assign accounts to people |

### Orders

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/orders` | Get all orders (pending & filled) |
| POST | `/orders` | Place new order |
| GET | `/orders/:orderId` | Get order details |

### Holdings & Positions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/positions` | Get all positions across accounts |
| GET | `/positions/:accountId` | Get positions in specific account |

### Portfolio & Metrics

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/portfolio` | Get total portfolio metrics |
| GET | `/portfolio/performance` | Get historical performance data |

### Market Data

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/quote/:symbol` | Get live quote for symbol |
| GET | `/fx-rate` | Get current USD/CAD rate |

### Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/settings` | Get all settings |
| POST | `/settings` | Update settings |

---

## Project Structure

```
CentralFolio/
├── backend/
│   ├── server.js                 # Express app, multi-key initialization
│   ├── db.js                     # SQLite wrapper, multi-key schema
│   ├── fx.js                     # FX rate fetching & caching
│   ├── configManager.js          # Env parsing (single & multi-key)
│   ├── cryptoUtils.js            # AES-256-GCM encryption
│   ├── snaptrade.js              # SnapTrade API client wrapper
│   ├── services/
│   │   ├── keyInitializer.js     # Multi-key initialization & sync
│   │   ├── syncService.js        # Account sync across keys
│   │   ├── cache.js              # Portfolio cache manager
│   │   └── snaptradeClient.js    # SnapTrade API client
│   ├── routes/
│   │   ├── accounts.js           # Account endpoints (grouped & flat)
│   │   ├── snaptrade-keys.js     # Key management endpoints
│   │   ├── connections.js        # Connection management endpoints
│   │   ├── orders.js             # Order placement endpoints
│   │   ├── transactions.js       # Transaction history
│   │   └── settings.js           # Settings endpoints
│   ├── workers/
│   │   ├── automationWorker.js   # DRIP automation
│   │   ├── cacheWorker.js        # Portfolio cache warmup
│   │   └── schedulerWorker.js    # Scheduled tasks
│   ├── data/
│   │   └── portfolio.db          # SQLite database (auto-created)
│   └── tests/                    # Diagnostic scripts
│
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Overview.jsx      # Dashboard & metrics
│   │   │   ├── Trade.jsx         # Chart & order ticket
│   │   │   ├── Holdings.jsx      # Multi-currency holdings table
│   │   │   ├── Orders.jsx        # Order history & pending
│   │   │   ├── Dividends.jsx     # Income tracking & analytics
│   │   │   ├── Performance.jsx   # Portfolio benchmarks
│   │   │   └── Settings.jsx      # Multi-key & connection management
│   │   ├── components/
│   │   │   ├── AccountSelector.jsx   # Hierarchical account dropdown
│   │   │   ├── AccountGrid.jsx       # Account cards
│   │   │   ├── HoldingsTable.jsx     # Multi-currency table
│   │   │   ├── PriceChart.jsx        # TradingView chart
│   │   │   ├── Charts.jsx            # Recharts visualizations
│   │   │   ├── Layout.jsx            # Sidebar nav & theme
│   │   │   └── ErrorBoundary.jsx     # Error handling
│   │   ├── utils/
│   │   │   ├── currency.js      # FX conversion utilities
│   │   │   └── format.js        # Number/date formatters
│   │   └── App.jsx
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
│
├── user_data/
│   └── mock_data/               # CSV files for mock mode
│
├── docker-compose.yml
├── .env.example
├── project.md                    # Project specification
└── README.md                     # This file
```

---

## Development Guide

### Adding a New Page

1. Create component in `frontend/src/pages/YourPage.jsx`
2. Add route in `frontend/src/App.jsx`:
   ```javascript
   import YourPage from './pages/YourPage';
   
   <Route path="/yourpage" element={<YourPage />} />
   ```
3. Add navigation link in `Layout.jsx`

### Adding an API Endpoint

1. Create route file in `backend/routes/yourroute.js`:
   ```javascript
   const express = require('express');
   const router = express.Router();
   
   router.get('/', (req, res) => {
     // Your logic
   });
   
   module.exports = router;
   ```
2. Mount in `backend/server.js`:
   ```javascript
   app.use('/api/yourroute', require('./routes/yourroute'));
   ```

### Working with Multi-Key Accounts

When adding features that interact with accounts:

1. **Fetch accounts grouped**: `GET /api/accounts?grouped=true`
2. **Account objects include snaptrade_key_id** for filtering per key
3. **When syncing**, iterate over active keys using `db.getActiveSnapTradeKeys()`
4. **When deleting**, cascade via `db.removeSnapTradeKey(keyIndex)`

### Mock Mode

For development without live SnapTrade credentials:

1. Set `MOCK_MODE=true` in `.env` (backend only)
2. Place CSV files in `user_data/mock_data/` with columns:
   - `person,accountId,symbol,shares,price,currency`
3. Backend loads data on startup; frontend uses mocked portfolio

---

## Troubleshooting

### Issue: "Invalid SnapTrade credentials"

**Solution:**
1. Verify Client ID and Consumer Key are correct in `.env`
2. Ensure credentials correspond to the same SnapTrade developer account
3. Check that account hasn't been suspended or API access disabled

### Issue: OAuth fails with "Invalid redirect URI"

**Solution:**
1. In SnapTrade dashboard, verify redirect URI is set to `http://localhost:3000/oauth/callback` (or your deployment URL)
2. Ensure HTTPS for production (change to `https://yourdomain.com/oauth/callback`)

### Issue: "Brokerage connection not found"

**Solution:**
1. Ensure the brokerage account has been linked via OAuth first
2. Check `connections` table in database to verify authorization was saved
3. Try re-running brokerage authorization flow from Settings

### Issue: FX rate not updating

**Solution:**
1. Check backend logs for Bank of Canada API errors
2. System falls back to 1.40 if Bank of Canada is unavailable
3. Verify internet connectivity from backend container/server

---

## Contributing

This is a personal/family project. For local customizations:

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make changes and test locally
3. Commit with descriptive messages
4. Push and create a pull request

---

## Security Notes

- **No authentication layer** — designed for personal/family use only on private networks
- **Secrets encrypted** — userSecret stored with AES-256-GCM in SQLite
- **HMAC signing** — all SnapTrade requests signed server-side (consumer key never exposed to frontend)
- **No public deployment** — do not expose this to the internet without adding authentication
- For production/internet exposure, add:
  - OAuth2 / SSO authentication layer
  - HTTPS with valid certificates
  - Rate limiting
  - Input validation & sanitization
  - CORS configuration

---

## License

MIT License — see LICENSE file for details.

---

## Support & Feedback

For issues, feature requests, or feedback:

1. Check existing GitHub issues
2. Open a new issue with:
   - Description of problem/feature
   - Steps to reproduce (if applicable)
   - Environment (Node version, OS, Docker/local, etc.)
   - Relevant logs or error messages

---

## Roadmap

**Planned Features:**
- Dividend income projections with tax calculations
- Portfolio performance analytics & benchmarking
- Automated DRIP (dividend reinvestment) execution
- Mobile-responsive design
- Per-person read-only share links
- Real-time WebSocket updates for positions
- Advanced order types (stop-loss, trailing stop)
- Tax-lot tracking & reporting

---

**Built with ❤️ for family financial management.**
