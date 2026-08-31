#pragma once

#include <Arduino.h>

struct DeviceConfig {
  String backendHost;        // e.g. "https://hozur.example.com" (no trailing slash)
  String deviceKey;          // raw key from POST /api/v1/devices — sent as X-Device-Key
  String sensorModel = "fpm22";
};

namespace config {

// Loads a previously saved config from NVS. Returns false if incomplete
// (first boot, or after config::clear()).
bool load(DeviceConfig &cfg);

void save(const DeviceConfig &cfg);

// Wipes saved WiFi credentials and backend config — next boot opens the
// provisioning portal again.
void clear();

// Blocks: opens a "Attendance-FP-Setup" WiFi AP + captive portal so someone
// with a phone can enter the real WiFi credentials plus the backend URL and
// device key. Returns true once WiFi connects and cfg is filled in.
bool runProvisioningPortal(DeviceConfig &cfg);

}  // namespace config
