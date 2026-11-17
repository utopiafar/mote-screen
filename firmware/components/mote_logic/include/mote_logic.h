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

/* Published 1-bit turn-on bytes from the Waveshare 3.97 driver and the
 * xiaozhi board driver. 4-gray turn-on is 0xD7 and is not used for this UI. */
#define MOTE_TURN_BASE 0xF7
#define MOTE_TURN_PART 0xFF

/* Command order for one present. The partial path does not hardware-reset:
 * EPD_Init_Partial's reset returns the controller to POR and drops the
 * previous frame stored in 0x26. After 0xFF the same frame is written to
 * 0x26 with no second 0x20, the RAM write already used by Display_Base. */
typedef enum {
    MOTE_PRESENT_FULL_INIT = 1,
    MOTE_PRESENT_PARTIAL_PREFIX,
    MOTE_PRESENT_WINDOW,
    MOTE_PRESENT_RAM_NEW,
    MOTE_PRESENT_RAM_OLD,
    MOTE_PRESENT_TURN_BASE,
    MOTE_PRESENT_TURN_PART
} mote_present_step_t;

const char *mote_menu_status(bool setup, bool speed, bool eink, const char *hook);
int mote_ms_until_push(int push_generating_sec, int push_idle_sec, const char *phase, bool inbox_dirty, int last_push_ms, int now_ms);
/* view_changed is a page turn. That stays on the partial waveform.
 * partial_on_change only applies to later updates on the same page.
 * full_every_n and full_every_min are off at 0. A positive count or minute
 * interval can still request the base waveform, plus a forced first paint. */
mote_refresh_t mote_decide_refresh(bool partial_on_change, int full_every_n, int full_every_min, bool content_changed, int partials_since_full, int ms_since_full, bool view_changed);
int mote_turn_on_data(mote_refresh_t kind);
int mote_use_base(int force, mote_refresh_t kind);
/* full selects Display_Base. in_partial means a partial series is already
 * running, so a later base refresh must EPD_Init first (border 0x01).
 * Returns how many steps were written, or 0 if out is too small. */
int mote_present_steps(int full, int in_partial, mote_present_step_t *out, int cap);
mote_pipe_t mote_active_transport(bool bluetooth, bool usb_fallback, bool usb_plugged);

void mote_nav_init(mote_nav_t *nav);
void mote_nav_wheel(mote_nav_t *nav, int dir, int inbox_len, int pending_len);
void mote_nav_press(mote_nav_t *nav, int inbox_len, int pending_len);
void mote_nav_boot(mote_nav_t *nav);

#endif
