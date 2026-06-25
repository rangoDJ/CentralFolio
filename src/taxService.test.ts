import { test } from 'node:test';
import assert from 'node:assert';
import { classifyAccount, sourceCountry, withholdingRate } from './services/taxRules.js';

test('classifyAccount: registration types', () => {
  assert.equal(classifyAccount('JD WS RRSP SELF DIRECTED'), 'rrsp');
  assert.equal(classifyAccount('JD WS TFSA SELF DIRECTED'), 'tfsa');
  assert.equal(classifyAccount('JD WS MARGIN'), 'taxable');
  assert.equal(classifyAccount('Cash'), 'taxable');
  assert.equal(classifyAccount('RRIF'), 'rrsp');
  assert.equal(classifyAccount('FHSA'), 'tfsa');
});

test('sourceCountry: from profile, else exchange suffix', () => {
  assert.equal(sourceCountry('ENB.TO', 'Canada'), 'Canada');
  assert.equal(sourceCountry('AAPL', 'United States'), 'United States');
  assert.equal(sourceCountry('BMW.DE', 'Germany'), 'Other');
  assert.equal(sourceCountry('SHOP.TO', null), 'Canada');   // suffix fallback
  assert.equal(sourceCountry('MSFT', null), 'United States'); // bare → US
});

test('withholdingRate: US dividends exempt only in RRSP', () => {
  assert.equal(withholdingRate('rrsp', 'United States'), 0);
  assert.equal(withholdingRate('tfsa', 'United States'), 0.15);
  assert.equal(withholdingRate('taxable', 'United States'), 0.15);
});

test('withholdingRate: Canadian dividends never withheld', () => {
  assert.equal(withholdingRate('rrsp', 'Canada'), 0);
  assert.equal(withholdingRate('tfsa', 'Canada'), 0);
  assert.equal(withholdingRate('taxable', 'Canada'), 0);
});

test('withholdingRate: other foreign withheld in all accounts', () => {
  assert.equal(withholdingRate('rrsp', 'Other'), 0.15);
  assert.equal(withholdingRate('tfsa', 'Other'), 0.15);
});
