#pragma once

#include <Arduino.h>

// Three status LEDs, driven entirely off millis() so nothing here ever
// blocks loop(). Replaces the old buzzer + blocking digitalWrite/delay
// feedback.
//
// Wiring (LED anode -> GPIO through ~330R, cathode -> GND):
//   green  "status"  -> GPIO25   device configured, WiFi up, ready to scan:
//                                one short pulse every 5 s. Fingerprint
//                                punching disabled -> stays off.
//   blue   "scan"    -> GPIO27   (the pin the buzzer used to be on) solid
//                                on while a finger is being read; 5 fast
//                                blinks when a scan/enrollment completes.
//   red    "error"   -> GPIO26   short burst on any failure; while the
//                                device is disabled, double-blink every 3 s.
namespace led {

// Call once from setup(), after Serial.begin().
void begin();

// Call once per loop() iteration — advances every blink pattern.
void tick();

// ready  -> green heartbeat every 5 s, red idle.
// !ready -> green off, red double-blink every 3 s (device disabled / not
//           ready). Cheap to call every loop(); only changes state on a
//           transition.
void setReady(bool ready);

void scanStart();    // blue solid on (a finger is being read)
void scanSuccess();  // blue: 5 fast blinks, then off
void scanError();    // red burst; blue off
void clearScan();    // blue off (scan aborted, no result)

// All three solid on — used as a visible "wiping config / rebooting" cue.
void allOn();

}  // namespace led
