#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const DAY_MS = 86400000;
const KEYS = ['standing', 'lying', 'mixed', 'partial', 'unobserved', 'gap'];
const REQUIRED = ['standing', 'lying', 'mixed'];
const STATES = { standing: 'standing', lying: 'lying', mixed: 'mixed',
  sebagian_teramati: 'partial', kurang_terlihat: 'unobserved', gap: 'gap' };
const r1 = (v) => Math.round(v * 10) / 10;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const dayOf = (ts, offsetH) => new Date(ts + offsetH * 3600e3).toISOString().slice(0, 10);
const isIso = (v) => typeof v === 'string' && /^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(v);

function isoLocal(ts, offsetH) {
  const d = new Date(ts + offsetH * 3600e3);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const sign = offsetH < 0 ? '-' : '+';
  const abs = Math.abs(offsetH);
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
    + `T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`
    + `${sign}${p(Math.floor(abs))}:${p(Math.round((abs - Math.floor(abs)) * 60))}`;
}

function nextLocalMidnight(ts, offsetH) {
  const local = ts + offsetH * 3600e3;
  return Math.floor(local / DAY_MS) * DAY_MS + DAY_MS - offsetH * 3600e3;
}

function parseEvents(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim().length);
  if (lines.length < 2) return null;
  const header = lines[0].split(',');
  const index = (name) => header.indexOf(name);
  for (const name of ['zone', 'state', 'start_s', 'end_s', 'reasons']) if (index(name) < 0) return null;
  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    if (cells.length !== header.length) return null;
    const state = STATES[cells[index('state')]];
    const start = Number(cells[index('start_s')]);
    const end = Number(cells[index('end_s')]);
    if (!cells[index('zone')] || !state || !finite(start) || !finite(end) || end < start) return null;
    rows.push({ zone: cells[index('zone')], state, start, end,
      reasons: (cells[index('reasons')] || '').split('|').filter(Boolean) });
  }
  return rows;
}

function groupEvents(rows, zones, windowS) {
  const map = {};
  for (const row of rows) {
    if (!zones.includes(row.zone)) return null;
    (map[row.zone] || (map[row.zone] = [])).push(row);
  }
  for (const zone of zones) {
    const list = (map[zone] || []).sort((a, b) => a.start - b.start);
    if (!list.length) return null;
    let cursor = 0;
    for (const event of list) {
      if (Math.abs(event.start - cursor) > 0.05) return null;
      cursor = event.end;
    }
    if (Math.abs(cursor - windowS) > 0.6) return null;
  }
  return map;
}

function splitZone(list, from, to) {
  const durations = { standing: 0, lying: 0, mixed: 0, partial: 0, unobserved: 0, gap: 0 };
  const reasons = {};
  for (const event of list) {
    const a = Math.max(event.start, from), b = Math.min(event.end, to);
    if (b <= a) continue;
    durations[event.state] += b - a;
    for (const reason of event.reasons) reasons[reason] = (reasons[reason] || 0) + (b - a);
  }
  return { durations, reasons };
}

function roundDurations(durations, windowS) {
  const out = {};
  for (const key of KEYS) out[key] = r1(durations[key]);
  const residual = r1(r1(windowS) - KEYS.reduce((total, key) => total + out[key], 0));
  if (residual !== 0) {
    let target = KEYS[0];
    for (const key of KEYS) if (out[key] > out[target]) target = key;
    out[target] = r1(out[target] + residual);
  }
  return out;
}

function zoneValues(summary, name) {
  const zone = summary.summaries && summary.summaries[name];
  if (!zone || typeof zone !== 'object' || Array.isArray(zone)) return null;
  const raw = zone.durations_s;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const durations = {};
  for (const key of Object.keys(raw)) {
    const mapped = STATES[key];
    if (!mapped || !finite(raw[key]) || raw[key] < 0) return null;
    durations[mapped] = raw[key];
  }
  for (const key of REQUIRED) if (!(key in durations)) return null;
  for (const key of KEYS) if (!(key in durations)) durations[key] = 0;
  const reasons = {};
  if (zone.unobserved_reasons_s !== undefined) {
    if (!zone.unobserved_reasons_s || typeof zone.unobserved_reasons_s !== 'object') return null;
    for (const [reason, value] of Object.entries(zone.unobserved_reasons_s)) {
      if (!reason || !finite(value) || value < 0) return null;
      reasons[reason] = value;
    }
  }
  return { durations, reasons };
}

function validate(summary) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return 'summary bukan objek';
  if (!isIso(summary.start_local)) return 'start_local tidak valid';
  if (!finite(summary.processed_s) || summary.processed_s <= 0 || summary.processed_s > 172800) return 'processed_s tidak valid';
  if (!Number.isInteger(summary.tz_offset_h) || summary.tz_offset_h < -12 || summary.tz_offset_h > 14) return 'tz_offset_h tidak valid';
  if (!Number.isInteger(summary.samples) || summary.samples < 2) return 'samples tidak valid';
  if (!finite(summary.every_s) || summary.every_s <= 0) return 'every_s tidak valid';
  if (!finite(summary.max_gap_s) || summary.max_gap_s <= 0) return 'max_gap_s tidak valid';
  if (!summary.detector || typeof summary.detector !== 'object') return 'detector tidak ada';
  if (!/^[0-9a-f]{64}$/.test(summary.detector.weights_sha256 || '')) return 'weights_sha256 tidak valid';
  if (!finite(summary.detector.conf) || !Number.isInteger(summary.detector.imgsz)) return 'setelan detektor tidak valid';
  if (!summary.detector.model_names || typeof summary.detector.model_names !== 'object') return 'model_names tidak ada';
  if (!summary.summaries || typeof summary.summaries !== 'object') return 'summaries tidak ada';
  const zones = Object.keys(summary.summaries);
  if (!zones.length) return 'zona kosong';
  if (!summary.video || typeof summary.video !== 'string') return 'video tidak ada';
  for (const name of zones) {
    const value = zoneValues(summary, name);
    if (!value) return `zona ${name} tidak valid`;
    const total = r1(KEYS.reduce((sum, key) => sum + value.durations[key], 0));
    if (Math.abs(total - summary.processed_s) > 0.6) return `zona ${name}: durasi tidak cocok dengan processed_s`;
  }
  return null;
}

function runIdOf(summary) {
  const stem = path.basename(summary.video, path.extname(summary.video));
  const id = `${stem}__${summary.detector.weights_sha256.slice(0, 8)}`;
  return /^[A-Za-z0-9_-]{1,140}$/.test(id) ? id : null;
}

function makeObject(summary, meta, window, zoneData) {
  const { startTs, endTs, offsetH } = window;
  const windowS = r1((endTs - startTs) / 1000);
  const quality = summary.quality || {};
  const zones = {};
  for (const [name, value] of Object.entries(zoneData)) {
    const durations = roundDurations(value.durations, windowS);
    const observed = durations.standing + durations.lying + durations.mixed;
    const reasons = {};
    for (const [reason, seconds] of Object.entries(value.reasons)) reasons[reason] = r1(seconds);
    zones[name] = { durationsS: durations, windowS, observedPct: r1(100 * observed / windowS),
      partialPct: r1(100 * durations.partial / windowS), unobservedReasons: reasons,
      nCowsMax: null, personPresentS: null };
  }
  const object = {
    schemaVersion: 1,
    video: path.basename(summary.video),
    windowStartTs: Math.round(startTs),
    windowEndTs: Math.round(endTs),
    startLocal: isoLocal(startTs, offsetH),
    tzOffsetH: offsetH,
    windowS,
    samples: summary.samples,
    everyS: summary.every_s,
    maxGapS: summary.max_gap_s,
    weightsName: path.basename(summary.detector.weights || ''),
    weightsSha256: summary.detector.weights_sha256,
    modelNames: summary.detector.model_names,
    conf: summary.detector.conf,
    imgsz: summary.detector.imgsz,
    ts: meta.ts,
    boundary: window.boundary,
    zones,
    person: { presentS: null,
      framesWithPerson: Number.isInteger(quality.samples_with_person) ? quality.samples_with_person : null,
      samplesTotal: summary.samples },
    quality: { cowsPerSampleMean: quality.cows_per_sample_mean === undefined ? null : quality.cows_per_sample_mean,
      cowConfMean: quality.cow_conf_mean === undefined ? null : quality.cow_conf_mean,
      samplesWithoutCow: quality.samples_without_cow === undefined ? null : quality.samples_without_cow }
  };
  if (window.split) {
    object.split = window.split;
    object.videoWindowStartTs = Math.round(meta.startTs);
    object.videoWindowEndTs = Math.round(meta.endTs);
  }
  return object;
}

function buildObjects(summary, eventsText, meta) {
  const error = validate(summary);
  if (error) return { error };
  const runId = runIdOf(summary);
  if (!runId) return { error: 'runId tidak aman untuk key Realtime Database' };
  const offsetH = summary.tz_offset_h;
  const startTs = Date.parse(summary.start_local);
  if (!finite(startTs)) return { error: 'start_local tidak dapat diurai' };
  const endTs = startTs + Math.round(summary.processed_s * 1000);
  const windowS = summary.processed_s;
  const zones = Object.keys(summary.summaries);
  const base = { ts: meta.ts, startTs, endTs };
  const crossing = dayOf(startTs, offsetH) !== dayOf(endTs - 1, offsetH);
  if (!crossing) {
    const data = {};
    for (const name of zones) data[name] = zoneValues(summary, name);
    const value = makeObject(summary, base, { startTs, endTs, offsetH, boundary: 'exact' }, data);
    return { objects: [{ day: dayOf(startTs, offsetH), runId, value }] };
  }
  const rows = eventsText ? parseEvents(eventsText) : null;
  const grouped = rows ? groupEvents(rows, zones, windowS) : null;
  if (!grouped) {
    const data = {};
    for (const name of zones) data[name] = zoneValues(summary, name);
    const value = makeObject(summary, base, { startTs, endTs, offsetH, boundary: 'unknown' }, data);
    return { objects: [{ day: dayOf(startTs, offsetH), runId, value }] };
  }
  const bounds = [startTs];
  let cursor = startTs;
  while (true) {
    const midnight = nextLocalMidnight(cursor, offsetH);
    if (midnight >= endTs) break;
    bounds.push(midnight);
    cursor = midnight;
  }
  bounds.push(endTs);
  const objects = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const from = (bounds[i] - startTs) / 1000;
    const to = (bounds[i + 1] - startTs) / 1000;
    const data = {};
    for (const name of zones) data[name] = splitZone(grouped[name], from, to);
    const value = makeObject(summary, base,
      { startTs: bounds[i], endTs: bounds[i + 1], offsetH, boundary: 'exact',
        split: { part: i + 1, of: bounds.length - 1 } }, data);
    objects.push({ day: dayOf(bounds[i], offsetH), runId, value });
  }
  return { objects };
}

function exportRuns(dirs) {
  const days = {};
  const errors = [];
  for (const dir of [...dirs].sort()) {
    const summaryPath = path.join(dir, 'summary.json');
    let summary;
    try {
      summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    } catch (error) {
      errors.push({ run: dir, error: error.message });
      continue;
    }
    const eventsPath = path.join(dir, 'events.csv');
    const eventsText = fs.existsSync(eventsPath) ? fs.readFileSync(eventsPath, 'utf8') : null;
    let result;
    try {
      result = buildObjects(summary, eventsText, { ts: Math.floor(fs.statSync(summaryPath).mtimeMs), source: dir });
    } catch (error) {
      errors.push({ run: dir, error: error.message });
      continue;
    }
    if (result.error) {
      errors.push({ run: dir, error: result.error });
      continue;
    }
    for (const { day, runId, value } of result.objects) {
      const target = days[day] || (days[day] = {});
      const current = target[runId];
      if (!current || value.ts > current.ts) target[runId] = value;
    }
  }
  return { days, errors };
}

function usage() {
  console.error('Pemakaian: node scripts/herd-export.cjs --runs <dir>[,<dir>...] --out <file.json>');
  console.error('Menulis JSON lokal berbentuk devices/<deviceId>/herd/days. Tidak menulis ke Firebase.');
  process.exitCode = 2;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const runs = [];
  let out = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--runs' && args[i + 1]) runs.push(...args[++i].split(',').map((value) => value.trim()).filter(Boolean));
    else if (args[i] === '--out' && args[i + 1]) out = args[++i];
    else { usage(); break; }
  }
  if (process.exitCode === 2) {
  } else if (!runs.length || !out) {
    usage();
  } else {
    const { days, errors } = exportRuns(runs);
    const payload = { contract: 'smartcow.herd.days', schemaVersion: 1, days };
    const target = path.resolve(out);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);
    const count = Object.values(days).reduce((total, day) => total + Object.keys(day).length, 0);
    console.log(`herd-export: ${count} objek, ${Object.keys(days).length} hari -> ${target}`);
    for (const failure of errors) console.error(`herd-export: ${failure.run}: ${failure.error}`);
    if (errors.length) process.exitCode = 1;
  }
}

module.exports = { exportRuns, buildObjects, parseEvents, groupEvents, splitZone, isoLocal, dayOf, nextLocalMidnight };
