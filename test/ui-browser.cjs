const { chromium } = require('C:/Users/LyNx/AppData/Roaming/npm/node_modules/playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const out = 'E:/OpenCode-Standalone/tmp/costmosys-ui/final/cycle';
const axe = 'E:/OpenCode-Standalone/tmp/costmosys-ui/node_modules/axe-core/axe.min.js';
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const results = [], failures = [];
  async function open(width, theme, motion, scenario = 'live') {
    const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: motion });
    await context.addInitScript(theme => localStorage.setItem('scs_theme', theme), theme);
    const page = await context.newPage(), errors = [], external = [];
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (!/^(http:\/\/127\.0\.0\.1:8766\/|data:)/.test(request.url())) external.push(request.url()); });
    await page.goto(`http://127.0.0.1:8766/?scenario=${scenario}&clock=fixed&burst=0&interval=600000`);
    await page.waitForFunction(() => !document.getElementById('sessionPanel').offsetHeight);
    await page.waitForFunction(() => document.getElementById('avgTemp').textContent !== '—' || ['unknown','stale'].includes(new URLSearchParams(location.search).get('scenario')));
    return { context, page, errors, external };
  }
  async function admin(page, width) {
    await page.locator('#menuBtn').click(); await page.locator('#adminNav').click();
    await page.waitForFunction(() => document.getElementById('userList').children.length > 0);
  }
  for (const width of [390, 1535]) for (const theme of ['light','dark']) for (const motion of ['no-preference','reduce']) {
    const { context, page, errors, external } = await open(width, theme, motion);
    const name = `${width}-${theme}-${motion}`;
    console.log('CASE',name);
    try {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `${out}/${name}-overview.png`, fullPage: true });
      assert.equal(await page.locator('#inMaxDur').inputValue(), '10');
      assert.equal(await page.locator('#inCooldown').inputValue(), '120');
      assert.equal(await page.locator('#inMaxCycles').inputValue(), '3');
      await page.locator('#inThreshold').fill('31.5');
      assert.equal(await page.locator('#zoneTemp').getAttribute('data-zone'), 'warn');
      await page.locator('#inMaxDur').fill('10'); await page.locator('#inCooldown').fill('120'); await page.locator('#inMaxCycles').fill('3');
      await page.locator('#btnSaveCfg').focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.getElementById('btnSaveCfg').getAttribute('aria-busy') || document.getElementById('btnSaveCfg').getAttribute('aria-busy')==='false');
      assert.equal(await page.locator('#zoneTemp').getAttribute('data-zone'), 'ok');
      assert.match(await page.locator('#settingsStatus').textContent(), /simulasi lokal/);
      assert.equal(await page.locator('#inCooldown').inputValue(), '120');
      console.log('Saved',name);
      await page.locator('#basisThi').check(); assert.equal(await page.locator('#inMaxCycles').inputValue(), '3');
      await page.locator('#basisTemperature').check();
      await page.locator('#srcSchedule').check(); await page.locator('#btnAddSched').click();
      console.log('Scheduled',name);
      const duration = await page.locator('[data-durv]').textContent();
      await page.locator('[data-inc]').focus(); await page.keyboard.press('Enter');
      assert.equal(Number(await page.locator('[data-durv]').textContent()), Number(duration)+1);
      await page.locator('[data-pick=time]').click(); await page.locator('[data-s=m][data-d="1"]').focus();
      const minute = Number(await page.locator('[data-v=m]').inputValue()); await page.keyboard.press('Enter');
      assert.equal(Number(await page.locator('[data-v=m]').inputValue()), (minute+1)%60);
      await page.keyboard.press('Escape');
      await page.locator('#btnTemperatureDetails').focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.getElementById('sensorDialog').open);
      await page.keyboard.press('Tab'); await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('sensorDialog').open);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'btnTemperatureDetails');
      console.log('Sensors',name);
      await page.locator('#btnManual').focus(); await page.keyboard.press('Enter');
      await page.locator('#btnSprayOn').focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.getElementById('sprinklerText').textContent==='MENYEMPROT');
      await page.locator('#btnSprayOff').focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.getElementById('sprinklerText').textContent==='MATI');
      await page.locator('#btnAuto').focus(); await page.keyboard.press('Enter');
      console.log('Manual',name);
      for (let i=0;i<8;i++) await page.locator('#themeBtn').click({ force: true });
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
      await page.evaluate(() => Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
      await page.addScriptTag({ path: axe });
      const overviewAxe = await page.evaluate(async () => (await axe.run(document, { runOnly: { type:'tag', values:['wcag2a','wcag2aa','wcag21aa','wcag22aa'] } })).violations.map(v => ({ id:v.id, nodes:v.nodes.map(n=>n.target) })));
      await admin(page, width);
      const role = page.locator('.account-role-switch label').last();
      await page.mouse.move(0,0);
      const before = await role.locator('span').evaluate(e=>({ color:getComputedStyle(e).color,background:getComputedStyle(e).backgroundColor,border:getComputedStyle(e).borderColor }));
      await role.hover(); await page.waitForTimeout(180);
      const hover = await role.locator('span').evaluate(e=>({ color:getComputedStyle(e).color,background:getComputedStyle(e).backgroundColor,border:getComputedStyle(e).borderColor }));
      assert.notDeepEqual(hover,before);
      await role.locator('input').focus(); await page.keyboard.press('Space');
      assert.equal(await page.locator('#newUserPermissions').isVisible(), false);
      await page.evaluate(() => Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
      await page.screenshot({ path:`${out}/${name}-admin.png`, fullPage:true });
      const adminAxe = await page.evaluate(async () => (await axe.run(document, { runOnly: { type:'tag', values:['wcag2a','wcag2aa','wcag21aa','wcag22aa'] } })).violations.map(v => ({ id:v.id,nodes:v.nodes.map(n=>n.target) })));
      assert.deepEqual(overviewAxe,[]); assert.deepEqual(adminAxe,[]);
      assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
      results.push({ name, overviewAxe, adminAxe, hoverChanged:true, keyboard:true, rapidThemeFlips:8, errors, external });
    } catch(error) { failures.push({ name, error:error.stack, errors }); console.error(name,error.message); }
    await context.close();
  }
  for (const scenario of ['unknown','stale','version2','cooldown','quota','time-unavailable','cycle']) {
    const { context,page,errors,external } = await open(390,'light','reduce',scenario);
    try {
      if (['unknown','stale','version2'].includes(scenario)) {
        for (const selector of ['#btnSaveCfg','#inMaxDur','#inCooldown','#inMaxCycles','#basisThi','#srcSchedule','#btnAuto']) assert.equal(await page.locator(selector).isDisabled(),true);
      }
      if(scenario==='cycle') {
        const observed=[];
        for(const seconds of [0,600,7199,1,600,7200,600,7200]) {
          observed.push(await page.evaluate(seconds=>{const raw=SCS_SYNTHETIC.advance(seconds);return {seconds,phase:raw.cyclePhase,today:raw.cyclesToday,remain:raw.cycleRemainSec,ssr:raw.ssr};},seconds));
        }
        assert.equal(observed.at(-1).today,3);assert.equal(observed.at(-1).ssr,0);
        results.push({ deterministicCycle:observed });
      }
      await page.screenshot({path:`${out}/state-${scenario}.png`,fullPage:true});
      assert.deepEqual(errors,[]);assert.deepEqual(external,[]);results.push({scenario,errors,external});
    } catch(error) { failures.push({scenario,error:error.stack,errors}); }
    await context.close();
  }
  await browser.close();
  fs.writeFileSync(`${out}/results.json`,JSON.stringify({results,failures},null,2));
  console.log(JSON.stringify({passed:results.length,failed:failures.length,failures,output:out},null,2));
  if(failures.length)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
