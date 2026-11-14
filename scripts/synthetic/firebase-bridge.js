(() => {
  const query = new URLSearchParams(location.search);
  const scenario = query.get('scenario') || 'live';
  const interval = Math.max(500, Number(query.get('interval')) || 2000);
  const burst = query.has('burst') ? Math.max(0, Math.min(180, Number(query.get('burst')) || 0)) : 90;
  const accounts = {
    admin: { uid: 'syn-admin', email: 'admin@contoh.test', name: 'Adminfapet', record: { enabled: true, role: 'admin', email: 'admin@contoh.test', name: 'Adminfapet' } },
    operator: { uid: 'syn-operator', email: 'operator@contoh.test', name: 'Operator', record: { enabled: true, role: 'user', email: 'operator@contoh.test', name: 'Operator', permissions: { monitor: true, settings: true, operate: true } } },
    viewer: { uid: 'syn-viewer', email: 'viewer@contoh.test', name: 'Viewer', record: { enabled: true, role: 'user', email: 'viewer@contoh.test', name: 'Viewer', permissions: { monitor: true } } },
    nopermission: { uid: 'syn-none', email: 'nopermission@contoh.test', name: 'Tanpa izin', record: { enabled: true, role: 'user', permissions: {} } },
    disabled: { uid: 'syn-off', email: 'disabled@contoh.test', name: 'Nonaktif', record: { enabled: false, role: 'user' } }
  };
  const sessionRole = { live: 'admin', hot: 'admin', stale: 'admin', unknown: 'admin', partial: 'admin', thi: 'admin', manual: 'admin',
    operator: 'operator', viewer: 'viewer', noaccess: 'nopermission', disabled: 'disabled', login: null };
  const storageKey = 'scs_synthetic_user';
  let current = sessionStorage.getItem(storageKey);
  if (current === null) current = sessionRole[scenario] === undefined ? 'admin' : sessionRole[scenario] || '';
  if (current === '') current = null;

  let callbacks = {}, access = null, user = null, virtualNow = null, timer = null, generation = 0;
  let clockOffset=0, frozenClock=query.get('clock')==='fixed' ? Date.parse('2026-11-14T03:30:00Z') : null;
  const runtime={ day:null, today:0, phase:'idle', source:null, start:0, stop:0, duration:0, cooldown:0 };
  let latest=null;
  const control = { mode: scenario === 'manual' ? 'manual' : 'auto', manualSsr: 'off' };
  let settings = SCSControl.toFirebase(SCSControl.normalize({
    controlBasis: scenario === 'thi' ? 'thi' : 'temperature',
    profiles: {
      temperature: { threshold: 30, maxDuration: 600, cooldown: 7200 },
      thi: { threshold: 78, maxDuration: 600, cooldown: 7200 }
    }
  }));
  let events = [
    { ts: Date.now() - 40 * 60000, reason: 'Sprinkler menyala otomatis: suhu mencapai threshold' },
    { ts: Date.now() - 38 * 60000, reason: 'Sprinkler berhenti: durasi maksimum tercapai' },
    { ts: Date.now() - 95 * 60000, reason: 'Setting Suhu: threshold 30 °C, sepanjang waktu' }
  ];
  const directory = new Map([
    ['syn-admin', { email: 'admin@contoh.test', name: 'Adminfapet', role: 'admin', enabled: true }],
    ['syn-operator', { email: 'operator@contoh.test', name: 'Operator', role: 'user', enabled: true, permissions: { monitor: true, settings: true, operate: true } }],
    ['syn-viewer', { email: 'viewer@contoh.test', name: 'Viewer', role: 'user', enabled: true, permissions: { monitor: true } }],
    ['syn-lama', { email: 'cadangan@contoh.test', name: '', role: 'user', enabled: false, permissions: { monitor: true } }]
  ]);
  let userListeners = [];

  const nowMs = () => virtualNow ?? frozenClock ?? Date.now()+clockOffset;
  const can = permission => window.SCSAccess.can(access, permission);
  const need = permission => { if (!user || !can(permission)) throw new Error('Akun tidak memiliki izin untuk tindakan ini.'); };
  const wave = (t, i, amplitude, period) => Math.sin(t / period + i * 1.7) * amplitude;

  function cycle(raw,t){
    const cfg=SCSControl.fromFirebase(controlPayload()),p=cfg.profiles[cfg.controlBasis];
    const clockValid=scenario!=='time-unavailable',day=clockValid?SCS.wibDateStr(t):null;
    if(day && (!runtime.day || day>runtime.day)){runtime.day=day;runtime.today=0;}
    if(scenario==='quota')runtime.today=cfg.maxCyclesPerDay;
    if(scenario==='cooldown' && !runtime.stop){runtime.stop=t;runtime.cooldown=p.cooldown;runtime.phase='cooldown';}
    const stop=()=>{runtime.phase='cooldown';runtime.stop=t;runtime.source=null;runtime.cooldown=p.cooldown;};
    if(control.mode==='manual'){
      if(control.manualSsr==='on'){
        if(runtime.source!=='manual'){runtime.start=t;runtime.source='manual';}
        runtime.phase='spraying';
      }else if(runtime.phase==='spraying')stop();
    }else{
      if(runtime.source==='manual')stop();
      const on=runtime.phase==='spraying';
      const decision=SCS.decideAutomatic(cfg.controlBasis==='thi'?SCS.thiOf(raw.avg,average(['h1','h2','h3','h4'].map(k=>raw[k]))):raw.avg,on,{...p,maxDuration:on?runtime.duration:p.maxDuration,maxCyclesPerDay:cfg.maxCyclesPerDay},{
        complete:raw.validMask===63&&(cfg.controlBasis!=='thi'||raw.humidityValidMask===15),clockValid,
        scheduleActive:SCS.anyScheduleActive(t,p.schedules),runSeconds:(t-runtime.start)/1000,
        offSeconds:runtime.stop?(t-runtime.stop)/1000:p.cooldown,cyclesToday:runtime.today});
      if(decision==='off')stop();
      else if(decision==='on'){runtime.phase='spraying';runtime.source=p.autoSrc;runtime.start=t;runtime.duration=p.maxDuration;runtime.today++;}
    }
    if(runtime.phase==='cooldown' && (t-runtime.stop)/1000>=runtime.cooldown)runtime.phase='idle';
    const remain=runtime.phase==='spraying'&&runtime.source!=='manual'?Math.max(0,runtime.duration-(t-runtime.start)/1000):runtime.phase==='cooldown'?Math.max(0,runtime.cooldown-(t-runtime.stop)/1000):0;
    Object.assign(raw,{ssr:runtime.phase==='spraying'?1:0,ntpValid:clockValid,cycleDay:day,cyclesToday:runtime.today,cyclePhase:runtime.phase,cycleRemainSec:Math.ceil(remain),cycleSource:runtime.source,sprayStartedTs:runtime.phase==='spraying'?runtime.start:0,cooldownUntilTs:clockValid&&runtime.phase==='cooldown'?runtime.stop+runtime.cooldown*1000:0});
    return raw;
  }
  function sample(t) {
    if (scenario === 'unknown') return null;
    const hot = ['hot','manual','cycle','cooldown','quota','time-unavailable'].includes(scenario);
    const baseTemp = hot ? 31.4 : scenario === 'thi' ? 31.0 : 29.2;
    const raw = { ts: t, measuredTs: t, controlPolicyVersion: scenario==='version2'?2:3, controlBasis: settings.controlBasis, leftOnline: true, leftAgeMs: 800 };
    const dsMissing = scenario === 'partial' ? [2, 5] : [];
    const rhMissing = scenario === 'partial' ? [3] : [];
    let dsMask = 0, rhMask = 0, sum = 0, count = 0;
    for (let i = 0; i < 6; i++) {
      const value = Math.round((baseTemp + (i - 2.5) * 0.28 + wave(t, i, 0.35, 21000)) * 10) / 10;
      raw['t' + (i + 1)] = dsMissing.includes(i) ? null : value;
      if (!dsMissing.includes(i)) { dsMask |= 1 << i; sum += value; count++; }
    }
    raw.validMask = dsMask; raw.validCount = count; raw.avg = count ? Math.round(sum / count * 100) / 100 : null;
    for (let i = 0; i < 4; i++) {
      const value = Math.round((68 - i * 2.2 + wave(t, i + 3, 1.8, 30000)) * 10) / 10;
      raw['h' + (i + 1)] = rhMissing.includes(i) ? null : value;
      raw['d' + (i + 1)] = rhMissing.includes(i) ? null : Math.round((baseTemp + 0.6 - i * 0.2) * 10) / 10;
      if (!rhMissing.includes(i)) rhMask |= 1 << i;
    }
    raw.humidityValidMask = rhMask;
    return raw;
  }
  const average = values => { const good = values.filter(SCSTelemetry.finite); return good.length ? good.reduce((a, b) => a + b, 0) / good.length : null; };

  function controlPayload() { return { ...settings, mode: control.mode, manualSsr: control.manualSsr }; }
  function eventRows() { return events.slice().sort((a, b) => b.ts - a.ts).slice(0, 50).map(e => ({ t: e.ts, msg: String(e.reason) })); }

  function emitTelemetry(generationId) {
    if (generationId !== generation || !user || !can('monitor')) return;
    const t = nowMs();
    latest=scenario==='stale'?sample(t-180000):sample(t);
    if(latest && scenario!=='stale')cycle(latest,t);
    callbacks.onTelemetry?.(latest);
  }
  function herdSegment(startTs, windowS, zones, extra) {
    const offset = 7, local = new Date(startTs + offset * 3600e3).toISOString().slice(0, 19) + '.000+07:00';
    return { schemaVersion: 1, video: 'sintetis.mp4', windowStartTs: startTs, windowEndTs: startTs + windowS * 1000, startLocal: local, tzOffsetH: offset,
      windowS, samples: Math.round(windowS / 2), everyS: 2, maxGapS: 6, ts: startTs + windowS * 1000 + 1000, boundary: 'exact',
      person: { presentS: null, framesWithPerson: 4, samplesTotal: Math.round(windowS / 2) }, zones };
  }
  function herdDays() {
    const herd = query.get('herd') || 'empty';
    if (herd === 'error') return null;
    if (herd === 'empty') return {};
    const t = nowMs(), end = herd === 'stale' ? t - 40 * 3600e3 : t - 5 * 60e3, startTs = end - 600e3;
    const day = new Date(startTs + 7 * 3600e3).toISOString().slice(0, 10);
    const zone = (standing, lying, mixed, partial, unobserved, gap) => ({ durationsS: { standing, lying, mixed, partial, unobserved, gap }, unobservedReasons: { terhalang: unobserved } });
    return { [day]: { 'sintetis__00000000': herdSegment(startTs, 600, {
      R1_near: zone(180, 120, 20, 60, 160, 60), R2_mid: zone(90, 40, 10, 100, 300, 60), R3_far: zone(0, 0, 0, 30, 510, 60) }) } };
  }
  function emitHerd(generationId) {
    if (generationId !== generation || !user || !can('monitor')) return;
    callbacks.onHerd?.(herdDays());
  }
  function start(sessionId) {
    callbacks.onTransport?.(true);
    if (!can('monitor')) return;
    if (burst && scenario !== 'stale' && scenario !== 'unknown') {
      for (let i = burst; i >= 1; i--) { virtualNow = nowMs() - i * 10000; callbacks.onTelemetry?.(sample(virtualNow)); virtualNow=null; }
      virtualNow = null;
    }
    emitTelemetry(sessionId);
    callbacks.onControl?.(controlPayload());
    callbacks.onEvents?.(eventRows());
    emitHerd(sessionId);
    const rows = [];
    for (let i = 0; i < 40; i++) { const raw = sample(nowMs() - (i + 1) * 30000); if (raw) rows.push(SCSTelemetry.logRow(raw)); }
    callbacks.onSeedLogs?.(rows);
    timer = setInterval(() => emitTelemetry(sessionId), interval);
  }
  function stop() { clearInterval(timer); timer = null; }
  function applySession() {
    stop();
    const sessionId = ++generation;
    callbacks.onAccess?.(null);
    if (!current) { user = null; access = null; callbacks.onAuth?.(false, ''); callbacks.onTelemetry?.(null); return; }
    const account = accounts[current];
    user = { uid: account.uid, email: account.email };
    access = window.SCSAccess.normalize(account.record);
    callbacks.onAccess?.(access);
    callbacks.onAuth?.(true, account.email);
    start(sessionId);
  }
  async function connect(handlers) {
    callbacks = handlers;
    setTimeout(applySession, Math.max(0, Math.min(20000, Number(query.get('authDelay')) || 350)));
  }
  async function login(email) {
    const key = String(email).split('@')[0].toLowerCase().replace(/[^a-z]/g, '');
    const match = accounts[key] ? key : 'admin';
    current = match;
    sessionStorage.setItem(storageKey, current);
    applySession();
  }
  async function logout() {
    current = null;
    sessionStorage.setItem(storageKey, '');
    applySession();
  }
  function pushControl(obj) {
    if(obj.controlPolicyVersion===3 && !SCSControl.canApplyV3(latest,nowMs()))return Promise.reject(new Error('Firmware kebijakan 3 belum dikonfirmasi.'));
    for (const key of Object.keys(obj)) need(key === 'mode' || key === 'manualSsr' ? 'operate' : 'settings');
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'mode') control.mode = value;
      else if (key === 'manualSsr') control.manualSsr = value;
      else settings[key] = value;
    }
    callbacks.onControl?.(controlPayload());
    setTimeout(() => emitTelemetry(generation), 300);
    return Promise.resolve();
  }
  async function pushOverride(on, reason) {
    need('operate');
    await pushControl({ manualSsr: on ? 'on' : 'off' });
    await pushEvent(reason || (on ? 'Manual ON diminta' : 'Manual OFF diminta'));
  }
  function pushEvent(message) {
    if (!can('settings')) need('operate');
    events.push({ ts: Date.now(), reason: String(message).slice(0, 500) });
    callbacks.onEvents?.(eventRows());
    return Promise.resolve();
  }
  function emitUsers() {
    const rows = [...directory].map(([uid, record]) => ({ uid, ...record }));
    userListeners.forEach(fn => fn(rows));
  }
  function subscribeUsers(onUsers) {
    need('admin');
    userListeners.push(onUsers);
    setTimeout(emitUsers, 120);
    return () => { userListeners = userListeners.filter(fn => fn !== onUsers); };
  }
  async function saveUser(uid, record) {
    need('admin');
    if (uid === user.uid) throw new Error('Akses Admin sendiri tidak dapat diubah.');
    directory.set(uid, { ...window.SCSAccess.userRecord(record, 0) });
    emitUsers();
  }
  async function createUser(record) {
    need('admin');
    const uid = 'syn-' + Math.random().toString(36).slice(2, 8);
    directory.set(uid, { ...window.SCSAccess.accountRecord(record, 0) });
    emitUsers();
    return uid;
  }
  async function removeUserAccess(uid) {
    need('admin');
    if (uid === user.uid) throw new Error('Akun sendiri tidak dapat dihapus.');
    directory.delete(uid);
    emitUsers();
  }
  window.SCSFirebase = { connect, login, logout, pushControl, pushOverride, pushEvent, subscribeUsers, saveUser, createUser, removeUserAccess, now: nowMs };
  window.SCS_SYNTHETIC = { scenario, accounts: Object.keys(accounts), advance(seconds){
    if(!Number.isFinite(seconds)||seconds<0||seconds>86400)throw new Error('Rentang waktu sintetis tidak valid.');
    if(frozenClock!==null)frozenClock+=seconds*1000;else clockOffset+=seconds*1000;
    emitTelemetry(generation);return latest;
  } };
})();
