#include "config.h"

#include <Preferences.h>
#include <WiFiManager.h>

namespace {
const char *kNamespace = "fpcfg";
}

namespace config {

bool load(DeviceConfig &cfg) {
  Preferences prefs;
  prefs.begin(kNamespace, /*readOnly=*/true);
  cfg.backendHost = prefs.getString("host", "");
  cfg.deviceKey = prefs.getString("key", "");
  cfg.sensorModel = prefs.getString("model", "fpm22");
  prefs.end();
  return cfg.backendHost.length() > 0 && cfg.deviceKey.length() > 0;
}

void save(const DeviceConfig &cfg) {
  Preferences prefs;
  prefs.begin(kNamespace, /*readOnly=*/false);
  prefs.putString("host", cfg.backendHost);
  prefs.putString("key", cfg.deviceKey);
  prefs.putString("model", cfg.sensorModel);
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

bool runProvisioningPortal(DeviceConfig &cfg) {
  WiFiManager wm;
  wm.setConfigPortalTimeout(300);  // give someone 5 minutes to walk up with a phone

  WiFiManagerParameter hostParam("host", "Backend URL (https://...)", cfg.backendHost.c_str(), 128);
  WiFiManagerParameter keyParam("key", "Device API key", cfg.deviceKey.c_str(), 64);
  wm.addParameter(&hostParam);
  wm.addParameter(&keyParam);

  // Opens an AP named "Attendance-FP-Setup" only if no known WiFi connects;
  // otherwise reconnects to the saved network immediately.
  if (!wm.autoConnect("Attendance-FP-Setup")) {
    return false;  // portal timed out with nothing configured
  }

  cfg.backendHost = String(hostParam.getValue());
  cfg.deviceKey = String(keyParam.getValue());
  cfg.backendHost.trim();
  cfg.deviceKey.trim();
  while (cfg.backendHost.endsWith("/")) {
    cfg.backendHost.remove(cfg.backendHost.length() - 1);
  }
  if (cfg.backendHost.length() == 0 || cfg.deviceKey.length() == 0) {
    return false;
  }
  save(cfg);
  return true;
}

}  // namespace config
