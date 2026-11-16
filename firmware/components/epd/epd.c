#include "epd.h"

#include "board.h"
#include "mote_logic.h"
#include "ui.h"

#include <stdlib.h>
#include <string.h>

#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

/* 1-bit paths from the published Waveshare 3.97 driver and the xiaozhi
 * board driver (custom_lcd_display.cc). No 4-gray init (0x1A=0x5A) and
 * no 4-gray turn-on (0x22=0xD7).
 *
 * EPD_Init once at boot. Display_Base writes the same frame to 0x24 and
 * 0x26, then 0x22=0xF7. That is the baseline, used for the first paint
 * and the occasional cleanup. EPD_Init_Partial (reset, 0x18=0x80,
 * border 0x3C=0x80, full-frame window) runs when a partial series
 * starts, not on every frame. Display_Partial writes 0x24 only and
 * turns on with 0x22=0xFF, with no reset, so 0x26 stays the previous
 * image and only changed pixels move.
 */

static const char *TAG = "epd";
static spi_device_handle_t spi;
static int in_partial;

static void send_byte(uint8_t value) {
    spi_transaction_t t = {.length = 8, .tx_buffer = &value};
    ESP_ERROR_CHECK(spi_device_polling_transmit(spi, &t));
}

static void cmd(uint8_t value) {
    gpio_set_level(EPD_DC_PIN, 0);
    send_byte(value);
}

static void dat(uint8_t value) {
    gpio_set_level(EPD_DC_PIN, 1);
    send_byte(value);
}

static void dat_buf(const uint8_t *data, size_t len) {
    gpio_set_level(EPD_DC_PIN, 1);
    while (len) {
        size_t chunk = len > 4096 ? 4096 : len;
        spi_transaction_t t = {.length = chunk * 8, .tx_buffer = data};
        ESP_ERROR_CHECK(spi_device_polling_transmit(spi, &t));
        data += chunk;
        len -= chunk;
    }
}

static void wait_idle(void) {
    vTaskDelay(pdMS_TO_TICKS(20));
    for (int i = 0; i < 500; i++) {
        if (gpio_get_level(EPD_BUSY_PIN) == 0) return;
        vTaskDelay(pdMS_TO_TICKS(20));
    }
    ESP_LOGW(TAG, "busy timeout");
}

static void reset_panel(void) {
    gpio_set_level(EPD_RST_PIN, 1);
    vTaskDelay(pdMS_TO_TICKS(50));
    gpio_set_level(EPD_RST_PIN, 0);
    vTaskDelay(pdMS_TO_TICKS(2));
    gpio_set_level(EPD_RST_PIN, 1);
    vTaskDelay(pdMS_TO_TICKS(50));
}

/* Same full-frame window as EPD_Init. Display_Partial addresses X in
 * bytes and then multiplies by 8; for a full 800-wide frame that stops
 * at 792. The init window covers the RAM the 48000-byte buffer fills. */
static void set_full_window(void) {
    cmd(0x44);
    dat(0x00);
    dat(0x00);
    dat((EPD_NATIVE_W - 1) % 256);
    dat((EPD_NATIVE_W - 1) / 256);
    cmd(0x45);
    dat((EPD_NATIVE_H - 1) % 256);
    dat((EPD_NATIVE_H - 1) / 256);
    dat(0x00);
    dat(0x00);
    cmd(0x4E);
    dat(0x00);
    dat(0x00);
    cmd(0x4F);
    dat(0x00);
    dat(0x00);
}

static void common_power(void) {
    cmd(0x0C);
    dat(0xAE);
    dat(0xC7);
    dat(0xC3);
    dat(0xC0);
    dat(0x80);
}

static void hw_init(void) {
    reset_panel();
    wait_idle();
    cmd(0x12);
    wait_idle();
    cmd(0x18);
    dat(0x80);
    common_power();
    cmd(0x01);
    dat((EPD_NATIVE_H - 1) % 256);
    dat((EPD_NATIVE_H - 1) / 256);
    dat(0x02);
    cmd(0x3C);
    dat(0x01);
    cmd(0x11);
    dat(0x01);
    set_full_window();
    wait_idle();
    in_partial = 0;
}

/* xiaozhi EPD_Init_Partial: reset once for the series, temperature
 * sensor 0x18=0x80, border 0x3C=0x80 (not the full-refresh 0x01). */
static void init_partial(void) {
    reset_panel();
    wait_idle();
    cmd(0x18);
    dat(0x80);
    cmd(0x3C);
    dat(0x80);
    set_full_window();
    wait_idle();
    in_partial = 1;
}

static void turn_on(uint8_t sequence) {
    cmd(0x22);
    dat(sequence);
    cmd(0x20);
    wait_idle();
}

static int portrait_level(const uint8_t *fb, int x, int y) {
    int i = y * MOTE_UI_W + x;
    int shift = (3 - (i & 3)) * 2;
    return (fb[i >> 2] >> shift) & 3;
}

/* Rotate portrait 480×800 onto the panel's 800×480 RAM.
 * Level below 2 is black. The UI is 1-bit text. */
static void pack_mono(const uint8_t *portrait, uint8_t *out) {
    memset(out, 0xFF, EPD_NATIVE_W * EPD_NATIVE_H / 8);
    for (int y = 0; y < MOTE_UI_H; y++) {
        for (int x = 0; x < MOTE_UI_W; x++) {
            int px = y;
            int py = MOTE_UI_W - 1 - x;
            int black = portrait_level(portrait, x, y) < 2;
            if (!black) continue;
            int i = py * EPD_NATIVE_W + px;
            out[i >> 3] &= (uint8_t)~(0x80 >> (i & 7));
        }
    }
}

void epd_init(void) {
    gpio_config_t out = {
        .mode = GPIO_MODE_OUTPUT,
        .pin_bit_mask = (1ULL << EPD_RST_PIN) | (1ULL << EPD_DC_PIN) | (1ULL << EPD_CS_PIN),
        .pull_up_en = GPIO_PULLUP_ENABLE,
    };
    gpio_config_t in = {
        .mode = GPIO_MODE_INPUT,
        .pin_bit_mask = 1ULL << EPD_BUSY_PIN,
        .pull_up_en = GPIO_PULLUP_ENABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&out));
    ESP_ERROR_CHECK(gpio_config(&in));
    /* The published example leaves CS selected (driven low) for the session. */
    gpio_set_level(EPD_CS_PIN, 0);
    spi_bus_config_t bus = {
        .mosi_io_num = EPD_MOSI_PIN,
        .miso_io_num = -1,
        .sclk_io_num = EPD_SCLK_PIN,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = 65536,
    };
    spi_device_interface_config_t dev = {
        .spics_io_num = -1,
        .clock_speed_hz = 20 * 1000 * 1000,
        .mode = 0,
        .queue_size = 1,
    };
    ESP_ERROR_CHECK(spi_bus_initialize(SPI3_HOST, &bus, SPI_DMA_CH_AUTO));
    ESP_ERROR_CHECK(spi_bus_add_device(SPI3_HOST, &dev, &spi));
    hw_init();
}

void epd_present(const uint8_t *portrait, int full) {
    /* BUSY stays high while the panel is updating. Do not start another refresh until it drops. */
    wait_idle();
    size_t n = (size_t)EPD_NATIVE_W * EPD_NATIVE_H / 8;
    uint8_t *image = heap_caps_malloc(n, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!image) image = malloc(n);
    if (!image) return;
    pack_mono(portrait, image);
    if (full) {
        /* Back from a partial series, EPD_Init again so 0xF7 runs from the full-refresh border. */
        if (in_partial) hw_init();
        cmd(0x24);
        dat_buf(image, n);
        cmd(0x26);
        dat_buf(image, n);
        turn_on(MOTE_TURN_BASE);
        init_partial();
    } else {
        if (!in_partial) init_partial();
        set_full_window();
        cmd(0x24);
        dat_buf(image, n);
        turn_on(MOTE_TURN_PART);
    }
    free(image);
}

void epd_sleep(void) {
    gpio_set_level(EPD_CS_PIN, 0);
    cmd(0x10);
    dat(0x01);
    vTaskDelay(pdMS_TO_TICKS(10));
    gpio_set_level(EPD_RST_PIN, 0);
    gpio_set_level(EPD_CS_PIN, 0);
    gpio_set_level(EPD_DC_PIN, 0);
}
