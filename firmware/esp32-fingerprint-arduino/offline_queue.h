#pragma once

#include <ArduinoJson.h>

// One JSON object per line in /queue.jsonl on LittleFS. Small by design —
// this is for outages measured in minutes/hours, not a bulk sync log — so
// popFront() rewriting the whole file is fine.
class OfflineQueue {
 public:
  bool begin();
  size_t size() const { return count_; }

  // Silently drops the oldest entry if already at capacity, so one gate
  // losing network for days can't fill the flash.
  void push(const JsonDocument &punch);

  bool front(JsonDocument &out);
  void popFront();

 private:
  static constexpr const char *kPath = "/queue.jsonl";
  static constexpr size_t kMaxEntries = 500;

  size_t count_ = 0;
  void recount();
};
