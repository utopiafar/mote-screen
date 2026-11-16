#ifndef FONT_DATA_H
#define FONT_DATA_H
#include <stdint.h>
typedef struct { uint32_t cp; uint8_t adv, w, h; uint16_t offset; } mote_glyph_t;
#define MOTE_FONT_COUNT 203
extern const mote_glyph_t mote_font[MOTE_FONT_COUNT];
extern const uint8_t mote_font_bits[];
#endif
