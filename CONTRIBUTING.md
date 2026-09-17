# Contributing to CentralFolio

Thanks for taking an interest. This is a self-hosted app that connects to real brokerage accounts and can place real orders, so a bug here costs money rather than pixels. That shapes most of the guidance below.

## Running from source

Requires **Node 22** (the version CI runs) and nothing else — the database is SQLite, created on first start.

```bash
npm ci
npm start            # http://localhost:3000
```

`npm start` runs the TypeScript directly through `tsx`; there is no build step for development. State lives in `snaptrade.db` beside the repo root unless `DATA_DIR` says otherwise:

```bash
DATA_DIR=./scratch npm start
```

Use a separate `DATA_DIR` for anything experimental. The default one holds your SnapTrade keys, your password hash and the JWT secret.

| Command | What it does |
|---|---|
| `npm start` | Run the server |
| `npm test` | Run every test |
| `npm run typecheck` | `tsc --noEmit` |

## What CI checks

`.github/workflows/ci.yml` is the only workflow, so a push produces one run with three jobs:

| Job | Runs on | What it does |
|---|---|---|
| `typecheck-and-test` | everything | `npm run typecheck` and `npm test` |
| `docker` | branch pushes | Builds and publishes the image to ghcr.io |
| `android` | branch pushes and `v*` tags | Builds the APK, and attaches it to the release on a tag |

Both publish jobs `need` the test job, so a failing suite stops the image and the APK. They run in parallel with each other.

Run the checks locally before opening a pull request — they take a few seconds and catch nearly everything:

```bash
npm run typecheck
npm test
```

A merge to `main` publishes a Docker image, so `main` should stay releasable.

## Layout

```
src/
  routes/        Express routers — URL shapes only
  controllers/   Request handling: validate, call a service, shape the response
  services/      The actual logic. Most things worth testing live here
  repositories/  SQL. Prepared statements, one module per table group
  schemas/       Zod request validation
  models/        Database connection and the migration list
  middleware/    auth, rate limiting, body validation
  utils/         Small shared helpers
public/
  js/            The frontend: plain scripts, no build step, no framework
  css/style.css  One stylesheet
  index.html     One page
```

The frontend is deliberately unbuilt: `format.js` (pure helpers), `divmath.js` (calculations), `api.js` (fetch wrappers), `ui.js` (rendering), `app.js` (state and event handling), loaded in that order by `index.html`. `format.js` and `divmath.js` are written to be importable by tests as well as by the browser.

## Database changes

Schema changes go in the `migrations` array in `src/models/database.ts` as a new entry with a name that has never been used. They are applied in order and recorded in `schema_migrations`, so **never edit an existing migration** — it will not re-run on a database that already has it.

SQLite cannot drop or alter a column in place, so those changes rebuild the table. If the table is referenced by a foreign key, turn foreign keys off for the rebuild: `DROP TABLE` on a parent performs an implicit delete of its rows, which cascades and silently empties the child. `buy_buckets.drop_cashValue` is the worked example, and `src/bucketMigration.test.ts` shows how to prove the data survived — build a database at the old schema, let the migration run, then assert the rows are still there.

## Testing

Tests are `*.test.ts` files under `src/`, using the Node built-in test runner. No framework to learn:

```bash
npm test                                          # everything
node --import tsx --test src/bucketAllocation.test.ts   # one file
```

Anything touching the database sets its own `DATA_DIR` to a temporary directory **before importing the modules under test**, so a test run never reads or writes real data:

```ts
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'my-feature-'));
const { db } = await import('./models/database.js');
```

Frontend code is tested too, by loading the real shipped file into a `vm` context with a small DOM stub — `src/format.test.ts` for the pure helpers, `src/frontendOrderUi.test.ts` for rendering and event logic. This catches the things a typecheck cannot: a table body that stops matching its header, a popup that posts the wrong shape. If you change `public/js`, add to those rather than testing by hand.

### What deserves a test

Money and correctness, above all. The allocation maths, the tax rules, anything that decides how much of something to buy or sell. If getting it wrong would place a wrong order or misreport a gain, it needs a test.

When you fix a bug, the test should fail without the fix. The comment on it should say what went wrong, not just what is asserted — see the `notional_value` test in `src/orderPlacement.test.ts` for the shape of that.

## Working with the brokerage API

Everything that places an order goes through `src/services/orderPlacement.ts`. Add to it rather than building a payload somewhere else; two code paths constructing their own is how `notional_value` came to be sent as `{ amount, currency }` when SnapTrade wants a bare number, and every cash-amount order failed at the broker.

**Do not cast the SnapTrade client to `any`.** The bug above survived precisely because the call was made through `(client as any)`, so the compiler never saw the wrong shape. The SDK's types are good; let them do their job.

Orders are staged and confirmed as two separate requests, with a single-use, TTL-bound token in between, so a live order is never the result of one request. Keep that property. The confirming request should act on a plan recomputed on the server, never on order details supplied by the client.

Funding decisions read a balance fetched live (`refreshAccountBalances`), never the cache, and a balance that cannot be verified is not treated as sufficient. If you add a path that spends money, it does the same.

## Style

Match the file you are in. Beyond that:

- Comments explain **why**, not what. A comment restating the code is worse than none; a comment explaining a non-obvious constraint is worth several.
- Validate request bodies with a Zod schema in `src/schemas/`, wired up with `validateBody` in the route. Controllers should not hand-roll checks.
- Keep SQL in `src/repositories/` as prepared statements at module level.
- Resolve an account's display name with `accountDisplayName` (server) or `accountLabel` (browser). A user's custom name wins everywhere, and there is one rule for it rather than fifteen.
- User-facing errors say what happened and what to do. `"Margin has 120.00 CAD in cash but the bucket needs 250.00 — short by 130.00."` beats `"Insufficient funds"`.

## Pull requests

- Say what changed and why. If it changes behaviour around orders or money, say what you did to convince yourself it is right.
- Note anything you could not verify. Some paths need live brokerage credentials and cannot be exercised in CI; saying so is better than implying coverage that is not there.
- Keep unrelated changes out. A drive-by reformat buries the part that matters.

## Security

Never commit `snaptrade.db` (or its `-wal`/`-shm` sidecars), `user-credentials.json`, or `.env`. They hold API keys, the password hash and the JWT secret.

Do not log secrets, tokens or full account numbers. If you find a security problem, please report it privately to the maintainer rather than opening a public issue.
