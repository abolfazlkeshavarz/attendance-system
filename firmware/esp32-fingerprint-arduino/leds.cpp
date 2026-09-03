#include "leds.h"

namespace {

constexpr int kPinStatus = 25;  // green
constexpr int kPinScan = 27;    // blue  (old buzzer pin)
constexpr int kPinError = 26;   // red

constexpr unsigned long kHeartbeatPeriodMs = 5000;
constexpr unsigned long kHeartbeatOnMs = 120;
constexpr unsigned long kDisabledPeriodMs = 3000;
constexpr unsigned long kFastBlinkMs = 90;  // half-period of the 5x success blink
constexpr int kSuccessBlinks = 5;
constexpr unsigned long kErrorBurstMs = 600;

bool g_ready = true;

// blue "scan" channel: 0 = off, 1 = solid on, 2 = fast-blink burst
int g_scanMode = 0;
unsigned long g_scanPhaseStart = 0;
int g_scanBlinksLeft = 0;

// red "error" channel one-shot burst
bool g_errorBurst = false;
unsigned long g_errorBurstStart = 0;

void write(int pin, bool on) { digitalWrite(pin, on ? HIGH : LOW); }

}  // namespace

namespace led {

void begin() {
  pinMode(kPinStatus, OUTPUT);
  pinMode(kPinScan, OUTPUT);
  pinMode(kPinError, OUTPUT);
  write(kPinStatus, false);
  write(kPinScan, false);
  write(kPinError, false);
}

void setReady(bool ready) { g_ready = ready; }

void scanStart() {
  g_scanMode = 1;
  write(kPinScan, true);
}

void scanSuccess() {
  g_scanMode = 2;
  g_scanPhaseStart = millis();
  g_scanBlinksLeft = kSuccessBlinks;
  write(kPinScan, true);
}

void scanError() {
  g_scanMode = 0;
  write(kPinScan, false);
  g_errorBurst = true;
  g_errorBurstStart = millis();
  write(kPinError, true);
}

void clearScan() {
  g_scanMode = 0;
  write(kPinScan, false);
}

void allOn() {
  write(kPinStatus, true);
  write(kPinScan, true);
  write(kPinError, true);
}

void tick() {
  unsigned long now = millis();

  // ---- blue "scan" channel -------------------------------------------------
  if (g_scanMode == 2) {
    // Fast blink burst: toggle every kFastBlinkMs, count down half-cycles.
    if (now - g_scanPhaseStart >= kFastBlinkMs) {
      g_scanPhaseStart = now;
      bool on = digitalRead(kPinScan) == LOW;  // toggle
      write(kPinScan, on);
      if (!on && --g_scanBlinksLeft <= 0) {
        g_scanMode = 0;
        write(kPinScan, false);
      }
    }
  }
  // g_scanMode 1 (solid) and 0 (off) need no work here.

  // ---- red "error" channel ----------------------------------------------
  if (g_errorBurst) {
    if (now - g_errorBurstStart >= kErrorBurstMs) {
      g_errorBurst = false;
      write(kPinError, false);
    }
  } else if (!g_ready) {
    // Disabled: double-blink every 3 s. Window layout inside the period:
    //   0..80  on, 80..200 off, 200..280 on, else off.
    unsigned long p = now % kDisabledPeriodMs;
    bool on = (p < 80) || (p >= 200 && p < 280);
    write(kPinError, on);
  }

  // ---- green "status" channel -------------------------------------------
  if (g_ready) {
    unsigned long p = now % kHeartbeatPeriodMs;
    write(kPinStatus, p < kHeartbeatOnMs);
  } else {
    write(kPinStatus, false);
  }
}

}  // namespace led
