#!/usr/bin/env python3
"""7.1.8 – Bildfolge im ✈-Flug der 3D-Welten zur Sichtprüfung „scharf wie Standbild? Pixel? Schlieren?“: je Welt 16 Bilder
im Abstand von 0,2 s als 4×4-Bogen (halbe Größe) und dieselben 16 als 1:1-Ausschnitte der Bildmitte (Schärfe, Pixel,
Schlieren an Kanten); neu (Standard) und alt (?scharf=0, Weg 7.1.7) im Mittelklasse-Profil (DPR 2,6).
Aufruf: FK_HEADED=1 python3 tests/series_v718.py [--worlds=6,8,9,16,17]  -> tests/shots/v718/serie_<welt>_<neu|alt>[_1zu1].jpg
"""
import sys, os, time, io
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright
from measure_bulb import arg
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), 'shots', 'v718')
NAMES = {6: 'mandelbulb', 8: 'mandelbox', 9: 'menger', 16: 'quatjulia', 17: 'kifs', 18: 'apollonian'}


def sheets(imgs, base):
    w, h = imgs[0].size
    W, H = w // 2, h // 2
    sh = Image.new('RGB', (W * 4, H * 4))
    for i, im in enumerate(imgs[:16]): sh.paste(im.resize((W, H)), ((i % 4) * W, (i // 4) * H))
    sh.save(base + '.jpg', quality=82)
    C = 270
    box = (w // 2 - C // 2, h // 2 - C // 2, w // 2 + C // 2, h // 2 + C // 2)
    cr = Image.new('RGB', (C * 4, C * 4))
    for i, im in enumerate(imgs[:16]): cr.paste(im.crop(box), ((i % 4) * C, (i // 4) * C))
    cr.save(base + '_1zu1.jpg', quality=90)


def main():
    os.makedirs(OUT, exist_ok=True)
    worlds = [int(x) for x in str(arg('worlds', '6,8,9,16,17')).split(',')]
    with sync_playwright() as p:
        for tag, q in ((('neu', ''), ('alt', '&scharf=0')) if not arg('nur-neu', False) else (('neu', ''),)):
            a = App(p, query='nosw&noanim' + q, extra_ctx={'device_scale_factor': 2.6}).open(); pg = a.page
            for f in worlds:
                pg.evaluate(f"() => {{ const A = window.__fraktal; A.stopFly(); A.setMode({f}); A.S.chrome = false; }}"); time.sleep(3)
                pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.3; A.startFly(); }"); time.sleep(5)
                imgs = []
                for k in range(16):
                    imgs.append(Image.open(io.BytesIO(pg.screenshot(type='png'))).convert('RGB')); time.sleep(0.2)
                pg.evaluate("() => window.__fraktal.stopFly()")
                base = os.path.join(OUT, f'serie_{NAMES.get(f, f)}_{tag}'); sheets(imgs, base); print('->', base, flush=True)
            a.close()


if __name__ == '__main__':
    main()
