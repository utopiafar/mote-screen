#include "link.h"

#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "driver/usb_serial_jtag.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "host/ble_hs.h"
#include "host/ble_uuid.h"
#include "host/util/util.h"
#include "lwip/sockets.h"
#include "mdns.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "nvs_flash.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"

/* BLE GATT here is our firmware's channel. The factory Dolphink image is not
 * assumed to speak this service. */

static const char *TAG = "link";
static QueueHandle_t lines;
static int ble_on = 1;
static int ble_synced;
static int wifi_started;
static int usb_ready;
static int reply_fd = -1;
static uint8_t own_addr_type;
static uint16_t notify_handle;
static uint16_t conn_handle = BLE_HS_CONN_HANDLE_NONE;

static void reply_line(const char *text) {
    if (reply_fd >= 0) send(reply_fd, text, strlen(text), 0);
    if (usb_ready) usb_serial_jtag_write_bytes(text, strlen(text), pdMS_TO_TICKS(20));
    if (ble_synced && notify_handle && conn_handle != BLE_HS_CONN_HANDLE_NONE) {
        struct os_mbuf *om = ble_hs_mbuf_from_flat(text, strlen(text));
        if (om) ble_gatts_notify_custom(conn_handle, notify_handle, om);
    }
}

static void push_line(const char *text) {
    if (!lines || !text || !text[0]) return;
    cJSON *root = cJSON_Parse(text);
    cJSON *ver = root ? cJSON_GetObjectItem(root, "v") : NULL;
    int ok = root && cJSON_IsNumber(ver) && ver->valueint == 1;
    cJSON_Delete(root);
    if (!ok) {
        reply_line("{\"v\":1,\"type\":\"error\",\"error\":\"unsupportedVersion\"}\n");
        return;
    }
    char copy[1024];
    snprintf(copy, sizeof copy, "%s", text);
    xQueueSend(lines, copy, 0);
}

static void consume(const uint8_t *data, int len, char *acc, int *used) {
    for (int i = 0; i < len; i++) {
        char ch = (char)data[i];
        if (ch == '\n' || ch == '\r') {
            if (*used > 0) {
                acc[*used] = 0;
                push_line(acc);
                *used = 0;
            }
            continue;
        }
        if (*used < 1023) acc[(*used)++] = ch;
    }
}

static void advertise(void);

static int gap_event(struct ble_gap_event *event, void *arg) {
    (void)arg;
    if (event->type == BLE_GAP_EVENT_CONNECT) {
        if (event->connect.status == 0) conn_handle = event->connect.conn_handle;
        else if (ble_on) advertise();
    } else if (event->type == BLE_GAP_EVENT_DISCONNECT) {
        conn_handle = BLE_HS_CONN_HANDLE_NONE;
        if (ble_on) advertise();
    }
    return 0;
}

static int gatt_write(uint16_t conn, uint16_t attr_handle, struct ble_gatt_access_ctxt *ctxt, void *arg) {
    (void)attr_handle;
    (void)arg;
    conn_handle = conn;
    static char acc[1024];
    static int used;
    if (ctxt->op != BLE_GATT_ACCESS_OP_WRITE_CHR) return 0;
    uint16_t len = OS_MBUF_PKTLEN(ctxt->om);
    uint8_t buf[256];
    if (len > sizeof buf) len = sizeof buf;
    ble_hs_mbuf_to_flat(ctxt->om, buf, len, NULL);
    consume(buf, len, acc, &used);
    return 0;
}

static const ble_uuid128_t uuid_svc = BLE_UUID128_INIT(0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x6e, 0x65, 0x65, 0x72, 0x63, 0x73, 0x65, 0x74, 0x6f, 0x6d);
static const ble_uuid128_t uuid_rx = BLE_UUID128_INIT(0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x6e, 0x65, 0x65, 0x72, 0x63, 0x73, 0x65, 0x74, 0x6f, 0x6d);
static const ble_uuid128_t uuid_tx = BLE_UUID128_INIT(0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x6e, 0x65, 0x65, 0x72, 0x63, 0x73, 0x65, 0x74, 0x6f, 0x6d);

static const struct ble_gatt_svc_def svcs[] = {
    {
        .type = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid = &uuid_svc.u,
        .characteristics = (struct ble_gatt_chr_def[]) {
            {
                .uuid = &uuid_rx.u,
                .access_cb = gatt_write,
                .flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_NO_RSP,
            },
            {
                .uuid = &uuid_tx.u,
                .access_cb = gatt_write,
                .val_handle = &notify_handle,
                .flags = BLE_GATT_CHR_F_NOTIFY,
            },
            {0},
        },
    },
    {0},
};

static void advertise(void) {
    struct ble_hs_adv_fields fields = {0};
    fields.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
    fields.uuids128 = &uuid_svc;
    fields.num_uuids128 = 1;
    fields.uuids128_is_complete = 1;
    ble_gap_adv_set_fields(&fields);
    struct ble_hs_adv_fields response = {0};
    response.name = (uint8_t *)"mote-screen";
    response.name_len = 11;
    response.name_is_complete = 1;
    ble_gap_adv_rsp_set_fields(&response);
    struct ble_gap_adv_params adv = {0};
    adv.conn_mode = BLE_GAP_CONN_MODE_UND;
    adv.disc_mode = BLE_GAP_DISC_MODE_GEN;
    ble_gap_adv_start(own_addr_type, NULL, BLE_HS_FOREVER, &adv, gap_event, NULL);
}

static void on_sync(void) {
    ble_synced = 1;
    ble_hs_id_infer_auto(0, &own_addr_type);
    ble_svc_gap_device_name_set("mote-screen");
    if (ble_on) advertise();
}

static void host_task(void *arg) {
    (void)arg;
    nimble_port_run();
    nimble_port_freertos_deinit();
}

static void start_ble(void) {
    ESP_ERROR_CHECK(nimble_port_init());
    ble_svc_gap_init();
    ble_svc_gatt_init();
    ble_gatts_count_cfg(svcs);
    ble_gatts_add_svcs(svcs);
    ble_hs_cfg.sync_cb = on_sync;
    nimble_port_freertos_init(host_task);
}

static void copy_cred(uint8_t *dst, size_t cap, const char *src) {
    size_t n = 0;
    if (src) {
        while (src[n] && n + 1 < cap) {
            dst[n] = (uint8_t)src[n];
            n++;
        }
    }
    if (n < cap) dst[n] = 0;
}

static void remember_wifi(const char *ssid, const char *password) {
    nvs_handle_t nvs;
    if (nvs_open("mote", NVS_READWRITE, &nvs) != ESP_OK) return;
    nvs_set_str(nvs, "ssid", ssid);
    nvs_set_str(nvs, "pass", password ? password : "");
    nvs_commit(nvs);
    nvs_close(nvs);
    wifi_config_t cfg = {0};
    copy_cred(cfg.sta.ssid, sizeof cfg.sta.ssid, ssid);
    copy_cred(cfg.sta.password, sizeof cfg.sta.password, password ? password : "");
    esp_wifi_set_config(WIFI_IF_STA, &cfg);
    esp_wifi_connect();
}

static void on_ip(void *arg, esp_event_base_t base, int32_t id, void *data) {
    (void)arg;
    (void)base;
    (void)id;
    (void)data;
    static int mdns_ready;
    if (!mdns_ready) {
        if (mdns_init() != ESP_OK) return;
        mdns_hostname_set("mote-screen");
        mdns_instance_name_set("mote-screen");
        mdns_service_add(NULL, "_motescreen", "_tcp", 7427, NULL, 0);
        mdns_ready = 1;
    }
}

static void tcp_task(void *arg) {
    (void)arg;
    int srv = socket(AF_INET, SOCK_STREAM, IPPROTO_IP);
    struct sockaddr_in addr = {.sin_family = AF_INET, .sin_port = htons(7427), .sin_addr.s_addr = htonl(INADDR_ANY)};
    int yes = 1;
    setsockopt(srv, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof yes);
    bind(srv, (struct sockaddr *)&addr, sizeof addr);
    listen(srv, 1);
    char acc[1024];
    const char *hello = "{\"v\":1,\"type\":\"hello\",\"role\":\"device\"}\n";
    for (;;) {
        int client = accept(srv, NULL, NULL);
        if (client < 0) continue;
        reply_fd = client;
        send(client, hello, strlen(hello), 0);
        int used = 0;
        uint8_t buf[256];
        int n;
        while ((n = recv(client, buf, sizeof buf, 0)) > 0) consume(buf, n, acc, &used);
        reply_fd = -1;
        close(client);
    }
}

static void start_wifi(void) {
    esp_netif_init();
    esp_event_loop_create_default();
    esp_netif_create_default_wifi_sta();
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    esp_wifi_init(&cfg);
    esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_ip, NULL);
    esp_wifi_set_mode(WIFI_MODE_STA);
    nvs_handle_t nvs;
    char ssid[33] = {0};
    char pass[65] = {0};
    size_t ssid_len = sizeof ssid, pass_len = sizeof pass;
    if (nvs_open("mote", NVS_READONLY, &nvs) == ESP_OK) {
        nvs_get_str(nvs, "ssid", ssid, &ssid_len);
        nvs_get_str(nvs, "pass", pass, &pass_len);
        nvs_close(nvs);
    }
    if (ssid[0]) {
        wifi_config_t sta = {0};
        copy_cred(sta.sta.ssid, sizeof sta.sta.ssid, ssid);
        copy_cred(sta.sta.password, sizeof sta.sta.password, pass);
        esp_wifi_set_config(WIFI_IF_STA, &sta);
    }
    esp_wifi_start();
    wifi_started = 1;
    if (ssid[0]) esp_wifi_connect();
    xTaskCreate(tcp_task, "tcp", 6144, NULL, 5, NULL);
}

static void usb_task(void *arg) {
    (void)arg;
    usb_serial_jtag_driver_config_t cfg = {.rx_buffer_size = 1024, .tx_buffer_size = 256};
    if (usb_serial_jtag_driver_install(&cfg) != ESP_OK) {
        ESP_LOGW(TAG, "usb serial busy");
        vTaskDelete(NULL);
        return;
    }
    usb_ready = 1;
    char acc[1024];
    int used = 0;
    uint8_t buf[128];
    for (;;) {
        int n = usb_serial_jtag_read_bytes(buf, sizeof buf, pdMS_TO_TICKS(200));
        if (n > 0) consume(buf, n, acc, &used);
    }
}

void mote_link_start(void) {
    lines = xQueueCreate(8, 1024);
    start_wifi();
    start_ble();
    xTaskCreate(usb_task, "usb", 4096, NULL, 4, NULL);
}

int mote_link_take(char *out, int cap) {
    char copy[1024];
    if (!lines || xQueueReceive(lines, copy, 0) != pdTRUE) return 0;
    snprintf(out, cap, "%s", copy);
    return 1;
}

void mote_link_apply_radios(int bluetooth) {
    ble_on = bluetooth;
    if (bluetooth) {
        if (wifi_started) esp_wifi_stop();
        if (ble_synced) advertise();
    } else {
        if (ble_synced) ble_gap_adv_stop();
        if (wifi_started) {
            esp_wifi_start();
            esp_wifi_connect();
        }
    }
}

void mote_link_note_wifi(const char *ssid, const char *password) {
    if (!ssid || !ssid[0]) return;
    remember_wifi(ssid, password);
}
