CC ?= gcc
CFLAGS ?= -std=c11 -Wall -Wextra -Werror -I../components/mote_logic/include

UI_CFLAGS = $(CFLAGS) -I../components/ui

.PHONY: test
test: test_logic test_draw
	./test_logic
	./test_draw

test_logic: test_logic.c ../components/mote_logic/mote_logic.c
	$(CC) $(CFLAGS) -o $@ test_logic.c ../components/mote_logic/mote_logic.c

test_draw: test_draw.c ../components/ui/ui.c ../components/ui/font_data.c ../components/mote_logic/mote_logic.c
	$(CC) $(UI_CFLAGS) -o $@ test_draw.c ../components/ui/ui.c ../components/ui/font_data.c ../components/mote_logic/mote_logic.c

.PHONY: clean
clean:
	rm -f test_logic test_draw
