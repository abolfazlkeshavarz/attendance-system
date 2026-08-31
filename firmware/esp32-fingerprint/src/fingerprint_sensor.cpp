#include "fingerprint_sensor.h"

#include <ArduinoJson.h>
#include <Preferences.h>

// ------------------------------------------------------------------ SlotMap

namespace {
const char *kSlotMapNamespace = "fpslots";
}

bool SlotMap::load() {
  Preferences prefs;
  prefs.begin(kSlotMapNamespace, /*readOnly=*/true);
  String blob = prefs.getString("map", "[]");
  prefs.end();

  JsonDocument doc;
  if (deserializeJson(doc, blob) != DeserializationError::Ok) return false;
  entries_.clear();
  for (JsonObjectConst e : doc.as<JsonArrayConst>()) {
    entries_.push_back({e["emp"].as<int>(), e["slot"].as<uint16_t>()});
  }
  return true;
}

void SlotMap::save() {
  JsonDocument doc;
  JsonArray arr = doc.to<JsonArray>();
  for (const auto &e : entries_) {
    JsonObject o = arr.add<JsonObject>();
    o["emp"] = e.first;
    o["slot"] = e.second;
  }
  String blob;
  serializeJson(doc, blob);

  Preferences prefs;
  prefs.begin(kSlotMapNamespace, /*readOnly=*/false);
  prefs.putString("map", blob);
  prefs.end();
}

bool SlotMap::get(int employeeId, uint16_t &slot) const {
  for (const auto &e : entries_) {
    if (e.first == employeeId) {
      slot = e.second;
      return true;
    }
  }
  return false;
}

void SlotMap::set(int employeeId, uint16_t slot) {
  for (auto &e : entries_) {
    if (e.first == employeeId) {
      e.second = slot;
      return;
    }
  }
  entries_.push_back({employeeId, slot});
}

void SlotMap::remove(int employeeId) {
  for (auto it = entries_.begin(); it != entries_.end(); ++it) {
    if (it->first == employeeId) {
      entries_.erase(it);
      return;
    }
  }
}

uint16_t SlotMap::findFree(uint16_t capacity) const {
  for (uint16_t slot = 0; slot < capacity; slot++) {
    bool used = false;
    for (const auto &e : entries_) {
      if (e.second == slot) {
        used = true;
        break;
      }
    }
    if (!used) return slot;
  }
  return 0xFFFF;  // sensor full — caller must handle this (refuse enroll/sync)
}

// ------------------------------------------------------------ FingerprintSensor

bool FingerprintSensor::begin(HardwareSerial &serial, int rxPin, int txPin) {
  serial.begin(57600, SERIAL_8N1, rxPin, txPin);
  finger_ = new Adafruit_Fingerprint(&serial);
  return finger_->begin(57600);
}

bool FingerprintSensor::verify() {
  if (!finger_->verifyPassword()) return false;
  if (finger_->getParameters() == FINGERPRINT_OK) {
    capacity_ = finger_->capacity;
  }
  return true;
}

bool FingerprintSensor::search(uint16_t &slotId, uint16_t &confidence) {
  if (finger_->getImage() != FINGERPRINT_OK) return false;
  if (finger_->image2Tz(1) != FINGERPRINT_OK) return false;
  if (finger_->fingerFastSearch() != FINGERPRINT_OK) return false;
  slotId = finger_->fingerID;
  confidence = finger_->confidence;
  return true;
}

bool FingerprintSensor::enrollAtSlot(uint16_t slot, void (*onStep)(const char *msg)) {
  auto waitForFinger = [&]() -> bool {
    unsigned long start = millis();
    int result;
    do {
      result = finger_->getImage();
      if (millis() - start > 15000) return false;
      delay(50);
    } while (result == FINGERPRINT_NOFINGER);
    return result == FINGERPRINT_OK;
  };

  if (onStep) onStep("place-finger-1");
  if (!waitForFinger()) return false;
  if (finger_->image2Tz(1) != FINGERPRINT_OK) return false;

  if (onStep) onStep("remove-finger");
  unsigned long start = millis();
  while (finger_->getImage() != FINGERPRINT_NOFINGER) {
    if (millis() - start > 5000) break;
    delay(50);
  }

  if (onStep) onStep("place-finger-2");
  if (!waitForFinger()) return false;
  if (finger_->image2Tz(2) != FINGERPRINT_OK) return false;

  if (finger_->createModel() != FINGERPRINT_OK) return false;  // the two scans didn't match each other
  if (finger_->storeModel(slot) != FINGERPRINT_OK) return false;

  if (onStep) onStep("done");
  return true;
}

bool FingerprintSensor::deleteAtSlot(uint16_t slot) {
  return finger_->deleteModel(slot) == FINGERPRINT_OK;
}

bool FingerprintSensor::extractTemplate(uint16_t slot, std::vector<uint8_t> &out) {
  if (finger_->loadModel(slot) != FINGERPRINT_OK) return false;
  if (finger_->getModel() != FINGERPRINT_OK) return false;  // requests PS_UpChar

  out.clear();
  // getModel() streams the template over the same UART link as raw data
  // packets; the mainline library exposes this via finger_->getFingerprintTemplate()
  // in some versions or by reading finger_->readRaw()/packet buffers in others.
  // TODO(verify against your installed library version): plug in whichever
  // accessor your Adafruit_Fingerprint build actually provides here to fill
  // `out` with the raw template bytes it just received.
  return !out.empty();
}

bool FingerprintSensor::injectTemplate(uint16_t slot, const std::vector<uint8_t> &data) {
  if (data.empty()) return false;
  if (finger_->setModel(slot) != FINGERPRINT_OK) return false;  // announces PS_DownChar

  // TODO(verify against your installed library version): send `data` down to
  // the sensor over the same link (the counterpart of the getModel() TODO
  // above), then confirm with finger_->storeModel(slot).
  return finger_->storeModel(slot) == FINGERPRINT_OK;
}
