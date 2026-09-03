#include "config.h"

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
}  // namespace

namespace config {

bool load(DeviceConfig &cfg) {
  Preferences prefs;
  prefs.begin(kNamespace, /*readOnly=*/true);
  cfg.backendHost = prefs.getString("host", "");
  cfg.deviceKey = prefs.getString("key", "");
  cfg.sensorModel = prefs.getString("model", "fpm22");
  cfg.ssid1 = prefs.getString("ssid1", "");
  cfg.pass1 = prefs.getString("pass1", "");
  cfg.ssid2 = prefs.getString("ssid2", "");
  cfg.pass2 = prefs.getString("pass2", "");
  cfg.cachedMinSeconds = prefs.getInt("minsec", 60);
  cfg.cachedFingerprintEnabled = prefs.getBool("fpen", true);
  prefs.end();
  return cfg.backendHost.length() > 0 && cfg.deviceKey.length() > 0 && cfg.ssid1.length() > 0;
}

void save(const DeviceConfig &cfg) {
  Preferences prefs;
  prefs.begin(kNamespace, /*readOnly=*/false);
  prefs.putString("host", cfg.backendHost);
  prefs.putString("key", cfg.deviceKey);
  prefs.putString("model", cfg.sensorModel);
  prefs.putString("ssid1", cfg.ssid1);
  prefs.putString("pass1", cfg.pass1);
  prefs.putString("ssid2", cfg.ssid2);
  prefs.putString("pass2", cfg.pass2);
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

bool connectBestWifi(const DeviceConfig &cfg, uint32_t perNetworkMs) {
  if (WiFi.status() == WL_CONNECTED) return true;
  if (tryNetwork(cfg.ssid1, cfg.pass1, perNetworkMs)) {
    Serial.printf("[wifi] connected on slot 1 (%s)\n", cfg.ssid1.c_str());
    return true;
  }
  if (tryNetwork(cfg.ssid2, cfg.pass2, perNetworkMs)) {
    Serial.printf("[wifi] connected on slot 2 (%s)\n", cfg.ssid2.c_str());
    return true;
  }
  return false;
}

bool runProvisioningPortal(DeviceConfig &cfg, bool firstTime) {
  WiFiManager wm;
  wm.setConfigPortalTimeout(300);   // give someone 5 minutes to walk up with a phone
  wm.setBreakAfterConfig(true);     // return control to us after credentials are entered

  WiFiManagerParameter hostParam("host", "Backend URL (https://...)", cfg.backendHost.c_str(), 128);
  WiFiManagerParameter keyParam("key", "Device API key", cfg.deviceKey.c_str(), 64);
  wm.addParameter(&hostParam);
  wm.addParameter(&keyParam);

  // We drive the connect decision ourselves (two stored networks), so open
  // the portal explicitly rather than letting autoConnect pick.
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

  if (ssid.length() > 0) {
    if (firstTime || cfg.ssid1.length() == 0) {
      cfg.ssid1 = ssid;
      cfg.pass1 = pass;
    } else {
      cfg.ssid2 = ssid;
      cfg.pass2 = pass;
    }
  }

  if (cfg.backendHost.length() == 0 || cfg.deviceKey.length() == 0 || cfg.ssid1.length() == 0) {
    return false;
  }
  save(cfg);

  // Portal left us disconnected in AP mode — bring the radio back to STA and
  // connect with whatever we just stored.
  WiFi.mode(WIFI_STA);
  return connectBestWifi(cfg);
}

}  // namespace config
