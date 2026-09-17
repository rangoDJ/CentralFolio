import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountDisplayName, accountClassifyText } from './utils/accountName.js';

test('accountDisplayName prefers a custom name over the broker label', () => {
  assert.equal(accountDisplayName({ customName: 'Retirement', name: 'TFSA 1234' }), 'Retirement');
});

test('accountDisplayName falls back to the broker label, then the fallback', () => {
  assert.equal(accountDisplayName({ customName: null, name: 'TFSA 1234' }), 'TFSA 1234');
  assert.equal(accountDisplayName({ customName: '  ', name: '' }), 'Account');
  assert.equal(accountDisplayName(null, 'Unnamed Account'), 'Unnamed Account');
});

test('accountClassifyText includes the custom name so renames still classify', () => {
  const text = accountClassifyText({ type: null, customName: 'TFSA — long term', name: 'Account 9' });
  assert.ok(text.includes('TFSA'));
  assert.ok(text.includes('Account 9'));
});
