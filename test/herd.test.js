const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../js/herd.js');

const T0 = Date.parse('2026-09-26T16:29:11+07:00');
const DAY = 86400000;
const zone = (over = {}) => ({
  durationsS: { standing: 30, lying: 0, mixed: 0, partial: 0, unobserved: 90, gap: 0 },
  windowS: 120, observedPct: 25, unobservedReasons: { crowd: 10 }, ...over });
const seg = (over = {}) => ({
  schemaVersion: 1, video: 'clip.mp4', windowStartTs: T0, windowEndTs: T0 + 120000,
  startLocal: '2026-09-26T16:29:11.000+07:00', tzOffsetH: 7, windowS: 120,
  samples: 61, everyS: 2, maxGapS: 6, weightsName: 'w.pt',
  weightsSha256: '0'.repeat(64), ts: T0 + 200000, boundary: 'exact',
  zones: { R1_near: zone() }, ...over });
const day = (runId, value) => ({ [runId]: value });

test('no feed is a neutral empty state, not zero coverage', () => {
  for (const raw of [null, undefined, {}, []]) {
    const v = H.view(raw, T0);
    assert.equal(v.present, false);
    assert.deepEqual(v.days, []);
    assert.equal(v.latest, null);
    assert.equal(v.stale, null);
  }
});

test('one window produces zone durations and coverage', () => {
  const v = H.view({ '2026-09-26': day('clip__00000000', seg()) }, T0 + 130000);
  assert.equal(v.present, true);
  assert.equal(v.days.length, 1);
  const d = v.days[0], z = d.zones.R1_near;
  assert.equal(d.day, '2026-09-26');
  assert.equal(d.segments, 1);
  assert.equal(d.windowS, 120);
  assert.equal(z.observedS, 30);
  assert.equal(z.windowS, 120);
  assert.equal(z.coveragePct, 25);
  assert.equal(z.unobservedS, 90);
  assert.equal(z.reasonsS.crowd, 10);
  assert.equal(d.observedS, undefined, 'day totals must not be summed across overlapping zones');
});

test('stored observedPct is ignored in favour of the durations', () => {
  const raw = seg({ zones: { R1_near: zone({ observedPct: 99 }) } });
  const z = H.view({ '2026-09-26': day('r', raw) }, T0).days[0].zones.R1_near;
  assert.equal(z.coveragePct, 25);
});

test('window gaps stay gaps and are never bridged', () => {
  const raw = seg({ zones: { R1_near: zone({ durationsS: { standing: 20, lying: 0, mixed: 0, partial: 0, unobserved: 60, gap: 40 }, observedPct: 16.7 }) } });
  const z = H.view({ '2026-09-26': day('r', raw) }, T0).days[0].zones.R1_near;
  assert.equal(z.gapS, 40);
  assert.equal(z.observedS, 20);
  assert.equal(z.coveragePct, 16.7);
});

test('partial posture is reported separately from observed posture', () => {
  const raw = seg({ zones: { R1_near: zone({ durationsS: { standing: 10, lying: 0, mixed: 0, partial: 50, unobserved: 60, gap: 0 } }) } });
  const z = H.view({ '2026-09-26': day('r', raw) }, T0).days[0].zones.R1_near;
  assert.equal(z.observedS, 10);
  assert.equal(z.partialS, 50);
  assert.equal(z.partialPct, 41.7);
  assert.equal(z.coveragePct, 8.3);
});

test('stale feed is flagged from window end, never from the day key', () => {
  const raw = seg();
  assert.equal(H.view({ '2026-09-26': day('r', raw) }, T0 + 130000).stale, false);
  assert.equal(H.view({ '2026-09-26': day('r', raw) }, T0 + 120000 + DAY + 1).stale, true);
  assert.equal(H.view({ '2026-09-26': day('r', raw) }, T0 + 120000 - 11 * 60000).stale, true);
  assert.equal(H.view({ '2026-09-26': day('r', raw) }, T0 + 120000 - 5 * 60000).stale, false);
});

test('midnight split parts stay in their own day, no cross-day sum', () => {
  const midnight = Date.parse('2026-09-27T00:00:00+07:00');
  const pre = seg({ windowStartTs: midnight - 60000, windowEndTs: midnight,
    startLocal: '2026-09-26T23:59:00.000+07:00', windowS: 60,
    zones: { R1_near: zone({ durationsS: { standing: 20, lying: 0, mixed: 0, partial: 0, unobserved: 40, gap: 0 }, windowS: 60 }) },
    boundary: 'exact', split: { part: 1, of: 2 } });
  const post = seg({ windowStartTs: midnight, windowEndTs: midnight + 60000,
    startLocal: '2026-09-27T00:00:00.000+07:00', windowS: 60,
    zones: { R1_near: zone({ durationsS: { standing: 5, lying: 0, mixed: 0, partial: 0, unobserved: 55, gap: 0 }, windowS: 60 }) },
    boundary: 'exact', split: { part: 2, of: 2 } });
  const v = H.view({ '2026-09-26': day('clip__00000000', pre), '2026-09-27': day('clip__00000000', post) }, midnight + 3600000);
  assert.equal(v.days.length, 2);
  assert.equal(v.days[0].zones.R1_near.windowS, 60);
  assert.equal(v.days[0].zones.R1_near.observedS, 20);
  assert.equal(v.days[1].zones.R1_near.observedS, 5);
  assert.equal(v.days[0].zones.R1_near.observedS + v.days[1].zones.R1_near.observedS, 25);
});

test('crossing window without timing detail is unknown, not assigned to either day', () => {
  const midnight = Date.parse('2026-09-27T00:00:00+07:00');
  const raw = seg({ windowStartTs: midnight - 30000, windowEndTs: midnight + 30000,
    startLocal: '2026-09-26T23:59:30.000+07:00', windowS: 60,
    zones: { R1_near: zone({ durationsS: { standing: 10, lying: 0, mixed: 0, partial: 0, unobserved: 50, gap: 0 }, windowS: 60 }) },
    boundary: 'unknown' });
  const v = H.view({ '2026-09-26': day('clip__00000000', raw) }, midnight + 3600000);
  assert.equal(v.present, true);
  assert.equal(v.unknownBoundary, 1);
  assert.equal(v.days[0].zones.R1_near, undefined);
  assert.equal(v.days[0].unknownBoundary, 1);
  assert.equal(v.days[0].windowS, 0);
});

test('duplicate windows from two runs count once and the newest write wins', () => {
  const older = seg({ ts: 1000, zones: { R1_near: zone({ durationsS: { standing: 30, lying: 0, mixed: 0, partial: 0, unobserved: 90, gap: 0 } }) } });
  const newer = seg({ ts: 2000, zones: { R1_near: zone({ durationsS: { standing: 60, lying: 0, mixed: 0, partial: 0, unobserved: 60, gap: 0 } }) } });
  const d = H.view({ '2026-09-26': { a: older, b: newer } }, T0).days[0];
  assert.equal(d.segments, 1);
  assert.equal(d.superseded, 1);
  assert.equal(d.zones.R1_near.observedS, 60);
  assert.equal(d.windowS, 120);
});

test('equal write time resolves deterministically by runId', () => {
  const a = seg({ ts: 1000, zones: { R1_near: zone({ durationsS: { standing: 10, lying: 0, mixed: 0, partial: 0, unobserved: 110, gap: 0 } }) } });
  const b = seg({ ts: 1000, zones: { R1_near: zone({ durationsS: { standing: 20, lying: 0, mixed: 0, partial: 0, unobserved: 100, gap: 0 } }) } });
  const first = H.view({ '2026-09-26': { a, b } }, T0).days[0].zones.R1_near.observedS;
  const second = H.view({ '2026-09-26': { b, a } }, T0).days[0].zones.R1_near.observedS;
  assert.equal(first, 20);
  assert.equal(second, 20);
});

test('overlapping windows keep the longest and never add the same time twice', () => {
  const long = seg({ video: 'same.mp4', windowEndTs: T0 + 60000, windowS: 60,
    zones: { R1_near: zone({ durationsS: { standing: 20, lying: 0, mixed: 0, partial: 0, unobserved: 40, gap: 0 }, windowS: 60 }) } });
  const short = seg({ video: 'same.mp4', windowEndTs: T0 + 6000, windowS: 6,
    zones: { R1_near: zone({ durationsS: { standing: 3, lying: 0, mixed: 0, partial: 0, unobserved: 3, gap: 0 }, windowS: 6 }) } });
  const d = H.view({ '2026-09-26': { long, short } }, T0).days[0];
  assert.equal(d.segments, 1);
  assert.equal(d.overlapDropped, 1);
  assert.equal(d.windowS, 60);
  assert.equal(d.zones.R1_near.windowS, 60);
  assert.equal(d.zones.R1_near.observedS, 20);
});

test('adjacent windows are not overlaps', () => {
  const first = seg({ windowEndTs: T0 + 60000, windowS: 60,
    zones: { R1_near: zone({ durationsS: { standing: 20, lying: 0, mixed: 0, partial: 0, unobserved: 40, gap: 0 }, windowS: 60 }) } });
  const second = seg({ windowStartTs: T0 + 60000, windowEndTs: T0 + 120000, windowS: 60, startLocal: '2026-09-26T16:30:11.000+07:00',
    zones: { R1_near: zone({ durationsS: { standing: 10, lying: 0, mixed: 0, partial: 0, unobserved: 50, gap: 0 }, windowS: 60 }) } });
  const d = H.view({ '2026-09-26': { a: first, b: second } }, T0).days[0];
  assert.equal(d.segments, 2);
  assert.equal(d.overlapDropped, 0);
  assert.equal(d.windowS, 120);
  assert.equal(d.zones.R1_near.observedS, 30);
});

test('day personFrames and samples sum only kept exact segments', () => {
  const first = seg({ samples: 61, person: { framesWithPerson: 46 } });
  const second = seg({ windowStartTs: T0 + 120000, windowEndTs: T0 + 240000, windowS: 120,
    startLocal: '2026-09-26T16:31:11.000+07:00', samples: 60, person: { framesWithPerson: 3 } });
  const unknown = seg({ ts: 9999, boundary: 'unknown', samples: 1, person: { framesWithPerson: 999 } });
  const d = H.view({ '2026-09-26': { a: first, b: second, u: unknown } }, T0).days[0];
  assert.equal(d.segments, 2);
  assert.equal(d.samples, 121);
  assert.equal(d.personFrames, 49);
});

test('unknown frame or sample counts make the day sum null, never zero', () => {
  const missingFrames = seg({ samples: 61, person: { framesWithPerson: null } });
  const negative = seg({ windowStartTs: T0 + 120000, windowEndTs: T0 + 240000, windowS: 120,
    startLocal: '2026-09-26T16:31:11.000+07:00', samples: 60, person: { framesWithPerson: -1 } });
  const d = H.view({ '2026-09-26': { a: missingFrames, b: negative } }, T0).days[0];
  assert.equal(d.personFrames, null);
  assert.equal(d.samples, 121);
  const unknownOnly = H.view({ '2026-09-26': { u: seg({ boundary: 'unknown' }) } }, T0).days[0];
  assert.equal(unknownOnly.personFrames, null);
  assert.equal(unknownOnly.samples, null);
});

test('zones are separate views and never added together', () => {
  const raw = seg({ zones: {
    R1_near: zone({ durationsS: { standing: 10, lying: 0, mixed: 0, partial: 0, unobserved: 110, gap: 0 } }),
    R2_mid: zone({ durationsS: { standing: 20, lying: 0, mixed: 0, partial: 0, unobserved: 100, gap: 0 } }) } });
  const d = H.view({ '2026-09-26': day('r', raw) }, T0).days[0];
  assert.equal(d.zones.R1_near.observedS, 10);
  assert.equal(d.zones.R2_mid.observedS, 20);
  assert.equal(d.observedS, undefined);
  assert.equal(d.coveragePct, undefined);
});

test('malformed seasons are counted as invalid, never zeroed', () => {
  const badSum = seg({ zones: { R1_near: zone({ durationsS: { standing: 30, lying: 0, mixed: 0, partial: 0, unobserved: 60, gap: 0 } }) } });
  const wrongDay = seg({ startLocal: '2026-09-27T16:29:11.000+07:00', windowStartTs: T0 + DAY });
  const badSchema = seg({ schemaVersion: 2 });
  const v = H.view({ '2026-09-26': { a: badSum, b: wrongDay, c: badSchema } }, T0);
  assert.equal(v.present, false);
  assert.equal(v.invalidSegments, 3);
  assert.equal(v.days[0].invalid, 3);
  assert.equal(v.days[0].zones.R1_near, undefined);
});

test('non-date day keys are rejected and reported', () => {
  const v = H.view({ 'not-a-day': { r: seg() }, '2026-09-26': day('r', seg()) }, T0);
  assert.equal(v.invalidDays, 1);
  assert.equal(v.days.length, 1);
  assert.equal(v.present, true);
});
