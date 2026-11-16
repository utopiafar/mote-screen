#include "mote_logic.h"

#include <string.h>

const char *mote_menu_status(bool setup, bool speed, bool eink, const char *hook) {
    if (hook && strcmp(hook, "已失效") == 0) return "Hook 失效";
    if (setup) return "设置中";
    if (speed && eink && hook && strcmp(hook, "已安装") == 0) return "已连接";
    return "未连接";
}

int mote_ms_until_push(int push_generating_sec, int push_idle_sec, const char *phase, bool inbox_dirty, int last_push_ms, int now_ms) {
    if (inbox_dirty) return 0;
    int interval = (phase && strcmp(phase, "idle") == 0) ? push_idle_sec : push_generating_sec;
    int elapsed = now_ms - last_push_ms;
    if (elapsed < 0) elapsed = 0;
    int wait = interval * 1000 - elapsed;
    return wait > 0 ? wait : 0;
}

mote_refresh_t mote_decide_refresh(bool partial_on_change, int full_every_n, int full_every_min, bool content_changed, int partials_since_full, int ms_since_full, bool view_changed) {
    if (view_changed) return MOTE_REFRESH_FULL;
    bool time_due = full_every_min > 0 && ms_since_full >= full_every_min * 60 * 1000;
    bool count_due = partials_since_full >= full_every_n;
    if (!content_changed && !time_due) return MOTE_REFRESH_NONE;
    if (time_due || count_due || !partial_on_change) return MOTE_REFRESH_FULL;
    return MOTE_REFRESH_PARTIAL;
}

mote_pipe_t mote_active_transport(bool bluetooth, bool usb_fallback, bool usb_plugged) {
    if (usb_fallback && usb_plugged) return MOTE_PIPE_USB;
    return bluetooth ? MOTE_PIPE_BLUETOOTH : MOTE_PIPE_WIFI;
}

void mote_nav_init(mote_nav_t *nav) {
    nav->view = MOTE_VIEW_HOME;
    nav->home_sel = 0;
    nav->ov_sel = 0;
    nav->inbox_sel = 0;
}

static int pending_preview(int pending_len) {
    if (pending_len < 0) return 0;
    return pending_len > 2 ? 2 : pending_len;
}

void mote_nav_wheel(mote_nav_t *nav, int dir, int inbox_len, int pending_len) {
    if (nav->view == MOTE_VIEW_HOME) {
        nav->home_sel = (nav->home_sel + (dir > 0 ? 1 : 3)) % 4;
        return;
    }
    if (nav->view == MOTE_VIEW_OVERVIEW) {
        int max = pending_preview(pending_len);
        int next = nav->ov_sel + dir;
        if (next < 0) next = 0;
        if (next > max) next = max;
        nav->ov_sel = next;
        return;
    }
    if (nav->view == MOTE_VIEW_INBOX && inbox_len > 0) {
        int next = nav->inbox_sel + dir;
        if (next < 0) next = 0;
        if (next > inbox_len - 1) next = inbox_len - 1;
        nav->inbox_sel = next;
    }
}

void mote_nav_press(mote_nav_t *nav, int inbox_len, int pending_len) {
    (void)inbox_len;
    if (nav->view == MOTE_VIEW_HOME) {
        if (nav->home_sel == 3) return; /* 预留，这一期不开 */
        if (nav->home_sel == 0) {
            nav->view = MOTE_VIEW_OVERVIEW;
            nav->ov_sel = pending_len > 0 ? 1 : 0;
            return;
        }
        if (nav->home_sel == 1) nav->view = MOTE_VIEW_CLOCK;
        if (nav->home_sel == 2) nav->view = MOTE_VIEW_SETTINGS;
        return;
    }
    if (nav->view == MOTE_VIEW_OVERVIEW) {
        if (nav->ov_sel == 0) {
            nav->view = MOTE_VIEW_SPEED;
            return;
        }
        nav->view = MOTE_VIEW_INBOX;
        nav->inbox_sel = nav->ov_sel - 1;
        if (nav->inbox_sel < 0) nav->inbox_sel = 0;
    }
}

void mote_nav_boot(mote_nav_t *nav) {
    if (nav->view == MOTE_VIEW_SPEED || nav->view == MOTE_VIEW_INBOX) {
        nav->view = MOTE_VIEW_OVERVIEW;
        return;
    }
    if (nav->view != MOTE_VIEW_HOME) {
        if (nav->view == MOTE_VIEW_OVERVIEW) nav->home_sel = 0;
        nav->view = MOTE_VIEW_HOME;
    }
}
