#!/usr/bin/env python3
"""Screenshots vorher/nachher für die Sichtprüfung „Wirkt es wie ein YouTube-Deep-Zoom?“ (6.1).
Gleiche Ansichten wie die Vorher-Bilder des Auftrags (Ganz 1×, Seepferdchen 300×, Minibrot 3e6, Randpunkt 1e9) +
Julia und Burning Ship; 2D und 3D (45°, Drehung 0,4), Pixel 7 hoch und quer. Canvas-Pixel (kein Screenshot-
Resampling), Ablage tests/shots/smooth/sheets/. Vergleichsblätter: links Version A, rechts Version B.
Aufruf: python3 tests/shots_smooth.py --a=http://localhost:8473/index.html --la=v600 --b=http://localhost:8472/index.html --lb=v610
"""
import sys, os, time, json
sys.path.insert(0, os.path.dirname(__file__))
import e2e_lib
from measure_smooth import snap
from playwright.sync_api import sync_playwright
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), 'shots', 'smooth', 'sheets')
VIEWS = [('ganz', 0, '-0.6', '0', 1), ('seepferd_300', 0, '-0.7453', '0.1127', 300),
         ('minibrot_3e6', 0, '-1.7499744226', '0.0000000000123', 3e6), ('rand_1e9', 0, '-0.743637214380908705', '0.131822306549061970', 1e9),
         ('julia', 1, '0', '0', 1.6), ('burning_ship', 2, '-1.7609', '-0.0283', 60)]


def shoot(p, base, label, land, errs):
    e2e_lib.BASE = base
    a = e2e_lib.App(p, landscape=land).open(); pg = a.page
    tag = 'quer' if land else 'hoch'
    W, H = pg.evaluate("() => [window.__fraktal.R.gl.canvas.width, window.__fraktal.R.gl.canvas.height]")
    for name, f, cx, cy, z in VIEWS:
        pg.evaluate("() => window.__fraktal.set3d(false)"); time.sleep(0.8)
        pg.evaluate(f"() => window.__fraktal.setMode({f}, true)")
        if f == 1: pg.evaluate("() => { const A = window.__fraktal; A.setJulia(A.HP.fromString('-0.8'), A.HP.fromString('0.156')); }")
        a.set_view(cx, cy, z); a.wait_done(180); time.sleep(0.3)
        Image.fromarray(snap(pg, [0, 0, W, H])).save(os.path.join(OUT, f'{label}_{tag}_{name}_2d.png'))
        if f in (0, 1):
            pg.evaluate("() => window.__fraktal.set3d(true)"); time.sleep(1.2); a.wait_done(180)
            pg.evaluate("() => { const A = window.__fraktal; A.V3.tilt = 45 * Math.PI / 180; A.V3.heading = 0.4; A.RC.dirty = true; }")
            time.sleep(2.5)
            if pg.evaluate("() => !!window.__fraktal.settle3d"): pg.evaluate("() => window.__fraktal.settle3d()")
            Image.fromarray(snap(pg, [0, 0, W, H])).save(os.path.join(OUT, f'{label}_{tag}_{name}_3d.png'))
    errs[f'{label}_{tag}'] = a.errors
    a.close()


def sheets(la, lb):
    for tag in ('hoch', 'quer'):
        for name, f, *_ in VIEWS:
            for d in ('2d', '3d'):
                pa, pb = [os.path.join(OUT, f'{l}_{tag}_{name}_{d}.png') for l in (la, lb)]
                if not (os.path.exists(pa) and os.path.exists(pb)): continue
                A, B = Image.open(pa).convert('RGB'), Image.open(pb).convert('RGB')
                s = 0.5
                w, h = int(A.width * s), int(A.height * s)
                sh = Image.new('RGB', (2 * w + 8, h), (255, 255, 255))
                sh.paste(A.resize((w, h), Image.LANCZOS), (0, 0)); sh.paste(B.resize((w, h), Image.LANCZOS), (w + 8, 0))
                sh.save(os.path.join(OUT, f'vergleich_{tag}_{name}_{d}.jpg'), quality=88)


def main():
    args = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--') and '=' in a)
    os.makedirs(OUT, exist_ok=True)
    errs = {}
    with sync_playwright() as p:
        for base, label in ((args.get('a'), args.get('la')), (args.get('b'), args.get('lb'))):
            if not base: continue
            for land in (False, True):
                shoot(p, base, label, land, errs)
    if args.get('la') and args.get('lb'): sheets(args['la'], args['lb'])
    print(json.dumps(errs))


if __name__ == '__main__':
    main()
