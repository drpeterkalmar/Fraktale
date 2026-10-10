#!/usr/bin/env python3
"""Rendert die Vorschaubilder (assets/modes/<n>.jpg) mit der App selbst.
Voraussetzung: lokaler Server auf :8472 (python3 -m http.server 8472)."""
import sys, os, io, re, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'tests'))
from e2e_lib import App
from playwright.sync_api import sync_playwright
from PIL import Image
ROOT = os.path.join(os.path.dirname(__file__), '..')
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
    for i in range(pg.evaluate("() => window.__fraktal.MODE_KEYS.length")):
        if only and f'm{i}' not in only: continue
        pg.evaluate(f"() => window.__fraktal.setMode({i})")
        if pg.evaluate("() => window.__fraktal.isRay()"):
            # 7.0 Strahlen-Welten: warten, bis das Ruhebild fertig gemittelt ist
            for k in range(200):
                inf = pg.evaluate("() => window.__fraktal.BULB.info()")
                if inf.get('still', 0) >= inf.get('K', 99): break
                pg.wait_for_timeout(150)
        elif i == 7:
            pg.wait_for_timeout(4000)
        else:
            a.wait_done(120)
        shot(pg, os.path.join(ROOT, 'assets', 'modes', f'{i}.jpg')); print('mode', i)
    print('errors', a.errors)
    a.close()
