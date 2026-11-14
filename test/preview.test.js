const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('unauthenticated HTML renders the dashboard shell inert and busy without waiting for JavaScript', () => {
  const shell = html.match(/<div\b[^>]*id="appShell"[^>]*>/)?.[0];
  assert.ok(shell);
  assert.doesNotMatch(shell, /\bhidden\b/);
  assert.match(shell, /\binert\b/);
  assert.match(shell, /data-state="loading"/);
  assert.match(shell, /aria-busy="true"/);
  assert.doesNotMatch(html, /session-card|Menyiapkan ruang kendali/);
  for (const id of ['btnAuto', 'btnManual', 'btnSprayOn', 'btnSprayOff']) assert.match(html, new RegExp(`id="${id}"[^>]*disabled`));
  assert.match(html, /<main\b[^>]*id="authPanel"/);
  const login = html.match(/<main\b[^>]*id="authPanel"[^>]*>/)?.[0];
  assert.match(login, /\bhidden\b/);
  assert.match(login, /\binert\b/);
  assert.match(html, /id="sessionPanel"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-busy="true"/);
  assert.match(html, /id="loginEmail"[^>]*type="email"[^>]*autocomplete="username"/);
  assert.match(html, /id="loginPassword"[^>]*type="password"[^>]*autocomplete="current-password"/);
});

test('session restoration waits for Firebase rather than a local login flag', () => {
  const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  const firebase = fs.readFileSync(path.join(root, 'js/firebase.js'), 'utf8');
  assert.match(app, /function setAuthView\(ok, email=''\)\{\s*authResolved=true;/);
  assert.match(app, /\$\('sessionPanel'\)\.hidden=true/);
  assert.match(app, /\$\('authPanel'\)\.inert=ok/);
  assert.match(app, /onAuth: \(ok, email\)=>\{[\s\S]*?setAuthView\(ok, email\)/);
  assert.match(app, /sessionWaitTimer=setTimeout\(sessionFailed,15000\)/);
  assert.match(firebase, /onAuthStateChanged\(auth,/);
  assert.match(firebase, /callbacks\.onAuthError\?\.\(error\)/);
  assert.doesNotMatch(app, /(?:localStorage|sessionStorage)\.(?:getItem|setItem)\(['"](?:loggedIn|authenticated|scs_auth)/);
});

test('redesigned page has unique IDs and retains core control elements', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const id of ['sensorGrid', 'humidityGrid', 'thiValue', 'chartMetric', 'basisTemperature',
    'basisThi', 'srcThreshold', 'srcSchedule', 'schedList', 'btnSaveCfg', 'btnSprayOn', 'btnSprayOff',
    'greetingName', 'accountName', 'accountAvatar', 'sensorDialog', 'btnCloseSensors',
    'btnTemperatureDetails', 'btnHumidityDetails', 'menuBtn', 'sideClose']) {
    assert.ok(ids.includes(id), `missing control: ${id}`);
  }
});

test('overview shows device state and climate metrics before controls and keeps sensor grids inside a closed dialog', () => {
  assert.ok(html.indexOf('class="grid summary-grid"') < html.indexOf('class="grid insights-grid"'));
  assert.ok(html.indexOf('id="sprinklerState"') < html.indexOf('id="btnAuto"'));
  const dialog = html.match(/<dialog\b[^>]*id="sensorDialog"[^>]*>([\s\S]*?)<\/dialog>/);
  assert.ok(dialog);
  assert.doesNotMatch(dialog[0].split('>')[0], /\bopen\b/);
  assert.match(dialog[1], /id="sensorGrid"/);
  assert.match(dialog[1], /id="humidityGrid"/);
  assert.match(dialog[1], /data-sensor-panel="temperature" hidden/);
  assert.match(dialog[1], /data-sensor-panel="humidity" hidden/);
  const main = html.match(/<main\b[^>]*id="mainContent"[^>]*>([\s\S]*?)<\/main>/)?.[1];
  assert.ok(main);
  assert.doesNotMatch(main, /id="(?:sensorGrid|humidityGrid)"/);
  assert.match(main, /id="btnTemperatureDetails"[^>]*data-sensors="temperature"[^>]*aria-haspopup="dialog"/);
  assert.match(main, /id="btnHumidityDetails"[^>]*data-sensors="humidity"[^>]*aria-haspopup="dialog"/);
  assert.doesNotMatch(main, /href="#sensorSection"/);
});

test('sidebar starts closed and inert, with an accessible toggle', () => {
  assert.match(html, /<aside\b[^>]*id="sidebar"[^>]*aria-hidden="true"[^>]*\binert\b/);
  assert.match(html, /id="menuBtn"[^>]*aria-controls="sidebar"[^>]*aria-expanded="false"/);
});

test('overview greets the signed-in account below the brand lockup and keeps the dynamic name', () => {
  const heading = html.match(/<section class="page-heading brand-heading" data-page="dash">([\s\S]*?)<\/section>/)?.[1];
  assert.ok(heading);
  assert.match(heading, /<h1\b[^>]*>Halo, <span id="greetingName">[^<]*<\/span>\.<\/h1>/);
  assert.match(heading, /<p class="welcome">/);
  const top = html.match(/<header class="topbar">[\s\S]*?<\/header>/)?.[0];
  assert.match(top, /COSTMOSYS/);
  assert.ok(html.indexOf('<header class="topbar">') < html.indexOf('id="greetingName"'));
  assert.match(html, /id="clock"/);
});

test('threshold summaries start hidden with no hard-coded default values', () => {
  assert.match(html, /<div data-threshold-basis="temperature" hidden>[^<]* <b id="thresholdLabel">—<\/b>/);
  assert.match(html, /<div class="mini-stats" data-threshold-basis="thi" hidden><div>[^<]* <b id="thiThresholdLabel">—<\/b>/);
});

test('interface ships only the incumbent local illustration and no remote fonts, scripts or stylesheets', () => {
  assert.deepEqual([...html.matchAll(/<img\b[^>]*src="([^"]+)"/g)].map(m => m[1].split('?')[0]), ['assets/farm-scene.svg', 'assets/farm-scene.svg']);
  assert.doesNotMatch(html, /(?:src|href)="https?:\/\//);
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  assert.doesNotMatch(css, /@import|url\(\s*["']?https?:|fonts\.googleapis/);
});

test('dashboard keeps focus ring, reduced motion, snapshot labels and versioned release assets', () => {
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  assert.match(css, /:focus-visible\s*\{\s*outline: 3px solid/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /forced-colors: active/);
  assert.match(html, /Titik terendah/);
  assert.match(html, /Titik tertinggi/);
  assert.match(html, /Min\/maks antar titik · pembacaan terkini/);
  assert.doesNotMatch(html, /Kenali iklimnya|MINDFUL CARE|greeting-leaf/);
  assert.match(html, /Kandang A/);
  for (const url of [...html.matchAll(/(?:src|href)="((?:js|css)\/[^\"]+)"/g)].map(m => m[1])) {
    assert.match(url, /\?v=\d+$/, `unversioned asset: ${url}`);
  }
});

test('headings never skip a level so the outline stays navigable', () => {
  const levels = [...html.matchAll(/<h([1-6])\b/g)].map(m => Number(m[1]));
  assert.equal(levels[0], 1);
  levels.forEach((level, i) => { if (i) assert.ok(level <= levels[i - 1] + 1, `h${levels[i - 1]} followed by h${level}`); });
});

test('Admin has a separate directory, labelled account fields and accessible permission cards', () => {
  assert.match(html, /class="page-heading admin-heading" data-page="admin" hidden/);
  assert.match(html, /id="adminStatus"[^>]*data-page="admin"[^>]*role="status"/);
  assert.match(html, /class="card admin-create" aria-labelledby="createUserTitle"/);
  assert.match(html, /class="card admin-directory" aria-labelledby="userListTitle"/);
  for (const id of ['newUserName', 'newUserEmail', 'newUserPassword']) {
    assert.match(html, new RegExp(`<label for="${id}">`));
  }
  assert.match(html, /id="newUserPassword"[^>]*aria-describedby="newPasswordHint"/);
  assert.equal((html.match(/class="permission-choice"/g) || []).length, 3);
  for (const name of ['Monitoring', 'Pengaturan', 'Operasi sprinkler']) {
    assert.ok(html.includes(`aria-label="${name}"`));
  }
  assert.match(html, /id="userCount"/);
});

test('account role, collapsed actions and access-only deletion are explicit', () => {
  assert.match(html, /id="userListTitle"[^>]*>Daftar Akun:<\/h\d>/);
  for (const role of ['user', 'admin']) assert.match(html, new RegExp(`name="newAccountRole" value="${role}"`));
  assert.match(html, /id="deleteUserDialog"[^>]*aria-describedby="deleteUserDescription"/);
  assert.match(html, /Identitas Firebase Auth tetap ada/);
  const admin = fs.readFileSync(path.join(root, 'js/admin.js'), 'utf8');
  const firebase = fs.readFileSync(path.join(root, 'js/firebase.js'), 'utf8');
  assert.match(admin, /panel\.hidden=!expanded\.has\(user\.uid\)/);
  assert.match(admin, /setAttribute\('aria-expanded'/);
  assert.match(admin, /SCSFirebase\.removeUserAccess\(user\.uid\)/);
  assert.doesNotMatch(admin + html + firebase, /Kirim email reset|sendPasswordResetEmail|resetPassword/);
});

test('current account has a read-only card above the account directory in the same column', () => {
  const column = html.match(/<div class="admin-accounts">([\s\S]*?)<\/article>\s*<\/div>/)?.[1];
  assert.ok(column);
  assert.match(column, /class="card current-account" aria-labelledby="currentAccountTitle"/);
  assert.match(column, /id="currentAccountTitle">Akun saat ini:<\/h\d>/);
  assert.ok(column.indexOf('id="currentAccountTitle"') < column.indexOf('id="userListTitle"'));
  const card = column.slice(0, column.indexOf('</article>'));
  for (const field of ['Name', 'Email', 'Avatar', 'Role', 'State']) assert.ok(card.includes(`id="currentAccount${field}"`));
  assert.doesNotMatch(card, /<button|<input|<form/);
  const admin = fs.readFileSync(path.join(root, 'js/admin.js'), 'utf8');
  assert.match(admin, /const account=allowed\(\)\?window\.smartcowAccess:null/);
  assert.match(admin, /syncCurrentAccount\(\);/);
});

test('settings keep three labelled control groups and a save action, with the chart outside the settings section', () => {
  const settings = html.slice(html.indexOf('<section class="settings-section"'), html.indexOf('<section class="page-heading" data-page="log"'));
  assert.ok(html.indexOf('id="chart"') < html.indexOf('<section class="settings-section"'));
  assert.doesNotMatch(settings, /id="chart"/);
  assert.equal((settings.match(/class="control-section(?: protection-section)?"/g) || []).length, 3);
  for (const id of ['basisTitle', 'sourceTitle', 'protectionTitle']) {
    assert.match(settings, new RegExp(`aria-labelledby="${id}"`));
    assert.match(settings, new RegExp(`<h\\d id="${id}"`));
  }
  assert.match(settings, /class="control-actions"[\s\S]*id="btnSaveCfg"/);
});

test('preview HTTP server serves only runtime assets and refuses writes/private paths', async t => {
  const child = spawn(process.execPath, ['scripts/preview.cjs'], {
    cwd: root, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => child.kill());
  const origin = await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error('Preview startup timed out')), 5000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Preview exited: ${code}`)); });
    child.stdout.on('data', data => {
      out += data;
      const match = out.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(await page.text(), /id="appShell" class="app-shell" data-state="loading" aria-busy="true" inert/);
  assert.equal((await fetch(origin + '/assets/farm-scene.svg')).status, 200);
  assert.equal((await fetch(origin + '/js/app.js?v=42')).status, 200);
  const head = await fetch(origin + '/index.html', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  for (const name of ['/.git/config', '/js/firebase-config.js', '/database.rules.json',
    '/firmware/smart-cow-sprinkler-firebase/espkanan_FINAL/espkanan_FINAL.ino', '/docs/UI-PREVIEW.md']) {
    assert.equal((await fetch(origin + name)).status, 404, name);
  }
  assert.equal((await fetch(origin, { method: 'POST', body: 'not a write endpoint' })).status, 405);
});
