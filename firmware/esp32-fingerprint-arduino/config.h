#pragma once

#include <Arduino.h>

// How many WiFi networks the gate remembers, kept in most-recently-connected
// order (slot 0 = last network that worked).
constexpr int kWifiSlots = 3;

struct DeviceConfig {
  String backendHost;        // e.g. "https://hozur.example.com" (no trailing slash)
  String deviceKey;          // raw key from POST /api/v1/devices — sent as X-Device-Key
  String sensorModel = "fpm22";

  // The last 3 WiFi networks the gate has connected to, MRU first.
  // connectBestWifi() tries ssid[0], then ssid[1], then ssid[2] (15 s each)
  // and, on success, promotes the one that worked back to slot 0. Adding a
  // new network via the portal pushes it in at slot 0 and drops the oldest.
  String ssid[kWifiSlots];
  String pass[kWifiSlots];

  // Last settings seen from a successful handshake, cached so the gate can
  // still run (degraded) if it reboots while the backend is also down.
  int cachedMinSeconds = 60;
  bool cachedFingerprintEnabled = true;
};

namespace config {

// Loads a previously saved config from NVS. Returns false if incomplete
// (first boot, or after config::clear()) — i.e. no backend host/key or no
// WiFi in slot 0.
bool load(DeviceConfig &cfg);

void save(const DeviceConfig &cfg);

// Persists just the cached handshake settings (called on every successful
// handshake so an outage reboot has something to fall back on).
void saveCachedSettings(const DeviceConfig &cfg);

// Wipes saved WiFi credentials and backend config — next boot opens the
// provisioning portal again.
void clear();

// Tries each filled WiFi slot in order (0, 1, 2), waiting perNetworkMs on
// each. Returns true as soon as one connects; on success it promotes that
// slot to slot 0 (MRU) and persists the new order. Does nothing if no slot
// is filled in.
bool connectBestWifi(DeviceConfig &cfg, uint32_t perNetworkMs = 15000);

// Blocks: opens a "Attendance-FP-Setup" WiFi AP + captive portal so someone
// with a phone can enter WiFi credentials plus the backend URL and device
// key. The chosen network is pushed in at slot 0 (dropping the oldest of the
// three, or just refreshing its password if it's already remembered).
// Returns true once WiFi connects and cfg is filled in.
bool runProvisioningPortal(DeviceConfig &cfg);

}  // namespace config
