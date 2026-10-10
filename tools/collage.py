#!/usr/bin/env python3
"""Kontaktbogen aus Bildern: python3 tools/collage.py out.jpg cols breite bild1 bild2 … (Beschriftung = Dateiname)."""
import sys
from PIL import Image, ImageDraw, ImageFont
out, cols, W = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
files = sys.argv[4:]
ims = [Image.open(f).convert('RGB') for f in files]
h = max(int(W * im.height / im.width) for im in ims)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * W, rows * (h + 18)), (20, 20, 24))
d = ImageDraw.Draw(sheet)
for i, (f, im) in enumerate(zip(files, ims)):
    im = im.resize((W, int(W * im.height / im.width)), Image.LANCZOS)
    x, y = (i % cols) * W, (i // cols) * (h + 18)
    sheet.paste(im, (x, y + 18))
    d.text((x + 4, y + 3), f.split('/')[-1].rsplit('.', 1)[0][:40], fill=(230, 230, 230))
sheet.save(out, quality=88)
print(out, sheet.size)
