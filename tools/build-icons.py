# Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
# Builds the site icons in icons/ from movie.png (black glyph on transparent).
# Home-screen and tab icons need an opaque background: iOS fills transparency
# with black, and a black glyph vanishes on dark tab strips. So the glyph is
# centred on a white tile with a margin (iOS rounds the corners).
# Run: python3 tools/build-icons.py   (needs Pillow)
from PIL import Image

SOURCE = 'movie.png'
SIZES = {'apple-touch-icon.png': 180, 'icon-192.png': 192, 'icon-512.png': 512, 'favicon-32.png': 32}
GLYPH_SHARE = 0.72  # the glyph's longest side, as a share of the tile

glyph = Image.open(SOURCE).convert('RGBA')
glyph = glyph.crop(glyph.getbbox())  # trim the transparent margin the source has

for name, size in SIZES.items():
    # Small icons get a slightly bigger glyph, since detail is lost anyway
    share = 0.86 if size <= 32 else GLYPH_SHARE
    scale = share * size / max(glyph.size)
    work = 4  # draw large, then downsample once, for clean edges
    big = Image.new('RGBA', (size * work, size * work), (255, 255, 255, 255))
    g = glyph.resize((round(glyph.width * scale * work), round(glyph.height * scale * work)), Image.LANCZOS)
    big.alpha_composite(g, ((big.width - g.width) // 2, (big.height - g.height) // 2))
    big.resize((size, size), Image.LANCZOS).convert('RGB').save(f'icons/{name}', optimize=True)
    print('wrote', f'icons/{name}', size)
