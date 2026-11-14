const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');

test('synthetic preview is marked, isolated from Firebase and read-only', async t => {
  const child = spawn(process.execPath, ['scripts/preview-synthetic.cjs'], {
    cwd: root, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => child.kill());
  const origin = await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error('Synthetic preview startup timed out')), 5000);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Synthetic preview exited: ${code}`)); });
    child.stdout.on('data', data => {
      out += data;
      const match = out.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.match(await page.text(), /DATA SINTETIS/);
  const bridge = await fetch(origin + '/js/firebase.js');
  const source = await bridge.text();
  assert.match(source, /window\.SCSFirebase\s*=/);
  assert.doesNotMatch(source, /https?:\/\/|gstatic|firebaseio|identitytoolkit/);
  assert.equal((await fetch(origin + '/database.rules.json')).status, 404);
  assert.equal((await fetch(origin, { method: 'POST', body: 'x' })).status, 405);
});
