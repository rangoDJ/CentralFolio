import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// Load the actual shipped public/js/format.js so the test covers the real code.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const code = readFileSync(path.join(root, 'public', 'js', 'format.js'), 'utf8');
const sandbox: any = { module: { exports: {} } };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const { sanitize, accountLabel } = sandbox.module.exports as {
  sanitize: (s: unknown) => string;
  accountLabel: (a: unknown, fallback?: string) => string;
};

test('sanitize escapes all HTML-significant characters', () => {
  assert.equal(
    sanitize(`<script>alert("x" & 'y')</script>`),
    '&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;'
  );
});

test('sanitize returns empty string for null/undefined', () => {
  assert.equal(sanitize(null), '');
  assert.equal(sanitize(undefined), '');
});

test('sanitize coerces non-strings', () => {
  assert.equal(sanitize(42), '42');
});

test('sanitize leaves safe text untouched', () => {
  assert.equal(sanitize('VFV.TO Vanguard'), 'VFV.TO Vanguard');
});

test('accountLabel prefers the server-resolved display name', () => {
  assert.equal(
    accountLabel({ displayName: 'Retirement', customName: 'Retirement', name: 'TFSA 1234' }),
    'Retirement'
  );
});

test('accountLabel falls back through customName, accountName, then the broker name', () => {
  assert.equal(accountLabel({ customName: 'Retirement', name: 'TFSA 1234' }), 'Retirement');
  assert.equal(accountLabel({ accountName: 'Retirement' }), 'Retirement');
  assert.equal(accountLabel({ name: 'TFSA 1234' }), 'TFSA 1234');
});

test('accountLabel ignores blank names', () => {
  assert.equal(accountLabel({ displayName: '   ', customName: '', name: 'TFSA 1234' }), 'TFSA 1234');
});

test('accountLabel uses the fallback when nothing is set', () => {
  assert.equal(accountLabel({}), 'Account');
  assert.equal(accountLabel(null), 'Account');
  assert.equal(accountLabel({}, 'Unnamed Account'), 'Unnamed Account');
  assert.equal(accountLabel({}, ''), '');
});
