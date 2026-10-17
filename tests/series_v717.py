#!/usr/bin/env python3
"""7.1.7 – Bildfolge im ✈-Flug der 3D-Welten (16 Bilder im Abstand von 0,2 s, als 4×4-Bogen) zur Sichtprüfung
„wirkt die Kamerafahrt ruhig?“; je Welt neu (Standard) und alt (?bulbpace=0) nebeneinander als zwei Bögen.
Aufruf: FK_HEADED=1 python3 tests/series_v717.py [--worlds=6,8,9,16,17]   -> tests/shots/v717/fly_<welt>_<neu|alt>.jpg
"""
import sys, os, time, io
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright
from measure_bulb import arg
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), 'shots', 'v717')
NAMES = {6: 'mandelbulb', 8: 'mandelbox', 9: 'menger', 16: 'quatjulia', 17: 'kifs', 18: 'apollonian'}


def sheet(imgs, fn):
    w, h = imgs[0].size; s = 0.5
    W, H = int(w * s), int(h * s)
    sh = Image.new('RGB', (W * 4, H * 4))
    for i, im in enumerate(imgs[:16]): sh.paste(im.resize((W, H)), ((i % 4) * W, (i // 4) * H))
    sh.save(fn, quality=82)


def main():
    os.makedirs(OUT, exist_ok=True)
    worlds = [int(x) for x in str(arg('worlds', '6,8')).split(',')]
    with sync_playwright() as p:
        for tag, q in (('neu', ''), ('alt', '&bulbpace=0')):
            a = App(p, query='nosw&noanim' + q).open(); pg = a.page
            for f in worlds:
                pg.evaluate(f"() => {{ const A = window.__fraktal; A.stopFly(); A.setMode({f}); A.S.chrome = false; }}"); time.sleep(3)
                pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.3; A.startFly(); }"); time.sleep(4)
                imgs = []
                for k in range(16):
                    imgs.append(Image.open(io.BytesIO(pg.screenshot(type='png'))).convert('RGB')); time.sleep(0.2)
                pg.evaluate("() => window.__fraktal.stopFly()")
                fn = os.path.join(OUT, f'fly_{NAMES.get(f, f)}_{tag}.jpg'); sheet(imgs, fn); print('->', fn, flush=True)
            a.close()


if __name__ == '__main__':
    main()
