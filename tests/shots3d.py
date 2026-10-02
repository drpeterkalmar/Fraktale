#!/usr/bin/env python3
"""Screenshots der 3D-Landschaft (Pixel 7 hoch/quer) für die Sichtprüfung: Seepferdchen-Tal, Spirale 10⁷,
Randpunkt 10⁹, Julia; Neigung 30° und 55°; Flug-Serie 6 × 250 ms. Ablage tests/shots/3d/.
Aufruf: python3 tests/shots3d.py [--only=hoch|quer] [--fly]"""
import sys, os, time, json
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright
from PIL import Image
SH = os.path.join(os.path.dirname(__file__), 'shots', '3d')
os.makedirs(SH, exist_ok=True)
SEA = ('-0.743643887037158704752191506114774', '0.131825904205311970493132056385139')
VIEWS = [('seepferdchen_tal', 0, '-0.7453', '0.1127', 300), ('spirale_1e7', 0, '-0.8625944137', '0.2495680306', 1.705e7),
         ('rand_1e9', 0, '-0.743637214380908705', '0.131822306549061970', 1e9), ('julia', 1, '0', '0', 1.6)]


def sheet(paths, out, s=0.45):
    ims = [Image.open(p).convert('RGB') for p in paths]
    w, h = ims[0].size
    sh = Image.new('RGB', (int(w * s) * len(ims), int(h * s)))
    for i, im in enumerate(ims): sh.paste(im.resize((int(w * s), int(h * s))), (i * int(w * s), 0))
    sh.save(out, quality=86)


def main():
    only = next((a.split('=')[1] for a in sys.argv[1:] if a.startswith('--only=')), None)
    errs = {}
    with sync_playwright() as p:
        for land in (False, True):
            tag = 'quer' if land else 'hoch'
            if only and only != tag: continue
            a = App(p, landscape=land).open(); pg = a.page
            pg.evaluate("() => { const A = window.__fraktal; A.S.chrome = true; }")
            shots = []
            for name, f, cx, cy, z in VIEWS:
                pg.evaluate(f"() => window.__fraktal.set3d(false)"); time.sleep(0.9)
                pg.evaluate(f"() => window.__fraktal.setMode({f}, true)")
                if f == 1: pg.evaluate("() => { const A = window.__fraktal; A.setJulia(A.HP.fromString('-0.8'), A.HP.fromString('0.156')); }")
                a.set_view(cx, cy, z); a.wait_done(120)
                pg.evaluate("() => window.__fraktal.set3d(true)"); time.sleep(1.0); a.wait_done(120); time.sleep(2.5)
                for deg in (30, 55):
                    pg.evaluate(f"() => {{ const A = window.__fraktal; A.V3.tilt = {deg} * Math.PI / 180; A.V3.heading = 0.4; A.RC.dirty = true; }}")
                    time.sleep(1.2)
                    path = os.path.join(SH, f'{tag}_{name}_{deg}.jpg'); pg.screenshot(path=path, type='jpeg', quality=85); shots.append(path)
            sheet(shots[:4], os.path.join(SH, f'sheet_{tag}_a.jpg')); sheet(shots[4:], os.path.join(SH, f'sheet_{tag}_b.jpg'))
            if '--fly' in sys.argv:
                pg.evaluate("() => window.__fraktal.setMode(0, true)")
                a.set_view('-0.7453', '0.1127', 200); a.wait_done(60)
                pg.evaluate("() => { const A = window.__fraktal; A.set3d(true); A.V3.tilt = 50 * Math.PI / 180; }"); time.sleep(1.5)
                pg.evaluate("() => window.__fraktal.startFly()"); time.sleep(4)
                fl = []
                for i in range(6):
                    path = os.path.join(SH, f'{tag}_flug_{i}.jpg'); pg.screenshot(path=path, type='jpeg', quality=85); fl.append(path); time.sleep(0.25)
                sheet(fl, os.path.join(SH, f'sheet_{tag}_flug.jpg'), 0.35)
                pg.evaluate("() => window.__fraktal.stopFly()")
            errs[tag] = a.errors
            a.close()
    print(json.dumps(errs))


if __name__ == '__main__':
    main()
