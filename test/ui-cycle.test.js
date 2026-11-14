const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const SCS = require('../js/core.js');
const SCSControl = require('../js/control.js');
const SCSTelemetry = require('../js/telemetry.js');
const SCSAccess = require('../js/access.js');
const bridge = fs.readFileSync(require.resolve('../scripts/synthetic/firebase-bridge.js'), 'utf8');
function fixture(scenario = 'cycle') {
  let latest, control;
  const context = vm.createContext({ location: { search: `?scenario=${scenario}&clock=fixed&burst=0` }, URLSearchParams,
    sessionStorage: { getItem: () => null, setItem() {} }, SCS, SCSControl, SCSTelemetry, window: { SCSAccess },
    setTimeout: fn => { fn(); return 1; }, clearTimeout() {}, setInterval: () => 1, clearInterval() {} });
  vm.runInContext(bridge, context);
  const api = context.window.SCSFirebase, clock = context.window.SCS_SYNTHETIC;
  api.connect({ onTelemetry: raw => { latest = raw; }, onControl: value => { control = value; } });
  return { api, advance: seconds => clock.advance(seconds), latest: () => latest, control: () => control };
}
test('synthetic 10-minute sprays use cooldown from OFF and stop at three shared automatic starts', async () => {
  const f = fixture();
  assert.equal(f.latest().cyclesToday, 1);
  assert.equal(f.latest().cycleRemainSec, 600);
  assert.equal(f.advance(600).cyclePhase, 'cooldown');
  assert.equal(f.latest().cycleRemainSec, 7200);
  assert.equal(f.advance(7199).ssr, 0);
  assert.equal(f.advance(1).cyclesToday, 2);
  assert.equal(f.latest().cyclePhase, 'spraying');
  f.advance(600); f.advance(7200);
  assert.equal(f.latest().cyclesToday, 3);
  f.advance(600); f.advance(7200);
  assert.equal(f.latest().ssr, 0);
  await f.api.pushControl({ controlBasis: 'thi' });
  assert.equal(f.latest().cyclesToday, 3);
  assert.equal(f.latest().ssr, 0);
  await f.api.pushControl({ mode: 'manual' });
  await f.api.pushOverride(true);
  assert.equal(f.latest().ssr, 1);
  assert.equal(f.latest().cyclesToday, 3);
  await f.api.pushOverride(false);
  assert.equal(f.latest().cyclePhase, 'cooldown');
  await f.api.pushControl({ mode: 'auto', controlBasis: 'temperature' });
  assert.equal(f.latest().cyclesToday, 3);
  assert.equal(f.latest().ssr, 0);
});
test('synthetic unavailable, stale and version-2 capability reject v3 configuration without mutation', async () => {
  for (const scenario of ['unknown', 'stale', 'version2']) {
    const f = fixture(scenario), before = JSON.stringify(f.control());
    assert.equal(SCSControl.canApplyV3(f.latest(), f.api.now()), false);
    await assert.rejects(f.api.pushControl({ controlPolicyVersion: 3, maxCyclesPerDay: 7 }));
    assert.equal(JSON.stringify(f.control()), before);
  }
});
test('synthetic invalid device time never starts automatic spray or invents a quota day', () => {
  const f = fixture('time-unavailable');
  assert.equal(f.latest().ntpValid, false);
  assert.equal(f.latest().cycleDay, null);
  assert.equal(f.latest().cyclesToday, 0);
  assert.equal(f.advance(20000).ssr, 0);
  assert.equal(f.latest().cycleDay, null);
});
test('minute settings round-trip in seconds and the quota remains global when changing profiles', () => {
  let cfg = SCSControl.normalize({ maxDuration: 10 * 60, cooldown: 120 * 60, maxCyclesPerDay: 3 });
  cfg = SCSControl.selectBasis(cfg, 'thi');
  assert.equal(cfg.maxCyclesPerDay, 3);
  cfg = SCSControl.selectBasis(cfg, 'temperature');
  const wire = SCSControl.toFirebase(cfg);
  assert.equal(wire.tempMaxDuration, 600);
  assert.equal(wire.tempCooldown, 7200);
  assert.equal(wire.maxCyclesPerDay, 3);
  assert.equal(wire.controlPolicyVersion, 3);
  assert.equal(Object.keys(wire).some(key => /hysteresis/i.test(key)), false);
});
