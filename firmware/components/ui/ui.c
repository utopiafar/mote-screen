#include "ui.h"

#include "font_data.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Strikes are 1-bit and already the size on the glass. scale-up is not used. */

static void set_px(uint8_t *fb, int x, int y, int level) {
    if ((unsigned)x >= MOTE_UI_W || (unsigned)y >= MOTE_UI_H) return;
    int i = y * MOTE_UI_W + x;
    int shift = (3 - (i & 3)) * 2;
    fb[i >> 2] = (uint8_t)((fb[i >> 2] & ~(3 << shift)) | ((level & 3) << shift));
}

void mote_fb_clear(uint8_t *fb, int level) {
    uint8_t byte = (uint8_t)((level & 3) * 0x55);
    memset(fb, byte, MOTE_UI_BYTES);
}

static void rect(uint8_t *fb, int x, int y, int w, int h, int level, int fill) {
    for (int yy = y; yy < y + h; yy++) {
        for (int xx = x; xx < x + w; xx++) {
            int edge = xx == x || yy == y || xx == x + w - 1 || yy == y + h - 1;
            if (fill || edge) set_px(fb, xx, yy, level);
        }
    }
}

static void strike_of(int strike, const mote_glyph_t **glyphs, int *count, const uint8_t **bits) {
    switch (strike) {
    case MOTE_STRIKE_BODY:
        *glyphs = mote_font_body;
        *count = MOTE_FONT_BODY_COUNT;
        *bits = mote_font_bits_body;
        break;
    case MOTE_STRIKE_TITLE:
        *glyphs = mote_font_title;
        *count = MOTE_FONT_TITLE_COUNT;
        *bits = mote_font_bits_title;
        break;
    case MOTE_STRIKE_DISPLAY:
        *glyphs = mote_font_display;
        *count = MOTE_FONT_DISPLAY_COUNT;
        *bits = mote_font_bits_display;
        break;
    default:
        *glyphs = mote_font_caption;
        *count = MOTE_FONT_CAPTION_COUNT;
        *bits = mote_font_bits_caption;
        break;
    }
}

static const mote_glyph_t *find_glyph(int strike, uint32_t cp) {
    const mote_glyph_t *glyphs;
    const uint8_t *bits;
    int count;
    strike_of(strike, &glyphs, &count, &bits);
    (void)bits;
    int lo = 0, hi = count - 1;
    while (lo <= hi) {
        int mid = (lo + hi) / 2;
        if (glyphs[mid].cp == cp) return &glyphs[mid];
        if (glyphs[mid].cp < cp) lo = mid + 1;
        else hi = mid - 1;
    }
    return NULL;
}

static uint32_t next_cp(const char **text) {
    const unsigned char *s = (const unsigned char *)*text;
    if (!*s) return 0;
    uint32_t cp;
    int len = 1;
    if (*s < 0x80) cp = *s;
    else if ((*s & 0xE0) == 0xC0) { cp = (*s & 0x1F) << 6 | (s[1] & 0x3F); len = 2; }
    else if ((*s & 0xF0) == 0xE0) { cp = (*s & 0x0F) << 12 | (s[1] & 0x3F) << 6 | (s[2] & 0x3F); len = 3; }
    else { cp = *s; }
    *text += len;
    return cp;
}

static int text_width(const char *text, int strike) {
    int w = 0;
    const char *p = text;
    uint32_t cp;
    while ((cp = next_cp(&p))) {
        const mote_glyph_t *g = find_glyph(strike, cp);
        w += g ? g->adv : 16;
    }
    return w;
}

/* limit > 0 stops before a glyph would start past that x. Ink is black or white, never gray. */
static void text(uint8_t *fb, int x, int y, const char *utf8, int strike, int level, int limit) {
    const mote_glyph_t *glyphs;
    const uint8_t *bits;
    int count;
    strike_of(strike, &glyphs, &count, &bits);
    (void)glyphs;
    const char *p = utf8;
    uint32_t cp;
    while ((cp = next_cp(&p))) {
        const mote_glyph_t *g = find_glyph(strike, cp);
        int adv = g ? g->adv : 16;
        if (limit && x + adv > limit) break;
        if (g && g->w && g->h) {
            for (int yy = 0; yy < g->h; yy++) {
                for (int xx = 0; xx < g->w; xx++) {
                    int bit = yy * g->w + xx;
                    if (bits[g->offset + bit / 8] & (0x80 >> (bit % 8))) set_px(fb, x + xx, y + yy, level);
                }
            }
        }
        x += adv;
    }
}

static void text_right(uint8_t *fb, int right, int y, const char *utf8, int strike, int level) {
    int w = text_width(utf8, strike);
    text(fb, right - w, y, utf8, strike, level, right + 1);
}

static int pending_of(const mote_card_view_t *cards, int count) {
    int n = 0;
    for (int i = 0; i < count; i++) if (strcmp(cards[i].kind, "permission") == 0) n++;
    return n;
}

static void spark(uint8_t *fb, int x, int y, int w, int h, const float *pts, int n) {
    rect(fb, x, y, w, h, 0, 0);
    if (n < 2) return;
    float max = 1;
    for (int i = 0; i < n; i++) if (pts[i] > max) max = pts[i];
    for (int i = 1; i < n; i++) {
        int x0 = x + (i - 1) * (w - 8) / (n - 1) + 4;
        int x1 = x + i * (w - 8) / (n - 1) + 4;
        int y0 = y + h - 4 - (int)(pts[i - 1] / max * (h - 10));
        int y1 = y + h - 4 - (int)(pts[i] / max * (h - 10));
        int steps = abs(x1 - x0) + abs(y1 - y0) + 1;
        for (int s = 0; s <= steps; s++) {
            int xx = x0 + (x1 - x0) * s / steps;
            int yy = y0 + (y1 - y0) * s / steps;
            set_px(fb, xx, yy, 0);
            set_px(fb, xx, yy + 1, 0);
            set_px(fb, xx + 1, yy, 0);
        }
    }
}

static void render_home(uint8_t *fb, const mote_nav_t *nav, const mote_speed_view_t *speed, int pending) {
    const char *names[] = {"工作台", "时钟", "设置", "预留"};
    const char *kick[] = {"APP", "APP", "APP", "空"};
    float tok = strcmp(speed->phase, "idle") == 0 ? 0 : speed->tok;
    char line1[32];
    char line2[32];
    snprintf(line1, sizeof line1, "%.1f tok/s", tok);
    if (pending) snprintf(line2, sizeof line2, "%d 条待处理", pending);
    else snprintf(line2, sizeof line2, "一切安静");
    int gap = 12;
    int x0 = 16;
    int y0 = 68;
    int cell_w = (MOTE_UI_W - x0 * 2 - gap) / 2;
    int cell_h = (732 - y0 - gap) / 2;
    for (int i = 0; i < 4; i++) {
        int col = i % 2, row = i / 2;
        int x = x0 + col * (cell_w + gap);
        int y = y0 + row * (cell_h + gap);
        int sel = nav->home_sel == i;
        rect(fb, x, y, cell_w, cell_h, 0, sel);
        int ink = sel ? 3 : 0;
        text(fb, x + 16, y + 16, kick[i], MOTE_STRIKE_CAPTION, ink, x + cell_w - 8);
        text(fb, x + 16, y + 52, names[i], MOTE_STRIKE_TITLE, ink, x + cell_w - 8);
        if (i == 0 && pending) {
            char badge[8];
            snprintf(badge, sizeof badge, "%d", pending);
            text_right(fb, x + cell_w - 16, y + 18, badge, MOTE_STRIKE_BODY, ink);
        }
        if (i == 0) {
            text(fb, x + 16, y + cell_h - 78, line1, MOTE_STRIKE_CAPTION, ink, x + cell_w - 8);
            text(fb, x + 16, y + cell_h - 42, line2, MOTE_STRIKE_CAPTION, ink, x + cell_w - 8);
        }
        if (i == 3) text(fb, x + 16, y + cell_h - 42, "尚未开放", MOTE_STRIKE_CAPTION, ink, x + cell_w - 8);
    }
}

static void card(uint8_t *fb, int x, int y, int w, const mote_card_view_t *item, int sel, int compact) {
    int h = compact ? 124 : 168;
    int urgent = strcmp(item->kind, "permission") == 0;
    rect(fb, x, y, w, h, 0, urgent);
    if (sel) rect(fb, x - 4, y - 4, w + 8, h + 8, 0, 0);
    int ink = urgent ? 3 : 0;
    text(fb, x + 14, y + 12, urgent ? "等待批准" : "已结束", MOTE_STRIKE_CAPTION, ink, x + w - 12);
    text(fb, x + 14, y + 44, item->title, MOTE_STRIKE_BODY, ink, x + w - 12);
    char meta[64];
    snprintf(meta, sizeof meta, "codex · %s", item->project);
    text(fb, x + 14, y + 88, meta, MOTE_STRIKE_CAPTION, ink, x + w - 12);
    if (!compact) text(fb, x + 14, y + 124, item->wait, MOTE_STRIKE_CAPTION, ink, x + w - 12);
}

static void render_overview(uint8_t *fb, const mote_nav_t *nav, const mote_speed_view_t *speed, const mote_card_view_t *cards, int count) {
    int sel_speed = nav->ov_sel == 0;
    if (sel_speed) rect(fb, 10, 64, 460, 300, 0, 0);
    text(fb, 22, 72, "速度", MOTE_STRIKE_CAPTION, 0, 240);
    text_right(fb, 458, 72, "按下查看详情", MOTE_STRIKE_CAPTION, 0);
    char tok[24];
    float value = strcmp(speed->phase, "idle") == 0 ? 0 : speed->tok;
    snprintf(tok, sizeof tok, "%.1f", value);
    text(fb, 22, 108, tok, MOTE_STRIKE_DISPLAY, 0, 470);
    text(fb, 22 + text_width(tok, MOTE_STRIKE_DISPLAY) + 12, 150, "tok/s", MOTE_STRIKE_CAPTION, 0, 470);
    char phase[64];
    const char *name = strcmp(speed->phase, "tools") == 0 ? "调用工具" : strcmp(speed->phase, "idle") == 0 ? "空闲" : "生成中";
    snprintf(phase, sizeof phase, "%s · %d 个会话在跑", name, speed->active);
    text(fb, 22, 210, phase, MOTE_STRIKE_BODY, 0, 470);
    spark(fb, 22, 258, 436, 90, speed->history, speed->history_len);
    rect(fb, 16, 364, 448, 3, 0, 1);
    int pending = 0;
    for (int i = 0; i < count; i++) if (strcmp(cards[i].kind, "permission") == 0) pending++;
    text(fb, 22, 380, "CODEX 待处理", MOTE_STRIKE_CAPTION, 0, 280);
    if (pending) text_right(fb, 458, 380, "按下查看全部", MOTE_STRIKE_CAPTION, 0);
    int shown = 0;
    for (int i = 0; i < count && shown < 2; i++) {
        if (strcmp(cards[i].kind, "permission") != 0) continue;
        card(fb, 22, 418 + shown * 140, 436, &cards[i], nav->ov_sel == shown + 1, 1);
        shown++;
    }
    if (!shown) {
        text(fb, 22, 460, "一切安静", MOTE_STRIKE_TITLE, 0, 470);
        text(fb, 22, 530, "没有等待批准的 Codex 对话。", MOTE_STRIKE_CAPTION, 0, 470);
    }
}

static void render_speed(uint8_t *fb, const mote_speed_view_t *speed) {
    text(fb, 22, 68, "AGENT SPEED · 本机输出", MOTE_STRIKE_CAPTION, 0, 470);
    char tok[24];
    float value = strcmp(speed->phase, "idle") == 0 ? 0 : speed->tok;
    snprintf(tok, sizeof tok, "%.1f", value);
    text(fb, 22, 104, tok, MOTE_STRIKE_DISPLAY, 0, 470);
    text(fb, 22 + text_width(tok, MOTE_STRIKE_DISPLAY) + 12, 150, "tok/s", MOTE_STRIKE_CAPTION, 0, 470);
    const char *name = strcmp(speed->phase, "tools") == 0 ? "调用工具" : strcmp(speed->phase, "idle") == 0 ? "空闲" : "生成中";
    text(fb, 22, 210, name, MOTE_STRIKE_TITLE, 0, 470);
    const char *labels[] = {"进行中", "正在生成", "调用工具"};
    int values[] = {speed->active, speed->generating, speed->tools};
    for (int i = 0; i < 3; i++) {
        int x = 22 + i * 152;
        rect(fb, x, 276, 140, 108, 0, 0);
        char num[8];
        snprintf(num, sizeof num, "%d", values[i]);
        text(fb, x + 16, 288, num, MOTE_STRIKE_TITLE, 0, x + 128);
        text(fb, x + 12, 348, labels[i], MOTE_STRIKE_CAPTION, 0, x + 132);
    }
    text(fb, 22, 404, "近一分钟", MOTE_STRIKE_CAPTION, 0, 470);
    spark(fb, 22, 436, 436, 96, speed->history, speed->history_len);
    int y = 552;
    for (int i = 0; i < speed->source_count && i < 4; i++) {
        char row[48];
        float tok_s = strcmp(speed->phase, "idle") == 0 ? 0 : speed->source_tok[i];
        snprintf(row, sizeof row, "%s", speed->source_name[i]);
        text(fb, 22, y, row, MOTE_STRIKE_BODY, 0, 280);
        snprintf(row, sizeof row, "%.1f tok/s", tok_s);
        text_right(fb, 458, y, row, MOTE_STRIKE_BODY, 0);
        y += 46;
    }
}

static void render_inbox(uint8_t *fb, const mote_nav_t *nav, const mote_card_view_t *cards, int count, int pending) {
    char head[32];
    if (pending) snprintf(head, sizeof head, "%d 条在等批准", pending);
    else snprintf(head, sizeof head, "暂无等待");
    text(fb, 22, 68, head, MOTE_STRIKE_BODY, 0, 470);
    if (!count) {
        text(fb, 22, 240, "一切安静", MOTE_STRIKE_TITLE, 0, 470);
        text(fb, 22, 310, "没有等待批准或刚结束的 Codex 对话。", MOTE_STRIKE_CAPTION, 0, 470);
        return;
    }
    int y = 124;
    for (int i = 0; i < count && y < 700; i++) {
        card(fb, 22, y, 436, &cards[i], nav->inbox_sel == i, 0);
        y += 184;
    }
}

static void render_settings(uint8_t *fb, const mote_status_view_t *status) {
    const char *keys[] = {"墨水屏", "Agent Speed", "Codex hook", "连接方式", "刷新"};
    const char *vals[] = {status->eink, status->speed, status->hook, status->link, status->refresh};
    int y = 80;
    for (int i = 0; i < 5; i++) {
        text(fb, 22, y, keys[i], MOTE_STRIKE_BODY, 0, 250);
        text_right(fb, 458, y, vals[i], MOTE_STRIKE_BODY, 0);
        rect(fb, 22, y + 46, 436, 2, 0, 1);
        y += 72;
    }
}

static void render_clock(uint8_t *fb, const mote_status_view_t *status) {
    const char *clock = status->clock[0] ? status->clock : "11:57";
    int w = text_width(clock, MOTE_STRIKE_DISPLAY);
    text(fb, (MOTE_UI_W - w) / 2, 340, clock, MOTE_STRIKE_DISPLAY, 0, MOTE_UI_W - 8);
}

void mote_ui_render(uint8_t *fb, const mote_nav_t *nav, const mote_speed_view_t *speed,
                    const mote_card_view_t *cards, int card_count, int pending_count,
                    const mote_status_view_t *status) {
    mote_fb_clear(fb, 3);
    const char *title = "主桌面";
    const char *left = "上 / 下选择";
    const char *right = "按下打开";
    int pending = pending_count >= 0 ? pending_count : pending_of(cards, card_count);
    switch (nav->view) {
    case MOTE_VIEW_OVERVIEW:
        title = "工作台";
        right = "按下进入详情 · BOOT 回桌面";
        render_overview(fb, nav, speed, cards, card_count);
        break;
    case MOTE_VIEW_SPEED:
        title = "速度";
        left = "速度来自 Agent Speed";
        right = "BOOT 返回工作台";
        render_speed(fb, speed);
        break;
    case MOTE_VIEW_INBOX:
        title = "Codex 待处理";
        left = card_count ? "上 / 下浏览" : "暂无条目";
        right = "BOOT 返回工作台";
        render_inbox(fb, nav, cards, card_count, pending);
        break;
    case MOTE_VIEW_CLOCK:
        title = "时钟";
        left = "";
        right = "BOOT 回桌面";
        render_clock(fb, status);
        break;
    case MOTE_VIEW_SETTINGS:
        title = "设置";
        left = "与 Mac 的连接状态";
        right = "BOOT 回桌面";
        render_settings(fb, status);
        break;
    default:
        render_home(fb, nav, speed, pending);
        break;
    }
    rect(fb, 0, 56, 480, 3, 0, 1);
    text(fb, 16, 14, title, MOTE_STRIKE_CAPTION, 0, 360);
    text_right(fb, 464, 14, status->clock, MOTE_STRIKE_CAPTION, 0);
    rect(fb, 0, 742, 480, 3, 0, 1);
    text(fb, 12, 758, left, MOTE_STRIKE_CAPTION, 0, 0);
    text_right(fb, 468, 758, right, MOTE_STRIKE_CAPTION, 0);
}
