#ifndef MOTE_LINK_H
#define MOTE_LINK_H

/* One NDJSON line. An 8-item inbox with 48-character titles is well under this. */
#define MOTE_LINE_MAX 16384

/* Wi-Fi TCP 7427, BLE GATT for this firmware, and USB serial, all NDJSON. */
void mote_link_start(void);
int mote_link_take(char *out, int cap);
void mote_link_apply_radios(int bluetooth);
void mote_link_note_wifi(const char *ssid, const char *password);

#endif
