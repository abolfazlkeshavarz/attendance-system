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
  finger_->begin(57600);  // this library's begin() returns void, not a status
  return true;            // verify() below does the real link check
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
  out.clear();
  // NOT IMPLEMENTABLE with the stock Adafruit_Fingerprint library (checked
  // against the current public header): loadModel()/getModel() only issue
  // the PS_LoadChar/PS_UpChar commands and return a status byte — the raw
  // template bytes the sensor streams back are consumed internally
  // (recvPacket) and never exposed to caller code. There is no public
  // method that hands you the template buffer.
  // Confirmed open/unmerged upstream: github.com/adafruit/
  // Adafruit-Fingerprint-Sensor-Library issues #36 and #127.
  // Until the library is patched to expose the raw packet stream, this
  // always fails — which is fine for single-gate use (nothing calls this
  // except cross-gate sync) but means multi-gate template sync cannot work
  // on this library as shipped.
  return false;
}

bool FingerprintSensor::injectTemplate(uint16_t slot, const std::vector<uint8_t> &data) {
  // Same limitation as extractTemplate(), mirrored: the stock library has
  // no setModel()/downloadModel() at all (verify with `grep -n "Fingerprint("
  // <path-to-library>/Adafruit_Fingerprint.h` if you want to see the exact
  // public method list yourself). There is no PS_DownChar counterpart to
  // call here, so this can never succeed until the library is patched.
  (void)slot;
  (void)data;
  return false;
}
