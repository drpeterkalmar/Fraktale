#!/usr/bin/env python3
"""7.1.9 – Bildfolgen im Flug zur Sichtprüfung: je Welt 16 Bilder im Abstand von 0,5 s (8 s Flug) als 8×2-Bogen (Drittelgröße),
beginnend 6 s nach dem Start: „fliegt man erkennbar DURCH Gänge/über Strukturen?“, „gleitet erkennbar über die Oberfläche?“,
„Schwanken sichtbar, aber ruhig?“ (Rollen des Horizonts). Standard-Flugart je Welt bzw. --mode.
Aufruf: FK_HEADED=1 python3 tests/series_v719.py [--worlds=6,8,9,16,17,18] [--mode=durch] [--start=6]
-> tests/shots/v719/flug_<welt>[_<mode>].jpg
"""
import sys, os, time, io
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright
from measure_bulb import arg
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), 'shots', 'v719')
NAMES = {6: 'mandelbulb', 8: 'mandelbox', 9: 'menger', 16: 'quatjulia', 17: 'kifs', 18: 'apollonian'}


def main():
    os.makedirs(OUT, exist_ok=True)
    worlds = [int(x) for x in str(arg('worlds', '6,8,9,16,17,18')).split(',')]
    mode = arg('mode', None); start = float(arg('start', 6))
    with sync_playwright() as p:
        a = App(p, query='nosw&noanim', extra_ctx={'device_scale_factor': 2.6}).open(); pg = a.page
        for f in worlds:
            pg.evaluate(f"() => {{ const A = window.__fraktal; A.stopFly(); A.setMode({f}); A.S.chrome = false; }}"); time.sleep(3)
            if mode: pg.evaluate(f"() => window.__fraktal.BULB.setFlyMode('{mode}')")
            pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.5; A.startFly(); }"); time.sleep(start)
            imgs = []
            for k in range(16):
                imgs.append(Image.open(io.BytesIO(pg.screenshot(type='png'))).convert('RGB')); time.sleep(0.5)
            pg.evaluate("() => window.__fraktal.stopFly()")
            w, h = imgs[0].size; W, H = w // 3, h // 3
            sh = Image.new('RGB', (W * 8, H * 2))
            for i, im in enumerate(imgs): sh.paste(im.resize((W, H)), ((i % 8) * W, (i // 8) * H))
            fn = os.path.join(OUT, f'flug_{NAMES.get(f, f)}' + (f'_{mode}' if mode else '') + '.jpg'); sh.save(fn, quality=80); print('->', fn, flush=True)
        a.close()


if __name__ == '__main__':
    main()
