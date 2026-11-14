(function (root, factory) {
  const api = factory(typeof module !== 'undefined' && module.exports ? require('./core.js') : root.SCS);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SCSControl = api;
})(typeof self !== 'undefined' ? self : globalThis, (SCS) => {
  const POLICY_VERSION = 3;
  const MAX_COOLDOWN = 86400;
  const MAX_CYCLES = 100;
  const basisOf = c => c?.controlBasis === 'thi' ? 'thi' : 'temperature';
  const bounded = (v, min, max, fallback) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
  function profile(raw = {}, basis = 'temperature') {
    const thi = basis === 'thi';
    return { threshold: bounded(raw.threshold, thi ? 0 : -55, thi ? 120 : 125, thi ? 72 : 30),
      maxDuration: Math.round(bounded(raw.maxDuration,1,10800,120)),
      cooldown: Math.round(bounded(raw.cooldown,0,MAX_COOLDOWN,60)),
      autoSrc: SCS.autoSrcOf(raw), schedules: SCS.schedulesOf(raw,SCS.wibDateStr()) };
  }
  const cyclesOf = raw => Math.round(bounded(raw.maxCyclesPerDay,1,MAX_CYCLES,3));
  function normalize(raw = {}) {
    const controlBasis = basisOf(raw);
    const profiles = {
      temperature: profile(raw.profiles?.temperature || (controlBasis === 'temperature' ? raw : {})),
      thi: profile(raw.profiles?.thi || (controlBasis === 'thi' ? raw : {}),'thi')
    };
    return { mode: raw.mode === 'manual' ? 'manual' : 'auto', controlBasis, maxCyclesPerDay: cyclesOf(raw), profiles,
      ...profiles[controlBasis], schedules: profiles[controlBasis].schedules.map(s=>({...s})) };
  }
  function capture(cfg) {
    cfg.profiles[basisOf(cfg)] = profile(cfg,basisOf(cfg));
    return cfg;
  }
  function selectBasis(cfg, basis) {
    capture(cfg);
    return normalize({ ...cfg, controlBasis: basis });
  }
  function fromFirebase(raw = {}) {
    if (raw.controlPolicyVersion === 2 || raw.controlPolicyVersion === 3) {
      const profiles = {};
      for (const [basis,prefix] of [['temperature','temp'],['thi','thi']]) {
        const p = { schedules:slots(raw,prefix) };
        for (const k of ['threshold','maxDuration','cooldown','autoSrc']) p[k]=raw[prefix+k[0].toUpperCase()+k.slice(1)];
        profiles[basis]=profile(p,basis);
      }
      return normalize({mode:raw.mode,controlBasis:raw.controlBasis,maxCyclesPerDay:raw.maxCyclesPerDay,profiles});
    }
    return normalize({ ...raw, controlBasis:'temperature', maxCyclesPerDay:raw.maxCyclesPerDay,
      profiles:{ temperature:{ ...raw, schedOn:raw.schOn ?? raw.schedOn, schedules:slots(raw,'') } } });
  }
  function slots(raw, prefix) {
    const key = k => prefix ? prefix+k[0].toUpperCase()+k.slice(1) : k;
    if (Number.isInteger(raw[key('schN')])) return Array.from({length:Math.min(6,Math.max(0,raw[key('schN')]))},(_,i)=>({
      date:raw[key(`sch${i+1}Date`)],start:raw[key(`sch${i+1}Start`)],dur:raw[key(`sch${i+1}Dur`)] }));
    return prefix ? [] : SCS.schedulesOf({schedStart:raw.schStart,schedDur:raw.schDur},SCS.wibDateStr());
  }
  function toFirebase(cfg) {
    cfg=normalize(capture(cfg));
    const out={controlPolicyVersion:POLICY_VERSION,controlBasis:cfg.controlBasis,mode:cfg.mode,maxCyclesPerDay:cfg.maxCyclesPerDay};
    for (const [basis,prefix] of [['temperature','temp'],['thi','thi']]) {
      const p=cfg.profiles[basis];
      for (const k of ['threshold','maxDuration','cooldown','autoSrc']) out[prefix+k[0].toUpperCase()+k.slice(1)]=p[k];
      out[prefix+'SchN']=p.schedules.length;
      for(let i=0;i<6;i++) for(const [field,key] of [['date','Date'],['start','Start'],['dur','Dur']])
        out[`${prefix}Sch${i+1}${key}`]=p.schedules[i]?.[field] ?? null;
    }
    return out;
  }
  function canApplyV3(latest, nowMs = Date.now()) {
    if (latest?.controlPolicyVersion !== POLICY_VERSION || typeof latest.ts !== 'number' || !Number.isFinite(latest.ts)) return false;
    if (!Number.isFinite(nowMs)) return false;
    return nowMs - latest.ts <= 120000 && latest.ts - nowMs <= 5000;
  }
  return {normalize,profile,capture,selectBasis,fromFirebase,toFirebase,basisOf,canApplyV3,POLICY_VERSION,MAX_COOLDOWN,MAX_CYCLES};
});
