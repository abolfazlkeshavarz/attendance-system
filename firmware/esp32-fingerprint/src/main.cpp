#include <Arduino.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <base64.h>
#include <esp_system.h>
#include <time.h>

#include "backend_client.h"
#include "config.h"
#include "fingerprint_sensor.h"
#include "offline_queue.h"

// ------------------------------------------------------------------- pins

constexpr int PIN_FP_RX = 16;  // sensor TX -> here
constexpr int PIN_FP_TX = 17;  // sensor RX <- here
constexpr int PIN_LED_OK = 25;
constexpr int PIN_LED_ERR = 26;
constexpr int PIN_BUZZER = 27;

constexpr unsigned long HEARTBEAT_INTERVAL_MS = 60UL * 1000;
constexpr unsigned long RESYNC_INTERVAL_MS = 10UL * 60 * 1000;
constexpr unsigned long ENROLL_POLL_INTERVAL_MS = 3UL * 1000;
constexpr unsigned long QUEUE_FLUSH_INTERVAL_MS = 15UL * 1000;
// Re-checked periodically (not just at boot) so an admin flipping the
// "fingerprint" toggle off in the panel takes effect here within ~2 minutes
// without needing to power-cycle the gate.
constexpr unsigned long SETTINGS_REFRESH_INTERVAL_MS = 2UL * 60 * 1000;
constexpr unsigned long DISABLED_BLINK_INTERVAL_MS = 3UL * 1000;

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
unsigned long g_lastDisabledBlink = 0;

int g_minSecondsBetweenPunches = 60;
bool g_fingerprintEnabled = true;
uint16_t g_lastSlot = 0xFFFF;
unsigned long g_lastSlotMs = 0;

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

void feedback(bool ok) {
  digitalWrite(ok ? PIN_LED_OK : PIN_LED_ERR, HIGH);
  tone(PIN_BUZZER, ok ? 2000 : 400, 150);
  delay(200);
  digitalWrite(ok ? PIN_LED_OK : PIN_LED_ERR, LOW);
}

void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin();  // reconnects with credentials WiFiManager already saved
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(200);
  }
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[wifi] could not reconnect with saved credentials, opening portal");
    config::runProvisioningPortal(g_cfg);
  }
}

// Pulls min_seconds_between_punches / fingerprint_enabled out of a handshake
// response. Shared by the initial boot handshake and the periodic refresh so
// the two never drift apart.
void applyHandshakeSettings(const JsonDocument &doc) {
  g_minSecondsBetweenPunches = doc["settings"]["min_seconds_between_punches"] | 60;
  bool enabled = doc["settings"]["fingerprint_enabled"] | true;
  if (enabled != g_fingerprintEnabled) {
    Serial.printf("[settings] fingerprint punching now %s\n", enabled ? "ENABLED" : "DISABLED");
  }
  g_fingerprintEnabled = enabled;
}

// While disabled, a short double-blink of the error LED every few seconds
// tells anyone standing at the gate this isn't a hardware fault — the admin
// turned this method off — rather than a silently broken reader.
void blinkDisabledIndicator() {
  for (int i = 0; i < 2; i++) {
    digitalWrite(PIN_LED_ERR, HIGH);
    delay(80);
    digitalWrite(PIN_LED_ERR, LOW);
    delay(120);
  }
}

// --------------------------------------------------------------- enrollment

void printStep(const char *msg) { Serial.printf("[enroll] %s\n", msg); }

void checkPendingEnroll() {
  JsonDocument doc;
  if (!g_backend->getPendingEnroll(doc)) return;
  if (doc["job"].isNull()) return;

  int jobId = doc["job"]["id"];
  int employeeId = doc["job"]["employee_id"];
  const char *employeeName = doc["job"]["employee_name"] | "";
  Serial.printf("[enroll] job %d for employee %d (%s)\n", jobId, employeeId, employeeName);

  uint16_t slot = g_slotMap.findFree(g_sensor.capacity());
  if (slot == 0xFFFF) {
    g_backend->enrollFail(jobId, "sensor is full");
    feedback(false);
    return;
  }

  if (!g_sensor.enrollAtSlot(slot, printStep)) {
    g_backend->enrollFail(jobId, "capture failed or timed out");
    feedback(false);
    return;
  }

  std::vector<uint8_t> templateBytes;
  if (!g_sensor.extractTemplate(slot, templateBytes)) {
    g_sensor.deleteAtSlot(slot);
    g_backend->enrollFail(jobId, "could not read template back from sensor");
    feedback(false);
    return;
  }

  String b64 = base64::encode(templateBytes.data(), templateBytes.size());
  JsonDocument resp;
  if (!g_backend->enrollComplete(jobId, slot, b64, g_cfg.sensorModel, resp)) {
    g_sensor.deleteAtSlot(slot);
    feedback(false);
    return;
  }

  g_slotMap.set(employeeId, slot);
  g_slotMap.save();
  feedback(true);
}

// ---------------------------------------------------------------------- sync

void doSync() {
  JsonDocument resp;
  if (!g_backend->sync(g_cfg.sensorModel, resp)) return;

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
    // NOTE: decoding base64 into raw bytes needs a real decode step here —
    // base64::decode() in the ESP32 core returns a String; convert via
    // (const uint8_t*)decoded.c_str() / decoded.length() before calling
    // injectTemplate. Left as-is pending the extractTemplate/injectTemplate
    // TODO in fingerprint_sensor.cpp, since both ends of the wire format
    // depend on the same unresolved library detail.
    String decoded = base64::decode(b64);
    std::vector<uint8_t> bytes(decoded.begin(), decoded.end());
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
      feedback(true);
      return;
    }
  }
  entry["created_offline"] = true;
  g_queue.push(entry);
  feedback(true);  // scan itself succeeded locally; sync will catch up later
}

// --------------------------------------------------------------------- setup

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED_OK, OUTPUT);
  pinMode(PIN_LED_ERR, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);

  g_queue.begin();
  g_slotMap.load();

  if (!config::load(g_cfg)) {
    if (!config::runProvisioningPortal(g_cfg)) {
      Serial.println("[setup] provisioning failed, restarting");
      delay(3000);
      ESP.restart();
    }
  }
  ensureWifi();
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");  // UTC; happened_at is sent as UTC (Z)

  g_backend = new BackendClient(g_cfg.backendHost, g_cfg.deviceKey);

  if (!g_sensor.begin(Serial2, PIN_FP_RX, PIN_FP_TX) || !g_sensor.verify()) {
    Serial.println("[setup] fingerprint sensor not responding — check wiring/baud rate");
  }
}

void loop() {
  ensureWifi();
  unsigned long now = millis();

  switch (g_state) {
    case AppState::HANDSHAKE: {
      JsonDocument doc;
      if (g_backend->handshake(doc)) {
        applyHandshakeSettings(doc);
        g_lastSettingsRefresh = now;
        g_state = AppState::SYNC;
      } else {
        delay(3000);
      }
      break;
    }
    case AppState::SYNC:
      doSync();
      g_lastResync = now;
      g_state = AppState::RUN;
      break;
    case AppState::RUN: {
      if (now - g_lastHeartbeat > HEARTBEAT_INTERVAL_MS) {
        g_backend->heartbeat(g_queue.size(), "esp32-fp-0.1.0");
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
        if (now - g_lastDisabledBlink > DISABLED_BLINK_INTERVAL_MS) {
          blinkDisabledIndicator();
          g_lastDisabledBlink = now;
        }
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
