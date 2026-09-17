import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactUrl } from './utils/logger.js';

/**
 * Outbound SnapTrade calls are logged, and the SDK puts credentials in the
 * query string of every one of them. A URL is not safe to log just because
 * this app is the caller, so redaction is what makes that logging safe.
 */

test('the SnapTrade query credentials are redacted', () => {
  const url = 'https://api.snaptrade.com/trade/place?clientId=acme&userId=u1&userSecret=s3cr3t&timestamp=1700';
  const out = redactUrl(url);
  assert.ok(!out.includes('s3cr3t'), 'userSecret must never reach the log');
  assert.ok(!out.includes('acme'), 'clientId must never reach the log');
  assert.match(out, /userSecret=\[redacted\]/);
  assert.match(out, /clientId=\[redacted\]/);
});

test('the SSE token is redacted', () => {
  assert.match(redactUrl('/api/events?token=abc123'), /token=\[redacted\]/);
  assert.ok(!redactUrl('/api/events?token=abc123').includes('abc123'));
});

test('redaction is case-insensitive and handles any position', () => {
  const out = redactUrl('/x?a=1&USERSECRET=abc&b=2&Password=hunter2');
  assert.ok(!out.includes('abc'));
  assert.ok(!out.includes('hunter2'));
});

test('non-secret parts of the URL survive, so the log stays useful', () => {
  const out = redactUrl('https://api.snaptrade.com/accounts/acc-1/orders?userSecret=s&state=open');
  assert.match(out, /accounts\/acc-1\/orders/, 'the path is what makes the line worth logging');
  assert.match(out, /state=open/);
});

test('a URL with no secrets is left alone', () => {
  const url = '/api/holdings/1/acc-1?forceRefresh=true';
  assert.equal(redactUrl(url), url);
});
