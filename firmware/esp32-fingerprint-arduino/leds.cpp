#include "leds.h"

namespace {

constexpr int kPinSuccess = 25;  // green
constexpr int kPinReady = 27;    // blue  (old buzzer pin)
constexpr int kPinError = 26;    // red

constexpr unsigned long kScanBlinkMs = 45;    // half-period of the "reading" fast blink
constexpr unsigned long kSuccessHoldMs = 2000;  // green solid after a successful punch
constexpr unsigned long kErrorBurstMs = 600;
constexpr unsigned long kDisabledPeriodMs = 3000;  // red double-blink cadence when disabled

bool g_ready = true;      // gate healthy + ready to scan -> blue solid
bool g_wifiDown = false;  // Wi-Fi disconnected -> red solid

// blue "ready" channel: false = follow g_ready, true = fast-blink burst
bool g_scanning = false;
unsigned long g_scanToggleAt = 0;
bool g_scanLevel = false;

// green "success" one-shot hold
unsigned long g_successUntil = 0;

// red "error" one-shot burst
bool g_errorBurst = false;
unsigned long g_errorBurstStart = 0;

void write(int pin, bool on) { digitalWrite(pin, on ? HIGH : LOW); }

}  // namespace

namespace led {

void begin() {
  pinMode(kPinSuccess, OUTPUT);
  pinMode(kPinReady, OUTPUT);
  pinMode(kPinError, OUTPUT);
  write(kPinSuccess, false);
  write(kPinReady, false);
  write(kPinError, false);
}

void setReady(bool ready) {
  g_ready = ready;
  if (!g_scanning) write(kPinReady, ready);
}

void setWifiDown(bool down) {
  g_wifiDown = down;
  if (down) {
    // Latch it now — a blocking reconnect can keep tick() from running for
    // several seconds and we still want the red LED on the whole time.
    write(kPinError, true);
    write(kPinReady, false);
  }
}

void scanStart() {
  g_scanning = true;
  g_scanToggleAt = millis();
  g_scanLevel = true;
  write(kPinReady, true);
}

void scanSuccess() {
  g_scanning = false;
  g_successUntil = millis() + kSuccessHoldMs;
  write(kPinSuccess, true);
  write(kPinReady, g_ready);  // blue straight back to the ready baseline
}

void scanError() {
  g_scanning = false;
  write(kPinReady, g_ready);
  g_errorBurst = true;
  g_errorBurstStart = millis();
  write(kPinError, true);
}

void clearScan() {
  g_scanning = false;
  write(kPinReady, g_ready);
}

void allOn() {
  write(kPinSuccess, true);
  write(kPinReady, true);
  write(kPinError, true);
}

void tick() {
  unsigned long now = millis();

  // ---- blue "ready" channel ---------------------------------------------
  if (g_scanning) {
    if (now - g_scanToggleAt >= kScanBlinkMs) {
      g_scanToggleAt = now;
      g_scanLevel = !g_scanLevel;
      write(kPinReady, g_scanLevel);
    }
  } else {
    write(kPinReady, g_ready);
  }

  // ---- green "success" channel -----------------------------------------
  if (g_successUntil != 0) {
    if ((long)(now - g_successUntil) >= 0) {
      g_successUntil = 0;
      write(kPinSuccess, false);
    } else {
      write(kPinSuccess, true);
    }
  }

  // ---- red "error" channel -------------------------------------------
  if (g_errorBurst) {
    if (now - g_errorBurstStart >= kErrorBurstMs) {
      g_errorBurst = false;
      write(kPinError, false);
    } else {
      write(kPinError, true);
    }
  } else if (g_wifiDown) {
    write(kPinError, true);  // solid while the link is down
  } else if (!g_ready) {
    // Fingerprint punching disabled from the panel (but Wi-Fi is fine):
    // slow double-blink so people at the gate know it's off, not broken.
    //   0..80 on, 80..200 off, 200..280 on, else off.
    unsigned long p = now % kDisabledPeriodMs;
    write(kPinError, (p < 80) || (p >= 200 && p < 280));
  } else {
    write(kPinError, false);
  }
}

}  // namespace led
