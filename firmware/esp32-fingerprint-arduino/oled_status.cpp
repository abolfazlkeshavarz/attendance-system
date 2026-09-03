#include "oled_status.h"

#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Wire.h>

namespace {

constexpr int kScreenWidth = 128;
constexpr int kScreenHeight = 64;
constexpr uint8_t kI2cAddress = 0x3C;  // try 0x3D if the screen stays blank
constexpr int kPinSda = 21;
constexpr int kPinScl = 22;

// Font is 6px wide / 8px tall at text size 1 -> 21 chars fit per 128px row.
constexpr int kCharsPerLine = 21;
constexpr int kHeaderRows = 1;
constexpr int kLogRows = (kScreenHeight / 8) - kHeaderRows;  // 7 rows on a 64px screen

Adafruit_SSD1306 *g_display = nullptr;
bool g_ready = false;

String g_logLines[kLogRows];
int g_logCount = 0;  // how many of g_logLines are populated, up to kLogRows

String g_statusLine = "booting...";

void pushLine(const String &line) {
  // Wrap long lines instead of truncating — a wrapped backend URL or error
  // message is still readable across two rows.
  String remaining = line;
  do {
    String chunk = remaining.substring(0, kCharsPerLine);
    remaining = remaining.substring(chunk.length());

    if (g_logCount < kLogRows) {
      g_logLines[g_logCount++] = chunk;
    } else {
      for (int i = 1; i < kLogRows; i++) g_logLines[i - 1] = g_logLines[i];
      g_logLines[kLogRows - 1] = chunk;
    }
  } while (remaining.length() > 0);
}

void redraw() {
  if (!g_ready) return;
  g_display->clearDisplay();
  g_display->setTextSize(1);
  g_display->setTextColor(SSD1306_WHITE);

  g_display->setCursor(0, 0);
  g_display->println(g_statusLine);
  g_display->drawFastHLine(0, 9, kScreenWidth, SSD1306_WHITE);

  int y = 12;
  for (int i = 0; i < g_logCount; i++) {
    g_display->setCursor(0, y);
    g_display->println(g_logLines[i]);
    y += 8;
  }
  g_display->display();
}

}  // namespace

namespace oled {

bool begin() {
  Wire.begin(kPinSda, kPinScl);
  g_display = new Adafruit_SSD1306(kScreenWidth, kScreenHeight, &Wire, -1);
  if (!g_display->begin(SSD1306_SWITCHCAPVCC, kI2cAddress)) {
    Serial.println("[oled] SSD1306 not found on I2C bus — continuing without display");
    delete g_display;
    g_display = nullptr;
    return false;
  }
  g_ready = true;
  g_display->setRotation(0);
  redraw();
  return true;
}

void log(const String &line) {
  if (!g_ready) return;
  pushLine(line);
  redraw();
}

void setStatus(bool wifiConnected, size_t queueSize, bool fingerprintEnabled) {
  if (!g_ready) return;
  char buf[32];
  snprintf(buf, sizeof(buf), "%s Q:%u FP:%s", wifiConnected ? "WiFi:UP" : "WiFi:DN",
           (unsigned)queueSize, fingerprintEnabled ? "ON" : "OFF");
  String next(buf);
  if (next == g_statusLine) return;  // skip the redraw if nothing changed
  g_statusLine = next;
  redraw();
}

}  // namespace oled
