#!/usr/bin/env python3
"""3D-Bildzeit A/B in derselben Seite und Szene (6.1): 6.0-Schattierung gegen 6.1-Schattierung (gleicher Shader,
Schalter u_smooth), Bewegungsbild (Auflösung 65 % wie 6.0) und Stillstandsbild (volle Auflösung + Subpixel-Versatz +
Mittelung). Gemessen per Wanduhr zwischen zwei Synchronisationspunkten (readPixels) über 20 Bilder, 10× im Wechsel,
Minimum und Median – Timer-Queries zählen unter ANGLE/Metal eingereihte Hintergrundarbeit mit (±15 % Streuung).
Aufruf: python3 tests/bench3d_ab.py   (Ergebnis tests/results_bench3d_ab.json)
Seit 6.5.4 gibt es die 6.0-Schattierung (u_smooth = 0) nicht mehr – gemessen werden nur noch Bewegungs- und Stillbild
(die 6.0/6.1-Werte stehen in der eingecheckten results_bench3d_ab.json)."""
import sys, os, json, time, statistics
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright
VIEWS = [('ganz', '-0.6', '0', 1), ('seepferd_300', '-0.7453', '0.1127', 300), ('minibrot_3e6', '-1.7499744226', '0.0000000000123', 3e6),
         ('rand_1e9', '-0.743637214380908705', '0.131822306549061970', 1e9)]
JS = r"""([sm, still]) => { const A = window.__fraktal, gl = A.R.gl;
  const sync = () => { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); };
  sync(); const t0 = performance.now(); A.bench3d(20, still); sync(); return (performance.now() - t0) / 20; }"""
out = {}
with sync_playwright() as p:
    a = App(p).open(); pg = a.page
    for name, cx, cy, z in VIEWS:
        pg.evaluate("() => window.__fraktal.set3d(false)"); time.sleep(0.5)
        a.set_view(cx, cy, z); a.wait_done(120)
        pg.evaluate("() => window.__fraktal.set3d(true)"); time.sleep(1.2); a.wait_done(120)
        pg.evaluate("() => { const A = window.__fraktal; A.V3.tilt = 45 * Math.PI / 180; A.V3.heading = 0.4; A.RC.dirty = true; }")
        time.sleep(5)
        r = {'6.1': [], '6.1still': []}
        for k in range(10):
            r['6.1'].append(pg.evaluate(JS, [1, False])); r['6.1still'].append(pg.evaluate(JS, [1, True]))
        o = {k: {'min': round(min(v), 2), 'median': round(statistics.median(v), 2)} for k, v in r.items()}
        out[name] = o
        print(name, json.dumps(o), flush=True)
    out['gpu'] = pg.evaluate("() => window.__fraktal.view3dInfo().gpu")
    a.close()
json.dump(out, open(os.path.join(os.path.dirname(__file__), 'results_bench3d_ab_v654.json'), 'w'), indent=1)
