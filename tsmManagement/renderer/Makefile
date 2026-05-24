CC = gcc
CFLAGS = -O2 -Wall
LIBS = -lz -lpng -lm

all: tsm-renderer

tsm-renderer: tsm-renderer.c
	$(CC) $(CFLAGS) -o tsm-renderer tsm-renderer.c $(LIBS)

clean:
	rm -f tsm-renderer

.PHONY: all clean
