#ifndef MOTE_LINK_H
#define MOTE_LINK_H

/* Wi-Fi TCP 7427, BLE GATT for this firmware, and USB serial, all NDJSON. */
void mote_link_start(void);
int mote_link_take(char *out, int cap);
void mote_link_apply_radios(int bluetooth);
void mote_link_note_wifi(const char *ssid, const char *password);

#endif
