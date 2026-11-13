
#include <Arduino.h>
#include <DHT.h>
#include <math.h>

#define DHTTYPE DHT22

const uint8_t DHT_PINS[2] = {4, 14};
constexpr uint32_t READ_MS = 3000;

DHT dhtSensors[2] = {DHT(DHT_PINS[0], DHTTYPE), DHT(DHT_PINS[1], DHTTYPE)};
uint32_t lastRead = 0;

float calcTHI(float tempC, float rh) {
  if (!isfinite(tempC) || !isfinite(rh)) return NAN;
  return (1.8f * tempC + 32.0f) - (0.55f - 0.0055f * rh) * (1.8f * tempC - 26.0f);
}

void setup() {
  Serial.begin(115200);
  Serial.println();
  Serial.println("SmartCow TEST DHT22 — ESP KIRI (DHT#3 + DHT#4)");
  for (int i = 0; i < 2; i++) {
    dhtSensors[i].begin();
    Serial.printf("DHT#%d DATA -> GPIO%u\n", i + 3, DHT_PINS[i]);
  }
  Serial.println("Buka Serial Monitor 115200. Pembacaan tiap 3 detik.");
  lastRead = millis() - READ_MS;
}

void loop() {
  if (uint32_t(millis() - lastRead) < READ_MS) {
    delay(50);
    return;
  }
  lastRead = millis();

  for (int i = 0; i < 2; i++) {
    float rh = dhtSensors[i].readHumidity();
    float tempC = dhtSensors[i].readTemperature(false);
    if (isnan(rh) || isnan(tempC)) {
      Serial.printf("DHT#%d GPIO%u: GAGAL (cek kabel VCC/GND/DATA + power 3V3)\n",
        i + 3, DHT_PINS[i]);
      continue;
    }
    float thi = calcTHI(tempC, rh);
    Serial.printf("DHT#%d GPIO%u: T=%.2fC RH=%.2f%% THI=%.2f OK\n",
      i + 3, DHT_PINS[i], tempC, rh, thi);
  }
  Serial.println("---");
}
