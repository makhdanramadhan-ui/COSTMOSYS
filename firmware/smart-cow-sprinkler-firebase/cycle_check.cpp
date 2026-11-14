#include "espkanan_FINAL/ClimatePolicy.h"
#include <assert.h>
#include <stdio.h>
int main() {
  CycleState s = {}; CycleStored saved = {}; CycleEnv e = {};
  e.clockReady = true; e.completeTemp = true; e.completeThi = true; e.maxCycles = 3; e.maxDurationS = 600; e.cooldownS = 7200; e.value = 35; e.threshold = 30; e.epochMs = 1794627000000LL;
  auto save = [&](const CycleStored &p) { saved = p; return true; };
  auto advance = [&](uint32_t ms) { e.nowMs += ms; e.epochMs += ms; };
  cycleRestore(s, true, false, saved, e);
  assert(cycleStep(s,e,save).relayOn && s.p.cyclesToday == 1);
  e.value = 0; advance(599000); assert(cycleStep(s,e,save).relayOn);
  advance(1000); assert(!cycleStep(s,e,save).relayOn && cycleRemainSec(s,e.nowMs) == 7200);
  e.value = 35; advance(7140000); assert(!cycleStep(s,e,save).relayOn);
  advance(60000); assert(cycleStep(s,e,save).relayOn && s.p.cyclesToday == 2);
  e.completeTemp = false; advance(1000); assert(!cycleStep(s,e,save).relayOn && s.p.cyclesToday == 2);
  CycleState reboot; cycleRestore(reboot,false,false,saved,e);
  assert(reboot.p.cyclesToday == 2 && reboot.p.phase == uint8_t(CyclePhase::Cooldown));
  e.completeTemp = true; advance(7200000); assert(cycleStep(s,e,save).relayOn && s.p.cyclesToday == 3);
  e.thiBasis = true; e.value = 75; advance(600000); assert(!cycleStep(s,e,save).relayOn);
  advance(7200000); assert(!cycleStep(s,e,save).relayOn && s.p.cyclesToday == 3);
  e.clockReady = false; advance(86400000); assert(!cycleStep(s,e,save).relayOn && s.p.cyclesToday == 3);
  e.clockReady = true; assert(cycleStep(s,e,save).relayOn && s.p.cyclesToday == 1);
  CycleState activeReboot; cycleRestore(activeReboot,false,false,saved,e);
  assert(activeReboot.p.phase == uint8_t(CyclePhase::Cooldown) && activeReboot.p.cyclesToday == 1);
  assert(cycleRemainSec(activeReboot,e.nowMs) == 7200);
  e.epochMs -= 3600000; assert(!cycleStep(activeReboot,e,save).relayOn && !activeReboot.clockOk);
  CycleState corrupt; cycleRestore(corrupt,false,true,saved,e); assert(corrupt.p.cyclesToday == 100);
  CycleState midnight = {}; CycleStored midnightSaved = {}; CycleEnv m = {};
  m.clockReady = true; m.completeTemp = true; m.maxCycles = 3;
  m.maxDurationS = 600; m.cooldownS = 7200; m.value = 35; m.threshold = 30;
  m.epochMs = 1794675000000LL;
  auto persistMidnight = [&](const CycleStored &p) { midnightSaved = p; return true; };
  cycleRestore(midnight, true, false, midnightSaved, m);
  assert(cycleStep(midnight, m, persistMidnight).relayOn);
  assert(strcmp(midnight.p.day, "2026-11-14") == 0 && midnight.p.cyclesToday == 1);
  m.nowMs += 600000; m.epochMs += 600000;
  assert(!cycleStep(midnight, m, persistMidnight).relayOn);
  assert(strcmp(midnight.p.day, "2026-11-15") == 0 && midnight.p.cyclesToday == 0);
  assert(cycleRemainSec(midnight, m.nowMs) == 7200);
  m.nowMs += 600000; m.epochMs += 600000;
  CycleState midnightReboot = {};
  cycleRestore(midnightReboot, false, false, midnightSaved, m);
  assert(!cycleStep(midnightReboot, m, persistMidnight).relayOn);
  assert(cycleRemainSec(midnightReboot, m.nowMs) == 6600);
  m.nowMs += 6599000; m.epochMs += 6599000;
  assert(!cycleStep(midnightReboot, m, persistMidnight).relayOn);
  m.nowMs += 1000; m.epochMs += 1000;
  assert(cycleStep(midnightReboot, m, persistMidnight).relayOn);
  assert(midnightReboot.p.cyclesToday == 1 && strcmp(midnightReboot.p.day, "2026-11-15") == 0);
  CycleState failedSave = {}; CycleStored empty = {};
  cycleRestore(failedSave, true, false, empty, m);
  auto rejectSave = [](const CycleStored &) { return false; };
  assert(!cycleStep(failedSave, m, rejectSave).relayOn && failedSave.p.cyclesToday == 0);
  puts("cycle policy: all assertions passed, including midnight/reboot and failed persistence");
}
