#pragma once
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

inline float aggregateThi(float temperature, float humidity) {
  if (!isfinite(temperature) || temperature < -55 || temperature > 125 ||
      !isfinite(humidity) || humidity < 0 || humidity > 100) return NAN;
  return (1.8f * temperature + 32.0f) -
    (0.55f - 0.0055f * humidity) * (1.8f * temperature - 26.0f);
}

constexpr uint32_t CYCLE_MAGIC = 0x43594331;
constexpr uint8_t CYCLE_STORE_VERSION = 2;
constexpr uint32_t CYCLE_MAX_STARTS = 100;
constexpr uint32_t CYCLE_BOOT_COOLDOWN_S = 86400;
constexpr uint32_t CYCLE_MAX_COOLDOWN_S = 86400;
constexpr uint32_t CYCLE_RETRY_MS = 5000;

enum class CyclePhase : uint8_t { Idle, Spraying, Cooldown };
enum class CycleSource : uint8_t { None, Threshold, Schedule, Manual };

struct CycleStored {
  uint32_t magic;
  uint8_t version, phase;
  char day[11];
  uint32_t cyclesToday;
  int64_t sprayStartedTs, cooldownUntilTs, clockFloorTs;
  uint32_t cycleCooldownS;
};

struct CycleState {
  CycleStored p;
  CycleSource source;
  bool sprayThi, clockOk, dirty, recoveringCooldown;
  uint32_t startMs, limitMs, endMs, retryMs;
  int64_t lastEpochMs;
  uint32_t lastClockMs;
};

struct CycleEnv {
  uint32_t nowMs, maxCycles, maxDurationS, cooldownS;
  int64_t epochMs;
  bool clockReady, manualMode, manualOn, manualOffEdge, autoSchedule, scheduleActive, thiBasis;
  bool completeTemp, completeThi;
  float value, threshold;
};

struct CycleOut {
  bool relayOn;
  const char *type, *reason;
};

inline void cycleDay(int64_t epochMs, char out[11]) {
  int64_t days = (epochMs / 1000 + 25200) / 86400 + 719468;
  int64_t era = days / 146097;
  int64_t doe = days - era * 146097;
  int64_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  int64_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  int64_t mp = (5 * doy + 2) / 153;
  int64_t d = doy - (153 * mp + 2) / 5 + 1;
  int64_t m = mp < 10 ? mp + 3 : mp - 9;
  int64_t y = yoe + era * 400 + (m <= 2);
  snprintf(out, 11, "%04d-%02d-%02d", int(y), int(m), int(d));
}

inline bool msReached(uint32_t now, uint32_t deadline) { return int32_t(now - deadline) >= 0; }

inline const char *cyclePhaseName(CyclePhase p) {
  return p == CyclePhase::Spraying ? "spraying" : p == CyclePhase::Cooldown ? "cooldown" : "idle";
}

inline const char *cycleSourceName(CycleSource s) {
  switch (s) {
    case CycleSource::Threshold: return "threshold";
    case CycleSource::Schedule: return "schedule";
    case CycleSource::Manual: return "manual";
    default: return nullptr;
  }
}

inline void cycleRestore(CycleState &st, bool fresh, bool corrupt, const CycleStored &stored, const CycleEnv &e) {
  memset(&st, 0, sizeof st);
  st.p.magic = CYCLE_MAGIC;
  st.p.version = CYCLE_STORE_VERSION;
  if (fresh) return;
  if (corrupt || stored.magic != CYCLE_MAGIC || stored.version != CYCLE_STORE_VERSION || stored.phase > 2 || stored.cyclesToday > 100 || stored.cycleCooldownS > CYCLE_MAX_COOLDOWN_S || stored.day[10] != '\0') {
    st.p.cyclesToday = CYCLE_MAX_STARTS;
    st.dirty = true;
    return;
  }
  st.p = stored;
  if (st.p.phase == uint8_t(CyclePhase::Spraying) || st.p.phase == uint8_t(CyclePhase::Cooldown)) {
    uint32_t remMs = st.p.cycleCooldownS * 1000u;
    st.recoveringCooldown = st.p.phase == uint8_t(CyclePhase::Cooldown) && st.p.cooldownUntilTs > 0;
    st.p.phase = uint8_t(CyclePhase::Cooldown);
    st.source = CycleSource::None;
    st.p.sprayStartedTs = 0;
    st.endMs = e.nowMs + remMs;
    if (!st.recoveringCooldown) st.p.cooldownUntilTs = 0;
    st.dirty = true;
  }
}

inline bool sameStored(const CycleStored &a, const CycleStored &b) {
  return memcmp(a.day, b.day, sizeof(a.day)) == 0 && a.cyclesToday == b.cyclesToday &&
    a.phase == b.phase && a.sprayStartedTs == b.sprayStartedTs && a.cooldownUntilTs == b.cooldownUntilTs && a.cycleCooldownS == b.cycleCooldownS && a.clockFloorTs == b.clockFloorTs;
}

inline void endCycle(CycleState &n, const CycleEnv &e) {
  n.p.phase = uint8_t(CyclePhase::Cooldown);
  n.source = CycleSource::None;
  n.limitMs = 0;
  n.p.sprayStartedTs = 0;
  n.endMs = e.nowMs + n.p.cycleCooldownS * 1000u;
  n.p.cooldownUntilTs = n.clockOk ? e.epochMs + int64_t(n.p.cycleCooldownS) * 1000 : 0;
  if (n.clockOk) n.p.clockFloorTs = e.epochMs;
}

inline int32_t cycleRemainSec(const CycleState &st, uint32_t nowMs) {
  if (st.p.phase == uint8_t(CyclePhase::Spraying)) {
    if (!st.limitMs) return -1;
    uint32_t el = nowMs - st.startMs;
    return el >= st.limitMs ? 0 : int32_t((st.limitMs - el + 999) / 1000);
  }
  if (st.p.phase == uint8_t(CyclePhase::Cooldown)) {
    if (st.recoveringCooldown) return -1;
    int32_t r = int32_t(st.endMs - nowMs);
    return r > 0 ? (r + 999) / 1000 : 0;
  }
  return 0;
}

template <typename Save>
CycleOut cycleStep(CycleState &st, const CycleEnv &e, Save save) {
  CycleState n = st;
  CycleOut out = {false, nullptr, nullptr};
  char today[11];
  cycleDay(e.epochMs, today);
  n.clockOk = e.clockReady && (!st.p.clockFloorTs || e.epochMs + 2000 >= st.p.clockFloorTs) && (!st.lastEpochMs || e.epochMs + 2000 >= st.lastEpochMs + uint32_t(e.nowMs - st.lastClockMs));
  if (n.clockOk) { n.lastEpochMs = e.epochMs; n.lastClockMs = e.nowMs; }
  if (n.clockOk) {
    if (!n.p.day[0] || strcmp(today, n.p.day) > 0) {
      if (n.p.day[0]) n.p.cyclesToday = 0;
      memcpy(n.p.day, today, sizeof(n.p.day));
    } else if (strcmp(today, n.p.day) < 0) {
      n.clockOk = false;
    }
  }

  if (n.p.phase == uint8_t(CyclePhase::Spraying)) {
    bool manualRun = n.source == CycleSource::Manual;
    bool complete = n.sprayThi ? e.completeThi : e.completeTemp;
    const char *why = nullptr;
    if (manualRun) {
      if (!e.manualMode) why = "mode auto";
      else if (!e.manualOn) why = "perintah web";
    } else if (e.manualMode) why = "mode manual";
    else if (e.manualOffEdge) why = "perintah web";
    else if (!complete) why = "sensor tidak lengkap / stale";
    else if (n.source == CycleSource::Schedule && !e.scheduleActive) why = "di luar jendela jadwal";
    else if (n.limitMs && msReached(e.nowMs, n.startMs + n.limitMs)) why = "durasi maks";
    if (why) {
      out.type = manualRun ? "manual_off" : "auto_off";
      out.reason = why;
      endCycle(n, e);
    }
  }

  if (n.recoveringCooldown && n.clockOk) {
    int64_t left = n.p.cooldownUntilTs - e.epochMs;
    n.endMs = e.nowMs + (left > 0 && left <= int64_t(CYCLE_MAX_COOLDOWN_S) * 1000 ? uint32_t(left) : left > 0 ? CYCLE_MAX_COOLDOWN_S * 1000u : 0);
    n.recoveringCooldown = false;
  }
  if (n.p.phase == uint8_t(CyclePhase::Cooldown)) {
    if (!n.recoveringCooldown && msReached(e.nowMs, n.endMs)) {
      n.p.phase = uint8_t(CyclePhase::Idle);
      n.p.cooldownUntilTs = 0;
    } else if (n.clockOk && n.p.cooldownUntilTs == 0) {
      n.p.cooldownUntilTs = e.epochMs + int64_t(n.endMs - e.nowMs);
    }
  }

  bool saved = false;
  if (e.manualMode) {
    if (e.manualOn && n.p.phase != uint8_t(CyclePhase::Spraying) && !out.type) {
      CycleState a = n;
      a.p.phase = uint8_t(CyclePhase::Spraying);
      a.source = CycleSource::Manual;
      a.startMs = e.nowMs;
      a.limitMs = 0;
      a.sprayThi = e.thiBasis;
      a.p.sprayStartedTs = a.clockOk ? e.epochMs : 0;
      a.p.cycleCooldownS = e.cooldownS;
      a.p.cooldownUntilTs = 0;
      if (save(a.p)) { n = a; n.dirty = false; saved = true; out.type = "manual_on"; out.reason = "perintah web"; }
    }
  } else if (n.p.phase == uint8_t(CyclePhase::Idle) && n.clockOk && !n.dirty && !e.manualOffEdge &&
             (e.thiBasis ? e.completeThi : e.completeTemp) && n.p.cyclesToday < e.maxCycles &&
             e.value >= e.threshold && (!e.autoSchedule || e.scheduleActive)) {
    CycleState a = n;
    a.p.cyclesToday++;
    a.p.phase = uint8_t(CyclePhase::Spraying);
    a.source = e.autoSchedule ? CycleSource::Schedule : CycleSource::Threshold;
    a.sprayThi = e.thiBasis;
    a.startMs = e.nowMs;
    a.limitMs = e.maxDurationS * 1000u;
    a.p.sprayStartedTs = e.epochMs;
    a.p.clockFloorTs = e.epochMs;
    a.p.cycleCooldownS = e.cooldownS;
    a.p.cooldownUntilTs = 0;
    a.dirty = false;
    if (save(a.p)) {
      n = a;
      saved = true;
      out.type = "auto_on";
      out.reason = e.thiBasis ? "THI >= threshold" : "suhu DS >= threshold";
    }
  }

  bool changed = !sameStored(n.p, st.p);
  if (!saved && (changed || (n.dirty && msReached(e.nowMs, n.retryMs)))) {
    n.dirty = !save(n.p);
    n.retryMs = e.nowMs + CYCLE_RETRY_MS;
  }
  st = n;
  out.relayOn = st.p.phase == uint8_t(CyclePhase::Spraying);
  return out;
}

inline void formatLcdMetric(char *out, size_t outSize, const char *prefix, float value,
                            bool valid, uint8_t decimals, const char *suffix) {
  if (!valid || !isfinite(value)) {
    snprintf(out, outSize, "%s--%s", prefix, suffix);
    return;
  }
  snprintf(out, outSize, "%s%.*f%s", prefix, decimals, value, suffix);
}

inline void formatLcdRows(float avgTemp, bool tempValid, float avgHumidity, bool humidityValid,
                          float thi, bool thiValid, char row0[17], char row1[17]) {
  char tempPart[9];
  char rhPart[9];
  char thiPart[13];
  uint8_t tempDecimals = (tempValid && isfinite(avgTemp) && (avgTemp >= 99.95f || avgTemp <= -9.95f)) ? 0 : 1;
  uint8_t rhDecimals = (humidityValid && isfinite(avgHumidity) && avgHumidity >= 99.95f) ? 0 : 1;
  formatLcdMetric(tempPart, sizeof(tempPart), "T:", avgTemp, tempValid, tempDecimals, "C");
  formatLcdMetric(rhPart, sizeof(rhPart), "RH:", avgHumidity, humidityValid, rhDecimals, "%");
  formatLcdMetric(thiPart, sizeof(thiPart), "THI:", thi, thiValid, 2, "");
  char line0[17];
  snprintf(line0, sizeof(line0), "%s %s", tempPart, rhPart);
  snprintf(row0, 17, "%-16.16s", line0);
  snprintf(row1, 17, "%-16.16s", thiPart);
}
