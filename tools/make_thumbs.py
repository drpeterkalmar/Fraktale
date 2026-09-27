#!/usr/bin/env python3
"""Rendert die Vorschaubilder (assets/modes/<n>.jpg, assets/thumbs/<id>.jpg) mit der App selbst.
Voraussetzung: lokaler Server auf :8472 (python3 -m http.server 8472)."""
import sys, os, io, re, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'tests'))
from e2e_lib import App
from playwright.sync_api import sync_playwright
from PIL import Image
ROOT = os.path.join(os.path.dirname(__file__), '..')
ui = open(os.path.join(ROOT, 'js', 'ui.js')).read()
presets = re.findall(r"\{ id: '(\w+)', key: '\w+', cx: '([-\d.]+)', cy: '([-\d.]+)', zoom: ([\d.e]+) \}", ui)
only = sys.argv[1:] 

def shot(pg, path):
    b = pg.locator('#gl').screenshot()
    im = Image.open(io.BytesIO(b)).convert('RGB').resize((320, 200), Image.LANCZOS)
    im.save(path, quality=82, optimize=True)

with sync_playwright() as p:
    a = App(p, device='Pixel 7', query='nosw&noanim', extra_ctx={'viewport': {'width': 640, 'height': 400}, 'device_scale_factor': 1.5, 'is_mobile': False})
    a.open(); pg = a.page
    pg.evaluate("() => document.body.classList.add('immersive')")
    pg.wait_for_timeout(800)
    for i in range(8):
        if only and f'm{i}' not in only: continue
        pg.evaluate(f"() => window.__fraktal.setMode({i})")
        if i in (6, 7):
            pg.wait_for_timeout(4000 if i == 7 else 1500)
        else:
            a.wait_done(120)
        shot(pg, os.path.join(ROOT, 'assets', 'modes', f'{i}.jpg')); print('mode', i)
    pg.evaluate("() => window.__fraktal.setMode(0)"); a.wait_done(60)
    for pid, cx, cy, z in presets:
        if only and pid not in only: continue
        a.set_view(cx, cy, float(z))
        t, st = a.wait_done(300)
        shot(pg, os.path.join(ROOT, 'assets', 'thumbs', f'{pid}.jpg')); print('preset', pid, round(t, 1), 's')
    print('errors', a.errors)
    a.close()
