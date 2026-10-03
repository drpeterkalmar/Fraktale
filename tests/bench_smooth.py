#!/usr/bin/env python3
"""GPU-Kosten der Distanzschätzung (6.1): Rechenzeit synchron (benchCompute: Warteschlange leeren, rechnen, per readPixels auf das Ergebnis warten;
Minimum aus 2×3 Läufen) mit/ohne Distanzschätzung in derselben Sitzung – Vorschau 1/4, 1/2 und Vollbild inkl.
Fehlerschätzung; Display-Pass per Timer-Query (benchGPU([])).
Aufruf: python3 tests/bench_smooth.py [--throttle=4]"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright
VIEWS = [('ganz', '-0.6', '0', 1), ('seepferd_300', '-0.7453', '0.1127', 300), ('minibrot_3e6', '-1.7499744226', '0.0000000000123', 3e6),
         ('rand_1e9', '-0.743637214380908705', '0.131822306549061970', 1e9)]
out = {}
with sync_playwright() as p:
    a = App(p).open(); pg = a.page
    for name, cx, cy, z in VIEWS:
        a.set_view(cx, cy, z); a.wait_done(120); time.sleep(1.0)
        r = {}
        for de in (False, True, False, True):
            b = pg.evaluate("(de) => window.__fraktal.benchCompute([4, 2, 1], 3, de)", de)
            k = 'mit' if de else 'ohne'
            r[k] = {kk: min(v, r.get(k, {}).get(kk, 1e9)) for kk, v in b.items()}
        # Display-Pass per Wanduhr (40 Bilder zwischen zwei readPixels), Saum an/aus im selben Bild
        pj = r"""(de) => { const A = window.__fraktal, gl = A.R.gl; A.S.deOn = de;
          const sync = () => { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); };
          sync(); const t0 = performance.now(); for (let i = 0; i < 40; i++) A.presentNow(); sync(); const t = (performance.now() - t0) / 40; A.S.deOn = true; return t; }"""
        pr = {False: [], True: []}
        for _ in range(6):
            for de in (False, True): pr[de].append(pg.evaluate(pj, de))
        r['present'] = {'ohne': round(min(pr[False]), 3), 'mit': round(min(pr[True]), 3)}
        r['mehr_pct'] = {kk: round(100 * (r['mit'][kk] / max(0.05, r['ohne'][kk]) - 1), 1) for kk in r['mit']}
        out[name] = r
        print(name, json.dumps(r), flush=True)
    a.close()
json.dump(out, open(os.path.join(os.path.dirname(__file__), 'results_bench_smooth.json'), 'w'), indent=1)
