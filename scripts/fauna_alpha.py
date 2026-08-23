#!/usr/bin/env python3
"""fauna_alpha.py — turn a MiniMax sprite (pure black background) into a
transparent game sprite: near-black pixels -> alpha 0, soft edge band, crop
to content bbox, cap width at 256px.

Usage: fauna_alpha.py <in.png> <out.png>
"""
import sys
from PIL import Image

DARK = 34
BAND = 40  # alpha ramps from 0 at DARK to full at DARK+BAND
MAXW = 256


def main() -> None:
    src, dst = sys.argv[1], sys.argv[2]
    im = Image.open(src).convert('RGBA')
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            m = max(r, g, b)
            if m <= DARK:
                a = 0
            elif m <= DARK + BAND:
                a = int(a * (m - DARK) / BAND)
            px[x, y] = (r, g, b, a)
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    if im.width > MAXW:
        im = im.resize((MAXW, int(im.height * MAXW / im.width)), Image.LANCZOS)
    im.save(dst)


if __name__ == '__main__':
    main()
