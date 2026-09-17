import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

/**
 * The order-entry and bucket UI, exercised against the real shipped
 * public/js files under a minimal DOM stub.
 *
 * Same approach as format.test.ts, but for the parts that place orders. These
 * are the regressions that a typecheck cannot catch: a column count that stops
 * matching its header, a popup that posts the wrong shape, a cash field that
 * reappears where it was removed.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

class StubElement {
  style: any = {};
  className = '';
  value = '';
  checked = false;
  required = false;
  disabled = false;
  dataset: any = {};
  classList = { add() {}, remove() {}, contains() { return false; } };
  private text = '';
  private html = '';
  get textContent() { return this.text; }
  set textContent(v: string) { this.text = String(v); }
  get innerHTML() { return this.html; }
  set innerHTML(v: string) { this.html = v; }
  focus() {}
  addEventListener() {}
}

/** A fresh sandbox per test, so state never leaks between them. */
function loadFrontend() {
  const elements = new Map<string, StubElement>();
  const byId = (id: string) => {
    if (!elements.has(id)) elements.set(id, new StubElement());
    return elements.get(id)!;
  };

  const sandbox: any = {
    module: { exports: {} },
    console,
    setTimeout: () => {},
    clearTimeout: () => {},
    document: { getElementById: byId, addEventListener() {}, querySelectorAll: () => [], querySelector: () => null },
    window: {},
    localStorage: { getItem: () => null, setItem() {} },
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  vm.runInContext(read('public/js/format.js'), sandbox);
  sandbox.sanitize = sandbox.module.exports.sanitize;
  sandbox.accountLabel = sandbox.module.exports.accountLabel;
  // UI and App are `const` at the top level of their files, which does not
  // become a context property on its own.
  vm.runInContext(read('public/js/ui.js') + '\n;globalThis.UI=UI;', sandbox);
  vm.runInContext(read('public/js/app.js') + '\n;globalThis.App=App;', sandbox);

  return { UI: sandbox.UI, App: sandbox.App, byId, sandbox };
}

const lot = (accountId: string, accountName: string, tradingEnabled: boolean) => ({
  accountId, portfolioId: '1', accountName, tradingEnabled,
  units: 10, price: 50, symbolId: 'sym1', description: 'Enbridge',
});
const holding = (lots: any[]) => ({
  symbol: 'ENB.TO', description: 'Enbridge', symbolId: 'sym1', price: 50, currency: 'CAD',
  shares: 10, cost: 400, value: 500, avgCost: 40, profit: 100, profitPct: 25,
  annualDiv: 0, annualPerShare: 0, yieldCur: 0, yieldCost: 0, lots,
});

// ── Buy/Sell in the row, not behind a menu ──────────────────────────────────

test('buy and sell render inline, with no menu to open first', () => {
  const { UI } = loadFrontend();
  const html = UI.renderHoldingActions(holding([lot('a', 'Retirement', true)]));
  assert.ok(!/<details/.test(html), 'no disclosure element');
  assert.match(html, /trade-btn-buy/);
  assert.match(html, /trade-btn-sell/);
});

test('each tradable account gets its own labelled pair', () => {
  const { UI } = loadFrontend();
  const one = UI.renderHoldingActions(holding([lot('a', 'Retirement', true)]));
  assert.ok(!/hb-actions-acct/.test(one), 'a single account needs no label');

  const two = UI.renderHoldingActions(holding([lot('a', 'Retirement', true), lot('b', 'Margin', true)]));
  assert.equal((two.match(/trade-btn-buy/g) || []).length, 2);
  assert.match(two, /Retirement/);
  assert.match(two, /Margin/);
});

test('the buttons carry the account name for the popup to show', () => {
  const { UI } = loadFrontend();
  const html = UI.renderHoldingActions(holding([lot('a', 'Retirement', true)]));
  assert.match(html, /data-account-name="Retirement"/);
});

test('a holding with no tradable account explains itself instead', () => {
  const { UI } = loadFrontend();
  const html = UI.renderHoldingActions(holding([lot('a', 'Retirement', false)]));
  assert.ok(!/trade-btn-buy/.test(html));
  assert.match(html, /hb-actions-off/);
});

// ── The holdings table's own shape ──────────────────────────────────────────

test('the holdings table body matches its header, selection column included', () => {
  const { UI, App, byId } = loadFrontend();
  UI.holdingsRows = [holding([lot('a', 'Retirement', true)])];
  UI.holdingsView = 'holdings';
  UI.holdingsSort = { key: 'value', dir: 'desc' };
  App.selectedHoldingSymbols = new Set();

  UI.renderHoldingsRows();
  const headerCells = (byId('hbHead').innerHTML.match(/<th/g) || []).length;
  const bodyCells = (byId('hbBody').innerHTML.split('</tr>')[0].match(/<td/g) || []).length;
  assert.equal(bodyCells, headerCells, 'a mismatch shifts every column');
  assert.match(byId('hbHead').innerHTML, /hb-select-all/);
  assert.match(byId('hbBody').innerHTML, /class="hb-select"/);

  // The "no matches" row has to span the same width.
  byId('hbSearch').value = 'nothing-matches-this';
  UI.renderHoldingsRows();
  const colspan = Number((byId('hbBody').innerHTML.match(/colspan="(\d+)"/) || [])[1]);
  assert.equal(colspan, headerCells);
});

// ── The order popup ─────────────────────────────────────────────────────────

function openPopup() {
  const loaded = loadFrontend();
  loaded.App.currentGroups = [{
    portfolioId: '1',
    accounts: [{ id: 'a', name: 'TFSA 1234', customName: 'Retirement', displayName: 'Retirement', currency: 'CAD' }],
  }];
  loaded.App.openTradeModal('a', '1', 'ENB.TO', 'sym1', 'Enbridge', 50, 'BUY');
  return loaded;
}

test('the order popup names the account by its custom name', () => {
  const { byId } = openPopup();
  assert.equal(byId('tradeAccountName').textContent, 'Retirement');
  assert.equal(byId('tradeNotionalCurrency').textContent, '(CAD)');
});

test('the popup opens in share mode, with the cash field hidden', () => {
  const { App, byId } = openPopup();
  assert.equal(App.currentTradeMode, 'units');
  assert.equal(byId('tradeUnitsGroup').style.display, 'block');
  assert.equal(byId('tradeNotionalGroup').style.display, 'none');
});

test('cash-amount mode hides order type and time in force', () => {
  const { App, byId } = openPopup();
  App.setTradeMode('notional');
  assert.equal(App.currentTradeMode, 'notional');
  assert.equal(byId('tradeNotionalGroup').style.display, 'block');
  // A cash-amount order is Market/Day by definition, so showing these would
  // offer choices the broker ignores.
  assert.equal(byId('tradeOrderTypeGroup').style.display, 'none');
  assert.equal(byId('tradeTifGroup').style.display, 'none');
});

test('the cash field estimates the share count as you type', () => {
  const { App, byId } = openPopup();
  App.setTradeMode('notional');
  byId('tradeNotional').value = '250';
  App.updateTradeNotionalHint();
  assert.match(byId('tradeNotionalHint').textContent, /5(\.00)? shares/);
});

test('the amount label follows the buy/sell action', () => {
  const { App, byId } = openPopup();
  App.setTradeAction('SELL');
  assert.equal(byId('tradeNotionalLabel').textContent, 'Amount to sell');
  App.setTradeAction('BUY');
  assert.equal(byId('tradeNotionalLabel').textContent, 'Amount to spend');
});

test('a cash-amount order posts notional_value and no units', async () => {
  const { App, byId, sandbox } = openPopup();
  let sent: any = null;
  sandbox.API = { placeTrade: async (p: any) => { sent = p; return { requiresConfirmation: false }; } };
  sandbox.UI.showToast = () => {};

  App.setTradeMode('notional');
  byId('tradeNotional').value = '250';
  await App.submitTrade();

  assert.equal(sent.notional_value, 250);
  assert.equal(sent.units, undefined, 'the two are mutually exclusive');
  assert.equal(sent.orderType, 'Market');
  assert.equal(sent.timeInForce, 'Day');
});

test('a share order posts units and no notional_value', async () => {
  const { App, byId, sandbox } = openPopup();
  let sent: any = null;
  sandbox.API = { placeTrade: async (p: any) => { sent = p; return { requiresConfirmation: false }; } };
  sandbox.UI.showToast = () => {};

  byId('tradeUnits').value = '4';
  await App.submitTrade();

  assert.equal(sent.units, 4);
  assert.equal(sent.notional_value, undefined);
});

// ── Buckets ─────────────────────────────────────────────────────────────────

test('a bucket fixes proportions, not amounts', () => {
  const { UI, byId } = loadFrontend();
  UI.renderBucketItemRows(
    [{ symbol: 'AAPL' }, { symbol: 'MSFT' }, { symbol: 'ENB.TO' }],
    'equal',
  );
  const rows = byId('bucketItems').innerHTML;
  assert.equal((rows.match(/33\.33%/g) || []).length, 3);
  assert.ok(!/\$/.test(rows), 'no cash figures before a run names an amount');
});

test('the bucket card says the amount is chosen per run', () => {
  const { UI, byId } = loadFrontend();
  UI.renderBucketList([{ id: 1, name: 'Core', splitMode: 'equal', items: [{ symbol: 'AAPL' }] }]);
  const card = byId('bucketList').innerHTML;
  assert.match(card, /amount chosen per run/);
  assert.ok(!/\$\d/.test(card), 'a bucket stores no amount to show');
});

test('switching to weighted seeds weights totalling exactly 100', () => {
  const { App } = loadFrontend();
  App.buckets = [];
  App.openBucketModal(null, ['A', 'B', 'C'].map(symbol => ({ symbol, name: null, weight: null })));
  App.setBucketSplitMode('weighted');
  const weights = App.bucketDraft.items.map((i: any) => i.weight);
  // Three even shares round to 99.99 unless the remainder is placed somewhere.
  assert.equal(weights.reduce((a: number, b: number) => a + b, 0), 100);
});

test('the account picker lists only trading-enabled accounts, by custom name', () => {
  const { UI, byId } = loadFrontend();
  UI.renderBucketRunAccounts(
    [
      { portfolioId: 1, portfolioName: 'WS', accounts: [{ id: 'acc-1', name: 'TFSA 9921', displayName: 'Retirement', currency: 'CAD', cashBalance: 900 }] },
      { portfolioId: 2, portfolioName: 'ReadOnly', accounts: [{ id: 'acc-9', name: 'RRSP', displayName: 'RRSP', currency: 'CAD' }] },
    ],
    new Set(), new Set(),
    [{ id: 1, tradingEnabled: true }, { id: 2, tradingEnabled: false }],
  );
  const picker = byId('bucketRunAccounts').innerHTML;
  assert.match(picker, /Retirement/);
  assert.ok(!/RRSP/.test(picker), 'a read-only connection cannot be traded into');
});

test('the run preview states the grand total and any blocking error', () => {
  const { UI, byId } = loadFrontend();
  const order = { symbol: 'AAPL', name: null, weight: 50, amount: 50, belowMinimum: false, price: 10, estimatedShares: 5 };
  UI.renderBucketPreview({
    bucketId: 1, name: 'Core', splitMode: 'equal', cashValue: 250, minNotional: 1,
    accounts: [
      { accountId: 'acc-1', accountName: 'Retirement', currency: 'CAD', cash: 900, total: 250, shortfall: 0, orders: [order] },
      { accountId: 'acc-2', accountName: 'Margin', currency: 'CAD', cash: 120, total: 250, shortfall: 130, orders: [order] },
    ],
    orderCount: 10, grandTotal: 500, belowMinimumCount: 0,
    errors: ['"Margin" has 120.00 CAD in cash but the bucket needs 250.00 — short by 130.00.'],
    warnings: [],
  });
  const preview = byId('bucketRunPreview').innerHTML;
  assert.match(preview, /Grand total/, 'the multiplication is never left to be inferred');
  assert.match(preview, /500\.00/);
  assert.match(preview, /bucket-alert-error/);
  assert.match(preview, /short by 130/);
});

test('a run reports each order, including the ones that failed', () => {
  const { UI, byId } = loadFrontend();
  UI.renderBucketResults({
    placed: 1, total: 2,
    results: [
      { accountName: 'Retirement', symbol: 'AAPL', amount: 50, currency: 'CAD', success: true },
      { accountName: 'Retirement', symbol: 'MSFT', amount: 50, currency: 'CAD', success: false, error: 'symbol not tradable' },
    ],
  });
  const out = byId('bucketRunPreview').innerHTML;
  assert.match(out, /Placed 1 of 2/);
  assert.match(out, /symbol not tradable/);
});

test('a partly failed run offers to retry only what failed', () => {
  const { UI, byId } = loadFrontend();
  UI.renderBucketResults({
    placed: 1, total: 3, retryToken: 'tok-abc',
    results: [
      { accountName: 'Retirement', symbol: 'AAPL', amount: 50, currency: 'CAD', success: true },
      { accountName: 'Retirement', symbol: 'MSFT', amount: 50, currency: 'CAD', success: false, error: 'not tradable' },
      { accountName: 'Retirement', symbol: 'BN.TO', amount: 50, currency: 'CAD', success: false, error: 'not tradable' },
    ],
  });
  const out = byId('bucketRunPreview').innerHTML;
  assert.match(out, /2 orders did not go through/);
  assert.match(out, /retryBucketOrders/);
});

test('a fully successful run offers no retry', () => {
  const { UI, byId } = loadFrontend();
  UI.renderBucketResults({
    placed: 1, total: 1,
    results: [{ accountName: 'Retirement', symbol: 'AAPL', amount: 50, currency: 'CAD', success: true }],
  });
  assert.ok(!/retryBucketOrders/.test(byId('bucketRunPreview').innerHTML));
});

test('the retry button follows the server token, not the page\'s own tally', () => {
  // Without a token the server has nothing held to retry, so offering the
  // button would produce a request that can only fail.
  const { UI, byId } = loadFrontend();
  UI.renderBucketResults({
    placed: 0, total: 1, retryToken: undefined,
    results: [{ accountName: 'Retirement', symbol: 'AAPL', amount: 50, currency: 'CAD', success: false, error: 'expired' }],
  });
  assert.ok(!/retryBucketOrders/.test(byId('bucketRunPreview').innerHTML));
});

test('a retry result is labelled as a retry', () => {
  const { UI, byId } = loadFrontend();
  UI.renderBucketResults({
    placed: 2, total: 2, retried: true,
    results: [
      { accountName: 'Retirement', symbol: 'MSFT', amount: 50, currency: 'CAD', success: true },
      { accountName: 'Retirement', symbol: 'BN.TO', amount: 50, currency: 'CAD', success: true },
    ],
  });
  assert.match(byId('bucketRunPreview').innerHTML, /Retry: placed 2 of 2/);
});

// ── Orders page ─────────────────────────────────────────────────────────────

const orderRow = (over: any = {}) => ({
  brokerageOrderId: 'ord-1', portfolioId: '1', accountId: 'acc-1', accountName: 'Retirement',
  symbol: 'ENB.TO', description: 'Enbridge', action: 'BUY', status: 'EXECUTED',
  orderType: 'Market', timeInForce: 'Day',
  totalQuantity: 10, filledQuantity: 10, openQuantity: 0, canceledQuantity: 0,
  executionPrice: 51.25, limitPrice: null, currency: 'CAD',
  timePlaced: '2026-09-17T14:00:00Z', timeUpdated: null, timeExecuted: null,
  isOpen: false, isFailed: false, cancellable: false, ...over,
});

const ordersResult = (orders: any[], errors: any[] = []) =>
  ({ orders, errors, fetchedAt: '2026-09-17T15:00:00Z' });

test('a filled order shows its execution price, not its limit', () => {
  const { UI, byId } = loadFrontend();
  UI.renderOrders(ordersResult([orderRow({ limitPrice: 50 })]));
  const html = byId('orders-content').innerHTML;
  assert.match(html, /51\.25/, 'the price it actually filled at');
  assert.ok(!/limit/.test(html), 'the requested limit is not what happened');
});

test('an unfilled limit order shows the limit as a request', () => {
  const { UI, byId } = loadFrontend();
  UI.renderOrders(ordersResult([orderRow({
    status: 'ACCEPTED', isOpen: true, executionPrice: null, limitPrice: 50, filledQuantity: 0,
  })]));
  assert.match(byId('orders-content').innerHTML, /limit/);
});

test('a partial fill shows filled against total', () => {
  const { UI, byId } = loadFrontend();
  UI.renderOrders(ordersResult([orderRow({ status: 'PARTIAL', filledQuantity: 4, totalQuantity: 10, isOpen: true })]));
  assert.match(byId('orders-content').innerHTML, /4 \/ 10/);
});

test('Cancel is offered only on a cancellable order', () => {
  const { UI, byId } = loadFrontend();
  UI.renderOrders(ordersResult([orderRow({ status: 'ACCEPTED', isOpen: true, cancellable: true })]));
  assert.match(byId('orders-content').innerHTML, /App\.cancelOrder/);

  UI.renderOrders(ordersResult([orderRow()]));
  assert.ok(!/App\.cancelOrder/.test(byId('orders-content').innerHTML), 'a filled order offers no cancel');
});

test('an account that could not be read is named, so an empty table is not misread', () => {
  const { UI, byId } = loadFrontend();
  UI.renderOrders(ordersResult([], [{ accountId: 'acc-9', accountName: 'Margin', error: 'connection disabled' }]));
  const html = byId('orders-content').innerHTML;
  assert.match(html, /Margin/);
  assert.match(html, /connection disabled/);
});

test('the filters count and narrow the rows', () => {
  const { UI, byId } = loadFrontend();
  UI.ordersFilter = 'all';
  UI.renderOrders(ordersResult([
    orderRow({ brokerageOrderId: 'a', status: 'ACCEPTED', isOpen: true }),
    orderRow({ brokerageOrderId: 'b' }),
    orderRow({ brokerageOrderId: 'c', status: 'REJECTED', isFailed: true }),
  ]));
  assert.equal((byId('orders-content').innerHTML.match(/ord-badge/g) || []).length, 3, 'all three shown');

  UI.setOrdersFilter('open');
  assert.equal((byId('orders-content').innerHTML.match(/ord-badge/g) || []).length, 1, 'only the working one');

  UI.setOrdersFilter('filled');
  assert.equal((byId('orders-content').innerHTML.match(/ord-badge/g) || []).length, 1, 'only the filled one');
  UI.setOrdersFilter('all');
});

test('statuses are shown in plain words, not broker enums', () => {
  const { UI, byId } = loadFrontend();
  UI.ordersFilter = 'all';
  UI.renderOrders(ordersResult([orderRow({ status: 'PARTIAL_CANCELED' })]));
  const html = byId('orders-content').innerHTML;
  assert.match(html, /Part cancelled/);
  assert.ok(!/PARTIAL_CANCELED/.test(html));
});

test('an empty result says so without implying an error', () => {
  const { UI, byId } = loadFrontend();
  UI.ordersFilter = 'all';
  UI.renderOrders(ordersResult([]));
  assert.match(byId('orders-content').innerHTML, /No orders in this period/);
});

test('the holdings selection bar appears only when something is selected', () => {
  const { UI, App, byId } = loadFrontend();
  App.selectedHoldingSymbols = new Set(['AAPL', 'MSFT']);
  UI.updateHoldingSelectionBar(App.selectedHoldingSymbols);
  assert.match(byId('hbSelectionBar').innerHTML, /2 stocks selected/);
  assert.match(byId('hbSelectionBar').innerHTML, /createBucketFromHoldings/);

  UI.updateHoldingSelectionBar(new Set());
  assert.equal(byId('hbSelectionBar').style.display, 'none');
});
