# snaptrade-app

Tiny scratchpad for talking to the SnapTrade API. Phase 1 only does:

1. **Register** a SnapTrade end-user (you) and save the returned `userSecret`.
2. **Login** — generate a single-use Connection Portal URL pre-targeted at
   Wealthsimple so you can link the brokerage in your browser.
3. **List users** — verify the registration round-tripped to SnapTrade.

Brokerage data fetching (accounts, holdings, balances) comes in a later phase.

## Setup

```bash
cd snaptrade-app
npm install
```

Credentials live in `.env` (already created, gitignored). It has three fields:

- `SNAPTRADE_CLIENT_ID` — partner clientId from the SnapTrade dashboard
- `SNAPTRADE_CONSUMER_KEY` — partner consumer key (treat like a password)
- `SNAPTRADE_USER_ID` — any stable string you pick to identify yourself

## Run

```bash
npm run register     # one-time; writes user-credentials.json
npm run list-users   # sanity check; should show your userId
npm run login        # prints a Connection Portal URL — open in browser
```

After `register`, **do not delete `user-credentials.json`** — the `userSecret`
inside it is shown once and required for every subsequent SnapTrade call for
this user. If you lose it you'll have to delete the user at SnapTrade and
re-register.

## File layout

```
snaptrade-app/
├── .env                  # real credentials (gitignored)
├── .env.example          # template
├── src/
│   ├── client.ts         # shared Snaptrade SDK instance + env loading
│   ├── register.ts       # npm run register
│   ├── login.ts          # npm run login
│   └── list-users.ts     # npm run list-users
└── user-credentials.json # written by register, gitignored
```
