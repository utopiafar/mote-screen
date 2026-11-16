#ifndef MOTE_LOGIC_H
#define MOTE_LOGIC_H

#include <stdbool.h>
#include <stddef.h>

/* Shared with core/status.mjs, core/settings.mjs and core/device.mjs.
 * Strings are the only menu and hook labels the product uses.
 */

#define MOTE_TCP_PORT 7427

typedef enum {
    MOTE_VIEW_HOME = 0,
    MOTE_VIEW_OVERVIEW,
    MOTE_VIEW_SPEED,
    MOTE_VIEW_INBOX,
    MOTE_VIEW_CLOCK,
    MOTE_VIEW_SETTINGS
} mote_view_t;

typedef struct {
    mote_view_t view;
    int home_sel;
    int ov_sel;
    int inbox_sel;
} mote_nav_t;

typedef enum {
    MOTE_REFRESH_NONE = 0,
    MOTE_REFRESH_PARTIAL,
    MOTE_REFRESH_FULL
} mote_refresh_t;

typedef enum {
    MOTE_PIPE_WIFI = 0,
    MOTE_PIPE_BLUETOOTH,
    MOTE_PIPE_USB
} mote_pipe_t;

const char *mote_menu_status(bool setup, bool speed, bool eink, const char *hook);
int mote_ms_until_push(int push_generating_sec, int push_idle_sec, const char *phase, bool inbox_dirty, int last_push_ms, int now_ms);
/* view_changed is a page turn (home, workbench, detail). That is always a full refresh.
 * partial_on_change only applies to later updates on the same page. */
mote_refresh_t mote_decide_refresh(bool partial_on_change, int full_every_n, int full_every_min, bool content_changed, int partials_since_full, int ms_since_full, bool view_changed);
mote_pipe_t mote_active_transport(bool bluetooth, bool usb_fallback, bool usb_plugged);

void mote_nav_init(mote_nav_t *nav);
void mote_nav_wheel(mote_nav_t *nav, int dir, int inbox_len, int pending_len);
void mote_nav_press(mote_nav_t *nav, int inbox_len, int pending_len);
void mote_nav_boot(mote_nav_t *nav);

#endif
