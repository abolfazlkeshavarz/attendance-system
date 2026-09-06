#include "config.h"

#include <vector>

#include <Preferences.h>
#include <WiFi.h>
#include <WiFiManager.h>

namespace {
const char *kNamespace = "fpcfg";

bool waitForConnect(uint32_t timeoutMs) {
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < timeoutMs) {
    delay(200);
  }
  return WiFi.status() == WL_CONNECTED;
}

bool tryNetwork(const String &ssid, const String &pass, uint32_t timeoutMs) {
  if (ssid.length() == 0) return false;
  Serial.printf("[wifi] trying \"%s\"\n", ssid.c_str());
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), pass.c_str());
  return waitForConnect(timeoutMs);
}

// Move slot `idx` to the front, shifting everything above it down one.
void promote(DeviceConfig &cfg, int idx) {
  if (idx <= 0 || idx >= kWifiSlots) return;
  String s = cfg.ssid[idx], p = cfg.pass[idx];
  for (int i = idx; i > 0; i--) {
    cfg.ssid[i] = cfg.ssid[i - 1];
    cfg.pass[i] = cfg.pass[i - 1];
  }
  cfg.ssid[0] = s;
  cfg.pass[0] = p;
}

// Record a network as the most-recently-used one. If it's already remembered
// its password is refreshed and it's promoted; otherwise it's inserted at
// slot 0 and the oldest entry falls off the end.
void rememberWifi(DeviceConfig &cfg, const String &ssid, const String &pass) {
  if (ssid.length() == 0) return;
  for (int i = 0; i < kWifiSlots; i++) {
    if (cfg.ssid[i] == ssid) {
      cfg.pass[i] = pass;
      promote(cfg, i);
      return;
    }
  }
  for (int i = kWifiSlots - 1; i > 0; i--) {
    cfg.ssid[i] = cfg.ssid[i - 1];
    cfg.pass[i] = cfg.pass[i - 1];
  }
  cfg.ssid[0] = ssid;
  cfg.pass[0] = pass;
}
}  // namespace

namespace config {

bool load(DeviceConfig &cfg) {
  Preferences prefs;
  prefs.begin(kNamespace, /*readOnly=*/true);
  cfg.backendHost = prefs.getString("host", "");
  cfg.deviceKey = prefs.getString("key", "");
  cfg.sensorModel = prefs.getString("model", "fpm22");
  for (int i = 0; i < kWifiSlots; i++) {
    char sk[12], pk[12];
    snprintf(sk, sizeof(sk), "ssid%d", i + 1);
    snprintf(pk, sizeof(pk), "pass%d", i + 1);
    cfg.ssid[i] = prefs.getString(sk, "");
    cfg.pass[i] = prefs.getString(pk, "");
  }
  cfg.cachedMinSeconds = prefs.getInt("minsec", 60);
  cfg.cachedFingerprintEnabled = prefs.getBool("fpen", true);
  prefs.end();
  return cfg.backendHost.length() > 0 && cfg.deviceKey.length() > 0 && cfg.ssid[0].length() > 0;
}

void save(const DeviceConfig &cfg) {
  Preferences prefs;
  prefs.begin(kNamespace, /*readOnly=*/false);
  prefs.putString("host", cfg.backendHost);
  prefs.putString("key", cfg.deviceKey);
  prefs.putString("model", cfg.sensorModel);
  for (int i = 0; i < kWifiSlots; i++) {
    char sk[12], pk[12];
    snprintf(sk, sizeof(sk), "ssid%d", i + 1);
    snprintf(pk, sizeof(pk), "pass%d", i + 1);
    prefs.putString(sk, cfg.ssid[i]);
    prefs.putString(pk, cfg.pass[i]);
  }
  prefs.end();
}

void saveCachedSettings(const DeviceConfig &cfg) {
  Preferences prefs;
  prefs.begin(kNamespace, /*readOnly=*/false);
  prefs.putInt("minsec", cfg.cachedMinSeconds);
  prefs.putBool("fpen", cfg.cachedFingerprintEnabled);
  prefs.end();
}

void clear() {
  Preferences prefs;
  prefs.begin(kNamespace, /*readOnly=*/false);
  prefs.clear();
  prefs.end();
  WiFiManager wm;
  wm.resetSettings();
}

bool connectBestWifi(DeviceConfig &cfg, uint32_t perNetworkMs) {
  if (WiFi.status() == WL_CONNECTED) return true;
  for (int i = 0; i < kWifiSlots; i++) {
    if (cfg.ssid[i].length() == 0) continue;
    if (tryNetwork(cfg.ssid[i], cfg.pass[i], perNetworkMs)) {
      Serial.printf("[wifi] connected on slot %d (%s)\n", i + 1, cfg.ssid[i].c_str());
      if (i != 0) {
        // This network beat the ones before it — make it the new MRU head so
        // the next boot tries it first, and persist the reordered list.
        promote(cfg, i);
        save(cfg);
      }
      return true;
    }
  }
  return false;
}

bool runProvisioningPortal(DeviceConfig &cfg) {
  WiFiManager wm;
  wm.setConfigPortalTimeout(300);   // give someone 5 minutes to walk up with a phone
  wm.setBreakAfterConfig(true);     // return control to us after credentials are entered

  WiFiManagerParameter hostParam("host", "Backend URL (https://...)", cfg.backendHost.c_str(), 128);
  WiFiManagerParameter keyParam("key", "Device API key", cfg.deviceKey.c_str(), 64);
  wm.addParameter(&hostParam);
  wm.addParameter(&keyParam);

  // WiFiManager's own "Erase" button only wipes the ESP32's saved station
  // credentials. Our backend URL / device key / all three WiFi slots live in
  // the "fpcfg" NVS namespace and would survive it, so after a portal-erase the
  // gate just reconnects to the old network on the next boot. Add a button
  // that runs the same full wipe as the physical reset button and reboots
  // into a clean portal.
  std::vector<const char *> menu = {"wifi", "info", "sep", "custom", "restart", "exit"};
  wm.setMenu(menu);
  wm.setCustomMenuHTML(
      "<form action='/eraseall' method='get'>"
      "<button class='D' style='background:#dc3630'>"
      "Erase ALL settings (WiFi + backend)</button></form>");
  wm.setWebServerCallback([&wm]() {
    wm.server->on("/eraseall", [&wm]() {
      wm.server->send(200, "text/html",
                      "<html><head><meta name='viewport' "
                      "content='width=device-width,initial-scale=1'></head>"
                      "<body style='font-family:sans-serif;padding:2em;text-align:center'>"
                      "<h3>All settings erased</h3>"
                      "<p>The gate is restarting into setup. Reconnect to the "
                      "<b>Attendance-FP-Setup</b> WiFi network.</p></body></html>");
      delay(400);
      config::clear();  // clears fpcfg *and* calls WiFiManager::resetSettings()
      delay(200);
      ESP.restart();
    });
  });

  // We drive the connect decision ourselves (up to three stored networks in
  // MRU order), so open the portal explicitly rather than letting autoConnect
  // pick.
  if (!wm.startConfigPortal("Attendance-FP-Setup")) {
    // startConfigPortal returns false when it couldn't verify the entered
    // network, but the SSID/pass the user typed are still readable — keep
    // them so connectBestWifi() can retry after a reboot.
  }

  String ssid = wm.getWiFiSSID();
  String pass = wm.getWiFiPass();
  ssid.trim();

  cfg.backendHost = String(hostParam.getValue());
  cfg.deviceKey = String(keyParam.getValue());
  cfg.backendHost.trim();
  cfg.deviceKey.trim();
  while (cfg.backendHost.endsWith("/")) {
    cfg.backendHost.remove(cfg.backendHost.length() - 1);
  }

  // Newest network goes to the front of the MRU list; the oldest of the
  // three drops off (or its password is just refreshed if already known).
  rememberWifi(cfg, ssid, pass);

  if (cfg.backendHost.length() == 0 || cfg.deviceKey.length() == 0 || cfg.ssid[0].length() == 0) {
    return false;
  }
  save(cfg);

  // Portal left us disconnected in AP mode — bring the radio back to STA and
  // connect with whatever we just stored.
  WiFi.mode(WIFI_STA);
  return connectBestWifi(cfg);
}

}  // namespace config
