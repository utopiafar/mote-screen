#ifndef MOTE_EPD_H
#define MOTE_EPD_H

#include <stddef.h>
#include <stdint.h>

/* 2-bit portrait framebuffer, 480×800, 4 pixels per byte, level 3 = white.
 * Flush packs it to 1-bit. full selects the base waveform (0xF7, both RAMs).
 * Otherwise partial (0xFF on 0x24, then the same frame into 0x26, no reset). */
void epd_init(void);
void epd_present(const uint8_t *portrait, int full);
void epd_sleep(void);

#endif
