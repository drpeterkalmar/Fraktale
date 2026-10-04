#!/usr/bin/env python3
"""3D-Bildzeit 6.2 je Look in derselben Seite und Szene: Standard (schwarze Menge), Weiß (Gletscher), Alpin Wald,
Alpin See. Bewegungsbild (65 %, wie Handy), Wanduhr zwischen zwei Synchronisationspunkten (readPixels) über 20 Bilder,
8× im Wechsel, Minimum/Median (Timer-Queries streuen unter ANGLE/Metal ±15 %).
FK_BASE auf einen 6.1.0-Stand zeigen lassen + --only=std = Vergleich mit 6.1.
Aufruf: python3 tests/bench_v62.py [--tag=v620] [--only=std]   (Ergebnis tests/results_bench_v62_<tag>.json)"""
import sys, os, json, time, statistics
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright
VIEWS = [('ganz', '-0.6', '0', 1), ('seepferd_300', '-0.7453', '0.1127', 300), ('rand_1e6', '-0.743637214380908705', '0.131822306549061970', 1e6)]
LOOKS = [('std', "S.alpine=false;S.setCol='black'"), ('white', "S.alpine=false;S.setCol='white'"),
         ('alpin_wald', "S.alpine=true;S.valley='forest';S.setCol='white'"), ('alpin_see', "S.alpine=true;S.valley='lake';S.setCol='white'")]
JS = r"""() => { const A = window.__fraktal, gl = A.R.gl;
  const sync = () => { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); };
  sync(); const t0 = performance.now(); A.bench3d(20, false, true); sync(); return (performance.now() - t0) / 20; }"""
tag = next((a.split('=')[1] for a in sys.argv[1:] if a.startswith('--tag=')), 'v620')
only = next((a.split('=')[1] for a in sys.argv[1:] if a.startswith('--only=')), None)
looks = [l for l in LOOKS if not only or l[0] == only]
out = {}
with sync_playwright() as p:
    a = App(p).open(); pg = a.page
    for name, cx, cy, z in VIEWS:
        pg.evaluate("() => window.__fraktal.set3d(false)"); time.sleep(0.5)
        a.set_view(cx, cy, z); a.wait_done(120)
        pg.evaluate("() => window.__fraktal.set3d(true)"); time.sleep(1.2); a.wait_done(120)
        pg.evaluate("() => { const A = window.__fraktal; A.V3.tilt = 45 * Math.PI / 180; A.V3.heading = 0.4; A.RC.dirty = true; }")
        time.sleep(4)
        r = {k: [] for k, _ in looks}
        for _ in range(8):
            for k, js in looks:
                if not only: pg.evaluate("() => { const A = window.__fraktal, S = A.S; " + js + "; }")
                r[k].append(pg.evaluate(JS))
        o = {k: {'min': round(min(v), 2), 'median': round(statistics.median(v), 2)} for k, v in r.items()}
        out[name] = o
        print(name, json.dumps(o), flush=True)
    if not only: pg.evaluate("() => { const S = window.__fraktal.S; S.alpine = false; S.setCol = 'black'; }")
    out['gpu'] = pg.evaluate("() => window.__fraktal.view3dInfo().gpu")
    a.close()
json.dump(out, open(os.path.join(os.path.dirname(__file__), f'results_bench_v62_{tag}.json'), 'w'), indent=1)
