#include "ui.h"

#include <stdio.h>
#include <string.h>

int main(void) {
    static uint8_t fb[MOTE_UI_BYTES];
    mote_nav_t nav;
    mote_nav_init(&nav);
    mote_speed_view_t speed;
    memset(&speed, 0, sizeof speed);
    snprintf(speed.phase, sizeof speed.phase, "generating");
    speed.tok = 75.9f;
    speed.active = 3;
    mote_status_view_t status;
    memset(&status, 0, sizeof status);
    snprintf(status.clock, sizeof status.clock, "11:57");
    snprintf(status.eink, sizeof status.eink, "已连接");
    snprintf(status.link, sizeof status.link, "Wi-Fi");
    snprintf(status.refresh, sizeof status.refresh, "局部 · 每 10 次");
    mote_ui_render(fb, &nav, &speed, NULL, 0, 0, &status);
    int ink = 0;
    for (int i = 0; i < MOTE_UI_BYTES; i++) if (fb[i] != 0xFF) ink++;
    if (ink < 200) {
        fprintf(stderr, "home drew too little ink: %d\n", ink);
        return 1;
    }
    nav.view = MOTE_VIEW_SETTINGS;
    mote_ui_render(fb, &nav, &speed, NULL, 0, 0, &status);
    int settings_ink = 0;
    for (int i = 0; i < MOTE_UI_BYTES; i++) if (fb[i] != 0xFF) settings_ink++;
    if (settings_ink < 100) {
        fprintf(stderr, "settings drew too little ink: %d\n", settings_ink);
        return 1;
    }
    printf("ui ink home=%d settings=%d\n", ink, settings_ink);
    return 0;
}
