#ifndef FONT_DATA_H
#define FONT_DATA_H
#include <stdint.h>
typedef struct { uint32_t cp; uint8_t adv, w, h; uint32_t offset; } mote_glyph_t;
#define MOTE_STRIKE_CAPTION 0
#define MOTE_STRIKE_BODY 1
#define MOTE_STRIKE_TITLE 2
#define MOTE_STRIKE_DISPLAY 3
#define MOTE_FONT_CAPTION_COUNT 203
#define MOTE_FONT_CAPTION_PX 24
#define MOTE_FONT_BODY_COUNT 203
#define MOTE_FONT_BODY_PX 36
#define MOTE_FONT_TITLE_COUNT 203
#define MOTE_FONT_TITLE_PX 56
#define MOTE_FONT_DISPLAY_COUNT 14
#define MOTE_FONT_DISPLAY_PX 96
extern const mote_glyph_t mote_font_caption[];
extern const mote_glyph_t mote_font_body[];
extern const mote_glyph_t mote_font_title[];
extern const mote_glyph_t mote_font_display[];
extern const uint8_t mote_font_bits_caption[];
extern const uint8_t mote_font_bits_body[];
extern const uint8_t mote_font_bits_title[];
extern const uint8_t mote_font_bits_display[];
#endif
