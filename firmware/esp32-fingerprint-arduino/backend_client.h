#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

// Thin wrapper around the /api/v1/kiosk/fingerprint/* and /api/v1/kiosk/*
// endpoints. Every call is synchronous and blocks for up to a few seconds;
// callers (main.cpp) are responsible for deciding what to do on failure
// (retry later, queue offline, etc.) — this class never queues anything
// itself.
class BackendClient {
 public:
  BackendClient(String host, String deviceKey);

  bool handshake(JsonDocument &out);
  bool heartbeat(int pendingCount, const String &appVersion);

  // out["job"] is null if nothing is pending for this device.
  bool getPendingEnroll(JsonDocument &out);
  bool enrollComplete(int jobId, int slotId, const String &templateB64, const String &modelName,
                       JsonDocument &out);
  bool enrollFail(int jobId, const String &error);

  bool sync(const String &modelName, JsonDocument &out);
  // added: array of {"employee_id":.., "slot_id":..}; removedEmployeeIds: plain ints.
  bool syncConfirm(JsonVariantConst added, JsonVariantConst removedEmployeeIds);

  // connectTimeoutMs / readTimeoutMs let the caller trade delivery odds for
  // latency. The live punch on a finger press passes tight values so the
  // gate is ready again within ~3 s even if the server is slow (it just
  // falls back to the offline queue); the queue flush uses the generous
  // defaults since nobody is waiting at the gate for it.
  bool punch(int slotId, const char *kind, float confidence, const String &happenedAtIso,
             const String &clientUuid, bool createdOffline, JsonDocument &out,
             int connectTimeoutMs = 5000, int readTimeoutMs = 8000);

  // Fire-and-forget: tells the backend a finger is being read right now so
  // the browser kiosk can show a live "scanning" state. Failure is ignored
  // and the timeout is short — it must never hold up the punch behind it.
  void reportScan(const char *phase);

 private:
  String host_;
  String deviceKey_;

  bool request(const char *method, const String &path, JsonDocument *body, JsonDocument &out,
               int connectTimeoutMs = 5000, int readTimeoutMs = 8000);
};
