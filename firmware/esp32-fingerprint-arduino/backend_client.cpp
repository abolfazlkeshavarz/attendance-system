#include "backend_client.h"

#include <HTTPClient.h>
#include <WiFiClientSecure.h>

#include "certs.h"

BackendClient::BackendClient(String host, String deviceKey)
    : host_(std::move(host)), deviceKey_(std::move(deviceKey)) {}

bool BackendClient::request(const char *method, const String &path, JsonDocument *body,
                             JsonDocument &out) {
  String url = host_ + path;
  HTTPClient http;
  WiFiClientSecure secureClient;
  bool isHttps = url.startsWith("https://");

  if (isHttps) {
#if FP_TLS_INSECURE
    secureClient.setInsecure();
#else
    secureClient.setCACert(ROOT_CA_PEM);
#endif
    http.begin(secureClient, url);
  } else {
    http.begin(url);
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", deviceKey_);
  http.setTimeout(8000);
  http.setConnectTimeout(5000);

  String payload;
  if (body != nullptr) {
    serializeJson(*body, payload);
  }

  int code;
  if (strcmp(method, "GET") == 0) {
    code = http.GET();
  } else if (strcmp(method, "POST") == 0) {
    code = http.POST(payload);
  } else if (strcmp(method, "DELETE") == 0) {
    code = http.sendRequest("DELETE", payload);
  } else {
    http.end();
    return false;
  }

  String respBody = http.getString();
  http.end();

  if (code < 200 || code >= 300) {
    Serial.printf("[backend] %s %s -> %d: %s\n", method, path.c_str(), code, respBody.c_str());
    return false;
  }
  if (respBody.length() > 0) {
    DeserializationError err = deserializeJson(out, respBody);
    if (err) {
      Serial.printf("[backend] bad JSON from %s: %s\n", path.c_str(), err.c_str());
      return false;
    }
  }
  return true;
}

bool BackendClient::handshake(JsonDocument &out) {
  return request("GET", "/api/v1/kiosk/handshake", nullptr, out);
}

bool BackendClient::heartbeat(int pendingCount, const String &appVersion) {
  JsonDocument body, out;
  body["pending_count"] = pendingCount;
  body["app_version"] = appVersion;
  return request("POST", "/api/v1/kiosk/heartbeat", &body, out);
}

bool BackendClient::getPendingEnroll(JsonDocument &out) {
  return request("GET", "/api/v1/kiosk/fingerprint/pending-enroll", nullptr, out);
}

bool BackendClient::enrollComplete(int jobId, int slotId, const String &templateB64,
                                    const String &modelName, JsonDocument &out) {
  JsonDocument body;
  body["job_id"] = jobId;
  body["slot_id"] = slotId;
  body["template_base64"] = templateB64;
  body["model_name"] = modelName;
  return request("POST", "/api/v1/kiosk/fingerprint/enroll/complete", &body, out);
}

bool BackendClient::enrollFail(int jobId, const String &error) {
  JsonDocument body, out;
  body["job_id"] = jobId;
  body["error"] = error;
  return request("POST", "/api/v1/kiosk/fingerprint/enroll/fail", &body, out);
}

bool BackendClient::sync(const String &modelName, JsonDocument &out) {
  JsonDocument body;
  body["model_name"] = modelName;
  return request("POST", "/api/v1/kiosk/fingerprint/sync", &body, out);
}

bool BackendClient::syncConfirm(JsonVariantConst added, JsonVariantConst removedEmployeeIds) {
  JsonDocument body, out;
  body["added"] = added;
  body["removed_employee_ids"] = removedEmployeeIds;
  return request("POST", "/api/v1/kiosk/fingerprint/sync/confirm", &body, out);
}

bool BackendClient::punch(int slotId, const char *kind, float confidence,
                           const String &happenedAtIso, const String &clientUuid,
                           bool createdOffline, JsonDocument &out) {
  JsonDocument body;
  body["slot_id"] = slotId;
  if (kind != nullptr) body["kind"] = kind;
  if (confidence >= 0) body["confidence"] = confidence;
  if (happenedAtIso.length() > 0) body["happened_at"] = happenedAtIso;
  if (clientUuid.length() > 0) body["client_uuid"] = clientUuid;
  body["created_offline"] = createdOffline;
  return request("POST", "/api/v1/kiosk/fingerprint/punch", &body, out);
}
