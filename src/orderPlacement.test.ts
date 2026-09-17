import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrderForm } from './services/orderPlacement.js';

test('a cash-amount order sends notional_value as a bare number', () => {
  // The regression this guards: it was sent as { amount, currency }, which
  // SnapTrade's NotionalValue (number | string) rejects — so every
  // cash-amount order, single or bucket, failed at the broker.
  const form = buildOrderForm({
    accountId: 'acc-1', symbol: 'AAPL', action: 'BUY',
    orderType: 'Market', notionalValue: 50,
  });
  assert.equal(form.notional_value, 50);
  assert.equal(typeof form.notional_value, 'number');
});

test('a cash-amount order nulls units, and vice versa', () => {
  const notional = buildOrderForm({
    accountId: 'a', symbol: 'AAPL', action: 'BUY', orderType: 'Market', notionalValue: 50,
  });
  assert.equal(notional.units, null, 'units must be null when notional_value is set');

  const units = buildOrderForm({
    accountId: 'a', symbol: 'AAPL', action: 'BUY', orderType: 'Market', units: 3,
  });
  assert.equal(units.units, 3);
  assert.equal(units.notional_value, null, 'notional_value must be null when units is set');
});

test('a cash-amount order is pinned to Market/Day whatever the caller passes', () => {
  const form = buildOrderForm({
    accountId: 'a', symbol: 'AAPL', action: 'BUY',
    orderType: 'Market', notionalValue: 50, timeInForce: 'GTC',
  });
  assert.equal(form.time_in_force, 'Day');
});

test('a share order keeps its time in force', () => {
  const form = buildOrderForm({
    accountId: 'a', symbol: 'AAPL', action: 'BUY', orderType: 'Market', units: 3, timeInForce: 'GTC',
  });
  assert.equal(form.time_in_force, 'GTC');
  assert.equal(buildOrderForm({
    accountId: 'a', symbol: 'AAPL', action: 'BUY', orderType: 'Market', units: 3,
  }).time_in_force, 'Day', 'defaults to Day');
});

test('price rides along only on a Limit order', () => {
  const limit = buildOrderForm({
    accountId: 'a', symbol: 'AAPL', action: 'BUY', orderType: 'Limit', units: 3, price: 240.5,
  });
  assert.equal(limit.price, 240.5);
  const market = buildOrderForm({
    accountId: 'a', symbol: 'AAPL', action: 'BUY', orderType: 'Market', units: 3, price: 240.5,
  });
  assert.equal('price' in market, false, 'a Market order carries no price');
});

test('symbol is trimmed and universal_symbol_id stays null', () => {
  const form = buildOrderForm({
    accountId: 'a', symbol: '  ENB.TO ', action: 'SELL', orderType: 'Market', units: 1,
  });
  assert.equal(form.symbol, 'ENB.TO');
  assert.equal(form.universal_symbol_id, null, 'the API rejects a form carrying both');
});
