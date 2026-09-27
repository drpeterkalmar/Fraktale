#!/usr/bin/env python3
"""Erzeugt die PWA-Icons (Mandelbrot mit Neon-Cosinus-Palette) nach assets/icons/."""
import numpy as np
from PIL import Image, ImageDraw
import os
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'icons')

def render(n, pad):
    ys, xs = np.mgrid[0:n, 0:n]
    s = 2.7 / (n * (1 - 2 * pad))
    c = (-0.62 + (xs - n / 2) * s) + 1j * ((n / 2 - ys) * s)
    z = np.zeros_like(c); mu = np.full(c.shape, -1.0); alive = np.ones(c.shape, bool)
    for i in range(1, 400):
        z[alive] = z[alive] ** 2 + c[alive]
        esc = alive & (np.abs(z) > 16)
        mu[esc] = i + 1 - np.log2(np.log2(np.abs(z[esc])))
        alive &= ~esc
    t = (mu * 0.08) % 1.0
    col = np.stack([0.5 + 0.5 * np.cos(6.28318 * (t + d)) for d in (0.0, 0.10, 0.20)], -1)
    lum = (col * [0.299, 0.587, 0.114]).sum(-1, keepdims=True)
    col = np.clip(lum + (col - lum) * 1.2, 0, 1) ** 0.92
    col[mu < 0] = [0.02, 0.02, 0.06]
    return Image.fromarray((col * 255).astype(np.uint8))

def icon(n, maskable=False):
    img = render(n, 0.16 if maskable else 0.06)
    if not maskable:
        m = Image.new('L', (n, n), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * 0.22), fill=255)
        bg = Image.new('RGBA', (n, n), (0, 0, 0, 0)); bg.paste(img, (0, 0), m); return bg
    return img

os.makedirs(OUT, exist_ok=True)
for n in (512, 192, 180):
    icon(n).save(os.path.join(OUT, f'icon-{n}.png'))
icon(512, True).save(os.path.join(OUT, 'icon-maskable-512.png'))
print('ok')
