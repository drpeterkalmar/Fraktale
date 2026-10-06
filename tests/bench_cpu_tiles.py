#!/usr/bin/env python3
"""CPU-Rechenweg: Kachelgröße und Worker-Auslastung (Gutachten P2-8, ab 6.5.3).

Je Ansicht (?renderer=cpu, Pixel 7): Zeit bis zum fertigen Bild im Stillstand (Bestwert aus --reps Läufen, Standard 3), SHA-256 des
fertigen Bildes (muss mit und ohne Änderung gleich sein) und die Umschalt-Latenz: Während ein schwerer Job (1e31,
30 000 Iterationen) rechnet, springt die Ansicht – gemessen wird die Zeit bis die erste Kachel der neuen Ansicht ankommt
(vorher rechneten bis zu 2 große Kacheln je Worker zu Ende).
Aufruf: python3 tests/bench_cpu_tiles.py --tag=vorher|nachher [--reps=N] [--nolat] [--only=sea_1e31,…]   -> tests/results_cpu_tiles_<tag>.json
(Der Mac mini hat Hintergrundlast – Vorher/Nachher abwechselnd mehrfach messen.)
"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

TAG = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--tag=')), 'x')
REPS = int(next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--reps=')), 3))
NOLAT = '--nolat' in sys.argv
SEA = ('-0.743643887037158704752191506114774', '0.131825904205311970493132056385139')
VIEWS = [('sea_1e9', 1e9), ('sea_1e14', 1e14), ('sea_1e31', 1e31)]
ONLY = next((a.split('=', 1)[1].split(',') for a in sys.argv if a.startswith('--only=')), None)
if ONLY:
    VIEWS = [v for v in VIEWS if v[0] in ONLY]
HASH = """async () => { const f = window.__fraktal.RC.front, it = window.__fraktal.R.readIterSync(f.buf);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(it.buffer)))).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16); }"""

res = {}
with sync_playwright() as p:
    a = App(p, query='nosw&noanim&renderer=cpu').open()
    pg = a.page
    a.wait_done(120)
    for name, z in VIEWS:
        best = None
        for k in range(REPS):
            a.set_view(SEA[0], SEA[1], z * (1 + 0.0001 * k))   # weitere Läufe: minimal andere Ansicht (kein Cache)
            t, st = a.wait_done(300)
            best = t if best is None else min(best, t)
            if k == 0:
                h = pg.evaluate(HASH)
        res[name] = dict(doneS=round(best, 2), maxIter=st['maxIter'], hash=h)
        print(name, res[name])
    # Umschalt-Latenz: schwerer Job läuft, dann Sprung -> erste Kachel der neuen Ansicht
    lat = []
    for k in range(0 if NOLAT else 5):
        a.set_view(SEA[0], SEA[1], 3e31 * (1 + k * 0.01))
        time.sleep(1.5)
        ms = pg.evaluate("""([cx, cy, z]) => new Promise((res) => {
            const A = window.__fraktal, t0 = performance.now(); A.setView(cx, cy, z);
            const tick = () => { const j = A.RC.job; if (j && j.view.zoom === A.S.cam.zoom && j.tilesDone > 0) { res(performance.now() - t0); return; }
                                 if (performance.now() - t0 > 20000) { res(null); return; } setTimeout(tick, 2); };
            tick(); })""", [SEA[0], SEA[1], 2e31 * (1 + k * 0.01)])
        lat.append(round(ms, 1) if ms is not None else None)
        a.wait_done(300)
    res['switch_first_tile_ms'] = lat
    print('Umschalt-Latenz (erste Kachel)', lat)
    res['errors'] = a.errors
    a.close()
json.dump(res, open(os.path.join(os.path.dirname(__file__), 'results_cpu_tiles_%s.json' % TAG), 'w'), indent=1)
