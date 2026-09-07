#pragma once

#include <Arduino.h>

// Three status LEDs, driven entirely off millis() so nothing here ever
// blocks loop(). Replaces the old buzzer + blocking digitalWrite/delay
// feedback.
//
// Wiring (LED anode -> GPIO through ~330R, cathode -> GND):
//   green  "success" -> GPIO25   lights solid for 2 s after a finger is
//                                matched and the attendance punch is
//                                accepted (or an enrollment finishes). Off
//                                the rest of the time.
//   blue   "ready"   -> GPIO27   (the pin the buzzer used to be on) solid on
//                                whenever the gate is healthy and ready to
//                                scan — including right after a successful
//                                scan. Blinks very fast while a finger is
//                                actually being read. Off when the gate is
//                                not ready (disabled from the panel, or Wi-Fi
//                                down).
//   red    "error"   -> GPIO26   solid on the whole time Wi-Fi is
//                                disconnected; a short burst on any other
//                                failure; a slow double-blink while
//                                fingerprint punching is switched off in the
//                                panel (Wi-Fi still up) so people can tell
//                                "disabled" from "broken".
namespace led {

// Call once from setup(), after Serial.begin().
void begin();

// Call once per loop() iteration — advances every blink pattern.
void tick();

// Gate is in RUN, fingerprint punching enabled, Wi-Fi connected.
//   ready  -> blue solid on (idle-ready baseline).
//   !ready -> blue off. If Wi-Fi is also down, red goes solid (see
//             setWifiDown); otherwise red slow double-blinks (disabled).
// Cheap to call every loop(); only acts on a change.
void setReady(bool ready);

// Wi-Fi link state. true -> red LED solid on immediately (works even while
// a blocking reconnect keeps tick() from running). false -> red returns to
// its normal idle/burst behaviour.
void setWifiDown(bool down);

void scanStart();    // blue: very fast blink (a finger is being read)
void scanSuccess();  // green: solid for 2 s; blue returns to the ready state
void scanReject();   // red: 5 fast blinks over ~1.5 s — finger not recognised / not enrolled
void scanError();    // red: short single burst — an operation failed (e.g. enrolment)
void clearScan();    // blue back to ready state (scan aborted, no result)

// All three solid on — used as a visible "wiping config / rebooting" cue.
void allOn();

}  // namespace led
