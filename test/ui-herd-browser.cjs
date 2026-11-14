const { chromium } = require('C:/Users/LyNx/AppData/Roaming/npm/node_modules/playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const out = 'E:/OpenCode-Standalone/tmp/costmosys-ui/final/herd';
fs.mkdirSync(out, { recursive: true });
const base = 'http://127.0.0.1:8766/?clock=fixed&burst=0';
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const results = [];
  async function open(width, theme, query, motion = 'no-preference') {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: motion });
    await context.addInitScript(t => localStorage.setItem('scs_theme', t), theme);
    const page = await context.newPage(), errors = [], external = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('request', r => { if (!/^(http:\/\/127\.0\.0\.1:8766\/|data:)/.test(r.url())) external.push(r.url()); });
    await page.goto(base + query, { waitUntil: 'commit' });
    return { context, page, errors, external };
  }
  const ready = page => page.waitForFunction(() => document.getElementById('appShell').dataset.state === 'ready' && document.getElementById('connBadge').textContent === 'TERHUBUNG', null, { polling: 200, timeout: 15000 });
  const settle = page => page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));
  const text = (page, id) => page.locator('#' + id).textContent();
  const only = process.env.ONLY;
  if (!only) for (const [herd, pill, personPill] of [['empty', 'BELUM ADA UMPAN', 'BELUM ADA UMPAN'], ['error', 'UMPAN TIDAK TERBACA', 'UMPAN TIDAK TERBACA'], ['stale', 'UMPAN LAMA', 'UMPAN LAMA'], ['fresh', 'TERAMATI', 'ORANG TERDETEKSI']]) {
    const { context, page, errors, external } = await open(1280, 'light', `&scenario=live&herd=${herd}`);
    await ready(page);
    assert.equal((await text(page, 'condPosturePill')).trim(), pill, herd);
    assert.equal((await text(page, 'condPersonPill')).trim(), personPill, herd);
    assert.equal((await text(page, 'condHeatPill')).trim().length > 0, true);
    assert.match(await text(page, 'condSprayDetail'), /Siklus|Menunggu/);
    assert.equal(await page.locator('#condSynthetic').isVisible(), true);
    await page.locator('.cond-link').focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('herdStatusTitle').offsetParent !== null);
    assert.equal(await page.locator('#herdSynthetic').isVisible(), true);
    assert.equal((await text(page, 'herdPill')).trim(), pill === 'TERAMATI' ? 'UMPAN TERKINI' : pill);
    const zoneCards = await page.locator('.zone-card').count();
    assert.equal(zoneCards, herd === 'fresh' || herd === 'stale' ? 3 : 0, herd);
    const body = await page.locator('#mainContent').innerText();
    assert.doesNotMatch(body, /\bNORMAL\b/); assert.doesNotMatch(body, /skor|Level [1-4]|per ekor/i);
    if (herd === 'fresh') {
      const near = await page.locator('.zone-card', { hasText: 'R1 · near' }).innerText();
      assert.match(near, /postur teramati/); assert.match(near, /Berdiri\s*3 m 0 d/); assert.match(near, /Celah antar sampel\s*1 m 0 d/);
      assert.match(await text(page, 'herdMeta'), /Terakhir diproses/);
      await page.locator('#herdDay').focus();
    }
    await page.screenshot({ path: `${out}/herd-${herd}.png`, fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    results.push({ herd, zoneCards });
    await context.close();
  }
  if (!only) for (const [width, theme, motion] of [[360, 'light', 'no-preference'], [390, 'dark', 'reduce'], [430, 'light', 'reduce'], [1280, 'dark', 'no-preference'], [1535, 'light', 'no-preference']]) {
    const { context, page, errors, external } = await open(width, theme, '&scenario=live&herd=fresh&authDelay=1800', motion);
    await page.waitForTimeout(500);
    const loading = await page.evaluate(() => ({ state: appShell.dataset.state, busy: appShell.getAttribute('aria-busy'), inert: appShell.inert, hidden: appShell.hidden, login: authPanel.hidden, save: btnSaveCfg.disabled, manual: btnManual.disabled, on: btnSprayOn.disabled, badge: connBadge.textContent, wide: document.documentElement.scrollWidth > innerWidth,
      motion: getComputedStyle(document.querySelector('.side-head .brand-mark'), '::after').animationName }));
    assert.deepEqual({ ...loading, motion: undefined }, { state: 'loading', busy: 'true', inert: true, hidden: false, login: true, save: true, manual: true, on: true, badge: 'MENGHUBUNGKAN…', wide: false, motion: undefined });
    if (width >= 981) assert.equal(await page.evaluate(() => getComputedStyle(sidebar).visibility), 'visible');
    assert.equal(loading.motion === 'none' || loading.motion === 'mark-ring', true);
    if (motion === 'reduce') assert.equal(loading.motion, 'none');
    await page.screenshot({ path: `${out}/loading-${width}-${theme}-${motion}.png` });
    await ready(page);
    assert.equal(await page.evaluate(() => appShell.inert), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    for (let i = 0; i < 6; i++) await page.locator('#themeBtn').click({ force: true });
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
    await page.locator('#menuBtn').click();
    await page.locator('.side-link[data-page=herd]').click();
    await page.waitForFunction(() => document.getElementById('herdStatusTitle').offsetParent !== null);
    assert.equal((await page.locator('#pageBreadcrumb').textContent()), 'Aktivitas Sapi');
    await page.screenshot({ path: `${out}/herd-page-${width}-${theme}.png`, fullPage: true });
    await page.locator('#menuBtn').click();
    await page.locator('.side-link[data-page=dash]').click();
    await page.waitForFunction(() => document.getElementById('condTitle').offsetParent !== null);
    await settle(page);
    const shown = await page.evaluate(() => [...document.querySelectorAll('main.container > section')].filter(x => x.offsetParent !== null).map(x => ({ c: x.className.split(' ')[0], o: Number(getComputedStyle(x).opacity), h: x.offsetHeight })));
    assert.equal(shown.length >= 7, true, JSON.stringify(shown));
    for (const x of shown) { assert.equal(x.o, 1, JSON.stringify(x)); assert.equal(x.h > 40, true, JSON.stringify(x)); }
    assert.equal(await page.evaluate(() => document.getElementById('sidebar').getBoundingClientRect().right <= 0 || getComputedStyle(document.getElementById('sidebar')).visibility === 'hidden'), true);
    assert.equal(await page.evaluate(() => Math.round(document.querySelector('.workspace').getBoundingClientRect().left)), 0);
    await page.screenshot({ path: `${out}/overview-${width}-${theme}.png`, fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    results.push({ width, theme, motion, loading });
    await context.close();
  }
  for (const theme of ['light', 'dark']) for (const width of [390, 1535]) {
    const { context, page, errors, external } = await open(width, theme, '&scenario=live&herd=fresh&sdkDelay=2500');
    await page.waitForTimeout(600);
    const early = await page.evaluate(() => ({ state: appShell.dataset.state, inert: appShell.inert, save: btnSaveCfg.disabled, manual: btnManual.disabled, on: btnSprayOn.disabled, badge: connBadge.textContent, login: authPanel.hidden, sdk: typeof window.SCSFirebase }));
    assert.deepEqual(early, { state: 'loading', inert: true, save: true, manual: true, on: true, badge: 'MENGHUBUNGKAN…', login: true, sdk: 'undefined' });
    await ready(page);
    await page.waitForFunction(() => !document.getElementById('btnManual').disabled, null, { polling: 200, timeout: 10000 });
    await settle(page);
    const late = await page.evaluate(() => ({ state: appShell.dataset.state, inert: appShell.inert, busy: appShell.getAttribute('aria-busy'), badge: connBadge.textContent, greeting: greetingName.textContent, sdk: typeof window.SCSFirebase, notice: sessionPanel.hidden, avg: avgTemp.textContent !== '—' }));
    assert.deepEqual(late, { state: 'ready', inert: false, busy: 'false', badge: 'TERHUBUNG', greeting: 'Admin', sdk: 'object', notice: true, avg: true });
    const shown = await page.evaluate(() => [...document.querySelectorAll('main.container > section')].filter(x => x.offsetParent !== null).map(x => Number(getComputedStyle(x).opacity)));
    assert.equal(shown.length >= 7 && shown.every(o => o === 1), true, JSON.stringify(shown));
    await page.screenshot({ path: `${out}/sdk-recovered-${width}-${theme}.png`, fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    results.push({ name: 'sdk-delay-recovers', width, theme, late });
    await context.close();
  }
  if (!only || only === 'fail') {
    const { context, page, errors } = await open(390, 'light', '&scenario=live&herd=fresh&sdkDelay=20000');
    await page.waitForFunction(() => document.getElementById('sessionPanel').hasAttribute('data-failed'), null, { polling: 500, timeout: 25000 });
    const failed = await page.evaluate(() => ({ state: appShell.dataset.state, inert: appShell.inert, hidden: appShell.hidden, save: btnSaveCfg.disabled, manual: btnManual.disabled, on: btnSprayOn.disabled, retryVisible: sessionRetry.offsetParent !== null, retryHref: sessionRetry.getAttribute('href'), msg: sessionMessage.textContent, login: authPanel.hidden }));
    assert.equal(failed.state, 'failed'); assert.equal(failed.inert, true); assert.equal(failed.hidden, false);
    assert.deepEqual([failed.save, failed.manual, failed.on, failed.retryVisible, failed.login], [true, true, true, true, true]);
    assert.match(failed.msg, /coba muat ulang/i);
    await page.locator('#sessionRetry').focus();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'sessionRetry');
    await page.screenshot({ path: `${out}/sdk-failed-390-light.png` });
    await Promise.all([page.waitForURL(u => !u.search, { timeout: 10000 }), page.keyboard.press('Enter')]);
    await ready(page);
    assert.equal(await page.evaluate(() => appShell.inert), false);
    results.push({ name: 'sdk-failure-retry-recovers', failed });
    assert.deepEqual(errors, []);
    await context.close();
  }
  for (const [name, query, wait, expectPill] of [
    ['login', '&scenario=login&herd=fresh&authDelay=1500', 500, 'MENGHUBUNGKAN…']]) {
    const { context, page, errors } = await open(390, 'light', query);
    await page.waitForTimeout(wait);
    const s = await page.evaluate(() => ({ state: appShell.dataset.state, inert: appShell.inert, hidden: appShell.hidden, save: btnSaveCfg.disabled, badge: connBadge.textContent, greeting: greetingName.textContent }));
    assert.equal(s.state, 'loading'); assert.equal(s.inert, true); assert.equal(s.hidden, false); assert.equal(s.save, true); assert.equal(s.badge, expectPill);
    if (name === 'login') { await page.waitForFunction(() => !authPanel.hidden, null, { polling: 200, timeout: 8000 }); assert.equal(await page.evaluate(() => appShell.hidden), true); }
    assert.deepEqual(errors, []);
    results.push({ name, s });
    await context.close();
  }
  for (const scenario of ['noaccess', 'viewer']) {
    const { context, page, errors } = await open(1280, 'light', `&scenario=${scenario}&herd=fresh`);
    await page.waitForFunction(() => document.getElementById('appShell').dataset.state === 'ready', null, { polling: 200, timeout: 15000 });
    await page.waitForTimeout(400);
    const s = await page.evaluate(() => ({ cond: document.querySelector('.cond-section').offsetParent !== null, save: btnSaveCfg.offsetParent === null, notice: accessNotice.offsetParent !== null }));
    if (scenario === 'noaccess') assert.deepEqual(s, { cond: false, save: true, notice: true });
    else assert.equal(s.cond, true);
    assert.deepEqual(errors, []);
    results.push({ scenario, s });
    await context.close();
  }
  await browser.close();
  fs.writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
  console.log(`herd-browser PASS: ${results.length} groups; screenshots in ${out}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
