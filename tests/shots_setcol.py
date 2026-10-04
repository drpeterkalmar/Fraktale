#!/usr/bin/env python3
"""Screenshots Farbe der Menge + Alpin-Look (6.2) für die Sichtprüfung, Pixel 7 hoch/quer.
2D + 3D je Schwarz/Weiß/Palette dunkel/hell/eigene; Alpin (Wald/See/Wiese) und zum Vergleich der Standard-Look
bei Zoom 1, 300×, 1e6.
Ablage tests/shots/setcol/<hoch|quer>/, Übersichtsblätter tests/shots/setcol/blatt_*.jpg
Aufruf: python3 tests/shots_setcol.py [--only=hoch|quer] [--part=set|alpine]"""
import sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright
from PIL import Image
OUT = os.path.join(os.path.dirname(__file__), 'shots', 'setcol')
SEA = ('-0.7453', '0.1127', 300)
RAND = ('-0.743637214380908705', '0.131822306549061970', 1e6)
GANZ = ('-0.6', '0', 1)
SETS = [('black', None), ('white', None), ('dark', None), ('light', None), ('custom', '#d9b26a')]


def arg(n):
    return next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--' + n + '=')), None)


def sheet(paths, out, s=0.4):
    ims = [Image.open(p).convert('RGB') for p in paths]
    w, h = ims[0].size
    sh = Image.new('RGB', (int(w * s) * len(ims), int(h * s)))
    for i, im in enumerate(ims): sh.paste(im.resize((int(w * s), int(h * s))), (i * int(w * s), 0))
    sh.save(out, quality=85)


def look(pg, setcol, hexv=None, alpine=None, valley='forest', palette=None):
    pg.evaluate("""([sc, hx, al, va, pal]) => { const A = window.__fraktal, S = A.S; S.setCol = sc; if (hx) S.setHex = hx; S.alpine = !!al; S.valley = va;
        if (pal) S.palette = A.PAL.indexOf(pal); A.invalidate(); A.emit('settings'); }""", [setcol, hexv, alpine, valley, palette])


def main():
    only, part = arg('only'), arg('part')
    errs = {}
    with sync_playwright() as p:
        for land in (False, True):
            tag = 'quer' if land else 'hoch'
            if only and only != tag: continue
            d = os.path.join(OUT, tag); os.makedirs(d, exist_ok=True)
            a = App(p, landscape=land).open(); pg = a.page
            pg.evaluate("() => { const A = window.__fraktal; A.S.palette = 0; }")
            if part in (None, 'set'):
                for dim in ('2d', '3d'):
                    shots = []
                    pg.evaluate(f"() => window.__fraktal.set3d({'true' if dim == '3d' else 'false'})"); time.sleep(1.2)
                    a.set_view(*SEA); a.wait_done(120)
                    for sc, hx in SETS:
                        look(pg, sc, hx); time.sleep(0.6)
                        if dim == '3d': pg.evaluate("() => window.__fraktal.settle3d()")
                        else: pg.evaluate("() => window.__fraktal.snapshot()")
                        fn = os.path.join(d, f'set_{dim}_{sc}.jpg'); pg.screenshot(path=fn, quality=85); shots.append(fn)
                    sheet(shots, os.path.join(OUT, f'blatt_set_{dim}_{tag}.jpg'))
                look(pg, 'black')
            if part in (None, 'alpine'):
                pg.evaluate("() => window.__fraktal.set3d(true)"); time.sleep(1.2)
                for valley in ('std', 'forest', 'lake', 'meadow'):
                    shots = []
                    for vn, v in (('z1', GANZ), ('z300', SEA), ('z1e6', RAND)):
                        a.set_view(*v); a.wait_done(120)
                        if valley == 'std': look(pg, 'black', None, False, 'forest', 'neon')   # Vergleich: Standard-Look wie 6.1
                        else: look(pg, 'white', None, True, valley, 'alpine')
                        time.sleep(2.5)
                        pg.evaluate("() => window.__fraktal.settle3d()")
                        fn = os.path.join(d, f'alpin_{valley}_{vn}.jpg'); pg.screenshot(path=fn, quality=85); shots.append(fn)
                    sheet(shots, os.path.join(OUT, f'blatt_alpin_{valley}_{tag}.jpg'))
                look(pg, 'black', None, False, 'forest', 'neon')
            errs[tag] = a.errors
            a.close()
    print('errors', errs)
    sys.exit(1 if any(errs.values()) else 0)


if __name__ == '__main__':
    main()
