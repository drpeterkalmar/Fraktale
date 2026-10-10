#!/usr/bin/env python3
"""Screenshots 6.9 „Außen“ (Palette / Grenznah / Schwarz) für die Sichtprüfung: Gesamtbild, Seepferdchen-Tal 10⁶,
Deep-Zoom 10¹² über den CPU-Rechenweg, Julia c = −1 + 0,1i; hoch/quer, optional 3D (45°).
Zeilen: Palette · Grenznah (Saum 16 px) · Schwarz + Bunt Inseln · Schwarz + Bunt Ringe (+ --extra: weitere Varianten).
Ablage tests/shots/v69/<hoch|quer>/, Blätter tests/shots/v69/blatt_<2d|3d>_<hoch|quer>.jpg
Aufruf: python3 tests/shots_v69.py [--only=hoch|quer] [--dim=2d|3d] [--views=ganz,julia] [--rows=pal,edge] [--pal=N]"""
import sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright
from PIL import Image
OUT = os.path.join(os.path.dirname(__file__), 'shots', 'v69')
SEA = ('-0.743643887037151', '0.131825904205330')
VIEWS = [('ganz', '-0.6', '0', 1, 0, 'auto'), ('rand_1e6', '-0.743637214380908705', '0.131822306549061970', 1e6, 0, 'auto'),
         ('deep_1e12_cpu', SEA[0], SEA[1], 1e12, 0, 'cpu'), ('julia', '0', '0', 1.2, 1, 'auto')]
# (Name, Außen, Saumbreite, Mengenfarbe, Bunt-Modus)
ROWS = [('pal', 'pal', 16, 'black', 1), ('edge', 'edge', 16, 'black', 1), ('black_inseln', 'black', 16, 'bunt', 1),
        ('black_ringe', 'black', 16, 'bunt', 2), ('edge_4', 'edge', 4, 'black', 1), ('edge_60', 'edge', 60, 'black', 1),
        ('edge_bunt', 'edge', 16, 'bunt', 1)]


def arg(n):
    return next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--' + n + '=')), None)


def main():
    only, dims = arg('only'), [arg('dim')] if arg('dim') else ['2d']
    views = [v for v in VIEWS if not arg('views') or v[0] in arg('views').split(',')]
    rows = [r for r in ROWS if (r[0] in arg('rows').split(',') if arg('rows') else r[0] in ('pal', 'edge', 'black_inseln', 'black_ringe'))]
    pal = int(arg('pal') or 0)
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
                for rn, out, ew, sc, m in rows:
                    row = []
                    for vn, cx, cy, z, f, rend in views:
                        pg.evaluate(f"""() => {{ const A = window.__fraktal; A.setMode({f}, true); if ({f} === 1) A.setJulia(A.HP.fromString('-1'), A.HP.fromString('0.1'));
                            A.S.renderer = '{rend}'; A.S.outMode = '{out}'; A.S.edgeW = {ew}; A.S.setCol = '{sc}'; A.S.inMode = {m}; A.S.palette = {pal}; A.invalidate(); A.emit('settings'); }}""")
                        if dim == '3d': pg.evaluate("() => window.__fraktal.set3d(true)")
                        a.set_view(cx, cy, z); a.wait_done(300)
                        time.sleep(2.5); a.wait_done(300)      # Bunt: die Rechen-Variante wird im Hintergrund übersetzt
                        if dim == '3d':
                            time.sleep(2.0); a.wait_done(120)
                            pg.evaluate("() => { const A = window.__fraktal; A.V3.tilt = 45 * Math.PI / 180; A.V3.heading = 0.3; A.RC.dirty = true; }")
                            time.sleep(1.5); pg.evaluate("() => window.__fraktal.settle3d()")
                        else:
                            time.sleep(0.6); pg.evaluate("() => window.__fraktal.snapshot()")
                        fn = os.path.join(d, f'{dim}_{rn}_{vn}.jpg'); pg.screenshot(path=fn, quality=88); row.append(fn)
                    grid.append(row)
                ims = [[Image.open(f).convert('RGB') for f in r] for r in grid]
                w, h = ims[0][0].size; s = 0.3 if not land else 0.25
                sh = Image.new('RGB', (int(w * s) * len(views), int(h * s) * len(rows)))
                for j, r in enumerate(ims):
                    for i, im in enumerate(r): sh.paste(im.resize((int(w * s), int(h * s))), (i * int(w * s), j * int(h * s)))
                sh.save(os.path.join(OUT, f'blatt_{dim}_{tag}' + (('_' + arg('rows').replace(',', '-')) if arg('rows') else '') + '.jpg'), quality=88)
            pg.evaluate("() => { window.__fraktal.S.renderer = 'auto'; }")
            errs[tag] = a.errors
            a.close()
    print('errors', errs)
    sys.exit(1 if any(errs.values()) else 0)


if __name__ == '__main__':
    main()
