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

**Tools → Manage Libraries…**, install these three (exact names to search for):

| Library | Author | Notes |
|---|---|---|
| Adafruit Fingerprint Sensor Library | Adafruit | pulls in `Adafruit_BusIO` as a dependency — accept it |
| ArduinoJson | Benoit Blanchon | v7.x |
| WiFiManager | tzapu | captive-portal WiFi provisioning |

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
- Wiring and first-boot WiFi/backend provisioning are identical to the
  PlatformIO build — see the [main README](../esp32-fingerprint/README.md).

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
