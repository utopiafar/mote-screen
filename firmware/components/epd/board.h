#ifndef MOTE_BOARD_H
#define MOTE_BOARD_H

/* Waveshare ESP32-S3-ePaper-3.97.
 * Display pins match the public ESP-IDF example epaper_port.h.
 * Buttons match the published schematic net names:
 *   Button_Up GPIO4, Button_Function GPIO5, Button_Down GPIO6, ESP_BOOT GPIO0.
 * Panel RAM is 800×480. The UI is portrait 480×800 and is rotated at flush.
 */

#define EPD_SCLK_PIN 11
#define EPD_MOSI_PIN 12
#define EPD_CS_PIN 10
#define EPD_DC_PIN 9
#define EPD_RST_PIN 46
#define EPD_BUSY_PIN 3

#define EPD_NATIVE_W 800
#define EPD_NATIVE_H 480

#define PIN_WHEEL_UP 4
#define PIN_WHEEL_PRESS 5
#define PIN_WHEEL_DOWN 6
#define PIN_BOOT 0

#endif
