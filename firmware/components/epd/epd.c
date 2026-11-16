#include "epd.h"

#include "board.h"
#include "ui.h"

#include <stdlib.h>
#include <string.h>

#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

/* Command bytes follow the public Waveshare ESP-IDF example
 * ESP-IDF/01_E-Paper_Example/components/epaper_port/epaper_port.c
 * for this panel (SSD1677, 800×480). They are not new waveforms.
 */

static const char *TAG = "epd";
static spi_device_handle_t spi;
static int gray_ready;

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

static void window_full(void) {
    cmd(0x01);
    dat((EPD_NATIVE_H - 1) % 256);
    dat((EPD_NATIVE_H - 1) / 256);
    dat(0x02);
    cmd(0x11);
    dat(0x01);
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
    wait_idle();
}

static void common_power(void) {
    cmd(0x0C);
    dat(0xAE);
    dat(0xC7);
    dat(0xC3);
    dat(0xC0);
    dat(0x80);
}

static void enter_gray(void) {
    reset_panel();
    wait_idle();
    cmd(0x12);
    wait_idle();
    common_power();
    window_full();
    cmd(0x3C);
    dat(0x01);
    cmd(0x18);
    dat(0x80);
    cmd(0x1A);
    dat(0x5A);
    gray_ready = 1;
}

static void enter_partial(void) {
    reset_panel();
    wait_idle();
    cmd(0x12);
    wait_idle();
    common_power();
    window_full();
    cmd(0x3C);
    dat(0x01);
    cmd(0x18);
    dat(0x80);
    cmd(0x1A);
    dat(0x6A);
    gray_ready = 0;
}

static int portrait_level(const uint8_t *fb, int x, int y) {
    int i = y * MOTE_UI_W + x;
    int shift = (3 - (i & 3)) * 2;
    return (fb[i >> 2] >> shift) & 3;
}

/* Rotate portrait 480×800 onto the panel's 800×480 RAM. */
static void pack_gray(const uint8_t *portrait, uint8_t *out) {
    memset(out, 0xFF, EPD_NATIVE_W * EPD_NATIVE_H / 4);
    for (int y = 0; y < MOTE_UI_H; y++) {
        for (int x = 0; x < MOTE_UI_W; x++) {
            int px = y;
            int py = MOTE_UI_W - 1 - x;
            int level = portrait_level(portrait, x, y);
            int i = py * EPD_NATIVE_W + px;
            int shift = (3 - (i & 3)) * 2;
            out[i >> 2] = (uint8_t)((out[i >> 2] & ~(3 << shift)) | (level << shift));
        }
    }
}

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

static uint8_t gray_plane_byte(uint8_t first, uint8_t second, int old_plane) {
    uint8_t temp3 = 0;
    uint8_t bytes[2] = {first, second};
    for (int j = 0; j < 2; j++) {
        uint8_t temp1 = bytes[j];
        for (int k = 0; k < 2; k++) {
            uint8_t temp2 = temp1 & 0xC0;
            if (!old_plane) {
                if (temp2 == 0x00 || temp2 == 0x80) temp3 |= 0x01;
            } else if (temp2 == 0x00 || temp2 == 0x40) {
                temp3 |= 0x01;
            }
            temp3 <<= 1;
            temp1 <<= 2;
            temp2 = temp1 & 0xC0;
            if (!old_plane) {
                if (temp2 == 0x00 || temp2 == 0x80) temp3 |= 0x01;
            } else if (temp2 == 0x00 || temp2 == 0x40) {
                temp3 |= 0x01;
            }
            if (j != 1 || k != 1) temp3 <<= 1;
            temp1 <<= 2;
        }
    }
    return temp3;
}

/* Plane split matches the public EPD_Display_4Gray for this panel. */
static void write_gray_planes(const uint8_t *image) {
    size_t count = (EPD_NATIVE_W / 8) * EPD_NATIVE_H;
    cmd(0x24);
    for (size_t i = 0; i < count; i++) dat(gray_plane_byte(image[i * 2], image[i * 2 + 1], 0));
    cmd(0x26);
    for (size_t i = 0; i < count; i++) dat(gray_plane_byte(image[i * 2], image[i * 2 + 1], 1));
    cmd(0x22);
    dat(0xD7);
    cmd(0x20);
    wait_idle();
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
}

void epd_present(const uint8_t *portrait, int full) {
    if (full) {
        if (!gray_ready) enter_gray();
        uint8_t *image = heap_caps_malloc(EPD_NATIVE_W * EPD_NATIVE_H / 4, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
        if (!image) image = malloc(EPD_NATIVE_W * EPD_NATIVE_H / 4);
        if (!image) return;
        pack_gray(portrait, image);
        write_gray_planes(image);
        free(image);
    } else {
        if (gray_ready) enter_partial();
        uint8_t *image = heap_caps_malloc(EPD_NATIVE_W * EPD_NATIVE_H / 8, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
        if (!image) image = malloc(EPD_NATIVE_W * EPD_NATIVE_H / 8);
        if (!image) return;
        pack_mono(portrait, image);
        cmd(0x24);
        dat_buf(image, EPD_NATIVE_W * EPD_NATIVE_H / 8);
        cmd(0x22);
        dat(0xFF);
        cmd(0x20);
        wait_idle();
        free(image);
    }
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
