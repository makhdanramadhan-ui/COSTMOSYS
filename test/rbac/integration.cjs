const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {ref,set,get,update,push,query,orderByChild,limitToLast,serverTimestamp}=require('firebase/database');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),T=require('../../js/telemetry.js'),C=require('../../js/control.js'),A=require('../../js/access.js');
const projectId='demo-smartcow-integration',base='devices/cow-sprinkler-01';

function canonical(nowMs,extra={}){
  return {
    schemaVersion:3,controlPolicyVersion:2,controlBasis:'temperature',mode:'auto',autoSrc:'threshold',sch:0,n:6,
    ts:serverTimestamp(),measuredTs:nowMs,
    t1:30,t2:31,t3:32,t4:33,t5:34,t6:35,
    temperatureAgeMs:[100,100,100,500,500,500],validMask:63,validCount:6,avg:32.5,complete:true,
    h1:70,h2:80,h3:60,h4:90,d1:31,d2:32,d3:33,d4:34,
    humidityAgeMs:[100,200,300,400],humidityValidMask:15,humidityValidCount:4,humidityComplete:true,humidityAvg:75,
    thi:81.38,thiComplete:true,ssr:1,leftOnline:true,leftAgeMs:500,rssi:-60,heap:180000,...extra
  };
}

(async()=>{
  if(!process.env.FIREBASE_DATABASE_EMULATOR_HOST)throw Error('Run npm run test:integration from test/rbac, never against production.');
  const env=await initializeTestEnvironment({projectId,database:{host:'127.0.0.1',port:9000,rules:fs.readFileSync(path.join(root,'database.rules.json'),'utf8')}});
  let count=0;
  const pass=async(label,p)=>{try{await assertSucceeds(p);count++;}catch(e){throw Error(label+': '+e.message);}};
  const fail=async(label,p)=>{try{await assertFails(p);count++;}catch(e){throw Error(label+': '+e.message);}};
  const check=(label,ok)=>{assert.ok(ok,label);count++;};
  const db=uid=>uid?env.authenticatedContext(uid).database():env.unauthenticatedContext().database();
  const user=(monitor,settings,operate,enabled=true)=>A.accountRecord({email:'u@emulator.test',monitor,settings,operate,enabled},1);
  try{
    const measured=Date.now();
    await env.withSecurityRulesDisabled(async c=>{
      const adb=c.database();
      await set(ref(adb,'access'),{admin:{...user(true,true,true),role:'admin'},monitor:user(true,false,false),settings:user(true,true,false),operate:user(true,false,true),disabled:user(true,true,true,false)});
      await set(ref(adb,base+'/telemetry/latest'),canonical(measured));
      await set(ref(adb,base+'/control'),C.toFirebase(C.normalize({mode:'auto'})));
      for(const ts of [measured-2000,measured-1000,measured])await push(ref(adb,base+'/telemetry/log'),canonical(measured,{ts}));
    });

    for(const uid of [null,'disabled'])await fail('telemetry latest denied',get(ref(db(uid),base+'/telemetry/latest')));
    await pass('telemetry latest monitor',get(ref(db('monitor'),base+'/telemetry/latest')));
    await pass('control monitor',get(ref(db('monitor'),base+'/control')));
    for(const uid of ['monitor','settings','operate'])await fail('device root denied',get(ref(db(uid),base)));
    await fail('latest write denied for admin',set(ref(db('admin'),base+'/telemetry/latest'),canonical(measured)));
    await fail('log write denied for admin',push(ref(db('admin'),base+'/telemetry/log'),canonical(measured)));

    const raw=(await get(ref(db('monitor'),base+'/telemetry/latest'))).val();
    check('server ts resolved to number',Number.isFinite(raw.ts)&&raw.ts>1700000000000);
    const v=T.view(raw,raw.ts);
    check('parser online',v.online===true);
    check('parser full channels',v.validCount===6&&v.humidityValidCount===4);
    check('parser avg from backend',v.avg===32.5&&v.humidityAvg===75);
    check('parser THI complete',v.thi!==null&&v.thiComplete===true);
    check('parser relay ssr',v.ssr===1);
    check('parser left node',v.leftOnline===true&&v.legacy===false);
    check('parser states online',v.dsStates.every(s=>s==='online')&&v.rhStates.every(s=>s==='online'));

    const stale=T.view(raw,raw.ts+15000);
    check('expired snapshot offline',stale.online===false&&stale.ssr===null);
    check('expired snapshot shows no values',stale.validCount===0&&stale.humidityValidCount===0&&stale.s.every(x=>x===null)&&stale.h.every(x=>x===null));
    check('expired snapshot states stale',stale.dsStates.every(s=>s==='stale'));

    const alias=T.view({timestamp:raw.ts,measuredAt:raw.ts,relayOn:1,t1:30,t2:31,t3:32,t4:33,t5:34,t6:35,n:6,avg:32},raw.ts);
    check('alias payload rejected',alias.online===false&&alias.ssr===null&&alias.validCount===0);

    const logSnap=await assertSucceeds(get(query(ref(db('monitor'),base+'/telemetry/log'),orderByChild('ts'),limitToLast(2))));
    const rows=[];logSnap.forEach(ch=>{const r=ch.val();if(typeof r.ts==='number')rows.push(T.logRow(r));});
    check('log query indexed and limited',rows.length===2&&rows[0].t<rows[1].t);
    check('log rows parse at measurement time',rows.every(r=>r.avg!==null&&r.s.filter(Number.isFinite).length===6&&r.humidityAvg===75));

    const evRef=push(ref(db('operate'),base+'/events'));
    await pass('event push operate',set(evRef,{type:'web',reason:'Manual ON emulator',ts:serverTimestamp()}));
    await fail('event push monitor denied',push(ref(db('monitor'),base+'/events'),{type:'web',reason:'hack',ts:serverTimestamp()}));
    await fail('event overwrite denied',set(evRef,{type:'web',reason:'Manual ON emulator',ts:serverTimestamp()}));
    await fail('event delete denied',set(evRef,null));
    await fail('event unknown field denied',push(ref(db('operate'),base+'/events'),{type:'web',reason:'x',ts:serverTimestamp(),extra:1}));
    const evSnap=await assertSucceeds(get(query(ref(db('monitor'),base+'/events'),orderByChild('ts'),limitToLast(50))));
    const events=[];evSnap.forEach(ch=>{const r=ch.val();if(r&&typeof r.ts==='number')events.push({t:r.ts,msg:String(r.reason||r.type||'Aktivitas sprinkler')});});
    check('event read maps app contract',events.length===1&&Number.isFinite(events[0].t)&&events[0].msg==='Manual ON emulator');
    await pass('event push settings allowed',push(ref(db('settings'),base+'/events'),{type:'web',reason:'setting',ts:serverTimestamp()}));

    const payload=A.settingsPayload(C.toFirebase(C.normalize({controlBasis:'thi',profiles:{temperature:{threshold:31.5},thi:{threshold:74}}})));
    await pass('control settings write',update(ref(db('settings'),base+'/control'),{...payload,updatedAt:serverTimestamp(),updatedBy:'settings'}));
    await fail('control mode by settings denied',update(ref(db('settings'),base+'/control'),{mode:'manual',updatedAt:serverTimestamp(),updatedBy:'settings'}));
    await fail('control mode by monitor denied',update(ref(db('monitor'),base+'/control'),{mode:'manual',updatedAt:serverTimestamp(),updatedBy:'monitor'}));
    await fail('control unknown field denied',update(ref(db('operate'),base+'/control'),{hack:1,mode:'manual',updatedAt:serverTimestamp(),updatedBy:'operate'}));
    await pass('control mode by operate',update(ref(db('operate'),base+'/control'),{mode:'manual',updatedAt:serverTimestamp(),updatedBy:'operate'}));

    const ctl=(await get(ref(db('monitor'),base+'/control'))).val();
    const cfg=C.fromFirebase(ctl);
    check('control v2 parsed',ctl.controlPolicyVersion===2&&cfg.controlBasis==='thi'&&cfg.mode==='manual');
    check('control profiles stay separate',cfg.profiles.thi.threshold===74&&cfg.profiles.temperature.threshold===31.5);
    check('control round trip basis fields',ctl.thiThreshold===74&&ctl.tempThreshold===31.5&&ctl.thiSchN===0&&ctl.tempSchN===0);

    const schedule=C.toFirebase(C.normalize({controlBasis:'temperature',autoSrc:'schedule',schedules:[{date:'2026-11-20',start:'14:00',dur:10}]}));
    await pass('control schedule write',update(ref(db('settings'),base+'/control'),{...A.settingsPayload(schedule),updatedAt:serverTimestamp(),updatedBy:'settings'}));
    const sched=C.fromFirebase((await get(ref(db('monitor'),base+'/control'))).val());
    check('schedule contract parsed',sched.profiles.temperature.autoSrc==='schedule'&&sched.profiles.temperature.schedules[0].start==='14:00'&&sched.schedules[0].dur===10);
    await fail('schedule invalid time denied',update(ref(db('settings'),base+'/control'),{tempSch1Start:'25:99',updatedAt:serverTimestamp(),updatedBy:'settings'}));

    console.log(`INTEGRATION emulator PASS: ${count} checks; canonical telemetry -> dashboard parser, read permissions, control v2, events, log query.`);
  }finally{await env.cleanup();}
})().catch(error=>{console.error(error);process.exitCode=1;});
