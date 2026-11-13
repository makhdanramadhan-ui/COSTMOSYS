(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SCS = Object.assign(root.SCS || {}, api);
})(typeof self !== 'undefined' ? self : globalThis, () => {
  function decideSprinkler(avg, on, cfg) {
    if (!on && avg >= cfg.threshold) return 'on';
    if (on && avg <= cfg.threshold - cfg.hysteresis) return 'off';
    return 'stay';
  }
  function autoSrcOf(cfg) {
    if (cfg && (cfg.autoSrc === 'schedule' || cfg.autoSrc === 'threshold')) return cfg.autoSrc;
    if (cfg && cfg.schedOn) return 'schedule';
    return 'threshold';
  }
  function decideAuto(avg, on, cfg, schedActive) {
    if (autoSrcOf(cfg) === 'schedule' && !schedActive) return on ? 'off' : 'stay';
    return decideSprinkler(avg, on, cfg);
  }
  function thiOf(t, rh) {
    if (typeof t !== 'number' || !Number.isFinite(t) || t < -55 || t > 125 ||
        typeof rh !== 'number' || !Number.isFinite(rh) || rh < 0 || rh > 100) return null;
    return (1.8*t+32) - (0.55-0.0055*rh)*(1.8*t-26);
  }
  function decideAutomatic(value, on, cfg, state) {
    if (!state.complete || typeof value !== 'number' || !Number.isFinite(value)) return 'off';
    if (autoSrcOf(cfg) === 'schedule' && !state.scheduleActive) return 'off';
    if (on && state.runSeconds >= cfg.maxDuration) return 'off';
    if (!on && state.offSeconds < cfg.cooldown) return 'stay';
    return decideSprinkler(value, on, cfg);
  }
  function classify(avg, cfg) {
    if (avg >= cfg.threshold + 1) return 'bahaya';
    if (avg >= cfg.threshold) return 'waspada';
    return 'normal';
  }
  function avgOf(values) {
    const v = values.filter((x) => typeof x === 'number' && isFinite(x));
    if (!v.length) return NaN;
    return v.reduce((a, b) => a + b, 0) / v.length;
  }
  function pruneLogs(logs, max) { return logs.slice(0, max); }
  function visibleCount(n) {
    if (n == null || !isFinite(n)) return null;
    return Math.max(0, Math.min(6, Math.floor(n)));
  }
  function sensorTitle(n) {
    if (n == null || !isFinite(n)) return '🌡️ Menunggu data sensor…';
    if (n <= 0) return '⚠️ Tidak ada sensor terdeteksi';
    return `🌡️ Sensor terdeteksi: ${n}`;
  }
  function hmToMin(s) {
    const m = /^(\d{1,2}):(\d{2})/.exec(s || '');
    if (!m) return NaN;
    const h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return NaN;
    return h * 60 + mi;
  }
  function scheduleActive(cur, start, dur) {
    if (!isFinite(cur) || !isFinite(start) || !(dur > 0)) return false;
    if (start + dur <= 1440) return cur >= start && cur < start + dur;
    return cur >= start || cur < (start + dur) % 1440;
  }
  function schedulesOf(cfg, todayStr) {
    let raw = [];
    if (cfg && Array.isArray(cfg.schedules)) raw = cfg.schedules;
    else if (cfg && typeof cfg.schedStart === 'string') raw = [{ start: cfg.schedStart, dur: cfg.schedDur }];
    const out = [];
    raw.forEach((s) => {
      if (!s || typeof s.start !== 'string' || !isFinite(hmToMin(s.start))) return;
      let date = s.date || '';
      if (!date) { if (!todayStr) return; date = todayStr; }
      else if (!idDateParts(date)) return;
      const dur = Math.min(180, Math.max(1, Math.round(+s.dur || 0)));
      if (!(dur > 0)) return;
      if (!out.some((o) => o.date === date && o.start === s.start)) out.push({ date, start: s.start, dur });
    });
    out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : hmToMin(a.start) - hmToMin(b.start)));
    return out.slice(0, 6);
  }
  function wibDateStr(d) {
    d = d || new Date();
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    const g = (t) => p.find((x) => x.type === t).value;
    return `${g('year')}-${g('month')}-${g('day')}`;
  }
  function wibDateTimeMs(dateStr, timeStr) {
    const D = (dateStr || '').split('-').map(Number);
    const T = (timeStr || '').split(':').map(Number);
    if (D.length < 3 || T.length < 2 || D.some((x) => !isFinite(x)) || T.some((x) => !isFinite(x))) return NaN;
    return Date.UTC(D[0], D[1] - 1, D[2], T[0] - 7, T[1]);
  }
  function slotState(s, nowMs) {
    const t0 = wibDateTimeMs(s.date, s.start);
    if (!isFinite(t0)) return 'past';
    if (nowMs < t0) return 'future';
    if (nowMs < t0 + s.dur * 60000) return 'active';
    return 'past';
  }
  function anyScheduleActive(nowMs, slots) {
    return (slots || []).some((s) => slotState(s, nowMs) === 'active');
  }
  function nextSchedule(nowMs, slots) {
    let best = null;
    (slots || []).forEach((s) => {
      const t0 = wibDateTimeMs(s.date, s.start);
      if (!isFinite(t0) || slotState(s, nowMs) === 'past') return;
      if (!best || t0 < best.t0) best = { date: s.date, start: s.start, dur: s.dur, t0, active: nowMs >= t0 };
    });
    return best;
  }
  function prunePastSlots(slots, nowMs) {
    return (slots || []).filter((s) => slotState(s, nowMs) !== 'past');
  }
  const ID_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const ID_DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  function idDateParts(dateStr) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
    if (!m) return null;
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    const d = new Date(t);
    if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
    return { y: +m[1], mo: +m[2], d: +m[3], wd: ID_DAYS[d.getUTCDay()], mon: ID_MONTHS[+m[2] - 1] };
  }
  function formatIDDate(dateStr) {
    const p = idDateParts(dateStr);
    return p ? `${p.wd}, ${p.d} ${p.mon} ${p.y}` : null;
  }
  function formatIDSlot(s) {
    const p = idDateParts(s.date);
    const day = p ? `${p.wd} ${p.d} ${p.mon}` : s.date;
    return `${day} • ${s.start} (${s.dur} mnt)`;
  }
  function logToCsv(r, threshold) {
    const w = new Date(r.t).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const st = r.avg >= threshold ? 'PANAS' : 'NORMAL';
    return `"${w}",${r.s.join(',')},${r.avg},${st},${r.spray ? 'ON' : 'OFF'}`;
  }
  return { decideSprinkler, decideAuto, decideAutomatic, thiOf, autoSrcOf, classify, avgOf, pruneLogs, logToCsv, hmToMin, scheduleActive, schedulesOf, anyScheduleActive, nextSchedule, prunePastSlots, slotState, wibDateStr, wibDateTimeMs, formatIDDate, formatIDSlot, sensorTitle, visibleCount };
});
