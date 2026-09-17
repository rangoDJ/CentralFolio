import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOrder, sortOrdersNewestFirst } from './services/orderHistoryService.js';

/**
 * Turning a SnapTrade order record into what the Orders page shows.
 *
 * The brokerage call itself needs live credentials, so what is tested here is
 * everything around it — which is where the mistakes would be. Quantities and
 * prices arrive as strings, the symbol is nested, and "can I cancel this" is a
 * judgement this app makes rather than one the broker reports.
 */

const account = { id: 'acc-1', name: 'TFSA', customName: 'Retirement', currency: 'CAD' };

const record = (over: any = {}) => ({
  brokerage_order_id: 'ord-1',
  status: 'EXECUTED',
  action: 'BUY',
  order_type: 'Market',
  time_in_force: 'Day',
  total_quantity: '10',
  filled_quantity: '10',
  open_quantity: '0',
  execution_price: '51.25',
  time_placed: '2026-09-17T14:00:00Z',
  universal_symbol: { symbol: 'ENB.TO', description: 'Enbridge', currency: { code: 'CAD' } },
  ...over,
});

const normalize = (over: any = {}, tradingEnabled = true) =>
  normalizeOrder(record(over), account, '1', tradingEnabled);

test('string quantities and prices become numbers', () => {
  const row = normalize();
  assert.equal(row.totalQuantity, 10);
  assert.equal(row.filledQuantity, 10);
  assert.equal(row.executionPrice, 51.25);
  assert.equal(typeof row.executionPrice, 'number');
});

test('an absent quantity stays null rather than becoming zero', () => {
  // Zero filled and "not reported" mean different things on an open order.
  const row = normalize({ execution_price: null, filled_quantity: '' });
  assert.equal(row.executionPrice, null);
  assert.equal(row.filledQuantity, null);
});

test('the symbol and currency are read out of the nested universal symbol', () => {
  const row = normalize();
  assert.equal(row.symbol, 'ENB.TO');
  assert.equal(row.description, 'Enbridge');
  assert.equal(row.currency, 'CAD');
});

test('a bare symbol string is used when there is no universal symbol', () => {
  const row = normalize({ universal_symbol: null, symbol: 'AAPL' });
  assert.equal(row.symbol, 'AAPL');
});

test('the account is named by its custom name', () => {
  assert.equal(normalize().accountName, 'Retirement');
});

test('a working order is open and cancellable', () => {
  const row = normalize({ status: 'ACCEPTED', filled_quantity: '0', execution_price: null });
  assert.equal(row.isOpen, true);
  assert.equal(row.cancellable, true);
});

test('a filled order is neither open nor cancellable', () => {
  const row = normalize();
  assert.equal(row.isOpen, false);
  assert.equal(row.cancellable, false, 'a filled order has nothing to cancel');
});

test('a rejected order is marked failed, not merely closed', () => {
  const row = normalize({ status: 'REJECTED', filled_quantity: '0' });
  assert.equal(row.isFailed, true);
  assert.equal(row.isOpen, false);
  assert.equal(row.cancellable, false);
});

test('a cancelled order is closed but not a failure', () => {
  const row = normalize({ status: 'CANCELED' });
  assert.equal(row.isFailed, false, 'cancelling was the point');
  assert.equal(row.isOpen, false);
});

test('an order in a read-only connection is never cancellable', () => {
  // Cancelling is a write, so it needs the same permission placing does.
  const row = normalize({ status: 'ACCEPTED' }, false);
  assert.equal(row.isOpen, true);
  assert.equal(row.cancellable, false);
});

test('an order with no brokerage id cannot be cancelled', () => {
  const row = normalize({ status: 'ACCEPTED', brokerage_order_id: null });
  assert.equal(row.cancellable, false, 'there is no id to cancel by');
});

test('a partial fill keeps both the filled and the total quantity', () => {
  const row = normalize({ status: 'PARTIAL', total_quantity: '10', filled_quantity: '4', open_quantity: '6' });
  assert.equal(row.filledQuantity, 4);
  assert.equal(row.totalQuantity, 10);
  assert.equal(row.isOpen, true, 'the unfilled remainder is still working');
});

test('an unknown status is treated as closed rather than assumed cancellable', () => {
  // A status this app has not seen must not offer a Cancel button that would
  // only produce a broker error.
  const row = normalize({ status: 'SOME_FUTURE_STATUS' });
  assert.equal(row.isOpen, false);
  assert.equal(row.cancellable, false);
});

test('a missing status does not throw', () => {
  const row = normalizeOrder({}, account, '1', true);
  assert.equal(row.status, 'NONE');
  assert.equal(row.cancellable, false);
  assert.equal(row.symbol, null);
});

test('orders sort newest first, undated last', () => {
  const rows = [
    normalize({ brokerage_order_id: 'old', time_placed: '2026-09-01T10:00:00Z' }),
    normalize({ brokerage_order_id: 'undated', time_placed: null }),
    normalize({ brokerage_order_id: 'new', time_placed: '2026-09-17T10:00:00Z' }),
  ];
  assert.deepEqual(
    sortOrdersNewestFirst(rows).map(o => o.brokerageOrderId),
    ['new', 'old', 'undated'],
  );
});
