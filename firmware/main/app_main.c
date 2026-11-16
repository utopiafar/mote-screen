#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "board.h"
#include "cJSON.h"
#include "driver/gpio.h"
#include "epd.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "link.h"
#include "mote_logic.h"
#include "nvs_flash.h"
#include "ui.h"

static const char *TAG = "app";

static mote_nav_t nav;
static mote_speed_view_t speed;
static mote_card_view_t cards[8];
static int card_count;
static mote_status_view_t status_view;
static int partials;
static int ms_since_full;
static int content_seq;
static int last_seq = -1;
static char picture[192];
static bool partial_on_change = true;
static int full_every_n = 10;
static int full_every_min = 10;
static bool bluetooth;

static void buttons_init(void) {
    gpio_config_t cfg = {
        .pin_bit_mask = (1ULL << PIN_WHEEL_UP) | (1ULL << PIN_WHEEL_PRESS) | (1ULL << PIN_WHEEL_DOWN) | (1ULL << PIN_BOOT),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&cfg);
}

static int pressed(int pin, int *held) {
    int down = gpio_get_level(pin) == 0;
    if (down && !*held) {
        *held = 1;
        return 1;
    }
    if (!down) *held = 0;
    return 0;
}

static int pending_count(void) {
    int n = 0;
    for (int i = 0; i < card_count; i++) if (strcmp(cards[i].kind, "permission") == 0) n++;
    return n;
}

static void clock_now(void) {
    time_t t = time(NULL);
    struct tm tm;
    localtime_r(&t, &tm);
    snprintf(status_view.clock, sizeof status_view.clock, "%02d:%02d", tm.tm_hour, tm.tm_min);
}

static void apply_line(const char *line) {
    cJSON *root = cJSON_Parse(line);
    if (!root) return;
    cJSON *ver = cJSON_GetObjectItem(root, "v");
    cJSON *type = cJSON_GetObjectItem(root, "type");
    if (!cJSON_IsNumber(ver) || ver->valuedouble != 1 || !cJSON_IsString(type)) {
        cJSON_Delete(root);
        return;
    }
    if (strcmp(type->valuestring, "config") == 0) {
        cJSON *link = cJSON_GetObjectItem(root, "link");
        bluetooth = cJSON_IsString(link) && strcmp(link->valuestring, "bluetooth") == 0;
        partial_on_change = !cJSON_IsFalse(cJSON_GetObjectItem(root, "partialOnChange"));
        cJSON *n = cJSON_GetObjectItem(root, "fullEveryN");
        cJSON *m = cJSON_GetObjectItem(root, "fullEveryMin");
        if (cJSON_IsNumber(n)) full_every_n = n->valueint;
        if (cJSON_IsNumber(m)) full_every_min = m->valueint;
        snprintf(status_view.link, sizeof status_view.link, "%s", bluetooth ? "蓝牙" : "Wi-Fi");
        if (partial_on_change) snprintf(status_view.refresh, sizeof status_view.refresh, "局部 · 每 %d 次", full_every_n);
        else snprintf(status_view.refresh, sizeof status_view.refresh, "完整 · 每 %d 分钟", full_every_min);
        mote_link_apply_radios(bluetooth);
        snprintf(status_view.eink, sizeof status_view.eink, "已连接");
    } else if (strcmp(type->valuestring, "wifi") == 0) {
        cJSON *ssid = cJSON_GetObjectItem(root, "ssid");
        cJSON *password = cJSON_GetObjectItem(root, "password");
        if (cJSON_IsString(ssid)) mote_link_note_wifi(ssid->valuestring, cJSON_IsString(password) ? password->valuestring : "");
    } else if (strcmp(type->valuestring, "speed") == 0) {
        cJSON *phase = cJSON_GetObjectItem(root, "phase");
        cJSON *tok = cJSON_GetObjectItem(root, "outputTokS");
        cJSON *sessions = cJSON_GetObjectItem(root, "sessions");
        snprintf(speed.phase, sizeof speed.phase, "%s", cJSON_IsString(phase) ? phase->valuestring : "idle");
        speed.tok = cJSON_IsNumber(tok) ? (float)tok->valuedouble : 0;
        speed.active = speed.generating = speed.tools = 0;
        if (cJSON_IsObject(sessions)) {
            cJSON *a = cJSON_GetObjectItem(sessions, "active");
            cJSON *g = cJSON_GetObjectItem(sessions, "generating");
            cJSON *t = cJSON_GetObjectItem(sessions, "tools");
            if (cJSON_IsNumber(a)) speed.active = a->valueint;
            if (cJSON_IsNumber(g)) speed.generating = g->valueint;
            if (cJSON_IsNumber(t)) speed.tools = t->valueint;
        }
        speed.history_len = 0;
        cJSON *history = cJSON_GetObjectItem(root, "history");
        if (cJSON_IsArray(history)) {
            cJSON *pt;
            cJSON_ArrayForEach(pt, history) {
                if (speed.history_len < 60 && cJSON_IsNumber(pt)) speed.history[speed.history_len++] = (float)pt->valuedouble;
            }
        }
        speed.source_count = 0;
        cJSON *sources = cJSON_GetObjectItem(root, "sources");
        if (cJSON_IsArray(sources)) {
            cJSON *src;
            cJSON_ArrayForEach(src, sources) {
                if (speed.source_count >= 4) break;
                cJSON *name = cJSON_GetObjectItem(src, "name");
                cJSON *st = cJSON_GetObjectItem(src, "outputTokS");
                snprintf(speed.source_name[speed.source_count], 24, "%s", cJSON_IsString(name) ? name->valuestring : "");
                speed.source_tok[speed.source_count] = cJSON_IsNumber(st) ? (float)st->valuedouble : 0;
                speed.source_count++;
            }
        }
        content_seq++;
        snprintf(status_view.speed, sizeof status_view.speed, "已连接");
        snprintf(status_view.eink, sizeof status_view.eink, "已连接");
    } else if (strcmp(type->valuestring, "inbox") == 0) {
        card_count = 0;
        cJSON *items = cJSON_GetObjectItem(root, "items");
        if (cJSON_IsArray(items)) {
            cJSON *item;
            cJSON_ArrayForEach(item, items) {
                if (card_count >= 8) break;
                cJSON *kind = cJSON_GetObjectItem(item, "kind");
                cJSON *source = cJSON_GetObjectItem(item, "source");
                if (cJSON_IsString(source) && strcmp(source->valuestring, "codex") != 0) continue;
                if (!cJSON_IsString(kind)) continue;
                if (strcmp(kind->valuestring, "permission") != 0 && strcmp(kind->valuestring, "stop") != 0) continue;
                snprintf(cards[card_count].kind, sizeof cards[card_count].kind, "%s", kind->valuestring);
                cJSON *title = cJSON_GetObjectItem(item, "title");
                cJSON *project = cJSON_GetObjectItem(item, "project");
                snprintf(cards[card_count].title, sizeof cards[card_count].title, "%s", cJSON_IsString(title) ? title->valuestring : "");
                snprintf(cards[card_count].project, sizeof cards[card_count].project, "%s", cJSON_IsString(project) ? project->valuestring : "");
                snprintf(cards[card_count].wait, sizeof cards[card_count].wait, "%s", "");
                card_count++;
            }
        }
        content_seq++;
        snprintf(status_view.hook, sizeof status_view.hook, "已安装");
        snprintf(status_view.eink, sizeof status_view.eink, "已连接");
    } else if (strcmp(type->valuestring, "hello") == 0) {
        snprintf(status_view.eink, sizeof status_view.eink, "已连接");
    }
    cJSON_Delete(root);
}

static void present(int force) {
    clock_now();
    char key[160];
    snprintf(key, sizeof key, "%d.%d.%d.%d|%s|%.1f|%d|%s|%s",
             (int)nav.view, nav.home_sel, nav.ov_sel, nav.inbox_sel,
             speed.phase, speed.tok, card_count, status_view.clock, status_view.refresh);
    int changed = strcmp(key, picture) != 0 || content_seq != last_seq;
    mote_refresh_t kind = mote_decide_refresh(partial_on_change, full_every_n, full_every_min, changed || force, partials, ms_since_full);
    if (kind == MOTE_REFRESH_NONE && !force) return;
    int full = force || kind == MOTE_REFRESH_FULL;
    static uint8_t *fb;
    if (!fb) {
        fb = heap_caps_malloc(MOTE_UI_BYTES, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
        if (!fb) fb = malloc(MOTE_UI_BYTES);
    }
    if (!fb) return;
    mote_ui_render(fb, &nav, &speed, cards, card_count, pending_count(), &status_view);
    epd_present(fb, full);
    if (full) {
        partials = 0;
        ms_since_full = 0;
    } else if (kind == MOTE_REFRESH_PARTIAL) {
        partials++;
    }
    snprintf(picture, sizeof picture, "%s", key);
    last_seq = content_seq;
    ESP_LOGI(TAG, "refresh %s", full ? "full" : "partial");
}

void app_main(void) {
    esp_err_t nvs = nvs_flash_init();
    if (nvs == ESP_ERR_NVS_NO_FREE_PAGES || nvs == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        nvs_flash_erase();
        nvs_flash_init();
    }
    mote_nav_init(&nav);
    snprintf(speed.phase, sizeof speed.phase, "idle");
    snprintf(status_view.eink, sizeof status_view.eink, "未连接");
    snprintf(status_view.speed, sizeof status_view.speed, "未连接");
    snprintf(status_view.hook, sizeof status_view.hook, "未安装");
    snprintf(status_view.link, sizeof status_view.link, "Wi-Fi");
    snprintf(status_view.refresh, sizeof status_view.refresh, "局部 · 每 10 次");
    snprintf(status_view.clock, sizeof status_view.clock, "--:--");
    buttons_init();
    epd_init();
    mote_link_start();
    present(1);
    int held[4] = {0};
    int tick = 0;
    char line[1024];
    for (;;) {
        if (pressed(PIN_WHEEL_UP, &held[0])) mote_nav_wheel(&nav, -1, card_count, pending_count());
        if (pressed(PIN_WHEEL_DOWN, &held[1])) mote_nav_wheel(&nav, 1, card_count, pending_count());
        if (pressed(PIN_WHEEL_PRESS, &held[2])) mote_nav_press(&nav, card_count, pending_count());
        if (pressed(PIN_BOOT, &held[3])) mote_nav_boot(&nav);
        while (mote_link_take(line, sizeof line)) apply_line(line);
        tick++;
        ms_since_full += 20;
        if (tick % 5 == 0) present(0);
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}
