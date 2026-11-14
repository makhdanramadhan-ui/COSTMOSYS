const $ = (id) => document.getElementById(id);
const SENSOR_NAMES = ['Titik 1 • Depan', 'Titik 2 • Depan', 'Titik 3 • Tengah', 'Titik 4 • Tengah', 'Titik 5 • Belakang', 'Titik 6 • Belakang'];
const COLORS = ['#bd6b3a','#9b831e','#328b70','#4a86ae','#9272bd','#b96787'];
const PAGE_TITLES = { dash:'Overview', log:'Riwayat sensor', event:'Aktivitas sprinkler', herd:'Aktivitas Sapi', admin:'Dashboard Admin' };

let temps = Array(6).fill(null);
let humidities = Array(4).fill(null);
let telemetry = null, sensorView = SCSTelemetry.view(null), transportConnected = false;
const fmtValue = (value, digits = 1) => SCSTelemetry.finite(value) ? value.toFixed(digits) : '—';
let lastUpdate = null;
let sprinklerOn = false;
let herdDays = null, herdResolved = false, herdFailed = false, herdView = SCSHerd.view(null), selectedHerdDay = null, telemetryResolved = false;
let history = [];
let logs = [];
let events = [];
try { const saved = JSON.parse(localStorage.getItem('scs_events') || '[]'); if (Array.isArray(saved)) events = saved.slice(0,50); } catch {}
let fbConnected = false;
let controlLoaded = false;
let accessState=null;
let accessRevision=0;
window.smartcowAccess=null;
const hasAccess=permission=>SCSAccess.can(accessState,permission);
let appliedCfg = SCSControl.normalize(CFG), settingsDirty = false, savingSettings = false;
const basisName = cfg => cfg.controlBasis === 'thi' ? 'THI' : 'Suhu';
const basisUnit = cfg => cfg.controlBasis === 'thi' ? ' THI' : ' °C';
const metricValue = (view,cfg) => cfg.controlBasis === 'thi' ? view.thi : view.avg;
const firmwareReady = () => sensorView.online && SCSControl.canApplyV3(telemetry, window.SCSFirebase?.now() || Date.now());
const profileOf = basis => appliedCfg.profiles[basis];
const isAppliedBasis = basis => controlLoaded && appliedCfg.controlBasis === basis;
function markSettingsDirty(){ settingsDirty=true; saveCfg(); $('settingsStatus').textContent='Belum disimpan. Pilih Simpan pengaturan untuk menerapkan.'; }

let themeFrame = null;
function curTheme(){ return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'; }
function applyTheme(t){
  cancelAnimationFrame(themeFrame);
  const changed = curTheme() !== t;
  document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark';
  try { localStorage.setItem('scs_theme', curTheme()); } catch {}
  const light = curTheme() === 'light';
  const b = $('themeBtn');
  if (b){ b.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-${light ? 'moon' : 'sun'}"/></svg>`; b.title = light ? 'Gunakan tema gelap' : 'Gunakan tema terang'; b.setAttribute('aria-label', b.title); b.setAttribute('aria-pressed', String(!light)); }
  const end = performance.now() + (changed ? reducedMotion() ? 120 : 240 : 0);
  function paint(now){
    drawChart();
    themeFrame = now < end ? requestAnimationFrame(paint) : null;
  }
  paint(performance.now());
}
function chartTheme(){
  return {
    grid: getComputedStyle($('chart').closest('.card')).borderColor,
    txt: getComputedStyle($('chartTitle').nextElementSibling).color,
    threshold: getComputedStyle(document.documentElement).getPropertyValue('--threshold-line').trim(),
    thi: getComputedStyle($('thiValue').parentElement).color,
    avg: getComputedStyle($('avgTemp').parentElement).color
  };
}

function tickClock(){
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  const fmtD = new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',weekday:'long',day:'numeric',month:'long',year:'numeric'});
  $('clock').textContent = fmt.format(now).replace(/\./g,':');
  $('dateLine').textContent = fmtD.format(now);
}
setInterval(tickClock, 1000); tickClock();

let renderedCount = 6;
function buildGrid(count){
  renderedCount = count;
  const g = $('sensorGrid'); g.innerHTML = '';
  g.style.display = count === 0 ? 'none' : '';
  $('noSensor').style.display = count === 0 ? 'block' : 'none';
  for (let i = 0; i < count; i++){
    const d = document.createElement('div');
    d.className = 'sensor'; d.id = 'sensor'+i;
    d.innerHTML = `<div class="sensor-meta"><span>DS${i+1}</span><span>${i < 3 ? 'KANAN' : 'KIRI'}</span></div><div class="s-name">${SENSOR_NAMES[i]}</div>
      <div class="s-temp">—</div>
      <div class="bar"><i></i></div>
       <div class="s-state off">MENUNGGU</div>`;
    g.appendChild(d);
  }
  renderLegend();
}
function renderLegend(){
  const leg = $('legend'); leg.innerHTML = '';
  const rh = $('chartMetric').value === 'humidity';
  if ($('chartMetric').value === 'thi'){ leg.textContent='THI agregat · 6 DS + 4 DHT'; return; }
  for (let i = 0; i < (rh ? 4 : 6); i++){
    const s = document.createElement('span');
    s.innerHTML = `<i class="swatch" style="background:${COLORS[i]}"></i> ${rh ? 'DHT' : 'DS'}${i+1}`;
    leg.appendChild(s);
  }
}
function buildHumidityGrid(){
  $('humidityGrid').innerHTML = Array.from({length:4}, (_,i) => `<div class="sensor humidity-sensor" id="humidity${i}"><div class="sensor-meta"><span>DHT${i+1}</span><span>${i < 2 ? 'KANAN' : 'KIRI'}</span></div><div class="s-name">Kelembapan udara</div><div class="s-temp">—</div><div class="bar"><i></i></div><div class="dht-companion hint">Suhu DHT: —</div><div class="s-state off">MENUNGGU</div></div>`).join('');
}
function buildLogHead(count){
  const tr = $('logHead'); if (!tr) return;
  let h = '<th>Waktu (WIB)</th>';
  for (let i = 1; i <= count; i++) h += `<th>DS${i} °C</th>`;
  for (let i = 1; i <= 4; i++) h += `<th>DHT${i} %RH</th>`;
  h += '<th>Rata² DS</th><th>Rata² RH</th><th>THI</th><th>Status dasar terpilih</th><th>Sprinkler</th>';
  tr.innerHTML = h;
}
function tempColor(t){
  const profile=profileOf('temperature');
  const style=getComputedStyle(document.documentElement);
  if (!isAppliedBasis('temperature')) return style.getPropertyValue('--txt');
  const zone=zoneOf(t,profile);
  return style.getPropertyValue(zone==='hot' ? '--negative-txt' : zone==='warn' ? '--warning-txt' : '--positive-txt');
}
function zoneOf(value, profile){
  if (!SCSTelemetry.finite(value)) return null;
  if (value >= profile.threshold) return 'hot';
  if (value >= profile.threshold - 1) return 'warn';
  return 'ok';
}
function placeZones(avg, complete){
  const box = $('zoneTemp'), profile = profileOf('temperature');
  const on = isAppliedBasis('temperature');
  const mark = box.querySelector('.ruler-mark');
  box.dataset.state = on ? 'on' : 'off';
  const zone = on && complete ? zoneOf(avg, profile) : null;
  box.dataset.zone = zone || '';
  const f = v => v.toFixed(1);
  const low = profile.threshold - 1;
  const lo = Math.floor(Math.min(24, low - 4)), hi = Math.ceil(Math.max(38, profile.threshold + 4));
  const at = v => Math.min(100, Math.max(0, (v - lo) / (hi - lo) * 100));
  const ok = box.querySelector('.zone-ok'), warn = box.querySelector('.zone-warn'), hot = box.querySelector('.zone-hot');
  if (on){
    ok.style.width = at(low) + '%';
    warn.style.left = at(low) + '%'; warn.style.width = (at(profile.threshold) - at(low)) + '%';
    hot.style.left = at(profile.threshold) + '%'; hot.style.width = (100 - at(profile.threshold)) + '%';
  }
  for (const [id, text] of [['zoneOkText', on ? `< ${f(low)} °C` : 'Belum aktif'], ['zoneWarnText', on ? `${f(low)} ≤ T < ${f(profile.threshold)} °C` : 'Belum aktif'], ['zoneHotText', on ? `≥ ${f(profile.threshold)} °C` : 'Belum aktif']]) $(id).textContent = text;
  $('zoneNote').textContent = on
    ? `Oranye menandai 1 °C sebelum threshold ${f(profile.threshold)} °C, hanya untuk tampilan. Warna bukan diagnosis sapi, batas mati, atau status sprinkler. Threshold hanya memulai siklus; durasi, cooldown, kuota, sensor, dan jadwal dijalankan perangkat.`
    : 'Indikator threshold suhu belum aktif. Pilih dasar Suhu lalu simpan untuk melihat indikator. Pembacaan sensor tetap tersedia.';
  for (const name of ['ok','warn','hot']) box.querySelector('.zone-legend .zone-' + name).classList.toggle('active', zone === name);
  mark.hidden = !zone;
  if (!mark.hidden) mark.style.left = at(avg) + '%';
  $('zoneLo').textContent = String(lo); $('zoneHi').textContent = String(hi);
}
function placeRuler(id, value, lo, hi, threshold, spanLow, spanHigh){
  const box = $(id), mark = box.querySelector('.ruler-mark'), thr = box.querySelector('.ruler-thr'), span = box.querySelector('.ruler-span');
  const at = v => Math.min(100, Math.max(0, (v - lo) / (hi - lo) * 100));
  mark.hidden = !SCSTelemetry.finite(value);
  if (!mark.hidden) mark.style.left = at(value) + '%';
  if (thr){ thr.hidden = !SCSTelemetry.finite(threshold); if (!thr.hidden) thr.style.left = at(threshold) + '%'; }
  if (span){
    span.hidden = !(SCSTelemetry.finite(spanLow) && SCSTelemetry.finite(spanHigh));
    if (!span.hidden){ span.style.left = at(spanLow) + '%'; span.style.width = Math.max(1.5, at(spanHigh) - at(spanLow)) + '%'; }
  }
}
function renderSensors(){
  const tempProfile=profileOf('temperature'), thiProfile=profileOf('thi');
  const temperatureActive=isAppliedBasis('temperature'), thiActive=isAppliedBasis('thi');
  document.querySelectorAll('[data-threshold-basis]').forEach(el=>{ el.hidden=!isAppliedBasis(el.dataset.thresholdBasis); });
  const shown = temps.filter(SCSTelemetry.finite);
  temps.forEach((t,i)=>{
    const el = $('sensor'+i); if(!el) return;
    const valid = SCSTelemetry.finite(t);
    el.classList.toggle('sensor-unavailable', !valid);
    if (!valid){
      el.querySelector('.s-temp').textContent = '—';
      el.querySelector('.bar i').style.width = '0%';
      const st = el.querySelector('.s-state'); st.className = 's-state off';
      st.textContent = sensorView.dsStates[i] === 'stale' ? 'DATA LAMA' : 'BELUM TERBACA';
      return;
    }
    el.querySelector('.s-temp').textContent = t.toFixed(1)+'°C';
    el.querySelector('.s-temp').style.color = tempColor(t);
    const pct = Math.min(100, Math.max(4, (t-25)/(38-25)*100));
    const bar = el.querySelector('.bar i');
    bar.style.width = pct+'%'; bar.style.background = tempColor(t);
    const st = el.querySelector('.s-state');
    if (!temperatureActive){ st.textContent = 'TERBACA · MONITORING'; st.className = 's-state off'; }
    else if (zoneOf(t, tempProfile) === 'hot'){ st.textContent = 'THRESHOLD TERCAPAI'; st.className = 's-state hot'; }
    else if (zoneOf(t, tempProfile) === 'warn'){ st.textContent = 'MENDEKATI THRESHOLD'; st.className = 's-state warn'; }
    else { st.textContent = 'DI BAWAH RENTANG PENDEKATAN'; st.className = 's-state ok'; }
  });
  const avg = sensorView.avg;
  $('avgTemp').textContent = fmtValue(avg);
  $('minTemp').textContent = shown.length ? Math.min(...shown).toFixed(1)+'°C' : '—';
  $('maxTemp').textContent = shown.length ? Math.max(...shown).toFixed(1)+'°C' : '—';
  $('thresholdLabel').textContent = controlLoaded ? tempProfile.threshold.toFixed(1)+'°C' : '—';
  const pill = $('avgStatus');
  if (!SCSTelemetry.finite(avg)){ pill.textContent='DATA BELUM TERSEDIA'; pill.className='status-pill neutral'; }
  else if (!temperatureActive){ pill.textContent=sensorView.complete ? 'MONITORING SUHU' : 'DATA SUHU PARSIAL · MONITORING'; pill.className='status-pill neutral'; }
  else if (!sensorView.complete){ pill.textContent='DATA PARSIAL · AUTO SUHU DIBLOKIR'; pill.className='status-pill neutral'; }
  else if (zoneOf(avg, tempProfile) === 'hot'){ pill.textContent='THRESHOLD SUHU TERCAPAI'; pill.className='status-pill bahaya'; }
  else if (zoneOf(avg, tempProfile) === 'warn'){ pill.textContent='MENDEKATI THRESHOLD'; pill.className='status-pill waspada'; }
  else { pill.textContent='DI BAWAH RENTANG PENDEKATAN'; pill.className='status-pill normal'; }
  $('dsSummary').textContent = `${sensorView.validCount}/6 DS valid · rata-rata ${sensorView.complete ? 'lengkap' : 'parsial'}${sensorView.legacy ? ' · firmware lama' : ''}`;
  $('sensorTitle').textContent = `6 titik suhu · ${sensorView.validCount} valid`;
  $('noSensor').style.display = telemetry && !shown.length ? '' : 'none';
  $('updateAge').textContent = sensorView.ts ? 'Update ' + new Date(sensorView.ts).toLocaleTimeString('id-ID',{timeZone:'Asia/Jakarta'}) + ' WIB · ' + (sensorView.online ? 'terkini' : 'kedaluwarsa') : 'Belum ada telemetry';
  humidities.forEach((h,i) => {
    const el = $('humidity'+i), valid = SCSTelemetry.finite(h); if (!el) return;
    el.classList.toggle('sensor-unavailable', !valid);
    el.querySelector('.s-temp').textContent = valid ? h.toFixed(1) + '%' : '—';
    el.querySelector('.bar i').style.width = valid ? h + '%' : '0%';
    el.querySelector('.dht-companion').textContent = 'Suhu DHT: ' + fmtValue(sensorView.d[i]) + ' °C';
    const st = el.querySelector('.s-state'); st.className = 's-state ' + (valid ? 'ok' : 'off');
    st.textContent = valid ? 'TERBACA' : sensorView.rhStates[i] === 'stale' ? 'DATA LAMA' : 'BELUM TERBACA';
  });
  const goodRH = humidities.filter(SCSTelemetry.finite);
  $('avgHumidity').textContent = fmtValue(sensorView.humidityAvg);
  $('minHumidity').textContent = goodRH.length ? Math.min(...goodRH).toFixed(1)+'%' : '—';
  $('maxHumidity').textContent = goodRH.length ? Math.max(...goodRH).toFixed(1)+'%' : '—';
  $('humidityCount').textContent = `${sensorView.humidityValidCount}/4 valid`;
  $('rhSummary').textContent = `${sensorView.humidityValidCount}/4 DHT valid · RH untuk THI`;
  $('humidityStatus').textContent = sensorView.humidityComplete ? '4 TITIK TERPANTAU' : goodRH.length ? 'DATA KELEMBAPAN PARSIAL' : 'DATA BELUM TERSEDIA';
  $('humidityStatus').className = 'status-pill ' + (sensorView.humidityComplete ? 'normal' : 'neutral');
  $('thiValue').textContent=fmtValue(sensorView.thi);
  for (const id of ['avgTemp','avgHumidity','thiValue']) $(id).parentElement?.classList.toggle('no-data', $(id).textContent==='—');
  $('thiThresholdLabel').textContent=controlLoaded ? thiProfile.threshold.toFixed(1) : '—';
  $('thiSummary').textContent=`${sensorView.validCount}/6 DS + ${sensorView.humidityValidCount}/4 DHT valid · THI agregat, bukan per titik`;
  const thiPill=$('thiStatus');
  if (!sensorView.thiComplete){ thiPill.textContent='PERLU 6 DS + 4 DHT VALID'; thiPill.className='status-pill neutral'; }
  else if (!thiActive){ thiPill.textContent='MONITORING THI'; thiPill.className='status-pill neutral'; }
  else { thiPill.textContent=sensorView.thi>=thiProfile.threshold ? 'THRESHOLD THI TERCAPAI' : 'DI BAWAH THRESHOLD THI'; thiPill.className='status-pill '+(sensorView.thi>=thiProfile.threshold ? 'waspada' : 'normal'); }
  for (const [id, name, online] of [['rightNode','Perangkat utama',sensorView.online],['leftNode','Sensor tambahan',sensorView.leftOnline]]){
    $(id).textContent = `${name} · ${online ? 'online' : 'belum terhubung'}`; $(id).classList.toggle('online', online);
  }
  placeZones(avg, sensorView.complete);
  placeRuler('rulerRh', sensorView.humidityAvg, 20, 100, null, goodRH.length ? Math.min(...goodRH) : null, goodRH.length ? Math.max(...goodRH) : null);
  placeRuler('rulerThi', sensorView.thi, 60, 95, thiActive ? thiProfile.threshold : null, null, null);
  return avg;
}

function refreshTelemetry(){
  sensorView = SCSTelemetry.view(telemetry, window.SCSFirebase?.now() || Date.now());
  sprinklerOn = sensorView.ssr === 1;
  temps = sensorView.s; humidities = sensorView.h;
  renderSensors(); renderSprinkler();
  setConn(!authResolved ? 'sim' : !fbConnected ? 'login' : hasAccess('monitor') && !telemetryResolved ? 'sim' : !transportConnected ? 'err' : sensorView.online ? 'live' : 'offline');
  $('btnSprayOn').disabled = $('btnSprayOff').disabled = !hasAccess('operate') || CFG.mode !== 'manual' || !controlLoaded || !fbConnected || !sensorView.online || !transportConnected;
  $('btnManual').disabled = !hasAccess('operate') || !fbConnected || !controlLoaded || !transportConnected || !sensorView.online || savingSettings;
  $('btnAuto').disabled = $('btnManual').disabled || !firmwareReady();
  autoControl(sensorView.avg);
  $('firmwareNotice').hidden=firmwareReady();
  $('btnSaveCfg').disabled = !hasAccess('settings') || CFG.mode!=='auto' || !fbConnected || !controlLoaded || !transportConnected || !firmwareReady() || savingSettings;
  $('btnLogNow').disabled = !hasAccess('monitor') || !sensorView.online || !fbConnected;
  const locked = $('btnSaveCfg').disabled;
  document.querySelectorAll('.control-card input, .control-card button:not(#btnSaveCfg)').forEach(el => { el.disabled = locked || el.id === 'btnAddSched' && schedSlots().length >= 6; });
  renderConditions();
}

const NUM_ID = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
const formatDuration = seconds => {
  const s = Math.round(seconds);
  if (s >= 3600) return `${Math.floor(s / 3600)} j ${Math.floor(s % 3600 / 60)} m`;
  if (s >= 60) return `${Math.floor(s / 60)} m ${s % 60} d`;
  return `${s} d`;
};
const formatAge = ms => ms < 0 ? 'waktu umpan lebih maju dari server' : ms < 90000 ? 'baru saja' : ms < 5400000 ? `${Math.round(ms / 60000)} menit lalu` : ms < 172800000 ? `${Math.round(ms / 3600000)} jam lalu` : `${Math.round(ms / 86400000)} hari lalu`;
const formatStamp = ts => new Date(ts).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).replace(/\./g, ':') + ' WIB';
const ZONE_LABELS = { standingS: 'Berdiri', lyingS: 'Berbaring', mixedS: 'Campuran', partialS: 'Sebagian teramati', unobservedS: 'Kurang terlihat', gapS: 'Celah antar sampel' };
function setPill(id, text, kind){ $(id).textContent = text; $(id).className = 'status-pill ' + kind; }
function herdState(){
  if (!fbConnected || !hasAccess('monitor') || !herdResolved) return 'checking';
  if (herdFailed) return 'error';
  if (!herdView.present) return 'empty';
  return herdView.stale ? 'stale' : 'fresh';
}
function latestHerdDay(){ return herdView.days.find(d => d.day === herdView.latest?.day) || null; }
function renderConditions(){
  const synthetic = !!window.SCS_SYNTHETIC;
  $('condSynthetic').hidden = !synthetic;
  const view = sensorView, ready = fbConnected && hasAccess('monitor');
  const basis = appliedCfg.controlBasis, profile = profileOf(basis);
  const value = basis === 'thi' ? view.thi : view.avg, complete = basis === 'thi' ? view.thiComplete : view.complete;
  const parts = [];
  if (SCSTelemetry.finite(view.avg)) parts.push(`Suhu rata-rata ${view.avg.toFixed(1)} °C dari ${view.validCount}/6 titik DS`);
  if (SCSTelemetry.finite(view.thi)) parts.push(`THI agregat ${view.thi.toFixed(1)}`);
  if (!ready || !view.online || !parts.length){
    setPill('condHeatPill', ready && telemetryResolved ? 'DATA TIDAK TERKINI' : 'MENUNGGU DATA', 'neutral');
    $('condHeatDetail').textContent = ready && telemetryResolved ? 'Tidak ada pembacaan sensor yang terkini. Paparan panas tidak dinilai dari nilai lama.' : 'Menunggu pembacaan sensor pertama.';
  } else {
    const reached = controlLoaded && complete && SCSTelemetry.finite(value) && value >= profile.threshold;
    const near = controlLoaded && complete && basis === 'temperature' && zoneOf(value, profile) === 'warn';
    if (!controlLoaded) setPill('condHeatPill', 'MONITORING', 'neutral');
    else if (!complete) setPill('condHeatPill', 'DATA PARSIAL', 'neutral');
    else if (reached) setPill('condHeatPill', 'THRESHOLD TERCAPAI', 'bahaya');
    else if (near) setPill('condHeatPill', 'MENDEKATI THRESHOLD', 'waspada');
    else setPill('condHeatPill', 'DI BAWAH THRESHOLD', 'normal');
    const limit = controlLoaded ? ` Threshold terapan ${basisName(appliedCfg)}: ${profile.threshold.toFixed(1)}${basisUnit(appliedCfg)}.` : ' Threshold belum dimuat.';
    $('condHeatDetail').textContent = parts.join(' · ') + '.' + limit;
  }
  const spray = $('sprinklerText').textContent;
  setPill('condSprayPill', ready ? spray : 'BELUM DIKETAHUI', ready && sensorView.ssr === 1 ? 'normal' : 'neutral');
  $('condSprayDetail').textContent = ready && view.online ? `${$('cyclePhase').textContent} ${$('cycleQuota').textContent}` : 'Menunggu laporan perangkat yang terkini. Nilai lama tidak dipakai.';
  const state = herdState(), day = latestHerdDay();
  const link = document.querySelector('.cond-link');
  link.disabled = !ready;
  const pending = { checking: ['MEMERIKSA UMPAN', 'Memeriksa umpan pengamatan…'], error: ['UMPAN TIDAK TERBACA', 'Umpan pengamatan tidak dapat dibaca. Tidak ada nilai yang ditampilkan.'],
    empty: ['BELUM ADA UMPAN', 'Belum ada pengamatan kamera yang dikirim. Kosong bukan berarti sapi tidak aktif atau kondisi normal.'] };
  if (pending[state]){
    for (const id of ['condPosture', 'condPerson']){ setPill(id + 'Pill', pending[state][0], 'neutral'); $(id + 'Detail').textContent = pending[state][1]; }
    return;
  }
  const names = day ? Object.keys(day.zones) : [];
  const coverage = names.map(n => day.zones[n].coveragePct);
  const age = herdView.latest ? `terakhir diproses ${formatStamp(herdView.latest.windowEndTs)} (${formatAge(herdView.latest.ageMs)})` : '';
  const stale = state === 'stale';
  setPill('condPosturePill', stale ? 'UMPAN LAMA' : 'TERAMATI', 'neutral');
  $('condPostureDetail').textContent = names.length
    ? `${names.length} zona, cakupan pengamatan ${NUM_ID.format(Math.min(...coverage))}–${NUM_ID.format(Math.max(...coverage))}% dari ${formatDuration(day.windowS)} video yang diproses pada ${day.day}; ${age}.`
    : `Tidak ada zona valid pada ${herdView.latest.day}; ${age}.`;
  const known = day && day.personFrames !== null && day.samples;
  setPill('condPersonPill', stale ? 'UMPAN LAMA' : !known ? 'TIDAK DIKETAHUI' : day.personFrames > 0 ? 'ORANG TERDETEKSI' : 'TIDAK ADA DETEKSI', 'neutral');
  $('condPersonDetail').textContent = known
    ? `${day.personFrames} dari ${day.samples} sampel memuat orang pada ${day.day}. ${day.personFrames > 0 ? 'Aktivitas orang dapat memengaruhi postur yang terbaca.' : 'Hasil nol bukan bukti tidak ada orang.'}`
    : 'Jumlah sampel dengan orang tidak tersedia pada umpan ini.';
}
function herdZoneCard(name, zone){
  const card = document.createElement('article');
  card.className = 'card zone-card';
  const title = document.createElement('h3'); title.textContent = name.replace(/_/g, ' · ');
  const cover = document.createElement('div'); cover.className = 'coverage';
  const bar = document.createElement('div'); bar.className = 'coverage-bar'; bar.setAttribute('aria-hidden', 'true');
  const fill = document.createElement('i'); fill.style.width = Math.min(100, zone.coveragePct) + '%'; bar.append(fill);
  const text = document.createElement('p');
  const strong = document.createElement('b'); strong.textContent = NUM_ID.format(zone.coveragePct) + '%';
  text.append(strong, `postur teramati dari ${formatDuration(zone.windowS)} yang diproses (${zone.windows} jendela)`);
  cover.append(bar, text);
  const list = document.createElement('dl'); list.className = 'duration-list';
  for (const [key, label] of Object.entries(ZONE_LABELS)){
    const dt = document.createElement('dt'); dt.textContent = label;
    const dd = document.createElement('dd'); dd.textContent = formatDuration(zone[key]);
    list.append(dt, dd);
  }
  card.append(title, cover, list);
  const reasons = Object.entries(zone.reasonsS).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (reasons.length){
    const p = document.createElement('p'); p.className = 'zone-reasons';
    p.textContent = 'Alasan kurang terlihat: ' + reasons.map(([k, v]) => `${k.replace(/_/g, ' ')} ${formatDuration(v)}`).join(', ') + '.';
    card.append(p);
  }
  return card;
}
function renderHerd(){
  herdView = herdFailed ? SCSHerd.view(null) : SCSHerd.view(herdDays, window.SCSFirebase?.now() || Date.now());
  $('herdSynthetic').hidden = !window.SCS_SYNTHETIC;
  const state = herdState();
  const texts = {
    checking: ['MEMERIKSA UMPAN', 'Memeriksa umpan aktivitas…'],
    error: ['UMPAN TIDAK TERBACA', 'Umpan aktivitas tidak dapat dibaca. Periksa koneksi atau izin akun. Tidak ada data yang ditampilkan.'],
    empty: ['BELUM ADA UMPAN', 'Belum ada pengamatan zona dari kamera. Penerbit umpan belum aktif, sehingga halaman ini kosong. Kosong bukan berarti sapi tidak aktif atau kondisi normal.'],
    stale: ['UMPAN LAMA', 'Pengamatan terakhir lebih tua dari 24 jam. Data di bawah adalah catatan lama, bukan kondisi sekarang.'],
    fresh: ['UMPAN TERKINI', 'Durasi di bawah hanya mencakup rentang video yang benar-benar diproses, bukan seluruh hari.']
  }[state];
  setPill('herdPill', texts[0], 'neutral');
  $('herdMessage').textContent = texts[1];
  const live = state === 'fresh' || state === 'stale';
  const meta = $('herdMeta'), controls = $('herdControls'), zones = $('herdZones'), select = $('herdDay');
  meta.hidden = controls.hidden = !live;
  zones.replaceChildren();
  meta.replaceChildren();
  document.querySelectorAll('.herd-quality').forEach(n => n.remove());
  if (!live){ select.replaceChildren(); selectedHerdDay = null; return; }
  const days = herdView.days.filter(d => Object.keys(d.zones).length).slice().reverse();
  if (!days.some(d => d.day === selectedHerdDay)) selectedHerdDay = herdView.latest.day;
  if (!days.some(d => d.day === selectedHerdDay) && days.length) selectedHerdDay = days[0].day;
  select.replaceChildren(...days.map(d => { const o = document.createElement('option'); o.value = d.day; o.textContent = `${d.day} · ${d.segments} rekaman`; return o; }));
  select.value = selectedHerdDay;
  const day = days.find(d => d.day === selectedHerdDay);
  const add = (label, value) => { const s = document.createElement('span'); s.append(label + ' '); const b = document.createElement('b'); b.textContent = value; s.append(b); meta.append(s); };
  add('Terakhir diproses', `${formatStamp(herdView.latest.windowEndTs)} · ${formatAge(herdView.latest.ageMs)}`);
  if (day) add('Rentang diproses hari ini', `${formatDuration(day.windowS)} dari ${day.segments} rekaman`);
  const notes = [];
  if (herdView.unknownBoundary) notes.push(`${herdView.unknownBoundary} rekaman melewati tengah malam tanpa bukti waktu, tidak dihitung`);
  if (herdView.overlapDropped) notes.push(`${herdView.overlapDropped} jendela tumpang tindih tidak dihitung ganda`);
  if (herdView.invalidSegments) notes.push(`${herdView.invalidSegments} rekaman tidak valid ditolak`);
  document.querySelectorAll('.herd-quality').forEach(n => n.remove());
  if (notes.length){
    const details = document.createElement('details'); details.className = 'herd-quality';
    const summary = document.createElement('summary'); summary.textContent = 'Catatan kualitas umpan';
    const ul = document.createElement('ul'); ul.append(...notes.map(n => { const li = document.createElement('li'); li.textContent = n; return li; }));
    details.append(summary, ul); meta.after(details);
  }
  if (day) for (const name of Object.keys(day.zones).sort()) zones.append(herdZoneCard(name, day.zones[name]));
}
$('herdDay').onchange = e => { selectedHerdDay = e.target.value; renderHerd(); };
document.querySelector('.cond-link').addEventListener('click', () => showPage('herd'));
setInterval(() => { renderHerd(); renderConditions(); }, 30000);

async function setSprinkler(on, reason){
  if (!hasAccess('operate') || !fbConnected || !controlLoaded || !sensorView.online || !transportConnected || CFG.mode !== 'manual' || !window.SCSFirebase){ $('sprinklerReason').textContent = 'Izin, koneksi, atau mode belum siap; perintah tidak dikirim.'; return; }
  try { await SCSFirebase.pushOverride(on, reason); }
  catch { $('sprinklerReason').textContent = 'Perintah gagal dikirim.'; return; }
  $('sprinklerReason').textContent = 'Perintah dikirim, menunggu perangkat…';
}
function renderSprinkler(){
  const cycle=sensorView.cycle;
  const known=cycle?.capable;
  const remain=known && Number.isInteger(cycle.remainSec) ? `${Math.floor(cycle.remainSec / 60)} menit ${cycle.remainSec % 60} detik` : 'belum diketahui';
  $('cyclePhase').textContent=!known ? 'Status siklus belum diketahui.' : cycle.source==='manual' && cycle.phase==='spraying' ? 'Semprot manual · tanpa batas durasi otomatis.' : cycle.phase==='spraying' ? `Sedang menyemprot · sisa ${remain}.` : cycle.phase==='cooldown' ? `Cooldown sejak mati · sisa ${remain}.` : cycle.phase==='idle' ? 'Siklus sedang tidak menyemprot. Syarat mulai diperiksa perangkat.' : 'Fase siklus belum diketahui.';
  $('cycleQuota').textContent=!known || !controlLoaded || !Number.isInteger(cycle.today) ? 'Jumlah semprot otomatis belum diketahui.' : !cycle.ntpValid || !cycle.day ? `Waktu WIB perangkat belum tersedia. Catatan ${cycle.today} mulai otomatis; tidak ada mulai otomatis baru sampai waktu valid.` : `${cycle.today}/${appliedCfg.maxCyclesPerDay} mulai otomatis · ${cycle.day} WIB${cycle.today>=appliedCfg.maxCyclesPerDay ? ' · batas harian tercapai' : ''}. Kuota bersama profil Suhu dan THI.`;
  const box = $('sprinklerState');
  if (sensorView.ssr === null){
    box.className = 'sprinkler unknown'; $('sprinklerText').textContent = 'BELUM DIKETAHUI';
    $('sprinklerTimer').textContent = 'Menunggu status sprinkler terbaru.';
    return;
  }
  box.className = 'sprinkler ' + (sprinklerOn ? 'on' : 'off');
  $('sprinklerText').textContent = sprinklerOn ? 'MENYEMPROT' : 'MATI';
  if (appliedCfg.mode==='manual') $('sprinklerTimer').textContent=sprinklerOn ? 'Manual · menyala sampai dimatikan, di luar batas otomatis.' : 'Mode manual · gunakan tombol.';
  else $('sprinklerTimer').textContent=known && cycle.phase==='spraying' ? `Sisa semprot dari perangkat: ${remain}.` : known && cycle.phase==='cooldown' ? `Sisa cooldown dari perangkat: ${remain}.` : 'Status relay mengikuti laporan perangkat.';
}
setInterval(renderSprinkler, 1000);

function autoControl(avg){
  if (!sensorView.online){ $('sprinklerReason').textContent = 'Tidak ada status perangkat terbaru. Nilai lama tidak dipakai sebagai data live.'; return; }
  if (appliedCfg.mode==='auto' && !firmwareReady()){ $('sprinklerReason').textContent='Perangkat belum mengonfirmasi firmware kebijakan 3 terbaru. Pengaturan otomatis terkunci; status relay tetap mengikuti laporan perangkat.'; return; }
  if (appliedCfg.mode==='auto' && sensorView.controlBasis!==appliedCfg.controlBasis){ $('sprinklerReason').textContent='Setting tersimpan; menunggu ESP kanan menerapkan dasar kontrol yang dipilih.'; return; }
  if (appliedCfg.mode==='auto' && sensorView.cycle?.phase==='spraying'){ $('sprinklerReason').textContent='Siklus berjalan selama durasi yang dimulai perangkat. Suhu turun bukan syarat berhenti; pengaman sensor dan jadwal tetap berlaku.'; return; }
  if (appliedCfg.mode==='auto' && (!sensorView.cycle?.ntpValid || !sensorView.cycle.day)){ $('sprinklerReason').textContent='Waktu WIB perangkat belum tersedia. Mulai otomatis diblokir; kuota tidak dihitung dari tanggal browser.'; return; }
  if (appliedCfg.mode==='auto' && sensorView.cycle.today===null){ $('sprinklerReason').textContent='Kuota perangkat belum diketahui. Kelayakan mulai otomatis tidak dapat dipastikan.'; return; }
  if (appliedCfg.mode==='auto' && sensorView.cycle.today>=appliedCfg.maxCyclesPerDay){ $('sprinklerReason').textContent='Batas mulai otomatis hari ini tercapai. Berganti profil atau mode tidak mengatur ulang kuota. Manual tidak termasuk batas otomatis.'; return; }
  if (appliedCfg.mode==='auto' && sensorView.cycle.phase==='cooldown'){ $('sprinklerReason').textContent='Menunggu cooldown yang dimulai sejak sprinkler mati, sesuai laporan perangkat.'; return; }
  if (appliedCfg.mode==='auto' && !sensorView.cycle.phase){ $('sprinklerReason').textContent='Fase siklus perangkat belum diketahui. Kelayakan mulai otomatis tidak dapat dipastikan.'; return; }
  const complete=appliedCfg.controlBasis==='thi' ? sensorView.thiComplete : sensorView.complete;
  if(appliedCfg.mode==='auto' && !complete){ $('sprinklerReason').textContent=`Otomatis ${basisName(appliedCfg)} diblokir: perlu ${appliedCfg.controlBasis==='thi' ? '6 DS + 4 DHT' : '6 DS'} valid/fresh.`; return; }
  if (appliedCfg.mode === 'manual'){
    $('sprinklerReason').textContent = 'Mode manual · status mengikuti laporan perangkat.';
  } else {
    const value=metricValue(sensorView,appliedCfg), gated=appliedCfg.autoSrc==='schedule';
    $('sprinklerReason').textContent=`${basisName(appliedCfg)} ${fmtValue(value)}${basisUnit(appliedCfg)} · threshold ${appliedCfg.threshold.toFixed(1)}${basisUnit(appliedCfg)}. ${gated ? 'Hanya beroperasi dalam jadwal. ' : ''}Proteksi otomatis tetap aktif.`;
  }
}

function onNewData(raw){
  telemetry = raw;
  refreshTelemetry();
  if (!raw || !sensorView.online || raw.ts === lastUpdate) return;
  lastUpdate = raw.ts;
  history.push({ t: lastUpdate, s: temps, h: humidities, avg:sensorView.avg, humidityAvg:sensorView.humidityAvg,thi:sensorView.thi });
  if (history.length > 1800) history = history.slice(-1800);
  localStorage.setItem('scs_hist', JSON.stringify(history.slice(-600)));
  drawChart();
}

function drawChart(){
  const c = $('chart'), ctx = c.getContext('2d');
  if (!c.clientWidth) return;
  const T = chartTheme();
  const dpr = Math.max(1, Math.ceil(window.devicePixelRatio || 1));
  const W = c.clientWidth, H = c.clientHeight || 250;
  c.width = W * dpr; c.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0,0,W,H);
  const data = history.filter((d) => Date.now() - d.t < 3600000).slice(-1800);
  const sparse = data.length < 2;
  $('chartEmpty').hidden = !sparse;
  ctx.font = '400 12px Manrope,"Segoe UI",sans-serif';
  if (sparse) return;
  const rh = $('chartMetric').value === 'humidity';
  const thi=$('chartMetric').value==='thi';
  const showThreshold=!rh && isAppliedBasis(thi ? 'thi' : 'temperature');
  const threshold=profileOf(thi ? 'thi' : 'temperature').threshold;
  const values = (row) => thi ? [row.thi] : rh ? row.h || [] : row.s || [];
  let mn = 99, mx = -99;
  data.forEach(d=>{ values(d).filter(SCSTelemetry.finite).forEach(v=>{mn=Math.min(mn,v);mx=Math.max(mx,v);}); });
  if (rh){ mn = 0; mx = 100; }
  else if (showThreshold){ mn = Math.min(mn, threshold-2)-0.3; mx = Math.max(mx, threshold+2)+0.3; }
  else {
    if (mx < mn){ mn=thi ? 60 : 20; mx=thi ? 100 : 40; }
    mn-=0.3; mx+=0.3;
  }
  const L = 44;
  const X = i => L + (data[i].t-data[0].t)/Math.max(1,data[data.length-1].t-data[0].t)*(W-L-12);
  const Y = v => 12 + (1-(v-mn)/(mx-mn))*(H-36);
  ctx.strokeStyle=T.grid; ctx.fillStyle=T.txt; ctx.lineWidth=1;
  for(let k=0;k<=4;k++){ const v=mn+(mx-mn)*k/4, y=Y(v);
    ctx.beginPath(); ctx.moveTo(L,y); ctx.lineTo(W-8,y); ctx.stroke();
    ctx.fillText(v.toFixed(1)+(thi?'':rh?'%':'°'), 4, y+4); }
  if (showThreshold){
    const yT = Y(threshold);
    ctx.setLineDash([6,4]); ctx.strokeStyle=T.threshold; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(L,yT); ctx.lineTo(W-8,yT); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle=T.threshold; ctx.fillText('threshold '+threshold.toFixed(1)+(thi?' THI':'°C'), L+8, yT-6);
  }
  const draw = (idx, color, get) => {
    ctx.strokeStyle=color; ctx.lineWidth = idx==='avg'?2.5:1.5; ctx.lineJoin='round'; ctx.beginPath();
    let drawing = false, previous = null;
    data.forEach((d,i)=>{
      const value = get(d);
      if (!SCSTelemetry.finite(value)){ drawing = false; return; }
      if (previous !== null && d.t - previous > 15000) drawing = false;
      const y = Y(value); drawing ? ctx.lineTo(X(i),y) : ctx.moveTo(X(i),y);
      drawing = true; previous = d.t;
    });
    ctx.stroke();
  };
  if(thi) draw('avg',T.thi,d=>d.thi);
  else {
    for(let s=0;s<(rh?4:6);s++) draw(s, COLORS[s], d=>values(d)[s]);
    if ($('showAvg').checked) draw('avg', T.avg, d=>rh ? d.humidityAvg : d.avg);
  }
}
window.addEventListener('resize', drawChart);
$('showAvg').onchange = drawChart;
$('chartMetric').onchange = () => { renderLegend(); drawChart(); };
$('btnClearChart').onclick = ()=>{ history=[]; localStorage.removeItem('scs_hist'); drawChart(); };

function addLogRow(avg){
  if (!sensorView.online) return;
  const row = { t: telemetry.ts, s: temps.slice(), h: humidities.slice(), avg:sensorView.avg,
    humidityAvg:sensorView.humidityAvg,thi:sensorView.thi, spray: sprinklerOn?1:0 };
  logs.unshift(row); logs = logs.slice(0,120);
  localStorage.setItem('scs_logs', JSON.stringify(logs));
  renderLogs();
}
function renderLogs(){
  const f = $('filterSensor').value;
  const tb = $('logBody'); tb.innerHTML='';
  const valueOf=r=>appliedCfg.controlBasis==='thi' ? r.thi : r.avg;
  const rows = logs.filter(r => f==='all' ? true : SCSTelemetry.finite(valueOf(r)) && (f==='panas' ? valueOf(r)>=appliedCfg.threshold : valueOf(r)<appliedCfg.threshold));
  if (!rows.length){ tb.innerHTML = '<tr><td colspan="16" class="empty">Belum ada riwayat sensor untuk filter ini.</td></tr>'; }
  rows.forEach(r=>{
    const tr = document.createElement('tr');
    const time = new Date(r.t).toLocaleTimeString('id-ID',{timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const value=valueOf(r), hot=SCSTelemetry.finite(value) && value>=appliedCfg.threshold;
    tr.innerHTML = `<td>${time}</td>` + Array.from({length:6},(_,i)=>`<td>${fmtValue(r.s?.[i])}</td>`).join('')
      + Array.from({length:4},(_,i)=>`<td>${fmtValue(r.h?.[i])}</td>`).join('')
      + `<td><b>${fmtValue(r.avg)}</b></td><td>${fmtValue(r.humidityAvg)}</td><td>${fmtValue(r.thi)}</td><td>${basisName(appliedCfg)}: ${!SCSTelemetry.finite(value)?'TIDAK VALID':hot?'≥ THRESHOLD':'< THRESHOLD'}</td><td>${r.spray?'ON':'OFF'}</td>`;
    tb.appendChild(tr);
  });
  $('logCount').textContent = `${logs.length}/120 baris terbaru`;
}
$('filterSensor').onchange = renderLogs;
$('btnLogNow').onclick = ()=> addLogRow(sensorView.avg);
$('btnClearLog').onclick = async ()=>{
  if (await askConfirm('Hapus semua log?', 'Semua baris log di browser akan hilang. Data di Firebase tetap ada.')){
    logs=[]; localStorage.removeItem('scs_logs'); renderLogs();
  }
};
$('btnClearEvents').onclick = async ()=>{
  if (await askConfirm('Hapus semua event?', 'Semua event di browser akan hilang. Data di Firebase tetap ada.')){
    events=[]; localStorage.removeItem('scs_events'); renderEvents();
  }
};
let confirmRes = null, confirmReturnFocus = null;
function askConfirm(title, msg){
  confirmReturnFocus = document.activeElement;
  $('confirmTitle').textContent = title || 'Yakin?';
  $('confirmMsg').textContent = msg || '';
  $('confirmOverlay').hidden = false;
  $('confirmNo').focus();
  return new Promise((res) => { confirmRes = res; });
}
function closeConfirm(v){
  $('confirmOverlay').hidden = true;
  if (confirmRes && confirmReturnFocus?.isConnected) confirmReturnFocus.focus();
  if (confirmRes){ const r = confirmRes; confirmRes = null; r(v); }
}
$('btnExport').onclick = ()=>{
  let csv = 'waktu_wib,ds1,ds2,ds3,ds4,ds5,ds6,dht1_rh,dht2_rh,dht3_rh,dht4_rh,avg_ds,avg_rh,thi,sprinkler\n';
  [...logs].reverse().forEach(r=>{
    const w = new Date(r.t).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'});
    csv += `"${w}",` + [...Array.from({length:6},(_,i)=>r.s?.[i]),...Array.from({length:4},(_,i)=>r.h?.[i]),r.avg,r.humidityAvg,r.thi].map(v=>SCSTelemetry.finite(v)?v:'').join(',') + `,${r.spray?'ON':'OFF'}\n`;
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download = 'costmosys-ds-dht.csv'; a.click(); URL.revokeObjectURL(a.href);
};

function pushEvent(msg){
  events.unshift({ t: Date.now(), msg }); events = events.slice(0,50);
  localStorage.setItem('scs_events', JSON.stringify(events));
  if (fbConnected && window.SCSFirebase) SCSFirebase.pushEvent(msg).catch(()=>{});
  renderEvents();
}
function renderEvents(){
  const ul = $('eventList'); ul.innerHTML = events.length?'':'<li class="hint">Belum ada aktivitas.</li>';
  events.forEach(e=>{
    const li = document.createElement('li');
    const text = document.createElement('div'); text.textContent = e.msg;
    const stamp = document.createElement('div'); stamp.className='t'; stamp.textContent = new Date(e.t).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})+' WIB';
    li.append(text, stamp);
    ul.appendChild(li);
  });
}

function curAutoSrc(){
  if (typeof SCS !== 'undefined' && SCS.autoSrcOf) return SCS.autoSrcOf(CFG);
  return CFG.autoSrc || (CFG.schedOn ? 'schedule' : 'threshold');
}
function schedSlots(){ return SCS.schedulesOf(CFG, SCS.wibDateStr()); }
function schedActiveNow(){
  return SCS.anyScheduleActive(Date.now(), schedSlots());
}
function pad2(n){ return String(n).padStart(2, '0'); }
function wibHMplus(offsetMs){
  const t = new Date(Date.now() + (offsetMs || 0));
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(t);
  const g = (x) => p.find((y) => y.type === x).value;
  return `${pad2((+g('hour')) % 24)}:${g('minute')}`;
}
function clampToday(iso, hm){
  if (iso !== SCS.wibDateStr()) return hm;
  const min = wibHMplus(60000);
  return hm < min ? min : hm;
}
function renderSchedList(){
  const box = $('schedList'); if (!box) return;
  const locked = !hasAccess('settings') || CFG.mode !== 'auto' || !fbConnected || !controlLoaded || !transportConnected || !firmwareReady() || savingSettings;
  box.innerHTML = '';
  const slots = schedSlots();
  if (!slots.length){
    box.innerHTML = '<div class="hint sched-empty">Belum ada jadwal. Pilih Tambah jadwal.</div>';
  }
  slots.forEach((s, i) => {
    const f = SCS.formatIDDate(s.date);
    const row = document.createElement('div');
    row.className = 'sched-row';
    row.innerHTML = `<span class="sched-num">${i + 1}</span>
      <div class="sched-groups">
        <button class="pick-btn" data-pick="date" data-i="${i}" data-pop-anchor ${locked ? 'disabled' : ''} title="Pilih tanggal"><svg class="icon" aria-hidden="true"><use href="#i-calendar"/></svg><span>${f || s.date}</span></button>
        <button class="pick-btn" data-pick="time" data-i="${i}" data-pop-anchor ${locked ? 'disabled' : ''} title="Pilih jam (24 jam)"><svg class="icon" aria-hidden="true"><use href="#i-history"/></svg><span>${s.start}</span></button>
        <div class="sched-group"><span>Lebar jendela jadwal</span><div class="sched-inline step">
          <button data-dec="${i}" title="Kurangi 1 menit" ${locked ? 'disabled' : ''}>−</button><b data-durv="${i}">${s.dur}</b><button data-inc="${i}" title="Tambah 1 menit" ${locked ? 'disabled' : ''}>+</button><i>mnt</i>
        </div></div>
      </div>
      <button class="btn red small sched-del" data-del="${i}" title="Hapus jadwal ini" aria-label="Hapus jadwal ${i + 1}" ${locked ? 'disabled' : ''}><svg class="icon" aria-hidden="true"><use href="#i-close"/></svg></button>`;
    box.appendChild(row);
  });
  box.querySelectorAll('[data-pick]').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); openSlotPicker(b); };
  });
  function stepDur(i, d){
    const arr = [...schedSlots()];
    if (!arr[i]) return;
    arr[i].dur = Math.min(180, Math.max(1, arr[i].dur + d));
    CFG.schedules = arr; markSettingsDirty();
    const b = box.querySelector(`[data-durv="${i}"]`);
    if (b) b.textContent = arr[i].dur;
    updateSchedHint(); updateModeInfo();
  }
  function holdStep(btn, fn){
    const start = (e) => {
      e.preventDefault();
      fn();
      const t1 = setTimeout(() => {
        const iv = setInterval(fn, 80);
        btn._stop = () => { clearTimeout(t1); clearInterval(iv); };
      }, 400);
      btn._t1 = t1;
    };
    const stop = () => { clearTimeout(btn._t1); if (btn._stop) btn._stop(); };
    btn.addEventListener('pointerdown', start);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, stop));
    btn.addEventListener('click', e => { if (e.detail === 0) fn(); });
  }
  box.querySelectorAll('[data-inc]').forEach((b) => holdStep(b, () => stepDur(+b.dataset.inc, 1)));
  box.querySelectorAll('[data-dec]').forEach((b) => holdStep(b, () => stepDur(+b.dataset.dec, -1)));
  box.querySelectorAll('[data-del]').forEach((btn) => {
    btn.onclick = () => {
      const cur = readSchedList(true);
      cur.splice(+btn.dataset.del, 1);
      CFG.schedules = cur;
      markSettingsDirty(); syncButtons();
    };
  });
  const add = $('btnAddSched'); if (add) add.disabled = locked || schedSlots().length >= 6;
}
function readSchedList(keepPast){
  const now = Date.now();
  const out = [];
  schedSlots().forEach((s) => {
    if (out.some((o) => o.date === s.date && o.start === s.start)) return;
    if (!keepPast && SCS.slotState(s, now) === 'past') return;
    out.push(s);
  });
  return out.slice(0, 6);
}
let popEl = null;
function closePicker(){
  if (!popEl) return;
  popEl.remove(); popEl = null;
  document.removeEventListener('pointerdown', popOutside, true);
  window.removeEventListener('scroll', closePicker, true);
  window.removeEventListener('resize', closePicker);
  document.removeEventListener('keydown', popEsc);
}
function popOutside(e){
  if (!popEl) return;
  if (e.target.closest && e.target.closest('[data-pop-anchor]')) return;
  if (!popEl.contains(e.target)) closePicker();
}
function popEsc(e){ if (e.key === 'Escape') closePicker(); }
function openPop(anchor, key, html){
  if (popEl && popEl.dataset.for === key){ closePicker(); return null; }
  closePicker();
  popEl = document.createElement('div');
  popEl.className = 'picker-pop';
  popEl.dataset.for = key;
  popEl.innerHTML = html;
  document.body.appendChild(popEl);
  placePop(anchor);
  document.addEventListener('pointerdown', popOutside, true);
  window.addEventListener('scroll', closePicker, true);
  window.addEventListener('resize', closePicker);
  document.addEventListener('keydown', popEsc);
  return popEl;
}
function placePop(anchor){
  if (!popEl || !anchor) return;
  popEl.style.visibility = 'hidden';
  const r = anchor.getBoundingClientRect();
  const pw = popEl.offsetWidth, ph = popEl.offsetHeight;
  const x = Math.min(r.left, window.innerWidth - pw - 12);
  let y = r.bottom + 6;
  if (y + ph > window.innerHeight - 12) y = r.top - ph - 6;
  if (y < 12) y = Math.max(12, Math.min(r.bottom + 6, window.innerHeight - ph - 12));
  popEl.style.left = Math.max(12, x) + 'px';
  popEl.style.top = Math.max(0, y) + 'px';
  popEl.style.visibility = '';
}
const ID_MON = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const ID_DOW = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
function openSlotPicker(btn){
  const i = +btn.dataset.i, type = btn.dataset.pick;
  const slots = [...schedSlots()];
  const s = slots[i];
  if (!s) return;
  if (type === 'date') openDatePop(btn, i, s);
  else openTimePop(btn, i, s);
}
function commitSlots(slots, msg){
  CFG.schedules = slots.slice(0, 6);
  markSettingsDirty(); syncButtons(); updateSchedHint();
}
function openDatePop(btn, i, s){
  const today = SCS.wibDateStr();
  const cur = /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : today;
  let vy = +cur.slice(0, 4), vm = +cur.slice(5, 7);
  const el = openPop(btn, i + '-date', '<div class="pk-cal"></div>');
  if (!el) return;
  const box = el.querySelector('.pk-cal');
  function draw(){
    const first = new Date(Date.UTC(vy, vm - 1, 1));
    const lead = (first.getUTCDay() + 6) % 7;
    const dim = new Date(Date.UTC(vy, vm, 0)).getUTCDate();
    let h = `<div class="pk-head"><button data-nav="-1"${vy === 2026 && vm === 1 ? ' disabled' : ''}>‹</button><b>${ID_MON[vm - 1]} ${vy}</b><button data-nav="1"${vy === 2030 && vm === 12 ? ' disabled' : ''}>›</button></div>`;
    h += '<div class="pk-dow">' + ID_DOW.map((d) => `<span>${d}</span>`).join('') + '</div><div class="pk-grid">';
    for (let k = 0; k < lead; k++) h += '<span></span>';
    for (let d = 1; d <= dim; d++){
      const iso = `${vy}-${pad2(vm)}-${pad2(d)}`;
      const dis = iso < today || iso > '2030-12-31';
      h += `<button data-day="${iso}"${dis ? ' disabled' : ''} class="${iso === s.date ? 'sel' : ''}">${d}</button>`;
    }
    h += '</div><div class="pk-foot"><button data-today>Hari ini</button><button data-close>Tutup</button></div>';
    box.innerHTML = h;
    box.querySelectorAll('[data-nav]').forEach((b) => {
      b.onclick = () => {
        vm += +b.dataset.nav;
        if (vm < 1){ vm = 12; vy--; } if (vm > 12){ vm = 1; vy++; }
        if (vy < 2026 || (vy === 2026 && vm < 1)){ vy = 2026; vm = 1; }
        if (vy > 2030 || (vy === 2030 && vm > 12)){ vy = 2030; vm = 12; }
        draw();
      };
    });
    box.querySelectorAll('[data-day]').forEach((b) => {
      b.onclick = () => {
        const arr = [...schedSlots()];
        if (!arr[i]){ closePicker(); return; }
        const day = b.dataset.day;
        arr[i] = { ...arr[i], date: day, start: clampToday(day, arr[i].start) };
        commitSlots(arr);
        closePicker();
      };
    });
    box.querySelector('[data-today]').onclick = () => {
      const arr = [...schedSlots()];
      if (!arr[i]){ closePicker(); return; }
      const day = SCS.wibDateStr();
      arr[i] = { ...arr[i], date: day, start: clampToday(day, arr[i].start) };
      commitSlots(arr);
      closePicker();
    };
    box.querySelector('[data-close]').onclick = closePicker;
    placePop(btn);
  }
  draw();
}
function openTimePop(btn, i, s){
  const today = SCS.wibDateStr();
  let curDate = /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : today;
  let minH = -1, minM = 0;
  function refreshMin(){
    if (curDate <= today){
      const t = new Date(Date.now() + 60000);
      const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(t);
      const g = (x) => p.find((y) => y.type === x).value;
      minH = (+g('hour')) % 24; minM = +g('minute');
    } else { minH = -1; minM = 0; }
  }
  function addDays(iso, n){
    const p = iso.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2]) + n * 86400000).toISOString().slice(0, 10);
  }
  const parts = (s.start || '09:00').split(':');
  let hh = Math.min(23, Math.max(0, parseInt(parts[0]) || 0));
  let mi = Math.min(59, Math.max(0, parseInt(parts[1]) || 0));
  refreshMin();
  if (hh < minH || (hh === minH && mi < minM)){ hh = minH; mi = minM; }
  const el = openPop(btn, i + '-time', `<div class="pk-date" data-v="date"></div><div class="pk-time">
      <div class="pk-col"><button data-s="h" data-d="1" aria-label="Tambah jam">▲</button><input data-v="h" aria-label="Jam WIB" value="${pad2(hh)}" inputmode="numeric" maxlength="2" autocomplete="off" /><button data-s="h" data-d="-1" aria-label="Kurangi jam">▼</button><span>Jam</span></div>
      <div class="pk-sep">:</div>
      <div class="pk-col"><button data-s="m" data-d="1" aria-label="Tambah menit">▲</button><input data-v="m" aria-label="Menit WIB" value="${pad2(mi)}" inputmode="numeric" maxlength="2" autocomplete="off" /><button data-s="m" data-d="-1" aria-label="Kurangi menit">▼</button><span>Menit</span></div>
    </div>
    <div class="pk-foot"><span class="hint">24 jam • WIB</span><span><button data-close>Batal</button> <button data-ok class="btn blue small">OK</button></span></div>`);
  if (!el) return;
  const vH = el.querySelector('[data-v="h"]'), vM = el.querySelector('[data-v="m"]'), vD = el.querySelector('[data-v="date"]');
  function paintDate(){ if (vD) vD.textContent = SCS.formatIDDate(curDate) || curDate; }
  function paint(){ if (document.activeElement !== vH) vH.value = pad2(hh); if (document.activeElement !== vM) vM.value = pad2(mi); paintDate(); }
  function rollHour(d){
    if (d > 0){
      if (hh >= 23){
        const nx = addDays(curDate, 1);
        if (nx <= '2030-12-31'){ curDate = nx; hh = 0; }
      } else hh++;
    } else {
      if (hh <= 0){
        const pv = addDays(curDate, -1);
        if (pv >= today){ curDate = pv; hh = 23; }
      } else hh--;
    }
    refreshMin();
  }
  function step(which, d){
    if (which === 'h') rollHour(d);
    else {
      mi += d;
      if (mi > 59){ mi = 0; rollHour(1); }
      else if (mi < 0){ mi = 59; rollHour(-1); }
    }
    if (minH >= 0 && (hh < minH || (hh === minH && mi < minM))){ hh = minH; mi = minM; }
    paint();
  }
  function readInputs(){
    let h = parseInt((vH.value || '').replace(/\D/g, '').slice(-2), 10);
    let m = parseInt((vM.value || '').replace(/\D/g, '').slice(-2), 10);
    if (!isFinite(h)) h = hh; if (!isFinite(m)) m = mi;
    h = Math.min(23, Math.max(0, h)); m = Math.min(59, Math.max(0, m));
    if (h < minH || (h === minH && m < minM)){ h = minH; m = minM; }
    hh = h; mi = m; paint();
  }
  vH.addEventListener('change', readInputs);
  vM.addEventListener('change', readInputs);
  let repT = null, repI = null;
  function stopRep(){ clearTimeout(repT); clearInterval(repI); repT = repI = null; }
  el.querySelectorAll('[data-s]').forEach((b) => {
    const w = b.dataset.s, d = +b.dataset.d;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      step(w, d);
      stopRep();
      repT = setTimeout(() => { repI = setInterval(() => step(w, d), 70); }, 380);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, stopRep));
    b.addEventListener('click', e => { stopRep(); if (e.detail === 0) step(w, d); });
  });
  el.querySelector('[data-close]').onclick = () => { stopRep(); closePicker(); };
  el.querySelector('[data-ok]').onclick = () => {
    stopRep();
    readInputs();
    const arr = [...schedSlots()];
    if (!arr[i]){ closePicker(); return; }
    arr[i] = { ...arr[i], date: curDate, start: pad2(hh) + ':' + pad2(mi) };
    commitSlots(arr);
    closePicker();
  };
}
function syncButtons(){
  if (typeof closePicker === 'function') closePicker();
  $('btnAuto').classList.toggle('active', CFG.mode==='auto');
  $('btnManual').classList.toggle('active', CFG.mode==='manual');
  $('btnAuto').setAttribute('aria-pressed', String(CFG.mode==='auto'));
  $('btnManual').setAttribute('aria-pressed', String(CFG.mode==='manual'));
  $('btnSprayOn').disabled = $('btnSprayOff').disabled = !hasAccess('operate') || CFG.mode!=='manual' || !controlLoaded || !fbConnected || !sensorView.online || !transportConnected;
  $('btnManual').disabled = !hasAccess('operate') || !fbConnected || !controlLoaded || !transportConnected || !sensorView.online || savingSettings;
  $('btnAuto').disabled = $('btnManual').disabled || !firmwareReady();
  const locked = !hasAccess('settings') || CFG.mode !== 'auto' || !fbConnected || !controlLoaded || !transportConnected || !firmwareReady() || savingSettings;
  const src = curAutoSrc();
  const isThresh = src === 'threshold';
  $('srcThreshold').checked = isThresh;
  $('srcSchedule').checked = !isThresh;
  $('srcThreshold').disabled = $('srcSchedule').disabled = locked;
  $('basisTemperature').checked=CFG.controlBasis==='temperature'; $('basisThi').checked=CFG.controlBasis==='thi';
  $('basisTemperature').disabled=$('basisThi').disabled=locked;
  ['inThreshold','rangeThreshold','inMaxCycles','inMaxDur','inCooldown'].forEach((id)=>{ $(id).disabled = locked; });
  $('btnSaveCfg').disabled = locked || !firmwareReady();
  $('btnSaveCfg').textContent = savingSettings ? 'Menyimpan pengaturan…' : !fbConnected ? 'Masuk untuk mengatur' : !controlLoaded ? 'Menunggu pengaturan perangkat' : locked ? 'Pengaturan terkunci' : 'Simpan pengaturan';
  $('btnSaveCfg').setAttribute('aria-busy', String(savingSettings));
  const thi=CFG.controlBasis==='thi';
  for(const id of ['inThreshold','rangeThreshold']){ $(id).min=thi ? 0 : -55; $(id).max=thi ? 120 : 125; $(id).value=CFG.threshold; }
  $('thresholdInputLabel').textContent=`Threshold semprot ${basisName(CFG)}${thi ? ' (indeks)' : ' (°C)'}`;
  $('scheduleTitle').textContent=`Jendela jadwal ${basisName(CFG)} (maks 6×)`;
  $('controlBasisHint').textContent=`Profil ${basisName(CFG)} menyimpan threshold, durasi, cooldown, dan jadwal terpisah. Batas harian dipakai bersama kedua profil. ${thi ? 'THI memakai rata-rata 6 DS dan RH rata-rata 4 DHT.' : 'Kontrol suhu tidak memerlukan DHT.'} Simpan untuk menerapkan.`;
  $('inMaxDur').value = CFG.maxDuration / 60; $('inCooldown').value = CFG.cooldown / 60; $('inMaxCycles').value = CFG.maxCyclesPerDay;
  $('threshGroup').style.display = '';
  $('protectGroup').style.display = '';
  $('schedGroup').style.display = isThresh ? 'none' : '';
  renderSchedList();
  updateSchedHint();
  updateModeInfo();
}
async function setMode(mode){
  if (!hasAccess('operate') || !fbConnected || !controlLoaded || !transportConnected || !sensorView.online || (mode==='auto' && !firmwareReady())){
    $('settingsStatus').textContent='Perangkat harus online dan mengonfirmasi firmware kebijakan 3 sebelum otomatis dapat diaktifkan.'; return;
  }
  const revision=accessRevision;
  try { await SCSFirebase.pushControl({mode}); if(revision!==accessRevision)return; CFG.mode=mode; saveCfg(); syncButtons(); }
  catch { if(revision===accessRevision)$('settingsStatus').textContent='Perubahan mode gagal dikirim.'; }
}
$('btnAuto').onclick = ()=>setMode('auto');
$('btnManual').onclick = ()=>setMode('manual');
$('btnSprayOn').onclick = ()=> setSprinkler(true, 'tombol manual');
$('btnSprayOff').onclick = ()=> setSprinkler(false, 'tombol manual');
async function fbPushControl(){
  if (!hasAccess('settings') || !fbConnected || !controlLoaded || !transportConnected || !firmwareReady() || !window.SCSFirebase){
    $('settingsStatus').textContent='Belum dikirim: izin, koneksi, dan konfirmasi firmware kebijakan 3 terbaru harus siap.'; return;
  }
  const submitted=SCSControl.normalize(SCSControl.capture(CFG));
  const revision=accessRevision;
  savingSettings=true; syncButtons();
  try {
    await SCSFirebase.pushControl(SCSAccess.settingsPayload(SCSControl.toFirebase(submitted)));
    if(revision!==accessRevision)return;
    submitted.mode=appliedCfg.mode;
    appliedCfg=submitted; CFG=SCSControl.normalize(submitted); settingsDirty=false; saveCfg();
    $('settingsStatus').textContent=window.SCS_SYNTHETIC ? `Profil ${basisName(submitted)} diterapkan pada simulasi lokal. Tidak dikirim ke Firebase atau perangkat.` : `Profil ${basisName(submitted)} tersimpan. Menunggu laporan perangkat untuk memastikan penerapan.`;
    pushEvent(`Pengaturan ${basisName(submitted)}: threshold ${submitted.threshold}${basisUnit(submitted)}, ${submitted.autoSrc==='schedule' ? 'dalam jadwal' : 'sepanjang waktu'}`);
  } catch {
    if(revision!==accessRevision)return;
    CFG=SCSControl.normalize(submitted); settingsDirty=true; saveCfg();
    $('settingsStatus').textContent='Gagal menyimpan. Perubahan belum diterapkan; coba lagi.';
  }
  finally { savingSettings=false; syncButtons(); refreshTelemetry(); drawChart(); }
}
function updateModeInfo(){
  const el = $('modeInfo'); if (!el) return;
  const cfg=appliedCfg;
  if (cfg.mode !== 'auto'){
    el.textContent = 'Manual menyala sampai dimatikan, termasuk saat internet putus. Durasi, cooldown, dan batas harian otomatis tidak membatasi manual. Uji tanpa beban AC dahulu.';
    return;
  }
  el.textContent=`Mulai saat ${basisName(cfg)} ≥ ${cfg.threshold.toFixed(1)}${basisUnit(cfg)} · ${cfg.autoSrc==='schedule' ? 'hanya dalam jadwal' : 'sepanjang waktu'}. Semprot ${cfg.maxDuration / 60} menit, cooldown ${cfg.cooldown / 60} menit sejak mati, maksimal ${cfg.maxCyclesPerDay} mulai otomatis per hari WIB. Data tidak lengkap: otomatis mati.`;
}
function updateSchedHint(){
  const el = $('schedHint'); if (!el) return;
  if (curAutoSrc() === 'threshold'){ el.textContent = ''; el.style.display = 'none'; return; }
  el.style.display = '';
  const slots = schedSlots();
  if (!slots.length){ el.textContent = 'Belum ada jadwal. Tambahkan minimal satu.'; return; }
  const now = Date.now();
  const run = SCS.anyScheduleActive(now, slots);
  const nx = SCS.nextSchedule(now, slots);
  const daftar = slots.map((s) => SCS.formatIDSlot(s)).join(', ');
  el.textContent = `${basisName(CFG)} · ${slots.length} jendela: ${daftar}. ` + (run ? 'Jendela aktif, bukan perintah menyala. ' : (nx ? `Berikutnya ${SCS.formatIDSlot(nx)}. ` : '')) + `Tetap mengikuti threshold ${CFG.threshold}${basisUnit(CFG)}, durasi semprot, cooldown sejak mati, dan batas harian bersama.`;
}
let fbTries = 0, authResolved=false, sessionWaitTimer=null;
function sessionStatus(message, failed=false){
  if (authResolved) return;
  $('sessionMessage').textContent=message;
  $('sessionPanel').setAttribute('aria-busy',String(!failed));
  if (failed) $('sessionPanel').dataset.failed=''; else delete $('sessionPanel').dataset.failed;
  $('appShell').dataset.state=failed ? 'failed' : 'loading';
  $('appShell').setAttribute('aria-busy',String(!failed));
  $('sessionRetry').hidden=!failed;
}
function sessionFailed(){
  sessionStatus('Sesi belum dapat diperiksa. Periksa koneksi internet lalu coba muat ulang.',true);
}
function setFbStatus(msg, kind){
  const el = $('fbStatus'); if (!el) return;
  el.textContent = msg || '';
  el.dataset.kind = kind || 'login';
  if (!authResolved && msg) sessionStatus(kind==='err' ? 'Sesi belum dapat diperiksa. Periksa koneksi internet lalu coba muat ulang.' : msg,kind==='err');
  const notice=$('connectionNotice');
  notice.textContent=kind==='err' && fbConnected ? msg : '';
  notice.hidden=!notice.textContent;
}
function accountNameOf(email){
  if (typeof email !== 'string') return 'Pengelola';
  const at=email.indexOf('@');
  return at > 0 ? email.slice(0,at).trim() || 'Pengelola' : 'Pengelola';
}
function setAuthView(ok, email=''){
  authResolved=true;
  clearTimeout(sessionWaitTimer);
  $('sessionPanel').hidden=true;
  delete $('sessionPanel').dataset.failed;
  $('sessionRetry').hidden=true;
  $('sessionPanel').setAttribute('aria-busy','false');
  $('appShell').dataset.state=ok ? 'ready' : 'loading';
  $('appShell').setAttribute('aria-busy','false');
  if (!ok){ closeSensors(false); closeSide(); closePicker(); closeConfirm(false); }
  const nextView=ok ? $('appShell') : $('authPanel');
  if (nextView.hidden){ nextView.classList.remove('view-in'); void nextView.offsetWidth; nextView.classList.add('view-in'); }
  $('appShell').hidden=!ok;
  $('appShell').inert=!ok;
  $('authPanel').hidden=ok;
  $('authPanel').inert=ok;
  $('btnLogout').hidden=!ok;
  $('accountEmail').textContent=ok ? email || 'Akun terautentikasi' : 'Akun terautentikasi';
  $('profileEmail').textContent=ok ? email : '';
  $('profileMenu').hidden=true;
  $('profileBtn').setAttribute('aria-expanded','false');
  const name=ok ? accountNameOf(email) : 'Pengelola';
  $('greetingName').textContent=name.charAt(0).toUpperCase()+name.slice(1);
  $('accountName').textContent=name;
  $('accountName').title=name;
  const initial=Array.from(name)[0].toUpperCase();
  $('accountAvatar').textContent=initial;
  const avatar=document.querySelector('.topbar-avatar');
  avatar.textContent=initial;
  avatar.setAttribute('aria-label', `Buka profil ${name}`);
  if (ok){
    let page='dash';
    try { page=localStorage.getItem('scs_page') || 'dash'; } catch {}
    showPage(page);
    requestAnimationFrame(drawChart);
    $('mainContent').focus({preventScroll:true});
  } else {
    document.title='Masuk — COSTMOSYS';
    $('connectionNotice').hidden=true;
    $('loginPassword').value='';
    $('loginPassword').type='password';
    $('togglePassword').setAttribute('aria-pressed','false');
    $('togglePassword').setAttribute('aria-label','Tampilkan password');
    $('loginEmail').focus({preventScroll:true});
  }
}
function fbConnect(){
  $('btnLogin').disabled=true;
  if (!window.SCSFirebase){
    fbTries++;
    setFbStatus(fbTries > 12
      ? 'SDK login belum termuat. Periksa internet dan akses gstatic.com, lalu muat ulang. Untuk preview lokal, gunakan http://localhost, bukan file://.'
      : 'Memuat Firebase SDK…', fbTries>12 ? 'err' : 'sim');
    setTimeout(()=>{ if (!fbConnected) fbConnect(); }, 800);
    return;
  }
  setFbStatus('Menghubungkan ke Firebase…', 'sim');
  SCSFirebase.connect({
    onAccess: record=>{
      telemetryResolved=false;herdResolved=false;herdFailed=false;herdDays=null;
      accessRevision++;
      accessState=SCSAccess.normalize(record);window.smartcowAccess=accessState;
      closeSensors(false);closePicker();closeConfirm(false);
      controlLoaded=false;settingsDirty=false;telemetry=null;lastUpdate=null;history=[];logs=[];events=[];
      $('settingsStatus').textContent='';
      sprinklerOn=false;
      localStorage.removeItem('scs_logs');localStorage.removeItem('scs_events');localStorage.removeItem('scs_hist');
      renderLogs();renderEvents();refreshTelemetry();drawChart();
      applyAccessView();window.SCSAdmin?.sync();
    },
    onStatus: (msg, kind)=>{ setFbStatus(msg, kind); setConn(kind); },
    onTransport: (online)=>{ transportConnected=online; syncButtons(); refreshTelemetry(); },
    onAuthError: ()=>{ sessionFailed(); setFbStatus('Sesi tidak dapat diperiksa. Periksa koneksi lalu muat ulang.','err'); },
    onAuth: (ok, email)=>{
      fbConnected=ok;
      $('btnLogin').disabled=false;
      setAuthView(ok, email);
      if(!ok){accessState=null;window.smartcowAccess=null;window.SCSAdmin?.sync();}
      applyAccessView();
      if (!ok){ controlLoaded=false; settingsDirty=false; telemetry=null; telemetryResolved=false; herdResolved=false; herdFailed=false; herdDays=null; transportConnected=false; lastUpdate=null; history=[]; logs=[]; events=[]; sprinklerOn=false; renderLogs(); renderEvents(); renderHerd(); drawChart(); }
      setFbStatus(ok ? '' : 'Masuk dengan akun Firebase yang sudah ada.', 'login'); syncButtons(); refreshTelemetry();
    },
    onControl: (ctl)=>{
      if (!fbConnected || !hasAccess('monitor')) return;
      if (!ctl){ controlLoaded=false; syncButtons(); refreshTelemetry(); drawChart(); return; }
      controlLoaded=true;
      appliedCfg=SCSControl.fromFirebase(ctl);
      if (!settingsDirty && !savingSettings) CFG=SCSControl.normalize(appliedCfg);
      else CFG.mode=appliedCfg.mode;
      saveCfg(); syncButtons(); refreshTelemetry(); renderLogs(); drawChart();
    },
    onTelemetry: (p)=>{
      if (fbConnected && hasAccess('monitor')) telemetryResolved=true;
      if (!fbConnected || !hasAccess('monitor')) return;
      onNewData(p);
      if (sensorView.ssr !== null){
        sprinklerOn=sensorView.ssr===1;
        renderSprinkler();
      }
    },
    onSeedLogs: (rows)=>{ if (!fbConnected || !hasAccess('monitor')) return; logs = SCS.pruneLogs(rows, 120); localStorage.setItem('scs_logs', JSON.stringify(logs)); renderLogs(); },
    onEvents: (rows)=>{ if (!fbConnected || !hasAccess('monitor')) return; events=rows; renderEvents(); },
    onHerd: (days)=>{
      if (!fbConnected || !hasAccess('monitor')) return;
      herdResolved=true; herdFailed=days===null; herdDays=days;
      renderHerd(); renderConditions();
    }
  })
    .catch((e)=>{ sessionFailed(); setFbStatus('Firebase: ' + e.message, 'err'); setConn('err'); });
}
function setConn(kind){
  const b = $('connBadge');
  b.dataset.busy = String(kind==='sim');
  if (kind==='sim'){ b.textContent='MENGHUBUNGKAN…'; b.className='badge sim'; }
  if (kind==='live'){ b.textContent='TERHUBUNG'; b.className='badge live'; }
  if (kind==='err'){ b.textContent='KONEKSI GAGAL'; b.className='badge err'; }
  if (kind==='offline'){ b.textContent='OFFLINE / DATA LAMA'; b.className='badge offline'; }
  if (kind==='login'){ b.textContent='PERLU LOGIN'; b.className='badge sim'; }
}

$('loginForm').onsubmit = async (e)=>{
  e.preventDefault(); $('btnLogin').disabled=true; $('btnLogin').setAttribute('aria-busy','true'); $('loginButtonText').textContent='Memeriksa akun…'; setFbStatus('Memeriksa akun…','login');
  try { await SCSFirebase.login($('loginEmail').value.trim(),$('loginPassword').value); $('loginPassword').value=''; }
  catch { setFbStatus('Login gagal. Periksa email/password dan koneksi internet.','err'); }
  finally { $('btnLogin').disabled=false; $('btnLogin').setAttribute('aria-busy','false'); $('loginButtonText').textContent='Masuk ke dashboard'; }
};
$('togglePassword').onclick=()=>{
  const show=$('loginPassword').type==='password';
  $('loginPassword').type=show ? 'text' : 'password';
  $('togglePassword').setAttribute('aria-pressed', String(show));
  $('togglePassword').setAttribute('aria-label', show ? 'Sembunyikan password' : 'Tampilkan password');
};
$('btnLogout').onclick=async()=>{
  $('btnLogout').disabled=true;
  try { await SCSFirebase.logout(); }
  catch { setFbStatus('Gagal keluar. Periksa koneksi dan coba lagi.', 'err'); }
  finally { $('btnLogout').disabled=false; }
};

function readSettingsInputs(){
  const fields=[['inThreshold','threshold',CFG.controlBasis==='thi' ? 0 : -55,CFG.controlBasis==='thi' ? 120 : 125],
    ['inMaxDur','maxDuration',1,10800],['inCooldown','cooldown',0,86400],['inMaxCycles','maxCyclesPerDay',1,100]];
  for(const [id,key,min,max] of fields){
    const value=Number($(id).value) * (key==='maxDuration' || key==='cooldown' ? 60 : 1);
    if($(id).value.trim() && Number.isFinite(value)){
      const bounded=Math.max(min,Math.min(max,value));
      CFG[key]=key==='threshold' ? bounded : Math.round(bounded);
    }
  }
}
$('rangeThreshold').oninput = e => { $('inThreshold').value = e.target.value; readSettingsInputs(); markSettingsDirty(); };
$('inThreshold').oninput = e => { $('rangeThreshold').value = e.target.value; readSettingsInputs(); markSettingsDirty(); };
for(const id of ['inMaxCycles','inMaxDur','inCooldown']) $(id).oninput=()=>{readSettingsInputs();markSettingsDirty();};
function changeBasis(basis){ readSettingsInputs(); CFG=SCSControl.selectBasis(CFG,basis); markSettingsDirty(); syncButtons(); }
$('basisTemperature').onchange=()=>changeBasis('temperature');
$('basisThi').onchange=()=>changeBasis('thi');
$('srcThreshold').onchange = () => { readSettingsInputs(); CFG.autoSrc = 'threshold'; markSettingsDirty(); syncButtons(); };
$('srcSchedule').onchange = () => { readSettingsInputs(); CFG.autoSrc = 'schedule'; markSettingsDirty(); syncButtons(); };
$('btnSaveCfg').onclick = ()=>{
  for (const id of ['inThreshold','inMaxDur','inCooldown','inMaxCycles']) if (!$(id).reportValidity()) return;
  CFG.autoSrc = $('srcSchedule').checked ? 'schedule' : 'threshold';
  readSettingsInputs();
  CFG.schedules = readSchedList();
  saveCfg(); syncButtons(); renderSensors(); drawChart();
  fbPushControl();
};
$('btnAddSched').onclick = ()=>{
  const cur = readSchedList(true);
  if (cur.length >= 6) return;
  let ndate, ns;
  if (!cur.length){
    const t = SCS.wibDateStr(), p = t.split('-').map(Number);
    ndate = new Date(Date.UTC(p[0], p[1] - 1, p[2]) + 86400000).toISOString().slice(0, 10);
    ns = '09:00';
  } else {
    const last = cur[cur.length - 1];
    const h = SCS.hmToMin(last.start);
    const nh = isFinite(h) ? (h + 60) % 1440 : 9 * 60;
    ndate = last.date;
    if (isFinite(h) && nh <= h){
      const p = last.date.split('-').map(Number);
      ndate = new Date(Date.UTC(p[0], p[1] - 1, p[2]) + 86400000).toISOString().slice(0, 10);
    }
    ns = `${String(Math.floor(nh / 60)).padStart(2, '0')}:${String(nh % 60).padStart(2, '0')}`;
  }
  CFG.schedules = [...cur, { date: ndate, start: ns, dur: 10 }];
  markSettingsDirty(); syncButtons();
};

function mobileNavigation(){ return window.matchMedia('(max-width: 980px)').matches; }
function reducedMotion(){ return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
let sideOverlayTimer=null;
function syncScrollLock(){
  const drawer=$('sidebar').classList.contains('open') && mobileNavigation();
  document.body.style.overflow=drawer || $('sensorDialog').open ? 'hidden' : '';
  document.querySelector('.workspace').inert=drawer;
}
function setSide(open){
  open=!!open && fbConnected;
  var sb = $('sidebar'); if (!sb) return;
  const wasOpen=sb.classList.contains('open');
  sb.classList.toggle('open',open);
  $('appShell').classList.toggle('sidebar-open',open);
  sb.setAttribute('aria-hidden',String(!open));
  sb.inert=!open;
  $('menuBtn').setAttribute('aria-expanded',String(open));
  $('menuBtn').setAttribute('aria-label',open ? 'Tutup navigasi' : 'Buka navigasi');
  const drawer=open && mobileNavigation();
  clearTimeout(sideOverlayTimer);
  const overlay=$('sideOverlay');
  if (drawer){
    overlay.hidden=false;
    void overlay.offsetWidth;
    overlay.classList.add('show');
  } else {
    overlay.classList.remove('show');
    if (!fbConnected || reducedMotion()) overlay.hidden=true;
    else sideOverlayTimer=setTimeout(()=>{ if (!$('sidebar').classList.contains('open') || !mobileNavigation()) overlay.hidden=true; },300);
  }
  syncScrollLock();
  if (drawer && (!wasOpen || document.querySelector('.workspace').contains(document.activeElement))) requestAnimationFrame(()=>{
    if (fbConnected && sb.classList.contains('open') && mobileNavigation()) $('sideClose').focus();
  });
  requestAnimationFrame(drawChart);
}
function openSide(){ closeSensors(false); closePicker(); setSide(true); }
function closeSide(){ const wasOpen=$('sidebar').classList.contains('open'); setSide(false); if(wasOpen && fbConnected) $('menuBtn').focus(); }
let sensorReturnFocus=null, sensorCloseTimer=null, sensorCloseHandler=null;
function cancelSensorClose(){
  clearTimeout(sensorCloseTimer);
  if (sensorCloseHandler) $('sensorDialog').removeEventListener('animationend',sensorCloseHandler);
  sensorCloseHandler=null;
  $('sensorDialog').classList.remove('is-closing');
}
function openSensors(kind, trigger){
  if (!hasAccess('monitor') || !fbConnected || !['temperature','humidity'].includes(kind)) return;
  cancelSensorClose();
  closeSide(); closePicker();
  sensorReturnFocus=trigger;
  $('sensorDialogTitle').textContent=kind==='temperature' ? 'Detail 6 sensor suhu DS18B20' : 'Detail 4 sensor kelembapan DHT22';
  document.querySelectorAll('[data-sensor-panel]').forEach(panel=>{ panel.hidden=panel.dataset.sensorPanel!==kind; });
  renderSensors();
  if (!$('sensorDialog').open) $('sensorDialog').showModal();
  $('sensorDialog').scrollTop=0;
  syncScrollLock();
  $('btnCloseSensors').focus();
}
function closeSensors(restoreFocus=true){
  const dialog=$('sensorDialog');
  if (!dialog.open) return;
  if (dialog.classList.contains('is-closing') && restoreFocus) return;
  cancelSensorClose();
  const finish=()=>{
    cancelSensorClose();
    dialog.close();
    document.querySelectorAll('[data-sensor-panel]').forEach(panel=>{ panel.hidden=true; });
    syncScrollLock();
    if (restoreFocus && fbConnected && sensorReturnFocus?.isConnected) sensorReturnFocus.focus({preventScroll:true});
    sensorReturnFocus=null;
  };
  if (!restoreFocus || !fbConnected || reducedMotion()){ finish(); return; }
  sensorCloseHandler=e=>{ if(e.target===dialog && e.animationName==='sensor-dialog-out') finish(); };
  dialog.addEventListener('animationend',sensorCloseHandler);
  dialog.classList.add('is-closing');
  sensorCloseTimer=setTimeout(finish,240);
}
let selectedPage='dash';
function applyAccessView(){
  const loading=!authResolved,monitor=hasAccess('monitor'),admin=hasAccess('admin');
  $('adminNav').hidden=$('profileAdmin').hidden=!admin;
  $('profileRole').textContent=admin?'Admin':accessState?.enabled?'User':'Akses belum aktif';
  document.querySelectorAll('[data-permission]').forEach(n=>{n.hidden=!loading&&!hasAccess(n.dataset.permission);});
  document.querySelectorAll('.side-link').forEach(n=>{if(n.dataset.page!=='admin')n.hidden=!loading&&n.dataset.page!=='dash'&&!monitor;});
  $('accessNotice').textContent=accessState?.enabled?'Akun ini belum memiliki izin Kandang A. Hubungi Admin.':'Akses Kandang A belum aktif. Hubungi Admin untuk mendapatkan izin.';
  if(!loading&&(selectedPage==='admin'&&!admin || ['log','event','herd'].includes(selectedPage)&&!monitor))selectedPage='dash';
  document.querySelectorAll('main.container > section').forEach(n=>{
    let permitted=true;
    if(n.id==='accessNotice')permitted=!loading&&!monitor;
    else if(n.dataset.page==='admin')permitted=admin;
    else if(n.matches('.summary-grid,.command-grid,.insights-grid,.cond-section,.settings-section') || ['log','event','herd'].includes(n.dataset.page))permitted=loading||monitor;
    n.hidden=!permitted || (!!n.dataset.page&&n.dataset.page!==selectedPage);
    n.style.display=n.hidden?'none':'';
  });
  document.querySelectorAll('.side-link').forEach(b=>{b.classList.toggle('active',b.dataset.page===selectedPage);if(b.dataset.page===selectedPage)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  if(fbConnected){document.title=`${PAGE_TITLES[selectedPage]} — COSTMOSYS`;$('pageBreadcrumb').textContent=PAGE_TITLES[selectedPage];}
}
function showPage(p){
  closeSensors(false);
  if (!['log','event','herd','admin'].includes(p)) p = 'dash';
  if(p==='admin'&&!hasAccess('admin') || ['log','event','herd'].includes(p)&&!hasAccess('monitor'))p='dash';
  selectedPage=p;
  let pageIndex=0;
  document.querySelectorAll('main.container > section').forEach((s) => {
    var show = (!s.dataset.page || s.dataset.page === p);
    if (show){
      s.style.display = '';
      s.classList.remove('page-in');
      s.style.setProperty('--page-delay',`${Math.min(pageIndex++ * 40,160)}ms`);
      void s.offsetWidth;
      s.classList.add('page-in');
    } else {
      s.classList.remove('page-in');
      s.style.display = 'none';
    }
  });
  document.querySelectorAll('.side-link').forEach((b) => { b.classList.toggle('active', b.dataset.page === p); if(b.dataset.page===p) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current'); });
  applyAccessView();
  document.title = `${PAGE_TITLES[p]} — COSTMOSYS`;
  if(fbConnected)try { localStorage.setItem('scs_page', p); } catch {}
  closeSide();
  window.scrollTo(0, 0);
  if(fbConnected) $('mainContent').focus({preventScroll:true});
  if (p === 'dash' && typeof drawChart === 'function') drawChart();
}
applyTheme(curTheme());
$('themeBtn').onclick = ()=> applyTheme(curTheme() === 'light' ? 'dark' : 'light');
$('menuBtn').addEventListener('click', ()=>{ if ($('sidebar').classList.contains('open')) closeSide(); else openSide(); });
$('sideClose').addEventListener('click', (e) => { e.stopPropagation(); closeSide(); });
$('sideOverlay').addEventListener('click', closeSide);
document.addEventListener('click', (e) => {
  if (e.target && e.target.closest && e.target.closest('#sideClose')) closeSide();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape'){
    if ($('sensorDialog').open){ e.preventDefault(); closeSensors(); return; }
    closeSide(); closeConfirm(false); closePicker();
  }
  if (e.key === 'Tab'){
    const modal = $('sensorDialog').open ? $('sensorDialog') : !$('confirmOverlay').hidden ? $('confirmOverlay') : mobileNavigation() && $('sidebar').classList.contains('open') ? $('sidebar') : null;
    if (!modal) return;
    const focusable=[...modal.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled)')].filter(el=>el.getClientRects().length);
    const first=focusable[0], last=focusable.at(-1);
    if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
  }
});
document.querySelectorAll('[data-sensors]').forEach(button=>button.addEventListener('click',()=>openSensors(button.dataset.sensors,button)));
$('btnCloseSensors').addEventListener('click',()=>closeSensors());
$('sensorDialog').addEventListener('cancel',e=>{ e.preventDefault(); closeSensors(); });
let sensorBackdropDown=false;
function outsideSensorDialog(e){ const r=$('sensorDialog').getBoundingClientRect(); return e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom; }
$('sensorDialog').addEventListener('pointerdown',e=>{ sensorBackdropDown=e.target===$('sensorDialog') && outsideSensorDialog(e); });
$('sensorDialog').addEventListener('click',e=>{ if(sensorBackdropDown && e.target===$('sensorDialog') && outsideSensorDialog(e)) closeSensors(); sensorBackdropDown=false; });
$('confirmYes').onclick = () => closeConfirm(true);
$('confirmNo').onclick = () => closeConfirm(false);
$('confirmOverlay').addEventListener('pointerdown', (e) => { if (e.target === $('confirmOverlay')) closeConfirm(false); });
document.querySelectorAll('.side-link').forEach((b) => { b.addEventListener('click', () => showPage(b.dataset.page)); });
history=[]; logs=[]; events=[];
buildGrid(6); buildHumidityGrid(); buildLogHead(6); syncButtons(); renderSensors(); renderLogs(); renderEvents(); drawChart(); renderSprinkler(); renderHerd(); renderConditions();
try { showPage(localStorage.getItem('scs_page') || 'dash'); } catch { showPage('dash'); }
document.title='Memuat — COSTMOSYS';
$('localPreviewNotice').hidden=!['localhost','127.0.0.1','::1','[::1]'].includes(location.hostname);
window.addEventListener('resize',()=>setSide($('sidebar').classList.contains('open') && mobileNavigation()));
sessionWaitTimer=setTimeout(sessionFailed,15000);
fbConnect();
setInterval(refreshTelemetry,1000);
setInterval(() => { updateSchedHint(); updateModeInfo(); }, 30000);
