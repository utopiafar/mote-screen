#ifndef MOTE_UI_HEADER
#define MOTE_UI_HEADER

#include <stdint.h>

#include "mote_logic.h"

#define MOTE_UI_W 480
#define MOTE_UI_H 800
#define MOTE_UI_BYTES (MOTE_UI_W * MOTE_UI_H / 4)

typedef struct {
    char phase[16];
    float tok;
    int active;
    int generating;
    int tools;
    char source_name[4][24];
    float source_tok[4];
    int source_count;
    float history[60];
    int history_len;
} mote_speed_view_t;

typedef struct {
    char kind[16];
    char title[56];
    char project[40];
    char wait[24];
} mote_card_view_t;

typedef struct {
    char eink[16];
    char speed[16];
    char hook[16];
    char link[16];
    char refresh[32];
    char clock[8];
} mote_status_view_t;

void mote_fb_clear(uint8_t *fb, int level);
void mote_ui_render(uint8_t *fb, const mote_nav_t *nav, const mote_speed_view_t *speed,
                    const mote_card_view_t *cards, int card_count, int pending_count,
                    const mote_status_view_t *status);

#endif /* MOTE_UI_HEADER */
