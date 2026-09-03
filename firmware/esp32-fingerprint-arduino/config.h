#pragma once

#include <Arduino.h>

struct DeviceConfig {
  String backendHost;        // e.g. "https://hozur.example.com" (no trailing slash)
  String deviceKey;          // raw key from POST /api/v1/devices — sent as X-Device-Key
  String sensorModel = "fpm22";

  // Two WiFi networks are kept: slot 1 is written at first-use provisioning,
  // slot 2 is written when the portal is reopened later because slot 1 was
  // unreachable. connectBestWifi() tries slot 1 first, then slot 2.
  String ssid1, pass1;
  String ssid2, pass2;

  // Last settings seen from a successful handshake, cached so the gate can
  // still run (degraded) if it reboots while the backend is also down.
  int cachedMinSeconds = 60;
  bool cachedFingerprintEnabled = true;
};

namespace config {

// Loads a previously saved config from NVS. Returns false if incomplete
// (first boot, or after config::clear()) — i.e. no backend host/key or no
// WiFi slot 1.
bool load(DeviceConfig &cfg);

void save(const DeviceConfig &cfg);

// Persists just the cached handshake settings (called on every successful
// handshake so an outage reboot has something to fall back on).
void saveCachedSettings(const DeviceConfig &cfg);

// Wipes saved WiFi credentials and backend config — next boot opens the
// provisioning portal again.
void clear();

// Tries WiFi slot 1, then slot 2, each with a bounded wait. Returns true as
// soon as one connects. Does nothing if neither slot is filled in.
bool connectBestWifi(const DeviceConfig &cfg, uint32_t perNetworkMs = 12000);

// Blocks: opens a "Attendance-FP-Setup" WiFi AP + captive portal so someone
// with a phone can enter WiFi credentials plus the backend URL and device
// key. On success the chosen network is written to slot 1 when firstTime is
// true (or slot 1 is empty), otherwise slot 2. Returns true once WiFi
// connects and cfg is filled in.
bool runProvisioningPortal(DeviceConfig &cfg, bool firstTime);

}  // namespace config
