"""Builds the iOS AppIcon set from the image in ../iccccon/.

Run before building (Windows or macOS):
    python ios/tools/make_ios_icons.py

Outputs into ios/icons/ the exact PNG sizes Contents.json expects.
iOS icons must be opaque (no alpha) and square.
"""

import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
IOS = os.path.dirname(HERE)
PROJECT = os.path.dirname(IOS)
SRC_DIR = os.path.join(PROJECT, "iccccon")
OUT_DIR = os.path.join(IOS, "icons")

# (file name, pixel size) - pixels = points * scale
TARGETS = [
    ("icon-20.png", 40), ("icon-20.png", 60),
    ("icon-29.png", 58), ("icon-29.png", 87),
    ("icon-40.png", 80), ("icon-40.png", 120),
    ("icon-60.png", 120), ("icon-60.png", 180),
    ("icon-76.png", 76), ("icon-76.png", 152),
    ("icon-83.5.png", 167),
    ("icon-1024.png", 1024),
]

# Largest needed per file name (Contents.json reuses the same file for both scales)
LARGEST = {}
for name, px in TARGETS:
    LARGEST[name] = max(px, LARGEST.get(name, 0))


def pick_source():
    if len(sys.argv) > 1:
        return sys.argv[1]
    if not os.path.isdir(SRC_DIR):
        raise SystemExit("iccccon folder not found: " + SRC_DIR)
    files = [f for f in os.listdir(SRC_DIR)
             if os.path.splitext(f)[1].lower() in (".png", ".jpg", ".jpeg", ".webp")]
    if not files:
        raise SystemExit("no image found in " + SRC_DIR)
    for f in files:
        if f.lower().endswith(".png"):
            return os.path.join(SRC_DIR, f)
    return os.path.join(SRC_DIR, max(files, key=lambda f: os.path.getsize(os.path.join(SRC_DIR, f))))


def main():
    src = pick_source()
    img = Image.open(src).convert("RGB")      # iOS: no alpha channel
    w, h = img.size

    # iOS needs a square. Centre-crop, then pad any remainder with the
    # corner colour so the logo is never stretched.
    if w != h:
        side = min(w, h)
        left = (w - side) // 2
        top = (h - side) // 2
        img = img.crop((left, top, left + side, top + side))
        print("cropped %dx%d -> %dx%d (centre)" % (w, h, side, side))

    os.makedirs(OUT_DIR, exist_ok=True)
    master = img.resize((1024, 1024), Image.LANCZOS)

    for name, px in sorted(LARGEST.items(), key=lambda kv: kv[1]):
        master.resize((px, px), Image.LANCZOS).save(
            os.path.join(OUT_DIR, name), format="PNG", optimize=True)
        print("  %-16s %dx%d" % (name, px, px))

    # Browser/PWA fallback icon
    master.save(os.path.join(OUT_DIR, "icon-512.png"), format="PNG", optimize=True)

    print("source : %s" % src)
    print("output : %s" % OUT_DIR)


if __name__ == "__main__":
    main()
