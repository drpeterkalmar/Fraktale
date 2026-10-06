"""GPU-Speicher in 3D (Gutachten P2-3, ab 6.5.3): 30 s Zufallsflug (Pixel 7), belegte Iterationspuffer im Pool.

Erwartet (6.5.3): höchstens 6 Ebenen (T3.N3) im Stapel, 3D-Rechenpuffer höchstens 1600 px Kante (+ 20 % Überhang der
Vorschau), belegter Speicher am Ende ≤ 130 MB (6.5.2: 155 MB, Spitze 174 MB), 0 Fehler, der Flug zoomt. Das Ziel des
Gutachtens (≤ 64 MB) ist ohne sichtbar gröberes 3D nicht erreichbar: 6 Ebenen in voller Auflösung mit Überhang sind
allein ~110 MB (siehe Bericht).
Messwerte -> tests/results_memory3d_<tag>.json
Aufruf: FK_HEADED=1 python3 tests/test_memory3d.py [--tag=…] [--secs=30]
"""
import sys, os, time, json
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

TAG = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--tag=')), 'x')
SECS = float(next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--secs=')), 30))
with sync_playwright() as p:
    a = App(p).open()
    pg = a.page
    a.wait_done(60)
    pg.evaluate("() => window.__fraktal.startFly(undefined, { d3: true })")     # 6.6: ohne Angabe flöge er in 2D
    ok3d = a.wait_3d(60)
    t0 = time.time()
    samples = []
    while time.time() - t0 < SECS:
        li = pg.evaluate("() => { const l = window.__fraktal.layerInfo(); return [l.pool.usedMB, l.pool.freeMB, l.n, l.pool.n, window.__fraktal.S.cam.zoom]; }")
        samples.append([round(time.time() - t0, 1)] + li)
        time.sleep(0.5)
    end = pg.evaluate("() => { const l = window.__fraktal.layerInfo(); return { pool: l.pool, n: l.n, budgetMB: window.__fraktal.R.poolBudget / 1048576, zoom: window.__fraktal.S.cam.zoom, canvas: window.__fraktal.status().canvas, h3d: window.__fraktal.layers3dInfo().map(x => [x.w, x.h]) }; }")
    pk = max(s[1] for s in samples)
    r = dict(tag=TAG, secs=SECS, end=end, peakUsedMB=pk, peakTotalMB=max(s[1] + s[2] for s in samples), maxLayers=max(s[3] for s in samples), samples=samples, errors=a.errors)
    print(json.dumps({k: v for k, v in r.items() if k != 'samples'}, ensure_ascii=False))
    json.dump(r, open(os.path.join(os.path.dirname(__file__), 'results_memory3d_%s.json' % TAG), 'w'), indent=1)
    side = max(max(w, h) for w, h in end['h3d']) if end['h3d'] else 0
    print('Ebenen max %d, größte 3D-Kante %d px, belegt am Ende %.1f MB (Spitze %.1f MB)' % (r['maxLayers'], side, end['pool']['usedMB'], pk))
    ok = ok3d and r['maxLayers'] <= 6 and side <= 1920 and end['pool']['usedMB'] <= 130 and end['zoom'] > 1e3 and not a.errors
    a.close()
print('RESULT', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
