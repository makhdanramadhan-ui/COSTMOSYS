(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SCSHerd = api;
})(typeof self !== 'undefined' ? self : globalThis, () => {
  const SCHEMA_VERSION = 1;
  const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
  const FUTURE_GRACE_MS = 10 * 60 * 1000;
  const WINDOW_TOL_S = 0.6;
  const DURATION_KEYS = ['standing', 'lying', 'mixed', 'partial', 'unobserved', 'gap'];
  const REQUIRED_KEYS = ['standing', 'lying', 'mixed'];
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const seconds = (v) => finite(v) && v >= 0 && v <= 172800;
  const r1 = (v) => Math.round(v * 10) / 10;
  const dayOf = (ts, offsetH) => new Date(ts + offsetH * 3600e3).toISOString().slice(0, 10);
  const isDay = (v) => typeof v === 'string' && /^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(v);
  const isIso = (v) => typeof v === 'string' && /^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(v);

  function zoneOf(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const durations = raw.durationsS;
    if (!durations || typeof durations !== 'object' || Array.isArray(durations)) return null;
    const values = {};
    for (const key of Object.keys(durations)) {
      if (!DURATION_KEYS.includes(key) || !seconds(durations[key])) return null;
      values[key] = durations[key];
    }
    for (const key of REQUIRED_KEYS) if (!(key in values)) return null;
    for (const key of DURATION_KEYS) if (!(key in values)) values[key] = 0;
    const reasons = raw.unobservedReasons;
    const reasonsS = {};
    if (reasons !== undefined && reasons !== null) {
      if (typeof reasons !== 'object' || Array.isArray(reasons)) return null;
      for (const [reason, value] of Object.entries(reasons)) {
        if (!reason || !seconds(value)) return null;
        reasonsS[reason] = value;
      }
    }
    const sum = DURATION_KEYS.reduce((total, key) => total + values[key], 0);
    return { durations: values, sum, reasonsS };
  }

  function segmentOf(dayKey, runId, raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (raw.schemaVersion !== SCHEMA_VERSION) return null;
    const start = raw.windowStartTs, end = raw.windowEndTs, offsetH = raw.tzOffsetH;
    if (!finite(start) || !finite(end) || end <= start) return null;
    if (start < 1600000000000 || end > 2200000000000) return null;
    if (!Number.isInteger(offsetH) || offsetH < -12 || offsetH > 14) return null;
    const windowS = (end - start) / 1000;
    if (!seconds(raw.windowS) || raw.windowS <= 0 || Math.abs(raw.windowS - windowS) > 1) return null;
    if (!isIso(raw.startLocal) || Math.abs(Date.parse(raw.startLocal) - start) > 1500) return null;
    if (dayOf(start, offsetH) !== dayKey) return null;
    if (!raw.zones || typeof raw.zones !== 'object' || Array.isArray(raw.zones)) return null;
    const names = Object.keys(raw.zones);
    if (!names.length) return null;
    const zones = {};
    for (const name of names) {
      if (!/^[A-Za-z0-9_]{1,32}$/.test(name)) return null;
      const zone = zoneOf(raw.zones[name]);
      if (!zone || Math.abs(zone.sum - windowS) > WINDOW_TOL_S) return null;
      zones[name] = zone;
    }
    const ts = raw.ts === undefined || raw.ts === null ? 0 : raw.ts;
    if (!finite(ts) || ts < 0) return null;
    const boundary = raw.boundary === undefined || raw.boundary === null ? 'exact' : raw.boundary;
    if (boundary !== 'exact' && boundary !== 'unknown') return null;
    const samples = Number.isInteger(raw.samples) && raw.samples >= 0 ? raw.samples : null;
    const personFrames = raw.person && Number.isInteger(raw.person.framesWithPerson) && raw.person.framesWithPerson >= 0
      ? raw.person.framesWithPerson : null;
    return { runId, day: dayKey, startTs: start, endTs: end, windowS, ts, boundary, samples, personFrames,
      video: typeof raw.video === 'string' ? raw.video : '', zones };
  }

  function supersedes(candidate, current) {
    if (candidate.ts !== current.ts) return candidate.ts > current.ts;
    return candidate.runId > current.runId;
  }

  function view(days, now = Date.now()) {
    const result = { present: false, days: [], latest: null, stale: null, staleAfterMs: STALE_AFTER_MS,
      unknownBoundary: 0, invalidDays: 0, invalidSegments: 0, overlapDropped: 0 };
    if (!days || typeof days !== 'object' || Array.isArray(days) || !finite(now)) return result;
    const keys = Object.keys(days);
    const dayKeys = keys.filter(isDay).sort();
    result.invalidDays = keys.length - dayKeys.length;
    let latest = null;
    const out = [];
    for (const dayKey of dayKeys) {
      const node = days[dayKey];
      const day = { day: dayKey, segments: 0, windowS: 0, invalid: 0, unknownBoundary: 0,
        superseded: 0, overlapDropped: 0, personFrames: 0, samples: 0,
        firstStartTs: null, lastEndTs: null, zones: {} };
      if (!node || typeof node !== 'object' || Array.isArray(node)) {
        day.invalid = 1;
        result.invalidSegments++;
        out.push(day);
        continue;
      }
      const seen = new Map();
      let exact = 0;
      for (const runId of Object.keys(node).sort()) {
        const segment = segmentOf(dayKey, runId, node[runId]);
        if (!segment) {
          day.invalid++;
          result.invalidSegments++;
          continue;
        }
        if (!latest || segment.endTs > latest.windowEndTs) latest = { day: dayKey, windowEndTs: segment.endTs };
        if (segment.boundary !== 'exact') {
          day.unknownBoundary++;
          result.unknownBoundary++;
          continue;
        }
        exact++;
        const key = `${segment.startTs}:${segment.endTs}:${segment.video}`;
        const current = seen.get(key);
        if (!current || supersedes(segment, current)) seen.set(key, segment);
      }
      day.superseded = exact - seen.size;
      const kept = [];
      const candidates = [...seen.values()].sort((a, b) => b.windowS - a.windowS || a.startTs - b.startTs
        || b.ts - a.ts || (a.runId < b.runId ? 1 : -1));
      for (const segment of candidates) {
        if (kept.some((other) => segment.startTs < other.endTs && segment.endTs > other.startTs)) {
          day.overlapDropped++;
          result.overlapDropped++;
          continue;
        }
        kept.push(segment);
      }
      for (const segment of kept.sort((a, b) => a.startTs - b.startTs || (a.runId < b.runId ? -1 : 1))) {
        day.segments++;
        day.windowS += segment.windowS;
        day.personFrames = day.personFrames === null || segment.personFrames === null ? null : day.personFrames + segment.personFrames;
        day.samples = day.samples === null || segment.samples === null ? null : day.samples + segment.samples;
        if (day.firstStartTs === null || segment.startTs < day.firstStartTs) day.firstStartTs = segment.startTs;
        if (day.lastEndTs === null || segment.endTs > day.lastEndTs) day.lastEndTs = segment.endTs;
        for (const [name, zone] of Object.entries(segment.zones)) {
          const target = day.zones[name] || (day.zones[name] = {
            windows: 0, windowS: 0, standingS: 0, lyingS: 0, mixedS: 0, observedS: 0,
            partialS: 0, unobservedS: 0, gapS: 0, coveragePct: 0, partialPct: 0,
            reasonsS: {}, firstStartTs: segment.startTs, lastEndTs: segment.endTs });
          target.windows++;
          target.windowS += zone.sum;
          target.standingS += zone.durations.standing;
          target.lyingS += zone.durations.lying;
          target.mixedS += zone.durations.mixed;
          target.partialS += zone.durations.partial;
          target.unobservedS += zone.durations.unobserved;
          target.gapS += zone.durations.gap;
          target.observedS += zone.durations.standing + zone.durations.lying + zone.durations.mixed;
          if (segment.startTs < target.firstStartTs) target.firstStartTs = segment.startTs;
          if (segment.endTs > target.lastEndTs) target.lastEndTs = segment.endTs;
          for (const [reason, value] of Object.entries(zone.reasonsS)) target.reasonsS[reason] = (target.reasonsS[reason] || 0) + value;
        }
      }
      for (const target of Object.values(day.zones)) {
        for (const key of ['windowS', 'standingS', 'lyingS', 'mixedS', 'observedS', 'partialS', 'unobservedS', 'gapS']) target[key] = r1(target[key]);
        for (const [reason, value] of Object.entries(target.reasonsS)) target.reasonsS[reason] = r1(value);
        target.coveragePct = target.windowS > 0 ? r1(100 * target.observedS / target.windowS) : 0;
        target.partialPct = target.windowS > 0 ? r1(100 * target.partialS / target.windowS) : 0;
      }
      day.windowS = r1(day.windowS);
      if (!day.segments) {
        day.personFrames = null;
        day.samples = null;
      }
      out.push(day);
    }
    result.days = out;
    result.present = latest !== null;
    if (latest) {
      const ageMs = now - latest.windowEndTs;
      result.latest = { day: latest.day, windowEndTs: latest.windowEndTs, ageMs };
      result.stale = ageMs > STALE_AFTER_MS || ageMs < -FUTURE_GRACE_MS;
    }
    return result;
  }
  return { view, SCHEMA_VERSION, STALE_AFTER_MS };
});
