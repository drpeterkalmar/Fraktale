#!/usr/bin/env python3
"""7.1: Vorschaubilder der Sehenswürdigkeiten (assets/sights/<k>.jpg, 176 × 110 wie „Ansicht merken“) mit der App selbst.
Voraussetzung: lokaler Server auf :8472 (python3 tools/serve.py 8472). Aufruf: python3 tools/make_sights.py [k …]"""
import sys, os, io, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'tests'))
from e2e_lib import App
from playwright.sync_api import sync_playwright
from PIL import Image
ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'assets', 'sights')
os.makedirs(OUT, exist_ok=True)
only = sys.argv[1:]
with sync_playwright() as p:
    a = App(p, device='Pixel 7', query='nosw&noanim', extra_ctx={'viewport': {'width': 440, 'height': 275}, 'device_scale_factor': 2, 'is_mobile': False})
    a.open(); pg = a.page
    pg.evaluate("() => document.body.classList.add('immersive')")
    sights = pg.evaluate("() => Object.values(window.__fraktal.SIGHTS).flat().map(s => Object.assign({}, s))")
    for s in sights:
        if only and s['k'] not in only: continue
        if s.get('b'):
            # 3D-Fraktale: Zustand direkt setzen, Ruhebild abwarten
            pg.evaluate("(s) => { const A = window.__fraktal; A.setMode(s.formula, true); A.BULB.applyState(s.b); }", s)
            t0 = time.time()
            while time.time() - t0 < 60:
                inf = pg.evaluate("() => window.__fraktal.BULB.info()")
                if inf.get('still', 0) >= inf.get('K', 99): break
                time.sleep(0.2)
        else:
            pg.evaluate("(s) => { const A = window.__fraktal; A.setMode(s.formula, true); A.goTo(s); A.stopAnims(); A.setView(s.cx, s.cy, s.zoom); }", s)
            time.sleep(0.3)
            if s['formula'] == 7: time.sleep(12)        # Buddhabrot sammelt fortlaufend (kein „fertig“)
            else: a.wait_done(240)
        time.sleep(1.5 if s['formula'] in (14, 15) else 0.3)
        pg.evaluate("() => window.__fraktal.snapshot()")
        b = pg.locator('#gl').screenshot()
        Image.open(io.BytesIO(b)).convert('RGB').resize((176, 110), Image.LANCZOS).save(os.path.join(OUT, s['k'] + '.jpg'), quality=84, optimize=True)
        print('sight', s['k'], flush=True)
    print('errors', a.errors)
    a.close()
