#pragma once

#include <Arduino.h>

// Drives a 0.96" SSD1306 128x64 I2C OLED as a status + scrolling log screen.
// Two things are shown at once:
//   - a one-line status header (WiFi state, queue depth, fingerprint on/off)
//   - the last few log lines, most recent at the bottom, like a tiny console
//
// Wiring (ESP32 hardware I2C defaults, unused by anything else in this
// project): SDA -> GPIO21, SCL -> GPIO22, plus VCC/GND. I2C address is
// almost always 0x3C on these 0.96" boards (0x3D on some 128x64 variants —
// if the screen stays blank, try that first).
namespace oled {

// Call once from setup(), after Serial.begin(). Safe to call even if no
// screen is wired up: begin() just returns false and every other function
// becomes a no-op, so you can leave calls in place for units without a
// display.
bool begin();

// Appends a line to the scrolling log area and redraws immediately.
// Long lines are wrapped at the screen width. Mirrors what you'd Serial.print
// anyway — call it alongside your existing Serial.printf/println calls
// rather than instead of them.
void log(const String &line);

// Updates the persistent header line. Call whenever any of these change —
// cheap to call every loop() iteration too, it only repaints the header row.
void setStatus(bool wifiConnected, size_t queueSize, bool fingerprintEnabled);

}  // namespace oled
