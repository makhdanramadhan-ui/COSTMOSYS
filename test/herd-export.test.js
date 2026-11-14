const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const X = require('../scripts/herd-export.cjs');
const H = require('../js/herd.js');

const SHA = 'a'.repeat(64);
const summary = (over = {}) => ({
  video: 'E:\\drive cctv\\20260926_235800_tp00001.mp4',
  processed_s: 300, samples: 151, every_s: 2, max_gap_s: 6,
  start_local: '2026-09-26T23:58:00+07:00', tz_offset_h: 7,
  detector: { weights: 'E:\\weights\\yolo11n.pt', weights_sha256: SHA, model_names: { 0: 'person', 19: 'cow' }, conf: 0.25, imgsz: 1280 },
  quality: { samples_with_person: 3, cows_per_sample_mean: 2.5, cow_conf_mean: 0.5, samples_without_cow: 0 },
  summaries: { R1_near: { durations_s: {
    standing: 120, lying: 0, mixed: 0, sebagian_teramati: 0, kurang_terlihat: 180, gap: 0 },
    total_s: 300, observed_pct: 40, unobserved_reasons_s: { crowd: 30 } } },
  ...over });
const EVENTS = [
  'zone,state,dur_s,start_s,end_s,start_local,end_local,n_cows,n_persons,reasons,uncertainty_s',
  'R1_near,standing,120.0,0.0,120.0,2026-09-26 23:58:00,2026-09-27 00:00:00,2,0,crowd,2.0',
  'R1_near,kurang_terlihat,180.0,120.0,300.0,2026-09-27 00:00:00,2026-09-27 00:03:00,1,0,no_detection,2.0'
].join('\n');

test('non-crossing window becomes one exact object with the RTDB field names', () => {
  const run = summary({ video: 'E:\\drive cctv\\20260926_162911_tp00002.mp4', processed_s: 120,
    start_local: '2026-09-26T16:29:11+07:00',
    summaries: { R1_near: { durations_s: { standing: 30, lying: 0, mixed: 0, kurang_terlihat: 90, gap: 0 },
      total_s: 120, observed_pct: 25, unobserved_reasons_s: { crowd: 10 } } } });
  const result = X.buildObjects(run, null, { ts: 1234 });
  assert.equal(result.objects.length, 1);
  const { day, runId, value } = result.objects[0];
  assert.equal(day, '2026-09-26');
  assert.equal(runId, '20260926_162911_tp00002__aaaaaaaa');
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.boundary, 'exact');
  assert.equal(value.windowStartTs, Date.parse('2026-09-26T16:29:11+07:00'));
  assert.equal(value.windowS, 120);
  assert.equal(value.zones.R1_near.durationsS.partial, 0);
  assert.equal(value.zones.R1_near.observedPct, 25);
  assert.equal(value.zones.R1_near.unobservedReasons.crowd, 10);
  assert.equal(value.zones.R1_near.nCowsMax, null);
  assert.equal(value.person.presentS, null);
  assert.equal(value.person.framesWithPerson, 3);
  assert.equal(value.ts, 1234);
});

test('window crossing WIB midnight splits exactly when events.csv covers the window', () => {
  const result = X.buildObjects(summary(), EVENTS, { ts: 9 });
  assert.equal(result.objects.length, 2);
  const [pre, post] = result.objects;
  assert.equal(pre.day, '2026-09-26');
  assert.equal(post.day, '2026-09-27');
  assert.equal(pre.value.split.part, 1);
  assert.equal(post.value.split.part, 2);
  assert.equal(pre.value.windowS, 120);
  assert.equal(post.value.windowS, 180);
  assert.equal(pre.value.zones.R1_near.durationsS.standing, 120);
  assert.equal(pre.value.zones.R1_near.observedPct, 100);
  assert.equal(post.value.zones.R1_near.durationsS.unobserved, 180);
  assert.equal(post.value.zones.R1_near.observedPct, 0);
  assert.equal(Date.parse(pre.value.startLocal), pre.value.windowStartTs);
  assert.equal(Date.parse(post.value.startLocal), post.value.windowStartTs);
});

test('midnight split exports replay through the reader without double counting', () => {
  const { objects } = X.buildObjects(summary(), EVENTS, { ts: 9 });
  const days = {};
  for (const { day, runId, value } of objects) (days[day] || (days[day] = {}))[runId] = value;
  const now = Date.parse('2026-09-27T01:00:00+07:00');
  const view = H.view(days, now);
  assert.equal(view.present, true);
  assert.equal(view.invalidSegments, 0);
  assert.deepEqual(view.days.map((d) => d.day), ['2026-09-26', '2026-09-27']);
  assert.equal(view.days[0].zones.R1_near.observedS, 120);
  assert.equal(view.days[1].zones.R1_near.observedS, 0);
  assert.equal(view.days[0].zones.R1_near.observedS + view.days[1].zones.R1_near.observedS, 120);
});

test('crossing window without usable timing is exported as unknown boundary', () => {
  const result = X.buildObjects(summary(), null, { ts: 9 });
  assert.equal(result.objects.length, 1);
  assert.equal(result.objects[0].day, '2026-09-26');
  assert.equal(result.objects[0].value.boundary, 'unknown');
  const view = H.view({ '2026-09-26': { [result.objects[0].runId]: result.objects[0].value } }, Date.parse('2026-09-27T01:00:00+07:00'));
  assert.equal(view.unknownBoundary, 1);
  assert.equal(view.days[0].zones.R1_near, undefined);
});

test('events that do not cover the window are refused instead of guessed', () => {
  const short = EVENTS.split('\n').slice(0, 2).join('\n');
  const result = X.buildObjects(summary(), short, { ts: 9 });
  assert.equal(result.objects.length, 1);
  assert.equal(result.objects[0].value.boundary, 'unknown');
});

test('malformed summary is a hard error, not a zero-filled window', () => {
  assert.match(X.buildObjects(summary({ processed_s: 0 }), null, { ts: 1 }).error, /processed_s/);
  assert.match(X.buildObjects(summary({ detector: { weights_sha256: 'beef' } }), null, { ts: 1 }).error, /weights_sha256/);
  assert.match(X.buildObjects(summary({ summaries: { R1_near: { durations_s: { standing: 1, lying: 1, mixed: 1, kurang_terlihat: 1, gap: 1 } } } }), null, { ts: 1 }).error, /processed_s/);
});

function runDirs(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'summary.json') found.push(dir);
    }
  };
  walk(root);
  return found;
}

test('real monitor runs export and read end to end without Firebase', { skip: !fs.existsSync('E:/Dataset ML IoT/SmartCow-ML/monitor/out') && 'monitor out absent' }, () => {
  const root = 'E:/Dataset ML IoT/SmartCow-ML/monitor/out';
  const dirs = runDirs(root).filter((dir) => {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
      return typeof value.start_local === 'string' && value.start_local.length > 0;
    } catch { return false; }
  });
  assert.ok(dirs.length > 0);
  const { days, errors } = X.exportRuns(dirs);
  assert.deepEqual(errors, []);
  assert.ok(Object.keys(days).length > 0);
  const view = H.view(days, Date.now());
  assert.equal(view.present, true);
  assert.equal(view.invalidSegments, 0);
  for (const d of view.days) for (const z of Object.values(d.zones)) {
    assert.ok(z.windowS > 0);
    assert.ok(Math.abs(z.standingS + z.lyingS + z.mixedS + z.partialS + z.unobservedS + z.gapS - z.windowS) < 0.2);
  }
});
