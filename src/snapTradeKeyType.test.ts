import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  keyTypeOf, isPersonalKey, isPortfolioConnected, notConnectedReason,
} from './utils/snapTradeKeyType.js';

/**
 * SnapTrade issues two kinds of key, and the difference is not cosmetic: a
 * personal key has no userSecret and cannot register a user at all. This app
 * used "has a userSecret" as its test for whether a connection was usable,
 * which rejects every personal-key connection before it does anything.
 */

const commercial = { keyType: 'commercial', clientId: 'c', consumerKey: 'k', userSecret: 's' };
const personal = { keyType: 'personal', clientId: 'c', consumerKey: 'k' };

test('the key type defaults to commercial, which is what every existing install is', () => {
  assert.equal(keyTypeOf({}), 'commercial');
  assert.equal(keyTypeOf(null), 'commercial');
  assert.equal(keyTypeOf({ keyType: null }), 'commercial');
  assert.equal(keyTypeOf({ keyType: '' }), 'commercial');
});

test('an unrecognised key type is treated as commercial, not as personal', () => {
  // Erring towards personal would skip registration and silently leave a
  // commercial connection unusable.
  assert.equal(keyTypeOf({ keyType: 'enterprise' }), 'commercial');
  assert.equal(isPersonalKey({ keyType: 'enterprise' }), false);
});

test('the key type is read case- and whitespace-insensitively', () => {
  assert.equal(keyTypeOf({ keyType: ' Personal ' }), 'personal');
  assert.equal(keyTypeOf({ keyType: 'PERSONAL' }), 'personal');
});

test('a commercial connection is usable only once it has a user secret', () => {
  assert.equal(isPortfolioConnected(commercial), true);
  assert.equal(isPortfolioConnected({ ...commercial, userSecret: undefined }), false);
});

test('a personal connection is usable without a user secret', () => {
  // This is the whole point: there is no registration step to complete.
  assert.equal(isPortfolioConnected(personal), true);
  assert.equal(isPortfolioConnected({ ...personal, userSecret: undefined }), true);
});

test('neither kind is usable without credentials', () => {
  assert.equal(isPortfolioConnected({ keyType: 'personal' }), false);
  assert.equal(isPortfolioConnected({ keyType: 'commercial', userSecret: 's' }), false);
  assert.equal(isPortfolioConnected({ ...personal, consumerKey: '' }), false);
  assert.equal(isPortfolioConnected(null), false);
});

test('the reason given for an unusable connection matches its key type', () => {
  assert.match(notConnectedReason(commercial), /not registered/);
  assert.match(notConnectedReason(personal), /credentials/);
  assert.ok(!/registered/.test(notConnectedReason(personal)), 'personal keys never register');
});
