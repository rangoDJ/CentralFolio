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
const { sanitize } = sandbox.module.exports as { sanitize: (s: unknown) => string };

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
