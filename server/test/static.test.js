/* Static-server hardening: the backend, secrets, and configs must be
   unreachable over HTTP in production (Render serves everything from one
   process). */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { serveStatic } = require('../lib/httpx');

const ROOT = path.resolve(__dirname, '..', '..');

class Res {
  constructor() { this.status = null; this.body = null; }
  writeHead(s) { this.status = s; }
  end(b) { this.body = b; }
}

const serve = (urlPath) => { const res = new Res(); const handled = serveStatic(ROOT, urlPath, res); return { handled, res }; };

test('serves the frontend files', () => {
  for (const p of ['/', '/index.html', '/app.js', '/api.js', '/styles.css', '/theme.css', '/manifest.json', '/sw.js']) {
    const { handled, res } = serve(p);
    assert.strictEqual(handled, true, `${p} should be served`);
    assert.strictEqual(res.status, 200, `${p} should be 200`);
  }
});

test('refuses backend, secrets, and config files', () => {
  for (const p of [
    '/server/index.js', '/server/lib/auth.js', '/server/seed.js',
    '/.data/jwt-secret', '/.gitignore', '/.claude/launch.json',
    '/package.json', '/render.yaml', '/scripts/dev.sh',
    '/%2e%64%61%74%61/jwt-secret', '/server%2Findex.js',
  ]) {
    const { handled } = serve(p);
    assert.strictEqual(handled, false, `${p} must not be served`);
  }
});

test('path traversal is blocked', () => {
  for (const p of ['/../etc/passwd', '/..%2f..%2fetc/passwd', '/styles.css/../../../../etc/hosts']) {
    const { handled, res } = serve(p);
    assert.ok(!handled || res.status === 403, `${p} must not escape the root`);
  }
});
