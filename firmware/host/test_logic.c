#include "mote_logic.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int fail = 0;

static void expect_str(const char *name, const char *got, const char *want) {
    if (strcmp(got, want) != 0) {
        fprintf(stderr, "%s: got %s want %s\n", name, got, want);
        fail = 1;
    }
}

static void expect_int(const char *name, int got, int want) {
    if (got != want) {
        fprintf(stderr, "%s: got %d want %d\n", name, got, want);
        fail = 1;
    }
}

static void menu_cases(void) {
    expect_str("setup", mote_menu_status(true, false, false, "未安装"), "设置中");
    expect_str("broken", mote_menu_status(false, true, true, "已失效"), "Hook 失效");
    expect_str("broken-wins", mote_menu_status(true, true, true, "已失效"), "Hook 失效");
    expect_str("skip", mote_menu_status(false, true, false, "已安装"), "未连接");
    expect_str("ok", mote_menu_status(false, true, true, "已安装"), "已连接");
    expect_str("removed", mote_menu_status(false, true, true, "已移除"), "未连接");
}

static void push_cases(void) {
    expect_int("inbox", mote_ms_until_push(15, 60, "generating", true, 0, 0), 0);
    expect_int("gen0", mote_ms_until_push(15, 60, "generating", false, 0, 0), 15000);
    expect_int("tools", mote_ms_until_push(15, 60, "tools", false, 0, 5000), 10000);
    expect_int("idle", mote_ms_until_push(15, 60, "idle", false, 0, 30000), 30000);
    expect_int("idle-due", mote_ms_until_push(15, 60, "idle", false, 0, 60000), 0);
}

static void refresh_cases(void) {
    expect_int("partial", mote_decide_refresh(true, 10, 10, true, 0, 0), MOTE_REFRESH_PARTIAL);
    expect_int("still", mote_decide_refresh(true, 10, 10, true, 9, 0), MOTE_REFRESH_PARTIAL);
    expect_int("count", mote_decide_refresh(true, 10, 10, true, 10, 0), MOTE_REFRESH_FULL);
    expect_int("quiet", mote_decide_refresh(true, 10, 10, false, 0, 599999), MOTE_REFRESH_NONE);
    expect_int("time", mote_decide_refresh(true, 10, 10, false, 0, 600000), MOTE_REFRESH_FULL);
    expect_int("off", mote_decide_refresh(false, 10, 10, true, 0, 0), MOTE_REFRESH_FULL);
}

static void pipe_cases(void) {
    expect_int("wifi", mote_active_transport(false, true, false), MOTE_PIPE_WIFI);
    expect_int("usb", mote_active_transport(true, true, true), MOTE_PIPE_USB);
    expect_int("ble", mote_active_transport(true, true, false), MOTE_PIPE_BLUETOOTH);
    expect_int("stay", mote_active_transport(false, false, true), MOTE_PIPE_WIFI);
}

static void nav_cases(void) {
    mote_nav_t nav;
    mote_nav_init(&nav);
    mote_nav_wheel(&nav, 1, 3, 2);
    mote_nav_wheel(&nav, 1, 3, 2);
    mote_nav_wheel(&nav, 1, 3, 2);
    expect_int("reserved-sel", nav.home_sel, 3);
    mote_nav_press(&nav, 3, 2);
    expect_int("reserved-stays", nav.view, MOTE_VIEW_HOME);
    mote_nav_wheel(&nav, 1, 3, 2);
    expect_int("back-to-work", nav.home_sel, 0);
    mote_nav_press(&nav, 3, 2);
    expect_int("overview", nav.view, MOTE_VIEW_OVERVIEW);
    expect_int("card", nav.ov_sel, 1);
    mote_nav_press(&nav, 3, 2);
    expect_int("inbox", nav.view, MOTE_VIEW_INBOX);
    mote_nav_boot(&nav);
    expect_int("back-overview", nav.view, MOTE_VIEW_OVERVIEW);
    mote_nav_boot(&nav);
    expect_int("desk", nav.view, MOTE_VIEW_HOME);
}

int main(void) {
    menu_cases();
    push_cases();
    refresh_cases();
    pipe_cases();
    nav_cases();
    if (fail) return 1;
    puts("mote_logic ok");
    return 0;
}
