#include "offline_queue.h"

#include <LittleFS.h>

bool OfflineQueue::begin() {
  if (!LittleFS.begin(/*formatOnFail=*/true)) {
    return false;
  }
  recount();
  return true;
}

void OfflineQueue::recount() {
  count_ = 0;
  File f = LittleFS.open(kPath, "r");
  if (!f) return;
  while (f.available()) {
    if (f.readStringUntil('\n').length() > 0) count_++;
  }
  f.close();
}

void OfflineQueue::push(const JsonDocument &punch) {
  if (count_ >= kMaxEntries) {
    popFront();  // drop the oldest rather than lose the newest scan
  }
  File f = LittleFS.open(kPath, "a");
  if (!f) return;
  serializeJson(punch, f);
  f.print('\n');
  f.close();
  count_++;
}

bool OfflineQueue::front(JsonDocument &out) {
  File f = LittleFS.open(kPath, "r");
  if (!f) return false;
  String line = f.readStringUntil('\n');
  f.close();
  if (line.length() == 0) return false;
  return deserializeJson(out, line) == DeserializationError::Ok;
}

void OfflineQueue::popFront() {
  File in = LittleFS.open(kPath, "r");
  if (!in) return;
  in.readStringUntil('\n');  // discard the line being popped

  File out = LittleFS.open("/queue.tmp", "w");
  while (in.available()) {
    String line = in.readStringUntil('\n');
    if (line.length() > 0) {
      out.print(line);
      out.print('\n');
    }
  }
  in.close();
  out.close();

  LittleFS.remove(kPath);
  LittleFS.rename("/queue.tmp", kPath);
  recount();
}
