const test = require('node:test');
const assert = require('node:assert/strict');
const SCS = require('../js/core.js');
const C = require('../js/control.js');
const ready = {complete:true,clockValid:true,scheduleActive:true,runSeconds:0,offSeconds:7200,cyclesToday:0};

test('THI formula: DS 30 C + RH 70% = 81.38, not DHT companion temperature', () => {
  assert.ok(Math.abs(SCS.thiOf(30,70)-81.38)<1e-9);
  assert.equal(SCS.thiOf(30,100),86);
  assert.ok(Math.abs(SCS.thiOf(30,0)-70.6)<1e-9);
});
test('THI rejects missing, nonnumeric, nonfinite and out-of-range inputs', () => {
  for(const [t,rh] of [[null,70],[30,null],['30',70],[NaN,70],[30,Infinity],[-127,70],[30,101],[30,-1]])
    assert.equal(SCS.thiOf(t,rh),null);
});
test('v3 profiles start without hysteresis and share a global daily quota', () => {
  const cfg=C.normalize();
  assert.ok(!('hysteresis' in cfg)); assert.ok(!('hysteresis' in cfg.profiles.temperature));
  assert.equal(cfg.controlBasis,'temperature'); assert.equal(cfg.threshold,30);
  assert.equal(cfg.profiles.thi.threshold,72); assert.equal(cfg.maxCyclesPerDay,3);
  assert.deepEqual(cfg.schedules,[]);
});
test('switching basis preserves threshold, duration, cooldown, source, schedule and quota', () => {
  let cfg=C.normalize({threshold:31,maxDuration:90,cooldown:20,autoSrc:'schedule',maxCyclesPerDay:4,
    schedules:[{date:'2026-11-12',start:'14:00',dur:10}]});
  cfg=C.selectBasis(cfg,'thi');
  assert.equal(cfg.threshold,72); assert.equal(cfg.autoSrc,'threshold'); assert.deepEqual(cfg.schedules,[]);
  assert.equal(cfg.maxCyclesPerDay,4);
  cfg.threshold=75; cfg.maxDuration=45; cfg.cooldown=80; cfg.autoSrc='schedule';
  cfg.schedules=[{date:'2026-11-13',start:'16:00',dur:20}];
  cfg=C.selectBasis(cfg,'temperature');
  assert.equal(cfg.threshold,31); assert.equal(cfg.maxDuration,90); assert.equal(cfg.cooldown,20);
  assert.equal(cfg.schedules[0].start,'14:00'); assert.equal(cfg.maxCyclesPerDay,4);
});
test('v3 Firebase roundtrip drops hysteresis and legacy mirrors', () => {
  let cfg=C.selectBasis(C.normalize({threshold:32,autoSrc:'schedule',maxCyclesPerDay:5,
    schedules:[{date:'2026-11-12',start:'09:00',dur:8}]}),'thi');
  cfg.threshold=74; cfg.cooldown=7200;
  const wire=C.toFirebase(cfg), round=C.fromFirebase(wire);
  assert.equal(wire.controlPolicyVersion,3); assert.equal(wire.controlBasis,'thi');
  assert.equal(wire.thiThreshold,74); assert.equal(wire.tempThreshold,32);
  assert.equal(wire.thiCooldown,7200); assert.equal(wire.maxCyclesPerDay,5);
  assert.equal(wire.thiSch1Date,null); assert.equal(wire.thiSchN,0);
  assert.equal(wire.tempSch1Start,'09:00');
  for(const key of Object.keys(wire)) assert.ok(!/hysteresis|^sch\d|^threshold$|^cooldown$|^maxDuration$|^autoSrc$/.test(key),key);
  assert.deepEqual(round,C.normalize(C.capture(cfg)));
});
test('cooldown accepts 86400 s and quota accepts 1..100 with safe fallbacks', () => {
  assert.equal(C.normalize({cooldown:86400}).cooldown,86400);
  assert.equal(C.normalize({cooldown:86401}).cooldown,60);
  assert.equal(C.normalize({maxCyclesPerDay:100}).maxCyclesPerDay,100);
  assert.equal(C.normalize({maxCyclesPerDay:1}).maxCyclesPerDay,1);
  assert.equal(C.normalize({maxCyclesPerDay:0}).maxCyclesPerDay,3);
  assert.equal(C.normalize({maxCyclesPerDay:101}).maxCyclesPerDay,3);
  assert.equal(C.normalize({maxCyclesPerDay:2.6}).maxCyclesPerDay,3);
});
test('v2 settings migrate to v3 without hysteresis, preserving threshold, duration, cooldown, schedule', () => {
  const cfg=C.fromFirebase({controlPolicyVersion:2,mode:'auto',controlBasis:'thi',maxCyclesPerDay:4,
    thiThreshold:74,thiHysteresis:2,thiMaxDuration:300,thiCooldown:7200,thiAutoSrc:'schedule',thiSchN:1,
    thiSch1Date:'2026-11-12',thiSch1Start:'23:55',thiSch1Dur:10,
    tempThreshold:31,tempHysteresis:1,tempMaxDuration:90,tempCooldown:40});
  assert.equal(cfg.threshold,74); assert.equal(cfg.maxDuration,300); assert.equal(cfg.cooldown,7200);
  assert.equal(cfg.maxCyclesPerDay,4); assert.ok(!('hysteresis' in cfg));
  assert.deepEqual(cfg.schedules,[{date:'2026-11-12',start:'23:55',dur:10}]);
  assert.equal(cfg.profiles.temperature.threshold,31); assert.equal(cfg.profiles.temperature.maxDuration,90);
});
test('legacy settings migrate into temperature profile without hysteresis or spontaneous schedules', () => {
  const cfg=C.fromFirebase({mode:'auto',threshold:29,hysteresis:0.5,maxDuration:50,cooldown:40,autoSrc:'schedule',
    schN:1,sch1Date:'2026-11-12',sch1Start:'23:55',sch1Dur:10});
  assert.equal(cfg.threshold,29); assert.equal(cfg.profiles.thi.threshold,72);
  assert.equal(cfg.maxCyclesPerDay,3); assert.ok(!('hysteresis' in cfg));
  assert.deepEqual(cfg.schedules,[{date:'2026-11-12',start:'23:55',dur:10}]);
  assert.deepEqual(C.fromFirebase({mode:'auto',schN:0}).schedules,[]);
});
test('legacy recurring schedule migrates once to current WIB date', () => {
  const cfg=C.fromFirebase({mode:'auto',schOn:1,schStart:'12:00',schDur:10});
  assert.equal(cfg.autoSrc,'schedule'); assert.equal(cfg.schedules[0].date,SCS.wibDateStr());
  assert.equal(cfg.schedules[0].start,'12:00');
});
test('normalization rejects corrupt profile values and never replaces zero cooldown', () => {
  const cfg=C.normalize({controlBasis:'thi',threshold:1000,maxDuration:-1,cooldown:0});
  assert.equal(cfg.threshold,72); assert.equal(cfg.maxDuration,120);
  assert.equal(cfg.cooldown,0); assert.equal(C.normalize({controlBasis:'invalid'}).controlBasis,'temperature');
});
test('capability gate needs fresh firmware echo of version 3', () => {
  const now=SCS.wibDateTimeMs('2026-11-14','10:30');
  assert.equal(C.canApplyV3({controlPolicyVersion:3,ts:now-1000},now),true);
  assert.equal(C.canApplyV3({controlPolicyVersion:3,ts:now-120001},now),false);
  assert.equal(C.canApplyV3({controlPolicyVersion:2,ts:now},now),false);
  assert.equal(C.canApplyV3({controlPolicyVersion:3},now),false);
  assert.equal(C.canApplyV3(null,now),false);
});
for(const [basis,threshold] of [['temperature',30],['thi',72]]) {
  test(`${basis}: threshold only starts a cycle, running spray keeps full duration`, () => {
    const cfg={threshold,maxDuration:600,cooldown:7200,maxCyclesPerDay:3,autoSrc:'threshold'};
    assert.equal(SCS.decideAutomatic(threshold-4,false,cfg,ready),'stay');
    assert.equal(SCS.decideAutomatic(threshold,false,cfg,ready),'on');
    assert.equal(SCS.decideAutomatic(threshold-10,true,cfg,{...ready,runSeconds:300}),'stay');
    assert.equal(SCS.decideAutomatic(threshold+5,true,cfg,{...ready,runSeconds:599}),'stay');
    assert.equal(SCS.decideAutomatic(threshold+5,true,cfg,{...ready,runSeconds:600}),'off');
  });
  test(`${basis}: safety stop, schedule close, bad clock and incomplete inputs stop automatic`, () => {
    const cfg={threshold,maxDuration:600,cooldown:7200,maxCyclesPerDay:3,autoSrc:'schedule'};
    assert.equal(SCS.decideAutomatic(threshold+5,true,cfg,{...ready,complete:false}),'off');
    assert.equal(SCS.decideAutomatic(NaN,true,cfg,ready),'off');
    assert.equal(SCS.decideAutomatic(threshold+5,true,cfg,{...ready,scheduleActive:false}),'off');
    assert.equal(SCS.decideAutomatic(threshold+5,false,cfg,{...ready,clockValid:false}),'stay');
  });
}
test('regression 10:30 start -> 10:40 stop -> 12:40 eligible at 7200 s cooldown', () => {
  const cfg={threshold:30,maxDuration:600,cooldown:7200,maxCyclesPerDay:3,autoSrc:'threshold'};
  const startTs=SCS.wibDateTimeMs('2026-11-14','10:30'),stopTs=SCS.wibDateTimeMs('2026-11-14','10:40');
  assert.equal((stopTs-startTs)/1000,600);
  assert.equal((SCS.wibDateTimeMs('2026-11-14','12:40')-stopTs)/1000,7200);
  assert.equal(SCS.decideAutomatic(31,false,cfg,{...ready,offSeconds:999999,cyclesToday:0}),'on');
  assert.equal(SCS.decideAutomatic(31,true,cfg,{...ready,runSeconds:599,cyclesToday:1}),'stay');
  assert.equal(SCS.decideAutomatic(31,true,cfg,{...ready,runSeconds:600,cyclesToday:1}),'off');
  assert.equal(SCS.decideAutomatic(31,false,cfg,{...ready,offSeconds:7199,cyclesToday:1}),'stay');
  assert.equal(SCS.decideAutomatic(31,false,cfg,{...ready,offSeconds:7200,cyclesToday:1}),'on');
});
test('shared quota caps the third start of a WIB day regardless of profile', () => {
  const base={threshold:30,maxDuration:600,cooldown:7200,maxCyclesPerDay:3,autoSrc:'threshold'};
  const cfg={...base};
  assert.equal(SCS.decideAutomatic(31,false,cfg,{...ready,offSeconds:999999,cyclesToday:0}),'on');
  assert.equal(SCS.decideAutomatic(31,false,cfg,{...ready,offSeconds:999999,cyclesToday:1}),'on');
  assert.equal(SCS.decideAutomatic(31,false,cfg,{...ready,offSeconds:999999,cyclesToday:2}),'on');
  assert.equal(SCS.decideAutomatic(31,false,cfg,{...ready,offSeconds:999999,cyclesToday:3}),'stay');
  cfg.maxCyclesPerDay=1;
  assert.equal(SCS.decideAutomatic(31,false,cfg,{...ready,offSeconds:999999,cyclesToday:1}),'stay');
});
test('unknown device quota, age or clock never authorizes an automatic start', () => {
  const cfg={threshold:30,maxDuration:600,cooldown:7200,maxCyclesPerDay:3,autoSrc:'threshold'};
  for(const unknown of [{cyclesToday:null},{offSeconds:null},{cyclesToday:undefined},{offSeconds:NaN},{offSeconds:-1},{cyclesToday:-1}])
    assert.equal(SCS.decideAutomatic(31,false,cfg,{...ready,offSeconds:999999,cyclesToday:0,...unknown}),'stay');
  assert.equal(SCS.decideAutomatic(31,false,cfg,{...ready,cyclesToday:0,offSeconds:999999,clockValid:false}),'stay');
});
test('quota day rolls over only from trusted device time and profile switches keep the count', () => {
  const cfg={threshold:30,maxDuration:600,cooldown:7200,maxCyclesPerDay:1,autoSrc:'threshold'};
  assert.equal(SCS.decideAutomatic(31,false,cfg,{...ready,cyclesToday:1,offSeconds:999999}),'stay');
  assert.equal(SCS.decideAutomatic(31,false,cfg,{...ready,cyclesToday:0,offSeconds:999999}),'on');
  assert.equal(SCS.decideAutomatic(31,false,cfg,{...ready,cyclesToday:0,offSeconds:999999,clockValid:false}),'stay');
  const thi={...cfg,threshold:72};
  assert.equal(SCS.decideAutomatic(80,false,thi,{...ready,cyclesToday:1,offSeconds:999999}),'stay');
});
test('reboot into cooldown preserves quota and never recounts the interrupted spray', () => {
  const cfg={threshold:30,maxDuration:600,cooldown:7200,maxCyclesPerDay:2,autoSrc:'threshold'};
  assert.equal(SCS.decideAutomatic(31,false,cfg,{...ready,cyclesToday:2,offSeconds:7199}),'stay');
  assert.equal(SCS.decideAutomatic(31,false,cfg,{...ready,cyclesToday:2,offSeconds:7200}),'stay');
  cfg.maxCyclesPerDay=3;
  assert.equal(SCS.decideAutomatic(31,false,cfg,{...ready,cyclesToday:2,offSeconds:7200}),'on');
  assert.equal(SCS.decideAutomatic(31,false,cfg,{...ready,cyclesToday:3,offSeconds:999999}),'stay');
});
test('dated schedule crosses midnight and ends exactly at its bound', () => {
  const slots=[{date:'2026-11-12',start:'23:55',dur:10}];
  assert.equal(SCS.anyScheduleActive(SCS.wibDateTimeMs('2026-11-13','00:04'),slots),true);
  assert.equal(SCS.anyScheduleActive(SCS.wibDateTimeMs('2026-11-13','00:05'),slots),false);
});
