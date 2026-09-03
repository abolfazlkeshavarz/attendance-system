# ESP32 fingerprint gate — Arduino IDE build

Same firmware as [`../esp32-fingerprint`](../esp32-fingerprint) (PlatformIO
project), laid out instead as a plain Arduino IDE sketch: everything sits
flat in this one folder because Arduino IDE doesn't support the `src/`
subdirectory PlatformIO uses. Pick whichever tool you're already set up
with — the two folders behave identically otherwise. See the PlatformIO
folder's README for wiring, provisioning, and enrollment usage; this one
only covers getting Arduino IDE itself to build and flash it.

## 1. Install ESP32 board support

1. Arduino IDE → **File → Preferences** → "Additional boards manager URLs" →
   add: `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
2. **Tools → Board → Boards Manager** → search "esp32" → install
   **esp32 by Espressif Systems** (tested against 3.x; anything recent works).

## 2. Install libraries

**Tools → Manage Libraries…**, install these (exact names to search for):

| Library | Author | Notes |
|---|---|---|
| Adafruit Fingerprint Sensor Library | Adafruit | pulls in `Adafruit_BusIO` as a dependency — accept it |
| ArduinoJson | Benoit Blanchon | v7.x |
| WiFiManager | tzapu | captive-portal WiFi provisioning |
| Adafruit SSD1306 | Adafruit | for the optional status OLED; also pulls in `Adafruit_GFX` — accept it |

## Optional: 0.96" I2C OLED status screen

`oled_status.h`/`.cpp` drive a 128x64 SSD1306 OLED showing a live status
header (WiFi up/down, offline-queue depth, fingerprint enabled/disabled) plus
a scrolling log of recent events (boot, wifi, handshake, sync, enroll,
punches). It's optional — if no screen is wired up, `oled::begin()` just
fails quietly and every other `oled::` call becomes a no-op, so you can leave
a unit without a display and nothing breaks.

Wiring (ESP32 hardware I2C defaults — free in this project, nothing else
uses GPIO21/22):

| OLED pin | ESP32 pin |
|---|---|
| VCC | 3.3V |
| GND | GND |
| SDA | GPIO21 |
| SCL | GPIO22 |

I2C address is `0x3C` on almost all 0.96" SSD1306 boards. If the screen
stays blank, open `oled_status.cpp` and try `0x3D` instead (some 128x64
variants ship at that address).

## 3. Open the sketch

Open `esp32-fingerprint-arduino.ino` from this folder — Arduino IDE will
load the other `.h`/`.cpp` files in the same folder automatically and show
them as tabs.

## 4. Board settings

**Tools** menu:

- **Board**: "ESP32 Dev Module" (or your exact board if it's listed by name,
  e.g. "ESP32-WROOM-32")
- **Upload Speed**: 921600 (drop to 115200 if you get upload errors over a
  long/cheap USB cable)
- **Flash Size**: 4MB (default) — matches the ESP32-WROOM-32's flash
- **Partition Scheme**: "Default 4MB with spiffs" — this build uses
  `LittleFS` for the offline queue, so the partition table must reserve a
  filesystem partition
- **Port**: whichever `COM#` (Windows) / `/dev/tty.*` (macOS) / `/dev/ttyUSB*`
  (Linux) the board enumerates as

## 5. Before your first real upload

- Fill in `certs.h` with the Let's Encrypt ISRG Root X1 PEM (see the comment
  in that file) — or leave `FP_TLS_INSECURE` at `1` temporarily for bench
  testing only.
- Wiring and first-boot WiFi/backend provisioning are otherwise as in the
  PlatformIO build — see the [main README](../esp32-fingerprint/README.md) —
  but this copy has diverged: it adds the OLED, single-gate enrollment, the
  3-LED status scheme, dual WiFi, a reset button, and outage hardening below.

## Status LEDs (replaces the buzzer)

Three LEDs, each anode → GPIO through ~330 Ω, cathode → GND. The blue LED
sits on GPIO27, the pin the buzzer used to use — there is no buzzer anymore.

| LED | ESP32 pin | Behaviour |
|---|---|---|
| green "status" | GPIO25 | one short pulse every 5 s when the gate is configured, on WiFi, and ready to scan. Off while fingerprint punching is disabled from the panel. |
| blue "scan" | GPIO27 | solid on while a finger is being read; 5 fast blinks when a scan or an enrollment finishes. |
| red "error" | GPIO26 | short burst on any failure; double-blink every 3 s while fingerprint punching is disabled (tells people at the gate it's switched off, not broken). |

## Reset button — hold 5 s to re-provision

Momentary button between **GPIO33 and GND** (uses the internal pull-up).
Hold it for 5 seconds during normal operation: all three LEDs come on, the
saved WiFi networks + backend URL + device key are wiped, and the unit
reboots straight into the captive portal.

## Two WiFi networks with automatic failover

- **Slot 1** is stored the first time you provision the gate.
- If slot 1 is later unreachable, the gate reopens the portal; the network
  you enter there is saved as **slot 2** (slot 1 is kept).
- On every connect it tries **slot 1 first, then slot 2**, so it comes back
  to the primary network on its own once that's available again.
- If **both** are unreachable it reopens the portal for another network.
- A full reset (button above) clears both slots; the next provision writes
  slot 1 again.

## Power-outage behaviour

- A ~90 s task watchdog reboots the unit if a network call wedges.
- If the backend is still down ~30 s after boot (typical when the server is
  rebooting from the same outage), the gate enters a **degraded RUN**: finger
  scans are still captured to the offline queue and flushed once the backend
  answers. It also keeps retrying NTP until the clock is set.
- Last-known settings (`min_seconds_between_punches`, fingerprint on/off) are
  cached in NVS so a degraded start behaves sensibly.

## 6. Compile and upload

**Sketch → Upload** (or the toolbar arrow icon). Open **Tools → Serial
Monitor** at 115200 baud afterward to watch boot/connection logs — the
firmware prints `[wifi]`, `[enroll]`, `[sync]`, and `[settings]` prefixed
lines as it runs.

## Keeping this copy in sync

This folder is a flat copy of the PlatformIO source for Arduino IDE's
benefit, not a symlink — if you change logic in
`../esp32-fingerprint/src/`, copy the matching file(s) here too (everything
except `certs.h`, which intentionally differs: this copy hardcodes
`FP_TLS_INSECURE` since Arduino IDE has no `build_flags`).
