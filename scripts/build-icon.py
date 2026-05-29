"""
Build a square 1024x1024 iOS app icon from the ChatGPT-generated source.

The source has the ByteRite artwork inside a cream rounded-corner card on a
white background. iOS automatically rounds icons, so submitting the source
as-is produces a double-rounded look. This script:

  1. Samples the cream card color from a known interior pixel
  2. Replaces near-white background pixels with that cream
  3. Resizes to 1024x1024 and strips alpha (Apple rejects transparency)
  4. Writes assets/icon.png

Run: python3 scripts/build-icon.py
"""
import sys
from pathlib import Path
from PIL import Image

SRC = Path("/Users/pooja/Downloads/ChatGPT Image May 18, 2026, 12_44_28 PM.png")
OUT = Path(__file__).resolve().parent.parent / "assets" / "icon.png"
SIZE = 1024
WHITE_THRESHOLD = 240


def main() -> None:
    img = Image.open(SRC).convert("RGB")
    w, h = img.size

    # Sample cream from a spot we know is inside the card and not on the fork:
    # ~12% in from top-left lands in the cream area above and left of the fork.
    cream = img.getpixel((int(w * 0.12), int(h * 0.12)))
    print(f"[icon] sampled cream={cream}, src={w}x{h}")

    pixels = img.load()
    replaced = 0
    for y in range(h):
        for x in range(w):
            r, g, b = pixels[x, y]
            if r >= WHITE_THRESHOLD and g >= WHITE_THRESHOLD and b >= WHITE_THRESHOLD:
                pixels[x, y] = cream
                replaced += 1

    print(f"[icon] replaced {replaced} near-white pixels with cream")

    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, "PNG", optimize=True)
    print(f"[icon] wrote {OUT} ({SIZE}x{SIZE}, no alpha)")


if __name__ == "__main__":
    if not SRC.exists():
        print(f"source not found: {SRC}", file=sys.stderr)
        sys.exit(1)
    main()
