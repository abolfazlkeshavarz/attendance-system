#pragma once

#include <Adafruit_Fingerprint.h>
#include <Arduino.h>

#include <vector>

// Local bookkeeping only: which slot on THIS physical sensor holds which
// employee_id. Needed because the sensor's fingerFastSearch() only ever
// returns a slot number, and sync() needs to know which slot to free when
// an employee is removed. Persisted as a small JSON blob in NVS.
class SlotMap {
 public:
  bool load();
  void save();

  bool get(int employeeId, uint16_t &slot) const;
  void set(int employeeId, uint16_t slot);
  void remove(int employeeId);

  // First slot index in [0, capacity) not currently assigned to anyone.
  uint16_t findFree(uint16_t capacity) const;

 private:
  // employeeId -> slot, kept tiny (one factory gate rarely has >1000 staff).
  std::vector<std::pair<int, uint16_t>> entries_;
};

class FingerprintSensor {
 public:
  bool begin(HardwareSerial &serial, int rxPin, int txPin);
  bool verify();
  uint16_t capacity() const { return capacity_; }

  // Call every loop iteration. Returns true only when a finger was present
  // AND matched something already enrolled on this sensor.
  bool search(uint16_t &slotId, uint16_t &confidence);

  // Blocking: walks the two-scan enrollment sequence
  // (getImage -> image2Tz(1) -> getImage -> image2Tz(2) -> createModel ->
  // storeModel) and reports progress via onStep for driving a buzzer/LED/OLED.
  // Times out after ~15s per scan if no finger is placed.
  bool enrollAtSlot(uint16_t slot, void (*onStep)(const char *msg));

  bool deleteAtSlot(uint16_t slot);

  // --- Template portability (multi-gate sync) ---
  //
  // NOT SUPPORTED by the stock Adafruit_Fingerprint library: confirmed
  // against the library's public header that loadModel()/getModel() only
  // return a status byte, never the actual template bytes, and there is no
  // setModel()/downloadModel() at all. Both directions are open, unmerged
  // feature requests upstream (issues #36 and #127 on
  // github.com/adafruit/Adafruit-Fingerprint-Sensor-Library).
  // extractTemplate()/injectTemplate() below always return false as a
  // result — multi-gate sync is a no-op until either the library is patched
  // to expose the raw PS_UpChar/PS_DownChar packet stream, or you fall back
  // to enrolling each employee separately at every physical gate.
  bool extractTemplate(uint16_t slot, std::vector<uint8_t> &out);
  bool injectTemplate(uint16_t slot, const std::vector<uint8_t> &data);

 private:
  Adafruit_Fingerprint *finger_ = nullptr;
  uint16_t capacity_ = 127;  // overwritten by verify() from the sensor's own report
};
