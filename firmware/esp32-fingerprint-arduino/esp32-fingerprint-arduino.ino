#include <Arduino.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <base64.h>
#include <esp_system.h>
#include <esp_task_wdt.h>
#include <mbedtls/base64.h>
#include <Preferences.h>
#include <time.h>

#include "backend_client.h"
#include "config.h"
#include "fingerprint_sensor.h"
#include "leds.h"
#include "offline_queue.h"
#include "oled_status.h"

// ------------------------------------------------------------------- pins

constexpr int PIN_FP_RX = 16;      // sensor TX -> here
constexpr int PIN_FP_TX = 17;      // sensor RX <- here
constexpr int PIN_RESET_BTN = 33;  // momentary button to GND; hold 5s to wipe config
// LED pins (25 green / 27 blue / 26 red) are owned by leds.cpp.

constexpr unsigned long HEARTBEAT_INTERVAL_MS = 60UL * 1000;
constexpr unsigned long RESYNC_INTERVAL_MS = 10UL * 60 * 1000;
constexpr unsigned long ENROLL_POLL_INTERVAL_MS = 3UL * 1000;
constexpr unsigned long QUEUE_FLUSH_INTERVAL_MS = 15UL * 1000;
// Re-checked periodically (not just at boot) so an admin flipping the
// "fingerprint" toggle off in the panel takes effect here within ~2 minutes
// without needing to power-cycle the gate.
constexpr unsigned long SETTINGS_REFRESH_INTERVAL_MS = 2UL * 60 * 1000;

constexpr unsigned long HANDSHAKE_RETRY_MS = 3UL * 1000;
// If the backend is still down this long after boot (e.g. a shared power cut
// where the server is also rebooting), enter RUN in degraded mode using the
// last settings we cached, so fingerprints are still captured to the queue.
constexpr unsigned long HANDSHAKE_DEGRADE_AFTER_MS = 30UL * 1000;
constexpr unsigned long NTP_RETRY_MS = 30UL * 1000;
constexpr unsigned long RESET_HOLD_MS = 5UL * 1000;
// Uptime in RUN after which we consider this boot "healthy" and clear the
// crash breadcrumb counter.
constexpr unsigned long HEALTHY_UPTIME_MS = 60UL * 1000;
// Longer than any single loop iteration's worth of blocking HTTP calls;
// paused explicitly around the captive portal and enrollment capture.
constexpr int WDT_TIMEOUT_S = 90;

enum class AppState { HANDSHAKE, SYNC, RUN };

DeviceConfig g_cfg;
BackendClient *g_backend = nullptr;
FingerprintSensor g_sensor;
SlotMap g_slotMap;
OfflineQueue g_queue;

AppState g_state = AppState::HANDSHAKE;
unsigned long g_lastHeartbeat = 0;
unsigned long g_lastResync = 0;
unsigned long g_lastEnrollPoll = 0;
unsigned long g_lastQueueFlush = 0;
unsigned long g_lastSettingsRefresh = 0;
unsigned long g_lastHandshakeTry = 0;
unsigned long g_handshakeStart = 0;
unsigned long g_lastNtpTry = 0;
unsigned long g_runEnteredAt = 0;
bool g_bootCounterCleared = false;

int g_minSecondsBetweenPunches = 60;
bool g_fingerprintEnabled = true;
uint16_t g_lastSlot = 0xFFFF;
unsigned long g_lastSlotMs = 0;
unsigned long g_resetPressStart = 0;

// ------------------------------------------------------------- watchdog

void wdtBegin() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  esp_task_wdt_config_t cfg = {};
  cfg.timeout_ms = (uint32_t)WDT_TIMEOUT_S * 1000;
  cfg.idle_core_mask = 0;
  cfg.trigger_panic = true;
  esp_task_wdt_deinit();  // the Arduino core may have started it with a short timeout
  esp_task_wdt_init(&cfg);
#else
  esp_task_wdt_init(WDT_TIMEOUT_S, true);
#endif
  esp_task_wdt_add(NULL);
}

void wdtPause() { esp_task_wdt_delete(NULL); }
void wdtResume() { esp_task_wdt_add(NULL); }
void wdtFeed() { esp_task_wdt_reset(); }

// ------------------------------------------------------------------- utils

String nowIso() {
  time_t t = time(nullptr);
  if (t < 8 * 3600 * 2) return "";  // clock not synced yet (still near epoch)
  struct tm tmv;
  gmtime_r(&t, &tmv);
  char buf[25];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tmv);
  return String(buf);
}

String makeClientUuid() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char buf[40];
  snprintf(buf, sizeof(buf), "%02x%02x%02x%02x%02x%02x-%lu-%lu", mac[0], mac[1], mac[2], mac[3],
           mac[4], mac[5], millis(), (unsigned long)esp_random());
  return String(buf);
}

// ESP32 Arduino core's <base64.h> (the `base64::` class used for encoding
// elsewhere in this file) only implements encode() — no decode(). Decoding
// goes through mbedTLS instead, which is already linked in for TLS anyway.
std::vector<uint8_t> decodeBase64(const String &b64) {
  std::vector<uint8_t> out;
  const unsigned char *src = (const unsigned char *)b64.c_str();
  size_t srcLen = b64.length();

  size_t neededLen = 0;
  // First call with a null buffer just reports how many bytes we need.
  mbedtls_base64_decode(nullptr, 0, &neededLen, src, srcLen);
  if (neededLen == 0) return out;

  out.resize(neededLen);
  size_t actualLen = 0;
  int ret = mbedtls_base64_decode(out.data(), out.size(), &actualLen, src, srcLen);
  if (ret != 0) {
    out.clear();
    return out;
  }
  out.resize(actualLen);
  return out;
}

// Wipe config and restart when the reset button is held for RESET_HOLD_MS.
// Called from loop() and from inside the WiFi wait so it works even when the
// gate is stuck offline.
void checkResetButton() {
  if (digitalRead(PIN_RESET_BTN) == LOW) {
    if (g_resetPressStart == 0) g_resetPressStart = millis();
    if (millis() - g_resetPressStart >= RESET_HOLD_MS) {
      Serial.println("[reset] button held — wiping config and restarting");
      oled::log("resetting config...");
      led::allOn();
      config::clear();
      delay(600);
      ESP.restart();
    }
  } else {
    g_resetPressStart = 0;
  }
}

void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return;

  led::setReady(false);
  wdtFeed();
  if (config::connectBestWifi(g_cfg)) {
    oled::log("wifi connected");
    wdtFeed();
    return;
  }

  // Both stored networks are unreachable — open the portal so someone can
  // register another one (lands in slot 2, keeping the original slot 1).
  Serial.println("[wifi] both saved networks unreachable, opening portal");
  oled::log("both wifi down, portal");
  wdtPause();
  config::runProvisioningPortal(g_cfg, /*firstTime=*/false);
  wdtResume();
}

// Re-issues the NTP request until the clock is actually set. happened_at
// degrades to "" without this and the backend stamps server time, so this is
// best-effort — but a synced clock keeps offline-queued punches accurate.
void ensureTime() {
  if (time(nullptr) > 8 * 3600 * 2) return;
  if (millis() - g_lastNtpTry < NTP_RETRY_MS && g_lastNtpTry != 0) return;
  g_lastNtpTry = millis();
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
}

// Pulls min_seconds_between_punches / fingerprint_enabled out of a handshake
// response and caches them to NVS so a reboot during a backend outage can
// still run.
void applyHandshakeSettings(const JsonDocument &doc) {
  g_minSecondsBetweenPunches = doc["settings"]["min_seconds_between_punches"] | 60;
  bool enabled = doc["settings"]["fingerprint_enabled"] | true;
  if (enabled != g_fingerprintEnabled) {
    Serial.printf("[settings] fingerprint punching now %s\n", enabled ? "ENABLED" : "DISABLED");
    oled::log(enabled ? "fingerprint ENABLED" : "fingerprint DISABLED");
  }
  g_fingerprintEnabled = enabled;

  if (g_cfg.cachedMinSeconds != g_minSecondsBetweenPunches ||
      g_cfg.cachedFingerprintEnabled != enabled) {
    g_cfg.cachedMinSeconds = g_minSecondsBetweenPunches;
    g_cfg.cachedFingerprintEnabled = enabled;
    config::saveCachedSettings(g_cfg);
  }
}

// --------------------------------------------------------------- enrollment

void printStep(const char *msg) {
  Serial.printf("[enroll] %s\n", msg);
  oled::log(String("enroll: ") + msg);
}

void checkPendingEnroll() {
  JsonDocument doc;
  if (!g_backend->getPendingEnroll(doc)) return;
  if (doc["job"].isNull()) return;

  int jobId = doc["job"]["id"];
  int employeeId = doc["job"]["employee_id"];
  const char *employeeName = doc["job"]["employee_name"] | "";
  Serial.printf("[enroll] job %d for employee %d (%s)\n", jobId, employeeId, employeeName);
  oled::log(String("enroll job for ") + employeeName);
  g_backend->reportScan("enroll_scanning");

  uint16_t slot = g_slotMap.findFree(g_sensor.capacity());
  if (slot == 0xFFFF) {
    g_backend->enrollFail(jobId, "sensor is full");
    oled::log("enroll failed: sensor full");
    led::scanError();
    return;
  }

  led::scanStart();
  wdtPause();  // enrollAtSlot blocks for up to ~30s waiting for two finger presses
  bool captured = g_sensor.enrollAtSlot(slot, printStep);
  wdtResume();
  if (!captured) {
    g_backend->enrollFail(jobId, "capture failed or timed out");
    oled::log("enroll failed: capture");
    led::scanError();
    return;
  }

  // Single-gate mode: the stock Adafruit_Fingerprint library can't read the
  // template back off the sensor (see fingerprint_sensor.h), so we can't
  // send bytes for the backend to redistribute to other gates. The
  // fingerprint IS safely stored on this sensor at `slot` right now — we
  // just report completion without a template payload rather than deleting
  // a perfectly good enrollment. If you add a second physical gate later,
  // that employee will need to be enrolled at it separately too, until the
  // library gets patched to expose raw template bytes.
  String b64 = "";
  JsonDocument resp;
  if (!g_backend->enrollComplete(jobId, slot, b64, g_cfg.sensorModel, resp)) {
    g_sensor.deleteAtSlot(slot);
    oled::log("enroll failed: upload");
    led::scanError();
    return;
  }

  g_slotMap.set(employeeId, slot);
  g_slotMap.save();
  oled::log(String("enrolled ") + employeeName);
  led::scanSuccess();
}

// ---------------------------------------------------------------------- sync

void doSync() {
  JsonDocument resp;
  if (!g_backend->sync(g_cfg.sensorModel, resp)) {
    oled::log("sync request failed");
    return;
  }

  JsonDocument confirmAdded;
  JsonArray addedArr = confirmAdded.to<JsonArray>();
  JsonDocument confirmRemoved;
  JsonArray removedArr = confirmRemoved.to<JsonArray>();

  for (JsonObjectConst item : resp["to_add"].as<JsonArrayConst>()) {
    int employeeId = item["employee_id"];
    uint16_t slot = g_slotMap.findFree(g_sensor.capacity());
    if (slot == 0xFFFF) {
      Serial.println("[sync] sensor full, cannot add more employees");
      break;
    }
    String b64 = item["template_base64"].as<String>();
    std::vector<uint8_t> bytes = decodeBase64(b64);
    if (!g_sensor.injectTemplate(slot, bytes)) {
      Serial.printf("[sync] failed to inject template for employee %d\n", employeeId);
      continue;
    }
    g_slotMap.set(employeeId, slot);
    JsonObject o = addedArr.add<JsonObject>();
    o["employee_id"] = employeeId;
    o["slot_id"] = slot;
  }

  for (int employeeId : resp["to_remove"].as<JsonArrayConst>()) {
    uint16_t slot;
    if (g_slotMap.get(employeeId, slot)) {
      g_sensor.deleteAtSlot(slot);
      g_slotMap.remove(employeeId);
    }
    removedArr.add(employeeId);
  }

  g_slotMap.save();
  g_backend->syncConfirm(confirmAdded.as<JsonVariantConst>(), confirmRemoved.as<JsonVariantConst>());
  if (addedArr.size() > 0 || removedArr.size() > 0) {
    char buf[32];
    snprintf(buf, sizeof(buf), "sync +%u -%u", (unsigned)addedArr.size(), (unsigned)removedArr.size());
    oled::log(buf);
  }
}

// --------------------------------------------------------------------- punch

void flushQueue() {
  while (g_queue.size() > 0 && WiFi.status() == WL_CONNECTED) {
    JsonDocument item;
    if (!g_queue.front(item)) break;
    JsonDocument resp;
    bool ok = g_backend->punch(
        item["slot_id"], item["kind"].isNull() ? nullptr : item["kind"].as<const char *>(),
        item["confidence"] | -1.0f, item["happened_at"] | "", item["client_uuid"] | "",
        /*createdOffline=*/true, resp);
    if (!ok) break;  // still offline (or a transient error) — try again later
    g_queue.popFront();
  }
}

void handleMatch(uint16_t slot, uint16_t confidence) {
  unsigned long now = millis();
  if (slot == g_lastSlot && (now - g_lastSlotMs) < (unsigned long)g_minSecondsBetweenPunches * 1000) {
    return;  // same finger scanned again inside the cooldown window — ignore
  }
  g_lastSlot = slot;
  g_lastSlotMs = now;

  led::scanStart();
  g_backend->reportScan("scanning");

  JsonDocument entry;
  entry["slot_id"] = slot;
  entry["confidence"] = (float)confidence;
  entry["happened_at"] = nowIso();
  entry["client_uuid"] = makeClientUuid();

  if (WiFi.status() == WL_CONNECTED) {
    JsonDocument resp;
    bool ok = g_backend->punch(slot, nullptr, (float)confidence, entry["happened_at"].as<String>(),
                                entry["client_uuid"].as<String>(), false, resp);
    if (ok) {
      char buf[32];
      snprintf(buf, sizeof(buf), "punch slot %u ok", slot);
      oled::log(buf);
      led::scanSuccess();
      return;
    }
  }
  entry["created_offline"] = true;
  g_queue.push(entry);
  char buf[32];
  snprintf(buf, sizeof(buf), "punch slot %u queued", slot);
  oled::log(buf);
  led::scanSuccess();  // scan itself succeeded locally; sync will catch up later
}

// --------------------------------------------------------------------- setup

// Small crash breadcrumb: count reboots that happen before the gate has been
// healthy for a minute. If it climbs, slow the boot down so a crash loop
// can't hammer the AP / backend.
int bumpBootCounter() {
  Preferences p;
  p.begin("fpboot", false);
  int n = p.getInt("n", 0) + 1;
  p.putInt("n", n);
  p.end();
  return n;
}

void clearBootCounter() {
  Preferences p;
  p.begin("fpboot", false);
  p.putInt("n", 0);
  p.end();
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_RESET_BTN, INPUT_PULLUP);

  led::begin();
  oled::begin();  // no-op if no screen wired up; safe either way
  oled::log("booting");
  wdtBegin();

  int boots = bumpBootCounter();
  if (boots > 8) {
    Serial.printf("[boot] %d rapid reboots — backing off 5s\n", boots);
    oled::log("repeated reboots");
    delay(5000);
  }

  g_queue.begin();
  g_slotMap.load();

  if (!config::load(g_cfg)) {
    oled::log("no config, opening portal");
    wdtPause();
    bool ok = config::runProvisioningPortal(g_cfg, /*firstTime=*/true);
    wdtResume();
    if (!ok) {
      Serial.println("[setup] provisioning failed, restarting");
      oled::log("provisioning failed");
      delay(3000);
      ESP.restart();
    }
  } else {
    // Seed the live settings from the cached copy so a degraded start has
    // sensible values before the first handshake lands.
    g_minSecondsBetweenPunches = g_cfg.cachedMinSeconds;
    g_fingerprintEnabled = g_cfg.cachedFingerprintEnabled;
  }

  ensureWifi();
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");  // UTC; happened_at is sent as UTC (Z)

  g_backend = new BackendClient(g_cfg.backendHost, g_cfg.deviceKey);

  if (!g_sensor.begin(Serial2, PIN_FP_RX, PIN_FP_TX) || !g_sensor.verify()) {
    Serial.println("[setup] fingerprint sensor not responding — check wiring/baud rate");
    oled::log("sensor not responding");
  } else {
    oled::log("sensor ready");
  }

  g_handshakeStart = millis();
}

void enterRun(unsigned long now, bool degraded) {
  g_state = AppState::RUN;
  g_runEnteredAt = now;
  g_lastResync = now;
  if (degraded) {
    Serial.println("[state] entering RUN in degraded mode (no handshake yet)");
    oled::log("degraded run (no server)");
  }
}

void loop() {
  wdtFeed();
  led::tick();
  checkResetButton();
  ensureWifi();
  unsigned long now = millis();

  bool ready = g_state == AppState::RUN && g_fingerprintEnabled && WiFi.status() == WL_CONNECTED;
  led::setReady(ready);

  switch (g_state) {
    case AppState::HANDSHAKE: {
      if (now - g_lastHandshakeTry >= HANDSHAKE_RETRY_MS || g_lastHandshakeTry == 0) {
        g_lastHandshakeTry = now;
        JsonDocument doc;
        if (g_backend->handshake(doc)) {
          applyHandshakeSettings(doc);
          g_lastSettingsRefresh = now;
          oled::log("handshake ok");
          g_state = AppState::SYNC;
          break;
        }
        oled::log("handshake failed, retry");
      }
      // Backend still unreachable long after boot — most likely a shared
      // outage where the server is also coming back up. Run anyway so
      // fingerprints are queued; the periodic settings refresh will pick up
      // the real values once the backend answers.
      if (WiFi.status() == WL_CONNECTED && now - g_handshakeStart > HANDSHAKE_DEGRADE_AFTER_MS) {
        enterRun(now, /*degraded=*/true);
      }
      break;
    }
    case AppState::SYNC:
      doSync();
      enterRun(now, /*degraded=*/false);
      break;
    case AppState::RUN: {
      ensureTime();

      if (!g_bootCounterCleared && now - g_runEnteredAt > HEALTHY_UPTIME_MS) {
        clearBootCounter();
        g_bootCounterCleared = true;
      }

      if (now - g_lastHeartbeat > HEARTBEAT_INTERVAL_MS) {
        g_backend->heartbeat(g_queue.size(), "esp32-fp-0.2.0");
        g_lastHeartbeat = now;
      }
      if (now - g_lastSettingsRefresh > SETTINGS_REFRESH_INTERVAL_MS) {
        JsonDocument doc;
        if (g_backend->handshake(doc)) applyHandshakeSettings(doc);
        g_lastSettingsRefresh = now;
      }
      if (now - g_lastResync > RESYNC_INTERVAL_MS) {
        doSync();
        g_lastResync = now;
      }
      if (now - g_lastEnrollPoll > ENROLL_POLL_INTERVAL_MS) {
        checkPendingEnroll();
        g_lastEnrollPoll = now;
      }

      if (!g_fingerprintEnabled) {
        // Punching is off, but enrollment/sync above still run — an admin
        // may want fingerprints registered ahead of turning this back on.
        // The red LED double-blink (led::setReady(false)) is the "disabled,
        // not broken" cue at the gate.
        break;
      }

      if (now - g_lastQueueFlush > QUEUE_FLUSH_INTERVAL_MS) {
        flushQueue();
        g_lastQueueFlush = now;
      }
      uint16_t slot, confidence;
      if (g_sensor.search(slot, confidence)) {
        handleMatch(slot, confidence);
      }
      break;
    }
  }
}
