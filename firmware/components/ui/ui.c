#include "ui.h"

#include "font_data.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

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

static const mote_glyph_t *find_glyph(uint32_t cp) {
    int lo = 0, hi = MOTE_FONT_COUNT - 1;
    while (lo <= hi) {
        int mid = (lo + hi) / 2;
        if (mote_font[mid].cp == cp) return &mote_font[mid];
        if (mote_font[mid].cp < cp) lo = mid + 1;
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

static int text_width(const char *text, int scale) {
    int w = 0;
    const char *p = text;
    uint32_t cp;
    while ((cp = next_cp(&p))) {
        const mote_glyph_t *g = find_glyph(cp);
        w += (g ? g->adv : 8) * scale;
    }
    return w;
}

static void text(uint8_t *fb, int x, int y, const char *utf8, int scale, int level) {
    const char *p = utf8;
    uint32_t cp;
    while ((cp = next_cp(&p))) {
        const mote_glyph_t *g = find_glyph(cp);
        int adv = g ? g->adv : 8;
        if (g) {
            for (int yy = 0; yy < g->h; yy++) {
                for (int xx = 0; xx < g->w; xx++) {
                    int bit = yy * g->w + xx;
                    if (mote_font_bits[g->offset + bit / 8] & (0x80 >> (bit % 8))) {
                        for (int sy = 0; sy < scale; sy++) {
                            for (int sx = 0; sx < scale; sx++) set_px(fb, x + xx * scale + sx, y + yy * scale + sy, level);
                        }
                    }
                }
            }
        }
        x += adv * scale;
    }
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
        int x0 = x + (i - 1) * (w - 4) / (n - 1) + 2;
        int x1 = x + i * (w - 4) / (n - 1) + 2;
        int y0 = y + h - 2 - (int)(pts[i - 1] / max * (h - 6));
        int y1 = y + h - 2 - (int)(pts[i] / max * (h - 6));
        int steps = abs(x1 - x0) + abs(y1 - y0) + 1;
        for (int s = 0; s <= steps; s++) {
            int xx = x0 + (x1 - x0) * s / steps;
            int yy = y0 + (y1 - y0) * s / steps;
            set_px(fb, xx, yy, 0);
            set_px(fb, xx, yy + 1, 2);
        }
    }
}

static void render_home(uint8_t *fb, const mote_nav_t *nav, const mote_speed_view_t *speed, int pending) {
    const char *names[] = {"工作台", "时钟", "设置", "预留"};
    const char *kick[] = {"APP", "APP", "APP", "空"};
    char status[64];
    const char *phase = strcmp(speed->phase, "idle") == 0 ? "空闲" : strcmp(speed->phase, "tools") == 0 ? "调用工具" : "生成中";
    (void)phase;
    float tok = strcmp(speed->phase, "idle") == 0 ? 0 : speed->tok;
    if (pending) snprintf(status, sizeof status, "%.1f tok/s · %d 条待处理", tok, pending);
    else snprintf(status, sizeof status, "%.1f tok/s · 一切安静", tok);
    for (int i = 0; i < 4; i++) {
        int col = i % 2, row = i / 2;
        int x = 18 + col * 228, y = 48 + row * 350;
        int sel = nav->home_sel == i;
        rect(fb, x, y, 216, 330, 0, sel);
        int ink = sel ? 3 : 0;
        text(fb, x + 14, y + 16, kick[i], 1, ink);
        char title[32];
        snprintf(title, sizeof title, "%s", names[i]);
        text(fb, x + 14, y + 48, title, 2, ink);
        if (i == 0 && pending) {
            char badge[8];
            snprintf(badge, sizeof badge, "%d", pending);
            text(fb, x + 150, y + 52, badge, 2, ink);
        }
        if (i == 0) text(fb, x + 14, y + 250, status, 1, ink);
        if (i == 3) text(fb, x + 14, y + 250, "尚未开放", 1, ink);
    }
}

static void card(uint8_t *fb, int x, int y, int w, const mote_card_view_t *item, int sel, int compact) {
    int urgent = strcmp(item->kind, "permission") == 0;
    rect(fb, x, y, w, compact ? 78 : 108, 0, urgent);
    if (sel) rect(fb, x - 3, y - 3, w + 6, (compact ? 78 : 108) + 6, 0, 0);
    int ink = urgent ? 3 : 0;
    text(fb, x + 10, y + 8, urgent ? "等待批准" : "已结束", 1, ink);
    text(fb, x + 10, y + 30, item->title, 1, ink);
    char meta[64];
    snprintf(meta, sizeof meta, "codex · %s", item->project);
    text(fb, x + 10, y + 52, meta, 1, urgent ? 2 : 1);
    if (!compact) text(fb, x + 10, y + 76, item->wait, 1, urgent ? 2 : 1);
}

static void render_overview(uint8_t *fb, const mote_nav_t *nav, const mote_speed_view_t *speed, const mote_card_view_t *cards, int count) {
    int sel_speed = nav->ov_sel == 0;
    if (sel_speed) rect(fb, 8, 48, 464, 300, 0, 0);
    text(fb, 22, 56, "速度", 1, 1);
    text(fb, 300, 56, "按下查看详情", 1, 0);
    char tok[24];
    float value = strcmp(speed->phase, "idle") == 0 ? 0 : speed->tok;
    snprintf(tok, sizeof tok, "%.1f", value);
    text(fb, 22, 88, tok, 4, 0);
    text(fb, 22 + text_width(tok, 4) + 8, 140, "tok/s", 1, 1);
    char phase[64];
    const char *name = strcmp(speed->phase, "tools") == 0 ? "调用工具" : strcmp(speed->phase, "idle") == 0 ? "空闲" : "生成中";
    snprintf(phase, sizeof phase, "%s · %d 个会话在跑", name, speed->active);
    text(fb, 22, 190, phase, 1, 0);
    spark(fb, 22, 230, 436, 80, speed->history, speed->history_len);
    rect(fb, 0, 328, 480, 2, 0, 1);
    int pending = 0;
    for (int i = 0; i < count; i++) if (strcmp(cards[i].kind, "permission") == 0) pending++;
    text(fb, 22, 340, "CODEX 待处理", 1, 1);
    if (pending) text(fb, 300, 340, "按下查看全部", 1, 0);
    int shown = 0;
    for (int i = 0; i < count && shown < 2; i++) {
        if (strcmp(cards[i].kind, "permission") != 0) continue;
        card(fb, 22, 372 + shown * 92, 436, &cards[i], nav->ov_sel == shown + 1, 1);
        shown++;
    }
    if (!shown) {
        text(fb, 22, 420, "一切安静", 2, 0);
        text(fb, 22, 470, "没有等待批准的 Codex 对话。", 1, 1);
    }
}

static void render_speed(uint8_t *fb, const mote_speed_view_t *speed) {
    text(fb, 22, 48, "AGENT SPEED · 本机输出", 1, 1);
    char tok[24];
    float value = strcmp(speed->phase, "idle") == 0 ? 0 : speed->tok;
    snprintf(tok, sizeof tok, "%.1f", value);
    text(fb, 22, 80, tok, 4, 0);
    text(fb, 22 + text_width(tok, 4) + 8, 132, "tok/s", 1, 1);
    const char *name = strcmp(speed->phase, "tools") == 0 ? "调用工具" : strcmp(speed->phase, "idle") == 0 ? "空闲" : "生成中";
    text(fb, 22, 176, name, 2, 0);
    const char *labels[] = {"进行中", "正在生成", "调用工具"};
    int values[] = {speed->active, speed->generating, speed->tools};
    for (int i = 0; i < 3; i++) {
        int x = 22 + i * 150;
        rect(fb, x, 230, 140, 80, 0, 0);
        char num[8];
        snprintf(num, sizeof num, "%d", values[i]);
        text(fb, x + 16, 242, num, 2, 0);
        text(fb, x + 16, 280, labels[i], 1, 1);
    }
    text(fb, 22, 330, "近一分钟", 1, 1);
    spark(fb, 22, 356, 436, 88, speed->history, speed->history_len);
    int y = 470;
    for (int i = 0; i < speed->source_count && i < 4; i++) {
        char row[48];
        float tok_s = strcmp(speed->phase, "idle") == 0 ? 0 : speed->source_tok[i];
        snprintf(row, sizeof row, "%s", speed->source_name[i]);
        text(fb, 22, y, row, 1, 0);
        snprintf(row, sizeof row, "%.1f tok/s", tok_s);
        text(fb, 280, y, row, 1, 0);
        y += 36;
    }
}

static void render_inbox(uint8_t *fb, const mote_nav_t *nav, const mote_card_view_t *cards, int count, int pending) {
    char head[32];
    if (pending) snprintf(head, sizeof head, "%d 条在等批准", pending);
    else snprintf(head, sizeof head, "暂无等待");
    text(fb, 22, 48, head, 1, 1);
    if (!count) {
        text(fb, 22, 200, "一切安静", 2, 0);
        text(fb, 22, 250, "没有等待批准或刚结束的 Codex 对话。", 1, 1);
        return;
    }
    int y = 70;
    for (int i = 0; i < count && y < 700; i++) {
        card(fb, 22, y, 436, &cards[i], nav->inbox_sel == i, 0);
        y += 120;
    }
}

static void render_settings(uint8_t *fb, const mote_status_view_t *status) {
    const char *keys[] = {"墨水屏", "Agent Speed", "Codex hook", "连接方式", "刷新"};
    const char *vals[] = {status->eink, status->speed, status->hook, status->link, status->refresh};
    int y = 52;
    for (int i = 0; i < 5; i++) {
        text(fb, 22, y, keys[i], 1, 0);
        text(fb, 250, y, vals[i], 1, 1);
        y += 48;
        rect(fb, 22, y - 10, 436, 1, 2, 1);
    }
}

static void render_clock(uint8_t *fb, const mote_status_view_t *status) {
    text(fb, 40, 280, status->clock[0] ? status->clock : "11:57", 4, 0);
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
    rect(fb, 0, 0, 480, 36, 0, 0);
    text(fb, 16, 8, title, 1, 3);
    text(fb, 390, 8, status->clock, 1, 3);
    rect(fb, 0, 760, 480, 40, 0, 0);
    text(fb, 12, 770, left, 1, 3);
    int rw = text_width(right, 1);
    text(fb, 468 - rw, 770, right, 1, 3);
}
