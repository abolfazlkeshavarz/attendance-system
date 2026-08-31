# ESP32 fingerprint gate — firmware skeleton

Talks to the backend's `/api/v1/kiosk/fingerprint/*` and `/api/v1/kiosk/handshake`
endpoints using the same `X-Device-Key` auth as the tablets. One physical
gate = one ESP32 + one FPM22 sensor = one `Device` row created from the admin
panel (Devices page → "ثبت دستگاه جدید").

Two build options, same firmware: this folder is a **PlatformIO** project.
Prefer the Arduino IDE instead? Use
[`../esp32-fingerprint-arduino`](../esp32-fingerprint-arduino) — identical
source, laid out flat for Arduino IDE's sketch format, with its own README
covering board/library setup and upload.

## Wiring (ESP32-WROOM-32 + FPM22)

| FPM22 | ESP32 |
|---|---|
| TX | GPIO16 (RX2) |
| RX | GPIO17 (TX2) |
| VCC | per sensor datasheet — often needs its own 5V rail, not the ESP32's 3.3V regulator |
| GND | GND (common with ESP32) |

Logic level is 3.3V TTL, so no level shifter is needed between the sensor's
data lines and the ESP32's GPIOs — only the power rail may need to be
separate.

## Build & flash

Requires [PlatformIO](https://platformio.org/). From this directory:

```
pio run -t upload
pio device monitor
```

## First boot (provisioning)

On first boot (or after `config::clear()`), the device opens a WiFi access
point named **Attendance-FP-Setup**. Connect to it with a phone, the captive
portal will ask for:

1. Your real WiFi SSID/password.
2. **Backend URL** — e.g. `https://hozur.example.com` (no trailing slash).
3. **Device API key** — the raw key shown once when you created this device
   in the admin panel. If lost, use "Devices → rotate key" and re-provision.

After that it reboots, connects, and starts polling the backend.

## Enrolling an employee

From the admin panel: pick an employee, pick which gate they're standing at,
click "Start enrollment". The ESP32 polls for this job every ~3s while
running, captures two scans, and reports the result back. Because the raw
template is uploaded to the backend (not just the local slot), every other
gate picks it up automatically on its next sync (every ~10 min, or restart).

## Two things to verify before trusting this beyond a bench test

1. **`extractTemplate()` / `injectTemplate()` in `fingerprint_sensor.cpp`
   are marked `TODO(verify)`.** They call into `Adafruit_Fingerprint`'s
   `getModel()`/`setModel()` per the mainline library's v2.1.x API, but the
   exact byte-transfer step depends on your installed library version. If
   your library doesn't expose upload/download at all, multi-gate template
   sync isn't possible without patching it in from the AS608/FPM22
   datasheet's `PS_UpChar`/`PS_DownChar` packet format — fall back to
   enrolling each employee at every gate individually in that case (still
   works, `FingerprintSlot` per-device mapping doesn't care how a slot got
   filled).
2. **TLS cert** — `src/certs.h` has a placeholder for the Let's Encrypt
   ISRG Root X1 PEM. Fill it in from https://letsencrypt.org/certificates/
   before shipping a unit; `FP_TLS_INSECURE=1` in `platformio.ini` is a
   bench-only escape hatch that skips certificate validation entirely.

## Respecting the admin panel's "auth methods" toggle

If an admin disables fingerprint punching from the panel (Settings →
"روش‌های تأیید هویت"), the backend already rejects `/kiosk/fingerprint/punch`
with 403 regardless of what this firmware does. On top of that, this
firmware checks `fingerprint_enabled` from `/kiosk/handshake` at boot and
re-checks it every ~2 minutes while running: while disabled, it stops
scanning for a finger entirely and blinks the error LED twice every few
seconds so someone at the gate can tell it's turned off on purpose rather
than broken. Enrollment and template sync keep working while disabled, so
an admin can pre-register people before flipping punching back on.

## What's deliberately NOT in this skeleton

- OLED/display feedback — only a buzzer + two LEDs (`PIN_LED_OK`,
  `PIN_LED_ERR`) are wired up in `main.cpp`; add a display driver if wanted.
- Retry/backoff tuning — `handleMatch()`/`flushQueue()` are intentionally
  simple; a gate that's offline for days will just queue up to `kMaxEntries`
  (500) punches and drop the oldest beyond that.
- OTA updates.
