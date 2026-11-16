idf_component_register(
    SRCS "app_main.c" "link.c"
    INCLUDE_DIRS "."
    REQUIRES mote_logic ui epd nvs_flash esp_wifi esp_netif esp_event mdns json bt driver lwip heap
)
