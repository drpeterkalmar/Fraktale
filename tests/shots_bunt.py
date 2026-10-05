#!/usr/bin/env python3
"""Screenshots 6.4 „Bunte Menge“ für die Sichtprüfung: Gesamtbild, Seepferdchen-Tal 300×, Mini-Mandelbrot 3·10⁹
(Periode 266), Julia c = −1 + 0,1i; Modus Inseln und Ringe (dazu Schwarz zum Vergleich); 2D und 3D (45°), hoch/quer.
Ablage tests/shots/bunt/<hoch|quer>/, Blätter tests/shots/bunt/blatt_<2d|3d>_<hoch|quer>.jpg
Aufruf: python3 tests/shots_bunt.py [--only=hoch|quer] [--dim=2d|3d]"""
import sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright
from PIL import Image
OUT = os.path.join(os.path.dirname(__file__), 'shots', 'bunt')
VIEWS = [('ganz', '-0.6', '0', 1, 0), ('seepferd_300', '-0.7453', '0.1127', 300, 0),
         ('mini_3e9', '-1.749974573019448626767866732590', '0', 3e9, 0), ('julia', '0', '0', 1.3, 1)]
MODES = [('schwarz', 'black', 1), ('inseln', 'bunt', 1), ('ringe', 'bunt', 2)]


def arg(n):
    return next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--' + n + '=')), None)


def main():
    only, dims = arg('only'), [arg('dim')] if arg('dim') else ['2d', '3d']
    errs = {}
    with sync_playwright() as p:
        for land in (False, True):
            tag = 'quer' if land else 'hoch'
            if only and only != tag: continue
            d = os.path.join(OUT, tag); os.makedirs(d, exist_ok=True)
            a = App(p, landscape=land).open(); pg = a.page
            for dim in dims:
                pg.evaluate(f"() => window.__fraktal.set3d({'true' if dim == '3d' else 'false'})"); time.sleep(1.5)
                grid = []
                for mn, sc, m in MODES:
                    row = []
                    for vn, cx, cy, z, f in VIEWS:
                        pg.evaluate(f"""() => {{ const A = window.__fraktal; A.setMode({f}, true); if ({f} === 1) A.setJulia(A.HP.fromString('-1'), A.HP.fromString('0.1'));
                            A.S.setCol = '{sc}'; A.S.inMode = {m}; A.S.palette = 0; A.invalidate(); A.emit('settings'); }}""")
                        if dim == '3d': pg.evaluate("() => window.__fraktal.set3d(true)")
                        a.set_view(cx, cy, z); a.wait_done(240)
                        if dim == '3d':
                            time.sleep(2.0); a.wait_done(120)
                            pg.evaluate("() => { const A = window.__fraktal; A.V3.tilt = 45 * Math.PI / 180; A.V3.heading = 0.3; A.RC.dirty = true; }")
                            time.sleep(1.5); pg.evaluate("() => window.__fraktal.settle3d()")
                        else:
                            time.sleep(0.6); pg.evaluate("() => window.__fraktal.snapshot()")
                        fn = os.path.join(d, f'{dim}_{mn}_{vn}.jpg'); pg.screenshot(path=fn, quality=85); row.append(fn)
                    grid.append(row)
                ims = [[Image.open(f).convert('RGB') for f in r] for r in grid]
                w, h = ims[0][0].size; s = 0.3 if not land else 0.25
                sh = Image.new('RGB', (int(w * s) * len(VIEWS), int(h * s) * len(MODES)))
                for j, r in enumerate(ims):
                    for i, im in enumerate(r): sh.paste(im.resize((int(w * s), int(h * s))), (i * int(w * s), j * int(h * s)))
                sh.save(os.path.join(OUT, f'blatt_{dim}_{tag}.jpg'), quality=85)
            errs[tag] = a.errors
            a.close()
    print('errors', errs)
    sys.exit(1 if any(errs.values()) else 0)


if __name__ == '__main__':
    main()
